import os
import sys
from reportlab.lib.pagesizes import letter
from reportlab.lib import colors
from reportlab.lib.colors import HexColor
from reportlab.lib.styles import getSampleStyleSheet, ParagraphStyle
from reportlab.platypus import (
    SimpleDocTemplate, Paragraph, Spacer, Table, TableStyle, PageBreak, Image, KeepTogether
)
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont
from reportlab.pdfgen import canvas

# ── Font Registration ────────────────────────────────────────────────────────
try:
    pdfmetrics.registerFont(TTFont('SegoeUI', 'C:\\Windows\\Fonts\\segoeui.ttf'))
    pdfmetrics.registerFont(TTFont('SegoeUI-Bold', 'C:\\Windows\\Fonts\\segoeuib.ttf'))
    font_body = "SegoeUI"
    font_bold = "SegoeUI-Bold"
except Exception as e:
    print(f"Error registering SegoeUI fonts: {e}. Falling back to Helvetica.")
    font_body = "Helvetica"
    font_bold = "Helvetica-Bold"

# ── Color Palette ────────────────────────────────────────────────────────────
COLOR_PRIMARY = HexColor("#635BFF")     # Stripe Indigo
COLOR_SECONDARY = HexColor("#0EA5E9")   # Sky Blue
COLOR_DARK = HexColor("#0F172A")        # Slate 900
COLOR_MUTED = HexColor("#475569")       # Slate 600
COLOR_LIGHT_BG = HexColor("#F8FAFC")    # Slate 50
COLOR_BORDER = HexColor("#E2E8F0")      # Slate 200
COLOR_CODE_BG = HexColor("#F1F5F9")      # Slate 100
WHITE = colors.white

# ── Custom Numbered Canvas for Dynamic Headers/Footers ────────────────────────
class NumberedCanvas(canvas.Canvas):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, **kwargs)
        self._saved_page_states = []

    def showPage(self):
        self._saved_page_states.append(dict(self.__dict__))
        self._startPage()

    def save(self):
        num_pages = len(self._saved_page_states)
        for state in self._saved_page_states:
            self.__dict__.update(state)
            self.draw_page_decorations(num_pages)
            super().showPage()
        super().save()

    def draw_page_decorations(self, page_count):
        if self._pageNumber == 1:
            return

        self.saveState()
        
        # Header (Top of page)
        self.setFont(font_body, 8)
        self.setFillColor(COLOR_MUTED)
        self.drawString(54, 750, "CLOZFLOW ARCHITECTURE SPECIFICATION  |  INCUBATOR & DUE DILIGENCE EDITION")
        
        # Header Line
        self.setStrokeColor(COLOR_BORDER)
        self.setLineWidth(0.5)
        self.line(54, 742, 558, 742)
        
        # Footer (Bottom of page)
        self.line(54, 55, 558, 55)
        self.setFont(font_body, 8)
        self.setFillColor(COLOR_MUTED)
        self.drawString(54, 40, "CONFIDENTIAL  —  RELEASED FOR STARTUP INCUBATOR & TECHNICAL EVALUATION ONLY")
        self.drawRightString(558, 40, f"Page {self._pageNumber} of {page_count}")
        
        self.restoreState()

# ── Custom Flowable Elements Helpers ─────────────────────────────────────────
def make_code_block(code_text):
    style = ParagraphStyle(
        'CodeStyle',
        fontName='Courier',
        fontSize=8.0,
        leading=10.5,
        textColor=COLOR_DARK
    )
    escaped_code = code_text.replace('\n', '<br/>').replace(' ', '&nbsp;')
    p = Paragraph(escaped_code, style)
    t = Table([[p]], colWidths=[504])
    t.setStyle(TableStyle([
        ('BACKGROUND', (0,0), (-1,-1), COLOR_CODE_BG),
        ('BOX', (0,0), (-1,-1), 0.5, COLOR_BORDER),
        ('LEFTPADDING', (0,0), (-1,-1), 12),
        ('RIGHTPADDING', (0,0), (-1,-1), 12),
        ('TOPPADDING', (0,0), (-1,-1), 8),
        ('BOTTOMPADDING', (0,0), (-1,-1), 8),
    ]))
    return t

def make_callout(text, title="NOTE"):
    p_title = Paragraph(f"<b>{title}</b>", ParagraphStyle('CalloutTitle', fontName=font_bold, fontSize=9.0, leading=11, textColor=COLOR_PRIMARY))
    p_body = Paragraph(text, ParagraphStyle('CalloutBody', fontName=font_body, fontSize=8.5, leading=12, textColor=COLOR_MUTED))
    t = Table([[p_title], [p_body]], colWidths=[504])
    
    border_color = COLOR_PRIMARY
    bg_color = HexColor("#F5F3FF")
    
    t.setStyle(TableStyle([
        ('BACKGROUND', (0,0), (-1,-1), bg_color),
        ('LINELEFT', (0,0), (0,-1), 3.0, border_color),
        ('LEFTPADDING', (0,0), (-1,-1), 12),
        ('RIGHTPADDING', (0,0), (-1,-1), 12),
        ('TOPPADDING', (0,0), (-1,-1), 6),
        ('BOTTOMPADDING', (0,0), (-1,-1), 6),
    ]))
    return t

def create_wrapped_table(data, col_widths, style_header, style_cell, header_bg=COLOR_PRIMARY, grid_color=COLOR_BORDER):
    wrapped_data = []
    for r_idx, row in enumerate(data):
        wrapped_row = []
        for c_idx, cell in enumerate(row):
            if isinstance(cell, Paragraph):
                wrapped_row.append(cell)
            elif isinstance(cell, str):
                style = style_header if r_idx == 0 else style_cell
                escaped_text = cell.replace('\n', '<br/>')
                wrapped_row.append(Paragraph(escaped_text, style))
            else:
                wrapped_row.append(cell)
        wrapped_data.append(wrapped_row)
        
    t = Table(wrapped_data, colWidths=col_widths)
    t_style = [
        ('BACKGROUND', (0,0), (-1,0), header_bg),
        ('ALIGN', (0,0), (-1,-1), 'LEFT'),
        ('VALIGN', (0,0), (-1,-1), 'TOP'),
        ('TOPPADDING', (0,0), (-1,-1), 5),
        ('BOTTOMPADDING', (0,0), (-1,-1), 5),
        ('LEFTPADDING', (0,0), (-1,-1), 8),
        ('RIGHTPADDING', (0,0), (-1,-1), 8),
        ('GRID', (0,0), (-1,-1), 0.5, grid_color),
    ]
    if len(data) > 1:
        t_style.append(('ROWBACKGROUNDS', (0,1), (-1,-1), [WHITE, COLOR_LIGHT_BG]))
    
    t.setStyle(TableStyle(t_style))
    return t

