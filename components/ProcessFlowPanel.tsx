"use client"

import React, { useRef, useEffect } from "react"
import { TCB_STEPS, TCB_PHASES, getTempColor } from "../lib/data/tcbSteps"

interface ProcessFlowPanelProps {
  currentStep: number
  onStepClick: (index: number) => void
}

const ProcessFlowPanel: React.FC<ProcessFlowPanelProps> = ({
  currentStep,
  onStepClick,
}) => {
  const activeRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (activeRef.current) {
      activeRef.current.scrollIntoView({ block: "nearest", behavior: "smooth" })
    }
  }, [currentStep])

  return (
    <>
      <style>{scrollbarCSS}</style>
      <div className="process-flow-panel" style={panelStyle}>
        {/* ── Header ── */}
        <div className="panel-header" style={headerStyle}>
          <span className="panel-header-title">PROCESS FLOW</span>
          <span className="panel-scroll-label">↕ SCROLL</span>
        </div>

        {/* ── Chip Placement Counter (when in chip placement phase) ── */}
        {currentStep >= 7 && currentStep <= 15 && (
          <div style={{
            padding: "8px 12px",
            background: "rgba(232, 163, 61, 0.1)",
            borderBottom: "1px solid #1E2D3D",
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
          }}>
            <span style={{
              fontSize: "10px",
              color: "#E8A33D",
              fontWeight: 600,
              letterSpacing: "0.5px",
            }}>
              CHIP PLACEMENT
            </span>
            <span style={{
              fontSize: "11px",
              color: "#3ECF6A",
              fontWeight: 700,
              fontFamily: "'Consolas', monospace",
            }}>
              {Math.min(currentStep - 6, 6)} / 6
            </span>
          </div>
        )}

        {/* ── Step list ── */}
        <div style={scrollContainerStyle}>
          {TCB_PHASES && TCB_PHASES.length > 0 ? TCB_PHASES.map((phase) => (
            <div key={phase.index}>
              <div className="phase-label" style={phaseLabelStyle}>
                {phase.label}
              </div>

              {phase.steps && phase.steps.length > 0 ? phase.steps.map((stepId) => {
                const step = TCB_STEPS.find((s) => s.id === stepId)
                if (!step) return null

                const idx = step.id - 1
                const isActive = idx === currentStep
                const isNext = idx === currentStep + 1
                const isPast = idx < currentStep

                // Calculate chip number for chip placement steps (8-15)
                const chipNumber = idx >= 7 && idx <= 14 ? idx - 6 : null
                const isChipComplete = chipNumber !== null && chipNumber < Math.min(currentStep - 6, 6)

                return (
                  <div
                    key={step.id}
                    ref={isActive ? activeRef : undefined}
                    onClick={() => onStepClick(idx)}
                    className={`step-row${isActive ? " active" : ""}`}
                    style={{
                      display: "flex",
                      alignItems: "flex-start",
                      gap: "5px",
                      padding: "4px 8px",
                      minHeight: "30px",
                      cursor: "pointer",
                      borderLeft: isActive
                        ? "2px solid #3ECF6A"
                        : isNext
                          ? "2px solid #E8A33D"
                          : "2px solid transparent",
                      background: isActive
                        ? "rgba(62, 207, 106, 0.08)"
                        : isNext
                          ? "rgba(232, 163, 61, 0.06)"
                          : "transparent",
                      transition: "background 0.15s",
                    }}
                    onMouseEnter={(e) => {
                      if (!isActive) e.currentTarget.style.background = "rgba(55, 231, 224, 0.05)"
                    }}
                    onMouseLeave={(e) => {
                      if (!isActive) {
                        e.currentTarget.style.background = isNext
                          ? "rgba(232, 163, 61, 0.06)" : "transparent"
                      }
                    }}
                  >
                    <span className="step-number" style={{
                      fontFamily: "'Consolas', monospace",
                      fontSize: "10px",
                      color: isActive ? "#3ECF6A" : isNext ? "#E8A33D" : isPast ? "#3ECF6A" : "#7C8A9A",
                      minWidth: "16px",
                      flexShrink: 0,
                      marginTop: "1px",
                      fontWeight: 700,
                    }}>
                      {String(step.id).padStart(2, "0")}
                    </span>

                    <span className="step-name" style={{
                      flex: 1,
                      fontSize: "11px",
                      whiteSpace: "normal",
                      overflow: "visible",
                      textOverflow: "unset",
                      lineHeight: 1.3,
                      color: isActive ? "#3ECF6A" : isPast ? "#9AABB8" : "#7C8A9A",
                      fontWeight: isActive ? 600 : 500,
                    }}>
                      {step.title}
                      {chipNumber !== null && (
                        <span style={{
                          marginLeft: "4px",
                          fontSize: "9px",
                          color: isChipComplete ? "#3ECF6A" : "#E8A33D",
                          fontWeight: 600,
                        }}>
                          (Chip {chipNumber})
                        </span>
                      )}
                    </span>

                    <span className="temp-badge" style={{
                      fontFamily: "'Consolas', monospace",
                      fontSize: "9px",
                      fontWeight: 600,
                      minWidth: "34px",
                      maxWidth: "34px",
                      height: "16px",
                      lineHeight: "16px",
                      textAlign: "center",
                      padding: "0 3px",
                      borderRadius: "3px",
                      border: "1px solid",
                      borderColor: `${getTempColor(step.temp)}33`,
                      background: `${getTempColor(step.temp)}11`,
                      color: getTempColor(step.temp),
                      whiteSpace: "nowrap",
                      flexShrink: 0,
                      marginLeft: "4px",
                      marginTop: "1px",
                    }}>
                      {step.tempLabel}
                    </span>
                  </div>
                )
              }) : null}
            </div>
          )) : <div style={{ padding: "20px", color: "#7C8A9A", fontSize: "12px" }}>Loading process steps...</div>}
        </div>
      </div>
    </>
  )
}

export default ProcessFlowPanel

const scrollbarCSS = `
  .process-flow-panel::-webkit-scrollbar { width: 3px; }
  .process-flow-panel::-webkit-scrollbar-track { background: transparent; }
  .process-flow-panel::-webkit-scrollbar-thumb { background: #1E2D3D; border-radius: 2px; }
  .process-flow-panel::-webkit-scrollbar-thumb:hover { background: #2A3F55; }
`

const panelStyle: React.CSSProperties = {
  width: "280px",
  minWidth: "280px",
  maxWidth: "280px",
  height: "420px",
  background: "#0D1117",
  border: "1px solid #1E2D3D",
  borderRadius: "8px",
  display: "flex",
  flexDirection: "column",
  overflow: "hidden",
  boxShadow: "0 4px 20px rgba(0,0,0,0.4)",
  flexShrink: 0,
}

const headerStyle: React.CSSProperties = {
  display: "flex",
  alignItems: "center",
  justifyContent: "space-between",
  padding: "8px 8px",
  borderBottom: "1px solid #1E2D3D",
  position: "sticky",
  top: 0,
  background: "#0D1117",
  zIndex: 1,
  flexShrink: 0,
}

const scrollContainerStyle: React.CSSProperties = {
  flex: 1,
  overflowY: "auto",
  overflowX: "hidden",
  scrollbarWidth: "thin",
  scrollbarColor: "#1E2D3D transparent",
}

const phaseLabelStyle: React.CSSProperties = {
  fontSize: "9px",
  fontWeight: 700,
  letterSpacing: "0.08em",
  textTransform: "uppercase",
  color: "#3ECF6A",
  padding: "6px 8px 3px 8px",
  marginTop: "2px",
}
