/**
 * ClozFlow Developer Documentation Dataset
 * Covers Kiki Model Family (v1 Flash 99M & v2 Pro 2.5B), Pearl Agent Engine,
 * REST APIs, WebSockets, Regional Indian Languages, SDKs, Webhooks, and Error Codes.
 *
 * NOTE: All tokens and keys in this file are dummy placeholders (e.g. cloz_live_abc123)
 * to comply strictly with security guidelines.
 */

export const DOCS_SECTIONS = [
  {
    category: "Getting Started",
    items: [
      { id: "overview", title: "Introduction & Overview", tag: "Guide" },
      { id: "quickstart", title: "5-Minute Quickstart", tag: "Start Here" },
      { id: "auth", title: "Authentication & Security", tag: "Core" },
      { id: "architecture", title: "Hybrid ML Architecture", tag: "Deep Dive" }
    ]
  },
  {
    category: "Voice Models (Kiki)",
    items: [
      { id: "models-overview", title: "Kiki Model Family", tag: "Overview" },
      { id: "kiki-v1-flash", title: "Kiki v1 Flash (99M)", tag: "Ultra Low-Latency" },
      { id: "kiki-v2-pro", title: "Kiki v2 Pro (2.5B)", tag: "Conversational" },
      { id: "language-matrix", title: "Regional Language Matrix", tag: "11+ Languages" },
      { id: "latency-benchmarks", title: "Latency & Turn-Taking", tag: "<220ms" }
    ]
  },
  {
    category: "Voice Agents (Pearl)",
    items: [
      { id: "voice-agents", title: "Autonomous Closer Agents", tag: "Pearl Engine" },
      { id: "sales-capsules", title: "5 Objection Sales Capsules", tag: "Strategy" },
      { id: "interruption-vad", title: "VAD & Interruption Handling", tag: "Silero" },
      { id: "dynamic-variables", title: "Prompt Variables & Context", tag: "Variables" }
    ]
  },
  {
    category: "Campaigns & Dialer",
    items: [
      { id: "campaigns-dialer", title: "Batch Cold Calling", tag: "Dialer" },
      { id: "telephony-setup", title: "Telephony & SIP Trunking", tag: "Exotel/Twilio" }
    ]
  },
  {
    category: "API Reference",
    items: [
      { id: "api-voice-synthesize", title: "POST /v1/voice/synthesize", method: "POST", tag: "TTS" },
      { id: "api-chat-completions", title: "POST /v1/chat/completions", method: "POST", tag: "Conversational" },
      { id: "api-agents-deploy", title: "POST /v1/agents/deploy", method: "POST", tag: "Call Dispatch" },
      { id: "api-campaigns-batch", title: "POST /v1/campaigns/batch", method: "POST", tag: "Dialer" },
      { id: "api-calls-get", title: "GET /v1/calls/{id}", method: "GET", tag: "Telemetry" },
      { id: "api-knowledge-ingest", title: "POST /v1/knowledge/ingest", method: "POST", tag: "RAG" },
      { id: "api-wallet-balance", title: "GET /v1/wallet/balance", method: "GET", tag: "Billing" },
      { id: "api-stream-realtime", title: "WS /v1/stream/realtime", method: "WS", tag: "Bi-directional" }
    ]
  },
  {
    category: "SDKs & Integration",
    items: [
      { id: "sdks-python", title: "Python SDK", tag: "pip" },
      { id: "sdks-node", title: "Node.js SDK", tag: "npm" },
      { id: "sdks-curl", title: "cURL & REST Direct", tag: "HTTP" }
    ]
  },
  {
    category: "Webhooks & Events",
    items: [
      { id: "webhooks", title: "Webhooks & Event Delivery", tag: "HMAC-SHA256" }
    ]
  },
  {
    category: "Errors & Limits",
    items: [
      { id: "errors-limits", title: "Error Codes & Rate Limits", tag: "SLA" }
    ]
  },
  {
    category: "Changelog",
    items: [
      { id: "changelog", title: "Platform Changelog", tag: "v2.4.0" }
    ]
  }
];

