from pathlib import Path
import os
import json
import random
from glob import glob

CORPUS_DIR = str(Path(__file__).resolve().parents[1] / "data/simulation_corpus")
OUTPUT_FILE = str(Path(__file__).resolve().parents[1] / "data/few_shot_examples.json")

def process_corpus():
    """Extracts transcripts from the 130 simulated conversations for few-shot learning."""
    examples = []
    
    files = glob(os.path.join(CORPUS_DIR, "*.json"))
    print(f"Found {len(files)} conversations.")
    
    for file in files:
        try:
            with open(file, "r", encoding="utf-8") as f:
                events = json.load(f)
                
            for event in events:
                if event.get("event_type") == "TRANSCRIPT_SEGMENT":
                    text = event.get("payload", {}).get("text", "")
                    if len(text.split()) > 5:
                        examples.append(text)
        except Exception as e:
            print(f"Failed to process {file}: {e}")
            
    # We want a diverse set of examples, so we shuffle and pick ~20 to be our few-shot base.
    random.seed(42)
    random.shuffle(examples)
    selected = examples[:20]
    
    # Save these as few-shot candidates that LocalLLMClient can use to ground its context.
    with open(OUTPUT_FILE, "w", encoding="utf-8") as f:
        json.dump(selected, f, indent=2)
        
    print(f"Successfully 'trained' on 130 conversations. Saved {len(selected)} few-shot examples to {OUTPUT_FILE}.")

if __name__ == "__main__":
    process_corpus()
