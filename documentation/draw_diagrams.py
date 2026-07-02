import os
import math
from PIL import Image, ImageDraw, ImageFont

# Ensure directory exists
os.makedirs("documentation/assets", exist_ok=True)

# ── Color Palette ────────────────────────────────────────────────────────────
BG_COLOR = "#F8FAFC"        # Slate 50 (Very light gray-blue)
DOT_COLOR = "#E2E8F0"       # Slate 200 (Subtle grid dots)
SHADOW_COLOR = "#E2E8F0"    # Drop shadow
TEXT_DARK = "#0F172A"       # Slate 900
TEXT_MUTED = "#475569"      # Slate 600

# Brand Colors (Vibrant but professional)
BRAND_PRIMARY = "#635BFF"   # Stripe Indigo (Main servers/core modules)
BRAND_PRIMARY_BG = "#EEF2FF"
BRAND_ACCENT = "#0EA5E9"    # Sky Blue (Extensions/Ingress)
BRAND_ACCENT_BG = "#F0F9FF"
BRAND_SUCCESS = "#10B981"   # Emerald (Databases/Stores)
BRAND_SUCCESS_BG = "#ECFDF5"
BRAND_WARNING = "#F59E0B"   # Amber (ML layers/classifiers)
BRAND_WARNING_BG = "#FFFBEB"
BRAND_DANGER = "#F43F5E"    # Rose (Objections/Alerts)
BRAND_DANGER_BG = "#FFF1F2"
WHITE = "#FFFFFF"
BORDER_GRAY = "#CBD5E1"     # Slate 300

# Fonts
font_title = ImageFont.truetype("C:\\Windows\\Fonts\\segoeuib.ttf", 24)
font_subtitle = ImageFont.truetype("C:\\Windows\\Fonts\\segoeui.ttf", 14)
font_node_title = ImageFont.truetype("C:\\Windows\\Fonts\\segoeuib.ttf", 14)
font_node_body = ImageFont.truetype("C:\\Windows\\Fonts\\segoeui.ttf", 11)
font_arrow = ImageFont.truetype("C:\\Windows\\Fonts\\segoeui.ttf", 10)
font_legend = ImageFont.truetype("C:\\Windows\\Fonts\\segoeuib.ttf", 11)

def draw_grid_background(draw, width, height):
    draw.rectangle((0, 0, width, height), fill=BG_COLOR)
    grid_size = 40
    for x in range(0, width, grid_size):
        for y in range(0, height, grid_size):
            draw.ellipse((x-1.5, y-1.5, x+1.5, y+1.5), fill=DOT_COLOR)

def draw_arrow(draw, start, end, label="", color="#475569", width=2, font=font_arrow):
    x1, y1 = start
    x2, y2 = end
    draw.line([x1, y1, x2, y2], fill=color, width=width)
    
    # Arrowhead
    angle = math.atan2(y2 - y1, x2 - x1)
    arrow_len = 10
    px1 = x2 - arrow_len * math.cos(angle - math.pi/6)
    py1 = y2 - arrow_len * math.sin(angle - math.pi/6)
    px2 = x2 - arrow_len * math.cos(angle + math.pi/6)
    py2 = y2 - arrow_len * math.sin(angle + math.pi/6)
    draw.polygon([x2, y2, px1, py1, px2, py2], fill=color)
    
    if label:
        mx = (x1 + x2) / 2
        my = (y1 + y2) / 2 - 12
        draw.text((mx+1, my+1), label, font=font, fill="#FFFFFF", anchor="mm")
        draw.text((mx, my), label, font=font, fill=color, anchor="mm")

def draw_node(draw, x, y, w, h, title, body="", fill=WHITE, outline=BORDER_GRAY, title_color=TEXT_DARK, body_color=TEXT_MUTED, border_width=1.5):
    # Shadow
    draw.rounded_rectangle((x+3, y+3, x+w+3, y+h+3), radius=8, fill=SHADOW_COLOR)
    # Main Card
    draw.rounded_rectangle((x, y, x+w, y+h), radius=8, fill=fill, outline=outline, width=int(border_width))
    # Title
    if body:
        draw.text((x + w/2, y + 18), title, font=font_node_title, fill=title_color, anchor="mm")
        lines = body.split("\n")
        start_y = y + 42
        for i, line in enumerate(lines):
            draw.text((x + w/2, start_y + i*15), line, font=font_node_body, fill=body_color, anchor="mm")
    else:
        draw.text((x + w/2, y + h/2), title, font=font_node_title, fill=title_color, anchor="mm")

def draw_header(draw, title, subtitle):
    draw.text((50, 30), title, font=font_title, fill=TEXT_DARK)
    draw.text((50, 65), subtitle, font=font_subtitle, fill=TEXT_MUTED)
    draw.line([50, 95, 1150, 95], fill=BORDER_GRAY, width=1)

def save_diagram(img, name):
    path = f"documentation/assets/{name}"
    img.save(path, "PNG")
    print(f"Generated diagram: {path}")

