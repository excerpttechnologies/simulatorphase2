import React from 'react';

interface Props {
  enabled: boolean;
  onToggle: () => void;
}

const ComponentInfoToggle: React.FC<Props> = ({ enabled, onToggle }) => {
  return (
    <button
      onClick={onToggle}
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: '6px',
        padding: '7px 14px',
        background: enabled
          ? 'linear-gradient(135deg, #22dd66 0%, #00ee99 100%)'
          : 'rgba(255,255,255,0.95)',
        color: enabled ? '#000' : '#0055cc',
        border: enabled ? '1px solid #00ee99' : '1px solid rgba(0,80,180,0.20)',
        borderRadius: '8px',
        cursor: 'pointer',
        fontSize: '10px',
        fontWeight: 700,
        letterSpacing: '1.2px',
        transition: 'all 0.2s ease',
        boxShadow: enabled 
          ? '0 2px 12px rgba(34, 221, 102, 0.4)' 
          : '0 2px 8px rgba(0,80,180,0.10)',
      }}
    >
      <span
        style={{
          width: '8px',
          height: '8px',
          borderRadius: '50%',
          background: enabled ? '#000' : '#0055cc',
          boxShadow: enabled ? '0 0 6px rgba(34, 221, 102, 0.8)' : 'none',
          animation: enabled ? 'pulse 1s infinite' : 'none',
        }}
      />
      <span>COMPONENT INFO</span>
      <span
        style={{
          fontSize: '9px',
          fontWeight: 600,
        }}
      >
        {enabled ? '● LIVE' : 'OFF'}
      </span>
      <style>{`
        @keyframes pulse {
          0%, 100% { opacity: 1; }
          50% { opacity: 0.6; }
        }
      `}</style>
    </button>
  );
};

export default ComponentInfoToggle;
