"use client"

import React, { useEffect, useMemo, useState } from "react"
import { useRouter } from "next/navigation"
import { CAUSE_EFFECTS } from "@/lib/data/causeEffects"
import { Play, GitBranch, TrendingUp, BookOpen } from "lucide-react"
import "../Recipe.css"

type Section = "videos" | "sequence" | "causeEffects" | "glossary"

type CauseEffect = {
  id: number
  cause: string
}

type ActiveEffect = {
  effectId: string
  parameterId: number
  text: string
}

// LED Component matching Effects page
function RecipeLED({
  color,
  size = "md",
  pulse = false,
}: {
  color: "green" | "blue" | "red" | "orange"
  size?: "sm" | "md"
  pulse?: boolean
}) {
  return (
    <span
      className={`recipe-led recipe-led-${color} ${
        size === "sm" ? "recipe-led-sm" : "recipe-led-md"
      } ${pulse ? "recipe-led-pulse" : ""}`}
    />
  )
}

// Cause & Effects Matching Component
function CauseEffectsSection() {
  const BATCH_SIZE = 6
  const [mode, setMode] = useState<"increase" | "decrease">("increase")
  const [batchIndex, setBatchIndex] = useState(0)
  const [currentEffects, setCurrentEffects] = useState<ActiveEffect[]>([])
  const [selectedCause, setSelectedCause] = useState<number | null>(null)
  const [matched, setMatched] = useState<Set<number>>(new Set())
  const [wrongPair, setWrongPair] = useState<{
    cause: number
    effect: number
  } | null>(null)
  const [completed, setCompleted] = useState<boolean>(false)

  const batches = useMemo(() => {
    const result: typeof CAUSE_EFFECTS[] = []
    for (let index = 0; index < CAUSE_EFFECTS.length; index += BATCH_SIZE) {
      result.push(CAUSE_EFFECTS.slice(index, index + BATCH_SIZE))
    }
    return result
  }, [])

  const currentParameters = batches[batchIndex] ?? []

  useEffect(() => {
    const effects = currentParameters.map((parameter) => ({
      effectId: `effect-${parameter.id}-${mode}`,
      parameterId: parameter.id,
      text: parameter.effects[mode],
    }))
    setCurrentEffects([...effects].sort(() => Math.random() - 0.5))
    setMatched(new Set())
    setSelectedCause(null)
    setWrongPair(null)
    setCompleted(false)
  }, [batchIndex, mode, currentParameters])

  useEffect(() => {
    if (currentParameters.length > 0 && matched.size === currentParameters.length && !completed) {
      setCompleted(true)
    }
  }, [matched, completed, currentParameters.length])

  const handleCauseClick = (id: number) => {
    if (matched.has(id)) return
    setSelectedCause(id)
    setWrongPair(null)
  }

  const handleEffectClick = (parameterId: number) => {
    if (selectedCause === null || matched.has(selectedCause)) return

    if (selectedCause === parameterId) {
      setMatched((prev) => new Set([...prev, selectedCause]))
      setSelectedCause(null)
    } else {
      setWrongPair({ cause: selectedCause, effect: parameterId })
      setTimeout(() => {
        setWrongPair(null)
        setSelectedCause(null)
      }, 500)
    }
  }

  const switchMode = (newMode: "increase" | "decrease") => {
    if (newMode === mode) return
    setMode(newMode)
    setMatched(new Set())
    setSelectedCause(null)
    setWrongPair(null)
    setCompleted(false)
  }

  const visibleCausePairs: CauseEffect[] = currentParameters.map((item) => ({
    id: item.id,
    cause: `${item.parameter} (${mode === "increase" ? "↑" : "↓"})`,
  }))

  const handleReset = () => {
    setBatchIndex((current) => (current + 1) % batches.length)
  }

  return (
    <div className="recipe-effects-container">
      <div className="recipe-effects-header">
        <div className="recipe-effects-title-box">
          <h2 className="recipe-effects-title">Cause & Effect Matcher</h2>
          <p className="recipe-effects-subtitle">
            Match process parameter changes to their physical results
          </p>
        </div>
        <div className="recipe-effects-header-actions">
          <div className="recipe-effects-mode-toggle">
            <button
              className={`recipe-mode-btn ${mode === "increase" ? "active" : ""}`}
              onClick={() => switchMode("increase")}
            >
              Effects of INCREASE (▲)
            </button>
            <button
              className={`recipe-mode-btn ${mode === "decrease" ? "active" : ""}`}
              onClick={() => switchMode("decrease")}
            >
              Effects of DECREASE (▼)
            </button>
          </div>
          <div className="recipe-effects-score-box">
            <span className="recipe-effects-score-label">Matched:</span>
            <span
              className={`recipe-effects-score-value ${
                matched.size === currentParameters.length
                  ? "recipe-effects-score-complete"
                  : ""
              }`}
            >
              {matched.size} / {currentParameters.length}
            </span>
          </div>
          <button className="recipe-effects-reset-btn" onClick={handleReset}>
            Reset
          </button>
        </div>
      </div>

      <div className="recipe-effects-subtitle" style={{ marginBottom: 16 }}>
        SET {batchIndex + 1} OF {batches.length}
      </div>

      {completed && (
        <div className="recipe-effects-success-box">
          <RecipeLED color="green" pulse />
          <span>
            ALL {currentParameters.length} PARAMETERS MATCHED ✓ -{" "}
            {mode === "increase" ? "INCREASE MODE" : "DECREASE MODE"} COMPLETE
          </span>
          <RecipeLED color="green" pulse />
        </div>
      )}

      <div className="recipe-effects-grid">
        <div className="recipe-effects-column">
          <h3 className="recipe-effects-column-title recipe-cause-title">
            Cause (Parameter Change)
          </h3>
          <div className="recipe-effects-card-list">
            {visibleCausePairs.map((pair) => {
              const isMatched = matched.has(pair.id)
              const isSelected = selectedCause === pair.id
              const isWrong = wrongPair?.cause === pair.id

              return (
                <button
                  key={pair.id}
                  onClick={() => handleCauseClick(pair.id)}
                  disabled={isMatched}
                  className={`recipe-effects-card ${
                    isMatched ? "recipe-effects-card-matched" : ""
                  } ${isSelected ? "recipe-effects-card-selected" : ""} ${
                    isWrong ? "recipe-effects-card-wrong" : ""
                  }`}
                >
                  <span>{pair.cause}</span>
                </button>
              )
            })}
          </div>
        </div>

        <div className="recipe-effects-column">
          <h3 className="recipe-effects-column-title recipe-result-title">
            Effect (Physical Result)
          </h3>
          <div className="recipe-effects-card-list">
            {currentEffects.map((effect) => {
              const isMatched = matched.has(effect.parameterId)
              const isWrong = wrongPair?.effect === effect.parameterId

              return (
                <button
                  key={effect.effectId}
                  onClick={() => handleEffectClick(effect.parameterId)}
                  disabled={isMatched || selectedCause === null}
                  className={`recipe-effects-card ${
                    isMatched ? "recipe-effects-card-matched" : ""
                  } ${isWrong ? "recipe-effects-card-wrong" : ""} ${
                    selectedCause === null && !isMatched
                      ? "recipe-effects-card-disabled"
                      : ""
                  }`}
                >
                  <span>{effect.text}</span>
                </button>
              )
            })}
          </div>
        </div>
      </div>
    </div>
  )
}

