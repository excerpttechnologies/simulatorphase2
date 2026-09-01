"use client"

import { useState, useEffect, useCallback } from "react"
import { useRouter } from "next/navigation"
import "../Recipe.css"

// ─────────────────────────────────────────────
// TYPES
// ─────────────────────────────────────────────
interface RecipeStep {
  id: number
  step: string
  module: string
  parameters: string
  objective: string
}

// ─────────────────────────────────────────────
// RECIPE DATA
// Sourced from the 17-step TCB (Thermo-Compression Bonding)
// pick / flip / dip-flux / align / bond / release sequence.
// ─────────────────────────────────────────────
const RECIPE_STEPS: RecipeStep[] = [
  { id: 1, step: "Substrate Loading", module: "WAFER PREP", parameters: "Vacuum ≥80 kPa; Stage 80°C; Dwell 5.0s", objective: "Clamp flat; eliminate bow/warp before mapping" },
  { id: 2, step: "Wafer Fiducial Scan", module: "WAFER PREP", parameters: "Dual-wavelength LED; Accuracy ≤±1.0µm; Scan 50-100mm/s", objective: "Register wafer coordinate system; flag bad die" },
  { id: 3, step: "Die Ejection", module: "PICK & FLIP", parameters: "4-pin array; Stroke 0.80mm; Speed 15mm/s", objective: "Break die-to-tape bond via pin deformation" },
  { id: 4, step: "Pick & Lift", module: "PICK & FLIP", parameters: "Force 3.5N; Vacuum -85kPa; Delay 50ms", objective: "Lift die with controlled vacuum seal" },
  { id: 5, step: "Transfer & Handover to Pedestal", module: "PICK & FLIP", parameters: "Z-gap 50µm; Speed 300-500mm/s; Repeatability ≤±1µm", objective: "Handoff die to flipper pedestal safely" },
  { id: 6, step: "180° Flip", module: "PICK & FLIP", parameters: "Rotation 720°/s; Settle 20-50ms; Accuracy ≤±2µm", objective: "Invert die to bump-side-down orientation" },
  { id: 7, step: "Bonding Head Moves to Pedestal", module: "PICK & FLIP", parameters: "Speed 400-600mm/s; Decel zone 5mm; Repeatability ≤±1µm", objective: "Position bond head above flipped die" },
  { id: 8, step: "Bonding Head Picks Up Die", module: "PICK & FLIP", parameters: "Vacuum -85kPa; Dwell 50-100ms; Flatness ≤1µm", objective: "Transfer die ownership to bond head" },
  { id: 9, step: "Move to Flux Plate", module: "DIP FLUX", parameters: "Speed 300-500mm/s; Accuracy ≤±5µm; Approach 1-2mm", objective: "Center die over flux film station" },
  { id: 10, step: "Dip, Dwell & Retract", module: "DIP FLUX", parameters: "Flux film 7µm; Dip depth 5µm; Dwell 200ms", objective: "Wet bump tips uniformly with flux" },
  { id: 11, step: "Move to Bond Site", module: "OPTICS ALIGN", parameters: "Speed 400-600mm/s; Accuracy ≤±5µm; Standoff 1-3mm", objective: "Position fluxed die above bond site" },
  { id: 12, step: "Dual-FOV Optics Alignment", module: "OPTICS ALIGN", parameters: "Precision ≤±1.5µm; Cycle 150-300ms; Clearance >10mm", objective: "Compute X/Y/theta correction via dual FOV" },
  { id: 13, step: "Touchdown / Pre-Heat", module: "TCB CYCLE", parameters: "Touchdown 120→160°C; Preheat 160→220°C; Force→45N", objective: "Stage contact and ramp temp/force together" },
  { id: 14, step: "Peak Reflow Pulse", module: "TCB CYCLE", parameters: "Peak 285°C; Hold force 45.0N; Duration 1.5s", objective: "Reflow solder; form intermetallic compound" },
  { id: 15, step: "Cool Down", module: "TCB CYCLE", parameters: "Ramp 100°C/s; Target <180°C; Duration 1.2s", objective: "Quench joint below solidus under load" },
  { id: 16, step: "Release & Retract", module: "RELEASE", parameters: "N₂ pulse +10kPa; Slow lift 1mm; Retract 50mm/s", objective: "Positively release die; retract bond head" },
  { id: 17, step: "Index to Next Site", module: "RELEASE", parameters: "Accuracy ≤±1µm; Cycle 3-5s; Throughput 1500-3500 UPH", objective: "Move stage to next bond site" },
]

