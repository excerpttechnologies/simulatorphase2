import React, { useState, useEffect } from 'react';

interface ComponentInfo {
  stepIndex: number;
  stepId: string;
  name: string;
  temperature?: string;
  duration?: number;
  type?: string;
  description?: string;
  status?: 'idle' | 'active' | 'complete';
}

interface Props {
  simRef: React.RefObject<any>;
}

const ComponentInfoPanel: React.FC<Props> = ({ simRef }) => {
  const [info, setInfo] = useState<ComponentInfo | null>(null);
  const [elapsedTime, setElapsedTime] = useState(0);
  const [isReady, setIsReady] = useState(false);

  const resolveActiveStepIndex = () => {
    const sim = simRef.current;
    if (!sim) return null;

    try {
      const wafers = sim.wSMs;
      if (Array.isArray(wafers)) {
        const activeIndices = wafers
          .filter((sm: any) => sm && sm.launched && !sm.done && ['processing', 'moving', 'idle'].includes(sm.state))
          .map((sm: any) => Number(sm.stepIdx ?? 0))
          .filter((n: number) => Number.isFinite(n));

        if (activeIndices.length > 0) {
          return Math.max(...activeIndices);
        }
      }
    } catch (e) {
      // Fall back to the navigation step below
    }

    try {
      const navIndex = sim.getCurrentStep?.();
      if (Number.isFinite(navIndex)) return navIndex;
    } catch (e) {
      // Ignore
    }

    return null;
  };

  // ── Initialize with the active process step on mount ──
  useEffect(() => {
    const initializeStepInfo = () => {
      if (!simRef.current) return;

      const currentIndex = resolveActiveStepIndex() ?? 0;
      let currentStep = simRef.current.getCurrentStepInfo?.();

      if (!currentStep && typeof window !== 'undefined' && (window as any).ALL_STEPS) {
        currentStep = (window as any).ALL_STEPS[currentIndex];
      }

      if (currentStep) {
        updateStepInfo(currentIndex, currentStep);
        setIsReady(true);
      }
    };

    // Try to initialize immediately
    initializeStepInfo();
    
    // Also try after a short delay in case sim isn't ready yet
    const timeout = setTimeout(initializeStepInfo, 100);
    
    return () => clearTimeout(timeout);
  }, [simRef]);

  // ── Update step info from step object ──
  const updateStepInfo = (idx: number, step: any) => {
    if (!step) {
      // Try to get from ALL_STEPS if step object is missing
      try {
        if (typeof window !== 'undefined' && (window as any).ALL_STEPS) {
          const allSteps = (window as any).ALL_STEPS;
          if (allSteps[idx]) {
            step = allSteps[idx];
          }
        }
      } catch (e) {
        console.error('[ComponentInfo] Could not access ALL_STEPS');
      }
      
      if (!step) {
        setInfo(null);
        return;
      }
    }

    // Parse step info
    const tempMatch = step.name?.match(/(\d+)°C?/);
    const temperature = tempMatch ? `${tempMatch[1]}°C` : undefined;
    const cleanName = tempMatch ? step.name.replace(tempMatch[0], '').trim() : (step.name || 'Unknown');

    const newInfo: ComponentInfo = {
      stepIndex: idx,
      stepId: step.id || 'unknown',
      name: cleanName || 'Process Step',
      temperature,
      duration: step.time ?? step.duration ?? 6,
      type: getStepType(step.id),
      description: getStepDescription(step.id),
      status: 'active',
    };

    setInfo(newInfo);
    setElapsedTime(0);
  };

  // ── Listen for step changes from simulation ──
  useEffect(() => {
    const handler = (e: any) => {
      try {
        const step = e.detail?.step;
        const idx = e.detail?.index ?? e.detail?.currentIndex;
        if (step && idx !== undefined) {
          updateStepInfo(idx, step);
          setIsReady(true);
        }
      } catch (err) {
        console.error('[ComponentInfo] Event handler error:', err);
      }
    };

    window.addEventListener('sim:stepchange', handler);
    window.addEventListener('sim:flowchange', handler);

    return () => {
      window.removeEventListener('sim:stepchange', handler);
      window.removeEventListener('sim:flowchange', handler);
    };
  }, []);

  // ── Polling for real-time sync with active processing ──
  useEffect(() => {
    const pollInterval = setInterval(() => {
      if (!simRef.current) return;

      try {
        const currentIndex = resolveActiveStepIndex() ?? 0;
        let currentStep = simRef.current.getCurrentStepInfo?.();

        let stepIdxToShow = currentIndex;
        if (stepIdxToShow === null || stepIdxToShow === undefined) {
          stepIdxToShow = simRef.current.getCurrentStep?.() ?? 0;
        }

        let stepToShow = currentStep;
        try {
          if (typeof window !== 'undefined' && (window as any).ALL_STEPS) {
            const allSteps = (window as any).ALL_STEPS;
            if (allSteps[stepIdxToShow]) {
              stepToShow = allSteps[stepIdxToShow];
            }
          }
        } catch (e) {
          // Silent fail
        }

        // Update if step changed or if we have new step info
        if (stepToShow && (!info || stepIdxToShow !== info.stepIndex)) {
          updateStepInfo(stepIdxToShow, stepToShow);
        }
      } catch (e) {
        console.error('[ComponentInfo] Polling error:', e);
      }
    }, 50); // Fast polling: 50ms

    return () => clearInterval(pollInterval);
  }, [info, simRef]);

  // ── Tick elapsed time for current step ──
  useEffect(() => {
    if (!info || info.status !== 'active') return;
    const t = setInterval(() => setElapsedTime((e) => e + 0.1), 100);
    return () => clearInterval(t);
  }, [info?.stepIndex]);

  // ── Render empty state only if sim is loaded but no step yet ──
  if (!isReady || !info) {
    return (
      <div style={panelStyle}>
        <div style={emptyStyle}>
          <div style={{ fontSize: '32px', marginBottom: '12px', opacity: 0.3 }}>⚙</div>
          <div style={{ color: '#556', fontSize: '12px', textAlign: 'center' }}>
            {isReady ? 'No process information' : 'Initializing...'}
          </div>
        </div>
      </div>
    );
  }

  const progress = Math.min(elapsedTime / (info.duration || 1), 1);

  return (
    <div style={panelStyle}>
      {/* ─── Header ─── */}
      <div style={headerStyle}>
        <div
          style={{
            color: '#33ddff',
            fontSize: '11px',
            fontWeight: 'bold',
            letterSpacing: '1.5px',
          }}
        >
          COMPONENT INFO
        </div>
        <div
          style={{
            color: '#22dd66',
            fontSize: '10px',
            fontWeight: 'bold',
            padding: '2px 8px',
            background: 'rgba(34, 221, 102, 0.15)',
            borderRadius: '10px',
            border: '1px solid rgba(34, 221, 102, 0.3)',
          }}
        >
          ● LIVE
        </div>
      </div>

      {/* ─── Step number badge ─── */}
      <div
        style={{
          background: 'linear-gradient(90deg, #1a4458 0%, #0a1a25 100%)',
          padding: '12px 16px',
          borderBottom: '1px solid #1a2a3a',
        }}
      >
        <div
          style={{
            color: '#33ddff',
            fontSize: '10px',
            letterSpacing: '1px',
            marginBottom: '4px',
            opacity: 0.7,
          }}
        >
          STEP {String(info.stepIndex + 1).padStart(2, '0')}
        </div>
        <div
          style={{
            color: '#fff',
            fontSize: '16px',
            fontWeight: 'bold',
          }}
        >
          {info.name || 'Process Step'}
        </div>
      </div>

      {/* ─── Details grid ─── */}
      <div style={{ padding: '14px 16px' }}>
        {/* Type */}
        {info.type && (
          <InfoRow label="TYPE" value={info.type} valueColor="#33ddff" />
        )}

        {/* Temperature */}
        {info.temperature && (
          <InfoRow
            label="TEMPERATURE"
            value={info.temperature}
            valueColor="#ff5530"
            icon="🌡"
          />
        )}

        {/* Duration */}
        <InfoRow
          label="DURATION"
          value={`${info.duration || 0}s`}
          valueColor="#fff"
          icon="⏱"
        />

        {/* Elapsed */}
        <InfoRow
          label="ELAPSED"
          value={`${elapsedTime.toFixed(1)}s`}
          valueColor="#22dd66"
        />

        {/* Progress bar */}
        <div style={{ marginTop: '10px', marginBottom: '12px' }}>
          <div
            style={{
              color: '#556',
              fontSize: '10px',
              letterSpacing: '1px',
              marginBottom: '4px',
              display: 'flex',
              justifyContent: 'space-between',
            }}
          >
            <span>PROGRESS</span>
            <span style={{ color: '#22dd66' }}>
              {isNaN(progress) ? '0' : (progress * 100).toFixed(0)}%
            </span>
          </div>
          <div
            style={{
              height: '6px',
              background: 'rgba(0, 20, 40, 0.6)',
              borderRadius: '3px',
              overflow: 'hidden',
              border: '1px solid #1a2a3a',
            }}
          >
            <div
              style={{
                height: '100%',
                width: `${isNaN(progress) ? 0 : progress * 100}%`,
                background: 'linear-gradient(90deg, #22dd66 0%, #33ddff 100%)',
                transition: 'width 0.1s linear',
                boxShadow: '0 0 8px rgba(51, 221, 255, 0.5)',
              }}
            />
          </div>
        </div>

        {/* Description */}
        {info.description && (
          <div
            style={{
              padding: '10px 12px',
              background: 'rgba(0, 20, 40, 0.4)',
              borderLeft: '2px solid #33ddff',
              borderRadius: '4px',
              color: '#aab',
              fontSize: '12px',
              lineHeight: '1.5',
              marginTop: '8px',
            }}
          >
            {info.description}
          </div>
        )}
        
        {/* Status line */}
        <div
          style={{
            marginTop: '12px',
            padding: '8px 0',
            borderTop: '1px solid rgba(26, 42, 58, 0.5)',
            fontSize: '10px',
            color: '#22dd66',
            textAlign: 'center',
            fontWeight: 'bold',
            letterSpacing: '0.5px',
          }}
        >
          ✓ ACTIVELY MONITORING
        </div>
      </div>
    </div>
  );
};

