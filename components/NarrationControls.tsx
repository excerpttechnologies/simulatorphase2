import React, { useState, useEffect } from 'react';

interface Props {
  simRef: React.RefObject<any>;
}

const NarrationControls: React.FC<Props> = ({ simRef }) => {
  const [enabled, setEnabled] = useState(true);
  const [volume, setVolume] = useState(0.85);
  const [rate, setRate] = useState(0.95);
  const [showSettings, setShowSettings] = useState(false);
  
  // ── Init from sim once available ──
  useEffect(() => {
    const check = setInterval(() => {
      if (simRef.current?.narration) {
        setEnabled(simRef.current.narration.isEnabled());
        clearInterval(check);
      }
    }, 100);
    return () => clearInterval(check);
  }, [simRef]);

  // ── Allow external controls (speed changes) to update the button state ──
  useEffect(() => {
    const onNarrationEnabled = (event: Event) => {
      const detail = (event as CustomEvent<{ enabled: boolean }>).detail;
      if (typeof detail?.enabled === 'boolean') {
        setEnabled(detail.enabled);
      }
    };

    window.addEventListener('sim:narration-enabled', onNarrationEnabled as EventListener);
    // Listen for global simulation reset so we can clear any local caches and sync UI
    const onSimReset = () => {
      const sim = simRef.current;
      if (sim?.narration) {
        try { sim.narration.stop?.(); } catch (e) {}
        try { sim.narration.reset?.(); } catch (e) {}
        try { setEnabled(sim.narration.isEnabled()); } catch (e) {}
      }
      // Ensure UI shows speed 1 if sim reset
      try { if (sim) { sim.speed = 1; window.dispatchEvent(new CustomEvent('sim:speed', { detail: { speed: 1 } })); } } catch (e) {}
    };
    window.addEventListener('sim:reset', onSimReset as EventListener);
    return () => window.removeEventListener('sim:narration-enabled', onNarrationEnabled as EventListener);
  }, []);
  
  const handleToggle = () => {
    const newState = !enabled;
    setEnabled(newState);
    simRef.current?.narration?.setEnabled(newState);
  };
  
  const handleVolume = (v: number) => {
    setVolume(v);
    simRef.current?.narration?.setVolume(v);
  };
  
  const handleRate = (r: number) => {
    setRate(r);
    simRef.current?.narration?.setRate(r);
  };
  
  return (
    <div style={{ position: 'relative', display: 'inline-block' }}>
      {/* ── Toggle button ── */}
      <button
        onClick={handleToggle}
        onContextMenu={(e) => {
          e.preventDefault();
          setShowSettings(!showSettings);
        }}
        title="Click to toggle narration. Right-click for settings."
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: '6px',
          padding: '7px 14px',
          background: enabled
            ? 'linear-gradient(135deg, #0066ee 0%, #0099ff 100%)'
            : 'rgba(255,255,255,0.95)',
          color: enabled ? '#fff' : '#0055cc',
          border: enabled ? '1px solid #0099ff' : '1px solid rgba(0,80,180,0.20)',
          borderRadius: '8px',
          cursor: 'pointer',
          fontSize: '10px',
          fontWeight: 700,
          letterSpacing: '1.2px',
          transition: 'all 0.2s ease',
          boxShadow: enabled 
            ? '0 2px 12px rgba(0, 102, 238, 0.4)' 
            : '0 2px 8px rgba(0,80,180,0.10)',
        }}
      >
        <span style={{
          fontSize: '14px',
        }}>
          {enabled ? '🔊' : '🔇'}
        </span>
        <span>NARRATION</span>
        <span style={{ fontSize: '9px', opacity: 0.85, fontWeight: 600 }}>
          {enabled ? '● ON' : 'OFF'}
        </span>
        <span
          onClick={(e) => {
            e.stopPropagation();
            setShowSettings(!showSettings);
          }}
          style={{
            marginLeft: '4px',
            padding: '0 4px',
            cursor: 'pointer',
            opacity: 0.7,
          }}
        >
          ⚙
        </span>
      </button>
      
      {/* ── Settings popup ── */}
      {showSettings && (
        <div style={{
          position: 'absolute',
          top: 'calc(100% + 6px)',
          right: 0,
          width: '240px',
          background: 'rgba(8, 12, 22, 0.97)',
          border: '1px solid #33ddff',
          borderRadius: '8px',
          padding: '14px',
          boxShadow: '0 4px 20px rgba(0, 0, 0, 0.5)',
          zIndex: 200,
        }}>
          <div style={{
            color: '#33ddff',
            fontSize: '11px',
            fontWeight: 'bold',
            letterSpacing: '1.5px',
            marginBottom: '12px',
          }}>
            NARRATION SETTINGS
          </div>
          
          {/* Volume slider */}
          <div style={{ marginBottom: '12px' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '4px' }}>
              <span style={{ color: '#aab', fontSize: '11px' }}>VOLUME</span>
              <span style={{ color: '#fff', fontSize: '11px' }}>{Math.round(volume * 100)}%</span>
            </div>
            <input
              type="range"
              min="0"
              max="1"
              step="0.05"
              value={volume}
              onChange={(e) => handleVolume(parseFloat(e.target.value))}
              style={{ width: '100%', accentColor: '#33ddff' }}
            />
          </div>
          
          {/* Speed slider */}
          <div style={{ marginBottom: '12px' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '4px' }}>
              <span style={{ color: '#aab', fontSize: '11px' }}>SPEED</span>
              <span style={{ color: '#fff', fontSize: '11px' }}>{rate.toFixed(2)}×</span>
            </div>
            <input
              type="range"
              min="0.5"
              max="1.5"
              step="0.05"
              value={rate}
              onChange={(e) => handleRate(parseFloat(e.target.value))}
              style={{ width: '100%', accentColor: '#33ddff' }}
            />
          </div>
          
          {/* Test button */}
          <button
            onClick={() => {
              simRef.current?.narration?.speak(
                'Testing narration. This is your avatar voice.',
                'high'
              );
            }}
            style={{
              width: '100%',
              padding: '6px',
              background: '#1a4458',
              color: '#fff',
              border: '1px solid #33ddff',
              borderRadius: '4px',
              cursor: 'pointer',
              fontSize: '11px',
              fontWeight: 'bold',
              letterSpacing: '0.5px',
            }}
          >
            ▶ TEST VOICE
          </button>
        </div>
      )}
    </div>
  );
};

export default NarrationControls;
