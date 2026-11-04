import json
import logging
from typing import Type, TypeVar, Any, cast
from pathlib import Path
from pydantic import BaseModel
import threading
import os

from clozflow_brain.infrastructure.llm import LLMClient

logger = logging.getLogger(__name__)
T = TypeVar("T", bound=BaseModel)

class LocalLLMClient(LLMClient):
    """
    A Local LLM client using llama-cpp-python.
    Automatically downloads and caches a fast small language model (like Qwen2.5 0.5B).
    Uses grammar-based or JSON schema constraints to guarantee valid Pydantic outputs.
    """

    _model_lock = threading.Lock()
    _inference_lock = threading.Lock()
    _shared_llm = None
    _shared_model_path = None

    def __init__(self, repo_id: str = "Qwen/Qwen2.5-0.5B-Instruct-GGUF", filename: str = "qwen2.5-0.5b-instruct-q4_k_m.gguf"):
        self.repo_id = repo_id
        self.filename = filename
        self.model_name = f"local-llama-cpp ({filename})"
        
        # We don't load the model in __init__ to avoid long startup times.
        # It loads on the first request.

    def _get_llm(self):
        """Lazily load the LLM, thread-safe."""
        with self._model_lock:
            if LocalLLMClient._shared_llm is not None:
                return LocalLLMClient._shared_llm

            logger.info("Initializing Local LLM with llama-cpp-python. This may take a moment to download...")
            try:
                from huggingface_hub import hf_hub_download # type: ignore
                model_path = hf_hub_download(repo_id=self.repo_id, filename=self.filename)
                LocalLLMClient._shared_model_path = model_path
                
                from llama_cpp import Llama # type: ignore
                # Create the Llama instance with adequate context size
                cpu_cores = os.cpu_count() or 4
                llm = Llama(
                    model_path=model_path,
                    n_ctx=2048,           # 2K context is enough for short cognitive events
                    n_threads=max(1, cpu_cores - 1),
                    verbose=False         # Disable verbose C++ logs
                )
                LocalLLMClient._shared_llm = llm
                logger.info(f"Local LLM initialized successfully from {model_path}")
                return llm
            except Exception as e:
                logger.error(f"Failed to initialize Local LLM: {e}")
                raise e

    def generate_structured_output(self, prompt: str, response_schema: Type[T],
                                   system_prompt: str | None = None, temperature: float = 0.0) -> T:
        if not self._inference_lock.acquire(timeout=float(os.getenv("CEB_LLM_TIMEOUT_SECONDS", "4"))):
            raise TimeoutError("Local model is busy")
        try:
            return self._generate(prompt, response_schema, system_prompt, temperature)
        finally:
            self._inference_lock.release()

    def _generate(
        self,
        prompt: str,
        response_schema: Type[T],
        system_prompt: str | None = None,
        temperature: float = 0.0,
    ) -> T:
        llm = self._get_llm()
        
        # Ground the LLM with few-shot examples from the 130 conversations
        few_shot_path = os.getenv("CEB_FEW_SHOT_PATH", str(Path(__file__).resolve().parents[3] / "data" / "few_shot_examples.json"))
        try:
            if os.path.exists(few_shot_path):
                with open(few_shot_path, "r", encoding="utf-8") as f:
                    examples = json.load(f)
                import random
                # Inject 3 random examples to give the LLM context of the conversational domain
                sampled = random.Random(prompt).sample(examples, min(3, len(examples)))
                example_text = "\n".join([f"- {ex}" for ex in sampled])
                domain_context = f"\n\nContext - Here are examples of buyer utterances you must analyze:\n{example_text}"
                
                if system_prompt:
                    system_prompt += domain_context
                else:
                    system_prompt = domain_context
        except Exception as e:
            logger.warning(f"Failed to load few-shot examples: {e}")
        
        # Build prompt using a generic instruct format
        messages = []
        if system_prompt:
            messages.append({"role": "system", "content": system_prompt})
        
        messages.append({"role": "user", "content": prompt})
        
        # Ensure llama_cpp supports chat formats by constructing a simple prompt if needed,
        # but modern llama_cpp_python supports create_chat_completion out of the box.
        
        try:
            # We attempt to use the JSON schema format if supported
            # Older versions of llama-cpp-python use grammar, newer ones support response_format.
            schema_json = response_schema.model_json_schema()
            
            # Since Qwen uses ChatML, Llama-cpp usually auto-detects it.
            response = llm.create_chat_completion(
                messages=messages,
                temperature=temperature,
                max_tokens=1024,
                response_format={
                    "type": "json_object",
                    "schema": schema_json,
                }
            )
            
            content = cast(Any, response)['choices'][0]['message']['content']
            if not isinstance(content, str):
                raise ValueError('Local model returned no text')
            parsed_dict = json.loads(content)
            return response_schema.model_validate(parsed_dict)
            
        except Exception as e:
            logger.warning(f"Native json_object format failed ({e}), falling back to prompt engineering.")
            # Fallback if json_object format is not perfectly supported
            json_schema_str = json.dumps(response_schema.model_json_schema(), indent=2)
            fallback_prompt = (
                f"{prompt}\n\n"
                f"You MUST reply with a valid JSON object matching this schema:\n"
                f"{json_schema_str}\n\n"
                f"Output ONLY valid JSON. No markdown, no explanations."
            )
            
            messages[-1]["content"] = fallback_prompt
            response = llm.create_chat_completion(
                messages=messages,
                temperature=temperature,
                max_tokens=1024
            )
            
            content = cast(Any, response)['choices'][0]['message']['content']
            if not isinstance(content, str):
                raise ValueError('Local model returned no text')
            # Clean up potential markdown formatting
            content = content.strip()
            if content.startswith("```json"):
                content = content[7:]
            if content.startswith("```"):
                content = content[3:]
            if content.endswith("```"):
                content = content[:-3]
                
            parsed_dict = json.loads(content.strip())
            return response_schema.model_validate(parsed_dict)