def build_pdf():
    pdf_path = "documentation/Clozflow_Technical_Architecture.pdf"
    
    doc = SimpleDocTemplate(
        pdf_path,
        pagesize=letter,
        leftMargin=54,
        rightMargin=54,
        topMargin=72,
        bottomMargin=72
    )

    styles = getSampleStyleSheet()
    
    style_h1 = ParagraphStyle(
        'Heading1_Custom',
        parent=styles['Heading1'],
        fontName=font_bold,
        fontSize=18,
        leading=22,
        textColor=COLOR_DARK,
        spaceBefore=18,
        spaceAfter=8,
        keepWithNext=True
    )
    
    style_h2 = ParagraphStyle(
        'Heading2_Custom',
        parent=styles['Heading2'],
        fontName=font_bold,
        fontSize=12,
        leading=16,
        textColor=COLOR_PRIMARY,
        spaceBefore=14,
        spaceAfter=6,
        keepWithNext=True
    )
    
    style_body = ParagraphStyle(
        'Body_Custom',
        parent=styles['BodyText'],
        fontName=font_body,
        fontSize=9.5,
        leading=14.0,
        textColor=COLOR_MUTED,
        spaceAfter=8
    )

    style_body_bold = ParagraphStyle(
        'Body_Bold_Custom',
        parent=style_body,
        fontName=font_bold,
        textColor=COLOR_DARK
    )

    style_caption = ParagraphStyle(
        'Caption_Custom',
        parent=styles['Normal'],
        fontName=font_body,
        fontSize=8.0,
        leading=11,
        textColor=COLOR_MUTED,
        alignment=1,
        spaceBefore=4,
        spaceAfter=12
    )

    style_table_header = ParagraphStyle(
        'TableHeader',
        fontName=font_bold,
        fontSize=9.0,
        leading=12,
        textColor=WHITE
    )
    
    style_table_cell = ParagraphStyle(
        'TableCell',
        fontName=font_body,
        fontSize=8.5,
        leading=11.5,
        textColor=COLOR_MUTED
    )

    style_table_cell_bold = ParagraphStyle(
        'TableCellBold',
        fontName=font_bold,
        fontSize=8.5,
        leading=11.5,
        textColor=COLOR_DARK
    )

    story = []

    # =========================================================================
    # COVER PAGE
    # =========================================================================
    story.append(Spacer(1, 100))
    story.append(Paragraph("<b>CLOZFLOW ARCHITECTURE SPECIFICATION</b>", ParagraphStyle('CoverTag', fontName=font_bold, fontSize=10, leading=12, textColor=COLOR_PRIMARY)))
    story.append(Spacer(1, 15))
    story.append(Paragraph("Clozflow: Enterprise AI Sales<br/>Intelligence Platform", ParagraphStyle('CoverTitle', fontName=font_bold, fontSize=32, leading=38, textColor=COLOR_DARK)))
    story.append(Spacer(1, 15))
    story.append(Paragraph("A Unified Real-Time Hybrid ML-LLM Platform for Lead Enrichment, Outreach Personalization, and In-Context Conversation Coaching.", ParagraphStyle('CoverSubtitle', fontName=font_body, fontSize=13, leading=18, textColor=COLOR_MUTED)))
    
    story.append(Spacer(1, 40))
    story.append(Table([[""]], colWidths=[504], rowHeights=[4], style=TableStyle([('BACKGROUND', (0,0), (-1,-1), COLOR_PRIMARY)])))
    
    story.append(Spacer(1, 160))
    
    meta_data = [
        [Paragraph("Document Type", style_table_cell_bold), Paragraph("Technical Design & Architecture Specification (Incubation Review)", style_table_cell)],
        [Paragraph("Target Audience", style_table_cell_bold), Paragraph("Incubator Screening Committee, Pitch Panels & Venture Partners", style_table_cell)],
        [Paragraph("Platform Version", style_table_cell_bold), Paragraph("v2.1.0 (Production Release)", style_table_cell)],
        [Paragraph("Security Status", style_table_cell_bold), Paragraph("CLEARED FOR PUBLIC EVALUATION (SANITIZED EDITION)", style_table_cell)],
        [Paragraph("Release Date", style_table_cell_bold), Paragraph("July 1, 2026", style_table_cell)],
        [Paragraph("Authored By", style_table_cell_bold), Paragraph("Clozflow Engineering & Core AI Systems Team", style_table_cell)]
    ]
    
    meta_table = Table(meta_data, colWidths=[120, 384])
    meta_table.setStyle(TableStyle([
        ('LINEBELOW', (0,0), (-1,-1), 0.5, COLOR_BORDER),
        ('TOPPADDING', (0,0), (-1,-1), 6),
        ('BOTTOMPADDING', (0,0), (-1,-1), 6),
        ('LEFTPADDING', (0,0), (-1,-1), 0),
        ('VALIGN', (0,0), (-1,-1), 'MIDDLE'),
    ]))
    story.append(meta_table)
    story.append(PageBreak())

    # =========================================================================
    # TABLE OF CONTENTS
    # =========================================================================
    story.append(Paragraph("Table of Contents", style_h1))
    story.append(Spacer(1, 10))
    
    toc_label_style = ParagraphStyle('TOCLabel', fontName=font_body, fontSize=9.5, leading=14, textColor=COLOR_DARK)
    toc_page_style = ParagraphStyle('TOCPage', fontName=font_bold, fontSize=9.5, leading=14, textColor=COLOR_PRIMARY, alignment=2)
    
    toc_items = [
        ("1. Executive Summary & Core Platform Vision", "3"),
        ("2. Market Opportunities & Problem Definition", "3"),
        ("3. System Architecture Blueprint", "4"),
        ("4. Core Platform Modules Deep-Dive", "5"),
        ("5. Microservices Boundary & Internal System Interfaces", "7"),
        ("6. Technology Stack & Directory Topography", "8"),
        ("7. Relational Database Design", "10"),
        ("8. API Gateway Design & Authentication Flows", "11"),
        ("9. Real-Time WebSocket Communication", "12"),
        ("10. Lead Intelligence Pipeline & Data Enrichment", "13"),
        ("11. Browser Copilot Flow & DOM Parsing", "14"),
        ("12. AI Request Lifecycle & SLA Protection Guardrails", "15"),
        ("13. Conversation Intelligence & Turn Tracking", "16"),
        ("14. Dual-State Memory Architecture", "17"),
        ("15. Runtime ASGI Concurrency & Event Loops", "18"),
        ("16. AWS Infrastructure Topology & Deployment", "19"),
        ("17. Caching & Database Performance Scaling", "20"),
        ("18. Security Architecture & Threat Vectors", "20"),
        ("19. Roadmap & Technology Milestones", "21"),
        ("20. System Telemetry: Monitoring & Logging", "22"),
        ("21. DevOps: CI/CD Delivery Pipeline", "22"),
        ("22. Future Desktop & Mobile Architectures", "23"),
        ("23. Conclusion & Technical Diligence Summary", "24"),
    ]
    
    toc_table_data = []
    for section, page in toc_items:
        dot_leader = ". " * 32
        p_sec = Paragraph(f"{section} <font color='#CBD5E1'>{dot_leader}</font>", toc_label_style)
        p_page = Paragraph(page, toc_page_style)
        toc_table_data.append([p_sec, p_page])
        
    toc_table = Table(toc_table_data, colWidths=[450, 54])
    toc_table.setStyle(TableStyle([
        ('BOTTOMPADDING', (0,0), (-1,-1), 4),
        ('TOPPADDING', (0,0), (-1,-1), 4),
        ('LEFTPADDING', (0,0), (-1,-1), 0),
        ('VALIGN', (0,0), (-1,-1), 'BOTTOM'),
    ]))
    
    story.append(toc_table)
    story.append(PageBreak())

    # =========================================================================
    # 1. Executive Summary & Core Platform Vision
    # =========================================================================
    story.append(Paragraph("1. Executive Summary & Core Platform Vision", style_h1))
    story.append(Paragraph(
        "Clozflow is an enterprise-grade, real-time AI Sales Intelligence Platform designed to transform high-stakes B2B sales cycles. "
        "Historically, B2B sales teams have suffered from high friction, low-quality personalization, and delayed feedback loops. "
        "Traditional solutions act as passive databases (e.g., standard CRM records) or post-facto call transcription recorders. "
        "Clozflow disrupts this paradigm by operating as a proactive, **in-context sales copilot** that works directly where modern transactions take place: inside messaging and email clients like WhatsApp Web, LinkedIn, Gmail, and Outlook.",
        style_body
    ))
    story.append(Paragraph(
        "At the core of Clozflow is a proprietary **decoupled Hybrid ML-LLM orchestrator**. "
        "By utilizing light-weight, highly-optimized, offline-trained machine learning classifiers to determine high-level sales strategies in under <b>50ms</b>, "
        "Clozflow bypasses the high latency, instability, and extreme cost overhead of using LLMs for real-time conversation analysis. "
        "The LLM is invoked strictly as a natural language compiler, taking strategy outputs, user configuration parameters, and FAISS-retrieved case study contexts to generate highly tailored responses. "
        "The system guarantees response suggestion delivery under 500ms over persistent WebSockets, ensuring zero conversational delay during live negotiations.",
        style_body
    ))
    story.append(make_callout(
        "Clozflow is deployed as a lightweight Chrome Extension client that communicates with a high-concurrency FastAPI ASGI backend. "
        "The backend coordinates offline classification models, vector-embedded sales playbooks, and state management variables to keep track of sales objections and commitments in real-time.",
        "EXECUTIVE SUMMARY BRIEF"
    ))
    story.append(Spacer(1, 10))

    # =========================================================================
    # 2. Market Opportunities & Problem Definition
    # =========================================================================
    story.append(Paragraph("2. Market Opportunities & Problem Definition", style_h1))
    story.append(Paragraph(
        "Modern enterprise sales are fast-paced, multi-channel, and highly sensitive to response delay. "
        "Sales executives spend over 60% of their working hours on administrative overhead: researching company profiles, analyzing website SEO gaps, and manually drafts outreach templates. "
        "Despite this time investment, outbound outreach response rates have collapsed to an all-time low (<1%) due to generic AI template spam. "
        "Furthermore, once a prospect begins a conversation, sales teams lack immediate, on-the-spot guidance to navigate objections relating to pricing, authority, and deployment timelines.",
        style_body
    ))
    story.append(Paragraph(
        "Current market offerings suffer from major architectural bottlenecks:",
        style_body_bold
    ))
    
    problem_data = [
        ["Structural Bottleneck", "Impact on Conversation Flow"],
        ["Inability to Operate Real-Time", "Legacy conversation coaching tools (e.g., Gong, Chorus) run asynchronously. They process call logs after the conversation terminates. By the time coaching feedback is delivered, the customer window has closed."],
        ["LLM Latency Overhead", "Standard LLM integrations require complex prompts that analyze transcripts and output responses in a single step. This results in 3-5 second latencies, which is completely unusable for live WhatsApp or LinkedIn messaging chats."],
        ["Generic Tone & Hallucinations", "Without grounding systems, standard generative AI tools produce fluffy, over-eager, or repetitive templates that prospects flag immediately as machine-written."],
        ["Data Fragmentation", "Prospect intelligence (e.g., website SEO gaps, social updates) is disconnected from the active chat sidebar, forcing reps to constantly cycle between multiple tabs during negotiation."]
    ]
    
    t_prob = create_wrapped_table(problem_data, [130, 374], style_table_header, style_table_cell)
    story.append(t_prob)
    story.append(PageBreak())

    # =========================================================================
    # 3. System Architecture Blueprint
    # =========================================================================
    story.append(Paragraph("3. System Architecture Blueprint", style_h1))
    story.append(Paragraph(
        "The Clozflow platform operates on a distributed client-server model optimized for low-latency message loop processing. "
        "The frontend is a Manifest V3 browser extension injected into WhatsApp, LinkedIn, Gmail, and Outlook. "
        "The backend is a high-concurrency FastAPI application running in AWS ECS containers. "
        "The AI orchestration layer is decoupled: high-speed, local machine learning classifiers evaluate text strategies, while an asynchronous FAISS index retrieves playbooks, and Groq's Llama 3.3 handles text compilation.",
        style_body
    ))

    # Embed Overall Architecture Diagram
    img_arch = Image("documentation/assets/diag_overall_arch.png", width=450, height=262.5)
    story.append(img_arch)
    story.append(Paragraph("Figure 3.1: Clozflow Dual-Engine Hybrid ML-LLM High-Level Architecture", style_caption))
    
    story.append(Paragraph(
        "The primary data pipe begins when a prospect text message is captured by the extension's DOM listener or audio stream. "
        "This data is channeled over WebSockets to the FastAPI ASGI Gateway. "
        "The gateway initiates parallel workers: (1) Preprocessed tokens are fed into local Scikit-Learn models, predicting objection classification and customer sentiment in <50ms. "
        "(2) The token query is embedded and run against a static FAISS index to find relevant playbooks. "
        "(3) Both outputs populate a compressed template sent to Groq. "
        "A strict validation scorer scores the suggestion. If validated (>=0.85), it returns to the extension's React sidebar via WebSocket.",
        style_body
    ))
    story.append(PageBreak())

    # =========================================================================
    # 4. Core Platform Modules Deep-Dive
    # =========================================================================
    story.append(Paragraph("4. Core Platform Modules Deep-Dive", style_h1))
    story.append(Paragraph(
        "Clozflow's platform is divided into six functional software modules, each handling a distinct segment of the lead generation and conversion pipeline.",
        style_body
    ))

    story.append(Paragraph("4.1. Lead Intelligence Engine", style_h2))
    story.append(Paragraph(
        "This service is responsible for asynchronous lead discovery and profile enrichment. "
        "When a user runs a search query (e.g., 'restaurants in Austin'), the engine queries the Google Business Places API to retrieve business metadata (categories, rating, contact numbers, address). "
        "Once retrieved, a multi-threaded web scraper extracts the target site's metadata, tech footprint, and SEO configuration. "
        "Simultaneously, a social presence monitor scans active Instagram or LinkedIn handles to determine post frequency and brand engagement. "
        "A qualification script aggregates these inputs to compute a Lead Score (1-100), identify business pain points, and output structured outreach suggestions.",
        style_body
    ))

    story.append(Paragraph("4.2. Outreach Studio Engine", style_h2))
    story.append(Paragraph(
        "The Outreach Studio handles outbound copywriting personalization. "
        "Instead of templated emails, the module inspects the enriched lead record (categories, Google ratings, website flaws) and maps it against the user's target service offer. "
        "Using a trust-first framework, the AI drafts copy focusing on specific business observations (e.g., 'Noticed your website lacks a mobile booking widget'). "
        "It generates channel-specific copy (WhatsApp, Instagram DM, LinkedIn, Email) and computes a spam risk index and a reply probability rating.",
        style_body
    ))

    story.append(Paragraph("4.3. Browser Copilot", style_h2))
    story.append(Paragraph(
        "The Browser Copilot is the client-facing UI shell. "
        "Implemented as a Chrome Extension, it runs in the host browser context and dynamically injects a collapsible React sidebar into active messaging applications. "
        "The sidebar handles active authentication states, displays suggested response copy, shows objection alerts, and provides a click-to-fill button that pastes suggestions directly into the host input field. "
        "A service worker coordinates secure communication with the backend APIs via WebSockets and HTTP.",
        style_body
    ))
    
    story.append(PageBreak())

    story.append(Paragraph("4.4. Conversation Intelligence Engine", style_h2))
    story.append(Paragraph(
        "This engine processes active conversation turn flows. "
        "It acts as a real-time segmenter and decoder. "
        "In voice channels, it interfaces with Deepgram's streaming STT WebSocket to transcribe audio chunks, applying a 1.2s silence debounce to track speaker turn swaps. "
        "In chat channels, it receives incoming DOM texts, feeds them to the offline classification models to isolate buyer intent levels, maps objections, and identifies underlying Objections or Commitments.",
        style_body
    ))

    story.append(Paragraph("4.5. Cognitive Sales Brain", style_h2))
    story.append(Paragraph(
        "The Cognitive Sales Brain represents the system's reasoning orchestrator. "
        "It acts as the primary decider, taking output state variables from the classification layer, pulling corresponding playbooks from the FAISS database, and managing the dynamic context prompt. "
        "It maps the target objection class to one of five Canonical Sales Strategies:",
        style_body
    ))

    strategy_data = [
        ["Objection Strategy", "Behavioral Logic & Persuasion Focus"],
        ["ROI_REFRAME", "Triggered by pricing or budget concerns. Reframes cost into long-term operational savings and business value metrics."],
        ["RISK_REVERSAL", "Triggered by delay or postpone objections. Introduces free-trials, money-back guarantees, or phased rollouts."],
        ["STATUS_GAP", "Triggered by ego or 'we already have tools' objections. Focuses on specialized automation metrics and custom feature gaps."],
        ["DECISION_CONTROL", "Triggered by authority issues ('need partner approval'). Equips the rep with materials to pitch CFOs directly."],
        ["DIAGNOSTIC_QUESTION", "Triggered by skepticism or vague statements. Reverts with deep diagnostic questions to force objection clarity."]
    ]
    
    t_strat = create_wrapped_table(strategy_data, [130, 374], style_table_header, style_table_cell)
    story.append(t_strat)
    story.append(Spacer(1, 10))

    story.append(Paragraph("4.6. Session Memory Controller", style_h2))
    story.append(Paragraph(
        "This module manages transactional state variables throughout the conversation lifecycle. "
        "Unlike stateless APIs, the Session Memory controller tracks critical metrics like active intent level (0-100), trust score (0-100), commitments made, and unanswered questions. "
        "Upon session completion, it generates a summary and saves the structured logs in the relational database.",
        style_body
    ))
    story.append(PageBreak())

    # =========================================================================
    # 5. Microservices Boundary & Internal System Interfaces
    # =========================================================================
    story.append(Paragraph("5. Microservices Boundary & Internal System Interfaces", style_h1))
    story.append(Paragraph(
        "To ensure high availability and horizontal scaling, Clozflow uses microservices boundaries. "
        "The API Gateway routes traffic to localized Docker container services via a secure internal service mesh. "
        "State and cache management are distributed across a dedicated Redis memory cluster and RDS PostgreSQL databases.",
        style_body
    ))

    # Embed Microservices Diagram
    img_micro = Image("documentation/assets/diag_microservices.png", width=450, height=262.5)
    story.append(img_micro)
    story.append(Paragraph("Figure 5.1: Clozflow Distributed Microservices Boundaries", style_caption))
    
    story.append(Paragraph(
        "The internal system architecture decouples CPU-bound inference and scraper engines from memory-bound real-time WebSockets. "
        "The API Gateway acts as the first line of defense, validating JWT keys and rate-limiting incoming traffic. "
        "Services retrieve database connections via SQLAlchemy pools. "
        "The next figure illustrates the physical class design and module relationships of the FastAPI backend application.",
        style_body
    ))
    
    story.append(Spacer(1, 10))
    # Embed Backend Arch Diagram
    img_back = Image("documentation/assets/diag_backend_arch.png", width=450, height=262.5)
    story.append(img_back)
    story.append(Paragraph("Figure 5.2: FastAPI Backend Logical Module Diagram", style_caption))
    story.append(PageBreak())

    # =========================================================================
    # 6. Technology Stack & Directory Topography
    # =========================================================================
    story.append(Paragraph("6. Technology Stack & Directory Topography", style_h1))
    story.append(Paragraph(
        "Clozflow's technology stack is curated for maximum runtime efficiency, fast response speeds, and developer velocity. "
        "Below is a structured map of our technology cards followed by the workspace directory topography.",
        style_body
    ))

    # Tech Stack Table
    tech_data = [
        [
            Paragraph("<b>Frontend Framework</b><br/>React 18 / TypeScript / Vite<br/><font color='#475569'>High-speed SPA render inside extension sandboxes</font>", style_table_cell),
            Paragraph("<b>Backend Gateway</b><br/>FastAPI / Python 3.10+<br/><font color='#475569'>ASGI concurrency framework with async DB workers</font>", style_table_cell)
        ],
        [
            Paragraph("<b>Database Engines</b><br/>RDS PostgreSQL & SQLite<br/><font color='#475569'>SQLAlchemy ORM for transactional session logs</font>", style_table_cell),
            Paragraph("<b>Vector RAG Storage</b><br/>FAISS (Facebook AI Search)<br/><font color='#475569'>L2-distance vector store matching sales playbooks</font>", style_table_cell)
        ],
        [
            Paragraph("<b>Machine Learning Layer</b><br/>XGBoost / Scikit-Learn<br/><font color='#475569'>Offline-trained classification models (<50ms)</font>", style_table_cell),
            Paragraph("<b>State Cache Layer</b><br/>Redis Cache Memory<br/><font color='#475569'>Stores WebSocket routes and user session metrics</font>", style_table_cell)
        ],
        [
            Paragraph("<b>LLM Execution</b><br/>Groq Cloud Client / Llama 3.3<br/><font color='#475569'>70B model API optimized for speed and consultation copy</font>", style_table_cell),
            Paragraph("<b>Audio Transcription</b><br/>Deepgram SDK (Streaming STT)<br/><font color='#475569'>WebSocket stream client with 1.2s silence detection</font>", style_table_cell)
        ]
    ]
    t_tech = Table(tech_data, colWidths=[247, 247])
    t_tech.setStyle(TableStyle([
        ('BOX', (0,0), (-1,-1), 1.0, COLOR_PRIMARY),
        ('GRID', (0,0), (-1,-1), 0.5, COLOR_BORDER),
        ('VALIGN', (0,0), (-1,-1), 'TOP'),
        ('TOPPADDING', (0,0), (-1,-1), 8),
        ('BOTTOMPADDING', (0,0), (-1,-1), 8),
        ('LEFTPADDING', (0,0), (-1,-1), 10),
        ('RIGHTPADDING', (0,0), (-1,-1), 10),
        ('BACKGROUND', (0,0), (-1,-1), COLOR_LIGHT_BG),
    ]))
    story.append(t_tech)
    story.append(Spacer(1, 15))

    story.append(Paragraph("6.1. Workspace Directory Topography", style_h2))
    story.append(Paragraph(
        "The codebase is structured to isolate offline model training from active API services, "
        "allowing AI engineers to retrain and test models without affecting the core API server.",
        style_body
    ))
    
    dir_structure_code = """Clozflow/
├── backend/                  # FastAPI Application Server
│   ├── main.py               # WS Entrypoint & App Configuration
│   ├── database.py           # DB Connection Setup & Base Metadata
│   ├── models.py             # SQLAlchemy Database Tables Definition
│   ├── routers/              # Controllers (auth, leads, outreach)
│   ├── services/             # Core Services (AI Brain, WS Manager)
│   └── requirements.txt      # API Server dependencies
├── extension/                # Browser Extension Manifest V3 files
│   ├── manifest.json         # Extension permissions & rules
│   ├── background.js         # Service Worker background broker
│   ├── content.js            # DOM monitoring & UI injection script
│   └── styles/               # CSS overrides for active host pages
├── ml/                       # Offline Machine Learning Layer
│   ├── inference/            # Prediction models (XGBoost/LR)
│   ├── training/             # Retraining loops & logs
│   └── utils/                # Preprocessing and TF-IDF tokenizers
└── rag/                      # FAISS Retrieval and prompt packaging
    └── faiss_index.bin       # Local vector file of playbooks"""
    
    story.append(make_code_block(dir_structure_code))
    story.append(PageBreak())

    # =========================================================================
    # 7. Relational Database Design
    # =========================================================================
    story.append(Paragraph("7. Relational Database Design", style_h1))
    story.append(Paragraph(
        "Clozflow uses an SQLAlchemy-mapped relational database schema (configured for PostgreSQL in production and SQLite for local development). "
        "The schema handles user metadata, saved leads, historical call logs, and active copilot session variables.",
        style_body
    ))

    # User Table
    story.append(Paragraph("Table: users", style_h2))
    db_users_data = [
        ["Column Name", "Data Type", "Constraints", "Description"],
        ["id", "Integer", "Primary Key, Index", "Unique identifier for the user."],
        ["email", "String", "Unique, Index, Required", "User email address used for login authentication."],
        ["password_hash", "String", "Required", "Bcrypt password hash string."],
        ["company_name", "String", "Nullable", "User's business name for custom prompt context."],
        ["role", "String", "Nullable", "User's job title / profile within their company."],
        ["sales_style", "String", "Default: 'Controlled Challenge'", "Tone guide for the generated responses."],
        ["ai_tone", "String", "Default: 'assertive'", "Preferred tone (assertive, warm, diagnostic, etc.)"]
    ]
    t_db_users = create_wrapped_table(db_users_data, [100, 70, 110, 224], style_table_header, style_table_cell)
    story.append(t_db_users)
    story.append(Spacer(1, 10))

    # Lead Table
    story.append(Paragraph("Table: leads", style_h2))
    db_leads_data = [
        ["Column Name", "Data Type", "Constraints", "Description"],
        ["id", "Integer", "Primary Key, Index", "Unique identifier for the lead."],
        ["business_name", "String", "Index, Required", "Name of the business lead."],
        ["website", "String", "Nullable", "Business URL (enriched by scraping engine)."],
        ["google_rating", "String", "Nullable", "Google Places rating (stored as string)."],
        ["ai_summary", "Text", "Nullable", "Structured summary of business profile."],
        ["likely_pain_point", "Text", "Nullable", "Identified operational paint point."],
        ["lead_score", "Integer", "Default: 0", "Qualification rating calculated by scoring model."]
    ]
    t_db_leads = create_wrapped_table(db_leads_data, [100, 70, 110, 224], style_table_header, style_table_cell)
    story.append(t_db_leads)
    story.append(Spacer(1, 10))

    # CopilotSession Table
    story.append(Paragraph("Table: copilot_sessions", style_h2))
    db_sessions_data = [
        ["Column Name", "Data Type", "Constraints", "Description"],
        ["id", "Integer", "Primary Key, Index", "Unique session identifier."],
        ["user_id", "Integer", "Foreign Key -> users.id", "Owner of the active sales session."],
        ["lead_id", "Integer", "Foreign Key -> leads.id", "Associated lead profile."],
        ["platform", "String", "Required (whatsapp/etc)", "Target app (WhatsApp, LinkedIn, Gmail, Outlook)."],
        ["conversation_summary", "Text", "Nullable", "JSON string containing summary memory arrays."],
        ["buying_intent", "Integer", "Default: 0", "Buyer intent metric (scale 0-100)."],
        ["trust_score", "Integer", "Default: 0", "Trust level metric (scale 0-100)."],
        ["stage", "String", "Default: 'initial_contact'", "Sales stage: discovery, presentation, objection, closing."],
        ["objections", "Text", "Nullable", "JSON list of objections detected in session."]
    ]
    t_db_sessions = create_wrapped_table(db_sessions_data, [100, 70, 110, 224], style_table_header, style_table_cell)
    story.append(t_db_sessions)
    story.append(PageBreak())

    # =========================================================================
    # 8. API Gateway Design & Authentication Flows
    # =========================================================================
    story.append(Paragraph("8. API Gateway Design & Authentication Flows", style_h1))
    story.append(Paragraph(
        "The FastAPI backend exposes standard REST endpoints for authentication, lead management, outreach generation, and session analysis. "
        "Secure endpoints require a valid JWT bearer token in the authorization header (passed as 'Bearer <token>').",
        style_body
    ))

    # API Routes Table
    api_data = [
        ["Method", "Endpoint", "Auth Required", "Description & Payload"],
        ["POST", "/auth/register", "No", "Creates a new user profile. Takes email, password, and registration fields."],
        ["POST", "/auth/login", "No", "Returns JWT access token if password verification passes."],
        ["POST", "/leads/search", "Yes", "Queries leads database with opportunity qualification scoring. Payload: LeadSearchRequest."],
        ["POST", "/leads/save", "Yes", "Saves a discovered lead record. Payload: LeadSaveRequest."],
        ["GET", "/leads/saved", "Yes", "Returns all saved leads sorted by qualification rating."],
        ["POST", "/outreach/generate", "Yes", "Generates personalized outreach copy for specific social channel. Payload: OutreachGenerateRequest."],
        ["POST", "/api/copilot/session/start", "Yes", "Initializes a copilot session for a lead. Payload: SessionStartRequest."],
        ["POST", "/api/copilot/session/{id}/analyze", "Yes", "Analyzes inbound messages and generates reply suggestions. Payload: AnalyzeRequest."]
    ]
    t_api = create_wrapped_table(api_data, [45, 140, 80, 239], style_table_header, style_table_cell)
    story.append(t_api)
    story.append(Spacer(1, 10))

    story.append(Paragraph("8.1. End-to-End Live Interaction Sequence Flow", style_h2))
    story.append(Paragraph(
        "When an incoming message is received, the extension triggers a sequence of calls across background tasks, "
        "event brokers, and machine learning modules. Below is the sequence timeline.",
        style_body
    ))
    
    # Embed Sequence Diagram
    img_seq = Image("documentation/assets/diag_sequence.png", width=450, height=262.5)
    story.append(img_seq)
    story.append(Paragraph("Figure 8.1: Real-time Response Generation Sequence Flow", style_caption))
    story.append(PageBreak())

    # =========================================================================
    # 9. Real-Time WebSocket Communication
    # =========================================================================
    story.append(Paragraph("9. Real-Time WebSocket Communication", style_h1))
    story.append(Paragraph(
        "For voice call sessions (e.g., dialer co-piloting), REST APIs introduce high latency. "
        "Clozflow resolves this by routing audio streams and prompt responses over a persistent WebSocket connection `/ws` managed by FastAPI.",
        style_body
    ))
    story.append(Paragraph(
        "The connection lifecycle follows a structured protocol:",
        style_body_bold
    ))
    
    lifecycle_data = [
        ["Connection Phase", "Detailed Operational Sequence"],
        ["1. Connection & Handshake", "The extension background worker initiates a handshake with backend `/ws` route. The backend validates session credentials and spawns a manager connection session."],
        ["2. Metadata Injection", "The client sends a JSON start payload indicating caller details, call goals, and prospect metadata. The backend loads these into the session context engine."],
        ["3. Binary Audio Stream", "The client captures mic/system audio and streams binary PCM chunks to the backend WebSocket. The backend routes these to Deepgram's streaming STT service."],
        ["4. Turn Debouncing", "Deepgram sends transcribed text blocks back to the backend. The backend monitors silence flags. A 1.2s silence debounce triggers segment classification."],
        ["5. Orchestrated Suggestion", "The backend runs the ML objection classifier and FAISS playbook queries, constructs the LLM prompt, and returns suggestions to the extension UI."]
    ]
    t_life = create_wrapped_table(lifecycle_data, [130, 374], style_table_header, style_table_cell)
    story.append(t_life)
    story.append(Spacer(1, 10))

    story.append(Paragraph("9.1. ASGI Runtime Concurrency Model", style_h2))
    story.append(Paragraph(
        "FastAPI coordinates these tasks asynchronously. CPU-heavy tasks are offloaded to background threads "
        "to prevent blocking the main asyncio event loop.",
        style_body
    ))

    # Embed Runtime Architecture Diagram
    img_run = Image("documentation/assets/diag_runtime_arch.png", width=450, height=262.5)
    story.append(img_run)
    story.append(Paragraph("Figure 9.1: ASGI Event Loop and Thread Pool Concurrency Mapping", style_caption))
    story.append(PageBreak())

    # =========================================================================
    # 10. Lead Intelligence Pipeline & Data Enrichment
    # =========================================================================
    story.append(Paragraph("10. Lead Intelligence Pipeline & Data Enrichment", style_h1))
    story.append(Paragraph(
        "The Lead Intelligence Pipeline enrichment model takes a search query, retrieves raw metadata, "
        "scrapes host pages, reads user reviews sentiment, and runs opportunity scoring. The pipeline is illustrated below.",
        style_body
    ))

    # Embed Research Pipeline Diagram
    img_res = Image("documentation/assets/diag_research_pipeline.png", width=450, height=262.5)
    story.append(img_res)
    story.append(Paragraph("Figure 10.1: Lead Intelligence Research and Enrichment Pipeline", style_caption))
    
    story.append(Paragraph(
        "Data scraping and parsing are parallelized. The target site is analyzed for technical indicators "
        "like Google Analytics tags, slow loading times, or SEO vulnerabilities. Review text is checked "
        "to identify customer complaints. The LLM uses these inputs to score target fit.",
        style_body
    ))
    story.append(Spacer(1, 10))

    # =========================================================================
    # 11. Browser Copilot Flow & DOM Parsing
    # =========================================================================
    story.append(Paragraph("11. Browser Copilot Flow & DOM Parsing", style_h1))
    story.append(Paragraph(
        "The Browser Copilot injects content scripts (`content.js`) into target communication pages. "
        "These content scripts inspect DOM structures to detect incoming chat messages, identify the contact name, "
        "and inject suggestion cards directly into the sidebar iframe.",
        style_body
    ))

    # Embed Browser Extension Architecture Diagram
    img_ext = Image("documentation/assets/diag_extension.png", width=450, height=262.5)
    story.append(img_ext)
    story.append(Paragraph("Figure 11.1: Browser Extension (Manifest V3) Internal Sandbox and DOM Communication", style_caption))
    
    story.append(Paragraph(
        "The extension's background worker acts as the central link, maintaining active connection status, "
        "caching authentication details, and managing tabs. This isolates the page DOM from backend API endpoints.",
        style_body
    ))
    story.append(PageBreak())

    # =========================================================================
    # 12. AI Request Lifecycle & SLA Protection Guardrails
    # =========================================================================
    story.append(Paragraph("12. AI Request Lifecycle & SLA Protection Guardrails", style_h1))
    story.append(Paragraph(
        "A key design pattern in Clozflow is SLA latency protection. "
        "Live sales chats cannot tolerate long API load delays. "
        "If the LLM call stalls or fails, the gateway interrupts the request and serves a pre-computed fallback response.",
        style_body
    ))

    # Embed AI Request Flow Diagram
    img_aiflow = Image("documentation/assets/diag_ai_request_flow.png", width=450, height=262.5)
    story.append(img_aiflow)
    story.append(Paragraph("Figure 12.1: Asynchronous AI Request Lifecycle and SLA Fallback Routing", style_caption))
    
    story.append(Paragraph(
        "The fallback engine uses the predicted objection strategy to serve a matching script. "
        "If a pricing objection is identified, the fallback suggestion handles it directly, ensuring continuous co-piloting. "
        "Suggestions are processed through a detox and anti-repetition filter before delivery.",
        style_body
    ))
    story.append(PageBreak())

    # =========================================================================
    # 13. Conversation Intelligence & Turn Tracking
    # =========================================================================
    story.append(Paragraph("13. Conversation Intelligence & Turn Tracking", style_h1))
    story.append(Paragraph(
        "The Conversation Intelligence Engine tracks conversation turns and emotional indicators. "
        "It determines when a prospect turn finishes, processes the transcript, identifies objections, and generates response suggestions.",
        style_body
    ))

    # Embed Conversation Pipeline Diagram
    img_conv = Image("documentation/assets/diag_conversation_pipeline.png", width=450, height=262.5)
    story.append(img_conv)
    story.append(Paragraph("Figure 13.1: Conversation turn tracker and evaluation pipeline", style_caption))
    
    story.append(Paragraph(
        "The pipeline routes incoming text through three parallel blocks: (1) XGBoost classifier checks for objections, "
        "(2) keyword analysis detects emotional status, and (3) FAISS retrieves playbook resources. "
        "These are combined by the Cognitive Sales Brain into a compressed prompt template.",
        style_body
    ))
    story.append(Spacer(1, 10))

    # =========================================================================
    # 14. Dual-State Memory Architecture
    # =========================================================================
    story.append(Paragraph("14. Dual-State Memory Architecture", style_h1))
    story.append(Paragraph(
        "Clozflow uses a layered memory design to coordinate temporary user inputs, active session metrics, and historical logs.",
        style_body
    ))

    # Embed Memory Architecture Diagram
    img_mem = Image("documentation/assets/diag_memory_arch.png", width=450, height=262.5)
    story.append(img_mem)
    story.append(Paragraph("Figure 14.1: Multi-tiered Session and Vector Memory Architecture", style_caption))
    
    story.append(Paragraph(
        "Memory is divided into three tiers: (1) Ephemeral Memory caches recent inputs and transcripts. "
        "(2) Transactional Memory saves active conversation variables in the relational database. "
        "(3) Long-Term Vector Memory indexes historical logs for semantic search lookup.",
        style_body
    ))
    
    story.append(Spacer(1, 10))
    # Embed Session State machine Diagram
    img_sess = Image("documentation/assets/diag_session_arch.png", width=450, height=262.5)
    story.append(img_sess)
    story.append(Paragraph("Figure 14.2: Session State Machine and Global Variables Registry", style_caption))
    story.append(PageBreak())

    # =========================================================================
    # 15. Runtime ASGI Concurrency & Event Loops
    # =========================================================================
    story.append(Paragraph("15. Runtime ASGI Concurrency & Event Loops", style_h1))
    story.append(Paragraph(
        "Clozflow's runtime architecture is optimized to support hundreds of concurrent sales representatives. "
        "By leveraging FastAPI's native async capabilities on top of Uvicorn, every networking I/O operation "
        "(database queries, API calls, WebSocket frames) runs without blocking the server processes.",
        style_body
    ))
    story.append(Paragraph(
        "Heavy computational workloads (like text preprocessing, TF-IDF vectorization, and XGBoost classifier runs) "
        "are run in an isolated ThreadPoolExecutor. This separates CPU-bound tasks from active WebSockets, preventing connection drops.",
        style_body
    ))
    story.append(make_callout(
        "WebSocket connections are mapped in an active in-memory connection registry (`websocket_manager.py`). "
        "If a client disconnects, the manager triggers a cleanup step, updating the active session state "
        "and closing SQLAlchemy connections to prevent pool exhaustion.",
        "RUNTIME SLA MANAGEMENT"
    ))
    story.append(Spacer(1, 10))

    # =========================================================================
    # 16. AWS Infrastructure Topology & Deployment
    # =========================================================================
    story.append(Paragraph("16. AWS Infrastructure Topology & Deployment", style_h1))
    story.append(Paragraph(
        "Clozflow is deployed on AWS using containerized microservices managed by ECS Fargate. "
        "The infrastructure setup prioritizes security isolation and high availability across multiple availability zones.",
        style_body
    ))

    # Embed Deployment Diagram
    img_deploy = Image("documentation/assets/diag_deployment.png", width=450, height=262.5)
    story.append(img_deploy)
    story.append(Paragraph("Figure 16.1: Containerized AWS Multi-AZ Deployment Topology", style_caption))
    
    story.append(Paragraph(
        "VPC ingress runs through a Cloudflare CDN and AWS Application Load Balancer. "
        "ECS tasks run in private subnets, while RDS databases and Redis caches are isolated in dedicated subnets. "
        "External integrations connect via secure NAT Gateways.",
        style_body
    ))
    story.append(PageBreak())

    # =========================================================================
    # 17. Caching & Database Performance Scaling
    # =========================================================================
    story.append(Paragraph("17. Caching & Database Performance Scaling", style_h1))
    story.append(Paragraph(
        "To maintain low latency under high load, Clozflow uses a distributed caching strategy. "
        "Active session variables, emotion tags, and recent transcript segments are cached in a Redis cluster with an expiration window. "
        "This reduces relational database read overhead by up to 80%.",
        style_body
    ))
    story.append(Paragraph(
        "Database scaling patterns include:",
        style_body_bold
    ))
    
    scale_patterns = [
        ["Optimization Pattern", "Detailed Engineering Implementation"],
        ["Connection Pooling", "FastAPI uses SQLAlchemy's QueuePool. It maintains 20 permanent database connections with a overflow limit of 10, avoiding connection overhead on incoming requests."],
        ["Read-Write Segregation", "Write transactions route to the RDS PostgreSQL Primary database node. Read queries (such as saved leads lists or user profile configs) run against RDS Read Replicas."],
        ["Index Optimization", "High-frequency query columns (like user_id, lead_id, active session statuses) are indexed to ensure quick lookup times (<5ms)."],
        ["FAISS Local Memory Cache", "The vector playbook index is loaded directly into the server's memory context on startup, enabling sub-millisecond search times."]
    ]
    t_scale = create_wrapped_table(scale_patterns, [130, 374], style_table_header, style_table_cell)
    story.append(t_scale)
    story.append(Spacer(1, 10))

    # =========================================================================
    # 18. Security Architecture & Threat Vectors
    # =========================================================================
    story.append(Paragraph("18. Security Architecture & Threat Vectors", style_h1))
    story.append(Paragraph(
        "Clozflow processes sensitive B2B conversation transcripts and client details. "
        "We implement security policies at every layer of the system architecture:",
        style_body
    ))
    story.append(Paragraph(
        "• Transport Layer Security: All REST requests and WebSocket connections are encrypted using TLS 1.3 (HTTPS/WSS).<br/>"
        "• JWT Authentication: API access requires a signed JWT access token in the authorization header.<br/>"
        "• DOM Access Isolation: The browser extension's UI runs inside a sandboxed iframe. This isolates the host page's DOM context, protecting user credentials.<br/>"
        "• AI Safety Detox Filters: Generated replies are processed through filters to strip conversational filler and prevent inappropriate content generation.<br/>"
        "• Database Encryption: Customer data and access tokens are encrypted at rest using AES-256.",
        style_body
    ))
    
    story.append(Spacer(1, 10))
    story.append(Paragraph("18.1. Environment Configuration Template (Sanitized)", style_h2))
    story.append(Paragraph(
        "Clozflow manages production application variables using environment configurations. "
        "To ensure security during deployment, no active API keys or database passwords reside in the primary codebase. "
        "The following template details a sanitized environment configuration setup safe for public audits:",
        style_body
    ))

    # Sanitized env config block
    env_config_template = """# Clozflow Application Configuration Template (Sanitized)
# SECURITY NOTE: Never commit active keys to version control.

# Gateway Server Configuration
HOST=0.0.0.0
PORT=8000
ENVIRONMENT=production

# Security & JWT Tokens Configuration
JWT_SECRET=cz_secret_fallback_sha256_placeholder_key_for_public_review
ACCESS_TOKEN_EXPIRE_MINUTES=1440

# Database Storage Connections (Redacted AWS Host)
DATABASE_URL=postgresql://cz_user:******@rds-cluster-id.us-east-1.rds.amazonaws.com/cz_prod

# Redis Cache Cluster (Redacted ElastiCache Host)
REDIS_URL=redis://redis-cluster-id.cache.amazonaws.com:6379/0

# 3rd-Party SaaS API Keys (Redacted Production Keys)
DEEPGRAM_API_KEY=dg_live_****************************************
GROQ_API_KEY=gsk_****************************************"""

    story.append(make_code_block(env_config_template))
    story.append(PageBreak())

    # =========================================================================
    # 19. Roadmap & Technology Milestones
    # =========================================================================
    story.append(Paragraph("19. Roadmap & Technology Milestones", style_h1))
    story.append(Paragraph(
        "Clozflow's product development is divided into seven phases, scaling the platform "
        "from its current MVP status to a fully integrated B2B sales intelligence engine.",
        style_body
    ))

    # Embed Roadmap Diagram
    img_road = Image("documentation/assets/diag_roadmap.png", width=450, height=262.5)
    story.append(img_road)
    story.append(Paragraph("Figure 19.1: Clozflow Multi-Phase Technology Convergence Roadmap", style_caption))
    
    story.append(Paragraph(
        "Development milestones focus on expanding channel integrations, improving classification models, "
        "and building enterprise-grade analytics interfaces. Retraining logs support continuous performance tuning.",
        style_body
    ))
    story.append(Spacer(1, 10))

    # =========================================================================
    # 20. System Telemetry: Monitoring & Logging
    # =========================================================================
    story.append(Paragraph("20. System Telemetry: Monitoring & Logging", style_h1))
    story.append(Paragraph(
        "The Clozflow backend uses structural logging to monitor system health and AI performance. "
        "Every request is logged with its duration and scoring outputs.",
        style_body
    ))
    story.append(Paragraph(
        "We monitor three critical telemetry categories:",
        style_body_bold
    ))
    
    telemetry_data = [
        ["Telemetry Focus", "Engineering Deployment Configuration"],
        ["System Performance", "AWS CloudWatch tracks container CPU metrics, memory utilization, and network load. Redis memory limits are monitored to manage active cache instances."],
        ["LLM API Latency & SLA Errors", "Prometheus monitors LLM request durations and error rates. If 95th percentile latency exceeds 12.0 seconds, alerts trigger fallback audits."],
        ["Coaching Quality Validation", "Interactions are recorded with their validation score. Responses scoring >=0.85 are logged to build a dataset for subsequent model retraining, while low-scoring interactions are flagged for review."]
    ]
    t_tel = create_wrapped_table(telemetry_data, [130, 374], style_table_header, style_table_cell)
    story.append(t_tel)
    story.append(PageBreak())

    # =========================================================================
    # 21. DevOps: CI/CD Delivery Pipeline
    # =========================================================================
    story.append(Paragraph("21. DevOps: CI/CD Delivery Pipeline", style_h1))
    story.append(Paragraph(
        "Clozflow uses automated Git-triggered pipelines to manage code deployments, run test suites, "
        "and deploy Docker containers to the staging and production environments.",
        style_body
    ))
    story.append(Paragraph(
        "The build and release cycle consists of four continuous steps:",
        style_body_bold
    ))
    
    cicd_data = [
        ["Pipeline Step", "System Actions & Validation Checks"],
        ["1. Commit & Test", "Developers push features to GitHub. A GitHub Actions runner triggers pytest runs, runs flake8 linter checks, and verifies model weights formats."],
        ["2. Container Build", "If tests pass, the pipeline builds the FastAPI Docker container, tags the image, and uploads it to Amazon Elastic Container Registry (ECR)."],
        ["3. Staging Promotion", "The pipeline deploys the new image to the staging ECS task cluster, runs integration tests against a mock database, and verifies WebSocket stability."],
        ["4. Production Release", "Upon authorization, the pipeline triggers a rolling update on the production ECS service task cluster. It maintains active tasks to ensure zero-downtime deployments."]
    ]
    t_cicd = create_wrapped_table(cicd_data, [130, 374], style_table_header, style_table_cell)
    story.append(t_cicd)
    story.append(Spacer(1, 10))

    # =========================================================================
    # 22. Future Desktop & Mobile Architectures
    # =========================================================================
    story.append(Paragraph("22. Future Desktop & Mobile Architectures", style_h1))
    story.append(Paragraph(
        "To support sales channels outside the web browser, Clozflow's architecture is designed "
        "to accommodate future native desktop and mobile companion applications.",
        style_body
    ))
    story.append(Paragraph(
        "• Native Desktop Agent: Will leverage Electron or Rust (Tauri) to capture global audio output on Windows/macOS. "
        "This allows Clozflow to co-pilot calls on Zoom, Microsoft Teams, and native dialers by connecting directly to system sound drivers.<br/>"
        "• Mobile Companion App: A Flutter-based mobile application is planned to sync active WhatsApp Web chats on iOS and Android. "
        "It will feature a custom keyboard extension to insert suggested responses directly into mobile messaging fields.",
        style_body
    ))
    story.append(Spacer(1, 10))

    # =========================================================================
    # 23. Conclusion & Technical Diligence Summary
    # =========================================================================
    story.append(Paragraph("23. Conclusion & Technical Diligence Summary", style_h1))
    story.append(Paragraph(
        "Clozflow's decoupled hybrid architecture offers a highly scalable solution for real-time B2B sales intelligence. "
        "By combining low-latency local classifiers with vector playbooks and dynamic prompt templates, "
        "the platform delivers fast, relevant response suggestions during active negotiations.",
        style_body
    ))
    story.append(Paragraph(
        "With database schemas, WebSocket integrations, and containerized deployment structures in place, "
        "Clozflow is architected to scale from its current MVP status to a comprehensive enterprise B2B sales platform.",
        style_body
    ))
    story.append(Spacer(1, 15))
    story.append(Paragraph("<b>[END OF SPECIFICATION - DOCUMENT CLASSIFICATION: PUBLIC AUDIT EDITION]</b>", ParagraphStyle('EndDoc', fontName=font_bold, fontSize=10, leading=12, textColor=COLOR_PRIMARY, alignment=1)))

    # Build the document
    doc.build(story, canvasmaker=NumberedCanvas)
    print(f"Technical PDF generated successfully at {pdf_path}")

if __name__ == "__main__":
    build_pdf()
