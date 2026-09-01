"use client"
import { useState } from 'react';
import { OCAPCase, OCAPStage, RootCause, RecoveryAction } from '../types';

interface OCAPCaseManagerProps {
  ocapCase: OCAPCase;
  onUpdate: (updates: Partial<OCAPCase>) => void;
  onClose: () => void;
}

export default function OCAPCaseManager({ ocapCase, onUpdate, onClose }: OCAPCaseManagerProps) {
  const [editMode, setEditMode] = useState<OCAPStage | null>(null);
  
  const stages: OCAPStage[] = [
    'CONTAINMENT',
    'METROLOGY_VERIFICATION',
    'ROOT_CAUSE_ANALYSIS',
    'HARDWARE_RECOVERY',
    'DISPOSITION',
    'VALIDATION'
  ];
  
  const currentStageIndex = stages.indexOf(ocapCase.stage);
  
  const canAdvance = (stage: OCAPStage): boolean => {
    switch (stage) {
      case 'CONTAINMENT':
        return ocapCase.containment?.holdConfirmedAt !== undefined &&
               ocapCase.containment.quarantinedLotIds.length > 0;
      case 'METROLOGY_VERIFICATION':
        return ocapCase.metrologyVerification?.trueProcessShiftConfirmed === true;
      case 'ROOT_CAUSE_ANALYSIS':
        return ocapCase.rootCauseAnalysis?.approvedBy !== undefined;
      case 'HARDWARE_RECOVERY':
        return ocapCase.hardwareRecovery?.completedBy !== undefined;
      case 'DISPOSITION':
        return ocapCase.disposition?.inspectedUnits === ocapCase.disposition?.totalUnits;
      case 'VALIDATION':
        return ocapCase.validation?.validatedBy !== undefined;
      default:
        return false;
    }
  };
  
  const handleAdvanceStage = () => {
    if (currentStageIndex < stages.length - 1 && canAdvance(ocapCase.stage)) {
      const nextStage = stages[currentStageIndex + 1];
      onUpdate({
        stage: nextStage,
        auditTrail: [
          ...ocapCase.auditTrail,
          {
            timestamp: new Date(),
            user: 'current-user',
            action: `Advanced to ${nextStage}`,
            fromStage: ocapCase.stage,
            toStage: nextStage,
            details: `Stage ${ocapCase.stage} requirements met`
          }
        ]
      });
      setEditMode(null);
    }
  };
  
  const handleCloseCase = () => {
    if (canAdvance('VALIDATION')) {
      onUpdate({
        stage: 'CLOSED',
        auditTrail: [
          ...ocapCase.auditTrail,
          {
            timestamp: new Date(),
            user: 'current-user',
            action: 'Case closed successfully',
            fromStage: 'VALIDATION',
            toStage: 'CLOSED',
            details: 'All validation criteria met'
          }
        ]
      });
    }
  };
  
  return (
    <div className="ocap-case-manager">
      <div className="case-header">
        <div>
          <h3>OCAP Case #{ocapCase.id}</h3>
          <p className="case-meta">
            Created: {new Date(ocapCase.createdAt).toLocaleString()} by {ocapCase.createdBy}
          </p>
          <p className="case-meta">
            Recipe: {ocapCase.recipeId} | Tool: {ocapCase.toolId}
          </p>
        </div>
        <button onClick={onClose} className="btn-close">✕</button>
      </div>
      
      {/* Stage Progress Indicator */}
      <div className="stage-progress">
        {stages.map((stage, idx) => (
          <div 
            key={stage}
            className={stage-indicator }
          >
            <div className="stage-number">{idx + 1}</div>
            <div className="stage-name">{stage.replace('_', ' ')}</div>
          </div>
        ))}
      </div>
      
      {/* Current Stage Details */}
      <div className="stage-details">
        {ocapCase.stage === 'CONTAINMENT' && (
          <ContainmentStage 
            ocapCase={ocapCase} 
            onUpdate={onUpdate}
            editMode={editMode === 'CONTAINMENT'}
            setEditMode={() => setEditMode(editMode === 'CONTAINMENT' ? null : 'CONTAINMENT')}
          />
        )}
        
        {ocapCase.stage === 'METROLOGY_VERIFICATION' && (
          <MetrologyVerificationStage 
            ocapCase={ocapCase} 
            onUpdate={onUpdate}
            editMode={editMode === 'METROLOGY_VERIFICATION'}
            setEditMode={() => setEditMode(editMode === 'METROLOGY_VERIFICATION' ? null : 'METROLOGY_VERIFICATION')}
          />
        )}
        
        {ocapCase.stage === 'ROOT_CAUSE_ANALYSIS' && (
          <RCAStage 
            ocapCase={ocapCase} 
            onUpdate={onUpdate}
            editMode={editMode === 'ROOT_CAUSE_ANALYSIS'}
            setEditMode={() => setEditMode(editMode === 'ROOT_CAUSE_ANALYSIS' ? null : 'ROOT_CAUSE_ANALYSIS')}
          />
        )}
        
        {ocapCase.stage === 'HARDWARE_RECOVERY' && (
          <HardwareRecoveryStage 
            ocapCase={ocapCase} 
            onUpdate={onUpdate}
            editMode={editMode === 'HARDWARE_RECOVERY'}
            setEditMode={() => setEditMode(editMode === 'HARDWARE_RECOVERY' ? null : 'HARDWARE_RECOVERY')}
          />
        )}
        
        {ocapCase.stage === 'DISPOSITION' && (
          <DispositionStage 
            ocapCase={ocapCase} 
            onUpdate={onUpdate}
            editMode={editMode === 'DISPOSITION'}
            setEditMode={() => setEditMode(editMode === 'DISPOSITION' ? null : 'DISPOSITION')}
          />
        )}
        
        {ocapCase.stage === 'VALIDATION' && (
          <ValidationStage 
            ocapCase={ocapCase} 
            onUpdate={onUpdate}
            editMode={editMode === 'VALIDATION'}
            setEditMode={() => setEditMode(editMode === 'VALIDATION' ? null : 'VALIDATION')}
          />
        )}
      </div>
      
      {/* Action Buttons */}
      <div className="case-actions">
        {ocapCase.stage !== 'CLOSED' && (
          <>
            {canAdvance(ocapCase.stage) ? (
              <>
                {ocapCase.stage === 'VALIDATION' ? (
                  <button onClick={handleCloseCase} className="btn-advance">
                    Close Case
                  </button>
                ) : (
                  <button onClick={handleAdvanceStage} className="btn-advance">
                    Advance to {stages[currentStageIndex + 1]?.replace('_', ' ')}
                  </button>
                )}
              </>
            ) : (
              <div className="advance-blocked">
                ⚠ Complete all required actions before advancing
              </div>
            )}
          </>
        )}
      </div>
      
      {/* Audit Trail */}
      <div className="audit-trail">
        <h4>Audit Trail</h4>
        <div className="audit-entries">
          {ocapCase.auditTrail.map((entry, idx) => (
            <div key={idx} className="audit-entry">
              <span className="audit-timestamp monospace">
                {new Date(entry.timestamp).toLocaleString()}
              </span>
              <span className="audit-user">{entry.user}</span>
              <span className="audit-action">{entry.action}</span>
              <span className="audit-details">{entry.details}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

// Stage sub-components
function ContainmentStage({ ocapCase, onUpdate, editMode, setEditMode }: any) {
  const [quarantineLots, setQuarantineLots] = useState(
    ocapCase.containment?.quarantinedLotIds?.join(', ') || ''
  );
  
  const handleConfirmHold = () => {
    onUpdate({
      containment: {
        ...ocapCase.containment,
        holdConfirmedAt: new Date(),
        quarantinedLotIds: quarantineLots.split(',').map((s: string) => s.trim()).filter(Boolean),
        suspendedRecipeIds: [ocapCase.recipeId]
      }
    });
    setEditMode();
  };
  
  return (
    <div className="stage-content">
      <h4>Stage 1: Containment</h4>
      <p>Place bonder in HOLD; quarantine all die/lots since last in-control sample; suspend recipe starts.</p>
      
      {editMode ? (
        <div className="stage-form">
          <label>
            Quarantined Lot IDs (comma-separated):
            <textarea
              value={quarantineLots}
              onChange={(e) => setQuarantineLots(e.target.value)}
              placeholder="LOT-001, LOT-002, LOT-003..."
              rows={3}
            />
          </label>
          <div className="form-actions">
            <button onClick={handleConfirmHold} className="btn-confirm">
              Confirm HOLD & Quarantine
            </button>
            <button onClick={setEditMode} className="btn-cancel">Cancel</button>
          </div>
        </div>
      ) : (
        <div className="stage-summary">
          {ocapCase.containment?.holdConfirmedAt ? (
            <>
              <div className="summary-item">
                <strong>HOLD Confirmed:</strong> {new Date(ocapCase.containment.holdConfirmedAt).toLocaleString()}
              </div>
              <div className="summary-item">
                <strong>Quarantined Lots:</strong> {ocapCase.containment.quarantinedLotIds.join(', ')}
              </div>
              <div className="summary-item completed">✓ Containment Complete</div>
            </>
          ) : (
            <button onClick={setEditMode} className="btn-edit">
              Start Containment
            </button>
          )}
        </div>
      )}
    </div>
  );
}

function MetrologyVerificationStage({ ocapCase, onUpdate, editMode, setEditMode }: any) {
  const [gaugeRR, setGaugeRR] = useState('');
  const [confirmed, setConfirmed] = useState(false);
  const [notes, setNotes] = useState('');
  
  const handleSubmit = () => {
    onUpdate({
      metrologyVerification: {
        verifiedAt: new Date(),
        verifiedBy: 'current-user',
        gaugeRR: parseFloat(gaugeRR),
        trueProcessShiftConfirmed: confirmed,
        notes
      }
    });
    setEditMode();
  };
  
  return (
    <div className="stage-content">
      <h4>Stage 2: Metrology Verification</h4>
      <p>Verify force actuator/load cell against independent reference; confirm gauge R&R; rule out measurement error.</p>
      
      {editMode ? (
        <div className="stage-form">
          <label>
            Gauge R&R Value:
            <input
              type="number"
              step="0.01"
              value={gaugeRR}
              onChange={(e) => setGaugeRR(e.target.value)}
              placeholder="0.00"
            />
          </label>
          <label className="checkbox-label">
            <input
              type="checkbox"
              checked={confirmed}
              onChange={(e) => setConfirmed(e.target.checked)}
            />
            <span>Confirm TRUE PROCESS SHIFT (not measurement error)</span>
          </label>
          <label>
            Verification Notes:
            <textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              rows={3}
            />
          </label>
          <div className="form-actions">
            <button onClick={handleSubmit} className="btn-confirm" disabled={!confirmed || !gaugeRR}>
              Submit Verification
            </button>
            <button onClick={setEditMode} className="btn-cancel">Cancel</button>
          </div>
        </div>
      ) : (
        <div className="stage-summary">
          {ocapCase.metrologyVerification?.verifiedAt ? (
            <>
              <div className="summary-item">
                <strong>Verified:</strong> {new Date(ocapCase.metrologyVerification.verifiedAt).toLocaleString()}
              </div>
              <div className="summary-item">
                <strong>Gauge R&R:</strong> {ocapCase.metrologyVerification.gaugeRR}
              </div>
              <div className="summary-item">
                <strong>Process Shift Confirmed:</strong> {ocapCase.metrologyVerification.trueProcessShiftConfirmed ? 'YES' : 'NO'}
              </div>
              {ocapCase.metrologyVerification.notes && (
                <div className="summary-item">
                  <strong>Notes:</strong> {ocapCase.metrologyVerification.notes}
                </div>
              )}
              <div className="summary-item completed">✓ Metrology Verification Complete</div>
            </>
          ) : (
            <button onClick={setEditMode} className="btn-edit">
              Start Metrology Verification
            </button>
          )}
        </div>
      )}
    </div>
  );
}

function RCAStage({ ocapCase, onUpdate, editMode, setEditMode }: any) {
  const [template, setTemplate] = useState<'five-why' | 'fishbone'>('five-why');
  const [selectedCauses, setSelectedCauses] = useState<RootCause[]>([]);
  const [documentation, setDocumentation] = useState('');
  
  const toggleCause = (cause: RootCause) => {
    setSelectedCauses(prev =>
      prev.includes(cause) ? prev.filter(c => c !== cause) : [...prev, cause]
    );
  };
  
  const handleApprove = () => {
    onUpdate({
      rootCauseAnalysis: {
        template,
        selectedRootCauses: selectedCauses,
        documentation,
        approvedBy: 'current-user',
        approvedAt: new Date()
      }
    });
    setEditMode();
  };
  
  return (
    <div className="stage-content">
      <h4>Stage 3: Root Cause Analysis</h4>
      <p>Structured RCA covering force-actuator calibration, regulator wear, incoming variation, and thermal contribution.</p>
      
      {editMode ? (
        <div className="stage-form">
          <label>
            RCA Template:
            <select value={template} onChange={(e) => setTemplate(e.target.value as any)}>
              <option value="five-why">5-Why</option>
              <option value="fishbone">Fishbone</option>
            </select>
          </label>
          
          <div className="root-causes">
            <h5>Select Root Cause(s):</h5>
            {ROOT_CAUSE_MAPPING.map(mapping => (
              <label key={mapping.rootCause} className="checkbox-label">
                <input
                  type="checkbox"
                  checked={selectedCauses.includes(mapping.rootCause)}
                  onChange={() => toggleCause(mapping.rootCause)}
                />
                <span>{mapping.action}</span>
              </label>
            ))}
          </div>
          
          <label>
            RCA Documentation:
            <textarea
              value={documentation}
              onChange={(e) => setDocumentation(e.target.value)}
              placeholder="Document your 5-Why analysis or fishbone diagram findings..."
              rows={6}
            />
          </label>
          
          <div className="form-actions">
            <button 
              onClick={handleApprove} 
              className="btn-confirm"
              disabled={selectedCauses.length === 0 || !documentation}
            >
              Approve RCA
            </button>
            <button onClick={setEditMode} className="btn-cancel">Cancel</button>
          </div>
        </div>
      ) : (
        <div className="stage-summary">
          {ocapCase.rootCauseAnalysis?.approvedAt ? (
            <>
              <div className="summary-item">
                <strong>Template:</strong> {ocapCase.rootCauseAnalysis.template}
              </div>
              <div className="summary-item">
                <strong>Root Causes:</strong>
                <ul>
                  {ocapCase.rootCauseAnalysis.selectedRootCauses.map((cause: RootCause) => (
                    <li key={cause}>{ROOT_CAUSE_MAPPING.find(m => m.rootCause === cause)?.action}</li>
                  ))}
                </ul>
              </div>
              <div className="summary-item">
                <strong>Approved By:</strong> {ocapCase.rootCauseAnalysis.approvedBy} at {new Date(ocapCase.rootCauseAnalysis.approvedAt).toLocaleString()}
              </div>
              <div className="summary-item completed">✓ RCA Complete</div>
            </>
          ) : (
            <button onClick={setEditMode} className="btn-edit">
              Start Root Cause Analysis
            </button>
          )}
        </div>
      )}
    </div>
  );
}

function HardwareRecoveryStage({ ocapCase, onUpdate, editMode, setEditMode }: any) {
  const suggestedActions = ocapCase.rootCauseAnalysis?.selectedRootCauses.map((cause: RootCause) =>
    ROOT_CAUSE_MAPPING.find(m => m.rootCause === cause)
  ) || [];
  
  const [notes, setNotes] = useState('');
  
  const handleComplete = () => {
    onUpdate({
      hardwareRecovery: {
        selectedActions: suggestedActions,
        completedAt: new Date(),
        completedBy: 'current-user',
        notes
      }
    });
    setEditMode();
  };
  
  return (
    <div className="stage-content">
      <h4>Stage 4: Hardware Recovery</h4>
      <p>Implement recovery actions based on RCA findings.</p>
      
      {editMode ? (
        <div className="stage-form">
          <div className="recovery-actions">
            <h5>Recovery Actions (from RCA):</h5>
            {suggestedActions.map((action: any, idx: number) => (
              <div key={idx} className="recovery-action-card">
                <div className="action-text">{action.action}</div>
                <div className="action-rationale">{action.rationale}</div>
                {action.isPartialMitigation && (
                  <div className="partial-warning">
                    ⚠ Partial mitigation only - see rationale
                  </div>
                )}
              </div>
            ))}
          </div>
          
          <label>
            Recovery Notes:
            <textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="Document actions taken, parts replaced, calibration results..."
              rows={4}
            />
          </label>
          
          <div className="form-actions">
            <button onClick={handleComplete} className="btn-confirm">
              Mark Recovery Complete
            </button>
            <button onClick={setEditMode} className="btn-cancel">Cancel</button>
          </div>
        </div>
      ) : (
        <div className="stage-summary">
          {ocapCase.hardwareRecovery?.completedAt ? (
            <>
              <div className="summary-item">
                <strong>Completed By:</strong> {ocapCase.hardwareRecovery.completedBy} at {new Date(ocapCase.hardwareRecovery.completedAt).toLocaleString()}
              </div>
              {ocapCase.hardwareRecovery.notes && (
                <div className="summary-item">
                  <strong>Notes:</strong> {ocapCase.hardwareRecovery.notes}
                </div>
              )}
              <div className="summary-item completed">✓ Hardware Recovery Complete</div>
            </>
          ) : (
            <button onClick={setEditMode} className="btn-edit">
              Start Hardware Recovery
            </button>
          )}
        </div>
      )}
    </div>
  );
}

function DispositionStage({ ocapCase, onUpdate, editMode, setEditMode }: any) {
  const totalUnits = ocapCase.containment?.quarantinedLotIds.length * 25 || 100; // Assume 25 units per lot
  const [inspected, setInspected] = useState(0);
  const [passed, setPassed] = useState(0);
  const [scrapped, setScrapped] = useState(0);
  
  const handleSubmit = () => {
    onUpdate({
      disposition: {
        totalUnits,
        inspectedUnits: inspected,
        passedUnits: passed,
        scrappedUnits: scrapped,
        reworkedUnits: 0, // Bridging has no rework path
        completedAt: new Date()
      }
    });
    setEditMode();
  };
  
  return (
    <div className="stage-content">
      <h4>Stage 5: Disposition</h4>
      <p>100% AOI + electrical test on all quarantined units. Bridging/shorting has NO rework path - units are Pass or Scrap only.</p>
      
      {editMode ? (
        <div className="stage-form">
          <div className="disposition-stats">
            <label>
              Total Units to Inspect:
              <input type="number" value={totalUnits} disabled />
            </label>
            <label>
              Inspected Units:
              <input 
                type="number" 
                value={inspected} 
                onChange={(e) => setInspected(parseInt(e.target.value) || 0)}
                max={totalUnits}
              />
            </label>
            <label>
              Passed Units:
              <input 
                type="number" 
                value={passed} 
                onChange={(e) => setPassed(parseInt(e.target.value) || 0)}
                max={inspected}
              />
            </label>
            <label>
              Scrapped Units:
              <input 
                type="number" 
                value={scrapped} 
                onChange={(e) => setScrapped(parseInt(e.target.value) || 0)}
                max={inspected}
              />
            </label>
          </div>
          
          <div className="disposition-warning">
            ⚠ Severity-10 defect: ALL quarantined units must be dispositioned before advancing
          </div>
          
          <div className="form-actions">
            <button 
              onClick={handleSubmit} 
              className="btn-confirm"
              disabled={inspected !== totalUnits || (passed + scrapped) !== inspected}
            >
              Submit Disposition
            </button>
            <button onClick={setEditMode} className="btn-cancel">Cancel</button>
          </div>
        </div>
      ) : (
        <div className="stage-summary">
          {ocapCase.disposition?.completedAt ? (
            <>
              <div className="summary-item">
                <strong>Inspected:</strong> {ocapCase.disposition.inspectedUnits} / {ocapCase.disposition.totalUnits}
              </div>
              <div className="summary-item">
                <strong>Passed:</strong> {ocapCase.disposition.passedUnits}
              </div>
              <div className="summary-item">
                <strong>Scrapped:</strong> {ocapCase.disposition.scrappedUnits}
              </div>
              <div className="summary-item completed">✓ Disposition Complete</div>
            </>
          ) : (
            <button onClick={setEditMode} className="btn-edit">
              Start Disposition
            </button>
          )}
        </div>
      )}
    </div>
  );
}

function ValidationStage({ ocapCase, onUpdate, editMode, setEditMode }: any) {
  const requiredLots = 3;
  const [completedLots, setCompletedLots] = useState<string[]>([]);
  const [allWithinBand, setAllWithinBand] = useState(false);
  const [zeroDefects, setZeroDefects] = useState(false);
  const [noViolations, setNoViolations] = useState(false);
  
  const handleComplete = () => {
    onUpdate({
      validation: {
        requiredLots,
        completedLots,
        allWithinControlBand: allWithinBand,
        zeroBridgingDefects: zeroDefects,
        noSpcViolations: noViolations,
        validatedAt: new Date(),
        validatedBy: 'current-user'
      }
    });
    setEditMode();
  };
  
  return (
    <div className="stage-content">
      <h4>Stage 6: Validation</h4>
      <p>Run 3-5 verification lots at corrected setpoint. Success = force within band, zero bridging defects, no SPC violations.</p>
      
      {editMode ? (
        <div className="stage-form">
          <label>
            Completed Verification Lots (comma-separated):
            <input
              type="text"
              placeholder="LOT-2001, LOT-2002, LOT-2003"
              onChange={(e) => setCompletedLots(e.target.value.split(',').map(s => s.trim()).filter(Boolean))}
            />
          </label>
          
          <div className="validation-criteria">
            <h5>Validation Criteria:</h5>
            <label className="checkbox-label">
              <input
                type="checkbox"
                checked={allWithinBand}
                onChange={(e) => setAllWithinBand(e.target.checked)}
              />
              <span>All peak forces within control band</span>
            </label>
            <label className="checkbox-label">
              <input
                type="checkbox"
                checked={zeroDefects}
                onChange={(e) => setZeroDefects(e.target.checked)}
              />
              <span>Zero bridging defects across all verification lots</span>
            </label>
            <label className="checkbox-label">
              <input
                type="checkbox"
                checked={noViolations}
                onChange={(e) => setNoViolations(e.target.checked)}
              />
              <span>No SPC rule violations in verification window</span>
            </label>
          </div>
          
          <div className="form-actions">
            <button 
              onClick={handleComplete} 
              className="btn-confirm"
              disabled={completedLots.length < requiredLots || !allWithinBand || !zeroDefects || !noViolations}
            >
              Complete Validation
            </button>
            <button onClick={setEditMode} className="btn-cancel">Cancel</button>
          </div>
        </div>
      ) : (
        <div className="stage-summary">
          {ocapCase.validation?.validatedAt ? (
            <>
              <div className="summary-item">
                <strong>Lots Validated:</strong> {ocapCase.validation.completedLots.join(', ')}
              </div>
              <div className="summary-item">
                <strong>All Criteria Met:</strong> ✓
              </div>
              <div className="summary-item">
                <strong>Validated By:</strong> {ocapCase.validation.validatedBy} at {new Date(ocapCase.validation.validatedAt).toLocaleString()}
              </div>
              <div className="summary-item completed">✓ Validation Complete - Ready to Close Case</div>
            </>
          ) : (
            <button onClick={setEditMode} className="btn-edit">
              Start Validation
            </button>
          )}
        </div>
      )}
    </div>
  );
}
