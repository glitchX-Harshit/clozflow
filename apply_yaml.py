import sys
import re

file_path = "backend/services/sales_ai_engine.py"

with open(file_path, "r", encoding="utf-8") as f:
    content = f.read()

# 1. Import yaml
if "import yaml" not in content:
    content = re.sub(
        r"import json",
        r"import json\nimport yaml",
        content
    )

# 2. Update __init__
pattern_init = r'(def __init__\(self, call_context: dict\[str, Any\] \| None = None, mode: str = "live"\):\n\s*self\.call_context = call_context\n\s*self\.mode = mode)'
replacement_init = r'''def __init__(self, call_context: dict[str, Any] | None = None, mode: str = "live"):
        self.call_context = call_context or {}
        self.mode = mode
        self.sim_config = None
        self.banned_sim_phrases = []
        if self.mode == "simulation":
            try:
                import os
                sim_yaml_path = os.path.join(os.path.dirname(__file__), "..", "..", "yaml_folder", "HEXAGON_SIMULATION_CONTEXT_ISOLATION_V1.yaml")
                with open(sim_yaml_path, "r", encoding="utf-8") as f:
                    self.sim_config = yaml.safe_load(f)
            except Exception as e:
                print(f"[WARNING] Could not load simulation config: {e}")
                
            if self.sim_config:
                sim_prof = self.sim_config.get("simulation_profile", {})
                self.call_context["product_name"] = sim_prof.get("product", "oat_milk")
                self.call_context["customer_type"] = sim_prof.get("customer", "local_cafe_owner")
                self.call_context["industry"] = sim_prof.get("industry", "cafe")
                self.call_context["prospect_type"] = sim_prof.get("prospect_type", "cafe_owner")
                
                interview_cleanup = self.sim_config.get("interview_mode_cleanup", {})
                self.banned_sim_phrases = [p.replace("_", " ") for p in interview_cleanup.get("ban_phrases", [])]
                
                reject = self.sim_config.get("response_validation", {}).get("before_returning_response", {}).get("reject_if_contains", [])
                self.banned_sim_phrases.extend([p.replace("_", " ").lower() for p in reject])
'''
content = re.sub(pattern_init, replacement_init, content)

# 3. Inject sim_guardrails into system_content
pattern_system_content = r'(        context_str = ""\n\s*if self\.call_context:\n\s*context_str = "\\nCALL CONTEXT:\\n" \+ json\.dumps\(self\.call_context\)\n\n\s*avoid_goals = ", "\.join\(self\.last_goals\) if self\.last_goals else "None")'
replacement_system_content = r'''        context_str = ""
        if self.call_context:
            context_str = "\nCALL CONTEXT:\n" + json.dumps(self.call_context)

        sim_guardrails = ""
        if self.mode == "simulation" and self.sim_config:
            guard = self.sim_config.get("context_guardrail", {})
            allowed = ", ".join(guard.get("allowed_topics", []))
            forbidden = ", ".join(guard.get("forbidden_topics", []))
            
            sim_guardrails += f"\nSIMULATION MODE ACTIVE (STRICT ISOLATION)\n"
            sim_guardrails += f"Product: {self.call_context.get('product_name')}\n"
            sim_guardrails += f"Industry: {self.call_context.get('industry')}\n"
            sim_guardrails += f"Prospect: {self.call_context.get('prospect_type')}\n"
            sim_guardrails += f"Allowed Topics: {allowed}\n"
            sim_guardrails += f"Forbidden Topics: {forbidden}\n"
            sim_guardrails += "NEVER mention Hexagon_AI, Acme_Corp, machine_learning, AI_assistant, SaaS, software_platform, dashboard, or analytics.\n"
            sim_guardrails += "Every response MUST sound like a cafe_salesperson, NEVER like a SaaS_demo or AI_assistant.\n"
            sim_guardrails += "Preferred patterns: observation, perspective_shift, answer_first, concise_reframe, one_targeted_question.\n"

        avoid_goals = ", ".join(self.last_goals) if self.last_goals else "None"'''
content = re.sub(pattern_system_content, replacement_system_content, content)

pattern_inject_sim = r"(\{f'RAG HINTS: \{rag_context\}' if rag_context\.strip\(\) else ''\})"
replacement_inject_sim = r"\1\n{sim_guardrails}"
content = re.sub(pattern_inject_sim, replacement_inject_sim, content)


# 4. Filter logic in LLM response
pattern_filter = r'(                if any\(p in response_lower for p in BANNED_PATTERNS\):)'
replacement_filter = r'''                banned_total = BANNED_PATTERNS + (self.banned_sim_phrases if self.mode == "simulation" else [])
                if any(p in response_lower for p in banned_total):'''
content = re.sub(pattern_filter, replacement_filter, content)

with open(file_path, "w", encoding="utf-8") as f:
    f.write(content)

print("sales_ai_engine.py patched successfully to apply simulation yaml.")
