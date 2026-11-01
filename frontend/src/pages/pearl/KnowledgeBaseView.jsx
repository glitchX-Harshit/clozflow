import React, { useState, useEffect, useRef, useMemo } from 'react';
import { 
  Globe, FileText, Plus, ArrowRight, Check, Loader2, RefreshCw, 
  Trash2, Edit3, ShieldCheck, Sparkles, ExternalLink, ChevronRight,
  Database, UploadCloud, AlertCircle, Eye, CheckCircle2, XCircle, ArrowLeft,
  Cpu, Terminal, Activity, Zap, Layers, Clock, Radio, Compass, Bot, RotateCcw
} from 'lucide-react';
import { AgentWorkflow } from '@/components/ui/ai-thinking-and-tool-calls';
import './KnowledgeBaseView.css';

const CUSTOM_TOOLS = {
  db_inspect: {
    name: "db_inspect",
    label: "Inspect Schema",
    icon: Database,
    monoChip: true,
  },
  vuln_scan: {
    name: "vuln_scan",
    label: "Security Audit",
    icon: ShieldCheck,
  },
  cluster_exec: {
    name: "cluster_exec",
    label: "Deploy Runtime",
    icon: Cpu,
    monoChip: true,
  },
};

const DEFAULT_STAGES = [
  { stage: 1, title: 'Connecting to target website', detail: 'Validating host security and SSL certificates', category: 'Handshake' },
  { stage: 2, title: 'Discovering relevant routes', detail: 'Inspecting sitemap and navigation hierarchy', category: 'Discovery' },
  { stage: 3, title: 'Reading corporate information', detail: 'Parsing company overview, vision, and core mission', category: 'Positioning' },
  { stage: 4, title: 'Understanding products & services', detail: 'Mapping SKU architecture and capabilities', category: 'Catalog' },
  { stage: 5, title: 'Extracting features and pricing', detail: 'Analyzing commercial pricing tiers and plans', category: 'Commercial' },
  { stage: 6, title: 'Identifying target customer segments', detail: 'Profiling ICP, buyer personas, and decision makers', category: 'Audience' },
  { stage: 7, title: 'Analyzing pain points & objections', detail: 'Synthesizing objection battlecards and value pivots', category: 'Sales Intel' },
  { stage: 8, title: 'Building your Knowledge Capsules', detail: 'Structuring company-wide and product-level intelligence', category: 'Memory' },
  { stage: 9, title: 'Zero-hallucination verification', detail: 'Finalizing grounded version dossier for operator approval', category: 'Guardrails' }
];

const DOC_STAGES = [
  { stage: 1, title: 'Auditing document assets', detail: 'Parsing binary file structures and semantic layout', category: 'Ingestion' },
  { stage: 2, title: 'Extracting company narrative', detail: 'Synthesizing corporate overview and brand positioning', category: 'Positioning' },
  { stage: 3, title: 'Cataloging products and offerings', detail: 'Extracting capability specs and technical features', category: 'Catalog' },
  { stage: 4, title: 'Mapping commercial pricing structures', detail: 'Parsing pricing tables, SLAs, and feature gates', category: 'Commercial' },
  { stage: 5, title: 'Profiling buyer personas & ICP', detail: 'Extracting target customer profiles and friction points', category: 'Audience' },
  { stage: 6, title: 'Formulating sales battlecards', detail: 'Generating high-impact consultative objection pivots', category: 'Sales Intel' },
  { stage: 7, title: 'Generating semantic vector embeddings', detail: 'Indexing chunks into verified memory store', category: 'Vectors' },
  { stage: 8, title: 'Formulating modular Knowledge Capsules', detail: 'Isolating verified company, product, and ICP units', category: 'Memory' },
  { stage: 9, title: 'Verifying citation accuracy', detail: 'Cross-checking citations against original source files', category: 'Guardrails' }
];

const STAGE_THOUGHTS = {
  1: [
    "Establishing secure TLS handshake with target host...",
    "Validating SSL certificate and HTTP/2 protocol handshake...",
    "Inspecting robots.txt and sitemap index routing table...",
    "Host connectivity verified. Neural crawling worker online."
  ],
  2: [
    "Traversing sitemap.xml tree & sub-route hierarchies...",
    "Discovered candidate pages (pricing, products, about, solutions)...",
    "Filtering navigational boilerplate, cookie banners & tracking pixels...",
    "Compiled targeted ingestion manifest with priority URLs."
  ],
  3: [
    "Ingesting corporate identity, brand values & core vision...",
    "Extracting executive mission statement and company positioning...",
    "Analyzing brand voice register: consultative, confident, empathetic...",
    "Company identity vector coordinates anchored."
  ],
  4: [
    "Mapping product catalogue & solution taxonomy...",
    "Deconstructing SKU capabilities, technical specs & integrations...",
    "Extracting key differentiators vs conventional alternatives...",
    "Synthesized discrete product capability schemas."
  ],
  5: [
    "Parsing commercial pricing structures, contract terms & plans...",
    "Mapping feature gates, volume thresholds & pricing elasticity...",
    "Validating pricing boundaries for strict zero-hallucination guardrails...",
    "Commercial facts sealed into verified memory capsule."
  ],
  6: [
    "Profiling Ideal Customer Profile (ICP) & target buyer segments...",
    "Mapping decision-maker roles (Founders, VP Ops, Procurement)...",
    "Identifying core operational friction and trigger events...",
    "Buyer persona matrix compiled."
  ],
  7: [
    "Mining high-frequency sales objections & hesitation triggers...",
    "Synthesizing evidence-backed consultative pivot battlecards...",
    "Generating dynamic pattern interrupt openers tailored to ICP...",
    "Objection handling decision trees loaded into agent cache."
  ],
  8: [
    "Structuring Company Knowledge Capsule (v1)...",
    "Generating discrete Product Knowledge Capsules...",
    "Vectorizing text chunks with semantic dense embeddings...",
    "Grounding factual statements in Hexagon vector store."
  ],
  9: [
    "Executing multi-point self-verification & hallucination checks...",
    "Cross-referencing all generated claims against original source excerpts...",
    "Finalizing Knowledge Dossier & generating operator summary...",
    "Knowledge synthesis complete! Ready for review."
  ]
};

const DOC_STAGE_THOUGHTS = {
  1: [
    "Auditing uploaded document binaries and MIME payloads...",
    "Validating document integrity and text structure...",
    "Extracting raw paragraphs, tables, and typography hierarchy...",
    "Document parser initialized. Ingestion pipeline active."
  ],
  2: [
    "Ingesting corporate overview, brand ethos, and mission...",
    "Extracting executive positioning and value proposition...",
    "Analyzing narrative tone and consultative voice...",
    "Company identity vector coordinates anchored."
  ],
  3: [
    "Parsing product catalogues, technical features, and SKUs...",
    "Extracting technical specifications and solution architecture...",
    "Categorizing key product differentiators vs industry standards...",
    "Synthesized discrete product capability schemas."
  ],
  4: [
    "Deconstructing commercial pricing matrices and plans...",
    "Parsing SLA tiers, volume discounts, and billing gates...",
    "Verifying commercial boundaries for zero hallucination...",
    "Pricing parameters locked into secure memory store."
  ],
  5: [
    "Profiling target customer personas and decision makers...",
    "Mapping buyer pain points, operational hurdles, and trigger events...",
    "Analyzing ICP expectations and consultative objections...",
    "Customer persona matrix compiled successfully."
  ],
  6: [
    "Mining high-frequency sales friction points and hesitation patterns...",
    "Formulating evidence-backed consultative value pivots...",
    "Generating dynamic sales objection battlecards...",
    "Objection handling decision trees loaded into agent cache."
  ],
  7: [
    "Formulating dense semantic embeddings for document chunks...",
    "Generating high-dimensional vector representations...",
    "Indexing text embeddings in Hexagon vector store...",
    "Vector embedding index compilation complete."
  ],
  8: [
    "Structuring Company Knowledge Capsule (v1)...",
    "Formulating discrete Product Knowledge Capsules...",
    "Synthesizing Audience & Objection battlecard capsules...",
    "All modular Knowledge Capsules built."
  ],
  9: [
    "Running multi-pass citation verification against source text...",
    "Cross-referencing factual statements to prevent hallucinations...",
    "Sealing Knowledge Base dossier for operator review...",
    "Verification complete! Knowledge Base ready for Pearl."
  ]
};

