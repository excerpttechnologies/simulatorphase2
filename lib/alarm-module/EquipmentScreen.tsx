"use client";

import { useState, useEffect } from 'react';
import { 
  AlarmEvent, 
  ForceTelemetry, 
  EquipmentState, 
  ChecklistItem,
  AlarmType,
  ALARM_SIM_CONFIGS,
} from './types';
import { 
  generateGoldenForceProfile, 
  generateLiveForceTrace
} from './mockData';
import ForceTraceChart from './components/ForceTraceChart';
import AlarmBanner from './components/AlarmBanner';
import TroubleshootingChecklist from './components/TroubleshootingChecklist';

interface EquipmentScreenProps {
  alarmType: AlarmType;
  currentState: EquipmentState;
  onStateChange: (newState: EquipmentState) => void;
  activeAlarms: AlarmEvent[];
  onAlarmAcknowledge: (alarmId: string) => void;
  onChecklistUpdate: (alarmId: string, checklist: ChecklistItem[]) => void;
}

const SENSOR_BADGES: Record<AlarmType, string[]> = {
  bridging: ['Z-Axis Load Cell', 'Multi-Zone Thermocouple Array'],
  'non-wetting': ['Bond Thermocouple Array', 'IR Thermal Camera'],
  'die-cracking': ['Z-Axis Load Cell', 'Z-Axis Velocity Sensor'],
  'force-calibration': ['Z-Axis Load Cell', 'Reference Load Cell'],
  'temp-instability': ['IR Thermal Camera', 'Multi-Zone Thermocouple Array'],
};

const DRIFT_LABELS: Record<AlarmType, string> = {
  bridging: 'Simulate Drift Event (Force Overshoot)',
  'non-wetting': 'Simulate Drift Event (Temperature Drop)',
  'die-cracking': 'Simulate Drift Event (Impact Force Spike)',
  'force-calibration': 'Simulate Drift Event (Calibration Drift)',
  'temp-instability': 'Simulate Drift Event (Thermal Gradient Instability)',
};

const GAUGE_LABELS: Record<AlarmType, string> = {
  bridging: 'Peak Bond Force',
  'non-wetting': 'Bond Temperature',
  'die-cracking': 'Touchdown Impact Force',
  'force-calibration': 'Force Deviation',
  'temp-instability': 'Thermal Gradient',
};

