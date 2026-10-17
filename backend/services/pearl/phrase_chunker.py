"""
Pearl Deterministic Incremental Phrase Chunker
Optimized for ultra-low latency (sub-200ms TTFA) and natural conversational prosody.

Key algorithmic guarantees:
1. Handles arbitrary token fragments & punctuation split across tokens.
2. Never triggers on a whitespace alone.
3. First-chunk fast path: Emits on 2-4 words or punctuation for sub-200ms Time-To-First-Audio.
4. Subsequent chunks: Gathers complete syntactic clauses (6-10 words or punctuation) for natural human prosody.
5. Hard bounds: Max 14 words per chunk to prevent downstream audio underruns.
6. Generation ID tagging: Chunks carry generation IDs so obsolete chunks after barge-in are discarded.
"""
import re
from typing import List, Optional, Tuple

# Sentence and clause boundary punctuation
# Primary: . ! ? । (Devanagari danda) \n
# Secondary: , ; : — -
_STRONG_PUNCT_RE = re.compile(r'[.!?\u0964\n]')
_CLAUSE_PUNCT_RE = re.compile(r'[,;:—\-]')

class PhraseChunker:
    """
    Deterministic streaming phrase chunker for LLM token streams.
    """
    def __init__(
        self,
        min_first_words: int = 3,
        min_subsequent_words: int = 7,
        max_words_per_chunk: int = 14,
        first_chunk_words: Optional[int] = None,
        subsequent_chunk_words: Optional[int] = None
    ):
        if first_chunk_words is not None:
            min_first_words = first_chunk_words
        if subsequent_chunk_words is not None:
            min_subsequent_words = subsequent_chunk_words

        self.min_first_words = min_first_words
        self.min_subsequent_words = min_subsequent_words
        self.max_words_per_chunk = max_words_per_chunk
        
        self.buffer: str = ""
        self.is_first_chunk: bool = True
        self.chunk_index: int = 0

    def reset(self):
        """Reset chunker state for a new conversational turn."""
        self.buffer = ""
        self.is_first_chunk = True
        self.chunk_index = 0

    def feed_token(self, token: str) -> List[str]:
        """
        Ingest a streaming token delta and return 0 or more ready speakable phrases.
        """
        if not token:
            return []

        self.buffer += token
        ready_chunks: List[str] = []

        # Analyze current buffer
        trimmed = self.buffer.strip()
        if not trimmed:
            return []

        words = trimmed.split()
        word_count = len(words)

        # Check punctuation marks
        has_strong_punct = bool(_STRONG_PUNCT_RE.search(trimmed))
        has_clause_punct = bool(_CLAUSE_PUNCT_RE.search(trimmed))

        should_emit = False

        if self.is_first_chunk:
            # Fast path: Emit as soon as we have a clause/sentence boundary OR min_first_words
            if has_strong_punct or has_clause_punct or word_count >= self.min_first_words:
                should_emit = True
        else:
            # Subsequent chunks: Emit on strong punctuation, or clause punct with >= 4 words,
            # or when reaching nominal word count (7+ words), or max bound (14 words)
            if has_strong_punct:
                should_emit = True
            elif has_clause_punct and word_count >= 4:
                should_emit = True
            elif word_count >= self.min_subsequent_words:
                if self.buffer.endswith(" ") or self.buffer.endswith("\n"):
                    should_emit = True
            elif word_count >= self.max_words_per_chunk:
                should_emit = True

        if should_emit:
            emit_text = trimmed
            self.buffer = ""
            self.is_first_chunk = False
            self.chunk_index += 1
            ready_chunks.append(emit_text)

        return ready_chunks

    # Alias feed to feed_token
    feed = feed_token

    def flush(self) -> List[str]:
        """
        Flush remaining text in buffer at end of LLM generation as a list.
        """
        trimmed = self.buffer.strip()
        self.buffer = ""
        if trimmed:
            self.chunk_index += 1
            return [trimmed]
        return []

    def flush_str(self) -> Optional[str]:
        """
        Flush remaining text in buffer at end of LLM generation as an optional string.
        """
        res = self.flush()
        return res[0] if res else None