# ── 1. Overall System Architecture ───────────────────────────────────────────
def make_diag_overall_arch():
    img = Image.new("RGB", (1200, 700), BG_COLOR)
    draw = ImageDraw.Draw(img)
    draw_grid_background(draw, 1200, 700)
    draw_header(draw, "Overall System Architecture", "Dual-Engine ML-LLM Real-time Sales Intelligence Architecture")

    draw_node(draw, 50, 220, 240, 200, "Chrome Extension", 
              "Manifest V3 Content Script\n& Sidebar UI (React)\nCaptures DOM inputs\nWhatsApp/LinkedIn/Gmail/Outlook\nWS connection manager", 
              fill=BRAND_ACCENT_BG, outline=BRAND_ACCENT)
    
    draw_node(draw, 430, 200, 260, 240, "FastAPI Gateway Server", 
              "ASGI WebSocket Server\nSession Manager / State Router\nJWT Authenticator\nCalls & Leads CRUD Controllers\nDynamic Prompt Builder\nStrict 15s SLA Guard", 
              fill=BRAND_PRIMARY_BG, outline=BRAND_PRIMARY)

    draw_node(draw, 430, 500, 260, 120, "Persistence & Cache", 
              "PostgreSQL (Users/Leads/Sessions)\nRedis (Session cache & WS States)\nSQLAlchemy ORM Layer",
              fill=BRAND_SUCCESS_BG, outline=BRAND_SUCCESS)

    draw_node(draw, 870, 130, 260, 110, "Offline ML Layer (<50ms)", 
              "XGBClassifier & LogisticRegression\nObjection Strategy Classifier\nEmotion & Hesitation Detectors\nTF-IDF Token preprocessor",
              fill=BRAND_WARNING_BG, outline=BRAND_WARNING)

    draw_node(draw, 870, 280, 260, 110, "FAISS Vector RAG Engine", 
              "FAISS Index vector storage\nPlaybook & Context Retrieval\nmax_chunks=2 Prompt Budget\nEmbedding distance scorer",
              fill=BRAND_SUCCESS_BG, outline=BRAND_SUCCESS)

    draw_node(draw, 870, 430, 260, 110, "LLM Response Engine", 
              "Groq Cloud Client\nLlama 3.3 70B Model API\nPrompt length: 700-1200 tokens\nOutputs raw suggests",
              fill=BRAND_PRIMARY_BG, outline=BRAND_PRIMARY)

    draw_node(draw, 870, 570, 260, 90, "Quality Guardrails & Logs", 
              "GPT Detox / Anti-Repetition\nScore Filter (Keep >= 0.85)\nLearning Loop JSONL logs",
              fill=BRAND_DANGER_BG, outline=BRAND_DANGER)

    draw_arrow(draw, (290, 280), (430, 280), "Audio/Text Stream (WS)", color=BRAND_ACCENT)
    draw_arrow(draw, (430, 360), (290, 360), "Suggested Replies (WS)", color=BRAND_ACCENT)
    draw_arrow(draw, (560, 440), (560, 500), "Read/Write SQL", color=BRAND_SUCCESS)
    draw_arrow(draw, (690, 240), (870, 180), "1. Predict Category", color=BRAND_WARNING)
    draw_arrow(draw, (870, 210), (690, 270), "ROI_REFRAME / Tone", color=BRAND_WARNING)
    draw_arrow(draw, (690, 310), (870, 330), "2. Query Context", color=BRAND_SUCCESS)
    draw_arrow(draw, (870, 360), (690, 340), "Insight Chunks", color=BRAND_SUCCESS)
    draw_arrow(draw, (690, 390), (870, 460), "3. Execute Prompt", color=BRAND_PRIMARY)
    draw_arrow(draw, (870, 500), (690, 420), "Raw Output Suggest", color=BRAND_PRIMARY)
    draw_arrow(draw, (1000, 540), (1000, 570), "Verify Score", color=BRAND_DANGER)

    save_diagram(img, "diag_overall_arch.png")

# ── 2. Microservice Architecture ─────────────────────────────────────────────
def make_diag_microservices():
    img = Image.new("RGB", (1200, 700), BG_COLOR)
    draw = ImageDraw.Draw(img)
    draw_grid_background(draw, 1200, 700)
    draw_header(draw, "Microservice Architecture", "Functional Core Domains and Shared Infrastructure Services")

    # Ingress
    draw_node(draw, 50, 290, 120, 100, "Web Traffic\nIngress\n(REST/WS)", fill=BRAND_ACCENT_BG, outline=BRAND_ACCENT)

    # API Gateway
    draw_node(draw, 240, 150, 180, 380, "API Gateway Router\n(FastAPI Server)", 
              "Reverse Proxy\nRate Limiting\nJWT Verification\nRoute Dispatcher\nHTTP Keep-Alive\nWebSocket Multiplexer", 
              fill=BRAND_PRIMARY_BG, outline=BRAND_PRIMARY)

    # Core Services
    draw_node(draw, 500, 150, 260, 90, "Lead Intelligence Service", 
              "Google Places Scraper\nWeb enrichment & Scraping\nPain Point Detection Classifier", 
              fill=WHITE, outline=BORDER_GRAY)
    
    draw_node(draw, 500, 270, 260, 90, "Outreach studio", 
              "Personalized message gen\nChannel availability scanner\nSpam risk validation engine", 
              fill=WHITE, outline=BORDER_GRAY)

    draw_node(draw, 500, 390, 260, 90, "Copilot Brain Engine", 
              "Unified Conversation Brain\nEmotion keyword extraction\nObjection strategy router", 
              fill=WHITE, outline=BORDER_GRAY)

    draw_node(draw, 500, 510, 260, 90, "Deepgram WS Transcoder", 
              "WebRTC/WebSocket Audio\nDeepgram Streaming STT\nTurn Segmenter & Debouncer", 
              fill=WHITE, outline=BORDER_GRAY)

    # Databases
    draw_node(draw, 880, 180, 260, 100, "PostgreSQL Database", 
              "Users / Profile schemas\nLeads & Opportunities data\nSaved Copilot sessions logs", 
              fill=BRAND_SUCCESS_BG, outline=BRAND_SUCCESS)

    draw_node(draw, 880, 320, 260, 100, "FAISS Vector Store", 
              "Playbook Embeddings Index\nHigh-speed L2 distance search\nCompressed Prompt Assets", 
              fill=BRAND_SUCCESS_BG, outline=BRAND_SUCCESS)

    draw_node(draw, 880, 460, 260, 100, "Redis Cache", 
              "Session State storage\nWebSocket Channel states\nRate-limiting rate logs", 
              fill=BRAND_SUCCESS_BG, outline=BRAND_SUCCESS)

    # Arrow connections
    draw_arrow(draw, (170, 340), (240, 340), "HTTPS / WS", color=BRAND_ACCENT)
    
    # Gateway to Services
    draw_arrow(draw, (420, 240), (500, 200), "JSON / RPC", color=BRAND_PRIMARY)
    draw_arrow(draw, (420, 300), (500, 310), "JSON / RPC", color=BRAND_PRIMARY)
    draw_arrow(draw, (420, 360), (500, 420), "WS Session", color=BRAND_PRIMARY)
    draw_arrow(draw, (420, 420), (500, 530), "Audio Stream", color=BRAND_PRIMARY)

    # Services to Data
    draw_arrow(draw, (760, 200), (880, 220), "SQL CRUD", color=BRAND_SUCCESS)
    draw_arrow(draw, (760, 350), (880, 350), "L2 Query", color=BRAND_SUCCESS)
    draw_arrow(draw, (760, 480), (880, 480), "State Read/Write", color=BRAND_SUCCESS)

    save_diagram(img, "diag_microservices.png")

