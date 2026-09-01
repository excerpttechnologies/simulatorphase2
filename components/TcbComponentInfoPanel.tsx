"use client"

import React from "react"
import { TcbStepData, getTempColor } from "../lib/data/tcbSteps"

interface TcbComponentInfoPanelProps {
  step: TcbStepData | null
  onClose: () => void
}

const TcbComponentInfoPanel: React.FC<TcbComponentInfoPanelProps> = ({
  step,
  onClose,
}) => {
  if (!step) return null

  const info = step.componentInfo
  const tempColor = getTempColor(step.temp)

  return (
    <div style={panelStyle}>
      {/* ── Header ── */}
      <div style={headerStyle}>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <span style={{ color: "#7C8A9A", fontSize: "11px", fontWeight: 700, letterSpacing: "0.08em" }}>
            COMPONENT INFO
          </span>
          <span style={{
            display: "inline-flex", alignItems: "center", gap: 4,
            color: "#3ECF6A", fontSize: "9px", fontWeight: 700,
            padding: "2px 7px", background: "rgba(62,207,106,0.12)",
            borderRadius: "8px", border: "1px solid rgba(62,207,106,0.25)",
          }}>
            <span style={{
              width: 6, height: 6, borderRadius: "50%", background: "#3ECF6A",
              boxShadow: "0 0 4px rgba(62,207,106,0.6)",
            }} />
            LIVE
          </span>
        </div>
        <button
          onClick={onClose}
          style={{
            width: 20, height: 20, borderRadius: 4,
            border: "1px solid #233041", background: "transparent",
            color: "#7C8A9A", fontSize: 11, cursor: "pointer",
            display: "flex", alignItems: "center", justifyContent: "center",
            transition: "all 0.12s", lineHeight: 1,
          }}
          onMouseEnter={(e) => { e.currentTarget.style.background = "rgba(255,75,75,0.15)"; e.currentTarget.style.color = "#FF4B4B" }}
          onMouseLeave={(e) => { e.currentTarget.style.background = "transparent"; e.currentTarget.style.color = "#7C8A9A" }}
        >
          ✕
        </button>
      </div>

      {/* ── Step label ── */}
      <div style={titleSectionStyle}>
        <div style={{ color: "#37E7E0", fontSize: "10px", letterSpacing: "1px", marginBottom: 2, fontWeight: 600 }}>
          STEP {String(step.id).padStart(2, "0")}
        </div>
        <div style={{ color: "#fff", fontSize: "15px", fontWeight: 700 }}>
          {step.title}
        </div>
        <div style={{ color: "#37E7E0", fontSize: "10px", fontWeight: 600, letterSpacing: "0.5px", marginTop: 2 }}>
          {info.section}
        </div>
      </div>

      {/* ── Scrollable content ── */}
      <div style={contentStyle}>
        {/* HARDWARE */}
        <div style={{ marginBottom: 10 }}>
          <div style={{ color: "#E8A33D", fontSize: "9px", fontWeight: 700, letterSpacing: "0.1em", marginBottom: 3, textTransform: "uppercase" }}>
            HARDWARE
          </div>
          <div style={{
            padding: "6px 8px", background: "rgba(0,20,40,0.35)",
            borderLeft: "2px solid #1E2D3D", borderRadius: "3px",
            color: "#D8E1EA", fontSize: "11px", lineHeight: "1.4",
          }}>
            {info.hardware}
          </div>
        </div>

        {/* PROCESS */}
        <div style={{ marginBottom: 10 }}>
          <div style={{ color: "#37E7E0", fontSize: "9px", fontWeight: 700, letterSpacing: "0.1em", marginBottom: 3, textTransform: "uppercase" }}>
            PROCESS
          </div>
          <div style={{
            padding: "6px 8px", background: "rgba(0,20,40,0.35)",
            borderLeft: "2px solid #1E2D3D", borderRadius: "3px",
            color: "#D8E1EA", fontSize: "11px", lineHeight: "1.4",
          }}>
            {info.process}
          </div>
        </div>

        {/* SPECS */}
        <div style={{ marginBottom: 10 }}>
          <div style={{ color: "#4FA8FF", fontSize: "9px", fontWeight: 700, letterSpacing: "0.1em", marginBottom: 5, textTransform: "uppercase" }}>
            SPECS
          </div>
          <div>
            {info.specs.map((spec, i) => (
              <div
                key={i}
                style={{
                  display: "flex",
                  justifyContent: "space-between",
                  alignItems: "center",
                  height: "24px",
                  padding: "0 2px",
                  borderTop: i > 0 ? "1px solid #1A2433" : "none",
                }}
              >
                <span style={{ color: "#7C8A9A", fontSize: "10px", fontWeight: 500 }}>{spec.label}</span>
                <span style={{ fontFamily: "'Consolas', monospace", color: "#D8E1EA", fontSize: "10px", fontWeight: 700 }}>{spec.value}</span>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* ── Footer (sticky bottom) ── */}
      <div style={footerStyle}>
        <span style={{ color: "#3ECF6A", fontSize: "10px", fontWeight: 700, letterSpacing: "0.5px" }}>
          ✓ ACTIVELY MONITORING
        </span>
      </div>
    </div>
  )
}

export default TcbComponentInfoPanel

const panelStyle: React.CSSProperties = {
  position: "fixed",
  top: 56,
  right: 12,
  width: "260px",
  height: "400px",
  background: "#0D1117",
  borderLeft: "1px solid #1E2D3D",
  display: "flex",
  flexDirection: "column",
  overflow: "hidden",
  zIndex: 15,
}

const headerStyle: React.CSSProperties = {
  display: "flex",
  justifyContent: "space-between",
  alignItems: "center",
  padding: "8px 10px",
  borderBottom: "1px solid #1E2D3D",
  flexShrink: 0,
}

const titleSectionStyle: React.CSSProperties = {
  padding: "8px 10px",
  borderBottom: "1px solid #1E2D3D",
  flexShrink: 0,
}

const contentStyle: React.CSSProperties = {
  padding: "10px",
  overflowY: "auto",
  flex: 1,
  scrollbarWidth: "thin",
  scrollbarColor: "#233041 #0D1117",
}

const footerStyle: React.CSSProperties = {
  padding: "7px 10px",
  borderTop: "1px solid #1E2D3D",
  textAlign: "center",
  background: "rgba(10, 21, 37, 0.6)",
  flexShrink: 0,
  position: "sticky",
  bottom: 0,
}