export default function EquipmentScreen({
  alarmType,
  currentState,
  onStateChange,
  activeAlarms,
  onAlarmAcknowledge,
  onChecklistUpdate
}: EquipmentScreenProps) {
  const [showDrift, setShowDrift] = useState(false);
  const [goldenProfile] = useState<ForceTelemetry[]>(generateGoldenForceProfile(alarmType));
  const [liveTrace, setLiveTrace] = useState<ForceTelemetry[]>([]);
  const [peakForce, setPeakForce] = useState(0);
  const [zPosition, setZPosition] = useState(50.0);
  const [consecutiveTripCount, setConsecutiveTripCount] = useState(0);
  
  const config = ALARM_SIM_CONFIGS[alarmType];
  const setpoint = config.setpoint;
  const upperControlLimit = setpoint * (1 + config.controlBandPercent / 100);
  const lowerControlLimit = setpoint * (1 - config.controlBandPercent / 100);
  const amberThreshold = setpoint * (config.amberThresholdPercent / 100);
  const redThreshold = setpoint * (config.redThresholdPercent / 100);
  
  useEffect(() => {
    const interval = setInterval(() => {
      const newTrace = generateLiveForceTrace(alarmType, showDrift);
      setLiveTrace(newTrace);
      
      const peakHoldPoints = newTrace.filter(p => p.phase === 'peak-hold');
      if (peakHoldPoints.length > 0) {
        const maxForce = Math.max(...peakHoldPoints.map(p => p.force));
        setPeakForce(maxForce);
        
        if (maxForce >= redThreshold && currentState === 'RUN') {
          setConsecutiveTripCount(prev => prev + 1);
          onStateChange('PAUSE');
        }
      }
      
      if (newTrace.length > 0) {
        setZPosition(newTrace[newTrace.length - 1].position);
      }
    }, 3000);
    
    return () => clearInterval(interval);
  }, [alarmType, showDrift, currentState, redThreshold, onStateChange]);
  
  useEffect(() => {
    if (consecutiveTripCount >= 3 && currentState !== 'E-STOP') {
      onStateChange('E-STOP');
    }
  }, [consecutiveTripCount, currentState, onStateChange]);
  
  const getForceGaugeColor = () => {
    if (peakForce >= redThreshold) return 'red';
    if (peakForce >= amberThreshold) return 'amber';
    return 'green';
  };
  
  const handleAcknowledge = (alarmId: string) => {
    onAlarmAcknowledge(alarmId);
    if (currentState === 'PAUSE') {
      onStateChange('HOLD');
    }
  };
  
  const handleResetToRun = () => {
    const allAlarmsAcknowledged = activeAlarms.every(a => a.acknowledged);
    const allChecklistsComplete = activeAlarms.every(alarm => 
      alarm.checklistStatus.every(item => item.completed)
    );
    
    if (allAlarmsAcknowledged && allChecklistsComplete) {
      setConsecutiveTripCount(0);
      onStateChange('RUN');
    } else {
      alert('All alarms must be acknowledged and checklists completed before returning to RUN');
    }
  };
  
  return (
    <div className="equipment-screen">
      <div className={`equipment-state-banner state-${currentState.toLowerCase()}`}>
        <div className="state-indicator">
          <span className="state-label">Equipment State:</span>
          <span className="state-value">{currentState}</span>
          {consecutiveTripCount > 0 && (
            <span className="trip-count">({consecutiveTripCount} consecutive trips)</span>
          )}
        </div>
        {currentState !== 'RUN' && (
          <div className="state-actions">
            {currentState === 'E-STOP' && (
              <span className="estop-warning">⚠ REQUIRES SUPERVISOR/MAINTENANCE RESET</span>
            )}
            {(currentState === 'HOLD' || currentState === 'PAUSE') && activeAlarms.length === 0 && (
              <button onClick={handleResetToRun} className="btn-reset-run">
                Return to RUN
              </button>
            )}
          </div>
        )}
      </div>
      
      {activeAlarms.map(alarm => (
        <AlarmBanner
          key={alarm.id}
          alarm={alarm}
          onAcknowledge={handleAcknowledge}
        />
      ))}
      
      <div className="rtm-section">
        <div className="section-header">
          <h2>Real-Time Monitoring (RTM)</h2>
          <div className="sensor-info">
            {SENSOR_BADGES[alarmType].map(badge => (
              <span key={badge} className="sensor-badge">{badge}</span>
            ))}
          </div>
        </div>
        
        <div className="rtm-controls">
          <label className="drift-toggle">
            <input
              type="checkbox"
              checked={showDrift}
              onChange={(e) => setShowDrift(e.target.checked)}
            />
            <span>{DRIFT_LABELS[alarmType]}</span>
          </label>
        </div>
        
        <div className="force-trace-container">
          <ForceTraceChart
            goldenProfile={goldenProfile}
            liveTrace={liveTrace}
            upperControlLimit={upperControlLimit}
            lowerControlLimit={lowerControlLimit}
            setpoint={setpoint}
          />
        </div>
        
        <div className="digital-gauges">
          <div className={`gauge gauge-force gauge-${getForceGaugeColor()}`}>
            <div className="gauge-label">{GAUGE_LABELS[alarmType]}</div>
            <div className="gauge-value monospace">{peakForce.toFixed(2)} {config.unit}</div>
            <div className="gauge-limits">
              <span>Amber: {amberThreshold.toFixed(1)} {config.unit}</span>
              <span>Red: {redThreshold.toFixed(1)} {config.unit}</span>
            </div>
          </div>
          
          <div className="gauge gauge-position">
            <div className="gauge-label">Z-Position</div>
            <div className="gauge-value monospace">{zPosition.toFixed(3)} mm</div>
            <div className="gauge-limits">
              <span>Range: 0.0 – 50.0 mm</span>
            </div>
          </div>
          
          <div className="gauge gauge-setpoint">
            <div className="gauge-label">Setpoint</div>
            <div className="gauge-value monospace">{setpoint.toFixed(1)} {config.unit}</div>
            <div className="gauge-limits">
              <span>Band: ±{config.controlBandPercent}%</span>
              <span>({lowerControlLimit.toFixed(1)} – {upperControlLimit.toFixed(1)} {config.unit})</span>
            </div>
          </div>
        </div>
      </div>
      
      {activeAlarms.length > 0 && (
        <div className="troubleshooting-section">
          <h2>Troubleshooting & Restoration</h2>
          {activeAlarms.map(alarm => (
            <TroubleshootingChecklist
              key={alarm.id}
              alarm={alarm}
              onUpdate={(checklist) => onChecklistUpdate(alarm.id, checklist)}
            />
          ))}
        </div>
      )}
    </div>
  );
}