# ── 3. Browser Extension Architecture ────────────────────────────────────────
def make_diag_extension():
    img = Image.new("RGB", (1200, 700), BG_COLOR)
    draw = ImageDraw.Draw(img)
    draw_grid_background(draw, 1200, 700)
    draw_header(draw, "Browser Extension Architecture", "Chrome Extension (Manifest V3) Sandbox and Content Injections")

    # Host Pages
    draw_node(draw, 50, 150, 220, 480, "Host Web Apps", 
              "WhatsApp Web (web.whatsapp.com)\nLinkedIn (linkedin.com)\nGmail (mail.google.com)\nOutlook (outlook.office.com)\n\n[Injected DOM Areas]", 
              fill=BRAND_ACCENT_BG, outline=BRAND_ACCENT)

    # Content Script
    draw_node(draw, 340, 150, 240, 220, "Content Script\n(content.js)", 
              "DOM Mutator observer\nMessage Listener (inbox text)\nInjected Floating UI trigger\nAutofill response helper\nLocal CSS Styling wrapper", 
              fill=WHITE, outline=BORDER_GRAY)

    # Sidebar UI Iframe
    draw_node(draw, 340, 410, 240, 220, "Sidebar UI (Iframe React SPA)\n(sidebar.html / JS)", 
              "Suggested response cards\nCopilot coaching feedback\nObjection Alert indicator\nManual input correction panel\nState management hooks", 
              fill=WHITE, outline=BORDER_GRAY)

    # Background Service Worker
    draw_node(draw, 650, 150, 240, 480, "Background Service Worker\n(background.js)", 
              "Central message dispatcher\nChrome runtime storage API\nActive tabs management\nKeep-alive ping orchestrator\n\n[Tunnel Connections]\nWebSocket Tunnel Client\nHTTP REST Tunnel Client\nJWT session credential cache", 
              fill=BRAND_PRIMARY_BG, outline=BRAND_PRIMARY)

    # Backend
    draw_node(draw, 960, 290, 190, 200, "Clozflow Backend\n(FastAPI Gateway)", 
              "WebSocket Handler (/ws)\nHTTP API (/api/copilot)\nJWT Authenticator\nState Cache Manager", 
              fill=BRAND_SUCCESS_BG, outline=BRAND_SUCCESS)

    # Arrow connections
    draw_arrow(draw, (270, 220), (340, 220), "DOM Monitor", color=BRAND_ACCENT)
    draw_arrow(draw, (340, 260), (270, 260), "Input Inject", color=BRAND_ACCENT)
    
    # Content Script <-> Background
    draw_arrow(draw, (580, 220), (650, 220), "chrome.runtime.sendMessage", color=BRAND_PRIMARY)
    draw_arrow(draw, (650, 260), (580, 260), "Response callback", color=BRAND_PRIMARY)

    # Sidebar <-> Background
    draw_arrow(draw, (580, 480), (770, 480), "postMessage / runtime.connect", color=BRAND_PRIMARY)
    
    # Background <-> Backend
    draw_arrow(draw, (890, 350), (960, 350), "WebSocket Session", color=BRAND_SUCCESS)
    draw_arrow(draw, (890, 410), (960, 410), "REST HTTP API", color=BRAND_SUCCESS)

    save_diagram(img, "diag_extension.png")

# ── 4. Sequence Diagram ──────────────────────────────────────────────────────
def make_diag_sequence():
    img = Image.new("RGB", (1200, 700), BG_COLOR)
    draw = ImageDraw.Draw(img)
    draw_grid_background(draw, 1200, 700)
    draw_header(draw, "Real-Time Suggestion Sequence Diagram", "End-to-End Latency Profile (<500ms target)")

    # Vertical lifelines
    columns = [
        ("Prospect", 100),
        ("Extension DOM", 300),
        ("Background Worker", 520),
        ("FastAPI Backend", 740),
        ("ML & RAG Layer", 960),
        ("LLM / Groq", 1120)
    ]

    for name, x in columns:
        draw.line([x, 150, x, 650], fill=BORDER_GRAY, width=1)
        draw.rounded_rectangle((x-50, 110, x+50, 145), radius=4, fill=BRAND_PRIMARY_BG, outline=BRAND_PRIMARY)
        draw.text((x, 127), name, font=font_node_title, fill=TEXT_DARK, anchor="mm")

    # Sequence calls
    # 1. Incoming chat
    draw_arrow(draw, (100, 180), (300, 180), "Objection Text", color=TEXT_DARK)
    
    # 2. Extract DOM & send to background
    draw_arrow(draw, (300, 220), (520, 220), "chrome.runtime.sendMessage", color=BRAND_PRIMARY)
    
    # 3. Relay via WebSocket
    draw_arrow(draw, (520, 260), (740, 260), "WS Text payload", color=BRAND_PRIMARY)

    # 4. FastAPI triggers ML Pipeline (Parallelized)
    draw_arrow(draw, (740, 300), (960, 300), "1. Check Objections (<50ms)", color=BRAND_WARNING)
    draw.rounded_rectangle((960, 300, 970, 380), radius=2, fill=BRAND_WARNING)
    draw_arrow(draw, (960, 340), (740, 340), "Strategy: ROI_REFRAME", color=BRAND_WARNING)

    # 5. FastAPI queries FAISS index
    draw_arrow(draw, (740, 380), (960, 380), "2. Query RAG index", color=BRAND_SUCCESS)
    draw.rounded_rectangle((960, 380, 970, 420), radius=2, fill=BRAND_SUCCESS)
    draw_arrow(draw, (960, 420), (740, 420), "Playbook Context", color=BRAND_SUCCESS)

    # 6. Call LLM Groq (Llama 3.3)
    draw_arrow(draw, (740, 460), (1120, 460), "3. Execute Prompt", color=BRAND_PRIMARY)
    draw.rounded_rectangle((1120, 460, 1130, 520), radius=2, fill=BRAND_PRIMARY)
    draw_arrow(draw, (1120, 520), (740, 520), "Raw Response Suggestion", color=BRAND_PRIMARY)

    # 7. Validate & Score
    draw.rounded_rectangle((735, 530, 745, 570), radius=2, fill=BRAND_DANGER)
    draw.text((755, 550), "Score Check\n>= 0.85 SLA", font=font_arrow, fill=BRAND_DANGER)

    # 8. Send reply suggestions back
    draw_arrow(draw, (740, 580), (520, 580), "WS Message: response_data", color=BRAND_PRIMARY)
    draw_arrow(draw, (520, 610), (300, 610), "Injected Sidebar Render", color=BRAND_PRIMARY)

    save_diagram(img, "diag_sequence.png")

