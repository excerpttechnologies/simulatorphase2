     'use client'

import { useRef, useState, useMemo, useEffect } from 'react'
import { Canvas, useFrame } from '@react-three/fiber'
import { OrbitControls, Environment, ContactShadows } from '@react-three/drei'
import * as THREE from 'three'
import { RecipeStateMachine } from '@/lib/RecipeStateMachine'

// ── Flip-chip TCB process narration (per-step spoken commentary) ──
// Mirrors the 300mm Flip-Chip Thermo-Compression Bonding walkthrough.
// One line per animation step, read aloud via the browser's speech synthesis.
const STEP_COMMENTARY = [
  'Moving the pick and place arm to the wafer pickup position.',
  'Lowering the pick arm onto the target die on the bumped wafer.',
  'The pick arm lifts the die clear of the dicing tape.',
  'Carrying the die sideways to the flip station.',
  'The flip station rotates a full one hundred eighty degrees, flipping the die.',
  'Moving the die toward the handoff position, aligned over the bonding head.',
  'The bonding head travels over to receive the flipped die.',
  'The bonding head lowers and vacuum picks up the flipped die.',
  'Lifting the die off and moving it over to the flux film plate.',
  'Lowering the die toward the flux film.',
  'The bumps dip into the liquid flux, forming a thin wetting layer.',
  'Retracting the die clear of the flux plate.',
  'Moving the die into position above the target bond site.',
  'Lowering the die onto the substrate bond site, ramping up to full bond force.',
  'A rapid heat pulse melts the solder tip, forming the intermetallic bond.',
  'Cooling air locks the joint solid, then the head releases the die and retracts.',
]

// Speaks a given step's commentary once. Returns immediately; narration is fire-and-forget.
function speakCommentary(index) {
  if (typeof window === 'undefined' || !('speechSynthesis' in window)) return
  const text = STEP_COMMENTARY[index]
  if (!text) return
  try {
    const u = new SpeechSynthesisUtterance(text)
    u.rate = 1.02
    u.pitch = 1.0
    u.volume = 1.0
    window.speechSynthesis.speak(u)
  } catch (e) {
    // Speech synthesis is best-effort; never break the animation.
  }
}

const materials = {
  frame: new THREE.MeshStandardMaterial({ color: '#2b2d31', metalness: 0.6, roughness: 0.5 }),
  rail: new THREE.MeshStandardMaterial({ color: '#d8dce1', metalness: 0.9, roughness: 0.2 }),
  carriage: new THREE.MeshStandardMaterial({ color: '#8a8f98', metalness: 0.85, roughness: 0.3 }),
  motor: new THREE.MeshStandardMaterial({ color: '#1a1a1a', metalness: 0.5, roughness: 0.4 }),
  chrome: new THREE.MeshStandardMaterial({ color: '#eef0f2', metalness: 1, roughness: 0.08 }),
  rotary: new THREE.MeshStandardMaterial({ color: '#4a4d54', metalness: 0.8, roughness: 0.3 }),
  tool: new THREE.MeshStandardMaterial({ color: '#c9cdd3', metalness: 0.7, roughness: 0.25 }),
  nozzle: new THREE.MeshStandardMaterial({ color: '#111214', metalness: 0.3, roughness: 0.7 }),
  arm: new THREE.MeshStandardMaterial({ color: '#5a5e66', metalness: 0.8, roughness: 0.35 }),
  finger: new THREE.MeshStandardMaterial({ color: '#222', metalness: 0.4, roughness: 0.6 }),
  base: new THREE.MeshStandardMaterial({ color: '#1c1d20', metalness: 0.5, roughness: 0.6 }),
  stage: new THREE.MeshStandardMaterial({ color: '#3a3c40', metalness: 0.6, roughness: 0.4 }),
  bond: new THREE.MeshStandardMaterial({ color: '#e8c766', metalness: 0.6, roughness: 0.35 }),
  chip: new THREE.MeshStandardMaterial({ color: '#d4af37', metalness: 1, roughness: 0.25 }),
  underside: new THREE.MeshStandardMaterial({ color: '#8a6d1f', metalness: 0.9, roughness: 0.3 }),
  flux: new THREE.MeshStandardMaterial({ color: '#4a90e2', metalness: 0.3, roughness: 0.6, transparent: true, opacity: 0.7 }),
  fluxContainer: new THREE.MeshStandardMaterial({ color: '#556', metalness: 0.6, roughness: 0.4 }),
}

