"""
Evaluation Report Generator.
Generates comprehensive Markdown, HTML dashboards, JSON metrics, and CSV matrices
from completed evaluation runs with detailed failure analysis.
"""
import os
import json
import csv
from datetime import datetime
from pathlib import Path
from typing import Dict, Any, List, Optional


class ReportGenerator:
    """
    Renders multi-format evaluation reports and failure diagnostic reports.
    """

    def __init__(self, reports_dir: Optional[Path] = None):
        self.reports_dir = reports_dir or (Path(__file__).parent.parent / "reports").resolve()
        self.reports_dir.mkdir(parents=True, exist_ok=True)

    def generate_all(self, suite_summary: Dict[str, Any], output_prefix: str = "eval_report") -> Dict[str, Path]:
        """Generates Markdown, HTML, JSON, and CSV artifacts in the reports folder."""
        paths = {
            "markdown": self.generate_markdown(suite_summary, f"{output_prefix}.md"),
            "html": self.generate_html(suite_summary, f"{output_prefix}.html"),
            "json": self.generate_json(suite_summary, f"{output_prefix}.json"),
            "csv": self.generate_csv(suite_summary, f"{output_prefix}.csv")
        }
        return paths

    def generate_json(self, summary: Dict[str, Any], filename: str = "metrics.json") -> Path:
        out = self.reports_dir / filename
        with open(out, "w", encoding="utf-8") as f:
            json.dump(summary, f, indent=2)
        return out

    def generate_csv(self, summary: Dict[str, Any], filename: str = "scenario_matrix.csv") -> Path:
        out = self.reports_dir / filename
        scenarios = summary.get("scenario_results", [])
        fieldnames = ["scenario_id", "title", "category", "score", "passed", "turns_count", "duration_seconds", "failures"]
        
        with open(out, "w", newline="", encoding="utf-8") as f:
            writer = csv.DictWriter(f, fieldnames=fieldnames)
            writer.writeheader()
            for sc in scenarios:
                row = dict(sc)
                row["failures"] = "; ".join(row.get("failures", []))
                writer.writerow(row)
        return out

    def generate_markdown(self, summary: Dict[str, Any], filename: str = "SUMMARY.md") -> Path:
        out = self.reports_dir / filename
        m = summary.get("metrics", {})
        scenarios = summary.get("scenario_results", [])

        lines = [
            "# Pearl Evaluation Lab — Executive Benchmark Report",
            "",
            f"**Suite ID:** `{summary.get('suite_id')}`  ",
            f"**Adapter Mode:** `{summary.get('adapter')}`  ",
            f"**Timestamp:** `{summary.get('started_at')}`  ",
            f"**Total Scenarios Evaluated:** {summary.get('total_scenarios')}  ",
            f"**Passed Scenarios:** {summary.get('passed_scenarios')} ({round((summary.get('passed_scenarios', 0) / max(1, summary.get('total_scenarios', 1))) * 100, 1)}%)  ",
            "",
            "---",
            "",
            "## 1. Overall Pearl Quality Index (PQI)",
            "",
            f"### **PQI Score: {m.get('pqi', 0.0)} / 100.0 (Grade: {m.get('grade', 'N/A')})**",
            f"**Pass Rate:** {m.get('pass_rate_pct', 0.0)}%  ",
            f"**Overall Status:** `{'PASSED' if m.get('passed') else 'FAILED'}`",
            "",
            "---",
            "",
            "## 2. Dimension Scorecard",
            "",
            "| Dimension | Weight | Mean Score | Pass Rate | Target Threshold | Status |",
            "| :--- | :--- | :--- | :--- | :--- | :--- |"
        ]

        for dim, info in m.get("dimension_scores", {}).items():
            status = "PASS" if info["mean_score"] >= info["threshold"] else "FAIL"
            lines.append(f"| **{dim}** | {info['weight_pct']}% | {info['mean_score']} | {info['pass_rate_pct']}% | {info['threshold']} | `{status}` |")

        lines.extend([
            "",
            "---",
            "",
            "## 3. Failure Diagnostics & Root Cause Analysis",
            ""
        ])

        failures_found = [s for s in scenarios if not s.get("passed")]
        if not failures_found:
            lines.append("No scenario failures detected! All tested scenarios passed quality gates.")
        else:
            lines.append(f"Detected **{len(failures_found)}** scenarios requiring investigation:")
            lines.append("")
            lines.append("| Scenario ID | Title | Category | Score | Detected Failure Types |")
            lines.append("| :--- | :--- | :--- | :--- | :--- |")
            for fail in failures_found:
                fail_types = ", ".join(fail.get("failures", [])) or "threshold_shortfall"
                lines.append(f"| `{fail['scenario_id']}` | {fail['title']} | {fail['category']} | {fail['score']} | `{fail_types}` |")

        lines.extend([
            "",
            "---",
            "",
            "## 4. Scenario Execution Matrix",
            "",
            "| ID | Category | Title | Score | Status | Turns | Duration |",
            "| :--- | :--- | :--- | :--- | :--- | :--- | :--- |"
        ])

        for sc in scenarios:
            st = "PASS" if sc["passed"] else "FAIL"
            lines.append(f"| `{sc['scenario_id']}` | {sc['category']} | {sc['title']} | {sc['score']} | `{st}` | {sc['turns_count']} | {sc['duration_seconds']}s |")

        lines.append("")
        with open(out, "w", encoding="utf-8") as f:
            f.write("\n".join(lines))
        return out

    def generate_html(self, summary: Dict[str, Any], filename: str = "dashboard.html") -> Path:
        out = self.reports_dir / filename
        m = summary.get("metrics", {})
        scenarios = summary.get("scenario_results", [])
        pqi = m.get("pqi", 0.0)
        grade = m.get("grade", "F")

        grade_color = "#10b981" if grade in ["A+", "A"] else ("#f59e0b" if grade == "B" else "#ef4444")

        rows_html = ""
        for sc in scenarios:
            st_color = "#10b981" if sc["passed"] else "#ef4444"
            st_badge = "PASS" if sc["passed"] else "FAIL"
            rows_html += f"""
            <tr>
                <td><code>{sc['scenario_id']}</code></td>
                <td>{sc['category']}</td>
                <td>{sc['title']}</td>
                <td><b>{sc['score']}</b></td>
                <td><span style="background:{st_color}22; color:{st_color}; padding:4px 8px; border-radius:4px; font-weight:600;">{st_badge}</span></td>
                <td>{sc['turns_count']}</td>
                <td>{sc['duration_seconds']}s</td>
            </tr>
            """

        dim_html = ""
        for dim, info in m.get("dimension_scores", {}).items():
            dim_html += f"""
            <div style="background:#f8fafc; border:1px solid #e2e8f0; border-radius:8px; padding:12px; margin-bottom:8px;">
                <div style="display:flex; justify-content:space-between; margin-bottom:4px;">
                    <span style="font-weight:600; text-transform:capitalize;">{dim.replace('_', ' ')}</span>
                    <span style="font-weight:700;">{info['mean_score']} / 100</span>
                </div>
                <div style="background:#e2e8f0; height:8px; border-radius:4px; overflow:hidden;">
                    <div style="background:#3b82f6; width:{info['mean_score']}%; height:100%;"></div>
                </div>
                <div style="font-size:12px; color:#64748b; margin-top:4px;">Weight: {info['weight_pct']}% | Pass Rate: {info['pass_rate_pct']}%</div>
            </div>
            """

        html_content = f"""<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <title>Pearl Evaluation Lab — Benchmark Dashboard</title>
    <style>
        body {{ font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; background: #0f172a; color: #f8fafc; margin: 0; padding: 24px; }}
        .container {{ max-width: 1200px; margin: 0 auto; }}
        .card {{ background: #1e293b; border: 1px solid #334155; border-radius: 12px; padding: 24px; margin-bottom: 24px; }}
        .header {{ display: flex; justify-content: space-between; align-items: center; }}
        .pqi-pill {{ font-size: 36px; font-weight: 800; color: {grade_color}; }}
        table {{ width: 100%; border-collapse: collapse; margin-top: 16px; font-size: 14px; }}
        th, td {{ padding: 10px 12px; text-align: left; border-bottom: 1px solid #334155; }}
        th {{ background: #0f172a; color: #94a3b8; text-transform: uppercase; font-size: 11px; letter-spacing: 0.05em; }}
        code {{ background: #0f172a; padding: 2px 6px; border-radius: 4px; font-family: monospace; color: #38bdf8; }}
    </style>
</head>
<body>
    <div class="container">
        <div class="card header">
            <div>
                <h1 style="margin:0 0 8px 0; font-size:24px;">Pearl Evaluation Lab</h1>
                <div style="color:#94a3b8;">Standalone AI Benchmark Dashboard &bull; Suite: <code>{summary.get('suite_id')}</code></div>
            </div>
            <div style="text-align:right;">
                <div style="font-size:12px; text-transform:uppercase; color:#94a3b8; letter-spacing:1px;">Pearl Quality Index</div>
                <div class="pqi-pill">{pqi} <span style="font-size:24px;">({grade})</span></div>
            </div>
        </div>

        <div style="display:grid; grid-template-columns: 1fr 2fr; gap: 24px;">
            <div class="card">
                <h3 style="margin-top:0;">Dimensions</h3>
                {dim_html}
            </div>

            <div class="card">
                <h3 style="margin-top:0;">Scenario Matrix ({len(scenarios)} Runs)</h3>
                <table>
                    <thead>
                        <tr>
                            <th>ID</th>
                            <th>Category</th>
                            <th>Title</th>
                            <th>Score</th>
                            <th>Status</th>
                            <th>Turns</th>
                            <th>Duration</th>
                        </tr>
                    </thead>
                    <tbody>
                        {rows_html}
                    </tbody>
                </table>
            </div>
        </div>
    </div>
</body>
</html>"""

        with open(out, "w", encoding="utf-8") as f:
            f.write(html_content)
        return out