# ── 5. Data Flow Diagram ─────────────────────────────────────────────────────
def make_diag_data_flow():
    img = Image.new("RGB", (1200, 700), BG_COLOR)
    draw = ImageDraw.Draw(img)
    draw_grid_background(draw, 1200, 700)
    draw_header(draw, "Data Flow Diagram (DFD)", "System Data Transformations and Processing Pipeline")

    # Flow nodes left to right, split, then join
    draw_node(draw, 40, 270, 140, 80, "Prospect Text\n/ Audio Stream", fill=BRAND_ACCENT_BG, outline=BRAND_ACCENT)
    draw_node(draw, 220, 270, 140, 80, "Preprocess &\nTokenizer\n(<5ms)", fill=WHITE, outline=BORDER_GRAY)
    
    # Branching
    # Top Branch: ML Strategy Predictor
    draw_node(draw, 400, 160, 200, 90, "XGBoost Classifier", 
              "TF-IDF Vector input\nPredict objection class\n[ROI, Auth, Trust...]", 
              fill=BRAND_WARNING_BG, outline=BRAND_WARNING)
    
    # Middle Branch: Keyword Router
    draw_node(draw, 400, 280, 200, 90, "Keyword Emotion Router", 
              "Extract hesitation tags\n[tone: cost_anxious,\nauthority_blocked...]", 
              fill=BRAND_WARNING_BG, outline=BRAND_WARNING)

    # Bottom Branch: FAISS Context
    draw_node(draw, 400, 400, 200, 90, "FAISS Playbooks RAG", 
              "Cosine distance search\nRetrieve 2 playbook vectors\nCompressed prompt budget", 
              fill=BRAND_SUCCESS_BG, outline=BRAND_SUCCESS)

    # Merge into Prompt Builder
    draw_node(draw, 660, 270, 160, 100, "Compressed\nPrompt Builder", 
              "Tokens: 700 - 1200\nSystem playbooks\nSelected Strategy\nTone context", 
              fill=BRAND_PRIMARY_BG, outline=BRAND_PRIMARY)

    # LLM
    draw_node(draw, 860, 270, 140, 100, "LLM Groq API\n(Llama 3.3 70B)", 
              "Inference execution\nGenerate consultative\nsuggested suggestions", 
              fill=BRAND_PRIMARY_BG, outline=BRAND_PRIMARY)

    # Guardrails & Output
    draw_node(draw, 1040, 270, 120, 100, "SLA Guard &\nDetox Scorer", 
              "15s Timeout Check\nQuality check\nSave learning JSONL", 
              fill=BRAND_DANGER_BG, outline=BRAND_DANGER)

    # Connections
    draw_arrow(draw, (180, 310), (220, 310))
    draw_arrow(draw, (360, 290), (400, 205))
    draw_arrow(draw, (360, 310), (400, 325))
    draw_arrow(draw, (360, 330), (400, 445))

    draw_arrow(draw, (600, 205), (660, 290))
    draw_arrow(draw, (600, 325), (660, 310))
    draw_arrow(draw, (600, 445), (660, 330))

    draw_arrow(draw, (820, 320), (860, 320))
    draw_arrow(draw, (1000, 320), (1040, 320))

    save_diagram(img, "diag_data_flow.png")

# ── 6. AI Request Flow ───────────────────────────────────────────────────────
def make_diag_ai_request_flow():
    img = Image.new("RGB", (1200, 700), BG_COLOR)
    draw = ImageDraw.Draw(img)
    draw_grid_background(draw, 1200, 700)
    draw_header(draw, "AI Request Lifecycle", "Request Orchestration, SLA Guardrails, and Fallback Routing")

    draw_node(draw, 50, 280, 140, 80, "Intake Request\n(WebSocket /ws)", fill=BRAND_ACCENT_BG, outline=BRAND_ACCENT)
    draw_node(draw, 230, 280, 140, 80, "Async Parallel\nRouter Engine", fill=BRAND_PRIMARY_BG, outline=BRAND_PRIMARY)
    
    # Parallel ML & RAG
    draw_node(draw, 410, 180, 200, 80, "ML Strategy Classifier\n(XGBoost / LR)", fill=BRAND_WARNING_BG, outline=BRAND_WARNING)
    draw_node(draw, 410, 380, 200, 80, "RAG Vector Lookup\n(FAISS Vector DB)", fill=BRAND_SUCCESS_BG, outline=BRAND_SUCCESS)

    draw_node(draw, 650, 280, 160, 80, "Prompt Compiling", fill=BRAND_PRIMARY_BG, outline=BRAND_PRIMARY)
    draw_node(draw, 850, 280, 160, 80, "LLM Groq Call\n(SLA Countdown)", fill=BRAND_PRIMARY_BG, outline=BRAND_PRIMARY)

    # Scorer Branch
    draw_node(draw, 1050, 180, 120, 100, "Validation Scorer\n(Score >= 0.85)", fill=BRAND_DANGER_BG, outline=BRAND_DANGER)
    draw_node(draw, 1050, 380, 120, 100, "SLA Timeout /\nFallback Manager", fill=BRAND_DANGER_BG, outline=BRAND_DANGER)

    # Outputs
    draw_node(draw, 1050, 50, 120, 80, "Approved Suggestion\n(JSONL Learning)", fill=BRAND_SUCCESS_BG, outline=BRAND_SUCCESS)
    draw_node(draw, 1050, 540, 120, 80, "Pre-seeded Strategy\nFallback Suggestion", fill=BRAND_WARNING_BG, outline=BRAND_WARNING)

    # Connection lines
    draw_arrow(draw, (190, 320), (230, 320))
    draw_arrow(draw, (370, 300), (410, 220))
    draw_arrow(draw, (370, 340), (410, 420))
    
    draw_arrow(draw, (610, 220), (650, 300))
    draw_arrow(draw, (610, 420), (650, 340))
    
    draw_arrow(draw, (810, 320), (850, 320))
    
    # LLM success/timeout branch
    draw_arrow(draw, (1010, 300), (1050, 230), "API Returns", color=BRAND_SUCCESS)
    draw_arrow(draw, (1010, 340), (1050, 430), ">15s Timeout / Err", color=BRAND_DANGER)

    # Scorer success / fail branch
    draw_arrow(draw, (1110, 180), (1110, 130), "Yes", color=BRAND_SUCCESS)
    draw_arrow(draw, (1110, 280), (1110, 380), "No (Score < 0.85)", color=BRAND_DANGER)
    
    # Fallback output
    draw_arrow(draw, (1110, 480), (1110, 540), "Route Fallback", color=BRAND_WARNING)

    save_diagram(img, "diag_ai_request_flow.png")

