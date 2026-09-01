"use client";

import { useState, useEffect } from 'react';
import { SPCDataPoint, SPCControlLimits, OCAPCase, AlarmType, ALARM_SIM_CONFIGS } from './types';
import { generateSPCData, calculateSPCLimits } from './mockData';
import SPCChartPanel from './components/SPCChartPanel';
import OCAPCaseManager from './components/OCAPCaseManager';

interface ProcessScreenProps {
  alarmType: AlarmType;
  activeOCAPCases: OCAPCase[];
  onCreateOCAPCase: (caseData: Partial<OCAPCase>) => void;
  onUpdateOCAPCase: (caseId: string, updates: Partial<OCAPCase>) => void;
}

const SPC_METRIC_DESCRIPTIONS: Record<AlarmType, string> = {
  bridging: 'Peak bond force (N) per die — I-MR chart with centerline, UCL/LCL',
  'non-wetting': 'Bond temperature (°C) per die — I-MR chart with centerline, UCL/LCL',
  'die-cracking': 'Touchdown impact force (N) per die — I-MR chart with centerline, UCL/LCL',
  'force-calibration': 'Force deviation (%) from setpoint — I-MR chart with centerline, UCL/LCL',
  'temp-instability': 'Thermal gradient (°C) across die footprint — I-MR chart with centerline, UCL/LCL',
};

const SECONDARY_METRIC_DESCRIPTIONS: Record<AlarmType, string> = {
  bridging: 'Post-bond bump-bridging defect rate (ppm) from AOI/electrical test',
  'non-wetting': 'Post-bond non-wetting defect rate (ppm) from C-SAT inspection',
  'die-cracking': 'Post-bond die crack/chip defect rate (ppm) from AOI/microscope',
  'force-calibration': 'Force deviation excursion rate (ppm) from load cell monitoring',
  'temp-instability': 'Post-bond non-wetting/uneven deformation defect rate (ppm) from IR inspection',
};

const SPC_CHART_TITLE: Record<AlarmType, string> = {
  bridging: 'I Chart: Peak Bond Force (N)',
  'non-wetting': 'I Chart: Bond Temperature (°C)',
  'die-cracking': 'I Chart: Touchdown Impact Force (N)',
  'force-calibration': 'I Chart: Force Deviation (%)',
  'temp-instability': 'I Chart: Thermal Gradient (°C)',
};

