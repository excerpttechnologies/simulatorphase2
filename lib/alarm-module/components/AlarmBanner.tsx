"use client"
import { AlarmEvent } from '../types';

interface AlarmBannerProps {
  alarm: AlarmEvent;
  onAcknowledge: (alarmId: string) => void;
}

export default function AlarmBanner({ alarm, onAcknowledge }: AlarmBannerProps) {
  return (
    <div className="alarm-banner-container">
      <div className="alarm-banner">
        <div className="alarm-header">
          <div className="alarm-id-badge">
            <span className="alarm-id-label">ALARM ID:</span>
            <span className="alarm-id-value monospace">{alarm.alarmId}</span>
          </div>
          <div className="alarm-meta">
            <span className="monospace">Die: {alarm.dieId}</span>
            <span className="monospace">Site: {alarm.siteId}</span>
            <span className="monospace">Recipe: {alarm.recipeId}</span>
            <span className="monospace">Peak Force: {alarm.peakForce.toFixed(2)} N</span>
          </div>
        </div>
        <div className="alarm-message">{alarm.message}</div>
        <div className="alarm-details">
          <div className="alarm-detail-item">
            <strong>Trigger Condition:</strong>
            <span>Force feedback &gt; {(45.0 * 1.10).toFixed(1)} N (110% of setpoint), sustained &gt; 100 ms, during peak-reflow dwell phase</span>
          </div>
          <div className="alarm-detail-item">
            <strong>Interlock Behavior:</strong>
            <span>Bond cycle HOLD/ABORT · Head blocked from advancing · Equipment state → PAUSE · Tool will not index to next site until acknowledged · Repeated trips escalate to E-STOP</span>
          </div>
          <div className="alarm-detail-item">
            <strong>Timestamp:</strong>
            <span className="monospace">{alarm.timestamp.toLocaleString()}</span>
          </div>
        </div>
        {!alarm.acknowledged ? (
          <button onClick={() => onAcknowledge(alarm.id)} className="btn-acknowledge">Acknowledge Alarm</button>
        ) : (
          <div className="alarm-acknowledged">
            <span className="check-icon">✓</span>
            Acknowledged by {alarm.acknowledgedBy} at {alarm.acknowledgedAt?.toLocaleTimeString()}
          </div>
        )}
      </div>
    </div>
  );
}
