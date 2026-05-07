id: hexagon_test_simulator_v1

PROJECT: Hexagon Offline Testing + Debug System

GOAL:
  Simulate conversations without real calls,
  log full AI behavior,
  generate structured PDF reports for analysis.

---

DEPENDENCIES:

  install:
    - reportlab
    - asyncio

---

FOLDER_STRUCTURE:

  /test/
    - simulator.py
    - scenarios.json
  /test_reports/
    (auto-created)

---

STEP_1_SCENARIO_FILE:

  file: test/scenarios.json

  example:

    [
      {
        "name": "Pricing + Trust Combo",
        "messages": [
          "yeah pricing feels a bit high honestly",
          "we tried something similar before and it didn’t work",
          "not sure if this will work for us"
        ]
      },
      {
        "name": "Authority Delay",
        "messages": [
          "i need to talk to my partner",
          "he usually questions ROI a lot",
          "we don’t decide quickly"
        ]
      }
    ]

---

STEP_2_SIMULATOR:

  file: test/simulator.py

  code: |

    import os
    import json
    import asyncio
    from datetime import datetime
    from reportlab.platypus import SimpleDocTemplate, Paragraph, Spacer
    from reportlab.lib.styles import getSampleStyleSheet

    from sales_ai_engine import SalesAIEngine

    REPORT_DIR = "test_reports"

    os.makedirs(REPORT_DIR, exist_ok=True)

    def generate_pdf(report_data, filename):
        styles = getSampleStyleSheet()
        doc = SimpleDocTemplate(filename)

        content = []

        content.append(Paragraph("Hexagon Test Simulation Report", styles["Title"]))
        content.append(Spacer(1, 10))

        for entry in report_data:
            content.append(Paragraph(f"Prospect: {entry['input']}", styles["Normal"]))
            content.append(Spacer(1, 6))

            if entry["output"]:
                out = entry["output"]

                content.append(Paragraph(f"Strategy: {out.get('strategy')}", styles["Normal"]))
                content.append(Paragraph(f"Intent: {out.get('intent')}", styles["Normal"]))
                content.append(Paragraph(f"Response: {out.get('response')}", styles["Normal"]))
                content.append(Paragraph(f"Next Q: {out.get('next_question')}", styles["Normal"]))
            else:
                content.append(Paragraph("AI: No response triggered", styles["Normal"]))

            content.append(Spacer(1, 12))

        doc.build(content)


    async def run_simulation():
        engine = SalesAIEngine(
            call_context={
                "business": "AI SaaS",
                "goal": "increase conversions"
            }
        )

        with open("test/scenarios.json", "r") as f:
            scenarios = json.load(f)

        for scenario in scenarios:
            print(f"\n=== Running: {scenario['name']} ===")

            report_data = []

            for msg in scenario["messages"]:
                print(f"\nProspect: {msg}")

                result = await engine.analyze("prospect", msg)

                print("---- DEBUG ----")
                print("Input:", msg)
                print("Output:", result)

                report_data.append({
                    "input": msg,
                    "output": result
                })

            timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
            filename = f"{REPORT_DIR}/{scenario['name'].replace(' ', '_')}_{timestamp}.pdf"

            generate_pdf(report_data, filename)

            print(f"\n[REPORT GENERATED] {filename}")


    if __name__ == "__main__":
        asyncio.run(run_simulation())

---

STEP_3_DEBUGGING:

  add_in_engine (optional but recommended):

    print("\n=== DEBUG INFO ===")
    print("Transcript:", text)
    print("RAG Results:", rag_results)
    print("Chosen Strategy:", final_strategy)
    print("Deal State:", self.deal_state)

---

STEP_4_RUN:

  command:

    python test/simulator.py

---

OUTPUT:

  - Console debug logs
  - PDF reports in /test_reports/

---

SUCCESS_CRITERIA:

  - No audio needed
  - Deterministic testing
  - Full visibility into:
      - strategy
      - intent
      - response
      - RAG behavior
  - Clean downloadable reports

---

OPTIONAL_UPGRADES:

  - add scoring system (good/bad response)
  - add repetition detection in report
  - add latency tracking
  - add tone display

---

WARNINGS:

  - DO NOT connect this to live system
  - DO NOT mix with streaming logic
  - keep this isolated for debugging only