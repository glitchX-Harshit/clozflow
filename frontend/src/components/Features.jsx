import { useState, useEffect, useRef } from 'react';
import { Ear, Cpu, Zap, Activity, CheckCircle2, CircleDot, RefreshCw } from 'lucide-react';
import { gsap } from 'gsap';
import { ScrollTrigger } from 'gsap/ScrollTrigger';
import './Features.css';

gsap.registerPlugin(ScrollTrigger);

const ARCHITECTURE_LAYERS = [
    {
        id: 1,
        num: '01',
        title: "Neural Listening Layer",
        desc: "Captures vocal streams via WebRTC, processing audio frames to detect phonetic stress patterns, silent pauses, and lexical hesitation markers in real-time.",
        icon: <Ear size={20} />,
        color: '#ff5e00',
        tag: 'INPUT STREAM',
        stats: { latency: '6ms', load: '12%', reliability: '99.98%' },
        tech: 'WebRTC / Web Audio API / Wav2Vec2',
        subtasks: [
            "Acoustic pitch & amplitude tracking",
            "Lexical hesitation indexing",
            "Real-time semantic sentence framing"
        ],
        flowSteps: [
            { label: "Acoustic Stream Capture", status: "completed", metric: "WebRTC @ 48kHz", desc: "Decoding stereo audio stream from live call channel." },
            { label: "Spectral Analysis", status: "active", metric: "-14dB / Pitch 180Hz", desc: "Measuring voice frequency shifts and micro-hesitation timings." },
            { label: "Phonetic Parsing", status: "pending", metric: "Pending frame input", desc: "Extracting syllables and silence intervals to map phonetic intent." }
        ]
    },
    {
        id: 2,
        num: '02',
        title: "Cognitive Processing Layer",
        desc: "Processes decoded signals against a vector database of 4.2M high-conversion sales call patterns to run psychological intent categorization and predictive mapping.",
        icon: <Cpu size={20} />,
        color: '#4f46e5',
        tag: 'ANALYSIS ENGINE',
        stats: { latency: '14ms', load: '34%', reliability: '99.99%' },
        tech: 'PyTorch / Hex-Brain v4 / Qdrant DB',
        subtasks: [
            "Intent vector space mapping",
            "Objection category clustering",
            "Historical pattern probability index"
        ],
        flowSteps: [
            { label: "Vector Embedding", status: "completed", metric: "Dim: 1536", desc: "Projecting phonemes and words into multi-dimensional intent space." },
            { label: "Historical Match Lookup", status: "completed", metric: "4.2M call maps", desc: "Querying vector DB for similar sales negotiation transcripts." },
            { label: "Probability Indexing", status: "active", metric: "Confidence: 94.6%", desc: "Estimating likelihood of buyer objections and resistance drivers." }
        ]
    },
    {
        id: 3,
        num: '03',
        title: "Strategic Protocol Layer",
        desc: "Dynamically synthesizes personalized response directives, balancing tactical reframing strategies, trust-rebuilding protocols, and objection resolution frameworks.",
        icon: <Zap size={20} />,
        color: '#0ea5e9',
        tag: 'DECISION PROTOCOL',
        stats: { latency: '19ms', load: '18%', reliability: '99.97%' },
        tech: 'Contextual Reframe Agent / vLLM Inference',
        subtasks: [
            "Tactical reframe generation",
            "Tone alignment synthesis",
            "Compliance & objection verify checks"
        ],
        flowSteps: [
            { label: "Context Reframing", status: "completed", metric: "Agent: Reframe-v4", desc: "Synthesizing customized sales rebuttals based on objection type." },
            { label: "Tone Optimization", status: "active", metric: "Target: Empathetic", desc: "Adjusting verbal confidence, pitch modulation, and syllable length." },
            { label: "Verification Check", status: "pending", metric: "Safety Check: Ready", desc: "Running final validation checks against brand compliance models." }
        ]
    }
];