// ── Helper component ──
function InfoRow({
  label,
  value,
  valueColor,
  icon,
}: {
  label: string;
  value: string;
  valueColor: string;
  icon?: string;
}) {
  return (
    <div
      style={{
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'center',
        padding: '6px 0',
        borderBottom: '1px solid rgba(26, 42, 58, 0.5)',
      }}
    >
      <span
        style={{
          color: '#556',
          fontSize: '10px',
          letterSpacing: '1px',
          fontWeight: 'bold',
        }}
      >
        {icon && <span style={{ marginRight: '4px' }}>{icon}</span>}
        {label}
      </span>
      <span
        style={{
          color: valueColor,
          fontSize: '13px',
          fontWeight: 'bold',
          fontFamily: 'monospace',
        }}
      >
        {value}
      </span>
    </div>
  );
}

// ── Step descriptions (customize per your process) ──
function getStepType(stepId: string): string {
  const map: Record<string, string> = {
    foup: 'INPUT',
    dehy: 'HOT PROCESS',
    dehydration: 'HOT PROCESS',
    hmds: 'VAPOR PRIME',
    chill1: 'COLD PROCESS',
    prcoat: 'COATING',
    pr_coat: 'COATING',
    pab: 'HOT PROCESS',
    chill2: 'COLD PROCESS',
    iface_out: 'TRANSFER',
    iface_in: 'TRANSFER',
    scanner: 'EXPOSURE',
    peb: 'HOT PROCESS',
    develop: 'DEVELOP',
    developer: 'DEVELOP',
    rinse: 'RINSE',
    spindry: 'DRY',
    chill3: 'COLD PROCESS',
    hardbake: 'HOT PROCESS',
    output: 'OUTPUT',
  };
  return map[stepId] || 'PROCESS';
}