function WaferStage({ position }) {
  const chips = useMemo(() => Array.from({ length: 25 }, (_, index) => {
    const coordinate = index % 5
    return [(coordinate - 2) * 0.16, (Math.floor(index / 5) - 2) * 0.16]
  }), [])
  return (
    <group position={position}>
      <mesh material={materials.stage} position={[0, -0.05, 0]}>
        <cylinderGeometry args={[0.9, 0.9, 0.1, 48]} />
      </mesh>
      {chips.map(([x, z], index) => (
        <mesh key={index} material={materials.chip} position={[x, 0.005, z]}>
          <boxGeometry args={[0.09, 0.01, 0.09]} />
        </mesh>
      ))}
    </group>
  )
}

function FluxStation({ position }) {
  return (
    <group position={position}>
      {/* Flux container base */}
      <mesh material={materials.fluxContainer} position={[0, -0.08, 0]}>
        <boxGeometry args={[0.35, 0.15, 0.25]} />
      </mesh>
      {/* Inner tray */}
      <mesh material={materials.base} position={[0, -0.02, 0]}>
        <boxGeometry args={[0.3, 0.02, 0.2]} />
      </mesh>
      {/* Flux liquid surface */}
      <mesh material={materials.flux} position={[0, 0.01, 0]}>
        <boxGeometry args={[0.28, 0.02, 0.18]} />
      </mesh>
      {/* Corner posts */}
      {[[-0.15, -0.1], [0.15, -0.1], [-0.15, 0.1], [0.15, 0.1]].map(([x, z], i) => (
        <mesh key={i} material={materials.motor} position={[x, -0.08, z]}>
          <cylinderGeometry args={[0.015, 0.015, 0.15, 8]} />
        </mesh>
      ))}
    </group>
  )
}

function BondBaseStage({ position }) {
  return (
    <group position={[position[0], position[1] + 0.2, position[2]]}>
      <mesh material={materials.base} position={[0, -0.1, 0]}><boxGeometry args={[1.3, 0.15, 1.3]} /></mesh>
      <mesh material={materials.bond} position={[0, -0.02, 0]}><boxGeometry args={[1, 0.03, 1]} /></mesh>
      {[[-0.45, -0.45], [0.45, -0.45], [-0.45, 0.45], [0.45, 0.45]].map(([x, z], index) => (
        <mesh key={index} material={materials.motor} position={[x, 0, z]}><boxGeometry args={[0.04, 0.04, 0.04]} /></mesh>
      ))}
    </group>
  )
}

function SkingRobot({ carriageRef, zRef, toolRef, basePosition }) {
  return (
    <group position={basePosition}>
      <mesh material={materials.frame} position={[0, 1.3, 0]}><boxGeometry args={[2, 0.08, 0.08]} /></mesh>
      <mesh material={materials.rail} position={[0, 1.25, 0]}><boxGeometry args={[1.9, 0.03, 0.05]} /></mesh>
      <mesh material={materials.motor} position={[-1, 1.3, 0]}><cylinderGeometry args={[0.09, 0.09, 0.18, 16]} rotation={[0, 0, Math.PI / 2]} /></mesh>
      <group ref={carriageRef} position={[0, 1.25, 0]}>
        <mesh material={materials.carriage}><boxGeometry args={[0.16, 0.12, 0.14]} /></mesh>
        <group ref={zRef}>
          <mesh material={materials.rail} position={[0, -0.35, 0]}><boxGeometry args={[0.03, 0.7, 0.03]} /></mesh>
          <mesh material={materials.motor} position={[0.08, -0.05, 0]}><cylinderGeometry args={[0.05, 0.05, 0.12, 16]} /></mesh>
          <group ref={toolRef} position={[0, -0.7, 0]}>
            <mesh material={materials.rotary}><cylinderGeometry args={[0.06, 0.06, 0.08, 20]} /></mesh>
            <mesh material={materials.tool} position={[0, -0.08, 0]}><cylinderGeometry args={[0.03, 0.03, 0.1, 16]} /></mesh>
            <mesh material={materials.nozzle} position={[0, -0.15, 0]}><cylinderGeometry args={[0.012, 0.012, 0.06, 12]} /></mesh>
          </group>
        </group>
      </group>
    </group>
  )
}

