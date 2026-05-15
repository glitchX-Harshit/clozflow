<!-- PROJECT SHIELDS -->
<div align="center">

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](https://opensource.org/licenses/MIT)
[![Version](https://img.shields.io/badge/version-2.0.0-orange.svg)]()
[![React](https://img.shields.io/badge/React-18-61DAFB.svg?logo=react&logoColor=black)](https://reactjs.org/)
[![FastAPI](https://img.shields.io/badge/FastAPI-0.100.0-05998b.svg?logo=fastapi&logoColor=white)](https://fastapi.tiangolo.com/)
[![Python](https://img.shields.io/badge/Python-3.10+-3776AB.svg?logo=python&logoColor=white)](https://www.python.org/)
[![Vite](https://img.shields.io/badge/Vite-5-646CFF.svg?logo=vite&logoColor=white)](https://vitejs.dev/)

</div>

<br />

<div align="center">
  <h1 align="center">✦ hexagon.ai</h1>
  <p align="center">
    <strong>The Future of High-Stakes Sales Intelligence</strong>
    <br />
    A real-time, RAG-powered AI orchestrator that detects objections, applies psychological persuasion strategies, and closes deals.
  </p>
</div>

---

## 💎 The Vision

**hexagon.ai** is not a simple call logger—it's a high-fidelity **Sales Co-Pilot**. It listens to live conversations, processes them through a multi-layered AI pipeline, and provides actionable, psychologically-backed responses in real-time.

Built for high-pressure environments where every word counts, Hexagon combines ultra-low latency transcription with a sophisticated **Persuasion Engine** that rotates through advanced sales frameworks (The Social Proof Push, The Scarcity Lever, Future Pacing) to steer conversations toward a close.

---

## 🚀 Key Capabilities

- **🧠 Multi-Layered Persuasion Engine:** Dynamically switches between 7+ sales strategies based on conversation sentiment and prospect hesitation.
- **⚡ Real-Time RAG (FAISS):** Instantly retrieves company-specific knowledge, case studies, and technical specs from a vector-embedded knowledge base.
- **🎯 Objection Detection:** proprietary algorithms flag pricing concerns, competitor comparisons, and "hidden" hesitations before they derail the deal.
- **✨ Awwwards-Level UI:** A premium React dashboard featuring GSAP animations, glassmorphism, and a sophisticated "Cream & Dark" aesthetic.
- **🔄 Live WebSocket Pipeline:** Seamless integration between Deepgram (Audio), FastAPI (Logic), and React (UI) for sub-500ms latency.

---

## 🛠 Tech Stack

### Frontend
- **Framework:** React 18 (Vite)
- **Animation:** GSAP (ScrollTrigger & Physics)
- **Physics:** Matter.js for interactive UI elements
- **State Management:** React Context API + Custom Hooks
- **Icons:** Lucide React

### Backend
- **Core:** FastAPI (Python 3.10+)
- **AI/ML:** OpenAI GPT-4o, Deepgram (Streaming Speech-to-Text)
- **Vector DB:** FAISS for RAG (Retrieval-Augmented Generation)
- **Database:** SQLite (SQLAlchemy ORM)
- **Communication:** WebSockets for real-time data streaming

---

## 📂 Project Structure

```text
hexagon/
├── 📂 backend/               # FastAPI Backend Logic
│   ├── 📄 main.py            # Entry point & WebSocket orchestrator
│   ├── 📂 services/          # Core AI & Business logic
│   │   ├── 🧠 sales_ai_engine.py      # Main AI decision maker
│   │   ├── 🎭 persuasion_engine.py   # Strategy rotation logic
│   │   ├── 🔍 conversation_analyzer.py # Sentiment & Intent detection
│   │   └── 🎙️ deepgram_stream.py      # Real-time transcription service
│   ├── 📂 routers/           # API endpoints (Auth, Analytics, Leads)
│   ├── 📂 data/              # JSON-based playbooks & static assets
│   ├── 📄 models.py          # Database schemas
│   └── 📄 requirements.txt   # Python dependencies
├── 📂 frontend/              # React + Vite Frontend
│   ├── 📂 src/
│   │   ├── 📂 components/    # Reusable UI (Dashboard, Hero, Loader)
│   │   ├── 📂 context/       # Auth & Global State
│   │   ├── 📂 pages/         # View compositions
│   │   └── 📄 index.css      # Premium design system tokens
│   └── 📄 package.json       # JS dependencies
├── 📂 rag/                   # Retrieval-Augmented Generation
│   ├── 📄 rag_engine.py      # FAISS integration & Query logic
│   └── 📄 faiss_index.bin    # Vectorized knowledge base
├── 📂 yaml_folder/           # Strategy Configurations
│   ├── 📄 pschofancy_v2.yaml # Psychological triggers
│   └── 📄 uxFunnel.yaml      # UI/UX interaction maps
├── 📂 test/                  # QA & Simulation
│   ├── 📄 simulator.py       # Live call simulation script
│   └── 📄 scenarios.json     # Test cases for sales objections
└── 📄 README.md              # Documentation
```

---

## ⚡ Getting Started

### Prerequisites
- Python 3.10+
- Node.js 18+
- OpenAI API Key
- Deepgram API Key

### Installation

1. **Clone the Repository**
   ```bash
   git clone https://github.com/glitchX-Harshit/sales-XAM-.git
   cd Hexagon
   ```

2. **Setup Backend**
   ```bash
   cd backend
   python -m venv .venv
   source .venv/bin/activate # or .venv\Scripts\activate on Windows
   pip install -r requirements.txt
   python main.py
   ```

3. **Setup Frontend**
   ```bash
   cd ../frontend
   npm install
   npm run dev
   ```

---

## 🎯 Contributing

We welcome contributions from the community! Whether it's a bug fix, a new sales strategy, or a UI enhancement, feel free to open a PR.

1. Fork the Project
2. Create your Feature Branch (`git checkout -b feature/AmazingFeature`)
3. Commit your Changes (`git commit -m 'Add some AmazingFeature'`)
4. Push to the Branch (`git push origin feature/AmazingFeature`)
5. Open a Pull Request

---

## 📄 License

Distributed under the MIT License. See `LICENSE` for more information.

---

<div align="center">
  <sub>Built with ❤️ by <b>Harshit</b> and the Hexagon Team</sub>
</div>