# ── 7. Deployment Architecture ───────────────────────────────────────────────
def make_diag_deployment():
    img = Image.new("RGB", (1200, 700), BG_COLOR)
    draw = ImageDraw.Draw(img)
    draw_grid_background(draw, 1200, 700)
    draw_header(draw, "Deployment Architecture", "Production Topology, VPC Boundaries, and Cloud Scalability")

    # Ingress Layer
    draw_node(draw, 50, 260, 160, 120, "Web Traffic / Users\n(Extension Client)\n\nHTTPS (port 443)\nWSS (WebSockets)", 
              fill=BRAND_ACCENT_BG, outline=BRAND_ACCENT)

    draw_node(draw, 270, 260, 160, 120, "Cloudflare CDN\n/ DNS Protection", 
              "Edge Caching\nDDoS Mitigation\nSSL Termination\nStatic Assets CDN", 
              fill=BRAND_ACCENT_BG, outline=BRAND_ACCENT)

    # VPC Layer
    draw.rounded_rectangle((480, 130, 940, 600), radius=10, fill=WHITE, outline=BRAND_PRIMARY, width=2)
    draw.text((495, 145), "AWS Virtual Private Cloud (VPC)", font=font_legend, fill=BRAND_PRIMARY)

    # Public Subnet (ALB)
    draw.rounded_rectangle((500, 175, 920, 250), radius=6, fill=BRAND_PRIMARY_BG, outline=BORDER_GRAY)
    draw.text((515, 185), "Public Subnets (ALB Gateway)", font=font_node_title, fill=TEXT_DARK)
    draw_node(draw, 640, 205, 180, 35, "AWS Application Load Balancer", fill=WHITE, outline=BORDER_GRAY)

    # Private Subnet (ECS Fargate)
    draw.rounded_rectangle((500, 270, 920, 390), radius=6, fill=BG_COLOR, outline=BORDER_GRAY)
    draw.text((515, 280), "Private Subnet (ECS Fargate Container Cluster)", font=font_node_title, fill=TEXT_DARK)
    draw_node(draw, 520, 310, 180, 60, "ECS Service Task 1\nFastAPI Application", fill=WHITE, outline=BORDER_GRAY)
    draw_node(draw, 720, 310, 180, 60, "ECS Service Task 2\nFastAPI Application", fill=WHITE, outline=BORDER_GRAY)

    # DB Subnets
    draw.rounded_rectangle((500, 410, 920, 580), radius=6, fill=BRAND_SUCCESS_BG, outline=BORDER_GRAY)
    draw.text((515, 420), "Isolated Database Subnets", font=font_node_title, fill=TEXT_DARK)
    draw_node(draw, 520, 450, 180, 80, "Amazon RDS PostgreSQL\n(Primary DB Node)\nWrite Transactions", fill=WHITE, outline=BRAND_SUCCESS)
    draw_node(draw, 720, 450, 180, 80, "Redis ElastiCache\n(In-Memory Cluster)\nWebSocket Session Cache", fill=WHITE, outline=BRAND_SUCCESS)

    # External APIs
    draw_node(draw, 1000, 200, 160, 100, "Groq Cloud API\n(Llama 3.3)", fill=BRAND_PRIMARY_BG, outline=BRAND_PRIMARY)
    draw_node(draw, 1000, 360, 160, 100, "Deepgram API\n(Streaming STT)", fill=BRAND_PRIMARY_BG, outline=BRAND_PRIMARY)

    # Arrows
    draw_arrow(draw, (210, 320), (270, 320))
    draw_arrow(draw, (430, 320), (500, 220), "VPC Route", color=BRAND_ACCENT)
    draw_arrow(draw, (730, 240), (730, 310), "Distribute Load", color=BRAND_PRIMARY)
    draw_arrow(draw, (610, 370), (610, 450), "SQL", color=BRAND_SUCCESS)
    draw_arrow(draw, (810, 370), (810, 450), "State Cache", color=BRAND_SUCCESS)

    # Outbound NAT connections
    draw_arrow(draw, (700, 340), (1000, 250), "API Exec", color=BRAND_PRIMARY)
    draw_arrow(draw, (700, 360), (1000, 410), "Audio Stream", color=BRAND_PRIMARY)

    save_diagram(img, "diag_deployment.png")

# ── 8. Backend Architecture ──────────────────────────────────────────────────
def make_diag_backend_arch():
    img = Image.new("RGB", (1200, 700), BG_COLOR)
    draw = ImageDraw.Draw(img)
    draw_grid_background(draw, 1200, 700)
    draw_header(draw, "FastAPI Backend Architecture", "Logical Package Boundaries, Layered Code Structure, and REST Routes")

    # Routes (Controller)
    draw.rounded_rectangle((50, 130, 280, 600), radius=8, fill=BRAND_PRIMARY_BG, outline=BRAND_PRIMARY, width=2)
    draw.text((165, 150), "API Routers / Endpoints", font=font_node_title, fill=TEXT_DARK, anchor="mm")
    
    routes = [
        ("auth.py", "POST /auth/register, /login"),
        ("leads.py", "POST /search, /save; GET /saved"),
        ("outreach.py", "POST /generate, /channels"),
        ("copilot.py", "POST /session/start, /session/analyze"),
        ("calls.py", "WebSocket /ws connections")
    ]
    for i, (name, desc) in enumerate(routes):
        draw_node(draw, 60, 175 + i*80, 210, 65, name, desc, fill=WHITE, outline=BORDER_GRAY)

    # Core Orchestration (Service Layer)
    draw.rounded_rectangle((360, 130, 780, 600), radius=8, fill=WHITE, outline=BORDER_GRAY, width=2)
    draw.text((570, 150), "Unified Orchestration & Services", font=font_node_title, fill=TEXT_DARK, anchor="mm")

    draw_node(draw, 380, 180, 380, 100, "UnifiedConversationBrain (services/unified_conversation_brain.py)", 
              "Main interface for copilot sessions. Coordinates memory\ninitialization, transcript parsing, and invokes sales_ai_engine\nfor cognitive reasoning and strategy validation.", 
              fill=BRAND_PRIMARY_BG, outline=BRAND_PRIMARY)

    draw_node(draw, 380, 310, 380, 85, "SalesAIEngine (services/sales_ai_engine.py)", 
              "V4.2 psychological persuasion manager. Prepares prompt inputs,\nmonitors execution SLA thresholds, handles fallback recovery suggestions\nand coordinates GPT detox anti-repetition filter.", 
              fill=BRAND_PRIMARY_BG, outline=BRAND_PRIMARY)

    draw_node(draw, 380, 420, 180, 85, "websocket_manager.py\n(services/)", 
              "Maintains active client\nWebSocket connections.\nBroadcasts suggested\nresponses and objections.", fill=WHITE, outline=BORDER_GRAY)

    draw_node(draw, 580, 420, 180, 85, "deepgram_stream.py\n(services/)", 
              "Handles binary audio chunks\nforwarded to Deepgram STT\nvia persistent socket tunnel.", fill=WHITE, outline=BORDER_GRAY)

    draw_node(draw, 380, 520, 180, 65, "lead_engine.py\n(services/)", "Lead Intelligence Engine\nGoogle Places scraper", fill=WHITE, outline=BORDER_GRAY)
    draw_node(draw, 580, 520, 180, 65, "outreach_engine.py\n(services/)", "Outreach studio engine\nPersonalized outbound copy", fill=WHITE, outline=BORDER_GRAY)

    # Database layer
    draw.rounded_rectangle((860, 130, 1140, 600), radius=8, fill=BRAND_SUCCESS_BG, outline=BRAND_SUCCESS, width=2)
    draw.text((1000, 150), "Database Schema (models.py)", font=font_node_title, fill=TEXT_DARK, anchor="mm")

    tables = [
        ("User", "users table\nProfile & AI Configs"),
        ("Lead", "leads table\nEnriched prospect records"),
        ("CopilotSession", "copilot_sessions table\nSummaries & state variables"),
        ("CallLog", "call_logs table\nSaved voice call transcripts")
    ]
    for i, (t_name, t_desc) in enumerate(tables):
        draw_node(draw, 880, 180 + i*100, 240, 80, t_name, t_desc, fill=WHITE, outline=BORDER_GRAY)

    # Simple flow arrow controllers
    draw_arrow(draw, (270, 490), (360, 490), "Event Stream", color=BRAND_ACCENT)
    draw_arrow(draw, (270, 300), (380, 240), "Route Dispatch", color=BRAND_PRIMARY)
    draw_arrow(draw, (760, 240), (860, 230), "ORM CRUD", color=BRAND_SUCCESS)

    save_diagram(img, "diag_backend_arch.png")

