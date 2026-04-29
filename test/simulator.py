import os
import sys
import json
import asyncio
from datetime import datetime
from reportlab.platypus import SimpleDocTemplate, Paragraph, Spacer, HRFlowable
from reportlab.lib.styles import getSampleStyleSheet, ParagraphStyle
from reportlab.lib import colors

# --- Path setup: allow importing from backend/services ---
BASE_DIR = os.path.dirname(os.path.abspath(__file__))
PROJECT_ROOT = os.path.dirname(BASE_DIR)
BACKEND_SERVICES = os.path.join(PROJECT_ROOT, "backend", "services")
RAG_DIR = os.path.join(PROJECT_ROOT, "rag")

# --- Load backend/.env BEFORE importing engine (so Groq API key is set) ---
ENV_PATH = os.path.join(PROJECT_ROOT, "backend", ".env")
try:
    from dotenv import load_dotenv
    load_dotenv(ENV_PATH)
    print(f"[ENV] Loaded via python-dotenv: {ENV_PATH}")
except ImportError:
    # Fallback: manual parse if python-dotenv not installed
    if os.path.exists(ENV_PATH):
        with open(ENV_PATH, "r") as _f:
            for _line in _f:
                _line = _line.strip()
                if _line and not _line.startswith("#") and "=" in _line:
                    _k, _v = _line.split("=", 1)
                    os.environ.setdefault(_k.strip(), _v.strip())
        print(f"[ENV] Loaded manually: {ENV_PATH}")

_groq_key = os.getenv("OPENAI_API_KEY", "")
print(f"[ENV] OPENAI_API_KEY (Groq) loaded: {'YES (' + _groq_key[:8] + '...)' if _groq_key else 'NO - fallback will activate'}")

sys.path.insert(0, BACKEND_SERVICES)
sys.path.insert(0, PROJECT_ROOT)

from sales_ai_engine import SalesAIEngine

REPORT_DIR = os.path.join(PROJECT_ROOT, "test_reports")
os.makedirs(REPORT_DIR, exist_ok=True)



def generate_pdf(scenario_name: str, report_data: list, filename: str):
    styles = getSampleStyleSheet()

    title_style = ParagraphStyle(
        "SimTitle",
        parent=styles["Title"],
        fontSize=16,
        spaceAfter=6,
    )
    label_style = ParagraphStyle(
        "Label",
        parent=styles["Normal"],
        fontSize=9,
        textColor=colors.HexColor("#555555"),
        spaceAfter=2,
    )
    value_style = ParagraphStyle(
        "Value",
        parent=styles["Normal"],
        fontSize=10,
        spaceAfter=4,
    )
    warn_style = ParagraphStyle(
        "Warn",
        parent=styles["Normal"],
        fontSize=9,
        textColor=colors.HexColor("#cc0000"),
    )

    doc = SimpleDocTemplate(filename, rightMargin=50, leftMargin=50, topMargin=50, bottomMargin=50)
    content = []

    content.append(Paragraph("Klyro Test Simulation Report", title_style))
    content.append(Paragraph(f"Scenario: {scenario_name}", styles["Heading2"]))
    content.append(Paragraph(f"Generated: {datetime.now().strftime('%Y-%m-%d %H:%M:%S')}", label_style))
    content.append(Spacer(1, 14))

    for i, entry in enumerate(report_data, 1):
        content.append(Paragraph(f"Turn {i}", styles["Heading3"]))
        content.append(HRFlowable(width="100%", thickness=0.5, color=colors.HexColor("#dddddd")))
        content.append(Spacer(1, 4))

        content.append(Paragraph("Prospect:", label_style))
        content.append(Paragraph(entry["input"], value_style))

        if entry["output"]:
            out = entry["output"]
            content.append(Paragraph("Strategy:", label_style))
            content.append(Paragraph(str(out.get("strategy", "—")), value_style))

            content.append(Paragraph("Intent:", label_style))
            content.append(Paragraph(str(out.get("intent", "—")), value_style))

            content.append(Paragraph("Stage:", label_style))
            content.append(Paragraph(str(out.get("stage", "—")), value_style))

            content.append(Paragraph("Response:", label_style))
            content.append(Paragraph(str(out.get("response", "—")), value_style))

            content.append(Paragraph("Next Question:", label_style))
            content.append(Paragraph(str(out.get("next_question", "—")), value_style))

            content.append(Paragraph("Coaching Tip:", label_style))
            content.append(Paragraph(str(out.get("coaching_tip", "—")), value_style))

            content.append(Paragraph("Confidence:", label_style))
            content.append(Paragraph(str(out.get("confidence", "—")), value_style))
        else:
            content.append(Paragraph("AI: No response triggered (skipped or cooldown)", warn_style))

        content.append(Spacer(1, 16))

    doc.build(content)


async def run_simulation():
    engine = SalesAIEngine(
        call_context={
            "business": "AI SaaS",
            "goal": "increase conversions"
        }
    )

    scenarios_path = os.path.join(BASE_DIR, "scenarios.json")
    with open(scenarios_path, "r") as f:
        scenarios = json.load(f)

    for scenario in scenarios:
        print(f"\n{'='*50}")
        print(f"=== Running Scenario: {scenario['name']} ===")
        print(f"{'='*50}")

        # Reset engine state between scenarios
        engine.message_buffer = []
        engine.response_history = []
        engine.last_strategies = []
        engine.deal_state = {
            "stage": "discovery",
            "last_intent": None,
            "objections_handled": [],
            "pressure_level": 1
        }
        engine._last_call_time = 0.0

        report_data = []

        for msg in scenario["messages"]:
            print(f"\nProspect: {msg}")

            result = await engine.analyze("prospect", msg)

            print("---- DEBUG ----")
            print("Input       :", msg)
            print("Output      :", json.dumps(result, indent=2) if result else "None")

            report_data.append({
                "input": msg,
                "output": result
            })

            # Small gap to avoid cooldown blocking all turns
            await asyncio.sleep(2.1)

        timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
        safe_name = scenario["name"].replace(" ", "_").replace("+", "and")
        filename = os.path.join(REPORT_DIR, f"{safe_name}_{timestamp}.pdf")

        generate_pdf(scenario["name"], report_data, filename)
        print(f"\n[REPORT GENERATED] {filename}")

    print(f"\n\n[DONE] All scenarios complete. Reports saved to: {REPORT_DIR}")


if __name__ == "__main__":
    asyncio.run(run_simulation())