const Features = () => {
    const [activeLayer, setActiveLayer] = useState(0);
    const sectionRef = useRef(null);
    const rightPanelRef = useRef(null);

    useEffect(() => {
        let ctx = gsap.context(() => {
            // Header animation
            gsap.fromTo('.arch__header-animate', 
                { y: 30, opacity: 0 },
                {
                    y: 0,
                    opacity: 1,
                    duration: 1,
                    stagger: 0.1,
                    ease: 'power2.out',
                    scrollTrigger: {
                        trigger: '.arch__header',
                        start: 'top 85%',
                    }
                }
            );

            // Intro 3D visual stack trigger on scroll
            gsap.fromTo('.arch__visual-stack',
                { rotateY: -30, rotateX: 20, scale: 0.9, opacity: 0 },
                {
                    rotateY: -22,
                    rotateX: 18,
                    scale: 1,
                    opacity: 1,
                    duration: 1.5,
                    ease: 'power2.out',
                    scrollTrigger: {
                        trigger: '.arch__stack-wrap',
                        start: 'top 80%',
                    }
                }
            );
        }, sectionRef);

        return () => ctx.revert();
    }, []);

    // Animate details pane swap
    useEffect(() => {
        if (rightPanelRef.current) {
            gsap.fromTo(rightPanelRef.current.children,
                { opacity: 0, y: 10 },
                { opacity: 1, y: 0, duration: 0.35, stagger: 0.05, ease: 'power2.out' }
            );
        }
    }, [activeLayer]);

    const activeData = ARCHITECTURE_LAYERS[activeLayer];

    return (
        <section className="arch__section" id="architecture" ref={sectionRef}>
            <div className="container">
                <div className="arch__header">
                    <span className="arch__eyebrow arch__header-animate">System Architecture</span>
                    <h2 className="arch__title arch__header-animate">
                        The Three-Layer Intelligence Stack
                    </h2>
                    <p className="arch__subtitle arch__header-animate">
                        Hexagon is built on a proprietary multi-layer neural architecture 
                        designed to solve the most complex human persuasion problems.
                    </p>
                </div>

                <div className="arch__stack-wrap">
                    {/* Left: Interactive 3D Stack */}
                    <div className="arch__left-col">
                        <div className="arch__visual-stack">
                            {ARCHITECTURE_LAYERS.map((layer, index) => {
                                const isActive = activeLayer === index;
                                return (
                                    <div
                                        key={layer.id}
                                        className={`arch__3d-card ${isActive ? 'active' : ''}`}
                                        style={{ 
                                            '--layer-index': index,
                                            '--accent-color': layer.color
                                        }}
                                        onClick={() => setActiveLayer(index)}
                                        onMouseEnter={() => setActiveLayer(index)}
                                    >
                                        <div className="arch__3d-glass">
                                            <div className="arch__3d-glow" />
                                            <div className="arch__3d-header">
                                                <span className="arch__3d-num">{layer.num}</span>
                                                <span className="arch__3d-tag">{layer.tag}</span>
                                            </div>
                                            <div className="arch__3d-body">
                                                <div className="arch__3d-icon" style={{ background: `${layer.color}15`, color: layer.color }}>
                                                    {layer.icon}
                                                </div>
                                                <h4 className="arch__3d-title">{layer.title}</h4>
                                            </div>
                                            
                                            {/* Glowing Grid Effect inside the card */}
                                            <div className="arch__3d-grid" />
                                        </div>
                                        {/* Connector nodes linking cards */}
                                        {index < ARCHITECTURE_LAYERS.length - 1 && (
                                            <div className="arch__3d-connector">
                                                <div className="arch__connector-line" />
                                                <div className="arch__connector-pulse" />
                                            </div>
                                        )}
                                    </div>
                                );
                            })}
                        </div>
                    </div>

                    {/* Right: Technical Details Panel */}
                    <div className="arch__right-col" ref={rightPanelRef}>
                        <div className="arch__details-content">
                            <div className="arch__details-header">
                                <span className="arch__meta-tech">{activeData.tech}</span>
                            </div>

                            <h3 className="arch__details-title">{activeData.title}</h3>
                            <p className="arch__details-desc">{activeData.desc}</p>

                            {/* Core Specs Grid */}
                            <div className="arch__specs-grid">
                                <div className="arch__spec-item">
                                    <span className="arch__spec-label">Latency</span>
                                    <span className="arch__spec-val" style={{ color: activeData.color }}>
                                        {activeData.stats.latency}
                                    </span>
                                </div>
                                <div className="arch__spec-item">
                                    <span className="arch__spec-label">Engine Load</span>
                                    <span className="arch__spec-val">{activeData.stats.load}</span>
                                </div>
                                <div className="arch__spec-item">
                                    <span className="arch__spec-label">Reliability</span>
                                    <span className="arch__spec-val">{activeData.stats.reliability}</span>
                                </div>
                            </div>

                            {/* Sub-Services Checklist */}
                            <div className="arch__subtasks-sec">
                                <span className="arch__sec-label">Sub-Processor Services</span>
                                <ul className="arch__subtasks-list">
                                    {activeData.subtasks.map((task, i) => (
                                        <li key={i} className="arch__subtask-item">
                                            <CheckCircle2 size={13} className="arch__check-icon" style={{ color: activeData.color }} />
                                            <span>{task}</span>
                                        </li>
                                    ))}
                                </ul>
                            </div>

                            {/* Step Progress Flow */}
                            <div className="arch__flow">
                                <div className="arch__flow-header">
                                    <Activity size={13} style={{ color: activeData.color }} />
                                    <span>active_layer_pipeline</span>
                                    <span className="arch__flow-status-badge" style={{ background: `${activeData.color}15`, color: activeData.color }}>
                                        ACTIVE
                                    </span>
                                </div>
                                
                                <div className="arch__flow-steps">
                                    {activeData.flowSteps.map((step, index) => {
                                        let iconEl = <CircleDot size={14} />;
                                        if (step.status === 'completed') {
                                            iconEl = <CheckCircle2 size={14} />;
                                        } else if (step.status === 'active') {
                                            iconEl = <RefreshCw size={14} className="arch__spin-icon" />;
                                        }

                                        return (
                                            <div key={index} className={`arch__flow-step ${step.status}`}>
                                                <div className="arch__flow-step-visual">
                                                    <div 
                                                        className="arch__flow-icon-wrap"
                                                        style={{ 
                                                            color: step.status === 'active' || step.status === 'completed' ? activeData.color : 'var(--text-muted)'
                                                        }}
                                                    >
                                                        {iconEl}
                                                    </div>
                                                    {index < activeData.flowSteps.length - 1 && (
                                                        <div className="arch__flow-step-line" />
                                                    )}
                                                </div>
                                                <div className="arch__flow-step-info">
                                                    <div className="arch__flow-step-meta">
                                                        <span className="arch__flow-step-label">{step.label}</span>
                                                        <span className="arch__flow-step-metric">{step.metric}</span>
                                                    </div>
                                                    <p className="arch__flow-step-desc">{step.desc}</p>
                                                </div>
                                            </div>
                                        );
                                    })}
                                </div>
                            </div>
                        </div>
                    </div>
                </div>
            </div>
        </section>
    );
};

export default Features;