function ColrightRobot({ carriageRef, zRef, gripperRef, basePosition }) {
  return (
    <group position={basePosition}>
      <mesh material={materials.frame} position={[0, 1.3, 0]}><boxGeometry args={[2, 0.08, 0.08]} /></mesh>
      <mesh material={materials.rail} position={[0, 1.25, 0]}><boxGeometry args={[1.9, 0.03, 0.05]} /></mesh>
      <mesh material={materials.motor} position={[-1, 1.3, 0]}><cylinderGeometry args={[0.09, 0.09, 0.18, 16]} rotation={[0, 0, Math.PI / 2]} /></mesh>
      <group ref={carriageRef} position={[0, 1.25, 0]}>
        <mesh material={materials.carriage}><boxGeometry args={[0.16, 0.12, 0.14]} /></mesh>
        <group ref={zRef}>
          <mesh material={materials.rail} position={[0, -0.3, 0]}><boxGeometry args={[0.03, 0.6, 0.03]} /></mesh>
          <mesh material={materials.motor} position={[0.08, -0.05, 0]}><cylinderGeometry args={[0.05, 0.05, 0.12, 16]} /></mesh>
          <group position={[0, -0.6, 0]}>
            <mesh material={materials.rotary}><sphereGeometry args={[0.05, 16, 16]} /></mesh>
            <mesh material={materials.arm} position={[0, -0.08, 0]}><boxGeometry args={[0.04, 0.1, 0.04]} /></mesh>
            <group ref={gripperRef} position={[0, -0.15, 0]}>
              <mesh material={materials.finger} position={[-0.03, 0, 0]}><boxGeometry args={[0.015, 0.06, 0.03]} /></mesh>
              <mesh material={materials.finger} position={[0.03, 0, 0]}><boxGeometry args={[0.015, 0.06, 0.03]} /></mesh>
            </group>
          </group>
        </group>
      </group>
    </group>
  )
}

// Robot 2 - Industrial Gantry for Flux Dipping (SKING-style)
function Robot2({ carriageRef, zRef, pickPointRef, basePosition }) {
  return (
    <group position={basePosition}>
      {/* Main horizontal rail */}
      <mesh material={materials.frame} position={[0, 1.4, 0]}>
        <boxGeometry args={[2.2, 0.09, 0.09]} />
      </mesh>
      {/* Linear guide rail */}
      <mesh material={materials.rail} position={[0, 1.35, 0]}>
        <boxGeometry args={[2.1, 0.04, 0.06]} />
      </mesh>
      {/* Drive motor */}
      <mesh material={materials.motor} position={[-1.1, 1.4, 0]}>
        <cylinderGeometry args={[0.1, 0.1, 0.2, 16]} rotation={[0, 0, Math.PI / 2]} />
      </mesh>
      
      {/* Moving carriage */}
      <group ref={carriageRef} position={[0, 1.35, 0]}>
        {/* Carriage body */}
        <mesh material={materials.carriage}>
          <boxGeometry args={[0.18, 0.14, 0.16]} />
        </mesh>
        {/* Mounting brackets */}
        <mesh material={materials.arm} position={[0, -0.08, 0.06]}>
          <boxGeometry args={[0.14, 0.04, 0.04]} />
        </mesh>
        <mesh material={materials.arm} position={[0, -0.08, -0.06]}>
          <boxGeometry args={[0.14, 0.04, 0.04]} />
        </mesh>
        
        {/* Z-axis assembly */}
        <group ref={zRef} position={[0, 0, 0]}>
          {/* Vertical rail */}
          <mesh material={materials.rail} position={[0, -0.4, 0]}>
            <boxGeometry args={[0.04, 0.8, 0.04]} />
          </mesh>
          {/* Z-axis motor */}
          <mesh material={materials.motor} position={[0.09, -0.1, 0]}>
            <cylinderGeometry args={[0.06, 0.06, 0.14, 16]} />
          </mesh>
          
          {/* Tool head at bottom of Z-axis */}
          <group position={[0, -0.8, 0]}>
            {/* Rotary joint */}
            <mesh material={materials.rotary}>
              <cylinderGeometry args={[0.065, 0.065, 0.1, 24]} />
            </mesh>
            {/* Tool shaft */}
            <mesh material={materials.tool} position={[0, -0.1, 0]}>
              <cylinderGeometry args={[0.035, 0.035, 0.12, 16]} />
            </mesh>
            {/* Vacuum nozzle */}
            <mesh material={materials.nozzle} position={[0, -0.18, 0]}>
              <cylinderGeometry args={[0.015, 0.015, 0.08, 12]} />
            </mesh>
            {/* Pick point (attachment anchor for chip) */}
            <group ref={pickPointRef} position={[0, -0.22, 0]} />
          </group>
        </group>
      </group>
    </group>
  )
}

