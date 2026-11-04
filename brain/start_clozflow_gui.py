import tkinter as tk
from tkinter import scrolledtext
import subprocess
import threading
import sys
import os
import webbrowser
import json
import time
import websocket
import matplotlib.pyplot as plt
from matplotlib.backends.backend_tkagg import FigureCanvasTkAgg
from collections import deque

from dotenv import load_dotenv
load_dotenv(os.path.join(os.path.dirname(__file__), ".env"))
BRAIN_PORT = int(os.getenv("CEB_PORT", "8010"))

ENGINE_MAPPING = {
    'copilot.compact': 'Local Copilot',
    'perception.concrete': 'PerceptionEngine',
    'understanding.concrete': 'UnderstandingEngine',
    'interpretation.concrete': 'InterpretationEngine',
    'prediction.concrete': 'PredictionEngine',
    'evaluation.concrete': 'EvaluationEngine',
    'planning.concrete': 'PlanningEngine',
    'decision.concrete': 'DecisionEngine',
    'verification.concrete': 'VerificationEngine',
    'recommendation.concrete': 'RecommendationEngine',
    'reflection.concrete': 'ReflectionEngine'
}

class TelemetryDashboard(tk.Toplevel):
    def __init__(self, master=None):
        super().__init__(master)
        self.title("Engine Telemetry Dashboard")
        self.geometry("1400x800")

        self.ws = None
        self.connected = False
        self.current_session_id = None
        self.engine_data = {}

        # UI Setup
        self.setup_ui()

        # Start websocket thread
        threading.Thread(target=self.connect_ws, daemon=True).start()

    def setup_ui(self):
        # Stats frame
        self.stats_frame = tk.Frame(self, bg="#2b2b2b")
        self.stats_frame.pack(fill=tk.X, padx=10, pady=10)
        self.lbl_status = tk.Label(self.stats_frame, text="Disconnected", fg="red", bg="#2b2b2b", font=("Helvetica", 12, "bold"))
        self.lbl_status.pack(side=tk.LEFT, padx=10)

        # Grid for engines
        self.grid_frame = tk.Frame(self)
        self.grid_frame.pack(fill=tk.BOTH, expand=True, padx=10, pady=10)

        for i, (engine_id, display_name) in enumerate(ENGINE_MAPPING.items()):
            row = i // 5
            col = i % 5

            panel = tk.Frame(self.grid_frame, bd=1, relief=tk.RIDGE)
            panel.grid(row=row, column=col, sticky="nsew", padx=5, pady=5)
            self.grid_frame.columnconfigure(col, weight=1)
            self.grid_frame.rowconfigure(row, weight=1)

            lbl = tk.Label(panel, text=display_name, font=("Helvetica", 9, "bold"))
            lbl.pack(side=tk.TOP, anchor="w", padx=2, pady=2)

            # Setup Matplotlib figure
            fig, ax1 = plt.subplots(figsize=(2, 1.5), dpi=80)
            ax2 = ax1.twinx()
            fig.patch.set_facecolor('#f0f0f0')
            ax1.set_facecolor('#f0f0f0')
            ax1.set_ylim(bottom=-1)
            ax2.set_ylim(0, 1)
            ax1.set_ylabel('Latency', fontsize=8, color='blue')
            ax2.set_ylabel('Confidence', fontsize=8, color='green')
            ax1.tick_params(axis='both', which='major', labelsize=7)
            ax2.tick_params(axis='both', which='major', labelsize=7)
            plt.tight_layout(pad=0.5)

            canvas = FigureCanvasTkAgg(fig, master=panel)
            canvas_widget = canvas.get_tk_widget()
            canvas_widget.pack(side=tk.TOP, fill=tk.BOTH, expand=True)

            # Log area
            log = scrolledtext.ScrolledText(panel, height=4, font=("Consolas", 7))
            log.pack(side=tk.BOTTOM, fill=tk.X)

            self.engine_data[engine_id] = {
                'latencies': deque(maxlen=20),
                'confidences': deque(maxlen=20),
                'fig': fig,
                'ax1': ax1,
                'ax2': ax2,
                'canvas': canvas,
                'log': log,
                'line1': None,
                'line2': None
            }

    def update_graph(self, engine_name, latency, confidence):
        data = self.engine_data.get(engine_name)
        if not data: return
        data['latencies'].append(latency)
        data['confidences'].append(confidence)

        ax1 = data['ax1']
        ax2 = data['ax2']
        if data['line1'] is None:
            data['line1'], = ax1.plot(range(len(data['latencies'])), data['latencies'], color='blue', linewidth=1, marker='o', markersize=3)
            data['line2'], = ax2.plot(range(len(data['confidences'])), data['confidences'], color='green', linewidth=1, marker='o', markersize=3)
        else:
            data['line1'].set_ydata(data['latencies'])
            data['line1'].set_xdata(range(len(data['latencies'])))
            data['line2'].set_ydata(data['confidences'])
            data['line2'].set_xdata(range(len(data['confidences'])))

            # Explicitly scale the y-axis for latency (ax1) since set_ydata doesn't auto-update limits properly when bottom=0
            if data['latencies']:
                max_lat = max(data['latencies'])
                # Use -max_lat*0.05 or -1 so 0 is always visible above the bottom line
                y_margin = max(max_lat * 0.05, 1)
                ax1.set_ylim(-y_margin, max(max_lat * 1.1, 10))

            ax1.relim()
            ax1.autoscale_view()
        data['canvas'].draw_idle()

    def connect_ws(self):
        def on_open(ws):
            self.master.after(0, lambda: self.lbl_status.config(text="Connected to Stream - Waiting for Session...", fg="orange"))
            return None

        def on_close(ws, *args):
            self.current_session_id = None
            self.master.after(0, lambda: self.lbl_status.config(text="Disconnected from Backend", fg="red"))
            return None

        while True:
            try:
                self.ws = websocket.WebSocketApp(
                    f"ws://127.0.0.1:{BRAIN_PORT}/v1/telemetry/stream",
                    on_open=on_open,
                    on_close=on_close,
                    on_message=self.on_message
                )
                self.ws.run_forever()
            except Exception:
                pass
            time.sleep(3)

    def on_message(self, ws, message):
        try:
            data = json.loads(message)
            if data.get("msg_type") == "HEARTBEAT":
                ws.send(json.dumps({"msg_type": "PONG"}))
                return

            event_type = data.get("event_type")
            session_id = data.get("session_id")

            if event_type == "FRONTEND_CONNECTED" and session_id:
                self.current_session_id = session_id
                self.master.after(0, self.reset_dashboard, session_id)

            elif event_type == "FRONTEND_DISCONNECTED" and session_id == self.current_session_id:
                self.current_session_id = None
                self.master.after(0, lambda: self.lbl_status.config(text="Connected to Stream - Waiting for Session...", fg="orange"))

            elif event_type == "ENGINE_TELEMETRY" and "payload" in data:
                if session_id and session_id != self.current_session_id:
                    self.current_session_id = session_id
                    self.master.after(0, self.reset_dashboard, session_id)

                payload = data["payload"]
                engine_name = payload.get("engine_id")
                if engine_name in self.engine_data:
                    self.master.after(0, self.update_dashboard, engine_name, payload)
        except Exception:
            pass

    def reset_dashboard(self, session_id):
        self.lbl_status.config(text=f"Session Active: {session_id}", fg="#4CAF50")
        for data in self.engine_data.values():
            data['latencies'].clear()
            data['confidences'].clear()
            if data['line1']:
                data['line1'].set_ydata([])
                data['line1'].set_xdata([])
                data['line2'].set_ydata([])
                data['line2'].set_xdata([])
                data['ax1'].relim()
                data['ax1'].autoscale_view()
            data['log'].delete(1.0, tk.END)
            data['canvas'].draw_idle()

    def update_dashboard(self, engine_name, payload):
        status = payload.get("status")
        latency = payload.get("duration_ms", 0)
        confidence = payload.get("confidence", 0)
        self.update_graph(engine_name, latency, confidence)

        # log
        log_widget = self.engine_data[engine_name]['log']
        log_widget.insert(tk.END, f"[{status}] Latency:{latency}ms Conf:{confidence:.2f}\n")
        log_widget.see(tk.END)

