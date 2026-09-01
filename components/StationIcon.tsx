"use client"
import dynamic from 'next/dynamic'
import React from 'react'

const Foup3D = dynamic(() => import('./Foup3D'), { ssr: false })

type Props = { stationId?: string; active?: boolean; animating?: boolean }

export default function StationIcon({ stationId, active, animating }: Props) {
  if (stationId && stationId.toLowerCase().includes('foup')) {
    return <Foup3D active={active} animating={animating} />
  }

  return (
    <div style={{ width: '112px', height: '112px', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
      <svg width="88" height="88" viewBox="0 0 88 88" xmlns="http://www.w3.org/2000/svg">
        <circle cx="44" cy="44" r="38" fill="#c8a060" stroke="#4b3b2a" strokeWidth="3" />
        <circle cx="44" cy="44" r="18" fill="#f5d27a" opacity="0.6" />
      </svg>
    </div>
  )
}