function Chip({ chipRef, flipped, position }) {
  return (
    <group ref={chipRef} position={position}>
      <mesh material={flipped ? materials.underside : materials.chip}>
        <boxGeometry args={[0.09, 0.01, 0.09]} />
      </mesh>
    </group>
  )
}

function MachineBase() {
  const platformMaterial = new THREE.MeshStandardMaterial({ color: '#777d84', metalness: 0.65, roughness: 0.38 })
  return <mesh material={platformMaterial} position={[0, -0.15, 0]} receiveShadow castShadow><boxGeometry args={[6.4, 0.3, 2.4]} /></mesh>
}

// Enhanced Motion System with proper robot mechanics and chip attachment
function MotionSystem() {
  // Robot 1 (SKING - pickup and flip)
  const skingCarriage = useRef()
  const skingZ = useRef()
  const skingTool = useRef()
  
  // Robot 2 (COLRIGHT - handoff, flux, placement)
  const colCarriage = useRef()
  const colZ = useRef()
  const colPickPoint = useRef()
  
  const chipRef = useRef()
  const [flipped, setFlipped] = useState(false)
  
  // Animation state machine
  const stateMachine = useRef(null)
  const currentStep = useRef(0)
  const animStartTime = useRef(0)
  const animDuration = useRef(1.0)
  // Tracks the last step we narrated for, so each step's commentary is spoken once.
  const lastAnnouncedStep = useRef(-1)
  
  // Chip ownership state
  const chipOwner = useRef('none') // 'none', 'robot1', 'handoff', 'robot2', 'board'
  const chipAttachmentPoint = useRef(null)
  
  // Waypoints (model-local coordinates)
  const WAYPOINTS = {
    WAFER_PICKUP: { x: -1.6, y: 0.005, z: -0.5 },
    FLIP_STATION: { x: -0.5, y: 0.5, z: -0.5 },
    HANDOFF: { x: 0.4, y: 0.5, z: 0 },
    FLUX_APPROACH: { x: 0.4, y: 0.4, z: 0.5 },
    FLUX_DIP: { x: 0.4, y: 0.02, z: 0.5 },
    BOND_TARGET: { x: 1.6, y: 0.2, z: 0.5 },
  }
  
  const lerp = (start, end, t) => start + (end - start) * THREE.MathUtils.smoothstep(t, 0, 1)
  
  // Attach chip to robot preserving world transform
  const attachChipTo = (parent) => {
    if (!chipRef.current || !parent) return
    
    // Save world position/rotation
    const worldPos = new THREE.Vector3()
    const worldQuat = new THREE.Quaternion()
    chipRef.current.getWorldPosition(worldPos)
    chipRef.current.getWorldQuaternion(worldQuat)
    
    // Reparent
    parent.add(chipRef.current)
    
    // Convert world transform to new local space
    parent.updateMatrixWorld(true)
    parent.worldToLocal(worldPos)
    chipRef.current.position.copy(worldPos)
    
    // Handle rotation relative to parent
    const parentWorldQuat = new THREE.Quaternion()
    parent.getWorldQuaternion(parentWorldQuat)
    parentWorldQuat.invert()
    worldQuat.premultiply(parentWorldQuat)
    chipRef.current.quaternion.copy(worldQuat)
  }
  
  // Initialize
  useEffect(() => {
    if (typeof window !== 'undefined') {
      stateMachine.current = new RecipeStateMachine()
      if (stateMachine.current.isStepReady(1)) {
        stateMachine.current.startStep(1)
      }
    }
  }, [])

  useFrame((_, delta) => {
    const now = performance.now()
    
    // Update state machine
    if (stateMachine.current) {
      stateMachine.current.update(now)
    }
    
    // Animation progress
    const elapsed = (now - animStartTime.current) / 1000
    const progress = Math.min(elapsed / animDuration.current, 1)
    
    // State-driven animation
    switch (currentStep.current) {
      case 0: // ROBOT 1: Move to wafer pickup position
        animDuration.current = 1.2
        if (skingCarriage.current) {
          skingCarriage.current.position.x = lerp(-0.5, WAYPOINTS.WAFER_PICKUP.x, progress)
        }
        break
        
      case 1: // ROBOT 1: Lower to chip (Z-axis down)
        animDuration.current = 0.8
        if (skingZ.current) {
          skingZ.current.position.y = lerp(0, -0.2, progress)
        }
        if (progress > 0.9 && chipOwner.current === 'none') {
          // Attach chip to Robot 1 tool
          if (skingTool.current && chipRef.current) {
            attachChipTo(skingTool.current)
            chipOwner.current = 'robot1'
          }
        }
        break
        
      case 2: // ROBOT 1: Lift chip (Z-axis up)
        animDuration.current = 0.8
        if (skingZ.current) {
          skingZ.current.position.y = lerp(-0.2, 0, progress)
        }
        break
        
      case 3: // ROBOT 1: Move to flip station
        animDuration.current = 1.2
        if (skingCarriage.current) {
          skingCarriage.current.position.x = lerp(WAYPOINTS.WAFER_PICKUP.x, WAYPOINTS.FLIP_STATION.x, progress)
        }
        break
        
      case 4: // ROBOT 1: 180° Flip
        animDuration.current = 1.4
        if (skingTool.current) {
          skingTool.current.rotation.z = lerp(0, Math.PI, progress)
        }
        if (progress > 0.5 && !flipped) {
          setFlipped(true)
        }
        break
        
      case 5: // ROBOT 1: Move to handoff position
        animDuration.current = 1.5
        if (skingCarriage.current) {
          skingCarriage.current.position.x = lerp(WAYPOINTS.FLIP_STATION.x, WAYPOINTS.HANDOFF.x, progress)
        }
        break
        
      case 6: // ROBOT 2: Move to handoff position
        animDuration.current = 1.2
        if (colCarriage.current) {
          colCarriage.current.position.x = lerp(1.6, WAYPOINTS.HANDOFF.x, progress)
        }
        break
        
      case 7: // ROBOT 2: Lower to pickup chip from Robot 1
        animDuration.current = 0.8
        if (colZ.current) {
          colZ.current.position.y = lerp(0, -0.15, progress)
        }
        if (progress > 0.8 && chipOwner.current === 'robot1') {
          // Transfer chip from Robot 1 to Robot 2
          if (colPickPoint.current && chipRef.current) {
            attachChipTo(colPickPoint.current)
            chipOwner.current = 'robot2'
          }
        }
        break
        
      case 8: // ROBOT 2: Lift chip
        animDuration.current = 0.8
        if (colZ.current) {
          colZ.current.position.y = lerp(-0.15, 0, progress)
        }
        // Robot 1 returns home
        if (skingCarriage.current) {
          skingCarriage.current.position.x = lerp(WAYPOINTS.HANDOFF.x, WAYPOINTS.FLIP_STATION.x, progress)
        }
        if (skingTool.current) {
          skingTool.current.rotation.z = lerp(Math.PI, 0, progress)
        }
        break
        
      case 9: // ROBOT 2: Move to flux station
        animDuration.current = 1.5
        if (colCarriage.current) {
          colCarriage.current.position.x = lerp(WAYPOINTS.HANDOFF.x, WAYPOINTS.FLUX_APPROACH.x, progress)
        }
        break
        
      case 10: // ROBOT 2: Lower into flux
        animDuration.current = 1.0
        if (colZ.current) {
          const targetY = WAYPOINTS.FLUX_DIP.y - WAYPOINTS.FLUX_APPROACH.y
          colZ.current.position.y = lerp(0, targetY, progress)
        }
        break
        
      case 11: // ROBOT 2: Dwell in flux
        animDuration.current = 0.8
        // Chip remains in flux
        break
        
      case 12: // ROBOT 2: Lift from flux
        animDuration.current = 1.0
        if (colZ.current) {
          const targetY = WAYPOINTS.FLUX_DIP.y - WAYPOINTS.FLUX_APPROACH.y
          colZ.current.position.y = lerp(targetY, 0, progress)
        }
        break
        
      case 13: // ROBOT 2: Move to bond site
        animDuration.current = 1.5
        if (colCarriage.current) {
          colCarriage.current.position.x = lerp(WAYPOINTS.FLUX_APPROACH.x, WAYPOINTS.BOND_TARGET.x, progress)
        }
        break
        
      case 14: // ROBOT 2: Lower to bond position
        animDuration.current = 1.0
        if (colZ.current) {
          colZ.current.position.y = lerp(0, -0.3, progress)
        }
        break
        
      case 15: // ROBOT 2: Release chip and retract
        animDuration.current = 1.0
        if (colZ.current) {
          colZ.current.position.y = lerp(-0.3, 0, progress)
        }
        if (progress > 0.3 && chipOwner.current === 'robot2') {
          chipOwner.current = 'board'
          // Note: In production, chip would be detached and placed on board
          // For this demo, keeping it attached to visualize the complete process
        }
        break
        
      default:
        break
    }
    
    // Advance to next step when current completes
    if (elapsed >= animDuration.current) {
      const nextStep = (currentStep.current + 1) % 16
      currentStep.current = nextStep
      animStartTime.current = now

      // Spoken narration for the new step (spoken exactly once per step).
      if (nextStep !== lastAnnouncedStep.current) {
        lastAnnouncedStep.current = nextStep
        speakCommentary(nextStep)
      }
      
      // Auto-advance recipe steps
      if (stateMachine.current) {
        const recipeStep = Math.min(nextStep + 1, 14)
        if (stateMachine.current.isStepReady(recipeStep)) {
          stateMachine.current.startStep(recipeStep)
        }
      }
    }
  })

  return (
    <>
      <SkingRobot 
        carriageRef={skingCarriage} 
        zRef={skingZ} 
        toolRef={skingTool} 
        basePosition={[0, 0, -0.5]} 
      />
      <Robot2 
        carriageRef={colCarriage} 
        zRef={colZ} 
        pickPointRef={colPickPoint} 
        basePosition={[0, 0, 0.5]} 
      />
      <Chip 
        chipRef={chipRef} 
        flipped={flipped} 
        position={[WAYPOINTS.WAFER_PICKUP.x, WAYPOINTS.WAFER_PICKUP.y, WAYPOINTS.WAFER_PICKUP.z]} 
      />
    </>
  )
}

export default function FlipChipBonder() {
  return (
    <Canvas camera={{ position: [3.5, 2.5, 4.5], fov: 45 }} dpr={[1, 2]} shadows style={{ width: '100%', height: '100%', display: 'block' }}>
      <ambientLight intensity={0.5} />
      <directionalLight position={[5, 8, 5]} intensity={1.4} castShadow />
      <MachineBase />
      <WaferStage position={[-1.6, 0, -0.5]} />
      <FluxStation position={[0.4, 0, 0.5]} />
      <BondBaseStage position={[1.6, 0, 0.5]} />
      <MotionSystem />
      <ContactShadows position={[0, -0.25, 0]} opacity={0.5} scale={8} blur={2} />
      <Environment preset="warehouse" />
      <OrbitControls makeDefault target={[0, 0.8, 0]} />
    </Canvas>
  )
}