class EngineInspectorDashboard(tk.Toplevel):
    def __init__(self, master=None):
        super().__init__(master)
        self.title("Engine Output Inspector")
        self.geometry("1400x800")

        self.ws = None
        self.connected = False
        self.current_session_id = None
        self.engine_panels = {}

        self.setup_ui()
        threading.Thread(target=self.connect_ws, daemon=True).start()

    def setup_ui(self):
        self.stats_frame = tk.Frame(self, bg="#2b2b2b")
        self.stats_frame.pack(fill=tk.X, padx=10, pady=10)
        self.lbl_status = tk.Label(self.stats_frame, text="Disconnected", fg="red", bg="#2b2b2b", font=("Helvetica", 12, "bold"))
        self.lbl_status.pack(side=tk.LEFT, padx=10)

        self.grid_frame = tk.Frame(self)
        self.grid_frame.pack(fill=tk.BOTH, expand=True, padx=10, pady=10)

        row, col = 0, 0
        for engine_id, display_name in ENGINE_MAPPING.items():
            if col == 5:
                col = 0
                row += 1

            panel = tk.Frame(self.grid_frame, bd=1, relief=tk.RIDGE)
            panel.grid(row=row, column=col, sticky="nsew", padx=5, pady=5)
            self.grid_frame.columnconfigure(col, weight=1)
            self.grid_frame.rowconfigure(row, weight=1)

            lbl = tk.Label(panel, text=display_name, font=("Helvetica", 10, "bold"), fg="#8b5cf6")
            lbl.pack(side=tk.TOP, anchor="w", padx=2, pady=2)

            text_area = scrolledtext.ScrolledText(panel, height=10, font=("Consolas", 8), bg="#1e1e1e", fg="#d4d4d4", wrap=tk.WORD)
            text_area.pack(side=tk.TOP, fill=tk.BOTH, expand=True)
            text_area.insert(tk.END, "Waiting for engine execution...\n")

            self.engine_panels[engine_id] = text_area
            col += 1

    def connect_ws(self):
        def on_open(ws):
            self.master.after(0, lambda: self.lbl_status.config(text="Connected to Stream - Waiting for Session...", fg="orange"))
            return None

        def on_close(ws, *args):
            self.current_session_id = None
            self.master.after(0, lambda: self.lbl_status.config(text="Disconnected from Backend", fg="red"))
            return None

        while True:
            try:
                self.ws = websocket.WebSocketApp(
                    f"ws://127.0.0.1:{BRAIN_PORT}/v1/telemetry/stream",
                    on_open=on_open,
                    on_close=on_close,
                    on_message=self.on_message
                )
                self.ws.run_forever()
            except Exception:
                pass
            time.sleep(3)

    def on_message(self, ws, message):
        try:
            data = json.loads(message)
            if data.get("msg_type") == "HEARTBEAT":
                ws.send(json.dumps({"msg_type": "PONG"}))
                return

            event_type = data.get("event_type")
            session_id = data.get("session_id")

            if event_type == "FRONTEND_CONNECTED" and session_id:
                self.current_session_id = session_id
                self.master.after(0, self.reset_dashboard, session_id)

            elif event_type == "FRONTEND_DISCONNECTED" and session_id == self.current_session_id:
                self.current_session_id = None
                self.master.after(0, lambda: self.lbl_status.config(text="Connected to Stream - Waiting for Session...", fg="orange"))

            elif event_type == "ENGINE_TELEMETRY" and "payload" in data:
                if session_id and session_id != self.current_session_id:
                    self.current_session_id = session_id
                    self.master.after(0, self.reset_dashboard, session_id)

                payload = data["payload"]
                engine_name = payload.get("engine_id")
                if engine_name in self.engine_panels:
                    self.master.after(0, self.update_dashboard, engine_name, payload)
        except Exception:
            pass

    def reset_dashboard(self, session_id):
        self.lbl_status.config(text=f"Session Active: {session_id}", fg="#4CAF50")
        for text_area in self.engine_panels.values():
            text_area.delete(1.0, tk.END)
            text_area.insert(tk.END, "Waiting for engine execution...\n")

    def update_dashboard(self, engine_name, payload):
        text_area = self.engine_panels[engine_name]
        mutations = payload.get("wm_mutations", [])
        events = payload.get("output_events", [])
        reasoning = payload.get("reasoning_trace", "")

        # Parse all mutation payloads upfront
        parsed = []
        for m in mutations:
            p = m.get("payload", {})
            if isinstance(p, str):
                try:
                    p = json.loads(p)
                except Exception:
                    pass
            parsed.append({"type": m.get("mutation_type", ""), "data": p if isinstance(p, dict) else {}})

        # Parse event payloads
        parsed_events = []
        for e in events:
            p = e.get("payload", {})
            if isinstance(p, str):
                try:
                    p = json.loads(p)
                except Exception:
                    pass
            parsed_events.append({"type": e.get("event_type", ""), "data": p if isinstance(p, dict) else {}})

        result = self._format_engine_result(engine_name, parsed, parsed_events, reasoning)
        text_area.delete(1.0, tk.END)
        text_area.insert(tk.END, result)

    def _format_engine_result(self, engine_name, mutations, events, reasoning):
        lines = []
        for m in mutations:
            type_str = m.get("type", "")
            data = m.get("data", {})

            if type_str == "APPEND_CONTEXT":
                text = data.get("text", "")
                lines.append(f"[APPEND_CONTEXT] Cleaned Signal:\n\"{text}\"")
                continue

            bt = data.get("belief_type", "")
            if type_str == "UPSERT_BELIEF" and bt:
                lines.append(f"[{bt}]")
                val = data.get("value", {})
                if isinstance(val, str):
                    try:
                        val = json.loads(val)
                    except Exception:
                        lines.append(f"  {val}")
                        continue

                if isinstance(val, dict):
                    for k, v in val.items():
                        if isinstance(v, float):
                            lines.append(f"  {k}: {v:.2f}")
                        elif isinstance(v, list):
                            lines.append(f"  {k}: {', '.join(map(str, v))}")
                        else:
                            lines.append(f"  {k}: {v}")
                elif isinstance(val, list):
                    lines.append(f"  {', '.join(map(str, val))}")
                else:
                    lines.append(f"  {val}")
            elif type_str == "UPDATE_PHASE":
                lines.append(f"[UPDATE_PHASE] Phase: {data.get('phase', '')}")
            else:
                # Fallback for other mutations
                if isinstance(data, dict):
                    for k, v in data.items():
                        if k not in ['belief_type', 'subject', 'confidence']:
                            lines.append(f"  {k}: {v}")

        # Fallback for events if no mutations
        if not mutations:
            for e in events:
                type_str = e.get("type", "")
                data = e.get("data", {})
                lines.append(f"[{type_str}]")
                if isinstance(data, dict):
                    for k, v in data.items():
                        lines.append(f"  {k}: {v}")
                else:
                    lines.append(f"  {data}")

        if reasoning:
            lines.append(f"\n[Reasoning]\n{reasoning}")

        return "\n".join(lines) if lines else "No results."