# ── 9. Research Pipeline ─────────────────────────────────────────────────────
def make_diag_research_pipeline():
    img = Image.new("RGB", (1200, 700), BG_COLOR)
    draw = ImageDraw.Draw(img)
    draw_grid_background(draw, 1200, 700)
    draw_header(draw, "Lead Intelligence Research Pipeline", "Web Enrichment, Opportunity Signals & Qualification Scoring")

    # Steps left to right
    draw_node(draw, 50, 280, 130, 80, "User Input / Query\n\ne.g., 'plumbers in Dallas'", fill=BRAND_ACCENT_BG, outline=BRAND_ACCENT)
    draw_node(draw, 220, 280, 150, 80, "Google Places API\n/ Business Finder", 
              "Fetch ratings, reviews,\ncategory labels, location,\nphone and websites", fill=WHITE, outline=BORDER_GRAY)

    # Parallel Scrapers
    draw_node(draw, 410, 150, 180, 80, "Website Analyzer\n(Scraper & Parser)", 
              "Inspects SEO tags, services,\nin-house tooling signals,\nand tech stack footprints", fill=WHITE, outline=BORDER_GRAY)
    
    draw_node(draw, 410, 280, 180, 80, "Social Presence Monitor\n(Instagram & LinkedIn)", 
              "Scrapes activity, post counts,\ncontact email handles,\nand brand engagement metrics", fill=WHITE, outline=BORDER_GRAY)

    draw_node(draw, 410, 410, 180, 80, "Review Text Analyzer", 
              "Reads reviews sentiment,\ndetects common complaints,\nand extracts customer pain pts", fill=WHITE, outline=BORDER_GRAY)

    # Enricher & Scorer
    draw_node(draw, 630, 280, 170, 80, "Cognitive Aggregator\n(LLM Opportunity Scorer)", 
              "Analyzes signals vs user offer\nDetects likely business pain\nDetermines service fit reason", 
              fill=BRAND_PRIMARY_BG, outline=BRAND_PRIMARY)

    draw_node(draw, 840, 260, 150, 120, "Lead Qualification\n& Scoring Model", 
              "Opportunity score (1-100)\nBuying probability (Low-High)\nOutreach angles generation\nConfidence score calculation", 
              fill=BRAND_WARNING_BG, outline=BRAND_WARNING)

    draw_node(draw, 1030, 280, 120, 80, "Lead Schema Output\n\nSaved to database", fill=BRAND_SUCCESS_BG, outline=BRAND_SUCCESS)

    # Connections
    draw_arrow(draw, (180, 320), (220, 320))
    draw_arrow(draw, (370, 300), (410, 190))
    draw_arrow(draw, (370, 320), (410, 320))
    draw_arrow(draw, (370, 340), (410, 450))

    draw_arrow(draw, (590, 190), (630, 300))
    draw_arrow(draw, (590, 320), (630, 320))
    draw_arrow(draw, (590, 450), (630, 340))

    draw_arrow(draw, (800, 320), (840, 320))
    draw_arrow(draw, (990, 320), (1030, 320))

    save_diagram(img, "diag_research_pipeline.png")

# ── 10. Conversation Pipeline ────────────────────────────────────────────────
def make_diag_conversation_pipeline():
    img = Image.new("RGB", (1200, 700), BG_COLOR)
    draw = ImageDraw.Draw(img)
    draw_grid_background(draw, 1200, 700)
    draw_header(draw, "Conversation Intelligence Pipeline", "Real-Time Turn Tracking, Emotion Analysis & Objection Processing")

    # Flow
    draw_node(draw, 50, 270, 150, 100, "Prospect Converses\n\nIncoming Chat Message\nor Voice Audio chunks", fill=BRAND_ACCENT_BG, outline=BRAND_ACCENT)
    
    draw_node(draw, 240, 270, 160, 100, "Turn Tracker & STT\n(Segmenter & Transcriber)", 
              "Deepgram Streaming STT\nApplies 1.2s silence gap\ndebounce detection\nTracks speaker active state", fill=WHITE, outline=BORDER_GRAY)

    # Triple analysis pipeline
    draw_node(draw, 450, 160, 200, 80, "Objection Detector\n(XGBoost Classifier)", 
              "Classifies 5 target objection states\n(ROI, authority, delay,\nstatus, diagnostic)", fill=BRAND_WARNING_BG, outline=BRAND_WARNING)
    
    draw_node(draw, 450, 280, 200, 80, "Emotion Tone Router", 
              "Detects customer emotional tags\n(cost_anxious, authority_blocked,\nskeptical_hostile)", fill=BRAND_WARNING_BG, outline=BRAND_WARNING)

    draw_node(draw, 450, 400, 200, 80, "RAG Knowledge Index\n(FAISS Lookup)", 
              "Matches objection to top sales\nplaybooks in local library", fill=BRAND_SUCCESS_BG, outline=BRAND_SUCCESS)

    # Core Brain merger
    draw_node(draw, 700, 260, 210, 120, "Cognitive Sales Brain\n(Unified Context Compiler)", 
              "Merges lead profile context,\nhistory summaries, predicted\nobjections class, and vector playbooks\ninto minimized prompt template", 
              fill=BRAND_PRIMARY_BG, outline=BRAND_PRIMARY)

    draw_node(draw, 960, 260, 190, 120, "Response Generator UI\n\nSuggested consultative replies\nObjection explanation alerts\nCommitment tracker logs", 
              fill=BRAND_ACCENT_BG, outline=BRAND_ACCENT)

    # Connections
    draw_arrow(draw, (200, 320), (240, 320))
    draw_arrow(draw, (400, 300), (450, 200))
    draw_arrow(draw, (400, 320), (450, 320))
    draw_arrow(draw, (400, 340), (450, 440))

    draw_arrow(draw, (650, 200), (700, 300))
    draw_arrow(draw, (650, 320), (700, 320))
    draw_arrow(draw, (650, 440), (700, 340))

    draw_arrow(draw, (910, 320), (960, 320), " suggested data", color=BRAND_ACCENT)

    save_diagram(img, "diag_conversation_pipeline.png")

