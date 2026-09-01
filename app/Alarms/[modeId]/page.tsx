"use client"

import { useState, useMemo } from "react"
import { useRouter, usePathname, useParams } from "next/navigation"
import Link from "next/link"
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, ReferenceLine } from "recharts"
import { FAILURE_MODES } from "@/lib/data/failureModes"
import "../../alarm-module.css"

const getSeverityClass = (severity: number): string => {
  if (severity >= 10) return "severity-critical"
  if (severity >= 9) return "severity-high"
  if (severity >= 7) return "severity-medium"
  return "severity-low"
}

function SPCChart({ mode }: { mode: typeof FAILURE_MODES[number] }) {
  const chartData = useMemo(() => {
    const baseValue = mode.id === "bridging" ? 45.0 :
                      mode.id === "non-wetting" ? 285 :
                      mode.id === "die-cracking" ? 2.0 :
                      mode.id === "force-calibration" ? 0 :
                      3.5

    const data = []
    for (let i = 1; i <= 25; i++) {
      let value
      if (i < 15) {
        value = baseValue + (Math.random() - 0.5) * (baseValue * 0.04)
      } else {
        const drift = (i - 14) * (baseValue * 0.02)
        value = baseValue + drift + (Math.random() - 0.5) * (baseValue * 0.03)
      }
      data.push({
        sample: i,
        value: parseFloat(value.toFixed(3)),
        ucl: baseValue * 1.10,
        centerline: baseValue,
        lcl: baseValue * 0.90
      })
    }
    return data
  }, [mode.id])

  const getUnit = () => {
    if (mode.id === "non-wetting") return "°C"
    if (mode.id === "temp-instability") return "°C"
    if (mode.id === "force-calibration") return "%"
    return "N"
  }

  const getYAxisDomain = () => {
    const values = chartData.map(d => d.value)
    const min = Math.min(...values, chartData[0].lcl)
    const max = Math.max(...values, chartData[0].ucl)
    const padding = (max - min) * 0.1
    return [min - padding, max + padding]
  }

  return (
    <div style={{ width: "100%", height: 400 }}>
      <ResponsiveContainer>
        <LineChart data={chartData} margin={{ top: 20, right: 30, left: 20, bottom: 20 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="var(--panel-border)" />
          <XAxis
            dataKey="sample"
            stroke="var(--dim)"
            label={{ value: "Sample Number", position: "insideBottom", offset: -10, fill: "var(--dim)" }}
          />
          <YAxis
            stroke="var(--dim)"
            label={{ value: `Value (${getUnit()})`, angle: -90, position: "insideLeft", fill: "var(--dim)" }}
            domain={getYAxisDomain()}
          />
          <Tooltip
            contentStyle={{
              backgroundColor: "var(--panel)",
              border: "1px solid var(--panel-border)",
              borderRadius: "4px",
              color: "var(--text)"
            }}
            formatter={(value: number) => [value.toFixed(3) + " " + getUnit(), "Value"]}
          />

          <ReferenceLine
            y={chartData[0].ucl}
            stroke="var(--accent-red)"
            strokeDasharray="5 5"
            label={{ value: "UCL", position: "right", fill: "var(--accent-red)" }}
          />
          <ReferenceLine
            y={chartData[0].centerline}
            stroke="var(--accent-green)"
            strokeDasharray="3 3"
            label={{ value: "CL", position: "right", fill: "var(--accent-green)" }}
          />
          <ReferenceLine
            y={chartData[0].lcl}
            stroke="var(--accent-red)"
            strokeDasharray="5 5"
            label={{ value: "LCL", position: "right", fill: "var(--accent-red)" }}
          />

          <Line
            type="monotone"
            dataKey="value"
            stroke="var(--accent-cyan)"
            strokeWidth={2}
            dot={{ fill: "var(--accent-cyan)", r: 4 }}
            name="Measured Value"
          />
        </LineChart>
      </ResponsiveContainer>
    </div>
  )
}

function BondForceEvidenceGraphic() {
  return (
    <div className="fourd-evidence-graphic fourd-bond-force" aria-label="Bond force overshoot alarm interface">
      <div className="fourd-topbar">
        <span>1. EQUIPMENT SCREEN: RTM &amp; ALARMS</span>
      </div>

      <div className="fourd-body">
        <div className="fourd-chart-area">
          <div className="fourd-plot-title">BOND FORCE vs Z-POSITION</div>
          <div className="fourd-plot-subtitle">ACTUAL BOND CYCLE: OVERSHOOT</div>

          <svg viewBox="0 0 760 300" className="fourd-svg" role="img" aria-label="Bond force trend chart with overshoot alarm">
            <defs>
              <linearGradient id="bondFill" x1="0" x2="0" y1="0" y2="1">
                <stop offset="0%" stopColor="#6cb780" stopOpacity="0.38" />
                <stop offset="100%" stopColor="#6cb780" stopOpacity="0.14" />
              </linearGradient>
            </defs>

            <g transform="translate(28,10)">
              <rect x="0" y="0" width="610" height="235" fill="#2a3d2c" opacity="0.58" rx="0" />
              {[0, 1, 2, 3, 4].map((i) => (
                <line key={`h-${i}`} x1="0" x2="610" y1={30 + i * 45} y2={30 + i * 45} stroke="#d7e6d5" strokeOpacity="0.18" />
              ))}
              {[0, 1, 2, 3, 4, 5, 6].map((i) => (
                <line key={`v-${i}`} x1={35 + i * 88} x2={35 + i * 88} y1="0" y2="235" stroke="#d7e6d5" strokeOpacity="0.18" />
              ))}

              <path d="M 0 175 C 52 165, 90 155, 138 142 S 240 110, 292 86 S 392 62, 450 74 S 572 112, 610 116 L 610 235 L 0 235 Z" fill="url(#bondFill)" opacity="0.85" />
              <path d="M 0 172 C 52 160, 90 152, 138 140 S 240 110, 292 86 S 392 66, 450 73 S 572 110, 610 118" fill="none" stroke="#44d7f9" strokeWidth="2.5" strokeLinecap="round" />
              <path d="M 0 164 L 610 164" stroke="#e3f5ea" strokeOpacity="0.22" strokeDasharray="4 6" />

              <g fill="#d8eaf8" fontSize="11" fontFamily="Segoe UI, sans-serif">
                {[0, 20, 40, 60, 80, 100, 120].map((pos) => (
                  <text key={pos} x={18 + pos * 4.8} y="255" textAnchor="middle">{pos}</text>
                ))}
                <text x="-10" y="160" transform="rotate(-90 -10 160)" textAnchor="middle">FORCE</text>
                <text x="290" y="280" textAnchor="middle">POSITION</text>
              </g>

              <text x="190" y="95" fill="#d8f6ff" fontSize="16" fontWeight="700" fontFamily="Segoe UI, sans-serif">QUALIFIED GOLDEN ENVELOPE</text>
            </g>
          </svg>

          <div className="fourd-fault-box">
            <div className="fourd-fault-title">FAULT:</div>
            <div className="fourd-fault-copy">Force Exceeds UCL<br />(Squeeze-Out Risk)</div>
          </div>
        </div>

        <div className="fourd-gauge-panel">
          <div className="fourd-gauge-label">PEAK BOND FORCE</div>
          <div className="fourd-gauge-dial">
            <div className="fourd-gauge-needle" />
            <div className="fourd-gauge-center" />
          </div>
          <div className="fourd-gauge-readout">54.2 N</div>
          <div className="fourd-gauge-limit">49.5 N alarm limit</div>
        </div>
      </div>

      <div className="fourd-alarm-log">
        <span>ALM-TCB-1042:</span> BOND FORCE EXCEEDS UPPER CONTROL LIMIT — Possible Solder Squeeze-Out / Bump Bridging Risk. [ACKNOWLEDGED]
      </div>
    </div>
  )
}

function ThermalProfileEvidenceGraphic() {
  return (
    <div className="fourd-evidence-graphic fourd-thermal-profile" aria-label="Thermal profile alarm interface">
      <div className="fourd-topbar">
        <span>BOND HEAD THERMAL PROFILE</span>
      </div>

      <div className="fourd-body thermal-layout">
        <div className="fourd-chart-area thermal-chart-area">
          <div className="fourd-plot-legend">
            <span className="legend-swatch qualified" /> Qualified Profile
            <span className="legend-swatch abnormal" /> Abnormal Trace
          </div>

          <svg viewBox="0 0 760 300" className="fourd-svg" role="img" aria-label="Bond head thermal profile with abnormal trace and dwell envelope">
            <defs>
              <linearGradient id="thermalFill" x1="0" x2="0" y1="0" y2="1">
                <stop offset="0%" stopColor="#e8b86d" stopOpacity="0.22" />
                <stop offset="100%" stopColor="#e8b86d" stopOpacity="0.07" />
              </linearGradient>
            </defs>

            <g transform="translate(28,16)">
              <rect x="0" y="0" width="610" height="220" fill="#f4ecdb" opacity="0.06" />
              {[0,1,2,3,4].map((i) => (
                <line key={`h-${i}`} x1="0" x2="610" y1={25 + i * 38} y2={25 + i * 38} stroke="#d9d0ba" strokeOpacity="0.22" />
              ))}
              {[0,1,2,3,4,5,6].map((i) => (
                <line key={`v-${i}`} x1={40 + i * 83} x2={40 + i * 83} y1="0" y2="220" stroke="#d9d0ba" strokeOpacity="0.22" />
              ))}

              <path d="M 0 180 C 52 160, 102 142, 142 118 S 220 80, 292 54 S 420 36, 498 74 S 575 120, 610 118 L 610 220 L 0 220 Z" fill="url(#thermalFill)" />
              <path d="M 0 180 C 52 160, 102 142, 142 118 S 220 80, 292 54 S 420 36, 498 74 S 575 120, 610 118" fill="none" stroke="#d9b563" strokeWidth="2.5" strokeLinecap="round" />
              <path d="M 0 150 C 52 130, 102 130, 142 118 S 220 96, 292 78 S 420 44, 498 54 S 575 90, 610 90" fill="none" stroke="#f9496a" strokeWidth="2.5" strokeDasharray="8 7" strokeLinecap="round" />

              <text x="95" y="30" fill="#efddab" fontSize="12" fontWeight="600" fontFamily="Segoe UI, sans-serif">Dwell Time In Envelope</text>
              <text x="90" y="195" fill="#d9d0ba" fontSize="12" fontFamily="Segoe UI, sans-serif">Ramp Rate: 255°C ±10°C</text>
              <text x="90" y="150" fill="#d9d0ba" fontSize="12" fontFamily="Segoe UI, sans-serif">Dwell Time = Cut Short</text>
              <text x="540" y="12" fill="#efddab" fontSize="12" fontWeight="700" fontFamily="Segoe UI, sans-serif">Peak Temp: 255°C (Alarm)</text>
              <text x="560" y="38" fill="#efddab" fontSize="12" fontWeight="700" fontFamily="Segoe UI, sans-serif">Dwell Time: 3.2s (Alarm)</text>
            </g>
          </svg>
        </div>

        <div className="fourd-gauge-panel thermal-gauge-panel">
          <div className="fourd-gauge-label">ALERT / ALARM</div>
          <div className="fourd-gauge-dial thermal-gauge-dial">
            <div className="fourd-gauge-needle thermal-needle" />
            <div className="fourd-gauge-center" />
          </div>
          <div className="fourd-gauge-readout thermal-readout">(Alarm)</div>
        </div>
      </div>

      <div className="fourd-zone-panel">
        <div className="fourd-zone-title">THERMODE ZONE-UNIFORMITY INDICATOR</div>
        <div className="fourd-zone-grid">
          <div className="zone-item ok"><span>Zone 1</span><strong>&lt; ±5°C</strong></div>
          <div className="zone-item ok"><span>Zone 2</span><strong>&lt; ±5°C</strong></div>
          <div className="zone-item alarm"><span>Zone 3</span><strong>&gt; +5°C</strong></div>
          <div className="zone-item alarm"><span>Zone 4</span><strong>&gt; +5°C</strong></div>
          <div className="zone-item ok"><span>Zone 5</span><strong>&lt; ±5°C</strong></div>
        </div>
      </div>
    </div>
  )
}

function FourDEvidenceSection({ modeId }: { modeId: string }) {
  const graphic = modeId === "non-wetting" ? <ThermalProfileEvidenceGraphic /> : <BondForceEvidenceGraphic />

  return (
    <section className="bridging-evidence viewpanel" aria-labelledby="bridging-evidence-title">
      <div className="viewhead">
        <div>
          <h2 id="bridging-evidence-title">
            {modeId === "non-wetting" ? "Thermal Profile Instability &amp; Open Circuits" : "Micro-Bump Bridging &amp; Electrical Shorts"}
          </h2>
          <p className="bridging-evidence-subtitle">
            Failure response sequence: detect, contain, restore, and validate.
          </p>
        </div>
        <span className="sensor-badge">4D PROCESS EVIDENCE</span>
      </div>
      <div className="bridging-evidence-grid">
        {graphic}
      </div>
    </section>
  )
}

export default function FailureModeDetailPage() {
  const router = useRouter()
  const pathname = usePathname()
  const params = useParams()
  const modeId = params.modeId as string
  const [activeScreen, setActiveScreen] = useState<"equipment" | "process">("equipment")
  const [driftMode, setDriftMode] = useState(false)

  const mode = useMemo(() => {
    return FAILURE_MODES.find(m => m.id === modeId)
  }, [modeId])

  if (!mode) {
    return (
      <div className="tcb-app" style={{ display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center" }}>
        <h2 style={{ fontSize: 22, marginBottom: 16 }}>Failure Mode Not Found</h2>
        <Link href="/Alarms" className="tcb-link">← Back to Alarms</Link>
      </div>
    )
  }

  return (
    <>
      <header className="tcb-header">
        <div className="tcb-shell" style={{ display: "flex", justifyContent: "space-between", alignItems: "center", width: "100%" }}>
          <div className="tcb-header-left">
            <div className="tcb-status-dot" />
            <span className="tcb-header-title">300mm Flip Chip TCB Simulator</span>
          </div>
          <nav className="tcb-nav">
            <button className="tcb-nav-btn" onClick={() => router.push("/")}>HOME</button>
            <button className={`tcb-nav-btn ${pathname === "/RecipeSequence" ? "active" : ""}`} onClick={() => router.push("/RecipeSequence")}>Recipe Sequence</button>
            <button className={`tcb-nav-btn ${pathname === "/RecipeCauseEffects" ? "active" : ""}`} onClick={() => router.push("/RecipeCauseEffects")}>Cause &amp; Effects</button>
            <button className={`tcb-nav-btn ${pathname === "/Alarms" ? "active" : ""}`} onClick={() => router.push("/Alarms")}>Alarms</button>
            <button className={`tcb-nav-btn ${pathname === "/AlarmSimulation" ? "active" : ""}`} onClick={() => router.push("/AlarmSimulation")}>Alarm Simulation</button>
          </nav>
        </div>
      </header>

      <div className="tcb-shell" style={{ padding: "24px 20px" }}>
        <div style={{ marginBottom: 20 }}>
          <Link href="/Alarms" className="tcb-link" style={{ display: "inline-block", marginBottom: 16 }}>← Back to Alarms</Link>
          <div style={{ display: "flex", alignItems: "center", gap: 16, flexWrap: "wrap" }}>
            <h1 style={{ fontSize: 24, fontWeight: 700 }}>{mode.name}</h1>
            <span className={`severity-badge ${getSeverityClass(mode.severity)}`}>
              Severity {mode.severity}
            </span>
          </div>
          <div style={{ display: "flex", gap: 24, marginTop: 12, flexWrap: "wrap" }}>
            <div style={{ fontSize: 13 }}><span style={{ color: "var(--dim)", fontWeight: 700 }}>Local Effect: </span>{mode.localEffect}</div>
            <div style={{ fontSize: 13 }}><span style={{ color: "var(--dim)", fontWeight: 700 }}>System Effect: </span>{mode.systemEffect}</div>
          </div>
        </div>

        <div className="screen-tabs">
          <button
            className={`screen-tab ${activeScreen === "equipment" ? "active" : ""}`}
            onClick={() => setActiveScreen("equipment")}
          >
            <span className="tab-icon">⚙</span>
            Equipment Screen: RTM &amp; Alarms
          </button>
          <button
            className={`screen-tab ${activeScreen === "process" ? "active" : ""}`}
            onClick={() => setActiveScreen("process")}
          >
            <span className="tab-icon">📊</span>
            Process Screen: SPC &amp; OCAP
          </button>
        </div>

        {activeScreen === "equipment" ? (
          <div className="screen-container">
            <div className="viewpanel">
              <div className="viewhead">
                <h2>Real-Time Monitoring (RTM)</h2>
              </div>
              <div className="viewbody">
                <div style={{ marginBottom: 20 }}>
                  <div className="section-header">
                    <h2 style={{ fontSize: 13 }}>Sensor Configuration</h2>
                    <div className="sensor-info">
                      <span className="sensor-badge">RTM</span>
                      <span className="sensor-badge">Load Cell</span>
                    </div>
                  </div>
                  <p style={{ fontSize: 13, lineHeight: 1.7 }}>{mode.rtm.sensor}</p>
                </div>

                <div style={{ marginBottom: 20 }}>
                  <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 12 }}>
                    <h3 style={{ color: "var(--accent-amber)", fontSize: 13, fontWeight: 700, margin: 0 }}>Visual Logic &amp; Live Trace</h3>
                    <label className="drift-toggle">
                      <input
                        type="checkbox"
                        checked={driftMode}
                        onChange={(e) => setDriftMode(e.target.checked)}
                      />
                      <span>Show Drift Event</span>
                    </label>
                  </div>
                  <div style={{ display: "grid", gridTemplateColumns: driftMode ? "1fr 1fr" : "1fr", gap: 16 }}>
                    <div style={{ padding: 16, background: "var(--bg)", border: "1px solid var(--panel-border)", borderRadius: 6, borderLeft: "3px solid var(--accent-green)" }}>
                      <h4 style={{ color: "var(--accent-green)", fontSize: 12, fontWeight: 700, marginBottom: 8 }}>Normal Condition</h4>
                      <p style={{ fontSize: 13, lineHeight: 1.7, color: "var(--text)" }}>{mode.rtm.visualLogicNormal}</p>
                    </div>
                    {driftMode && (
                      <div style={{ padding: 16, background: "var(--bg)", border: "1px solid var(--panel-border)", borderRadius: 6, borderLeft: "3px solid var(--accent-red)" }}>
                        <h4 style={{ color: "var(--accent-red)", fontSize: 12, fontWeight: 700, marginBottom: 8 }}>Drift Event</h4>
                        <p style={{ fontSize: 13, lineHeight: 1.7, color: "var(--text)" }}>{mode.rtm.visualLogicDrift}</p>
                      </div>
                    )}
                  </div>
                </div>

                <div>
                  <h3 style={{ color: "var(--accent-amber)", fontSize: 13, fontWeight: 700, marginBottom: 8 }}>Supporting Gauge Logic</h3>
                  <p style={{ fontSize: 13, lineHeight: 1.7 }}>{mode.rtm.gaugeLogic}</p>
                </div>
              </div>
            </div>

            <div className="viewpanel">
              <div className="viewhead">
                <h2>Active Alarm</h2>
              </div>
              <div className="viewbody">
                <div className="alarm-banner" style={{ marginBottom: 16 }}>
                  <div className="alarm-header">
                    <div className="alarm-id-badge">
                      <span className="alarm-id-label">ALARM ID:</span>
                      <span className="alarm-id-value">{mode.alarm.id}</span>
                    </div>
                    <div className="alarm-meta">
                      <span>ACTIVE</span>
                    </div>
                  </div>
                  <div className="alarm-message">{mode.alarm.message}</div>
                </div>
                <div className="alarm-details">
                  <div className="alarm-detail-item">
                    <strong>Trigger Condition</strong>
                    <p style={{ margin: 0, lineHeight: 1.7 }}>{mode.alarm.trigger}</p>
                  </div>
                  <div className="alarm-detail-item">
                    <strong>Interlock Behavior</strong>
                    <p style={{ margin: 0, lineHeight: 1.7 }}>{mode.alarm.interlock}</p>
                  </div>
                </div>
              </div>
            </div>

            <div className="viewpanel">
              <div className="viewhead">
                <h2>Troubleshooting &amp; Restoration</h2>
              </div>
              <div className="viewbody">
                <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(280px, 1fr))", gap: 16 }}>
                  <div style={{ padding: 16, background: "var(--bg)", border: "1px solid var(--panel-border)", borderRadius: 6 }}>
                    <h4 style={{ color: "var(--accent-amber)", fontSize: 12, fontWeight: 700, marginBottom: 8 }}>1. Visual Inspection</h4>
                    <p style={{ fontSize: 13, lineHeight: 1.7 }}>{mode.troubleshooting.visualInspection}</p>
                  </div>
                  <div style={{ padding: 16, background: "var(--bg)", border: "1px solid var(--panel-border)", borderRadius: 6 }}>
                    <h4 style={{ color: "var(--accent-amber)", fontSize: 12, fontWeight: 700, marginBottom: 8 }}>2. Test to Run</h4>
                    <p style={{ fontSize: 13, lineHeight: 1.7 }}>{mode.troubleshooting.testToRun}</p>
                  </div>
                  <div style={{ padding: 16, background: "var(--bg)", border: "1px solid var(--panel-border)", borderRadius: 6 }}>
                    <h4 style={{ color: "var(--accent-amber)", fontSize: 12, fontWeight: 700, marginBottom: 8 }}>3. Actions to Restore Condition</h4>
                    <p style={{ fontSize: 13, lineHeight: 1.7 }}>{mode.troubleshooting.restoreActions}</p>
                  </div>
                </div>
              </div>
            </div>
          </div>
        ) : (
          <div className="screen-container">
            <div className="spc-section">
              <h2 style={{ color: "var(--accent-cyan)", fontSize: 16, fontWeight: 700, marginBottom: 16 }}>Statistical Process Control (SPC)</h2>

              <div style={{ marginBottom: 20 }}>
                <h3 style={{ color: "var(--accent-amber)", fontSize: 13, fontWeight: 700, marginBottom: 8 }}>Monitored Metric</h3>
                <p style={{ fontSize: 13, lineHeight: 1.7 }}>{mode.spc.metric}</p>
              </div>

              <div style={{ marginBottom: 20 }}>
                <h3 style={{ color: "var(--accent-amber)", fontSize: 13, fontWeight: 700, marginBottom: 8 }}>I-MR Control Chart</h3>
                <div className="chart-container">
                  <SPCChart mode={mode} />
                </div>
              </div>

              <div className="spc-info">
                <div className="info-card">
                  <h4>Chart Behavior</h4>
                  <p>{mode.spc.chartBehavior}</p>
                </div>
                <div className="info-card">
                  <h4>Control Rules Triggered</h4>
                  <p>{mode.spc.rulesTriggered}</p>
                </div>
              </div>
            </div>

            <div className="ocap-section">
              <h2 style={{ color: "var(--accent-cyan)", fontSize: 16, fontWeight: 700, marginBottom: 16 }}>Out-of-Control Action Plan (OCAP)</h2>
              <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
                {mode.ocap.map((step, idx) => (
                  <div key={idx} style={{ display: "flex", gap: 16, alignItems: "flex-start" }}>
                    <div className="stage-number">{idx + 1}</div>
                    <div style={{ flex: 1 }}>
                      <h4 style={{ color: "var(--text)", fontSize: 13, fontWeight: 700, marginBottom: 4 }}>{step.step}</h4>
                      <p style={{ color: "var(--dim)", fontSize: 13, lineHeight: 1.7, margin: 0 }}>{step.action}</p>
                    </div>
                  </div>
                ))}
              </div>
            </div>

            <div className="viewpanel">
              <div className="viewhead">
                <h2>Root Cause Analysis → Hardware Recovery Mapping</h2>
              </div>
              <div className="viewbody" style={{ overflowX: "auto" }}>
                <table style={{ minWidth: 800 }}>
                  <thead>
                    <tr>
                      <th>#</th>
                      <th>Root Cause</th>
                      <th>Hardware Recovery Action</th>
                      <th>Rationale</th>
                    </tr>
                  </thead>
                  <tbody>
                    {mode.rcaMapping.map((item, idx) => (
                      <tr key={idx}>
                        <td className="step-num">{idx + 1}</td>
                        <td style={{ fontWeight: 600 }}>{item.rootCause}</td>
                        <td>{item.recoveryAction}</td>
                        <td className="note">{item.rationale}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        )}

        {(mode.id === "bridging" || mode.id === "non-wetting") && <FourDEvidenceSection modeId={mode.id} />}
      </div>
    </>
  )
}
