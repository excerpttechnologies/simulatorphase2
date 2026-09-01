'use client'

import dynamic from 'next/dynamic'

// Dynamic import to avoid SSR issues with Three.js
const FlipChipBonder = dynamic(
  () => import('@/components/FlipChipBonder'),
  { ssr: false }
)

export default function BonderDemoPage() {
  return (
    <div style={{ width: '100vw', height: '100vh', margin: 0, padding: 0 }}>
      <div style={{ 
        position: 'absolute', 
        top: '20px', 
        left: '20px', 
        zIndex: 10,
        background: 'rgba(0, 0, 0, 0.7)',
        color: 'white',
        padding: '15px',
        borderRadius: '8px',
        fontFamily: 'monospace',
        fontSize: '14px',
        maxWidth: '350px'
      }}>
        <h2 style={{ margin: '0 0 10px 0', fontSize: '18px' }}>🤖 Flip-Chip Bonder Demo</h2>
        <div style={{ lineHeight: '1.6' }}>
          <p style={{ margin: '5px 0' }}><strong>Robot 1 (Left):</strong> Pickup & 180° Flip</p>
          <p style={{ margin: '5px 0' }}><strong>Robot 2 (Right):</strong> Flux Dip & Place</p>
          <hr style={{ margin: '10px 0', border: 'none', borderTop: '1px solid #444' }} />
          <p style={{ margin: '5px 0', fontSize: '12px' }}>
            <strong>Controls:</strong><br />
            • Rotate: Left-click + drag<br />
            • Pan: Right-click + drag<br />
            • Zoom: Scroll wheel
          </p>
          <hr style={{ margin: '10px 0', border: 'none', borderTop: '1px solid #444' }} />
          <p style={{ margin: '5px 0', fontSize: '11px', color: '#aaa' }}>
            Watch the complete process:<br />
            Pickup → Flip → Handoff → Flux Dip → Place
          </p>
        </div>
      </div>
      <FlipChipBonder />
    </div>
  )
}