_instance_lock = None


def enforce_single_instance():
    """Hold an OS file lock; never terminate an arbitrary process from a stale PID."""
    global _instance_lock
    import msvcrt
    from pathlib import Path
    from tkinter import messagebox
    path = Path(__file__).resolve().parent / "gui.pid"
    _instance_lock = path.open("a+b")
    _instance_lock.seek(0)
    if path.stat().st_size == 0:
        _instance_lock.write(b"0")
        _instance_lock.flush()
    _instance_lock.seek(0)
    try:
        msvcrt.locking(_instance_lock.fileno(), msvcrt.LK_NBLCK, 1)
    except OSError:
        messagebox.showerror("ClozFlow", "The ClozFlow launcher is already open.")
        raise SystemExit(1)


def start_backend():
    # Start the Brain on its configured port
    # Uvicorn reports an occupied port without terminating its owner.

    # Set up the command to run uvicorn
    # Use unbuffered output so we get logs immediately
    env = os.environ.copy()
    env["PYTHONUNBUFFERED"] = "1"
    env.setdefault("CEB_STORAGE_PROFILE", "durable")

    # We want to run the FastAPI app via the create_app factory
    cmd = [sys.executable, "-m", "uvicorn", "clozflow_brain.api.main:create_app", "--factory", "--host", "127.0.0.1", "--port", str(BRAIN_PORT)]

    # Get the project root directory (the directory containing this script)
    cwd = os.path.dirname(os.path.abspath(__file__))

    process = subprocess.Popen(
        cmd,
        cwd=cwd,
        env=env,
        stdout=subprocess.PIPE,
        stderr=subprocess.STDOUT,
        text=True,
        bufsize=1
    )
    return process

