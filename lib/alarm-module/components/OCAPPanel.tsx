"use client";

import type { OCAPData } from '../../data/types';

interface OCAPPanelProps {
  ocapData: OCAPData;
  alarmType: string;
  selectedIndex: number;
  onSelectRootCause: (index: number) => void;
  recoveryExecuted: boolean;
  onExecuteRecovery: () => void;
  validationPassed: boolean;
  onValidationPass: () => void;
}

export default function OCAPPanel({
  ocapData,
  alarmType,
  selectedIndex,
  onSelectRootCause,
  recoveryExecuted,
  onExecuteRecovery,
  validationPassed,
  onValidationPass,
}: OCAPPanelProps) {
  const selectedCause = ocapData.rootCauses[selectedIndex] ?? ocapData.rootCauses[0];

  return (
    <div className="ocap-panel" style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      <div className="viewpanel">
        <div className="viewhead">
          <h2>OCAP Response</h2>
        </div>
        <div className="viewbody" style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          <div className="info-card">
            <h4>Containment</h4>
            <p>{ocapData.containment}</p>
          </div>

          <div className="info-card">
            <h4>Verification</h4>
            <p>{ocapData.verificationText}</p>
          </div>
        </div>
      </div>

      <div className="viewpanel">
        <div className="viewhead">
          <h2>Root Cause Options</h2>
        </div>
        <div className="viewbody" style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          <div className="cases-list">
            {ocapData.rootCauses.map((cause, index) => (
              <button
                key={cause.label}
                type="button"
                className={`case-card ${selectedIndex === index ? "selected" : ""}`}
                onClick={() => onSelectRootCause(index)}
                style={{ textAlign: "left" }}
              >
                <div className="case-id">{cause.label}</div>
                <div className="case-meta">
                  <span>{cause.gaugeValue.toFixed(1)}</span>
                  <span className={cause.gaugeStatus === "high" ? "status-red" : cause.gaugeStatus === "low" ? "status-amber" : "status-green"}>
                    {cause.gaugeStatus.toUpperCase()}
                  </span>
                </div>
              </button>
            ))}
          </div>

          {selectedCause && (
            <div className="stage-details">
              <div className="stage-content">
                <h4>{selectedCause.label}</h4>
                <p>{selectedCause.diagnosisText}</p>
                <ul style={{ margin: 0, paddingLeft: 18, display: "flex", flexDirection: "column", gap: 8 }}>
                  {selectedCause.actions.map((action) => (
                    <li key={action.text} style={{ color: action.status === "resolve" ? "var(--accent-green)" : "var(--accent-amber)" }}>
                      {action.text}
                    </li>
                  ))}
                </ul>
              </div>
            </div>
          )}
        </div>
      </div>

      <div className="viewpanel">
        <div className="viewhead">
          <h2>Recovery &amp; Validation</h2>
        </div>
        <div className="viewbody" style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          <button type="button" className="btn-advance" onClick={onExecuteRecovery} disabled={recoveryExecuted}>
            {recoveryExecuted ? "Recovery Executed" : "Execute Recovery"}
          </button>

          <div className="info-card">
            <h4>Validation Steps</h4>
            <ul style={{ margin: 0, paddingLeft: 18, display: "flex", flexDirection: "column", gap: 6 }}>
              {ocapData.validationSteps.map((step) => (
                <li key={step}>{step}</li>
              ))}
            </ul>
          </div>

          <button type="button" className="btn-confirm" onClick={onValidationPass} disabled={validationPassed}>
            {validationPassed ? "Validation Passed" : "Pass Validation"}
          </button>

          <div className="flagged-points-summary">
            <h4>{ocapData.validationBadge}</h4>
          </div>

          <div className="info-card">
            <h4>Release</h4>
            <p>{ocapData.releaseText}</p>
          </div>
        </div>
      </div>

      <div className="info-card">
        <h4>Alarm Type</h4>
        <p>{alarmType}</p>
      </div>
    </div>
  );
}
