"use client";

import React, { useState } from "react";
import {
  RiCheckLine,
  RiCloseLine,
  RiArrowRightLine,
  RiShieldCheckLine,
} from "@remixicon/react";

const clozflowPoints = [
  "Sub-400ms latency with natural human-like pacing & pause detection",
  "Effortless multilingual code-switching (Hindi, Hinglish, & English)",
  "Dynamic objection handling trained on 100,000+ high-converting calls",
  "Real-time 2-way CRM auto-sync (Salesforce, HubSpot, LeadSquared)",
  "Instant post-call WhatsApp summaries & instant payment links",
  "One-click human rep takeover whenever your closer needs to step in",
  "Zero per-seat penalties — unlimited team members & collaborators",
  "Enterprise-grade SOC 2 Type II security & 99.99% uptime SLA",
];

const othersPoints = [
  "Awkward 1.5s+ latency causing constant interruptions & robotic silences",
  "Fails completely on regional accents, Hindi slang, & fast turn-taking",
  "Rigid static scripts that derail the moment a prospect asks a curveball",
  "Clunky manual data export with frequent CRM sync delays",
  "No automated post-call follow-ups or instant checkout bridges",
  "Isolated black-box calls with zero live human intervention capability",
  "Punitive per-seat pricing models that rapidly spiral out of control",
  "Generic shared telephony infrastructure with unpredictable drop rates",
];