// ─────────────────────────────────────────────
// NARRATION DATA
// Professional male narrator voice lines for each step.
// ─────────────────────────────────────────────
const NARRATION_LINES: Record<number, string> = {
  1: "Loading the substrate onto the heated stage and engaging vacuum hold.",
  2: "Scanning the wafer fiducial marks to register die coordinates.",
  3: "Ejector pins push up from beneath to release the target die.",
  4: "The pick and place arm vacuum grips the die and lifts it clear.",
  5: "Carrying the die sideways and lowering it onto the vacuum pedestal.",
  6: "The vacuum pedestal rotates a full one eighty degrees, flipping the die.",
  7: "The T C B bonding head travels left to align over the flipped die.",
  8: "The bonding head lowers, vacuum picks the die, and lifts it away.",
  9: "Moving the die over to the flux film plate.",
  10: "Dipping the bumps into flux, holding briefly, then retracting clear.",
  11: "Moving the die into position above the target bond site.",
  12: "Dual field of view optics slide in to align die and substrate.",
  13: "Touching down on the substrate and ramping up to full bond force.",
  14: "A rapid heat pulse melts the solder, forming the bond.",
  15: "Cooling air locks the joint solid before the head lifts away.",
  16: "Releasing the die and retracting the bonding head clear.",
  17: "Indexing to the next site as the head returns home.",
}

const TOTAL_STEPS = RECIPE_STEPS.length

// Indices (0-based) of the 3 stages that get randomized on reset.
// All other 14 stages remain in their correct positions.
const SHUFFLE_INDICES = [5, 9, 13] // stages #6, #10, #14

// ─────────────────────────────────────────────
// Helper: Fisher-Yates shuffle (returns new array)
// ─────────────────────────────────────────────
function shuffle<T>(arr: T[]): T[] {
  const a = [...arr]
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1))
    ;[a[i], a[j]] = [a[j], a[i]]
  }
  return a
}

// ─────────────────────────────────────────────
// Helper: build the default state with exactly 3 shuffled stages.
// The 14 non-shuffled stages stay in their correct positions.
// ─────────────────────────────────────────────
function buildDefaultSteps(): RecipeStep[] {
  const steps = [...RECIPE_STEPS]

  // Extract the 3 stages to shuffle
  const shuffledPool = shuffle(SHUFFLE_INDICES.map(i => steps[i]))

  // Place the shuffled stages back into their designated positions
  SHUFFLE_INDICES.forEach((idx, i) => {
    steps[idx] = shuffledPool[i]
  })

  return steps
}

// ─────────────────────────────────────────────
// Validation: ensure sequence has exactly 17 unique stages
// ─────────────────────────────────────────────
function validateSequence(steps: RecipeStep[]): boolean {
  if (steps.length !== TOTAL_STEPS) return false
  const ids = new Set(steps.map(s => s.id))
  if (ids.size !== TOTAL_STEPS) return false
  for (let i = 1; i <= TOTAL_STEPS; i++) {
    if (!ids.has(i)) return false
  }
  return true
}

// ─────────────────────────────────────────────
// LED
// ─────────────────────────────────────────────
function LED({ color, pulse = false }: { color: "green" | "red" | "amber" | "cyan"; pulse?: boolean }) {
  const colorMap = { green: "#22c55e", red: "#ef4444", amber: "#f59e0b", cyan: "#06b6d4" }
  return (
    <span
      style={{
        display: "inline-block",
        width: 8,
        height: 8,
        borderRadius: "50%",
        backgroundColor: colorMap[color],
        flexShrink: 0,
        animation: pulse ? "pulse 1.5s ease-in-out infinite" : "none",
        boxShadow: `0 0 5px ${colorMap[color]}88`,
      }}
    />
  )
}