export default function ProcessScreen({
  alarmType,
  activeOCAPCases,
  onCreateOCAPCase,
  onUpdateOCAPCase
}: ProcessScreenProps) {
  const [spcData, setSpcData] = useState<SPCDataPoint[]>([]);
  const [controlLimits, setControlLimits] = useState<SPCControlLimits | null>(null);
  const [showOutOfControl, setShowOutOfControl] = useState(false);
  const [selectedCase, setSelectedCase] = useState<OCAPCase | null>(null);

  const config = ALARM_SIM_CONFIGS[alarmType];
  
  useEffect(() => {
    const data = generateSPCData(30, alarmType, showOutOfControl);
    setSpcData(data);
    setControlLimits(calculateSPCLimits(data));
  }, [alarmType, showOutOfControl]);
  
  useEffect(() => {
    if (!controlLimits) return;
    
    const rule1Violations = spcData.filter(point => 
      point.value > controlLimits.ucl && !point.flagged
    );
    
    const rule2Violations: SPCDataPoint[] = [];
    for (let i = 6; i < spcData.length; i++) {
      const last7 = spcData.slice(i - 6, i + 1);
      const allAbove = last7.every(p => p.value > controlLimits.centerline);
      const allBelow = last7.every(p => p.value < controlLimits.centerline);
      
      if ((allAbove || allBelow) && !spcData[i].flagged) {
        rule2Violations.push(spcData[i]);
      }
    }
    
    if (rule1Violations.length > 0 || rule2Violations.length > 0) {
      const updatedData = spcData.map(point => {
        const isRule1 = rule1Violations.some(v => v.id === point.id);
        const isRule2 = rule2Violations.some(v => v.id === point.id);
        
        if (isRule1 || isRule2) {
          return {
            ...point,
            flagged: true,
            flagReason: isRule1 ? 'Rule 1: Point beyond UCL' : 'Rule 2: 7+ consecutive points trending'
          };
        }
        return point;
      });
      
      setSpcData(updatedData);
      
      const hasOpenCase = activeOCAPCases.some(c => c.stage !== 'CLOSED');
      if (!hasOpenCase && (rule1Violations.length > 0 || rule2Violations.length > 0)) {
        onCreateOCAPCase({
          recipeId: 'RCP-TCB-001',
          toolId: 'TOOL-001',
          stage: 'CONTAINMENT',
          createdBy: 'system',
          linkedAlarmIds: [],
          linkedSpcEventId: rule1Violations[0]?.id || rule2Violations[0]?.id || '',
          auditTrail: [{
            timestamp: new Date(),
            user: 'system',
            action: 'OCAP case auto-created due to SPC rule violation',
            toStage: 'CONTAINMENT',
            details: rule1Violations.length > 0 ? 'Rule 1 violation detected' : 'Rule 2 violation detected'
          }]
        });
      }
    }
  }, [spcData, controlLimits, activeOCAPCases, onCreateOCAPCase]);
  
  const handleSelectCase = (caseObj: OCAPCase) => {
    setSelectedCase(caseObj);
  };
  
  const handleCloseCase = () => {
    setSelectedCase(null);
  };
  
  return (
    <div className="process-screen">
      <div className="process-header">
        <h1>Process Screen: SPC & OCAP Handling</h1>
        <p className="process-subtitle">
          Statistical Process Control with Out-of-Control Action Plan workflow — {config.name}
        </p>
      </div>
      
      <div className="spc-section">
        <div className="section-header">
          <h2>Statistical Process Control (SPC)</h2>
          <div className="spc-controls">
            <label className="control-toggle">
              <input
                type="checkbox"
                checked={showOutOfControl}
                onChange={(e) => setShowOutOfControl(e.target.checked)}
              />
              <span>Simulate Out-of-Control Condition</span>
            </label>
          </div>
        </div>
        
        <SPCChartPanel
          data={spcData}
          controlLimits={controlLimits}
        />
        
        <div className="spc-info">
          <div className="info-card">
            <h4>Primary Metric</h4>
            <p>{SPC_METRIC_DESCRIPTIONS[alarmType]}</p>
          </div>
          <div className="info-card">
            <h4>Secondary Metric</h4>
            <p>{SECONDARY_METRIC_DESCRIPTIONS[alarmType]}</p>
          </div>
          <div className="info-card">
            <h4>Active Rules</h4>
            <p>
              <strong>Rule 1:</strong> Single point beyond 3σ/UCL<br/>
              <strong>Rule 2:</strong> ≥{config.spcRuleConsecutivePoints} consecutive points trending one side of centerline
            </p>
          </div>
          <div className="info-card">
            <h4>Setpoint</h4>
            <p>{config.setpoint.toFixed(1)} {config.unit} — Control band: ±{config.controlBandPercent}%</p>
          </div>
        </div>
      </div>
      
      <div className="ocap-section">
        <div className="section-header">
          <h2>Out-of-Control Action Plan (OCAP) Cases</h2>
          <div className="case-summary">
            <span className="case-count">
              {activeOCAPCases.length} active case{activeOCAPCases.length !== 1 ? 's' : ''}
            </span>
          </div>
        </div>
        
        {activeOCAPCases.length === 0 ? (
          <div className="no-cases">
            <p>No active OCAP cases. Cases will auto-create when SPC rule violations are detected.</p>
          </div>
        ) : (
          <div className="ocap-cases-container">
            <div className="cases-list">
              {activeOCAPCases.map(caseObj => (
                <button
                  key={caseObj.id}
                  className={`case-card ${selectedCase?.id === caseObj.id ? 'selected' : ''}`}
                  onClick={() => handleSelectCase(caseObj)}
                >
                  <div className="case-id">Case #{caseObj.id}</div>
                  <div className={`case-stage stage-${caseObj.stage.toLowerCase().replace('_', '-')}`}>
                    {caseObj.stage.replace('_', ' ')}
                  </div>
                  <div className="case-meta">
                    <span>{caseObj.recipeId}</span>
                    <span>{new Date(caseObj.createdAt).toLocaleDateString()}</span>
                  </div>
                </button>
              ))}
            </div>
            
            {selectedCase && (
              <div className="case-detail">
                <OCAPCaseManager
                  ocapCase={selectedCase}
                  onUpdate={(updates) => onUpdateOCAPCase(selectedCase.id, updates)}
                  onClose={handleCloseCase}
                />
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