export default function RecipeModulePage() {
  const router = useRouter()
  const [activeSection, setActiveSection] = useState<Section>("causeEffects")

  const sections = [
    { id: "sequence" as Section, label: "Recipe Sequence", icon: GitBranch },
    { id: "causeEffects" as Section, label: "Cause & Effects", icon: TrendingUp },
    { id: "videos" as Section, label: "Reference Videos", icon: Play },
    { id: "glossary" as Section, label: "Glossary", icon: BookOpen },
  ]

  return (
    <div className="recipe-module-container">
      {/* Header */}
      <header className="recipe-module-header">
        <div className="recipe-header-content">
          <div className="recipe-header-left">
            <button onClick={() => router.push("/")} className="recipe-home-btn">
              ← HOME
            </button>
            <button onClick={() => router.push("/Alarms")} className="recipe-alarms-btn">
              ⚠ ALARMS
            </button>
            <div className="recipe-title-block">
              <h1 className="recipe-equipment-name">300mm Flip Chip Thermo-Compression Bonder</h1>
              <p className="recipe-process-name">Thermo-Compression Bonding (TCB) Process</p>
            </div>
          </div>
          <div className="recipe-spec-badge">
            <span className="spec-label">DIE SPEC</span>
            <span className="spec-value">10×10mm | 100µm | Cu+Sn-Ag | 55µm pitch</span>
          </div>
        </div>

        {/* Navigation Tabs */}
        <nav className="recipe-nav-tabs">
          {sections.map(section => {
            const Icon = section.icon
            return (
              <button
                key={section.id}
                onClick={() => {
                  if (section.id === "sequence") {
                    router.push("/RecipeSequence")
                    return
                  }

                  setActiveSection(section.id)
                }}
                className={`recipe-nav-tab${activeSection === section.id ? " active" : ""}`}
              >
                <Icon size={16} />
                <span>{section.label}</span>
              </button>
            )
          })}
        </nav>
      </header>

      {/* Content */}
      <main className="recipe-module-main">
        {/* SECTION 2: Cause & Effects */}
        {activeSection === "causeEffects" && (
          <div className="recipe-section">
            <div className="section-header">
              <h2>Cause & Effect Matcher</h2>
              <span className="section-badge">SECTION 2 · ALL 19 PARAMETERS</span>
            </div>
            <CauseEffectsSection />
          </div>
        )}

        {/* SECTION 3: Reference Videos */}
        {activeSection === "videos" && (
          <div className="recipe-section">
            <div className="section-header">
              <h2>Reference Videos</h2>
              <span className="section-badge">SECTION 3</span>
            </div>
            <div className="videos-grid">
              {[
                { title: "TCB Process Overview", url: "TBD", duration: "8:45", description: "Complete bonding cycle walkthrough" },
                { title: "Equipment Teardown & Maintenance", url: "TBD", duration: "15:22", description: "Internal components and preventive maintenance" },
                { title: "Alignment System Deep-Dive", url: "TBD", duration: "6:30", description: "Dual-FOV optics calibration and troubleshooting" },
                { title: "Flux Management Best Practices", url: "TBD", duration: "4:15", description: "Film thickness control and dip technique" },
                { title: "Alarm Response Training", url: "TBD", duration: "12:00", description: "Operator response procedures for common alarms" },
              ].map((video, idx) => (
                <div key={idx} className="video-card">
                  <div className="video-thumbnail">
                    <Play size={48} className="play-icon" />
                    <span className="video-duration">{video.duration}</span>
                  </div>
                  <div className="video-info">
                    <h3>{video.title}</h3>
                    <p>{video.description}</p>
                    <span className="video-status">{video.url === "TBD" ? "Coming Soon" : "Watch Now"}</span>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* SECTION 4: Glossary */}
        {activeSection === "glossary" && (
          <div className="recipe-section">
            <div className="section-header">
              <h2>Glossary & Acronyms</h2>
              <span className="section-badge">SECTION 4</span>
            </div>
            <div className="glossary-grid">
              {[
                { term: "TCB", definition: "Thermo-Compression Bonding — a die-attach process using heat and pressure to form solder joints" },
                { term: "IMC", definition: "Intermetallic Compound — the Cu-Sn or Cu-Ag alloy layer formed at solder joints during reflow" },
                { term: "PRS", definition: "Pattern Recognition System — the vision system that maps wafer/die coordinates" },
                { term: "Dual-FOV", definition: "Dual Field-of-View — simultaneous look-up (die) and look-down (substrate) alignment optics" },
                { term: "C-SAT", definition: "C-Mode Scanning Acoustic Tomography — used to detect voids/delamination in bonded joints" },
                { term: "AOI", definition: "Automated Optical Inspection — post-bond imaging to detect bridging, misalignment, or surface defects" },
                { term: "OCAP", definition: "Out-of-Control Action Plan — documented response when SPC detects process drift" },
                { term: "SPC", definition: "Statistical Process Control — real-time charting (I-MR, X̄-R) to detect trends/shifts" },
                { term: "I-MR Chart", definition: "Individual-Moving Range chart — tracks individual measurements and variation between consecutive points" },
                { term: "UPH", definition: "Units Per Hour — throughput metric for bonding cycle time" },
                { term: "Coplanarity", definition: "The flatness of bump tips across a die, critical for uniform bond-line contact" },
                { term: "Squeeze-out", definition: "Excess solder forced beyond the joint footprint, risking bridging to adjacent bumps" },
              ].map((item, idx) => (
                <div key={idx} className="glossary-item">
                  <h4 className="glossary-term">{item.term}</h4>
                  <p className="glossary-def">{item.definition}</p>
                </div>
              ))}
            </div>
          </div>
        )}
      </main>
    </div>
  )
}