export const DOCS_PAGES = {
  // ─────────────────────────────────────────────────────────────
  // 1. OVERVIEW
  // ─────────────────────────────────────────────────────────────
  overview: {
    id: "overview",
    title: "ClozFlow Developer Platform",
    badge: "API v2.4",
    lastUpdated: "November 2026",
    summary: "High-velocity AI voice infrastructure engineered specifically for high-stakes Indian telephonic commerce, negotiation, and automated deal closing.",
    toc: [
      { id: "what-is-clozflow", title: "What is ClozFlow?" },
      { id: "why-clozflow", title: "Why Standard Voice AI Fails in India" },
      { id: "core-pillars", title: "The Three Core Pillars" },
      { id: "architecture-summary", title: "Architecture at a Glance" },
      { id: "next-steps", title: "Next Steps" }
    ],
    content: {
      sections: [
        {
          id: "what-is-clozflow",
          heading: "What is ClozFlow?",
          body: `ClozFlow is an enterprise-grade AI voice platform built from the ground up for high-velocity telephonic negotiation, debt recovery, lead qualification, and customer conversion across India.
          
Unlike generic conversational bots that break down when Indian buyers switch between Hindi and English mid-breath, ClozFlow pairs proprietary sub-220ms voice models (**Kiki v1 Flash** and **Kiki v2 Pro**) with offline-trained machine learning objection classifiers (<50ms) to deliver natural, human-grade sales conversations over SIP/PSTN telephone lines.`
        },
        {
          id: "why-clozflow",
          heading: "Why Standard Voice AI Fails in India",
          body: `Western speech synthesis models are trained on calm, clean broadcast English. When applied to Indian outbound phone lines, three catastrophic failures occur:
          
1. **Unnatural Code-Switching Latency:** Switching between Hindi, English, and regional dialects (Hinglish, Benglish, Tanglish) causes 1.5s+ hesitation pauses that make callers hang up.
2. **Missing Psychological Strategy:** Standard LLMs agree with objections ("I understand your budget is tight..."), killing sales momentum instead of reframing ROI.
3. **Telephony Packet Loss Jitter:** Generic TTS engines buffer multi-second MP3 chunks rather than streaming raw 8kHz μ-law PCM audio frames directly into Indian telecom switches (Exotel, Airtel, Jio).`
        },
        {
          id: "core-pillars",
          heading: "The Three Core Pillars",
          body: `Every layer of the ClozFlow stack was designed for raw call conversion:`,
          cards: [
            {
              title: "Kiki Voice Family",
              desc: "From 99M parameter ultra-compact telephonic TTS (<120ms Mel gen) to 2.5B parameter expressive zero-shot voice cloning across 11 Indian languages.",
              badge: "Voice Synthesis"
            },
            {
              title: "Pearl Agent Engine",
              desc: "Autonomous conversational AI closer equipped with Silero VAD, sub-80ms interruptibility, and dynamic context injection.",
              badge: "Autonomous Agents"
            },
            {
              title: "Hybrid ML Objection Layer",
              desc: "Offline-trained XGBoost classifiers predict objection category (ROI, Risk, Status Gap, Decision Authority) in under 45ms before prompt generation.",
              badge: "Psychological Co-Pilot"
            }
          ]
        },
        {
          id: "architecture-summary",
          heading: "Architecture at a Glance",
          body: `The ClozFlow runtime operates on a dual-engine streaming pipeline:`,
          table: {
            headers: ["Stage", "Engine / Model", "Measured Latency", "Function"],
            rows: [
              ["Audio Ingest", "WebSocket / μ-law 8kHz", "12 ms", "Live prospect audio streaming via PSTN/SIP"],
              ["VAD & End-of-Speech", "Silero VAD + 1.2s Debounce", "35 ms", "Detects pauses vs. thought-breaks without cutoffs"],
              ["Speech-to-Text", "Deepgram Nova-2 / Cloz-STT", "95 ms", "Multilingual streaming transcript generation"],
              ["Strategy Classifier", "XGBoost + TF-IDF (ml/)", "42 ms", "Classifies objection into 5 canonical sales capsules"],
              ["RAG Context", "FAISS Vector Index", "18 ms", "Retrieves winning case study & rate card facts"],
              ["Copy Generation", "ClozFlow Llama 3.3 70B", "110 ms TTFT", "High-status, consultative response copy"],
              ["Audio Synthesis", "Kiki v1 Flash / v2 Pro", "85 ms TTFA", "Streaming Mel-spectrogram & neural vocoder"]
            ]
          }
        },
        {
          id: "next-steps",
          heading: "Next Steps",
          body: `Get started in 5 minutes with our step-by-step Quickstart guide, or dive straight into the Kiki Model Family documentation to evaluate our speech synthesis benchmarks.`
        }
      ]
    }
  },

  // ─────────────────────────────────────────────────────────────
  // 2. QUICKSTART
  // ─────────────────────────────────────────────────────────────
  quickstart: {
    id: "quickstart",
    title: "5-Minute Quickstart",
    badge: "Hands-on",
    lastUpdated: "November 2026",
    summary: "Generate your first synthesized speech audio stream in under 2 minutes, then dispatch an autonomous voice agent call using Python or cURL.",
    toc: [
      { id: "step-1-api-key", title: "1. Obtain an API Key" },
      { id: "step-2-first-tts", title: "2. Generate Your First Voice Audio" },
      { id: "step-3-deploy-agent", title: "3. Dispatch an Autonomous Closer Call" },
      { id: "step-4-listen-webhook", title: "4. Receive Real-Time Call Telemetry" }
    ],
    content: {
      sections: [
        {
          id: "step-1-api-key",
          heading: "1. Obtain an API Key",
          body: `Sign in to your [ClozFlow Dashboard](/auth) and generate a live or test API key. Live keys begin with \`cloz_live_\`, while sandbox keys begin with \`cloz_test_\`.
          
Store your API key in an environment variable on your server:`,
          codeSnippet: {
            bash: "export CLOZFLOW_API_KEY=\"cloz_live_9a8b7c6d5e4f3a2b1c0d\"\nexport CLOZFLOW_BASE_URL=\"https://api.clozflow.in/v1\""
          }
        },
        {
          id: "step-2-first-tts",
          heading: "2. Generate Your First Voice Audio",
          body: `Let's use **Kiki v1 Flash** to synthesize a bilingual Hindi + English response. The request streams back 24kHz WAV/PCM audio in real time:`,
          codeTabs: {
            curl: `curl -X POST "https://api.clozflow.in/v1/voice/synthesize" \\
  -H "Authorization: Bearer cloz_live_9a8b7c6d5e4f3a2b1c0d" \\
  -H "Content-Type: application/json" \\
  -d '{
    "model": "kiki-v1-flash",
    "voice_id": "ishita_enhi_companion",
    "language": "hi",
    "text": "Namaste Sharma ji, ClozFlow se baat kar rahi hoon. Kya aapke team ka sales target automate ho gaya?",
    "audio_format": "wav_24000",
    "stream": false
  }' \\
  --output sample_voice.wav`,
            python: `import clozflow

client = clozflow.Client(api_key="cloz_live_9a8b7c6d5e4f3a2b1c0d")

response = client.voice.synthesize(
    model="kiki-v1-flash",
    voice_id="ishita_enhi_companion",
    language="hi",
    text="Namaste Sharma ji, ClozFlow se baat kar rahi hoon. Kya aapke team ka sales target automate ho gaya?",
    audio_format="wav_24000"
)

with open("sample_voice.wav", "wb") as f:
    f.write(response.content)

print("Audio saved successfully!")`,
            node: `import { ClozFlow } from '@clozflow/sdk';
import fs from 'node:fs';

const cloz = new ClozFlow({ apiKey: 'cloz_live_9a8b7c6d5e4f3a2b1c0d' });

const audioStream = await cloz.voice.synthesize({
  model: 'kiki-v1-flash',
  voiceId: 'ishita_enhi_companion',
  language: 'hi',
  text: 'Namaste Sharma ji, ClozFlow se baat kar rahi hoon. Kya aapke team ka sales target automate ho gaya?',
  audioFormat: 'wav_24000'
});

const buffer = await audioStream.arrayBuffer();
fs.writeFileSync('sample_voice.wav', Buffer.from(buffer));
console.log('Audio saved successfully!');`
          }
        },
        {
          id: "step-3-deploy-agent",
          heading: "3. Dispatch an Autonomous Closer Call",
          body: `To make an outbound phone call to a customer, use the **Pearl Dispatch API**. ClozFlow immediately connects to your configured SIP carrier (Exotel/Twilio) and initiates the conversational AI session:`,
          codeTabs: {
            curl: `curl -X POST "https://api.clozflow.in/v1/agents/deploy" \\
  -H "Authorization: Bearer cloz_live_9a8b7c6d5e4f3a2b1c0d" \\
  -H "Content-Type: application/json" \\
  -d '{
    "agent_id": "ag_pearl_closer_01",
    "phone_number": "+919876543210",
    "customer_name": "Rajesh Verma",
    "model": "kiki-v2-pro",
    "initial_variables": {
      "deal_amount": "₹4,50,000",
      "company": "Verma Logistics"
    },
    "webhook_url": "https://your-domain.com/webhooks/clozflow"
  }'`,
            python: `call = client.agents.deploy(
    agent_id="ag_pearl_closer_01",
    phone_number="+919876543210",
    customer_name="Rajesh Verma",
    model="kiki-v2-pro",
    initial_variables={
        "deal_amount": "₹4,50,000",
        "company": "Verma Logistics"
    },
    webhook_url="https://your-domain.com/webhooks/clozflow"
)

print(f"Call initiated: {call.call_id} (Status: {call.status})")`,
            node: `const call = await cloz.agents.deploy({
  agentId: 'ag_pearl_closer_01',
  phoneNumber: '+919876543210',
  customerName: 'Rajesh Verma',
  model: 'kiki-v2-pro',
  initialVariables: {
    deal_amount: '₹4,50,000',
    company: 'Verma Logistics'
  },
  webhookUrl: 'https://your-domain.com/webhooks/clozflow'
});

console.log(\`Call initiated: \${call.callId}\`);`
          }
        },
        {
          id: "step-4-listen-webhook",
          heading: "4. Receive Real-Time Call Telemetry",
          body: `As the call proceeds, ClozFlow fires webhooks to your server notifying you when the prospect answers, what objections they raise, and whether a commitment was sealed. Inspect the Webhooks section for the full payload schema.`
        }
      ]
    }
  },

  // ─────────────────────────────────────────────────────────────
  // 3. AUTHENTICATION
  // ─────────────────────────────────────────────────────────────
  auth: {
    id: "auth",
    title: "Authentication & Security",
    badge: "Security",
    lastUpdated: "November 2026",
    summary: "ClozFlow uses Bearer tokens and HMAC-SHA256 signatures for API authentication, webhook validation, and granular role-based access control.",
    toc: [
      { id: "api-keys", title: "API Keys & Environments" },
      { id: "bearer-auth", title: "Passing the Authorization Header" },
      { id: "key-safety", title: "Key Safety & Best Practices" },
      { id: "ip-allowlist", title: "IP Allowlisting (Enterprise)" }
    ],
    content: {
      sections: [
        {
          id: "api-keys",
          heading: "API Keys & Environments",
          body: `All requests to the ClozFlow REST & WebSocket APIs require authentication. You can generate multiple API keys per workspace with distinct access scopes:
          
* **Live Keys (\`cloz_live_...\`):** Connects to real Indian PSTN telephony lines, incurs wallet credit deductions, and accesses production models.
* **Test Keys (\`cloz_test_...\`):** Safe sandbox environment for development, integration tests, and simulated mock telephony.`
        },
        {
          id: "bearer-auth",
          heading: "Passing the Authorization Header",
          body: `Include your API key as a Bearer token in the \`Authorization\` header of every HTTP request:`,
          codeSnippet: {
            bash: `Authorization: Bearer cloz_live_9a8b7c6d5e4f3a2b1c0d`
          }
        },
        {
          id: "key-safety",
          heading: "Key Safety & Best Practices",
          body: `> ⚠️ **Strict Security Rule:** Never expose your \`cloz_live_*\` API key in frontend client bundles, single-page apps, or public GitHub repositories.
          
1. **Server-Side Only:** Always make ClozFlow API calls from your protected backend service (FastAPI, Node.js, Next.js API Routes).
2. **Environment Isolation:** Use environment secrets managers (AWS Secrets Manager, Doppler, Vault) rather than hardcoded strings.
3. **Instant Revocation:** If you suspect an API key has leaked, revoke it immediately from your **Workspace Settings > API Keys** tab. All active agent dispatch sessions under that key are instantly disconnected.`
        },
        {
          id: "ip-allowlist",
          heading: "IP Allowlisting (Enterprise)",
          body: `Enterprise workspaces can enforce static IPv4/CIDR block restrictions so that API requests originating from unauthorized IP addresses are rejected with HTTP \`403 Forbidden\`.`
        }
      ]
    }
  },

  // ─────────────────────────────────────────────────────────────
  // 4. ARCHITECTURE
  // ─────────────────────────────────────────────────────────────
  architecture: {
    id: "architecture",
    title: "Hybrid ML Architecture",
    badge: "Core Engineering",
    lastUpdated: "November 2026",
    summary: "How ClozFlow achieves sub-220ms total voice turn-taking by decoupling offline ML strategy classifiers from LLM text generation.",
    toc: [
      { id: "the-latency-problem", title: "The Latency Problem in Voice AI" },
      { id: "hybrid-decoupling", title: "Decoupled Hybrid ML-LLM Pipeline" },
      { id: "5-canonical-strategies", title: "The 5 Canonical Strategy Classifiers" },
      { id: "prompt-budgeting", title: "Strict Prompt Budgeting (<1000 tokens)" }
    ],
    content: {
      sections: [
        {
          id: "the-latency-problem",
          heading: "The Latency Problem in Voice AI",
          body: `In natural Indian conversation, humans expect a turn-taking gap of **250ms to 400ms**. If an AI agent takes 1,200ms to reply, the prospect assumes either a poor connection or an automated machine and hangs up.
          
Standard voice setups route raw transcripts through 70B parameter LLMs with 10,000 token system prompts to decide *what kind of objection occurred* AND *how to answer it*. That alone consumes 800ms to 1,500ms of latency.`
        },
        {
          id: "hybrid-decoupling",
          heading: "Decoupled Hybrid ML-LLM Pipeline",
          body: `ClozFlow eliminates this bottleneck by offloading structural classification to a lightweight, offline-trained **XGBoost + TF-IDF model** that executes in **<45ms**:
          
1. **Audio Stream Ingest:** Deepgram Nova-2 extracts prospect utterance tokens in real-time.
2. **ML Router (\`ml_router.py\`):** Scans the incoming transcript using custom dependency-free tokenizers and XGBoost inference.
3. **Strategy Injected into Prompt:** The classifier immediately labels the objection (e.g. \`ROI_REFRAME\`, emotion: \`cost_anxious\`).
4. **FAISS Knowledge Fetch:** Top-2 highly compressed playbook chunks are retrieved (<18ms).
5. **Streaming LLM + Kiki TTS:** The LLM receives a pre-focused 800-token prompt and outputs words. Kiki v1 Flash begins speaking the first audio chunk in just **85ms**.`
        },
        {
          id: "5-canonical-strategies",
          heading: "The 5 Canonical Strategy Classifiers",
          table: {
            headers: ["Strategy Token", "Typical Objection Utterance", "Psychological Objective"],
            rows: [
              ["ROI_REFRAME", "\"Bhai bohot mehnga hai, itna budget nahi hai\"", "Anchors cost to customer revenue loss or time saved."],
              ["RISK_REVERSAL", "\"Agle quarter mein baat karte hain abhi busy hoon\"", "Collapses timeline hesitation with zero-risk pilot or money-back guarantee."],
              ["STATUS_GAP", "\"Hum already in-house team se kar rahe hain\"", "Exposes hidden labor leaks and hidden manual overhead without offending."],
              ["DECISION_CONTROL", "\"Main apne partner ya CFO se pooch ke batata hoon\"", "Arms the champion with 3 boardroom bullet points to win internal sign-off."],
              ["DIAGNOSTIC_QUESTION", "\"Ye AI sab fake hota hai koi result nahi deta\"", "Replaces defensiveness with a high-status diagnostic query uncovering past bad software."]
            ]
          }
        },
        {
          id: "prompt-budgeting",
          heading: "Strict Prompt Budgeting (<1000 tokens)",
          body: `To guarantee deterministic sub-150ms LLM time-to-first-token (TTFT), ClozFlow limits total active prompt length to 700–1200 tokens. Historical conversation turns are dynamically compressed using semantic extractive summarization.`
        }
      ]
    }
  },

  // ─────────────────────────────────────────────────────────────
  // 5. KIKI MODEL FAMILY OVERVIEW
  // ─────────────────────────────────────────────────────────────
  "models-overview": {
    id: "models-overview",
    title: "Kiki Voice Family Overview",
    badge: "Sovereign AI",
    lastUpdated: "November 2026",
    summary: "Flagship proprietary speech synthesis foundation models tuned for authentic Indian accents, natural code-switching, emotional modulation, and ultra-low latency.",
    toc: [
      { id: "family-overview", title: "Two Specialized Foundations" },
      { id: "model-comparison", title: "Model Comparison Matrix" },
      { id: "audio-preview", title: "Audio Player & Dialect Sampler" },
      { id: "choosing-model", title: "Which Model Should You Choose?" }
    ],
    content: {
      sections: [
        {
          id: "family-overview",
          heading: "Two Specialized Foundations",
          body: `Indian sales conversations require radically different voice architectures depending on the call type:
          
* **Kiki v1 Flash (99M):** Built for high-volume cold dialing, automated payment reminders, and initial qualification where latency, cost, and high concurrent stream capacity are non-negotiable.
* **Kiki v2 Pro (2.5B):** Built for high-stakes enterprise sales closers, consultative demos, and executive conversations where hyper-realistic emotional inflection, hesitation handling, and authentic zero-shot voice cloning win deals.`
        },
        {
          id: "model-comparison",
          heading: "Model Comparison Matrix",
          table: {
            headers: ["Feature / Metric", "Kiki v1 Flash", "Kiki v2 Pro"],
            rows: [
              ["Parameter Size", "99 Million (Ultra-compact)", "2.5 Billion (Flagship Foundation)"],
              ["Time to First Audio (TTFA)", "<85 ms", "<185 ms"],
              ["Turn-Taking Gap (E2E)", "195 ms – 230 ms", "280 ms – 340 ms"],
              ["Audio Sample Rate", "8 kHz / 16 kHz / 24 kHz", "24 kHz / 48 kHz Studio Hi-Fi"],
              ["Supported Indian Languages", "Hindi, Indian English, Hinglish, Bengali", "11 Indian Languages + Indian English"],
              ["Code-Switching Support", "Fast mid-sentence Hindi/English", "Deep emotional bilingual code-switching"],
              ["Voice Cloning", "Pre-trained library (60+ personas)", "Zero-Shot 3-second instant clone"],
              ["Emotional Range", "Neutral, consultative, assertive", "Whisper, excitement, empathy, skeptical reframe"],
              ["Compute Footprint", "Single CPU / lightweight edge node", "Multi-GPU NVIDIA TensorRT-LLM cluster"],
              ["Cost per Minute", "₹0.60 / min ($0.0072/min)", "₹1.80 / min ($0.0216/min)"]
            ]
          }
        },
        {
          id: "audio-preview",
          heading: "Audio Player & Dialect Sampler",
          body: `Listen to real samples synthesized by Kiki v1 Flash and Kiki v2 Pro across key Indian business accents:`,
          interactiveAudioDemo: true
        },
        {
          id: "choosing-model",
          heading: "Which Model Should You Choose?",
          cards: [
            {
              title: "Choose Kiki v1 Flash if...",
              desc: "You are running 10,000+ outbound cold calls per day, automated renewal reminders, logistics confirmation, or need sub-100ms instant speech synthesis.",
              badge: "High Throughput"
            },
            {
              title: "Choose Kiki v2 Pro if...",
              desc: "You are closing ₹1L+ deal sizes, handling emotional objections, mimicking a specific sales executive's voice via cloning, or requiring deep consultative dialogue.",
              badge: "High Conversion"
            }
          ]
        }
      ]
    }
  },

  // ─────────────────────────────────────────────────────────────
  // 6. KIKI V1 FLASH
  // ─────────────────────────────────────────────────────────────
  "kiki-v1-flash": {
    id: "kiki-v1-flash",
    title: "Kiki v1 Flash (99M)",
    badge: "Ultra Low-Latency",
    lastUpdated: "November 2026",
    summary: "A 99M parameter streaming acoustic speech model optimized for sub-85ms Time-to-First-Audio on commodity CPU servers.",
    toc: [
      { id: "overview-v1", title: "Model Architecture" },
      { id: "specs-v1", title: "Technical Specifications" },
      { id: "audio-demo-v1", title: "Live Synthesis Audio Tester" },
      { id: "code-example-v1", title: "Streaming Audio API Example" },
      { id: "benchmarks-v1", title: "Throughput & Concurrency" }
    ],
    content: {
      sections: [
        {
          id: "overview-v1",
          heading: "Model Architecture",
          body: `Kiki v1 Flash uses a non-autoregressive fast diffusion acoustic backbone paired with a streaming HiFi-GAN vocoder. Designed specifically for Indian telecommunication infrastructures (Exotel, Tata Tele, Airtel PRI), it outputs raw 8kHz μ-law PCM audio frames with virtually zero buffering overhead.`
        },
        {
          id: "specs-v1",
          heading: "Technical Specifications",
          table: {
            headers: ["Parameter", "Value", "Notes"],
            rows: [
              ["Model Identifier", "kiki-v1-flash", "Use in API requests"],
              ["Parameter Count", "99 Million", "Quantized INT8 / FP16"],
              ["Inference Latency", "85 ms (P50), 115 ms (P99)", "Measured on 2x vCPU server"],
              ["Telephony Protocols", "RTP, SIP, WebSockets, HTTP Chunked", "Direct μ-law / A-law output"],
              ["Max Audio Length", "180 seconds per single turn", "Streamed in 20ms chunks"]
            ]
          }
        },
        {
          id: "audio-demo-v1",
          heading: "Live Synthesis Audio Tester",
          body: `Test ultra-low latency audio synthesis with Kiki v1 Flash across Indian regional personas:`,
          interactiveAudioDemo: true
        },
        {
          id: "code-example-v1",
          heading: "Streaming Audio API Example",
          body: `Stream chunks as they are generated using the Python SDK:`,
          codeTabs: {
            python: `import clozflow

client = clozflow.Client(api_key="cloz_live_9a8b7c6d5e4f3a2b1c0d")

stream = client.voice.synthesize_stream(
    model="kiki-v1-flash",
    voice_id="dev_en_recovery",
    text="Aapka EMI pending hai sir. Aaj sham 5 baje se pehle payment clear ho jayegi?",
    language="hi",
    audio_format="pcm_8000"
)

# Pipe raw 8kHz PCM chunks straight into your SIP telephonic socket
for chunk in stream:
    telephony_socket.send(chunk)`
          }
        },
        {
          id: "benchmarks-v1",
          heading: "Throughput & Concurrency",
          body: `A single 4-core virtual server running Kiki v1 Flash handles up to **64 concurrent real-time outbound audio streams** without dropping frames, achieving an RTF (Real-Time Factor) of **0.08x**.`
        }
      ]
    }
  },

  // ─────────────────────────────────────────────────────────────
  // 7. KIKI V2 PRO
  // ─────────────────────────────────────────────────────────────
  "kiki-v2-pro": {
    id: "kiki-v2-pro",
    title: "Kiki v2 Pro (2.5B)",
    badge: "Flagship Conversational",
    lastUpdated: "November 2026",
    summary: "A 2.5B parameter conversational voice foundation model featuring zero-shot 3-second voice cloning, fluid Indian code-switching, and emotional modulation.",
    toc: [
      { id: "overview-v2", title: "Conversational Expressiveness" },
      { id: "zero-shot-cloning", title: "Zero-Shot 3-Second Voice Cloning" },
      { id: "emotion-tags", title: "Emotional Modulation & SSML Tags" },
      { id: "audio-demo-v2", title: "Live Conversational Audio Tester" },
      { id: "code-example-v2", title: "Cloning & Synthesis API Call" }
    ],
    content: {
      sections: [
        {
          id: "overview-v2",
          heading: "Conversational Expressiveness",
          body: `Kiki v2 Pro is engineered to mimic high-performing consultative sales professionals. It automatically simulates natural human speech markers:
          
* **In-breath and micro-pauses:** Realistic breathing cadences before delivering counter-arguments.
* **Tonal shift on objections:** Shifts from friendly casual discovery to grounded, high-status authority when a prospect raises price hesitation.
* **Zero-lag Hindi-English code-switching:** Pronounces English technical terms ("SaaS", "margin", "quarterly target") crisply within pure Hindi sentences without phonetic breakdown.`
        },
        {
          id: "zero-shot-cloning",
          heading: "Zero-Shot 3-Second Voice Cloning",
          body: `You can clone any founder, top sales closer, or customer success manager's voice using as little as 3 seconds of clean WhatsApp voice note or MP3 audio.
          
Kiki v2 Pro creates a 512-dimensional speaker embedding that retains the speaker's vocal timber, raspiness, pitch curve, and regional accent across all 11 Indian languages.`
        },
        {
          id: "emotion-tags",
          heading: "Emotional Modulation & SSML Tags",
          body: `Control the emotional delivery directly using inline markup or the \`emotion\` parameter:`,
          table: {
            headers: ["Emotion Tag", "Intended Use Case", "Tonal Characteristic"],
            rows: [
              ["calm_authority", "High-ticket pricing reframes", "Low pitch, steady tempo, downward terminal inflection"],
              ["soft_challenge", "Addressing in-house tool objections", "Curious, slightly leaning forward, consultative challenge"],
              ["warm_rapport", "Initial discovery & intro greetings", "Friendly smile audio resonance, energetic greeting"],
              ["empathetic_resolve", "Handling escalated client complaints", "Gentle, measured tempo, attentive reassurance"]
            ]
          }
        },
        {
          id: "audio-demo-v2",
          heading: "Live Conversational Audio Tester",
          body: `Audition Kiki v2 Pro's expressive speech nuance and emotional modulation across regional languages:`,
          interactiveAudioDemo: true
        },
        {
          id: "code-example-v2",
          heading: "Cloning & Synthesis API Call",
          codeTabs: {
            curl: `curl -X POST "https://api.clozflow.in/v1/voice/clone" \\
  -H "Authorization: Bearer cloz_live_9a8b7c6d5e4f3a2b1c0d" \\
  -F "voice_name=Founder_Aman" \\
  -F "audio_file=@aman_voice_sample.mp3" \\
  -F "language=hi"`,
            python: `with open("aman_voice_sample.mp3", "rb") as f:
    clone = client.voice.clone(
        voice_name="Founder_Aman",
        audio_file=f,
        language="hi"
    )

print(f"Cloned Voice ID: {clone.voice_id}")

# Synthesize speech using the cloned voice
audio = client.voice.synthesize(
    model="kiki-v2-pro",
    voice_id=clone.voice_id,
    text="Aman here! We are launching our Mumbai cluster next week.",
    emotion="calm_authority"
)`
          }
        }
      ]
    }
  },

  // ─────────────────────────────────────────────────────────────
  // 8. REGIONAL LANGUAGE MATRIX
  // ─────────────────────────────────────────────────────────────
  "language-matrix": {
    id: "language-matrix",
    title: "Regional Language Matrix",
    badge: "11+ Languages",
    lastUpdated: "November 2026",
    summary: "Native support across 11 Indian official languages, Hinglish, and Indian English with tailored regional phoneme sets and dialects.",
    toc: [
      { id: "language-coverage", title: "Supported Languages & Dialect Codes" },
      { id: "code-switching", title: "Bilingual Code-Switching" },
      { id: "benchmark-wer", title: "Word Error Rate (WER) & MOS Scores" }
    ],
    content: {
      sections: [
        {
          id: "language-coverage",
          heading: "Supported Languages & Dialect Codes",
          body: `ClozFlow provides pre-trained studio personas and pronunciation dictionaries across all primary Indian economic zones:`,
          table: {
            headers: ["Language", "ISO Code", "Dialects / Nuances", "Pre-trained Personas", "Model Support"],
            rows: [
              ["Hindi", "hi", "Delhi NCR, UP/Bihar, Urban Standard", "Aditya, Kavya, Sumit, Ishita", "v1 Flash + v2 Pro"],
              ["Indian English", "en-IN", "Neutral Corporate, South Indian, Delhi", "Dev, Ishita, Shubh, Simran", "v1 Flash + v2 Pro"],
              ["Hinglish", "hi-en", "Conversational Urban Metro Hybrid", "Simran, Shubh, Ishita, Sunny", "v1 Flash + v2 Pro"],
              ["Bengali", "bn", "Kolkata Standard, Dhaka-border", "Arnab, Roopa", "v1 Flash + v2 Pro"],
              ["Marathi", "mr", "Pune Standard, Mumbai Coastal", "Sarang, Tanvi", "v2 Pro"],
              ["Gujarati", "gu", "Ahmedabad Commercial, Surat", "Bhavik, Pooja", "v1 Flash + v2 Pro"],
              ["Tamil", "ta", "Chennai Urban, Madurai Traditional", "Karthik, Deepa", "v2 Pro"],
              ["Telugu", "te", "Hyderabad Metro, Vijayawada", "Suresh, Ananya", "v2 Pro"],
              ["Kannada", "kn", "Bengaluru Tech Hub, Mysuru", "Chetan, Sowmya", "v2 Pro"],
              ["Malayalam", "ml", "Ernakulam/Kochi, Malabar", "Vineeth, Parvathy", "v2 Pro"],
              ["Assamese", "as", "Guwahati Standard", "Kangkana, Mouchumi", "v1 Flash + v2 Pro"],
              ["Punjabi", "pa", "Majhi, Doabi Commercial", "Harpreet, Jasleen", "v2 Pro"],
              ["Odia", "or", "Bhubaneswar Standard", "Pradeep, Lipsa", "v2 Pro"]
            ]
          }
        },
        {
          id: "code-switching",
          heading: "Bilingual Code-Switching",
          body: `In over 78% of Indian business calls, the buyer begins in English, switches to Hindi during hesitation, and concludes negotiations in a hybrid Hinglish.
          
Kiki does not treat languages as separate models. Its unified phonetic latent space allows seamless transition within the same sentence without any audio click, stutter, or tonal shift.`
        },
        {
          id: "benchmark-wer",
          heading: "Word Error Rate (WER) & MOS Scores",
          body: `Evaluated over 5,000 real telecom calls across India:`,
          table: {
            headers: ["Metric", "ClozFlow Kiki v2 Pro", "ElevenLabs (Standard)", "Google Cloud TTS"],
            rows: [
              ["Mean Opinion Score (MOS - Hindi)", "4.62 / 5.0", "3.84 / 5.0", "3.91 / 5.0"],
              ["Mean Opinion Score (MOS - Hinglish)", "4.74 / 5.0", "3.22 / 5.0", "3.40 / 5.0"],
              ["Telephonic Intelligibility (8kHz)", "97.8%", "88.2%", "89.4%"],
              ["Code-Switching Hesitation Gap", "0 ms", "420 ms", "680 ms"]
            ]
          }
        }
      ]
    }
  },

  // ─────────────────────────────────────────────────────────────
  // 9. LATENCY BENCHMARKS
  // ─────────────────────────────────────────────────────────────
  "latency-benchmarks": {
    id: "latency-benchmarks",
    title: "Latency & Turn-Taking Benchmarks",
    badge: "<220ms SLA",
    lastUpdated: "November 2026",
    summary: "Detailed breakdown of the milliseconds consumed by each hop of the ClozFlow audio pipeline during live phone conversations.",
    toc: [
      { id: "hop-breakdown", title: "Micro-Hop Latency Breakdown" },
      { id: "optimizations", title: "Key Low-Latency Optimizations" },
      { id: "testing-latency", title: "How to Measure E2E Latency" }
    ],
    content: {
      sections: [
        {
          id: "hop-breakdown",
          heading: "Micro-Hop Latency Breakdown",
          body: `Total conversational turn-taking latency is the elapsed time from when the prospect stops speaking to when the first millisecond of AI voice is heard on their earpiece:`,
          table: {
            headers: ["Pipeline Component", "Engine / Stack", "P50 Latency", "P99 Latency"],
            rows: [
              ["1. Network SIP RTP Packet Ingest", "Exotel / Twilio WebRTC Bridge", "12 ms", "24 ms"],
              ["2. Silero Voice Activity Detector", "Silero VAD PyTorch C++ Runtime", "22 ms", "35 ms"],
              ["3. Deepgram Nova-2 Streaming STT", "WebSocket Live Stream", "85 ms", "110 ms"],
              ["4. Offline XGBoost Strategy Classifier", "Custom TF-IDF Vectorizer", "38 ms", "48 ms"],
              ["5. FAISS Vector Database Lookup", "Binary In-Memory FAISS Index", "14 ms", "22 ms"],
              ["6. ClozFlow Llama-3.3 70B (First Token)", "Groq LPU Engine", "78 ms", "105 ms"],
              ["7. Kiki v1 Flash Mel-Spectrogram Gen", "Fast Diffusion INT8 Vocoder", "42 ms", "65 ms"],
              ["Total Roundtrip (First Audio Out)", "Full ClozFlow Stack", "198 ms", "235 ms"]
            ]
          }
        },
        {
          id: "optimizations",
          heading: "Key Low-Latency Optimizations",
          body: `1. **Token Streaming to Vocoder:** Kiki does not wait for a full sentence. It synthesizes audio on the first 3 tokens received from the LLM.
2. **Pre-warmed PyTorch Threadpool:** Silero VAD is tuned with \`torch.set_num_threads(1)\` to prevent thread thrashing on 2-vCPU KVM telecom instances.
3. **Dual Buffer RTP Jitter Buffer:** Jitter buffers are clamped to 20ms to prevent voice drag over 4G/VoLTE telecom networks.`
        },
        {
          id: "testing-latency",
          heading: "How to Measure E2E Latency",
          body: `Every call telemetry log includes microsecond timestamps for \`prospect_speech_end\`, \`classifier_fired\`, and \`audio_stream_start\`. Access them via \`GET /v1/calls/{id}\`.`
        }
      ]
    }
  },

  // ─────────────────────────────────────────────────────────────
  // 10. VOICE AGENTS (PEARL ENGINE)
  // ─────────────────────────────────────────────────────────────
  "voice-agents": {
    id: "voice-agents",
    title: "Autonomous Closer Agents",
    badge: "Pearl Engine",
    lastUpdated: "November 2026",
    summary: "Build, configure, and orchestrate stateful AI voice agents capable of conducting entire multi-minute phone sales calls autonomously.",
    toc: [
      { id: "agent-architecture", title: "Agent Core Architecture" },
      { id: "configuring-agent", title: "Configuring Personas & Rules" },
      { id: "tool-calling", title: "Agent Tools & API Callouts" },
      { id: "deploying-agent", title: "Deploying via API" }
    ],
    content: {
      sections: [
        {
          id: "agent-architecture",
          heading: "Agent Core Architecture",
          body: `ClozFlow's **Pearl Engine** powers autonomous voice agents. Unlike basic IVR or decision tree bots, Pearl maintains:
          
* **Persistent Conversational State:** Remembers prior objections, prospect tone, and agreed deal numbers throughout the call.
* **Goal Orientation:** Balances consultative listening with steady forward progress toward the call objective (e.g., booking a demo, collecting a debt, locking payment commitment).
* **High-Status Energy Routing:** Selects conversational attitudes (\`calm_authority\`, \`soft_challenge\`, \`relaxed_guidance\`) based on buyer ego.`
        },
        {
          id: "configuring-agent",
          heading: "Configuring Personas & Rules",
          body: `Define an agent via the [Agent Editor](/agent-editor) or the REST API:`,
          codeSnippet: {
            json: `{
  "agent_id": "ag_realestate_closer",
  "name": "Arjun - Gurugram Luxury Closer",
  "model": "kiki-v2-pro",
  "voice_id": "aditya_hi_sales",
  "language": "hi-en",
  "temperature": 0.35,
  "system_prompt": "You are Arjun, Senior Investment Advisor at DLF Crest. You are calling high-net-worth investors regarding the Phase 4 launch in Gurugram...",
  "objection_capsules_enabled": ["ROI_REFRAME", "STATUS_GAP", "RISK_REVERSAL"],
  "rules": [
    "Never offer a discount on the first mention of price",
    "If the prospect asks if you are AI, answer with charm and confidence: 'Haha Arjun baat kar raha hoon sir, live assistant ke saath. Deal ki baat karein?'",
    "Keep replies strictly under 35 words per turn"
  ]
}`
          }
        },
        {
          id: "tool-calling",
          heading: "Agent Tools & API Callouts",
          body: `Agents can execute tools mid-call to check CRM records, generate Razorpay payment links, or book Google Calendar slots:
          
* **\`check_slot_availability\`**: Checks real-time calendar availability.
* **\`send_whatsapp_brochure\`**: Triggers instant WhatsApp message with PDF catalog while the prospect is still on the phone.
* **\`send_payment_link\`**: Sends dynamic UPI / Razorpay link for booking amount.`
        },
        {
          id: "deploying-agent",
          heading: "Deploying via API",
          body: `Trigger an instant call to a lead using \`POST /v1/agents/deploy\`. ClozFlow connects to the prospect's mobile line in 3.2 seconds.`
        }
      ]
    }
  },

  // ─────────────────────────────────────────────────────────────
  // 11. SALES CAPSULES
  // ─────────────────────────────────────────────────────────────
  "sales-capsules": {
    id: "sales-capsules",
    title: "5 Objection Sales Capsules",
    badge: "Psychological Co-Pilot",
    lastUpdated: "November 2026",
    summary: "How ClozFlow automatically detects and executes psychologically proven sales objection frameworks during live conversations.",
    toc: [
      { id: "what-are-capsules", title: "What are Sales Capsules?" },
      { id: "roi-reframe", title: "1. ROI_REFRAME (Price / Budget)" },
      { id: "risk-reversal", title: "2. RISK_REVERSAL (Timing / Delay)" },
      { id: "status-gap", title: "3. STATUS_GAP (In-House / Existing Vendor)" },
      { id: "decision-control", title: "4. DECISION_CONTROL (Authority / Partner)" },
      { id: "diagnostic-question", title: "5. DIAGNOSTIC_QUESTION (Skepticism)" }
    ],
    content: {
      sections: [
        {
          id: "what-are-capsules",
          heading: "What are Sales Capsules?",
          body: `A Sales Capsule is a self-contained psychological playbook. When the offline XGBoost classifier flags an objection, it activates the corresponding capsule prompt constraints in under 45ms.
          
This prevents the voice agent from becoming submissive or repeating robotic excuses.`
        },
        {
          id: "roi-reframe",
          heading: "1. ROI_REFRAME (Price / Budget)",
          body: `* **Trigger:** *"Bohot mehnga hai"*, *"Discount milega kya"*, *"Budget exceed ho raha hai"*
* **Psychological Mechanism:** Anchors the product cost against the monthly revenue lost without it.
* **Sample Agent Output:** *"Totally get it Sharma ji. Lekin agar aapki team roz 4 ghante manual calls pe waste kar rahi hai, toh mahine ka ₹1.2 lakh toh waise hi leak ho raha hai. Kya hum 15 din ka trial karke check karein?"*`
        },
        {
          id: "risk-reversal",
          heading: "2. RISK_REVERSAL (Timing / Delay)",
          body: `* **Trigger:** *"Agle mahine dekhte hain"*, *"Diwali ke baad call karo"*, *"Abhi thoda busy hoon"*
* **Psychological Mechanism:** Removes execution risk and presents an asymmetric upside for locking terms today.
* **Sample Agent Output:** *"Main bilkul jaldbazi nahi karunga sir. Bas slot reserve kar lete hain bina kisi payment ke. Agar agle hafte fit nahi laga toh 1 click mein cancel kar dijiyega."*`
        },
        {
          id: "status-gap",
          heading: "3. STATUS_GAP (In-House / Existing Vendor)",
          body: `* **Trigger:** *"Humare paas already 10 callers hain"*, *"Humara existing software chal raha hai"*
* **Psychological Mechanism:** Gently highlights blind spots in existing manual workflows without offending their current staff.`
        },
        {
          id: "decision-control",
          heading: "4. DECISION_CONTROL (Authority / Partner)",
          body: `* **Trigger:** *"Main partner se pooch ke batata hoon"*, *"CFO sign-off chahiye"*
* **Psychological Mechanism:** Gives the prospect the exact 3 metrics they need to champion the deal internally.`
        },
        {
          id: "diagnostic-question",
          heading: "5. DIAGNOSTIC_QUESTION (Skepticism)",
          body: `* **Trigger:** *"AI sab bekaar hota hai"*, *"Robot kabhi deal close nahi kar sakta"*
* **Psychological Mechanism:** Replaces defensiveness with curiosity to uncover previous negative vendor experiences.`
        }
      ]
    }
  },

  // ─────────────────────────────────────────────────────────────
  // 12. INTERRUPTION & VAD
  // ─────────────────────────────────────────────────────────────
  "interruption-vad": {
    id: "interruption-vad",
    title: "VAD & Interruption Handling",
    badge: "Silero Engine",
    lastUpdated: "November 2026",
    summary: "How ClozFlow cuts off AI speech in under 80ms when the prospect interrupts, preserving conversational rhythm without losing context.",
    toc: [
      { id: "interruption-challenge", title: "The Cutoff Problem" },
      { id: "silero-vad", title: "Silero VAD Architecture" },
      { id: "debounce-tuning", title: "Debounce & Pause Tuning" },
      { id: "handling-barge-in", title: "Barge-In WebSocket Signals" }
    ],
    content: {
      sections: [
        {
          id: "interruption-challenge",
          heading: "The Cutoff Problem",
          body: `If a human customer speaks while an AI agent is in the middle of a sentence, the AI must immediately stop speaking.
          
If the AI keeps talking over the customer ("barge-in failure"), the customer hangs up in frustration. Conversely, if the AI halts every time the customer takes a breath, conversation becomes unlistenable.`
        },
        {
          id: "silero-vad",
          heading: "Silero VAD Architecture",
          body: `ClozFlow integrates a C++ pre-warmed **Silero VAD** neural network directly on the 16kHz audio buffer:
          
1. Scans incoming 30ms audio chunks for human speech probability.
2. If probability exceeds \`0.68\` for at least 60ms, ClozFlow fires an instant \`playback.stop\` interrupt signal to the telecom audio buffer.
3. Halts audio transmission within **68ms to 85ms**.`
        },
        {
          id: "debounce-tuning",
          heading: "Debounce & Pause Tuning",
          table: {
            headers: ["Parameter", "Default Value", "Description"],
            rows: [
              ["vad_threshold", "0.68", "Probability threshold for detecting speech (0.0 - 1.0)"],
              ["pause_detection_ms", "1200 ms", "Duration of silence before AI considers human turn finished"],
              ["interruption_grace_ms", "80 ms", "Immunity period after AI starts speaking to prevent echo loops"],
              ["barge_in_enabled", "true", "Whether customer speech immediately cancels active TTS playback"]
            ]
          }
        },
        {
          id: "handling-barge-in",
          heading: "Barge-In WebSocket Signals",
          body: `When an interruption is confirmed, ClozFlow sends a \`call.interrupted\` event over the active WebSocket channel:`,
          codeSnippet: {
            json: `{
  "event": "call.interrupted",
  "call_id": "call_98a76b5c",
  "timestamp_ms": 14220,
  "words_spoken_before_cutoff": 6,
  "customer_interrupted_with": "Rukiye ek second, cost kitna hai?"
}`
          }
        }
      ]
    }
  },

  // ─────────────────────────────────────────────────────────────
  // 13. DYNAMIC VARIABLES & CONTEXT
  // ─────────────────────────────────────────────────────────────
  "dynamic-variables": {
    id: "dynamic-variables",
    title: "Prompt Variables & Context",
    badge: "Personalization",
    lastUpdated: "November 2026",
    summary: "Inject lead CRM variables, past purchase history, and customized objection scripts into live calls dynamically.",
    toc: [
      { id: "variable-syntax", title: "Variable Template Syntax" },
      { id: "built-in-variables", title: "Built-in System Variables" },
      { id: "custom-payloads", title: "Passing Dynamic Payloads" }
    ],
    content: {
      sections: [
        {
          id: "variable-syntax",
          heading: "Variable Template Syntax",
          body: `ClozFlow agent prompts support Handlebars-style dynamic variables: \`{{variable_name}}\`.
          
You can specify fallbacks for missing values: \`{{lead_name || "Sir"}}\`.`
        },
        {
          id: "built-in-variables",
          heading: "Built-in System Variables",
          table: {
            headers: ["Variable Token", "Example Value", "Description"],
            rows: [
              ["{{customer_name}}", "\"Suresh Bansal\"", "Prospect's full or first name"],
              ["{{phone_number}}", "\"+919812345678\"", "Prospect dialed phone number"],
              ["{{current_time_ist}}", "\"3:45 PM\"", "Local IST time to adjust greeting (Morning / Afternoon)"],
              ["{{call_duration}}", "\"02:14\"", "Elapsed call time in minutes:seconds"]
            ]
          }
        },
        {
          id: "custom-payloads",
          heading: "Passing Dynamic Payloads",
          body: `Provide custom key-values in \`initial_variables\` when dispatching the call:`,
          codeSnippet: {
            json: `{
  "agent_id": "ag_pearl_closer_01",
  "phone_number": "+919876543210",
  "initial_variables": {
    "deal_name": "Enterprise 50-Seat Tier",
    "invoice_number": "INV-2026-992",
    "past_deal_value": "₹3,40,000",
    "lead_city": "Bengaluru"
  }
}`
          }
        }
      ]
    }
  },

  // ─────────────────────────────────────────────────────────────
  // 14. CAMPAIGNS & DIALER
  // ─────────────────────────────────────────────────────────────
  "campaigns-dialer": {
    id: "campaigns-dialer",
    title: "Batch Cold Calling & Campaigns",
    badge: "High Throughput",
    lastUpdated: "November 2026",
    summary: "Launch high-velocity automated calling blasts with concurrent trunk throttling, retry rules, and IST calling compliance.",
    toc: [
      { id: "batch-campaigns", title: "Creating a Batch Campaign" },
      { id: "pacing-concurrency", title: "Pacing & Concurrency Controls" },
      { id: "retry-rules", title: "Retry & Unanswered Number Handling" },
      { id: "dnd-compliance", title: "TRAI / NDNC Compliance Guardrails" }
    ],
    content: {
      sections: [
        {
          id: "batch-campaigns",
          heading: "Creating a Batch Campaign",
          body: `To launch an automated calling campaign to thousands of qualified leads, submit a CSV lead array via the Campaigns API.
          
ClozFlow automatically manages dial queues, checks answering machine detection (AMD), and connects answered lines to your Pearl voice closer within 120ms.`
        },
        {
          id: "pacing-concurrency",
          heading: "Pacing & Concurrency Controls",
          table: {
            headers: ["Control", "Recommended Value", "Impact"],
            rows: [
              ["max_concurrent_channels", "10 - 250", "Number of simultaneous ringing/active PSTN telephone lines"],
              ["calls_per_minute", "30 - 300", "Ramp rate to prevent carrier SIP trunk rate-limiting"],
              ["amd_enabled", "true", "Automatically disconnects voicemail and telecom automated voice prompts"],
              ["record_audio", "true", "Records stereo dual-channel WAV for QA and CRM auditing"]
            ]
          }
        },
        {
          id: "retry-rules",
          heading: "Retry & Unanswered Number Handling",
          body: `Configure automatic callback intervals for busy, unanswered, or network unreachable numbers:`,
          codeSnippet: {
            json: `{
  "campaign_name": "November Renewal Blast",
  "retry_config": {
    "max_retries": 3,
    "retry_interval_minutes": 90,
    "retry_on": ["busy", "no_answer", "network_failure"]
  }
}`
          }
        },
        {
          id: "dnd-compliance",
          heading: "TRAI / NDNC Compliance Guardrails",
          body: `ClozFlow enforces Indian TRAI telemarketing compliance:
          
* Calls are automatically barred outside the 9:00 AM – 8:00 PM IST calling window.
* Scrubbing against National Do Not Call (NDNC) registries is supported out of the box.`
        }
      ]
    }
  },

  // ─────────────────────────────────────────────────────────────
  // 15. TELEPHONY & SIP SETUP
  // ─────────────────────────────────────────────────────────────
  "telephony-setup": {
    id: "telephony-setup",
    title: "Telephony & SIP Trunking",
    badge: "Carriers",
    lastUpdated: "November 2026",
    summary: "Connect your Exotel, Twilio, Airtel PRI, or custom SIP trunk to route ClozFlow voice agents over verified Indian DIDs.",
    toc: [
      { id: "supported-carriers", title: "Supported Carriers" },
      { id: "exotel-setup", title: "Configuring Exotel (Recommended for India)" },
      { id: "sip-trunking", title: "Custom SIP Trunking & PBX" },
      { id: "caller-id", title: "Verified Caller ID & DLT Registration" }
    ],
    content: {
      sections: [
        {
          id: "supported-carriers",
          heading: "Supported Carriers",
          body: `ClozFlow connects directly to major Indian and global telecommunications carriers:
          
* **Exotel (Native India):** Lowest latency for Indian mobile networks (+91), built-in DLT header integration.
* **Twilio:** Global coverage across 180+ countries.
* **Custom SIP Trunk:** Connect Asterisk, FreePBX, Cisco, or Airtel direct SIP trunks.`
        },
        {
          id: "exotel-setup",
          heading: "Configuring Exotel (Recommended for India)",
          body: `Add your Exotel credentials inside your [Workspace Settings](/settings):`,
          codeSnippet: {
            bash: `EXOTEL_ACCOUNT_SID="clozflow_prod_sid"\nEXOTEL_API_KEY="dummy_exotel_key"\nEXOTEL_API_TOKEN="dummy_exotel_token"\nEXOTEL_CALLER_ID="08047123456"`
          }
        },
        {
          id: "sip-trunking",
          heading: "Custom SIP Trunking & PBX",
          body: `For on-premise PBX deployments, ClozFlow provides standard SIP URI termination with TLS and SRTP encryption.`
        },
        {
          id: "caller-id",
          heading: "Verified Caller ID & DLT Registration",
          body: `To achieve 65%+ answer rates on cold calls, configure your Telecom DLT-approved header and Truecaller verified business badge.`
        }
      ]
    }
  },

  // ─────────────────────────────────────────────────────────────
  // 16. API: VOICE SYNTHESIZE
  // ─────────────────────────────────────────────────────────────
  "api-voice-synthesize": {
    id: "api-voice-synthesize",
    title: "POST /v1/voice/synthesize",
    badge: "REST Endpoint",
    lastUpdated: "November 2026",
    summary: "Synthesize plain text into ultra-low latency speech audio stream using Kiki v1 Flash or Kiki v2 Pro.",
    toc: [
      { id: "endpoint-spec", title: "Endpoint Specification" },
      { id: "request-headers", title: "Request Headers" },
      { id: "request-body", title: "Request Body Parameters" },
      { id: "response-samples", title: "Response Samples" }
    ],
    content: {
      sections: [
        {
          id: "endpoint-spec",
          heading: "Endpoint Specification",
          endpoint: {
            method: "POST",
            path: "https://api.clozflow.in/v1/voice/synthesize"
          },
          body: `Converts plain text or SSML markup into natural audio. Supports both streaming binary output and complete audio buffer responses.`
        },
        {
          id: "request-headers",
          heading: "Request Headers",
          table: {
            headers: ["Header", "Type", "Required", "Description"],
            rows: [
              ["Authorization", "string", "Yes", "Bearer cloz_live_..."],
              ["Content-Type", "string", "Yes", "application/json"],
              ["Accept", "string", "No", "audio/wav or audio/pcm or application/json"]
            ]
          }
        },
        {
          id: "request-body",
          heading: "Request Body Parameters",
          table: {
            headers: ["Field", "Type", "Default", "Description"],
            rows: [
              ["model", "string", "kiki-v1-flash", "\"kiki-v1-flash\" (ultra-fast) or \"kiki-v2-pro\" (expressive)"],
              ["voice_id", "string", "ishita_enhi_companion", "Identifier of the voice persona from CLOZFLOW_VOICE_LIST"],
              ["text", "string", "Required", "The text to speak (supports Hindi, Hinglish, Bengali, English, etc.)"],
              ["language", "string", "\"hi\"", "Language code: \"hi\", \"en\", \"hi-en\", \"bn\", \"ta\", \"te\", etc."],
              ["audio_format", "string", "\"wav_24000\"", "\"wav_24000\", \"wav_16000\", \"pcm_8000\", \"mp3_44100\""],
              ["speed", "number", "1.0", "Playback speed multiplier (0.7 to 1.5)"],
              ["pitch", "number", "0.0", "Semitone pitch shift (-12.0 to +12.0)"],
              ["stream", "boolean", "false", "If true, streams raw chunked bytes over HTTP connection"]
            ]
          }
        },
        {
          id: "response-samples",
          heading: "Response Samples",
          codeTabs: {
            curl: `curl -X POST "https://api.clozflow.in/v1/voice/synthesize" \\
  -H "Authorization: Bearer cloz_live_9a8b7c6d5e4f3a2b1c0d" \\
  -H "Content-Type: application/json" \\
  -d '{
    "model": "kiki-v1-flash",
    "voice_id": "ishita_enhi_companion",
    "text": "Namaste, ClozFlow platform mein aapka swagat hai.",
    "audio_format": "wav_24000"
  }'`,
            response200: `{
  "status": "success",
  "audio_url": "https://cdn.clozflow.in/v1/audio/syn_98f82a1b9c.wav",
  "duration_seconds": 3.42,
  "metrics": {
    "mel_generation_time_ms": 78,
    "vocoder_time_ms": 14,
    "total_time_to_first_audio_ms": 92
  }
}`
          }
        }
      ]
    }
  },

  // ─────────────────────────────────────────────────────────────
  // 17. API: CHAT COMPLETIONS
  // ─────────────────────────────────────────────────────────────
  "api-chat-completions": {
    id: "api-chat-completions",
    title: "POST /v1/chat/completions",
    badge: "REST Endpoint",
    lastUpdated: "November 2026",
    summary: "Multi-turn conversational completion with automatic offline XGBoost sales objection classification.",
    toc: [
      { id: "chat-spec", title: "Endpoint Specification" },
      { id: "chat-body", title: "Request Body Parameters" },
      { id: "chat-response", title: "Response Payload" }
    ],
    content: {
      sections: [
        {
          id: "chat-spec",
          heading: "Endpoint Specification",
          endpoint: {
            method: "POST",
            path: "https://api.clozflow.in/v1/chat/completions"
          },
          body: `OpenAI-compatible chat completion endpoint enhanced with ClozFlow's real-time psychological objection classification and high-status response generation.`
        },
        {
          id: "chat-body",
          heading: "Request Body Parameters",
          table: {
            headers: ["Field", "Type", "Required", "Description"],
            rows: [
              ["model", "string", "Yes", "\"clozflow-llama-3.3-70b\""],
              ["messages", "array", "Yes", "Array of role/content chat objects"],
              ["stream", "boolean", "No", "Stream token delta events via Server-Sent Events (SSE)"],
              ["strategy_classifier", "boolean", "No", "Enable offline ML objection detection (<50ms)"],
              ["temperature", "number", "No", "Default 0.35 for disciplined consultative sales answers"]
            ]
          }
        },
        {
          id: "chat-response",
          heading: "Response Payload",
          codeTabs: {
            response200: `{
  "id": "chatcmpl_9876543210",
  "object": "chat.completion",
  "created": 1731245600,
  "model": "clozflow-llama-3.3-70b",
  "choices": [
    {
      "index": 0,
      "message": {
        "role": "assistant",
        "content": "Samajh gaya Sharma ji. Lekin agar aapki team roz 3 ghante manual follow-ups pe spend kar rahi hai, toh ₹80,000 monthly leak ho raha hai. Kya hum 1 hafte ka pilot try karein?"
      },
      "finish_reason": "stop"
    }
  ],
  "clozflow_telemetry": {
    "detected_objection": "ROI_REFRAME",
    "emotion_classification": "cost_anxious",
    "ml_classifier_latency_ms": 39,
    "quality_score": 0.94
  }
}`
          }
        }
      ]
    }
  },

  // ─────────────────────────────────────────────────────────────
  // 18. API: AGENTS DEPLOY
  // ─────────────────────────────────────────────────────────────
  "api-agents-deploy": {
    id: "api-agents-deploy",
    title: "POST /v1/agents/deploy",
    badge: "REST Endpoint",
    lastUpdated: "November 2026",
    summary: "Initiate an outbound telephonic call between an autonomous Pearl agent and a customer phone number.",
    toc: [
      { id: "deploy-spec", title: "Endpoint Specification" },
      { id: "deploy-body", title: "Request Parameters" },
      { id: "deploy-response", title: "Response Payload" }
    ],
    content: {
      sections: [
        {
          id: "deploy-spec",
          heading: "Endpoint Specification",
          endpoint: {
            method: "POST",
            path: "https://api.clozflow.in/v1/agents/deploy"
          },
          body: `Dials the target mobile number through your active telecom trunk and binds the conversation to the specified agent configuration.`
        },
        {
          id: "deploy-body",
          heading: "Request Parameters",
          table: {
            headers: ["Field", "Type", "Required", "Description"],
            rows: [
              ["agent_id", "string", "Yes", "ID of the configured agent (e.g. \"ag_pearl_closer_01\")"],
              ["phone_number", "string", "Yes", "Target phone number with country code (e.g. \"+919876543210\")"],
              ["customer_name", "string", "No", "Customer's name for dynamic prompt injection"],
              ["model", "string", "No", "\"kiki-v1-flash\" or \"kiki-v2-pro\""],
              ["initial_variables", "object", "No", "Key-value map injected into the agent prompt"],
              ["webhook_url", "string", "No", "Target URL to receive live call progress events"],
              ["max_call_duration_seconds", "number", "No", "Default 600 (10 minutes) safety timeout"]
            ]
          }
        },
        {
          id: "deploy-response",
          heading: "Response Payload",
          codeTabs: {
            response200: `{
  "status": "initiated",
  "call_id": "call_9a82f1b0c9e8",
  "agent_id": "ag_pearl_closer_01",
  "to_number": "+919876543210",
  "carrier": "Exotel",
  "created_at": "2026-11-10T13:30:00Z",
  "websocket_stream_url": "wss://stream.clozflow.in/v1/calls/call_9a82f1b0c9e8"
}`
          }
        }
      ]
    }
  },

  // ─────────────────────────────────────────────────────────────
  // 19. API: CAMPAIGNS BATCH
  // ─────────────────────────────────────────────────────────────
  "api-campaigns-batch": {
    id: "api-campaigns-batch",
    title: "POST /v1/campaigns/batch",
    badge: "REST Endpoint",
    lastUpdated: "November 2026",
    summary: "Launch a batch dialer campaign with up to 10,000 leads in a single API call.",
    toc: [
      { id: "batch-spec", title: "Endpoint Specification" },
      { id: "batch-body", title: "Parameters & Lead Array" },
      { id: "batch-response", title: "Campaign Response" }
    ],
    content: {
      sections: [
        {
          id: "batch-spec",
          heading: "Endpoint Specification",
          endpoint: {
            method: "POST",
            path: "https://api.clozflow.in/v1/campaigns/batch"
          },
          body: `Submits a list of phone numbers with customized metadata for automated queueing and progressive dialing.`
        },
        {
          id: "batch-body",
          heading: "Parameters & Lead Array",
          codeSnippet: {
            json: `{
  "campaign_name": "Bangalore FinTech Q4 Inbound",
  "agent_id": "ag_pearl_closer_01",
  "concurrency_limit": 50,
  "calling_window": {
    "start_time_ist": "10:00",
    "end_time_ist": "19:30"
  },
  "leads": [
    {
      "phone_number": "+919876543210",
      "customer_name": "Vikram Sethi",
      "custom_fields": {
        "mrr": "₹2,50,000",
        "renewal_due": "15 Nov"
      }
    },
    {
      "phone_number": "+919811223344",
      "customer_name": "Ananya Roy",
      "custom_fields": {
        "mrr": "₹1,80,000",
        "renewal_due": "18 Nov"
      }
    }
  ]
}`
          }
        },
        {
          id: "batch-response",
          heading: "Campaign Response",
          codeTabs: {
            response200: `{
  "status": "queued",
  "campaign_id": "cmp_89f1a23b45",
  "total_leads_queued": 2,
  "estimated_completion_minutes": 4,
  "concurrency_allocated": 50
}`
          }
        }
      ]
    }
  },

  // ─────────────────────────────────────────────────────────────
  // 20. API: GET CALLS
  // ─────────────────────────────────────────────────────────────
  "api-calls-get": {
    id: "api-calls-get",
    title: "GET /v1/calls/{id}",
    badge: "REST Endpoint",
    lastUpdated: "November 2026",
    summary: "Retrieve full call telemetry, audio recording, word-level transcript, detected objections, and deal outcome score.",
    toc: [
      { id: "calls-spec", title: "Endpoint Specification" },
      { id: "calls-response", title: "Full Call Telemetry Object" }
    ],
    content: {
      sections: [
        {
          id: "calls-spec",
          heading: "Endpoint Specification",
          endpoint: {
            method: "GET",
            path: "https://api.clozflow.in/v1/calls/{call_id}"
          },
          body: `Retrieves complete post-call analytics and audio links.`
        },
        {
          id: "calls-response",
          heading: "Full Call Telemetry Object",
          codeTabs: {
            response200: `{
  "call_id": "call_9a82f1b0c9e8",
  "status": "completed",
  "duration_seconds": 184,
  "recording_url": "https://cdn.clozflow.in/recordings/call_9a82f1b0c9e8.wav",
  "outcome": "meeting_booked",
  "deal_commitment_score": 0.88,
  "objections_detected": [
    {
      "strategy": "ROI_REFRAME",
      "timestamp_ms": 42100,
      "prospect_quote": "Bhai thoda budget exceed ho raha hai",
      "agent_response": "Samajh gaya sir, lekin monthly ₹1.2 lakh leak ho raha hai...",
      "resolution": "mitigated"
    }
  ],
  "transcript": [
    { "speaker": "agent", "text": "Namaste Rajesh ji, ClozFlow se baat kar raha hoon.", "time_ms": 1200 },
    { "speaker": "customer", "text": "Haan boliye, kya kaam tha?", "time_ms": 3400 }
  ]
}`
          }
        }
      ]
    }
  },

  // ─────────────────────────────────────────────────────────────
  // 21. API: KNOWLEDGE INGEST
  // ─────────────────────────────────────────────────────────────
  "api-knowledge-ingest": {
    id: "api-knowledge-ingest",
    title: "POST /v1/knowledge/ingest",
    badge: "RAG Engine",
    lastUpdated: "November 2026",
    summary: "Upload company pricing brochures, product manuals, and objection guidelines to the FAISS vector index.",
    toc: [
      { id: "ingest-spec", title: "Endpoint Specification" },
      { id: "ingest-body", title: "Request Format" }
    ],
    content: {
      sections: [
        {
          id: "ingest-spec",
          heading: "Endpoint Specification",
          endpoint: {
            method: "POST",
            path: "https://api.clozflow.in/v1/knowledge/ingest"
          },
          body: `Embeds text or PDF documents into your workspace's dedicated FAISS binary index. Pearl agents automatically query this knowledge base (<18ms) during live phone conversations.`
        },
        {
          id: "ingest-body",
          heading: "Request Format",
          codeTabs: {
            curl: `curl -X POST "https://api.clozflow.in/v1/knowledge/ingest" \\
  -H "Authorization: Bearer cloz_live_9a8b7c6d5e4f3a2b1c0d" \\
  -F "title=Q4_Enterprise_Pricing" \\
  -F "file=@pricing_sheet.pdf" \\
  -F "category=pricing"`
          }
        }
      ]
    }
  },

  // ─────────────────────────────────────────────────────────────
  // 22. API: WALLET BALANCE
  // ─────────────────────────────────────────────────────────────
  "api-wallet-balance": {
    id: "api-wallet-balance",
    title: "GET /v1/wallet/balance",
    badge: "Billing",
    lastUpdated: "November 2026",
    summary: "Check remaining telephony credits, model compute tokens, and current billing tier.",
    toc: [
      { id: "wallet-spec", title: "Endpoint Specification" },
      { id: "wallet-response", title: "Balance Breakdown" }
    ],
    content: {
      sections: [
        {
          id: "wallet-spec",
          heading: "Endpoint Specification",
          endpoint: {
            method: "GET",
            path: "https://api.clozflow.in/v1/wallet/balance"
          },
          body: `Returns live balance details in Indian Rupees (INR) and USD equivalents.`
        },
        {
          id: "wallet-response",
          heading: "Balance Breakdown",
          codeTabs: {
            response200: `{
  "wallet_id": "wal_882910fa",
  "currency": "INR",
  "balance_inr": 14250.75,
  "minutes_remaining_flash": 23751,
  "minutes_remaining_pro": 7917,
  "auto_recharge_enabled": true,
  "threshold_inr": 2000.00
}`
          }
        }
      ]
    }
  },

  // ─────────────────────────────────────────────────────────────
  // 23. API: REALTIME WEBSOCKET
  // ─────────────────────────────────────────────────────────────
  "api-stream-realtime": {
    id: "api-stream-realtime",
    title: "WS /v1/stream/realtime",
    badge: "WebSocket Stream",
    lastUpdated: "November 2026",
    summary: "Bidirectional, full-duplex WebSocket stream for low-latency voice streaming, barge-in detection, and real-time transcription.",
    toc: [
      { id: "ws-handshake", title: "Handshake & Protocol" },
      { id: "ws-messages", title: "Message Types & Framing" },
      { id: "ws-client-code", title: "Client Implementation Example" }
    ],
    content: {
      sections: [
        {
          id: "ws-handshake",
          heading: "Handshake & Protocol",
          body: `Connect to the bidirectional real-time audio socket:
          
\`\`\`
wss://stream.clozflow.in/v1/realtime?token=cloz_live_9a8b7c6d5e4f3a2b1c0d&model=kiki-v1-flash
\`\`\`
          
The client sends binary 16kHz / 8kHz linear PCM audio chunks and receives binary synthesized voice chunks back over the same persistent TCP socket.`
        },
        {
          id: "ws-messages",
          heading: "Message Types & Framing",
          table: {
            headers: ["Message Event", "Direction", "Payload"],
            rows: [
              ["session.update", "Client -> Server", "JSON: Sets voice_id, temperature, system prompt"],
              ["input_audio_buffer.append", "Client -> Server", "Binary: Raw 16kHz PCM audio bytes"],
              ["response.audio.delta", "Server -> Client", "Binary: Synthesized voice audio chunk (20ms)"],
              ["playback.interrupt", "Server -> Client", "JSON: Notifies that human spoke; clear active speaker queue"]
            ]
          }
        },
        {
          id: "ws-client-code",
          heading: "Client Implementation Example",
          codeTabs: {
            python: `import websocket
import json

ws = websocket.WebSocket()
ws.connect("wss://stream.clozflow.in/v1/realtime?token=cloz_live_9a8b7c6d5e4f3a2b1c0d")

# 1. Initialize session
ws.send(json.dumps({
    "type": "session.update",
    "model": "kiki-v1-flash",
    "voice_id": "ishita_enhi_companion"
}))

# 2. Stream microphone bytes
while mic_active:
    pcm_data = read_microphone_frame()
    ws.send_binary(pcm_data)`
          }
        }
      ]
    }
  },

  // ─────────────────────────────────────────────────────────────
  // 24. PYTHON SDK
  // ─────────────────────────────────────────────────────────────
  "sdks-python": {
    id: "sdks-python",
    title: "Python SDK",
    badge: "pip install clozflow",
    lastUpdated: "November 2026",
    summary: "Official Python library for ClozFlow with native async support, type annotations, and streaming iterators.",
    toc: [
      { id: "py-install", title: "Installation" },
      { id: "py-init", title: "Initialization & Client Setup" },
      { id: "py-async", title: "Async Streaming Example" }
    ],
    content: {
      sections: [
        {
          id: "py-install",
          heading: "Installation",
          codeSnippet: {
            bash: `pip install clozflow`
          }
        },
        {
          id: "py-init",
          heading: "Initialization & Client Setup",
          codeTabs: {
            python: `from clozflow import ClozFlowClient

client = ClozFlowClient(
    api_key="cloz_live_9a8b7c6d5e4f3a2b1c0d",
    timeout=15.0
)

# List available voices
voices = client.voice.list()
print(f"Loaded {len(voices)} regional voices.")`
          }
        },
        {
          id: "py-async",
          heading: "Async Streaming Example",
          codeTabs: {
            python: `import asyncio
from clozflow import AsyncClozFlowClient

async def main():
    async with AsyncClozFlowClient(api_key="cloz_live_9a8b7c6d5e4f3a2b1c0d") as client:
        stream = await client.voice.synthesize_stream(
            model="kiki-v1-flash",
            voice_id="aditya_hi_sales",
            text="Sharma ji, 10 minute mein demo call schedule kar rahe hain.",
            language="hi"
        )
        async for chunk in stream:
            await play_audio_chunk(chunk)

asyncio.run(main())`
          }
        }
      ]
    }
  },

  // ─────────────────────────────────────────────────────────────
  // 25. NODE.JS SDK
  // ─────────────────────────────────────────────────────────────
  "sdks-node": {
    id: "sdks-node",
    title: "Node.js SDK",
    badge: "npm install @clozflow/sdk",
    lastUpdated: "November 2026",
    summary: "Official TypeScript/JavaScript library for Node.js, Next.js, and Bun runtime environments.",
    toc: [
      { id: "node-install", title: "Installation" },
      { id: "node-init", title: "Usage Example" }
    ],
    content: {
      sections: [
        {
          id: "node-install",
          heading: "Installation",
          codeSnippet: {
            bash: `npm install @clozflow/sdk`
          }
        },
        {
          id: "node-init",
          heading: "Usage Example",
          codeTabs: {
            node: `import { ClozFlow } from '@clozflow/sdk';

const cloz = new ClozFlow({
  apiKey: process.env.CLOZFLOW_API_KEY
});

// Deploy an autonomous voice agent call
const call = await cloz.agents.deploy({
  agentId: 'ag_pearl_closer_01',
  phoneNumber: '+919876543210',
  customerName: 'Anand Kumar',
  model: 'kiki-v2-pro'
});

console.log('Call queued:', call.callId);`
          }
        }
      ]
    }
  },

  // ─────────────────────────────────────────────────────────────
  // 26. REST & CURL DIRECT ACCESS
  // ─────────────────────────────────────────────────────────────
  "sdks-curl": {
    id: "sdks-curl",
    title: "cURL & REST Direct Access",
    badge: "Direct HTTP",
    lastUpdated: "November 2026",
    summary: "Make direct HTTP calls using raw cURL commands from any programming language or shell script.",
    toc: [
      { id: "curl-voice", title: "Synthesizing Voice via cURL" },
      { id: "curl-agent", title: "Deploying Call via cURL" }
    ],
    content: {
      sections: [
        {
          id: "curl-voice",
          heading: "Synthesizing Voice via cURL",
          codeTabs: {
            curl: `curl -X POST "https://api.clozflow.in/v1/voice/synthesize" \\
  -H "Authorization: Bearer cloz_live_9a8b7c6d5e4f3a2b1c0d" \\
  -H "Content-Type: application/json" \\
  -d '{
    "model": "kiki-v1-flash",
    "voice_id": "ishita_enhi_companion",
    "language": "hi",
    "text": "Hello world from ClozFlow voice API"
  }' \\
  --output test.wav`
          }
        },
        {
          id: "curl-agent",
          heading: "Deploying Call via cURL",
          codeTabs: {
            curl: `curl -X POST "https://api.clozflow.in/v1/agents/deploy" \\
  -H "Authorization: Bearer cloz_live_9a8b7c6d5e4f3a2b1c0d" \\
  -H "Content-Type: application/json" \\
  -d '{
    "agent_id": "ag_pearl_closer_01",
    "phone_number": "+919876543210"
  }'`
          }
        }
      ]
    }
  },

  // ─────────────────────────────────────────────────────────────
  // 27. WEBHOOKS
  // ─────────────────────────────────────────────────────────────
  webhooks: {
    id: "webhooks",
    title: "Webhooks & Event Delivery",
    badge: "HMAC-SHA256",
    lastUpdated: "November 2026",
    summary: "Real-time HTTP callbacks delivered to your server for call progress, objections, commitments, and audio recordings.",
    toc: [
      { id: "webhook-setup", title: "Setting up Webhooks" },
      { id: "verifying-signatures", title: "Verifying HMAC-SHA256 Signatures" },
      { id: "event-catalog", title: "Supported Event Types" },
      { id: "sample-payload", title: "Sample Webhook Payload" }
    ],
    content: {
      sections: [
        {
          id: "webhook-setup",
          heading: "Setting up Webhooks",
          body: `Register your webhook endpoint in the [Workspace Settings](/settings) or specify a \`webhook_url\` parameter when deploying calls via the API. ClozFlow sends an HTTP POST request with a JSON payload for every event.`
        },
        {
          id: "verifying-signatures",
          heading: "Verifying HMAC-SHA256 Signatures",
          body: `Every webhook request includes an \`X-Cloz-Signature\` header. Compute the HMAC-SHA256 hash of the raw request body using your webhook secret to confirm authenticity:`,
          codeTabs: {
            python: `import hmac
import hashlib

def verify_clozflow_webhook(raw_body_bytes, signature_header, secret):
    expected = hmac.new(secret.encode(), raw_body_bytes, hashlib.sha256).hexdigest()
    return hmac.compare_digest(expected, signature_header)`
          }
        },
        {
          id: "event-catalog",
          heading: "Supported Event Types",
          table: {
            headers: ["Event Name", "Trigger Condition", "Key Data Returned"],
            rows: [
              ["call.initiated", "Call dispatched to telecom provider", "call_id, to_number, timestamp"],
              ["call.answered", "Customer picked up the phone", "answer_timestamp, carrier_latency"],
              ["objection.detected", "Customer raised a sales objection", "strategy (e.g. ROI_REFRAME), quote, resolution"],
              ["call.completed", "Call ended by either party", "duration, recording_url, outcome, transcript"],
              ["recording.ready", "Stereo audio file uploaded to CDN", "recording_url, size_bytes, duration"]
            ]
          }
        },
        {
          id: "sample-payload",
          heading: "Sample Webhook Payload",
          codeSnippet: {
            json: `{
  "event": "objection.detected",
  "call_id": "call_9a82f1b0c9e8",
  "timestamp": "2026-11-10T13:34:12Z",
  "data": {
    "strategy_classified": "ROI_REFRAME",
    "customer_quote": "Bohot mehnga hai aapka subscription",
    "agent_counter_strategy": "Highlighted monthly revenue leak of ₹1.2L",
    "customer_reaction": "softened_agreed_to_pilot"
  }
}`
          }
        }
      ]
    }
  },

  // ─────────────────────────────────────────────────────────────
  // 28. ERRORS & RATE LIMITS
  // ─────────────────────────────────────────────────────────────
  "errors-limits": {
    id: "errors-limits",
    title: "Error Codes & Rate Limits",
    badge: "SLA Guardrails",
    lastUpdated: "November 2026",
    summary: "Exhaustive reference of standard HTTP error codes, error payload schemas, and tier-based rate limits.",
    toc: [
      { id: "error-schema", title: "Error Response Format" },
      { id: "status-codes", title: "HTTP Status Code Reference" },
      { id: "rate-limits", title: "Rate Limits by Plan Tier" }
    ],
    content: {
      sections: [
        {
          id: "error-schema",
          heading: "Error Response Format",
          body: `All error responses return standard JSON with an \`error\` object containing code, message, and documentation link:`,
          codeSnippet: {
            json: `{
  "error": {
    "code": "insufficient_wallet_credits",
    "message": "Your wallet balance (₹14.20) is below the minimum required to initiate an outbound call. Please recharge your wallet.",
    "doc_url": "https://clozflow.in/docs#errors-limits",
    "request_id": "req_88f912bc0a"
  }
}`
          }
        },
        {
          id: "status-codes",
          heading: "HTTP Status Code Reference",
          table: {
            headers: ["Status Code", "Error Identifier", "Remediation"],
            rows: [
              ["400 Bad Request", "invalid_phone_number_format", "Verify phone number begins with valid country code (e.g. +91)"],
              ["401 Unauthorized", "invalid_api_key", "Check that Authorization header contains valid Bearer token"],
              ["402 Payment Required", "insufficient_wallet_credits", "Top up wallet credits in Dashboard > Billing"],
              ["403 Forbidden", "ip_not_allowlisted", "Add request IP to Workspace Settings > Security"],
              ["422 Unprocessable", "unsupported_audio_format", "Use one of: wav_24000, wav_16000, pcm_8000, mp3_44100"],
              ["429 Too Many Requests", "rate_limit_exceeded", "Throttle requests or upgrade plan concurrency tier"],
              ["502 Bad Gateway", "telecom_carrier_unreachable", "Carrier SIP trunk offline; automatic secondary fallback triggered"],
              ["504 Gateway Timeout", "voice_synthesis_timeout", "Kiki synthesis took >15.0s SLA; safe fallback audio served"]
            ]
          }
        },
        {
          id: "rate-limits",
          heading: "Rate Limits by Plan Tier",
          table: {
            headers: ["Plan Tier", "Max Concurrent Calls", "TTS Requests / Minute", "Support SLA"],
            rows: [
              ["Starter", "5 lines", "60 req / min", "Email (24 hrs)"],
              ["Growth", "25 lines", "300 req / min", "Priority Discord + Email (4 hrs)"],
              ["Enterprise", "250+ lines (Custom)", "2,000+ req / min", "24/7 Dedicated Slack + 99.99% Uptime SLA"]
            ]
          }
        }
      ]
    }
  },

  // ─────────────────────────────────────────────────────────────
  // 29. CHANGELOG
  // ─────────────────────────────────────────────────────────────
  changelog: {
    id: "changelog",
    title: "Platform Changelog",
    badge: "v2.4.0",
    lastUpdated: "November 2026",
    summary: "Release history, model upgrades, and new platform capabilities.",
    toc: [
      { id: "v240", title: "Version 2.4.0 (November 2026)" },
      { id: "v230", title: "Version 2.3.0 (October 2026)" },
      { id: "v220", title: "Version 2.2.0 (September 2026)" }
    ],
    content: {
      sections: [
        {
          id: "v240",
          heading: "Version 2.4.0 (November 2026)",
          body: `* **Kiki v2 Pro Foundation:** Released 2.5B parameter conversational voice model with zero-shot 3-second cloning.
* **11 Regional Indian Languages:** Added native support for Assamese, Odia, Gujarati, Marathi, Punjabi, Kannada, Malayalam, Telugu, and Tamil.
* **Sub-220ms Pipeline:** Re-engineered Silero VAD C++ pipeline to achieve 198ms P50 turn-taking latency.
* **Batch Dialer V2:** Added automated answering machine detection (AMD) and NDNC compliance scrubbing.`
        },
        {
          id: "v230",
          heading: "Version 2.3.0 (October 2026)",
          body: `* **Offline XGBoost ML Classifier:** Reduced objection classification time from 850ms to 42ms.
* **Exotel SIP Direct Integration:** Direct RTP packet streaming into Indian mobile carrier networks.
* **Live Telemetry Webhooks:** Added granular \`objection.detected\` and \`playback.interrupt\` events.`
        },
        {
          id: "v220",
          heading: "Version 2.2.0 (September 2026)",
          body: `* **Kiki v1 Flash Released:** 99M parameter ultra-compact voice model for cold dialing.
* **FAISS Vector Indexing:** Integrated real-time knowledge base lookups with strict 2-chunk prompt budgets.`
        }
      ]
    }
  }
};
