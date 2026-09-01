"use client"

import { useState } from "react"
import { useRouter, usePathname } from "next/navigation"
import AlarmModule from "@/lib/alarm-module/AlarmModule"
import "../alarm-module.css"

const ALARM_TYPES = [
  { id: "bridging", label: "Bridging" },
  { id: "non-wetting", label: "Non-Wetting" },
  { id: "die-cracking", label: "Die Cracking" },
  { id: "force-calibration", label: "Force Calibration" },
  { id: "temp-instability", label: "Temp Instability" },
]

export default function AlarmSimulationPage() {
  const router = useRouter()
  const pathname = usePathname()
  const [alarmType, setAlarmType] = useState("bridging")

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
        <div className="viewpanel" style={{ marginBottom: 16 }}>
          <div className="viewhead">
            <h2>Alarm Simulation</h2>
            <span className="status-note">Select alarm type to simulate</span>
          </div>
          <div className="viewbody">
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
              {ALARM_TYPES.map(type => (
                <button
                  key={type.id}
                  className={`pill-btn ${alarmType === type.id ? "primary" : ""}`}
                  onClick={() => setAlarmType(type.id)}
                >
                  {type.label}
                </button>
              ))}
            </div>
          </div>
        </div>

        <AlarmModule alarmType={alarmType as any} />
      </div>
    </>
  )
}