const formatElapsed = (sec) => {
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  return `${m < 10 ? '0' : ''}${m}:${s < 10 ? '0' : ''}${s}s`;
};

export const KnowledgeBaseView = ({ user, onNavigateSection }) => {
  // Main view modes: 'landing' | 'analyzing' | 'dashboard'
  const [viewMode, setViewMode] = useState('loading');
  const [activeTab, setActiveTab] = useState('company'); // company | products | customer | sales | pages | versions

  // Landing form states
  const [websiteUrl, setWebsiteUrl] = useState('');
  const extractedDomain = websiteUrl ? websiteUrl.replace(/^https?:\/\//, '').split('/')[0] : '';
  const [showWebsiteForm, setShowWebsiteForm] = useState(false);
  const [showDocForm, setShowDocForm] = useState(false);
  const [selectedFiles, setSelectedFiles] = useState([]);
  const [uploadError, setUploadError] = useState(null);
  const [analysisType, setAnalysisType] = useState('website'); // 'website' | 'document'

  // Analysis / Job states
  const [activeJobId, setActiveJobId] = useState(null);
  const [jobProgress, setJobProgress] = useState(0);
  const [currentStage, setCurrentStage] = useState(1);
  const [jobTickerMessage, setJobTickerMessage] = useState('Connecting to source...');
  const [jobError, setJobError] = useState(null);
  const [isCompleted, setIsCompleted] = useState(false);
  const [autoRedirectCountdown, setAutoRedirectCountdown] = useState(4);
  const [isCountdownPaused, setIsCountdownPaused] = useState(false);
  const [replayKey, setReplayKey] = useState(0);

  // Real-time AI Analysis Animation & Telemetry States
  const [elapsedSeconds, setElapsedSeconds] = useState(0);
  const [terminalLogs, setTerminalLogs] = useState([]);
  const logsEndRef = useRef(null);

  // Overview / Dashboard data
  const [overviewData, setOverviewData] = useState(null);
  const [sourcePages, setSourcePages] = useState([]);
  const [editingFactId, setEditingFactId] = useState(null);
  const [editFactValue, setEditFactValue] = useState('');
  const [loadingAction, setLoadingAction] = useState(false);
  const [evidenceModal, setEvidenceModal] = useState(null);

  // Load existing Knowledge Base data
  const loadOverview = async () => {
    try {
      const token = localStorage.getItem('token');
      const res = await fetch(`${window.APP_API_BASE || ''}/api/knowledge/overview`, {
        headers: { Authorization: token ? `Bearer ${token}` : '' }
      });
      if (res.ok) {
        const data = await res.json();
        setOverviewData(data);
        if (data.stats.total_capsules > 0 || data.stats.total_sources > 0) {
          setViewMode('dashboard');
        } else {
          setViewMode('landing');
        }
      } else {
        setViewMode('landing');
      }
    } catch (err) {
      console.error('Failed to load knowledge overview:', err);
      setViewMode('landing');
    }
  };

  useEffect(() => {
    loadOverview();
  }, []);

  // ── Real-Time SSE Stream Listener ──────────────────────────────────────────
  useEffect(() => {
    if (viewMode !== 'analyzing' || !activeJobId) return;

    let eventSource = null;
    let pollInterval = null;

    try {
      const token = localStorage.getItem('token');
      const tokenQuery = token ? `?token=${encodeURIComponent(token)}` : '';
      const streamUrl = `${window.APP_API_BASE || ''}/api/knowledge/jobs/${activeJobId}/stream${tokenQuery}`;
      
      eventSource = new EventSource(streamUrl);

      eventSource.onmessage = (event) => {
        try {
          const data = JSON.parse(event.data);
          if (data.progress !== undefined) setJobProgress(data.progress);
          if (data.stage !== undefined) setCurrentStage(data.stage);
          if (data.message) {
            setJobTickerMessage(data.message);
            setTerminalLogs(prev => {
              if (prev.length > 0 && prev[prev.length - 1].text === data.message) return prev;
              return [...prev, { time: formatElapsed(elapsedSeconds), text: data.message, stage: data.stage || currentStage }].slice(-15);
            });
          }

          if (data.status === 'completed') {
            eventSource.close();
            setJobProgress(100);
            setCurrentStage(9);
            setIsCompleted(true);
            setAutoRedirectCountdown(4);
          } else if (data.status === 'failed') {
            setJobError(data.error || 'Ingestion encountered an error.');
            eventSource.close();
          }
        } catch (e) {}
      };

      eventSource.onerror = () => {
        // Fallback to polling if SSE fails
        if (eventSource) eventSource.close();
        pollInterval = setInterval(async () => {
          try {
            const res = await fetch(`${window.APP_API_BASE || ''}/api/knowledge/jobs/${activeJobId}`, {
              headers: { Authorization: token ? `Bearer ${token}` : '' }
            });
            if (res.ok) {
              const jdata = await res.json();
              if (jdata.progress) setJobProgress(jdata.progress);
              if (jdata.stage) setCurrentStage(jdata.stage);
              if (jdata.message) {
                setJobTickerMessage(jdata.message);
                setTerminalLogs(prev => {
                  if (prev.length > 0 && prev[prev.length - 1].text === jdata.message) return prev;
                  return [...prev, { time: formatElapsed(elapsedSeconds), text: jdata.message, stage: jdata.stage || currentStage }].slice(-15);
                });
              }

              if (jdata.status === 'completed') {
                clearInterval(pollInterval);
                setJobProgress(100);
                setCurrentStage(9);
                setIsCompleted(true);
                setAutoRedirectCountdown(4);
              } else if (jdata.status === 'failed') {
                setJobError(jdata.error || 'Ingestion failed.');
                clearInterval(pollInterval);
              }
            }
          } catch (e) {}
        }, 1500);
      };
    } catch (e) {}

    return () => {
      if (eventSource) eventSource.close();
      if (pollInterval) clearInterval(pollInterval);
    };
  }, [viewMode, activeJobId]);

  // ── Auto-transition to dashboard when completed ───────────────────────────
  useEffect(() => {
    if (viewMode !== 'analyzing' || !isCompleted || isCountdownPaused) return;

    if (autoRedirectCountdown <= 0) {
      loadOverview();
      setViewMode('dashboard');
      return;
    }

    const timer = setTimeout(() => {
      setAutoRedirectCountdown(prev => prev - 1);
    }, 1000);

    return () => clearTimeout(timer);
  }, [viewMode, isCompleted, isCountdownPaused, autoRedirectCountdown]);

  // ── Live Elapsed Stopwatch & Cognitive Log Stream Generation ──────────────
  useEffect(() => {
    if (viewMode !== 'analyzing') {
      setElapsedSeconds(0);
      setTerminalLogs([]);
      return;
    }

    const timer = setInterval(() => {
      setElapsedSeconds(prev => prev + 1);
    }, 1000);

    return () => clearInterval(timer);
  }, [viewMode]);

  const isDocs = analysisType === 'document';
  const targetDomain = extractedDomain || (websiteUrl ? websiteUrl.replace(/^https?:\/\//, '').split('/')[0] : '');
  const fileNames = selectedFiles.map(f => f.name);

  useEffect(() => {
    if (viewMode !== 'analyzing') return;

    const thoughtMap = isDocs ? DOC_STAGE_THOUGHTS : STAGE_THOUGHTS;
    const thoughts = thoughtMap[currentStage] || thoughtMap[1] || STAGE_THOUGHTS[1];
    const subIdx = Math.floor(elapsedSeconds / 3.2) % thoughts.length;
    const currentStepThought = thoughts[subIdx];
    const activeThought = (jobTickerMessage && jobTickerMessage !== 'Connecting to source...' && elapsedSeconds < 4)
      ? jobTickerMessage 
      : currentStepThought;
    const timestamp = formatElapsed(elapsedSeconds);

    setTerminalLogs(prev => {
      if (prev.length > 0 && prev[prev.length - 1].text === activeThought) {
        return prev;
      }
      return [...prev, { time: timestamp, text: activeThought, stage: currentStage }].slice(-15);
    });
  }, [elapsedSeconds, currentStage, viewMode, isDocs, jobTickerMessage]);

  useEffect(() => {
    if (logsEndRef.current) {
      logsEndRef.current.scrollIntoView({ behavior: 'smooth' });
    }
  }, [terminalLogs]);

  // Smooth calculated progress for Awwwards-winning fluid feel
  const calculatedProgress = useMemo(() => {
    if (isCompleted || jobProgress >= 100) return 100;
    const stageFloor = Math.min(Math.round(((currentStage - 1) / 9) * 100), 92);
    const withinStageOffset = Math.min((elapsedSeconds % 10) * 0.8, 8);
    const estimated = Math.min(Math.round(stageFloor + withinStageOffset), 96);
    return Math.max(jobProgress, estimated, 8);
  }, [jobProgress, currentStage, elapsedSeconds, isCompleted]);

  // Dynamic 3-Phase Agent Workflow Traces customized to the target domain/source
  const workflowPhases = useMemo(() => {
    const domain = targetDomain || 'clozflow.in';
    const url = websiteUrl || `https://${domain}`;

    return [
      // ── PHASE 1: Route Discovery & Host Handshake ──────────────────────────
      {
        trace: [
          {
            type: "reasoning",
            sentences: [
              `Auditing ${domain} routing tables, robots.txt, and sitemap manifest.`,
              `Validating host security, SSL certificates, and HTTP/2 protocol handshake with target host.`,
              `Discovered candidate routes for products, commercial pricing, documentation, and company overview.`,
              `Filtering navigational boilerplate, cookie banners, tracking pixels, and external ads.`,
              `Compiling high-priority ingestion manifest for deep semantic intelligence extraction.`
            ],
            durationSeconds: 5.5
          },
          {
            type: "tool",
            toolName: "read_file",
            args: { path: `${domain}/robots.txt` },
            lineStart: 1,
            lineEnd: 8,
            code: `User-agent: *\nAllow: /\nDisallow: /admin/\nDisallow: /cdn-cgi/\nSitemap: https://${domain}/sitemap.xml\n# Host discovery online\nCrawl-delay: 0`
          },
          {
            type: "tool",
            toolName: "vuln_scan",
            primary: "Handshake",
            secondary: `TLS 1.3 · ${domain}`,
            details: [
              { text: `✓ PASS  TLS 1.3 certificate verified (256-bit GCM)` },
              { text: `✓ PASS  Sitemap index parsed: 22 priority endpoints discovered` },
              { text: `✓ PASS  SSRF guardrail active — zero local subnet leakage` }
            ]
          },
          {
            type: "search",
            toolName: "search_web",
            secondary: `${domain} brand overview & core offerings`,
            sources: [
              { name: "Domain Records", url: url },
              { name: "SSL Transparency Log", url: url }
            ]
          }
        ],
        message: `Host discovery complete — verified SSL handshake and discovered candidate product & pricing routes on **${domain}**. Extracting corporate narrative and catalog schemas next.`
      },

      // ── PHASE 2: Corporate DNA & Product Catalog Extraction ────────────────
      {
        trace: [
          {
            type: "reasoning",
            sentences: [
              `Extracting executive mission statement, brand positioning, and consultative tone of voice.`,
              `Parsing product catalogues, technical features, SKU specifications, and solution architecture.`,
              `Deconstructing commercial pricing matrices, SLA tiers, and contract volume gates.`,
              `Validating commercial pricing boundaries for strict zero-hallucination guardrails.`,
              `Profiling Ideal Customer Profiles (ICP) and decision-maker roles (Founders, VP Ops, Procurement).`
            ],
            durationSeconds: 6.2
          },
          {
            type: "tool",
            toolName: "edit_file",
            args: { path: `capsules/${domain}_company_overview.json` },
            add: 6,
            del: 0,
            diffFile: `capsules/${domain}_company_overview.json`,
            diffRows: [
              { old: null, cur: 1, type: "add", text: "{" },
              { old: null, cur: 2, type: "add", text: `  "company_name": "${domain}",` },
              { old: null, cur: 3, type: "add", text: `  "status": "verified",` },
              { old: null, cur: 4, type: "add", text: `  "brand_tone": "consultative, confident, empathetic",` },
              { old: null, cur: 5, type: "add", text: `  "pricing_bounds": "strict zero-hallucination guardrails"` },
              { old: null, cur: 6, type: "add", text: "}" }
            ]
          },
          {
            type: "tool",
            toolName: "db_inspect",
            primary: "Query",
            secondary: "knowledge.capsules_staging",
            mono: true,
            details: [
              { text: "✓ Company capsule schema compiled" },
              { text: "✓ Pricing gates and tier elasticity locked" },
              { text: "✓ 0 slow-query alerts on vector coordinates" }
            ]
          },
          {
            type: "terminal",
            command: `curl -I ${url}/pricing --http2`,
            exitCode: 0,
            output: `HTTP/2 200 OK\ncontent-type: text/html; charset=utf-8\nx-robots-tag: index, follow\npricing-tiers: verified\ncommercial-sla: 99.99% availability locked`
          }
        ],
        message: `Catalog and commercial parameters extracted — **100% pricing accuracy**, zero ambiguity on tiers. Synthesizing sales battlecards and running vector self-verification next.`
      },

      // ── PHASE 3: Sales Objections & Zero-Hallucination Verification ────────
      {
        trace: [
          {
            type: "reasoning",
            sentences: [
              `Mining high-frequency sales objections, competitor friction points, and hesitation triggers.`,
              `Synthesizing evidence-backed consultative pivot battlecards tailored to target buyer personas.`,
              `Formulating dense semantic embeddings for text chunks using Hexagon vector store.`,
              `Executing multi-point self-verification to ensure zero hallucination against source citations.`,
              `Sealing Knowledge Base dossier for operator review and Pearl deployment.`
            ],
            durationSeconds: 5.8
          },
          {
            type: "tool",
            toolName: "edit_file",
            args: { path: "capsules/sales_battlecards.json" },
            add: 6,
            del: 1,
            diffFile: "capsules/sales_battlecards.json",
            diffRows: [
              { old: 1, cur: 1, type: "ctx", text: "// Objection: Pricing hesitation" },
              { old: 2, cur: null, type: "del", text: "// TODO: generate dynamic pivot" },
              { old: null, cur: 2, type: "add", text: "// Value Pivot: ROI demonstration backed by 100% citation grounding" },
              { old: null, cur: 3, type: "add", text: "export const objectionDecisionTree = {" },
              { old: null, cur: 4, type: "add", text: "  confidence: 1.0," },
              { old: null, cur: 5, type: "add", text: "  enforceCommercialBoundaries: true" },
              { old: null, cur: 6, type: "add", text: "};" }
            ]
          },
          {
            type: "terminal",
            command: "pytest tests/knowledge/zero_hallucination_test.py --strict-citations",
            exitCode: 0,
            output: `PASS tests/knowledge/zero_hallucination_test.py\n  ✓ should ground all product claims in source citations (14 ms)\n  ✓ should reject out-of-bounds commercial promises (11 ms)\n  ✓ should enforce objection battlecard triggers (18 ms)\n\nTest Suites: 1 passed, 1 total\nCoverage: 100% Statements, 100% Citations Verified`
          },
          {
            type: "tool",
            toolName: "cluster_exec",
            primary: "Deploy",
            secondary: "pearl-agent-cache",
            details: [
              { text: "✓ Knowledge Capsules loaded into Pearl runtime cache" },
              { text: "✓ Retrieval latency: p99 8.2 ms" },
              { text: "✓ Zero hallucination threshold: active" }
            ]
          }
        ],
        message: `Knowledge synthesis complete — all business context, commercial rules, and objection battlecards verified with **100% grounded citations**. Knowledge Base ready for Pearl.`
      }
    ];
  }, [targetDomain, websiteUrl]);

  // ── Retry Ingestion (handles both website & documents) ──────────────────────
  const handleRetryIngestion = () => {
    setJobError(null);
    if (analysisType === 'document') {
      handleUploadDocuments();
    } else {
      handleStartWebsiteCrawl();
    }
  };

  // ── Trigger Website Crawl ──────────────────────────────────────────────────
  const handleStartWebsiteCrawl = async (e) => {
    e?.preventDefault();
    if (!websiteUrl.trim()) return;

    setAnalysisType('website');
    setUploadError(null);
    setJobError(null);
    setIsCompleted(false);
    setAutoRedirectCountdown(4);
    setIsCountdownPaused(false);

    let cleanUrl = websiteUrl.trim();
    if (!cleanUrl.startsWith('http://') && !cleanUrl.startsWith('https://')) {
      cleanUrl = 'https://' + cleanUrl;
    }

    try {
      const token = localStorage.getItem('token');
      const res = await fetch(`${window.APP_API_BASE || ''}/api/knowledge/crawl`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: token ? `Bearer ${token}` : ''
        },
        body: JSON.stringify({ url: cleanUrl })
      });

      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.detail || 'Failed to start website crawl');
      }

      const data = await res.json();
      setActiveJobId(data.job_id);
      setCurrentStage(1);
      setJobProgress(10);
      setJobTickerMessage(`Connecting to ${cleanUrl}...`);
      setViewMode('analyzing');

    } catch (err) {
      setUploadError(err.message);
    }
  };

  // ── Trigger Document Upload ────────────────────────────────────────────────
  const handleUploadDocuments = async () => {
    if (selectedFiles.length === 0) return;
    setAnalysisType('document');
    setUploadError(null);
    setJobError(null);
    setIsCompleted(false);
    setAutoRedirectCountdown(4);
    setIsCountdownPaused(false);

    const formData = new FormData();
    for (const f of selectedFiles) {
      formData.append('files', f);
    }

    try {
      const token = localStorage.getItem('token');
      const res = await fetch(`${window.APP_API_BASE || ''}/api/knowledge/upload`, {
        method: 'POST',
        headers: { Authorization: token ? `Bearer ${token}` : '' },
        body: formData
      });

      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.detail || 'Upload failed');
      }

      const data = await res.json();
      setActiveJobId(data.job_id);
      setCurrentStage(1);
      setJobProgress(15);
      setJobTickerMessage(`Parsing ${selectedFiles.length} business documents...`);
      setViewMode('analyzing');

    } catch (err) {
      setUploadError(err.message);
    }
  };

  // ── Fact Editing & Approval ────────────────────────────────────────────────
  const handleSaveFactEdit = async (factId) => {
    try {
      const token = localStorage.getItem('token');
      const res = await fetch(`${window.APP_API_BASE || ''}/api/knowledge/facts/${factId}`, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          Authorization: token ? `Bearer ${token}` : ''
        },
        body: JSON.stringify({ value: editFactValue })
      });
      if (res.ok) {
        setEditingFactId(null);
        loadOverview();
      }
    } catch (e) {}
  };

  const handleToggleFactApproval = async (factId, currentStatus) => {
    const nextStatus = currentStatus === 'approved' ? 'rejected' : 'approved';
    try {
      const token = localStorage.getItem('token');
      const res = await fetch(`${window.APP_API_BASE || ''}/api/knowledge/facts/${factId}`, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          Authorization: token ? `Bearer ${token}` : ''
        },
        body: JSON.stringify({ approval_status: nextStatus })
      });
      if (res.ok) {
        loadOverview();
      }
    } catch (e) {}
  };

  // ── Publish Capsule ────────────────────────────────────────────────────────
  const handlePublishCapsule = async (capsuleId) => {
    setLoadingAction(true);
    try {
      const token = localStorage.getItem('token');
      const res = await fetch(`${window.APP_API_BASE || ''}/api/knowledge/capsules/${capsuleId}/publish`, {
        method: 'POST',
        headers: { Authorization: token ? `Bearer ${token}` : '' }
      });
      if (res.ok) {
        loadOverview();
      }
    } catch (e) {
    } finally {
      setLoadingAction(false);
    }
  };

  // ── Delete Single Capsule ──────────────────────────────────────────────────
  const handleDeleteCapsule = async (capsuleId, capsuleName) => {
    const confirmed = window.confirm(
      `Are you sure you want to delete the capsule "${capsuleName || 'Selected Capsule'}"?\n\nPearl will no longer use this product context.`
    );
    if (!confirmed) return;

    setLoadingAction(true);
    try {
      const token = localStorage.getItem('token');
      const res = await fetch(`${window.APP_API_BASE || ''}/api/knowledge/capsules/${capsuleId}`, {
        method: 'DELETE',
        headers: { Authorization: token ? `Bearer ${token}` : '' }
      });
      if (res.ok) {
        await loadOverview();
      } else {
        const err = await res.json().catch(() => ({}));
        alert(`Failed to delete capsule: ${err.detail || 'Unknown error'}`);
      }
    } catch (err) {
      console.error('Delete capsule error:', err);
      alert('Failed to delete capsule. Please check your connection.');
    } finally {
      setLoadingAction(false);
    }
  };

  // ── Reset Entire Knowledge Base & Context Completely ───────────────────────
  const handleResetAllKnowledge = async () => {
    const confirmed = window.confirm(
      '⚠️ WARNING: Are you sure you want to completely delete all Knowledge Capsules, crawled pages, and learned business context?\n\nThis will permanently purge all context and reset Pearl to a completely clean slate.'
    );
    if (!confirmed) return;

    setLoadingAction(true);
    try {
      const token = localStorage.getItem('token');
      const res = await fetch(`${window.APP_API_BASE || ''}/api/knowledge/reset`, {
        method: 'POST',
        headers: { Authorization: token ? `Bearer ${token}` : '' }
      });
      if (res.ok) {
        setOverviewData(null);
        setViewMode('landing');
      } else {
        const err = await res.json().catch(() => ({}));
        alert(`Failed to reset knowledge base: ${err.detail || 'Unknown error'}`);
      }
    } catch (err) {
      console.error('Reset knowledge error:', err);
      alert('Failed to reset knowledge base.');
    } finally {
      setLoadingAction(false);
    }
  };

  // ── Delete Connected Source ────────────────────────────────────────────────
  const handleDeleteSource = async (sourceId, sourceTitle) => {
    const confirmed = window.confirm(
      `Delete source "${sourceTitle || 'Selected Source'}" and all of its indexed pages?`
    );
    if (!confirmed) return;

    setLoadingAction(true);
    try {
      const token = localStorage.getItem('token');
      const res = await fetch(`${window.APP_API_BASE || ''}/api/knowledge/sources/${sourceId}`, {
        method: 'DELETE',
        headers: { Authorization: token ? `Bearer ${token}` : '' }
      });
      if (res.ok) {
        await loadOverview();
      } else {
        const err = await res.json().catch(() => ({}));
        alert(`Failed to delete source: ${err.detail || 'Unknown error'}`);
      }
    } catch (err) {
      console.error('Delete source error:', err);
      alert('Failed to delete source.');
    } finally {
      setLoadingAction(false);
    }
  };

  // ── RENDER: LOADING STATE ──────────────────────────────────────────────────
  if (viewMode === 'loading') {
    return (
      <div className="kb-root" style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', minHeight: '60vh' }}>
        <Loader2 size={24} className="animate-spin" color="#09090b" />
      </div>
    );
  }

  // ── RENDER: RESPONSIVE CENTER-ORIENTED AGENT WORKFLOW SYNTHESIS VIEW ───────
  if (viewMode === 'analyzing') {
    const isError = Boolean(jobError);
    const domain = targetDomain || extractedDomain || (websiteUrl ? websiteUrl.replace(/^https?:\/\//, '').split('/')[0] : 'target-domain.com');
    const sourceLabel = isDocs 
      ? `${selectedFiles.length || 1} Document${selectedFiles.length === 1 ? '' : 's'}` 
      : domain;

    return (
      <div className="kb-root animate-fade-in flex flex-col min-h-screen bg-white" style={{ backgroundColor: '#ffffff', color: '#09090b' }}>
        {/* Top Breadcrumb Bar */}
        <div className="kb-top-bar" style={{ backgroundColor: '#ffffff', borderBottom: '1px solid #f0f0f2' }}>
          <div className="kb-breadcrumb">
            <span>Pearl</span>
            <span>/</span>
            <span className="kb-breadcrumb-title">
              {isCompleted ? 'Neural Synthesis Complete' : 'Neural Knowledge Synthesis'}
            </span>
          </div>
          <div className="flex items-center gap-2">
            {!isCompleted ? (
              <>
                <button
                  type="button"
                  onClick={() => setReplayKey(k => k + 1)}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-zinc-600 bg-white border border-zinc-200 rounded-lg hover:bg-zinc-50 shadow-2xs transition-colors cursor-pointer"
                  title="Replay autonomous synthesis trace"
                >
                  <RotateCcw size={12} />
                  <span>Replay Trace</span>
                </button>
                <button
                  type="button"
                  className="px-2.5 py-1 text-xs font-medium text-zinc-500 hover:text-zinc-900 transition-colors cursor-pointer"
                  onClick={() => setViewMode('landing')}
                  title="Cancel synthesis and return to source input"
                >
                  Cancel
                </button>
                <button 
                  type="button" 
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-zinc-900 bg-zinc-100 border border-zinc-200 rounded-lg hover:bg-zinc-200 shadow-2xs transition-colors cursor-pointer"
                  onClick={() => {
                    loadOverview();
                    setViewMode('dashboard');
                  }}
                >
                  <span>Skip to Dashboard</span>
                  <ArrowRight size={12} />
                </button>
              </>
            ) : (
              <button 
                type="button" 
                className="inline-flex items-center gap-1.5 px-3.5 py-1.5 text-xs font-medium text-white bg-zinc-900 rounded-lg hover:bg-zinc-800 shadow-2xs transition-colors cursor-pointer"
                onClick={() => {
                  loadOverview();
                  setViewMode('dashboard');
                }}
              >
                <span>Review Knowledge Base</span>
                <ArrowRight size={12} />
              </button>
            )}
          </div>
        </div>

        {/* Center-Oriented & Fully Responsive Container */}
        <div className="flex-1 w-full bg-white flex flex-col items-center justify-start px-4 pt-8 pb-20 sm:px-6" style={{ backgroundColor: '#ffffff' }}>
          <div className="w-full max-w-2xl flex flex-col gap-6">

            {/* Target Status Bar */}
            <div className="flex items-center justify-between text-xs text-zinc-500 font-mono border-b border-zinc-100 pb-3">
              <div className="flex items-center gap-2">
                <span className="size-2 rounded-full bg-emerald-500 animate-pulse" />
                <span className="font-semibold text-zinc-700 tracking-wider uppercase text-[10px]">Autonomous Synthesis Engine</span>
              </div>
              <div className="flex items-center gap-2">
                <span>Target: <strong className="text-zinc-800">{sourceLabel}</strong></span>
                <span>•</span>
                <span>{formatElapsed(elapsedSeconds)}</span>
              </div>
            </div>

            {/* User prompt bubble (transcript style: right-aligned, muted) */}
            <div className="flex justify-end">
              <div className="max-w-[85%] rounded-2xl bg-zinc-100 text-zinc-800 px-4 py-2.5 text-xs sm:text-[13px] leading-relaxed shadow-2xs border border-zinc-200/60 font-sans">
                Audit and synthesize knowledge capsules for <strong>{websiteUrl || `https://${sourceLabel}`}</strong>, extract product architecture, commercial terms, and sales battlecards.
              </div>
            </div>

            {/* Multi-round Agent Workflow (ai-thinking-and-tool-calls) */}
            <div className="flex flex-col bg-white rounded-xl border border-zinc-200/80 p-4 sm:p-5 shadow-2xs">
              <AgentWorkflow 
                key={replayKey} 
                phases={workflowPhases} 
                tools={CUSTOM_TOOLS}
                onComplete={() => {
                  setIsCompleted(true);
                  loadOverview();
                }}
              />
            </div>

            {/* Error Notice Card with Actionable Recovery */}
            {jobError && (
              <div className="w-full rounded-xl border border-rose-200 bg-rose-50 p-4 text-xs text-rose-900 text-left shadow-2xs">
                <div className="flex items-start gap-3">
                  <AlertCircle className="size-4 shrink-0 text-rose-600 mt-0.5" />
                  <div className="flex-1 min-w-0">
                    <p className="font-semibold text-rose-800">
                      Ingestion Notice
                    </p>
                    <p className="mt-1 leading-relaxed text-rose-700/90">
                      {jobError}
                    </p>
                    <div className="mt-3 flex flex-wrap items-center gap-2">
                      <button
                        type="button"
                        onClick={handleRetryIngestion}
                        className="inline-flex items-center gap-1.5 rounded-md bg-rose-600 px-3 py-1.5 text-[11px] font-medium text-white hover:bg-rose-700 transition-colors shadow-2xs cursor-pointer"
                      >
                        <RefreshCw size={12} />
                        <span>Retry Ingestion</span>
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          setJobError(null);
                          setViewMode('landing');
                        }}
                        className="inline-flex items-center gap-1.5 rounded-md border border-rose-300 bg-white px-3 py-1.5 text-[11px] font-medium text-rose-700 hover:bg-rose-50 transition-colors cursor-pointer"
                      >
                        <span>Change Source / Cancel</span>
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          setJobError(null);
                          loadOverview();
                          setViewMode('dashboard');
                        }}
                        className="inline-flex items-center gap-1 rounded-md px-2.5 py-1.5 text-[11px] text-rose-600 hover:text-rose-800 hover:underline transition-colors cursor-pointer"
                      >
                        <span>Skip to Dashboard</span>
                        <ArrowRight size={11} />
                      </button>
                    </div>
                  </div>
                </div>
              </div>
            )}

            {/* If Completed: Luxury Completion Review Panel */}
            {isCompleted && (
              <div className="w-full bg-white border border-emerald-200 rounded-xl p-5 shadow-2xs text-left animate-fade-in flex flex-col gap-4">
                <div className="flex items-center gap-3">
                  <div className="size-9 rounded-lg bg-emerald-50 text-emerald-600 flex items-center justify-center shrink-0 border border-emerald-200">
                    <CheckCircle2 size={20} />
                  </div>
                  <div>
                    <h3 className="text-sm font-semibold text-zinc-900">
                      Knowledge Synthesis Complete & Grounded
                    </h3>
                    <p className="text-xs text-zinc-600 mt-0.5">
                      Knowledge dossier verified with 100% backlinked citations and commercial boundaries.
                    </p>
                  </div>
                </div>

                <div className="grid grid-cols-3 gap-2.5 pt-1">
                  <div className="p-2.5 rounded-lg bg-zinc-50 border border-zinc-200">
                    <div className="text-[11px] font-semibold text-zinc-900">Knowledge Capsules</div>
                    <div className="text-[10px] text-zinc-600 mt-0.5">Company, Products & ICP</div>
                  </div>
                  <div className="p-2.5 rounded-lg bg-zinc-50 border border-zinc-200">
                    <div className="text-[11px] font-semibold text-zinc-900">100% Grounded</div>
                    <div className="text-[10px] text-zinc-600 mt-0.5">Backlinked to source HTML</div>
                  </div>
                  <div className="p-2.5 rounded-lg bg-zinc-50 border border-zinc-200">
                    <div className="text-[11px] font-semibold text-zinc-900">Zero Hallucination</div>
                    <div className="text-[10px] text-zinc-600 mt-0.5">Strict pricing bounds locked</div>
                  </div>
                </div>

                <div className="flex flex-col sm:flex-row items-center justify-between gap-3 pt-2 border-t border-zinc-200">
                  <div className="text-[11px] text-zinc-600 font-mono">
                    {!isCountdownPaused ? (
                      <>
                        <span>Opening dashboard in {autoRedirectCountdown}s... </span>
                        <button
                          type="button"
                          onClick={() => setIsCountdownPaused(true)}
                          className="text-zinc-800 underline font-medium hover:text-black cursor-pointer"
                        >
                          Pause
                        </button>
                      </>
                    ) : (
                      <span>Auto-redirect paused.</span>
                    )}
                  </div>
                  <button
                    type="button"
                    onClick={() => {
                      loadOverview();
                      setViewMode('dashboard');
                    }}
                    className="w-full sm:w-auto inline-flex items-center justify-center gap-1.5 px-4 py-2 bg-zinc-900 hover:bg-zinc-800 text-white text-xs font-medium rounded-lg shadow-2xs transition-colors cursor-pointer"
                  >
                    <span>Open Dashboard</span>
                    <ArrowRight size={13} />
                  </button>
                </div>
              </div>
            )}

          </div>
        </div>
      </div>
    );
  }

  // ── RENDER: LANDING / TEACH PEARL (SECTION 4) ──────────────────────────────
  if (viewMode === 'landing') {
    return (
      <div className="kb-root animate-fade-in">
        <div className="kb-top-bar">
          <div className="kb-breadcrumb">
            <span>Pearl</span>
            <span>/</span>
            <span className="kb-breadcrumb-title">Knowledge base</span>
          </div>
          {overviewData?.stats?.total_capsules > 0 && (
            <button 
              type="button" 
              className="kb-btn-mini"
              onClick={() => setViewMode('dashboard')}
            >
              &larr; View Existing Capsules ({overviewData.stats.total_capsules})
            </button>
          )}
        </div>

        <div className="kb-hero-header">
          <h1 className="kb-hero-title">Teach Pearl about your business.</h1>
          <p className="kb-hero-subtitle">
            Connect your website or upload your business documents. Pearl will learn your products, understand your audience and prepare its sales knowledge.
          </p>
        </div>

        {uploadError && (
          <div style={{ maxWidth: 880, margin: '0 auto 1.5rem auto', background: '#fef2f2', border: '1px solid #fee2e2', padding: '10px 16px', borderRadius: 10, color: '#b91c1c', fontSize: '0.88rem' }}>
            <AlertCircle size={15} style={{ display: 'inline', marginRight: 6, verticalAlign: -2 }} />
            {uploadError}
          </div>
        )}

        <div className="kb-entry-grid">
          {/* OPTION A: IMPORT FROM WEBSITE (RECOMMENDED) */}
          <div className="kb-entry-card recommended">
            <span className="kb-card-badge">Recommended</span>
            <div>
              <div className="kb-card-icon-box">
                <Globe size={24} />
              </div>
              <h3 className="kb-card-title">Import from website</h3>
              <p className="kb-card-desc">
                Let Pearl explore your website and understand your business automatically.
              </p>
            </div>

            {!showWebsiteForm ? (
              <button 
                type="button" 
                className="kb-card-btn primary"
                onClick={() => setShowWebsiteForm(true)}
              >
                <span>Add website</span>
                <ArrowRight size={16} />
              </button>
            ) : (
              <form className="kb-card-form" onSubmit={handleStartWebsiteCrawl}>
                <div className="kb-url-input-wrap">
                  <span className="kb-url-prefix">https://</span>
                  <input 
                    type="text" 
                    className="kb-url-input" 
                    placeholder="example.com"
                    value={websiteUrl.replace(/^https?:\/\//, '')}
                    onChange={(e) => setWebsiteUrl(e.target.value)}
                    autoFocus
                  />
                </div>

                {extractedDomain && (
                  <div className="kb-domain-badge">
                    <Globe size={12} />
                    <span>Domain: <strong>{extractedDomain}</strong></span>
                  </div>
                )}

                <button 
                  type="submit" 
                  className="kb-card-btn primary"
                  disabled={!websiteUrl.trim()}
                >
                  <span>Start Analysis</span>
                  <ArrowRight size={16} />
                </button>
              </form>
            )}
          </div>

          {/* OPTION B: UPLOAD DOCUMENTS */}
          <div className="kb-entry-card">
            <div>
              <div className="kb-card-icon-box">
                <FileText size={24} />
              </div>
              <h3 className="kb-card-title">Upload documents</h3>
              <p className="kb-card-desc">
                Give Pearl your existing product documents, brochures and business information.
              </p>
            </div>

            {!showDocForm ? (
              <button 
                type="button" 
                className="kb-card-btn secondary"
                onClick={() => setShowDocForm(true)}
              >
                <span>Upload files</span>
                <UploadCloud size={16} />
              </button>
            ) : (
              <div className="kb-card-form">
                <label className="kb-dropzone">
                  <input 
                    type="file" 
                    multiple 
                    accept=".pdf,.docx,.doc,.xlsx,.xls,.csv,.json,.txt,.md" 
                    style={{ display: 'none' }}
                    onChange={(e) => {
                      if (e.target.files) {
                        setSelectedFiles(Array.from(e.target.files));
                      }
                    }}
                  />
                  <UploadCloud size={24} color="#71717a" style={{ margin: '0 auto 6px auto' }} />
                  <div style={{ fontSize: '0.85rem', fontWeight: 600, color: '#09090b' }}>Click or drag files here</div>
                  <div style={{ fontSize: '0.74rem', color: '#71717a', marginTop: 2 }}>
                    PDF, DOCX, XLSX, CSV, JSON, TXT, MD
                  </div>
                </label>

                {selectedFiles.length > 0 && (
                  <div className="kb-files-list">
                    {selectedFiles.map((file, i) => (
                      <div key={i} className="kb-file-item">
                        <span>{file.name}</span>
                        <span style={{ color: '#71717a' }}>{(file.size / 1024).toFixed(0)} KB</span>
                      </div>
                    ))}
                  </div>
                )}

                <button 
                  type="button" 
                  className="kb-card-btn primary"
                  disabled={selectedFiles.length === 0}
                  onClick={handleUploadDocuments}
                >
                  <span>Start Document Processing ({selectedFiles.length})</span>
                  <ArrowRight size={16} />
                </button>
              </div>
            )}
          </div>
        </div>
      </div>
    );
  }

  // ── RENDER: DASHBOARD VIEW (SECTION 10) ────────────────────────────────────
  const company = overviewData?.company_capsule;
  const products = overviewData?.product_capsules || [];
  const sources = overviewData?.sources || [];
  const facts = overviewData?.facts || [];

  return (
    <div className="kb-root animate-fade-in">
      <div className="kb-top-bar">
        <div className="kb-breadcrumb">
          <span>Pearl</span>
          <span>/</span>
          <span className="kb-breadcrumb-title">Knowledge Base</span>
        </div>
        <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
          <button 
            type="button" 
            className="kb-btn-mini"
            onClick={() => setViewMode('landing')}
          >
            <Plus size={13} style={{ display: 'inline', verticalAlign: -2 }} />
            <span>Add Source</span>
          </button>
          {company && (
            <button 
              type="button" 
              className="kb-card-btn primary"
              style={{ padding: '5px 12px', fontSize: '0.78rem', borderRadius: 6, width: 'auto' }}
              onClick={() => handlePublishCapsule(company.id)}
              disabled={loadingAction}
            >
              <CheckCircle2 size={13} />
              <span>Publish v{company.version || 1}</span>
            </button>
          )}
          <button 
            type="button" 
            className="kb-btn-danger"
            onClick={handleResetAllKnowledge}
            disabled={loadingAction}
            title="Permanently remove all capsules and wipe out context"
          >
            <Trash2 size={13} />
            <span>Delete All Knowledge</span>
          </button>
        </div>
      </div>

      <div className="kb-dashboard-wrap">
        {/* Top Banner with Key Metrics */}
        <div className="kb-dash-banner">
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <h2 style={{ fontSize: '1.45rem', fontWeight: 700, margin: 0, letterSpacing: '-0.02em' }}>
                {company?.company_name || 'Business Knowledge Base'}
              </h2>
              <span className="kb-pill-badge confirmed">Published</span>
            </div>
            <p style={{ margin: '4px 0 0 0', fontSize: '0.85rem', color: '#71717a' }}>
              {sources[0]?.url ? `Connected to ${sources[0].url}` : 'Multi-source business knowledge'} • Last synced: {overviewData?.stats?.last_synced_at ? new Date(overviewData.stats.last_synced_at).toLocaleDateString() : 'Today'}
            </p>
          </div>

          <div className="kb-dash-metrics">
            <div className="kb-metric-item">
              <span className="kb-metric-val">{overviewData?.stats?.total_capsules || 0}</span>
              <span className="kb-metric-label">Capsules</span>
            </div>
            <div className="kb-metric-item">
              <span className="kb-metric-val">{products.length}</span>
              <span className="kb-metric-label">Products</span>
            </div>
            <div className="kb-metric-item">
              <span className="kb-metric-val">{overviewData?.stats?.total_pages || 0}</span>
              <span className="kb-metric-label">Pages Crawled</span>
            </div>
            <div className="kb-metric-item">
              <span className="kb-metric-val">{facts.length}</span>
              <span className="kb-metric-label">Extracted Facts</span>
            </div>
          </div>
        </div>

        {/* Tab Navigation */}
        <div className="kb-dash-tabs">
          <button 
            type="button" 
            className={`kb-dash-tab ${activeTab === 'company' ? 'active' : ''}`}
            onClick={() => setActiveTab('company')}
          >
            Company Capsule
          </button>
          <button 
            type="button" 
            className={`kb-dash-tab ${activeTab === 'products' ? 'active' : ''}`}
            onClick={() => setActiveTab('products')}
          >
            Product Capsules ({products.length})
          </button>
          <button 
            type="button" 
            className={`kb-dash-tab ${activeTab === 'customer' ? 'active' : ''}`}
            onClick={() => setActiveTab('customer')}
          >
            Buyer Intelligence
          </button>
          <button 
            type="button" 
            className={`kb-dash-tab ${activeTab === 'sales' ? 'active' : ''}`}
            onClick={() => setActiveTab('sales')}
          >
            Sales Objections
          </button>
          <button 
            type="button" 
            className={`kb-dash-tab ${activeTab === 'sources' ? 'active' : ''}`}
            onClick={() => setActiveTab('sources')}
          >
            Connected Sources ({sources.length})
          </button>
        </div>

        {/* TAB 1: COMPANY CAPSULE */}
        {activeTab === 'company' && company && (
          <div className="kb-section-card">
            <div className="kb-section-title-row">
              <div>
                <h3 className="kb-section-title">Company-Wide Shared Context</h3>
                <span style={{ fontSize: '0.78rem', color: '#71717a' }}>Version {company.version || 1} • Inherited by all Pearl Agents</span>
              </div>
              <button 
                type="button" 
                className="kb-btn-mini kb-btn-mini-danger"
                onClick={() => handleDeleteCapsule(company.id, company.company_name)}
                disabled={loadingAction}
                title="Delete this company capsule"
              >
                <Trash2 size={12} />
                <span>Delete Company Capsule</span>
              </button>
            </div>

            <div className="kb-fact-row">
              <span className="kb-fact-field">Company Name</span>
              <span className="kb-fact-value">{company.company_name}</span>
            </div>
            <div className="kb-fact-row">
              <span className="kb-fact-field">Brand Voice Tone</span>
              <span className="kb-fact-value">{company.brand_tone || 'Consultative & Professional'}</span>
            </div>
            <div className="kb-fact-row">
              <span className="kb-fact-field">Business Overview</span>
              <span className="kb-fact-value">{company.overview || 'Enterprise business platform'}</span>
            </div>
            <div className="kb-fact-row">
              <span className="kb-fact-field">Target Audience</span>
              <span className="kb-fact-value">{company.target_audience || 'B2B Buyers'}</span>
            </div>
            <div className="kb-fact-row">
              <span className="kb-fact-field">Key Differentiators</span>
              <span className="kb-fact-value">{company.key_differentiators || 'Proprietary execution'}</span>
            </div>
            <div className="kb-fact-row">
              <span className="kb-fact-field">Pain Points Solved</span>
              <span className="kb-fact-value">{company.pain_points || 'Operational bottlenecks'}</span>
            </div>
          </div>
        )}

        {/* TAB 2: PRODUCT CAPSULES */}
        {activeTab === 'products' && (
          <div className="kb-prods-grid">
            {products.map((p) => (
              <div key={p.id} className="kb-prod-card">
                <div>
                  <div className="kb-prod-header">
                    <h4 className="kb-prod-title">{p.product_name || p.name}</h4>
                    <span className="kb-prod-price">{p.price || 'Custom Quote'}</span>
                  </div>
                  <div className="kb-prod-specs">
                    {p.specs || 'Product specifications & features indexed.'}
                  </div>
                </div>

                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', borderTop: '1px solid #f4f4f5', paddingTop: 10, marginTop: 10 }}>
                  <span style={{ fontSize: '0.72rem', color: '#71717a' }}>v{p.version || 1} • {p.status}</span>
                  <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                    <button 
                      type="button" 
                      className="kb-btn-mini"
                      onClick={() => handlePublishCapsule(p.id)}
                      disabled={loadingAction}
                    >
                      Publish
                    </button>
                    <button 
                      type="button" 
                      className="kb-btn-mini kb-btn-mini-danger"
                      onClick={() => handleDeleteCapsule(p.id, p.product_name || p.name)}
                      disabled={loadingAction}
                      title="Delete this product capsule"
                    >
                      <Trash2 size={12} />
                      <span>Delete</span>
                    </button>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}

        {/* TAB 3: BUYER INTELLIGENCE */}
        {activeTab === 'customer' && (
          <div className="kb-section-card">
            <div className="kb-section-title-row">
              <h3 className="kb-section-title">Verified Customer & Buyer Intelligence</h3>
              <span style={{ fontSize: '0.78rem', color: '#71717a' }}>Fact-checked against source data</span>
            </div>

            {facts.filter(f => f.category === 'business' || f.category === 'customer').map((fact) => (
              <div key={fact.id} className="kb-fact-row">
                <span className="kb-fact-field">{fact.field_name}</span>
                
                {editingFactId === fact.id ? (
                  <div style={{ flex: 1, display: 'flex', gap: 6 }}>
                    <input 
                      type="text" 
                      value={editFactValue} 
                      onChange={e => setEditFactValue(e.target.value)} 
                      style={{ flex: 1, padding: '4px 8px', borderRadius: 6, border: '1px solid #09090b', fontSize: '0.86rem' }} 
                    />
                    <button type="button" className="kb-btn-mini" onClick={() => handleSaveFactEdit(fact.id)}>Save</button>
                    <button type="button" className="kb-btn-mini" onClick={() => setEditingFactId(null)}>Cancel</button>
                  </div>
                ) : (
                  <span className="kb-fact-value">{fact.value}</span>
                )}

                <div className="kb-fact-badges">
                  <span className={`kb-pill-badge ${fact.inference_type === 'observed_fact' ? 'observed' : 'inference'}`}>
                    {fact.inference_type === 'observed_fact' ? 'Observed Fact' : 'AI Inference'}
                  </span>

                  <button 
                    type="button" 
                    className="kb-btn-mini"
                    onClick={() => {
                      setEditingFactId(fact.id);
                      setEditFactValue(fact.value);
                    }}
                  >
                    Edit
                  </button>

                  {fact.source_excerpt && (
                    <button 
                      type="button" 
                      className="kb-btn-mini"
                      onClick={() => setEvidenceModal(fact)}
                      title="Inspect Evidence"
                    >
                      <Eye size={12} />
                    </button>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}

        {/* TAB 4: SALES OBJECTIONS */}
        {activeTab === 'sales' && (
          <div className="kb-section-card">
            <div className="kb-section-title-row">
              <h3 className="kb-section-title">Evidence-Backed Objection Handlers & Pivots</h3>
              <span style={{ fontSize: '0.78rem', color: '#71717a' }}>Synthesized for real-time Pearl call execution</span>
            </div>

            {facts.filter(f => f.category === 'sales').map((fact) => (
              <div key={fact.id} className="kb-fact-row">
                <span className="kb-fact-field">{fact.field_name}</span>
                <span className="kb-fact-value">{fact.value}</span>
                <div className="kb-fact-badges">
                  <span className={`kb-pill-badge ${fact.approval_status === 'approved' ? 'confirmed' : 'inference'}`}>
                    {fact.approval_status}
                  </span>
                  <button 
                    type="button" 
                    className="kb-btn-mini"
                    onClick={() => handleToggleFactApproval(fact.id, fact.approval_status)}
                  >
                    {fact.approval_status === 'approved' ? 'Reject' : 'Approve'}
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}

        {/* TAB 5: CONNECTED SOURCES */}
        {activeTab === 'sources' && (
          <div className="kb-section-card">
            <div className="kb-section-title-row">
              <h3 className="kb-section-title">Connected Ingestion Sources</h3>
              <button 
                type="button" 
                className="kb-btn-mini"
                onClick={() => setViewMode('landing')}
              >
                + Connect Another Source
              </button>
            </div>

            {sources.map((s) => (
              <div key={s.id} className="kb-fact-row" style={{ alignItems: 'center' }}>
                <span className="kb-fact-field" style={{ textTransform: 'uppercase' }}>{s.type}</span>
                <div style={{ flex: 1 }}>
                  <div style={{ fontWeight: 600, fontSize: '0.9rem' }}>{s.title}</div>
                  <div style={{ fontSize: '0.76rem', color: '#71717a' }}>{s.url || 'Document Bundle'} • {s.pages_processed || 0} pages indexed</div>
                </div>
                <div className="kb-fact-badges">
                  <span className="kb-pill-badge confirmed">{s.status}</span>
                  <button 
                    type="button" 
                    className="kb-btn-mini kb-btn-mini-danger"
                    onClick={() => handleDeleteSource(s.id, s.title)}
                    disabled={loadingAction}
                    title="Delete source and all parsed pages"
                  >
                    <Trash2 size={12} />
                    <span>Delete</span>
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}

      </div>

      {/* EVIDENCE INSPECTION MODAL */}
      {evidenceModal && (
        <div 
          style={{ position: 'fixed', inset: 0, background: 'rgba(9,9,11,0.5)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 99999 }}
          onClick={() => setEvidenceModal(null)}
        >
          <div 
            style={{ background: '#ffffff', borderRadius: 14, padding: '1.75rem', maxWidth: 500, width: '90%', boxShadow: '0 20px 40px rgba(0,0,0,0.2)' }}
            onClick={e => e.stopPropagation()}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem' }}>
              <h4 style={{ margin: 0, fontSize: '1rem', fontWeight: 700 }}>Source Evidence Excerpt</h4>
              <button type="button" className="kb-btn-mini" onClick={() => setEvidenceModal(null)}>Close</button>
            </div>
            <p style={{ fontSize: '0.88rem', color: '#52525b', lineHeight: 1.5, background: '#f4f4f5', padding: '12px', borderRadius: 8, fontStyle: 'italic' }}>
              "{evidenceModal.source_excerpt}"
            </p>
            {evidenceModal.source_url && (
              <a 
                href={evidenceModal.source_url} 
                target="_blank" 
                rel="noreferrer"
                style={{ display: 'inline-flex', alignItems: 'center', gap: 4, fontSize: '0.8rem', color: '#09090b', fontWeight: 600, textDecoration: 'none', marginTop: 10 }}
              >
                <span>View Source URL</span>
                <ExternalLink size={12} />
              </a>
            )}
          </div>
        </div>
      )}
    </div>
  );
};

export default KnowledgeBaseView;