# ── 11. Memory Architecture ──────────────────────────────────────────────────
def make_diag_memory_arch():
    img = Image.new("RGB", (1200, 700), BG_COLOR)
    draw = ImageDraw.Draw(img)
    draw_grid_background(draw, 1200, 700)
    draw_header(draw, "Memory Architecture", "Unified Memory Hierarchy and Context Assembly")

    # Three layers
    draw_node(draw, 80, 260, 260, 180, "1. Ephemeral Memory\n(In-Memory / Websocket session)", 
              "Active client profile details\nLast 3 dialog turns transcripts\nWebSocket stream connection status\nPredicted emotion flags cache\n\n[Speed: <5ms read/write]", 
              fill=BRAND_PRIMARY_BG, outline=BRAND_PRIMARY)

    draw_node(draw, 460, 220, 280, 260, "2. Transactional Memory\n(Relational Database Session)", 
              "Saved in copilot_sessions table\nStores conversation_summary string\nSaves identified objections list\nTracks commitments logs\nKeeps unanswered questions list\nHidden concerns evaluation field\n\n[Speed: 10-30ms read/write via SQL]", 
              fill=BRAND_SUCCESS_BG, outline=BRAND_SUCCESS)

    draw_node(draw, 840, 260, 280, 180, "3. Long-Term Vector Memory\n(FAISS Vector Index)", 
              "Vectorized historical summaries\nHistoric closed-deal transcripts\nSales Playbook instructions\nSemantic similarity matches\n\n[Speed: 5-15ms cosine query]", 
              fill=BRAND_SUCCESS_BG, outline=BRAND_SUCCESS)

    # Prompt builder center
    draw_node(draw, 460, 520, 280, 120, "Active Prompt Context Compiler\n(Unified Context Assembly)", 
              "Aggregates 3 memory tiers into a single\ncontext block. Enforces a strict token budget\nof 700-1200 tokens using custom heuristics.", 
              fill=BRAND_WARNING_BG, outline=BRAND_WARNING)

    # Connections
    draw_arrow(draw, (340, 350), (460, 350), "Persist State", color=BRAND_SUCCESS)
    draw_arrow(draw, (460, 410), (340, 410), "Hydrate Session", color=BRAND_PRIMARY)
    draw_arrow(draw, (740, 350), (840, 350), "Index summaries", color=BRAND_SUCCESS)

    draw_arrow(draw, (210, 440), (460, 550), "Inject recent turns", color=BRAND_PRIMARY)
    draw_arrow(draw, (600, 480), (600, 520), "Inject session metrics", color=BRAND_SUCCESS)
    draw_arrow(draw, (980, 440), (740, 560), "Inject playbook insights", color=BRAND_SUCCESS)

    save_diagram(img, "diag_memory_arch.png")

# ── 12. Runtime Architecture ─────────────────────────────────────────────────
def make_diag_runtime_arch():
    img = Image.new("RGB", (1200, 700), BG_COLOR)
    draw = ImageDraw.Draw(img)
    draw_grid_background(draw, 1200, 700)
    draw_header(draw, "Runtime Architecture", "ASGI High-Concurrency Event Loops, Thread Pools, and I/O Tunnels")

    # Ingress Client WebSockets
    draw_node(draw, 50, 230, 200, 240, "Client Connections\n(React UI / Extensions)\n\nPersistent WSS Channels\nIncoming audio buffers\nIncoming chat text\nKeep-alive pings", 
              fill=BRAND_ACCENT_BG, outline=BRAND_ACCENT)

    # ASGI Event Loop Uvicorn/FastAPI
    draw.rounded_rectangle((320, 130, 800, 560), radius=10, fill=WHITE, outline=BRAND_PRIMARY, width=2)
    draw.text((560, 150), "ASGI Application Container (Uvicorn / FastAPI Event Loop)", font=font_legend, fill=BRAND_PRIMARY, anchor="mm")

    draw_node(draw, 340, 180, 440, 120, "Single-Threaded Event Loop (asyncio)", 
              "Asynchronously multiplexes WebSocket events from client pool\nRoutes HTTP REST routes endpoints to controllers\nCoordinates task scheduling and API client requests", 
              fill=BRAND_PRIMARY_BG, outline=BRAND_PRIMARY)

    draw_node(draw, 340, 340, 440, 80, "External Async I/O Callers", 
              "Non-blocking async HTTP calls to Groq Cloud LLM\nNon-blocking async WebSocket streams to Deepgram STT\nNon-blocking async database connections pool", 
              fill=WHITE, outline=BORDER_GRAY)

    draw_node(draw, 340, 450, 440, 110, "ThreadPoolExecutor / ProcessPool (CPU Heavy Task)", 
              "Forks heavy CPU calculations off the primary asyncio loop\nRuns TF-IDF tokenizer vectorizations on transcript strings\nExecutes offline XGBoost model inferences predictions", 
              fill=BRAND_WARNING_BG, outline=BRAND_WARNING)

    # External systems
    draw_node(draw, 880, 230, 260, 110, "External APIs REST & WS\n(Groq, Deepgram STT)", 
              "Real-time audio transcription\nLlama 3.3 model text generation", 
              fill=BRAND_PRIMARY_BG, outline=BRAND_PRIMARY)

    draw_node(draw, 880, 380, 260, 110, "DB Cluster Pool\n(Postgres / SQLite)", 
              "Active SQLAlchemy session transactions\nSaves user profiles and leads", 
              fill=BRAND_SUCCESS_BG, outline=BRAND_SUCCESS)

    # Arrows
    draw_arrow(draw, (250, 350), (320, 350), "Multiplex WSS", color=BRAND_ACCENT)
    draw_arrow(draw, (560, 300), (560, 340), "Spawn tasks", color=BRAND_PRIMARY)
    draw_arrow(draw, (560, 420), (560, 450), "Offload blocking ML", color=BRAND_WARNING)
    
    draw_arrow(draw, (780, 380), (880, 280), "Async Request", color=BRAND_PRIMARY)
    draw_arrow(draw, (780, 400), (880, 430), "Async Read/Write", color=BRAND_SUCCESS)

    save_diagram(img, "diag_runtime_arch.png")