// ─────────────────────────────────────────────
// MAIN COMPONENT
// ─────────────────────────────────────────────
export default function RecipeSequencer() {
  const router = useRouter()
  const [selectedRecipe, setSelectedRecipe] = useState<"A" | "B" | "C" | null>(null)
  const [shuffledSteps, setShuffledSteps] = useState<RecipeStep[]>([])
  const [draggedStep, setDraggedStep] = useState<number | null>(null)
  const [dragOverIdx, setDragOverIdx] = useState<number | null>(null)
  const [visibleRowCount, setVisibleRowCount] = useState(6)
  const [completed, setCompleted] = useState(false)
  const [narratingStep, setNarratingStep] = useState<number | null>(null)
  const [narrationQueue, setNarrationQueue] = useState<number[]>([])
  const [isNarratingAll, setIsNarratingAll] = useState(false)

  const recipes = [
    { id: "A" as const, name: "TCB Die Bonding — Pick, Flip & Reflow", steps: TOTAL_STEPS },
    // { id: "B" as const, name: "i-Line 365nm Resist (Abbreviated)", steps: 12 },
    // { id: "C" as const, name: "NTD (Negative Tone Developer) Resist", steps: 15 },
  ]

  const resetToDefault = useCallback(() => {
    const newSteps = buildDefaultSteps()
    if (!validateSequence(newSteps)) {
      console.error("RecipeSequence: validation failed after reset — falling back to correct order")
      setShuffledSteps([...RECIPE_STEPS])
    } else {
      setShuffledSteps(newSteps)
    }
    setVisibleRowCount(TOTAL_STEPS)
    setCompleted(false)
  }, [])

  const revealNextBatch = useCallback(() => {
    setVisibleRowCount((current) => {
      if (current >= TOTAL_STEPS) return 6
      return Math.min(current + 6, TOTAL_STEPS)
    })
  }, [])

  useEffect(() => {
    if (selectedRecipe) resetToDefault()
  }, [selectedRecipe, resetToDefault])

  const getCorrectCount = () => shuffledSteps.filter((s, i) => s.id === i + 1).length
  const visibleSteps = shuffledSteps.slice(0, visibleRowCount)

  useEffect(() => {
    if (shuffledSteps.length > 0 && !completed) {
      const count = shuffledSteps.filter((s, i) => s.id === i + 1).length
      if (count === TOTAL_STEPS) setCompleted(true)
    }
  }, [shuffledSteps, completed])

  const handleDragStart = (idx: number) => setDraggedStep(idx)

  const handleDragOver = (e: React.DragEvent, idx: number) => {
    e.preventDefault()
    setDragOverIdx(idx)
  }

  const handleDragLeave = () => setDragOverIdx(null)

  const handleDrop = (e: React.DragEvent, dropIdx: number) => {
    e.preventDefault()
    if (draggedStep === null) return
    const newSteps = [...shuffledSteps]
    const [dragged] = newSteps.splice(draggedStep, 1)
    newSteps.splice(dropIdx, 0, dragged)
    setShuffledSteps(newSteps)
    setDraggedStep(null)
    setDragOverIdx(null)
  }

  // ─────────────────────────────────────────────
  // NARRATION — Web Speech API (TTS)
  // ─────────────────────────────────────────────
  const stopNarration = useCallback(() => {
    window.speechSynthesis.cancel()
    setNarratingStep(null)
    setNarrationQueue([])
    setIsNarratingAll(false)
  }, [])

  const narrateStep = useCallback((stepId: number) => {
    window.speechSynthesis.cancel()
    const text = NARRATION_LINES[stepId]
    if (!text) return

    setNarratingStep(stepId)
    setNarrationQueue([])
    setIsNarratingAll(false)

    const utterance = new SpeechSynthesisUtterance(text)
    utterance.rate = 0.85
    utterance.pitch = 0.8
    utterance.volume = 1.0

    const voices = window.speechSynthesis.getVoices()
    const maleVoice = voices.find(v =>
      v.name.toLowerCase().includes("male") ||
      v.name.toLowerCase().includes("david") ||
      v.name.toLowerCase().includes("james") ||
      v.name.toLowerCase().includes("google uk english male") ||
      v.name.toLowerCase().includes(" microsoft david")
    ) || voices.find(v => v.lang.startsWith("en"))
    if (maleVoice) utterance.voice = maleVoice

    utterance.onend = () => setNarratingStep(null)
    utterance.onerror = () => setNarratingStep(null)

    window.speechSynthesis.speak(utterance)
  }, [])

  const narrateAll = useCallback(() => {
    window.speechSynthesis.cancel()
    const ids = Array.from({ length: TOTAL_STEPS }, (_, i) => i + 1)
    setNarrationQueue(ids)
    setIsNarratingAll(true)
  }, [])

  useEffect(() => {
    if (narrationQueue.length === 0) return
    const [nextId, ...rest] = narrationQueue
    setNarrationQueue(rest)

    const text = NARRATION_LINES[nextId]
    if (!text) return

    setNarratingStep(nextId)

    const utterance = new SpeechSynthesisUtterance(text)
    utterance.rate = 0.85
    utterance.pitch = 0.8
    utterance.volume = 1.0

    const voices = window.speechSynthesis.getVoices()
    const maleVoice = voices.find(v =>
      v.name.toLowerCase().includes("male") ||
      v.name.toLowerCase().includes("david") ||
      v.name.toLowerCase().includes("james") ||
      v.name.toLowerCase().includes("google uk english male") ||
      v.name.toLowerCase().includes(" microsoft david")
    ) || voices.find(v => v.lang.startsWith("en"))
    if (maleVoice) utterance.voice = maleVoice

    utterance.onend = () => {
      if (rest.length === 0) {
        setNarratingStep(null)
        setIsNarratingAll(false)
      }
    }
    utterance.onerror = () => {
      setNarratingStep(null)
      setIsNarratingAll(false)
      setNarrationQueue([])
    }

    window.speechSynthesis.speak(utterance)
  }, [narrationQueue])

  // ─────────────────────────────────────────────
  // RECIPE SELECT
  // ─────────────────────────────────────────────
  if (!selectedRecipe) {
    return (
      <div
        style={{
          minHeight: "100vh",
          background: "linear-gradient(135deg, #f8fbff, #eef5ff)",
          padding: "2rem",
          fontFamily: "system-ui, sans-serif",
        }}
      >
        <style>{`
          @keyframes pulse {
            0%, 100% { opacity: 1 }
            50% { opacity: 0.4 }
          }
        `}</style>

        {/* HEADER */}
        <header style={{ marginBottom: "2rem" }}>
          <div
            style={{
              display: "flex",
              justifyContent: "space-between",
              alignItems: "center",
              marginBottom: "1rem",
              flexWrap: "wrap",
              gap: "1rem",
            }}
          >
            {/* LEFT — Logo */}
            <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
              <div
                style={{
                  width: 12,
                  height: 12,
                  borderRadius: "50%",
                  background: "linear-gradient(135deg, #22c55e, #16a34a)",
                  boxShadow: "0 0 10px rgba(34, 197, 94, 0.5)",
                }}
              />
              <span style={{ fontSize: 18, fontWeight: 700, color: "#1e293b" }}>
                SMaRT Simulator
              </span>
            </div>

            {/* RIGHT — Actions */}
            <div style={{ display: "flex", gap: 10 }}>
              <button
                onClick={() => router.push("/")}
                style={{
                  padding: "8px 16px",
                  border: "2px solid #3b82f6",
                  borderRadius: "6px",
                  background: "transparent",
                  color: "#3b82f6",
                  fontSize: 13,
                  fontWeight: 700,
                  cursor: "pointer",
                  transition: "all 0.2s",
                }}
                onMouseEnter={e => {
                  e.currentTarget.style.background = "#3b82f6"
                  e.currentTarget.style.color = "white"
                }}
                onMouseLeave={e => {
                  e.currentTarget.style.background = "transparent"
                  e.currentTarget.style.color = "#3b82f6"
                }}
              >
                HOME
              </button>
              <button
                onClick={() => router.push("/Effects")}
                style={{
                  padding: "8px 16px",
                  border: "1.5px solid #8b5cf6",
                  borderRadius: "6px",
                  background: "white",
                  color: "#8b5cf6",
                  fontSize: 13,
                  fontWeight: 600,
                  cursor: "pointer",
                  transition: "all 0.2s",
                }}
                onMouseEnter={e => {
                  e.currentTarget.style.background = "#8b5cf6"
                  e.currentTarget.style.color = "white"
                }}
                onMouseLeave={e => {
                  e.currentTarget.style.background = "white"
                  e.currentTarget.style.color = "#8b5cf6"
                }}
              >
                Effects Module
              </button>
              <button
                onClick={() => router.push("/Alarms")}
                style={{
                  padding: "8px 16px",
                  border: "1.5px solid #ef4444",
                  borderRadius: "6px",
                  background: "white",
                  color: "#ef4444",
                  fontSize: 13,
                  fontWeight: 600,
                  cursor: "pointer",
                  transition: "all 0.2s",
                }}
                onMouseEnter={e => {
                  e.currentTarget.style.background = "#ef4444"
                  e.currentTarget.style.color = "white"
                }}
                onMouseLeave={e => {
                  e.currentTarget.style.background = "white"
                  e.currentTarget.style.color = "#ef4444"
                }}
              >
                Alarm Handling
              </button>
            </div>
          </div>

          <div>
            <h1 style={{ fontSize: 24, fontWeight: 800, color: "#0f172a", margin: "0 0 8px" }}>
              Recipe Sequencer
            </h1>
            <p style={{ fontSize: 13, color: "#64748b", margin: 0 }}>
              Select a recipe to begin the sequencing challenge
            </p>
          </div>
        </header>

        {/* RECIPE CARDS */}
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fit, minmax(260px, 1fr))",
            gap: 16,
          }}
        >
          {recipes.map(r => (
            <button
              key={r.id}
              onClick={() => setSelectedRecipe(r.id)}
              style={{
                background: "#fff",
                border: "1.5px solid #bfdbfe",
                borderRadius: 16,
                padding: "18px 20px",
                textAlign: "left",
                cursor: "pointer",
                transition: "all 0.2s",
              }}
              onMouseEnter={e => (e.currentTarget.style.borderColor = "#06b6d4")}
              onMouseLeave={e => (e.currentTarget.style.borderColor = "#bfdbfe")}
            >
              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 8,
                  marginBottom: 8,
                }}
              >
                <span
                  style={{
                    color: "#06b6d4",
                    fontWeight: 700,
                    fontSize: 16,
                  }}
                >
                  Recipe {r.id}
                </span>
                <LED color="amber" />
              </div>
              <p
                style={{
                  color: "#374151",
                  fontSize: 13,
                  margin: "0 0 8px",
                }}
              >
                {r.name}
              </p>
              <span
                style={{
                  color: "#94a3b8",
                  fontSize: 11,
                }}
              >
                {r.steps} Steps
              </span>
            </button>
          ))}
        </div>
      </div>
    )
  }

  // ─────────────────────────────────────────────
  // MAIN SEQUENCER
  // ─────────────────────────────────────────────
  const correctCount = getCorrectCount()

  return (
    <div
      style={{
        minHeight: "100vh",
        display: "flex",
        flexDirection: "column",
        background: "linear-gradient(135deg, #f8fbff, #eef5ff)",
        padding: "8px 12px",
        fontFamily: "system-ui, sans-serif",
        boxSizing: "border-box",
        overflow: "auto",
      }}
    >
      <style>{`
        @keyframes pulse {
          0%, 100% { opacity: 1 }
          50% { opacity: 0.4 }
        }
        .step-row {
          transition: box-shadow 0.15s, transform 0.1s;
        }
        .step-row:hover {
          box-shadow: 0 4px 18px rgba(59, 130, 246, 0.13) !important;
          transform: translateY(-1px);
        }
        .step-row.drag-over {
          border-color: #3b82f6 !important;
          background: #eff6ff !important;
        }
        .step-row.dragging {
          opacity: 0.45;
          transform: scale(0.99);
        }
      `}</style>

      {/* ── HEADER ── */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          marginBottom: 4,
          flexShrink: 0,
          flexWrap: "wrap",
          gap: 6,
        }}
      >
        <div>
          <h2
            style={{
              margin: 0,
              fontSize: 18,
              fontWeight: 700,
              color: "#1e293b",
              lineHeight: 1.2,
            }}
          >
            Recipe Sequencer
          </h2>
          <span
            style={{
              fontSize: 10,
              color: "#64748b",
            }}
          >
            Recipe {selectedRecipe}: TCB Die Bonding — Pick, Flip & Reflow
          </span>
        </div>
        
        <div
          style={{
            display: "flex",
            gap: 6,
            alignItems: "center",
          }}
        >
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: 6,
              padding: "4px 10px",
              background: "#fff",
              border: "1.5px solid #bfdbfe",
              borderRadius: 8,
            }}
          >
            <span
              style={{
                fontSize: 10,
                color: "#64748b",
                fontWeight: 500,
              }}
            >
              Correct
            </span>
            <span
              style={{
                fontFamily: "monospace",
                fontWeight: 700,
                fontSize: 13,
                color: correctCount === TOTAL_STEPS ? "#16a34a" : "#d97706",
              }}
            >
              {correctCount} / {TOTAL_STEPS}
            </span>
          </div>
          <button
            onClick={resetToDefault}
            style={{
              padding: "4px 12px",
              borderRadius: 8,
              background: "#f59e0b",
              border: "none",
              color: "#1c1917",
              fontWeight: 700,
              fontSize: 12,
              cursor: "pointer",
            }}
          >
            RESET
          </button>
          {isNarratingAll || narratingStep !== null ? (
            <button
              onClick={stopNarration}
              style={{
                padding: "4px 12px",
                borderRadius: 8,
                background: "#ef4444",
                border: "none",
                color: "#fff",
                fontWeight: 700,
                fontSize: 12,
                cursor: "pointer",
                display: "flex",
                alignItems: "center",
                gap: 4,
              }}
            >
              <span style={{ fontSize: 14 }}>⏹</span> STOP
            </button>
          ) : (
            <button
              onClick={narrateAll}
              style={{
                padding: "4px 12px",
                borderRadius: 8,
                background: "#8b5cf6",
                border: "none",
                color: "#fff",
                fontWeight: 700,
                fontSize: 12,
                cursor: "pointer",
                display: "flex",
                alignItems: "center",
                gap: 4,
              }}
            >
              <span style={{ fontSize: 14 }}>🔊</span> NARRATE ALL
            </button>
          )}
          <button
            onClick={() => setSelectedRecipe(null)}
            style={{
              padding: "4px 10px",
              borderRadius: 8,
              background: "#fff",
              border: "1.5px solid #cbd5e1",
              color: "#374151",
              fontWeight: 500,
              fontSize: 12,
              cursor: "pointer",
            }}
          >
            Change Recipe
          </button>
        </div>
      </div>

      {/* ── COMPLETE BANNER ── */}
      {completed && (
        <div
          style={{
            background: "linear-gradient(135deg, #dcfce7, #bbf7d0)",
            border: "1.5px solid #22c55e",
            borderRadius: 12,
            padding: "7px 16px",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            gap: 10,
            marginBottom: 6,
            flexShrink: 0,
          }}
        >
          <LED color="green" pulse />
          <span
            style={{
              color: "#166534",
              fontWeight: 700,
              fontSize: 15,
            }}
          >
            SEQUENCE VALIDATED ✓
          </span>
          <LED color="green" pulse />
        </div>
      )}

      {/* ── COLUMN HEADERS ── */}
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "52px 1fr 1.1fr 1.5fr 1.8fr 44px",
          gap: "0 10px",
          padding: "3px 10px",
          flexShrink: 0,
          marginBottom: 2,
        }}
      >
        {["", "Step", "Module", "Parameters", "Objective", "🔊"].map((h, i) => (
          <span
            key={i}
            style={{
              fontSize: 13,
              fontWeight: 700,
              color: "#3b3434",
              textTransform: "uppercase",
              letterSpacing: "0.06em",
              textAlign: i === 5 ? "center" : "left",
            }}
          >
            {h}
          </span>
        ))}
      </div>

      {/* ── STEP ROWS ── */}
      <div
        style={{
          flex: 1,
          display: "flex",
          flexDirection: "column",
          gap: 3,
          overflow: "hidden",
        }}
      >
        {visibleSteps.map((step, idx) => {
          const isCorrect = step.id === idx + 1
          const isCurrentlyNarrating = narratingStep === step.id
          return (
            <div
              key={step.id}
              draggable
              onDragStart={() => handleDragStart(idx)}
              onDragOver={e => handleDragOver(e, idx)}
              onDragLeave={handleDragLeave}
              onDrop={e => handleDrop(e, idx)}
              className={`step-row${dragOverIdx === idx ? " drag-over" : ""}${draggedStep === idx ? " dragging" : ""}`}
              style={{
                display: "grid",
                gridTemplateColumns: "52px 1fr 1.1fr 1.5fr 1.8fr 44px",
                gap: "0 10px",
                alignItems: "center",
                background: isCurrentlyNarrating
                  ? "#f5f3ff"
                  : isCorrect
                    ? "#f0fdf4"
                    : "#fef2f2",
                border: `1.5px solid ${isCurrentlyNarrating ? "#8b5cf6" : isCorrect ? "#22c55e" : "#fca5a5"}`,
                borderRadius: 8,
                padding: "4px 10px",
                cursor: "grab",
                flex: 1,
                minHeight: 0,
              }}
            >
              {/* # */}
              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 5,
                }}
              >
                <LED color={isCurrentlyNarrating ? "cyan" : isCorrect ? "green" : "red"} pulse={isCurrentlyNarrating} />
                <span
                  style={{
                    fontFamily: "monospace",
                    fontSize: 12,
                    fontWeight: 700,
                    color: "#475569",
                  }}
                >
                  #{idx + 1}
                </span>
              </div>
              {/* Step */}
              <span
                title={step.step}
                style={{
                  fontSize: 13,
                  fontWeight: 700,
                  color: "#1e293b",
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                  whiteSpace: "nowrap",
                }}
              >
                {step.step}
              </span>
              {/* Module */}
              <span
                title={step.module}
                style={{
                  fontSize: 12,
                  fontWeight: 600,
                  color: "#0e7490",
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                  whiteSpace: "nowrap",
                }}
              >
                {step.module}
              </span>
              {/* Parameters */}
              <span
                title={step.parameters}
                style={{
                  fontSize: 12,
                  color: "#000000",
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                  whiteSpace: "nowrap",
                }}
              >
                {step.parameters}
              </span>
              {/* Objective */}
              <span
                title={step.objective}
                style={{
                  fontSize: 12,
                  color: "#000000",
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                  whiteSpace: "nowrap",
                }}
              >
                {step.objective}
              </span>
              {/* Narrate button */}
              <div style={{ display: "flex", justifyContent: "center" }}>
                <button
                  onClick={(e) => {
                    e.stopPropagation()
                    if (isCurrentlyNarrating) {
                      stopNarration()
                    } else {
                      narrateStep(step.id)
                    }
                  }}
                  title={isCurrentlyNarrating ? "Stop narration" : `Narrate step ${idx + 1}`}
                  style={{
                    width: 30,
                    height: 30,
                    borderRadius: "50%",
                    border: "none",
                    background: isCurrentlyNarrating
                      ? "#ef4444"
                      : "linear-gradient(135deg, #8b5cf6, #7c3aed)",
                    color: "#fff",
                    fontSize: 14,
                    cursor: "pointer",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    transition: "all 0.2s",
                    boxShadow: isCurrentlyNarrating
                      ? "0 0 8px rgba(239,68,68,0.5)"
                      : "0 2px 6px rgba(139,92,246,0.3)",
                    flexShrink: 0,
                  }}
                  onMouseEnter={e => {
                    if (!isCurrentlyNarrating) {
                      e.currentTarget.style.transform = "scale(1.1)"
                      e.currentTarget.style.boxShadow = "0 3px 10px rgba(139,92,246,0.5)"
                    }
                  }}
                  onMouseLeave={e => {
                    e.currentTarget.style.transform = "scale(1)"
                    e.currentTarget.style.boxShadow = isCurrentlyNarrating
                      ? "0 0 8px rgba(239,68,68,0.5)"
                      : "0 2px 6px rgba(139,92,246,0.3)"
                  }}
                >
                  {isCurrentlyNarrating ? "⏹" : "🔊"}
                </button>
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}