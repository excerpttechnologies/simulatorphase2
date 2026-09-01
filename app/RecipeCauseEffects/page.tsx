"use client"

import { useState, useMemo } from "react"
import { useRouter, usePathname } from "next/navigation"
import { CAUSE_EFFECTS } from "@/lib/data/causeEffects"
import "../alarm-module.css"

export default function RecipeCauseEffectsPage() {
  const router = useRouter()
  const pathname = usePathname()
  const [searchTerm, setSearchTerm] = useState("")
  const [sortColumn, setSortColumn] = useState<string | null>(null)
  const [sortDirection, setSortDirection] = useState<"asc" | "desc">("asc")

  const handleSort = (column: string) => {
    if (sortColumn === column) {
      setSortDirection(sortDirection === "asc" ? "desc" : "asc")
    } else {
      setSortColumn(column)
      setSortDirection("asc")
    }
  }

  const filteredAndSorted = useMemo(() => {
    let result = CAUSE_EFFECTS.filter(row => {
      const search = searchTerm.toLowerCase()
      return (
        row.parameter.toLowerCase().includes(search) ||
        row.processStep.toLowerCase().includes(search) ||
        row.effects.increase.toLowerCase().includes(search) ||
        row.effects.decrease.toLowerCase().includes(search) ||
        row.note.toLowerCase().includes(search)
      )
    })
    if (sortColumn) {
      result.sort((a, b) => {
        const getValue = (row: typeof a) => {
          if (sortColumn === "increase") return row.effects.increase
          if (sortColumn === "decrease") return row.effects.decrease
          return row[sortColumn as keyof typeof row]
        }
        const aVal = getValue(a)
        const bVal = getValue(b)
        if (aVal < bVal) return sortDirection === "asc" ? -1 : 1
        if (aVal > bVal) return sortDirection === "asc" ? 1 : -1
        return 0
      })
    }
    return result
  }, [searchTerm, sortColumn, sortDirection])

  const SortableHeader = ({ column, children }: { column: string; children: React.ReactNode }) => (
    <th
      className="sortable"
      onClick={() => handleSort(column)}
      style={{ whiteSpace: "nowrap" }}
    >
      {children} {sortColumn === column && (sortDirection === "asc" ? "↑" : "↓")}
    </th>
  )

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

      <div className="tcb-shell" style={{ padding: "24px 20px", maxWidth: 1800 }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 20, flexWrap: "wrap", gap: 16 }}>
          <div>
            <h1 style={{ fontSize: 22, fontWeight: 700, marginBottom: 4 }}>TCB Recipe Parameters — Cause &amp; Effect Reference</h1>
            <p style={{ color: "var(--dim)", fontSize: 13 }}>Parameter impact analysis for process troubleshooting and optimization</p>
          </div>
          <input
            type="text"
            className="ce-search"
            placeholder="Search parameters, effects, or notes..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
          />
        </div>

        <div className="viewpanel" style={{ overflowX: "auto" }}>
          <table style={{ minWidth: 1200 }}>
            <thead>
              <tr>
                <SortableHeader column="parameter">Parameter</SortableHeader>
                <SortableHeader column="processStep">Step</SortableHeader>
                <SortableHeader column="increase">Effect of INCREASE (▲)</SortableHeader>
                <SortableHeader column="decrease">Effect of DECREASE (▼)</SortableHeader>
                <SortableHeader column="note">Note</SortableHeader>
              </tr>
            </thead>
            <tbody>
              {filteredAndSorted.map((row) => (
                <tr key={row.id}>
                  <td className="param-name">{row.parameter}</td>
                  <td className="step-num">{row.processStep}</td>
                  <td>{row.effects.increase}</td>
                  <td>{row.effects.decrease}</td>
                  <td className="note">{row.note}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <div className="viewpanel" style={{ marginTop: 16 }}>
          <div className="viewbody" style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            <p style={{ fontSize: 12, lineHeight: 1.6, color: "var(--dim)", margin: 0 }}>
              <strong style={{ color: "var(--accent-amber)" }}>Note:</strong> Effects describe typical failure/quality mechanisms observed in production TCB processes at fine pitch (≤ 55 µm).
            </p>
            <span style={{ color: "var(--dim)", fontSize: 12, whiteSpace: "nowrap" }}>Showing {filteredAndSorted.length} of {CAUSE_EFFECTS.length} parameters</span>
          </div>
        </div>
      </div>
    </>
  )
}
