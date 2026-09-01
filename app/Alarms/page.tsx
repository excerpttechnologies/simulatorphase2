"use client"

import { useRouter, usePathname } from "next/navigation"
import Link from "next/link"
import { FAILURE_MODES } from "@/lib/data/failureModes"
import "../alarm-module.css"

const getSeverityClass = (severity: number): string => {
  if (severity >= 10) return "severity-critical"
  if (severity >= 9) return "severity-high"
  if (severity >= 7) return "severity-medium"
  return "severity-low"
}

export default function AlarmsPage() {
  const router = useRouter()
  const pathname = usePathname()

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

      <div className="tcb-shell" style={{ padding: "24px 20px", maxWidth: 1600 }}>
        <div style={{ marginBottom: 24 }}>
          <h1 style={{ fontSize: 22, fontWeight: 700, marginBottom: 4 }}>Alarms &amp; Failure Modes (FMEA)</h1>
          <p style={{ color: "var(--dim)", fontSize: 13 }}>Real-time monitoring, statistical process control, and out-of-control action plans for critical TCB failure modes</p>
        </div>

        <div className="viewpanel" style={{ overflowX: "auto", marginBottom: 24 }}>
          <table style={{ minWidth: 900 }}>
            <thead>
              <tr>
                <th>Severity</th>
                <th>Failure Mode</th>
                <th>Local Effect</th>
                <th>System Effect</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {FAILURE_MODES.map(mode => (
                <tr key={mode.id}>
                  <td>
                    <span className={`severity-badge ${getSeverityClass(mode.severity)}`}>
                      {mode.severity}
                    </span>
                  </td>
                  <td style={{ color: "var(--accent-cyan)", fontWeight: 600 }}>{mode.name}</td>
                  <td>{mode.localEffect}</td>
                  <td>{mode.systemEffect}</td>
                  <td>
                    <Link href={`/Alarms/${mode.id}`} className="btn-view-details">
                      View Details →
                    </Link>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(400px, 1fr))", gap: 20 }}>
          <div className="viewpanel">
            <div className="viewhead">
              <h2>About This Module</h2>
            </div>
            <div className="viewbody">
              <p style={{ lineHeight: 1.7, fontSize: 13 }}>
                Each failure mode detail page contains two interactive screens:{" "}
                <strong style={{ color: "var(--accent-amber)" }}>Equipment Screen</strong> (Real-Time Monitoring, Active Alarms, and Troubleshooting) and{" "}
                <strong style={{ color: "var(--accent-amber)" }}>Process Screen</strong> (Statistical Process Control charts and Out-of-Control Action Plans).
              </p>
            </div>
          </div>
          <div className="viewpanel">
            <div className="viewhead">
              <h2>Severity Scale</h2>
            </div>
            <div className="viewbody">
              <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                {[
                  { sev: "10", label: "Critical — Direct safety/product failure", cls: "severity-critical" },
                  { sev: "9", label: "High — Significant quality/reliability impact", cls: "severity-high" },
                  { sev: "7–8", label: "Medium — Moderate process degradation", cls: "severity-medium" },
                  { sev: "1–6", label: "Low — Minor process variation", cls: "severity-low" },
                ].map(item => (
                  <div key={item.sev} style={{ display: "flex", alignItems: "center", gap: 12, fontSize: 13 }}>
                    <span className={`severity-badge ${item.cls}`}>{item.sev}</span>
                    <span>{item.label}</span>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      </div>
    </>
  )
}