export default function ComparisonBlock() {
  const [hoveredCard, setHoveredCard] = useState<"clozflow" | "others" | null>(null);

  return (
    <section
      id="comparison"
      style={{
        position: "relative",
        width: "100%",
        padding: "110px 24px",
        backgroundColor: "var(--bg, #f4f6f8)",
        display: "flex",
        justifyContent: "center",
        alignItems: "center",
        boxSizing: "border-box",
        overflow: "hidden",
      }}
    >
      {/* Minimal Ambient Glow Effect */}
      <div
        aria-hidden="true"
        style={{
          position: "absolute",
          top: "10%",
          left: "50%",
          transform: "translateX(-50%)",
          width: "800px",
          height: "450px",
          background: "radial-gradient(circle, rgba(0, 0, 0, 0.03) 0%, rgba(244, 246, 248, 0) 70%)",
          pointerEvents: "none",
          zIndex: 0,
        }}
      />

      <div
        style={{
          position: "relative",
          zIndex: 1,
          width: "100%",
          maxWidth: "1060px",
          margin: "0 auto",
        }}
      >
        {/* Minimal Header Section */}
        <div style={{ textAlign: "center", marginBottom: "52px" }}>
          {/* Headline */}
          <h2
            style={{
              fontSize: "clamp(2.1rem, 4.2vw, 3rem)",
              fontWeight: 800,
              color: "#000000",
              letterSpacing: "-0.035em",
              lineHeight: 1.15,
              textTransform: "none",
              margin: "0 0 16px 0",
              textAlign: "center",
            }}
          >
            Engineered differently, on purpose.
          </h2>

          {/* Subtitle */}
          <p
            style={{
              fontSize: "15.5px",
              color: "#525252",
              fontWeight: 400,
              lineHeight: 1.6,
              maxWidth: "580px",
              margin: "0 auto",
              textAlign: "center",
            }}
          >
            Legacy telephony tools were built for call centers in 2012. ClozFlow was built from the ground up to close deals autonomously in 2026.
          </p>
        </div>

        {/* 2-Column Minimal Cards Grid */}
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fit, minmax(330px, 1fr))",
            gap: "28px",
            alignItems: "stretch",
          }}
        >
          {/* ── CARD 1: ClozFlow (Minimal Primary Elevated) ── */}
          <div
            onMouseEnter={() => setHoveredCard("clozflow")}
            onMouseLeave={() => setHoveredCard(null)}
            style={{
              position: "relative",
              backgroundColor: "#ffffff",
              borderRadius: "26px",
              padding: "36px 32px 32px 32px",
              border: "1px solid rgba(0, 0, 0, 0.1)",
              boxShadow: hoveredCard === "clozflow"
                ? "0 24px 50px -12px rgba(0, 0, 0, 0.14), 0 0 0 1px #000000"
                : "0 18px 40px -15px rgba(0, 0, 0, 0.08)",
              display: "flex",
              flexDirection: "column",
              justifyContent: "space-between",
              boxSizing: "border-box",
              transition: "box-shadow 0.3s cubic-bezier(0.16, 1, 0.3, 1), transform 0.3s cubic-bezier(0.16, 1, 0.3, 1)",
              transform: hoveredCard === "clozflow" ? "translateY(-3px)" : "translateY(0)",
            }}
          >
            {/* Top Recommended Pill Ribbon */}
            <div
              style={{
                position: "absolute",
                top: "-13px",
                right: "28px",
                backgroundColor: "#000000",
                color: "#ffffff",
                fontSize: "11px",
                fontWeight: 700,
                letterSpacing: "0.04em",
                textTransform: "uppercase",
                padding: "4px 14px",
                borderRadius: "9999px",
                boxShadow: "0 4px 12px rgba(0, 0, 0, 0.25)",
                display: "flex",
                alignItems: "center",
                gap: "5px",
              }}
            >
              <RiShieldCheckLine style={{ width: "12px", height: "12px" }} />
              <span>Recommended</span>
            </div>

            <div>
              {/* Header Title */}
              <div style={{ marginBottom: "10px" }}>
                <span
                  style={{
                    fontSize: "20px",
                    fontWeight: 700,
                    color: "#000000",
                    letterSpacing: "-0.02em",
                  }}
                >
                  ClozFlow
                </span>
              </div>

              <p
                style={{
                  fontSize: "13.5px",
                  color: "#525252",
                  margin: "0 0 24px 0",
                  lineHeight: 1.5,
                  fontWeight: 400,
                }}
              >
                Intelligent conversational voice AI designed specifically to convert, negotiate, and close.
              </p>

              {/* Minimal Divider */}
              <div
                style={{
                  height: "1px",
                  width: "100%",
                  backgroundColor: "rgba(0, 0, 0, 0.07)",
                  margin: "0 0 24px 0",
                }}
              />

              {/* Points List */}
              <ul
                style={{
                  listStyle: "none",
                  padding: 0,
                  margin: 0,
                  display: "flex",
                  flexDirection: "column",
                  gap: "15px",
                }}
              >
                {clozflowPoints.map((point, idx) => (
                  <li
                    key={idx}
                    style={{
                      display: "flex",
                      alignItems: "flex-start",
                      gap: "12px",
                    }}
                  >
                    {/* Minimal Rounded Pill Check */}
                    <span
                      style={{
                        width: "20px",
                        height: "20px",
                        minWidth: "20px",
                        minHeight: "20px",
                        borderRadius: "9999px",
                        backgroundColor: "#000000",
                        color: "#ffffff",
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "center",
                        marginTop: "1.5px",
                        boxShadow: "0 2px 6px rgba(0, 0, 0, 0.2)",
                      }}
                    >
                      <RiCheckLine style={{ width: "13px", height: "13px", strokeWidth: 2.5 }} />
                    </span>
                    <span
                      style={{
                        fontSize: "13.5px",
                        color: "#000000",
                        lineHeight: 1.5,
                        fontWeight: 500,
                      }}
                    >
                      {point}
                    </span>
                  </li>
                ))}
              </ul>
            </div>

            {/* Bottom Curved Button */}
            <div
              style={{
                marginTop: "32px",
                paddingTop: "22px",
                borderTop: "1px solid rgba(0, 0, 0, 0.07)",
              }}
            >
              <a
                href="/dashboard"
                style={{
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  gap: "10px",
                  width: "100%",
                  height: "50px",
                  backgroundColor: "#000000",
                  color: "#ffffff",
                  fontSize: "14.5px",
                  fontWeight: 600,
                  borderRadius: "9999px", // Ultra-minimal curved pill button
                  textDecoration: "none",
                  boxShadow: "0 4px 16px rgba(0, 0, 0, 0.2)",
                  transition: "all 0.25s ease",
                  boxSizing: "border-box",
                  letterSpacing: "-0.01em",
                }}
                onMouseEnter={(e) => {
                  e.currentTarget.style.backgroundColor = "#171717";
                  e.currentTarget.style.transform = "translateY(-1px)";
                  e.currentTarget.style.boxShadow = "0 8px 24px rgba(0, 0, 0, 0.28)";
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.backgroundColor = "#000000";
                  e.currentTarget.style.transform = "translateY(0)";
                  e.currentTarget.style.boxShadow = "0 4px 16px rgba(0, 0, 0, 0.2)";
                }}
              >
                <span>Deploy AI Closer Free</span>
                <RiArrowRightLine style={{ width: "16px", height: "16px" }} />
              </a>
            </div>
          </div>

          {/* ── CARD 2: The Others (Minimal Muted Secondary) ── */}
          <div
            onMouseEnter={() => setHoveredCard("others")}
            onMouseLeave={() => setHoveredCard(null)}
            style={{
              position: "relative",
              backgroundColor: "rgba(255, 255, 255, 0.65)",
              backdropFilter: "blur(8px)",
              WebkitBackdropFilter: "blur(8px)",
              borderRadius: "26px",
              padding: "36px 32px 32px 32px",
              border: "1px solid rgba(0, 0, 0, 0.07)",
              boxShadow: hoveredCard === "others"
                ? "0 18px 36px -12px rgba(0, 0, 0, 0.08)"
                : "0 4px 20px -8px rgba(0, 0, 0, 0.03)",
              display: "flex",
              flexDirection: "column",
              justifyContent: "space-between",
              boxSizing: "border-box",
              transition: "box-shadow 0.3s cubic-bezier(0.16, 1, 0.3, 1), transform 0.3s cubic-bezier(0.16, 1, 0.3, 1)",
              transform: hoveredCard === "others" ? "translateY(-2px)" : "translateY(0)",
            }}
          >
            <div>
              {/* Header Title */}
              <div style={{ marginBottom: "10px" }}>
                <span
                  style={{
                    fontSize: "20px",
                    fontWeight: 600,
                    color: "#525252",
                    letterSpacing: "-0.02em",
                  }}
                >
                  Legacy & Generic Bots
                </span>
              </div>

              <p
                style={{
                  fontSize: "13.5px",
                  color: "#737373",
                  margin: "0 0 24px 0",
                  lineHeight: 1.5,
                  fontWeight: 400,
                }}
              >
                Traditional IVR bots, generic voice tools, and offshore telecalling boiler rooms.
              </p>

              {/* Minimal Divider */}
              <div
                style={{
                  height: "1px",
                  width: "100%",
                  backgroundColor: "rgba(0, 0, 0, 0.07)",
                  margin: "0 0 24px 0",
                }}
              />

              {/* Points List */}
              <ul
                style={{
                  listStyle: "none",
                  padding: 0,
                  margin: 0,
                  display: "flex",
                  flexDirection: "column",
                  gap: "15px",
                }}
              >
                {othersPoints.map((point, idx) => (
                  <li
                    key={idx}
                    style={{
                      display: "flex",
                      alignItems: "flex-start",
                      gap: "12px",
                    }}
                  >
                    {/* Minimal Rounded Pill Cross */}
                    <span
                      style={{
                        width: "20px",
                        height: "20px",
                        minWidth: "20px",
                        minHeight: "20px",
                        borderRadius: "9999px",
                        backgroundColor: "rgba(0, 0, 0, 0.05)",
                        color: "#737373",
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "center",
                        marginTop: "1.5px",
                      }}
                    >
                      <RiCloseLine style={{ width: "13px", height: "13px" }} />
                    </span>
                    <span
                      style={{
                        fontSize: "13.5px",
                        color: "#525252",
                        lineHeight: 1.5,
                        fontWeight: 400,
                      }}
                    >
                      {point}
                    </span>
                  </li>
                ))}
              </ul>
            </div>

            {/* Bottom Curved Button */}
            <div
              style={{
                marginTop: "32px",
                paddingTop: "22px",
                borderTop: "1px solid rgba(0, 0, 0, 0.07)",
              }}
            >
              <a
                href="#how-it-works"
                style={{
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  gap: "10px",
                  width: "100%",
                  height: "50px",
                  backgroundColor: "#ffffff",
                  border: "1px solid rgba(0, 0, 0, 0.12)",
                  color: "#171717",
                  fontSize: "14.5px",
                  fontWeight: 600,
                  borderRadius: "9999px", // Ultra-minimal curved pill button
                  textDecoration: "none",
                  boxShadow: "0 2px 6px rgba(0, 0, 0, 0.03)",
                  transition: "all 0.25s ease",
                  boxSizing: "border-box",
                  letterSpacing: "-0.01em",
                }}
                onMouseEnter={(e) => {
                  e.currentTarget.style.backgroundColor = "#f5f5f5";
                  e.currentTarget.style.borderColor = "rgba(0, 0, 0, 0.25)";
                  e.currentTarget.style.transform = "translateY(-1px)";
                  e.currentTarget.style.boxShadow = "0 6px 16px rgba(0, 0, 0, 0.06)";
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.backgroundColor = "#ffffff";
                  e.currentTarget.style.borderColor = "rgba(0, 0, 0, 0.12)";
                  e.currentTarget.style.transform = "translateY(0)";
                  e.currentTarget.style.boxShadow = "0 2px 6px rgba(0, 0, 0, 0.03)";
                }}
              >
                <span>See Why Sales Teams Switch</span>
                <RiArrowRightLine style={{ width: "16px", height: "16px" }} />
              </a>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