def run_gui():
    enforce_single_instance()

    root = tk.Tk()
    root.title("Clozflow Enterprise Brain - Backend Server")
    root.geometry("800x600")

    # Configure grid weights
    root.grid_columnconfigure(0, weight=1)
    root.grid_rowconfigure(1, weight=1)

    # Top frame with title and button
    top_frame = tk.Frame(root, padx=10, pady=10)
    top_frame.grid(row=0, column=0, sticky="ew")

    lbl = tk.Label(top_frame, text="Clozflow Brain Backend is Running", font=("Helvetica", 14, "bold"))
    lbl.pack(side=tk.LEFT)

    def open_ui():
        webbrowser.open(f"http://127.0.0.1:{BRAIN_PORT}/ui")

    def open_telemetry():
        TelemetryDashboard(root)

    def open_inspector():
        EngineInspectorDashboard(root)

    def open_both():
        open_ui()
        # Small delay to ensure they open in separate tabs cleanly
        root.after(200, open_telemetry)
        root.after(400, open_inspector)

    btn_both = tk.Button(top_frame, text="Open All", command=open_both, bg="#FF9800", fg="white", font=("Helvetica", 10, "bold"))
    btn_both.pack(side=tk.RIGHT, padx=5)

    btn_ins = tk.Button(top_frame, text="Open Inspector", command=open_inspector, bg="#9C27B0", fg="white", font=("Helvetica", 10, "bold"))
    btn_ins.pack(side=tk.RIGHT, padx=5)

    btn_tel = tk.Button(top_frame, text="Open Telemetry", command=open_telemetry, bg="#2196F3", fg="white", font=("Helvetica", 10, "bold"))
    btn_tel.pack(side=tk.RIGHT, padx=5)

    btn_ui = tk.Button(top_frame, text="Open Frontend", command=open_ui, bg="#4CAF50", fg="white", font=("Helvetica", 10, "bold"))
    btn_ui.pack(side=tk.RIGHT, padx=5)

    # Text area for logs
    log_area = scrolledtext.ScrolledText(root, wrap=tk.WORD, bg="black", fg="lightgreen", font=("Consolas", 10))
    log_area.grid(row=1, column=0, sticky="nsew", padx=10, pady=(0, 10))

    # Start the backend process
    process = start_backend()

    def read_output():
        if process.stdout:
            for line in iter(process.stdout.readline, ''):
                if line:
                    root.after(0, lambda text=line: (log_area.insert(tk.END, text), log_area.see(tk.END)))

                    # Automatically open the browsers once Uvicorn is ready
                    if "Application startup complete" in line:
                        root.after(500, open_both)

            process.stdout.close()
        process.wait()

    # Read backend output in a background thread
    threading.Thread(target=read_output, daemon=True).start()

    def on_closing():
        if process.poll() is None:
            process.terminate()
        root.destroy()

    root.protocol("WM_DELETE_WINDOW", on_closing)
    root.mainloop()

if __name__ == "__main__":
    run_gui()