function getStepDescription(stepId: string): string {
  const map: Record<string, string> = {
    foup: 'Wafer loaded from Front Opening Unified Pod cassette.',
    dehy: 'Dehydration bake at 150°C to remove moisture from wafer surface.',
    dehydration: 'Dehydration bake to remove moisture from wafer surface.',
    hmds: 'HMDS vapor prime at 110°C improves photoresist adhesion.',
    chill1: 'Cool wafer to room temperature (22°C) before coating.',
    prcoat: 'Photoresist applied via spin coating at 1500-3000 RPM.',
    pr_coat: 'Photoresist applied via spin coating at controlled RPM.',
    pab: 'Post-Apply Bake at 90°C to evaporate solvents from resist film.',
    chill2: 'Cool to 22°C to stabilize wafer temperature before scanner transfer.',
    iface_out: 'Robot transfer from track to scanner interface.',
    iface_in: 'Robot transfer from scanner interface back to track.',
    scanner: '193nm DUV ArF exposure pattern projection.',
    peb: 'Post-Exposure Bake at 120°C activates CAR resist chemistry.',
    develop: 'Developer module: TMAH puddle dissolves exposed resist.',
    developer: 'Develop liquid dissolves exposed (or unexposed) photoresist.',
    rinse: 'DI water rinse to remove developer residue and stop dissolution.',
    spindry: 'High-speed spin (4000 RPM) + N₂ purge to dry the wafer.',
    chill3: 'Final cooling stage to 22°C for hard bake preparation.',
    hardbake: 'Hard bake at 130°C to stabilize and cross-link resist pattern.',
    output: 'Wafer transferred to output FOUP for final delivery.',
  };
  return map[stepId] || 'Process step in 300mm photolithography track.';
}

// ── Styles ──
const panelStyle: React.CSSProperties = {
  width: '300px',
  background: 'rgba(8, 12, 22, 0.95)',
  border: '1px solid #1a2a3a',
  borderRadius: '8px',
  backdropFilter: 'blur(8px)',
  display: 'flex',
  flexDirection: 'column',
  maxHeight: 'calc(100vh - 200px)',
  boxShadow: '0 4px 20px rgba(0,0,0,0.4)',
  overflow: 'hidden',
};

const headerStyle: React.CSSProperties = {
  padding: '12px 14px',
  background: 'linear-gradient(90deg, #0a1525 0%, #0e1d35 100%)',
  borderBottom: '1px solid #1a2a3a',
  display: 'flex',
  justifyContent: 'space-between',
  alignItems: 'center',
};

const emptyStyle: React.CSSProperties = {
  flex: 1,
  display: 'flex',
  flexDirection: 'column',
  alignItems: 'center',
  justifyContent: 'center',
  padding: '40px 20px',
  minHeight: '200px',
};

export default ComponentInfoPanel;