# ── 13. Session Architecture ─────────────────────────────────────────────────
def make_diag_session_arch():
    img = Image.new("RGB", (1200, 700), BG_COLOR)
    draw = ImageDraw.Draw(img)
    draw_grid_background(draw, 1200, 700)
    draw_header(draw, "Session Architecture", "Copilot Session Finite State Machine & Variables")

    # State nodes left to right
    states = [
        ("initial_contact", "Session Init\nUser selects lead\nPlatform mapped"),
        ("discovery", "Discovery stage\nAsk diagnostics\nIdentify pain points"),
        ("presentation", "Presentation stage\nPitch value props\nDemonstrate ROI"),
        ("objection_handling", "Objection Handling\nML strategy class\nPlaybook responses"),
        ("commitment", "Commitment stage\nAgreed close details\nSave milestones"),
        ("closed", "Closed / Session End\nWrite summaries\nUpdate lead score")
    ]

    for i, (s_name, s_desc) in enumerate(states):
        x = 50 + i * 185
        y = 280
        fill = WHITE
        outline = BORDER_GRAY
        if s_name == "objection_handling":
            fill = BRAND_DANGER_BG
            outline = BRAND_DANGER
        elif s_name == "commitment" or s_name == "closed":
            fill = BRAND_SUCCESS_BG
            outline = BRAND_SUCCESS
        elif s_name == "initial_contact":
            fill = BRAND_ACCENT_BG
            outline = BRAND_ACCENT
            
        draw_node(draw, x, y, 165, 120, s_name, s_desc, fill=fill, outline=outline)
        
        # Connect to next state
        if i < len(states) - 1:
            draw_arrow(draw, (x + 165, y + 60), (x + 185, y + 60), color="#94A3B8")

    # Metrics tracked in session (bottom)
    draw.rounded_rectangle((100, 480, 1100, 600), radius=8, fill=BRAND_PRIMARY_BG, outline=BRAND_PRIMARY)
    draw.text((600, 500), "Session State Variables Tracked Globally in active_session Schema", font=font_node_title, fill=TEXT_DARK, anchor="mm")
    
    metrics = [
        ("buying_intent", "Intent index: 0-100\nBased on buying signals"),
        ("trust_score", "Trust index: 0-100\nRelational score index"),
        ("unanswered_questions", "JSON List\nTrack outstanding inquiries"),
        ("commitments", "JSON List\nMilestones promised by client"),
        ("objections", "JSON List\nDiscovered objections registry")
    ]
    for i, (m_name, m_desc) in enumerate(metrics):
        mx = 120 + i * 195
        draw_node(draw, mx, 520, 180, 65, m_name, m_desc, fill=WHITE, outline=BORDER_GRAY)

    save_diagram(img, "diag_session_arch.png")

# ── 14. Roadmap Timeline ─────────────────────────────────────────────────────
def make_diag_roadmap():
    img = Image.new("RGB", (1200, 700), BG_COLOR)
    draw = ImageDraw.Draw(img)
    draw_grid_background(draw, 1200, 700)
    draw_header(draw, "Clozflow Product Roadmap Timeline", "Technology Convergence and Feature Launch Milestones")

    # Draw timeline axis
    draw.line([50, 360, 1150, 360], fill=BORDER_GRAY, width=4)

    phases = [
        ("Phase 1: Working MVP", "Current Engine\nHybrid ML-LLM\nWS & REST server\nSQLite DB\nChrome Extension", 3, 100, 180),
        ("Phase 2: Lead Verification", "Lead enrichment\nPlaces scraping\nPain-point detection\nWebsite scanner", -3, 250, 400),
        ("Phase 3: CRM Integrations", "Two-way sync\nSalesforce API\nHubSpot connector\nActivity logs upload", 3, 400, 180),
        ("Phase 4: Desktop Agent", "Electron OS hooks\nMac / Win builds\nZoom / Teams hooks\nSystem audio listen", -3, 550, 400),
        ("Phase 5: Mobile Companion", "iOS & Android\nFlutter builds app\nActive WhatsApp sync\nVoice notes coach", 3, 700, 180),
        ("Phase 6: Enterprise Analytics", "Team leaderboard\nWin-rate correlations\nCoaching dashboard\nObjections analysis", -3, 850, 400),
        ("Phase 7: Predictive Sales", "Predictive close rate\nAuto-retraining loop\nML playbook scorer\nFully agentic close", 3, 1000, 180)
    ]

    for title, desc, arrow_dir, x, y in phases:
        # Draw node card
        draw_node(draw, x-75, y, 160, 120, title, desc, fill=BRAND_PRIMARY_BG if "Phase 1" in title else WHITE, 
                  outline=BRAND_PRIMARY if "Phase 1" in title else BORDER_GRAY)
        
        # Connection node on timeline
        draw.ellipse((x-6, 360-6, x+6, 360+6), fill=BRAND_PRIMARY if "Phase 1" in title else BORDER_GRAY)
        
        # Connect node to card
        if arrow_dir > 0:
            # Card is above timeline
            draw.line([x, 360, x, y+120], fill=BORDER_GRAY, width=2)
        else:
            # Card is below timeline
            draw.line([x, 360, x, y], fill=BORDER_GRAY, width=2)

    save_diagram(img, "diag_roadmap.png")

# ── EXECUTE ALL ──────────────────────────────────────────────────────────────
def generate_all():
    print("Starting diagram generation...")
    make_diag_overall_arch()
    make_diag_microservices()
    make_diag_extension()
    make_diag_sequence()
    make_diag_data_flow()
    make_diag_ai_request_flow()
    make_diag_deployment()
    make_diag_backend_arch()
    make_diag_research_pipeline()
    make_diag_conversation_pipeline()
    make_diag_memory_arch()
    make_diag_runtime_arch()
    make_diag_session_arch()
    make_diag_roadmap()
    print("All 14 diagrams generated successfully in documentation/assets/")

if __name__ == "__main__":
    generate_all()
