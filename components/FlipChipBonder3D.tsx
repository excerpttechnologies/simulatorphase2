/**
 * FlipChipBonder3D.tsx
 * 
 * Main React Three Fiber component for the 3D Flip-Chip TCB simulation.
 * Orchestrates all animation systems and ties them to the React component lifecycle.
 */

'use client';

import { useEffect, useRef, useState, useCallback } from 'react';
import { Canvas, useFrame, useThree } from '@react-three/fiber';
import { OrbitControls, Environment, ContactShadows } from '@react-three/drei';
import * as THREE from 'three';
import { ThreeDAnimationState } from '@/lib/ThreeDAnimationState';
import BlenderModelLoader, { ModelRegistry } from '@/lib/BlenderModelLoader';
import MachineCalibration from '@/lib/MachineCalibration';
import DieAttachmentSystem from '@/lib/DieAttachmentSystem';
import MotionController from '@/lib/MotionController';
import StateReconstructor from '@/lib/StateReconstructor';

// ═══════════════════════════════════════════════════════════════
// MAIN 3D SCENE COMPONENT
// ═══════════════════════════════════════════════════════════════

interface FlipChipScene3DProps {
  currentStep: number;
  isPlaying: boolean;
  onStepChange?: (step: number) => void;
  onStateUpdate?: (state: any) => void;
}

/**
 * Inner scene component that uses useFrame hook
 */
function Scene3D({ currentStep, isPlaying, onStepChange, onStateUpdate }: FlipChipScene3DProps) {
  const { scene } = useThree();

  // Animation state management
  const animationStateRef = useRef<ThreeDAnimationState | null>(null);
  const motionControllerRef = useRef<MotionController | null>(null);
  const dieAttachmentRef = useRef<DieAttachmentSystem | null>(null);
  const modelLoaderRef = useRef<BlenderModelLoader | null>(null);
  const registryRef = useRef<ModelRegistry | null>(null);

  // Timeline control
  const playStartTimeRef = useRef<number>(0);
  const stepStartTimeRef = useRef<number>(0);
  const stepProgressRef = useRef<number>(0);

  // Initialize on mount
  useEffect(() => {
    const initializeScene = async () => {
      console.log('[INIT] Starting 3D scene initialization...');

      // Create animation state
      const animState = new ThreeDAnimationState();
      animationStateRef.current = animState;

      // Load models
      const loader = new BlenderModelLoader();
      modelLoaderRef.current = loader;
      registryRef.current = loader.getRegistry();

      try {
        // ===== GLB-REMOVED (loadMainMachine - /flip_chip_bonder.glb) - re-wire the new module here. See GLB_WIRING_CONTRACT.md =====
        // const mainMachine = await loader.loadMainMachine();
        // scene.add(mainMachine);
        // console.log('[SCENE] Main machine loaded and added to scene');

        // Create die mesh
        const die = loader.createDieMesh();
        scene.add(die);

        // Initialize attachment system
        const dieAttachment = new DieAttachmentSystem(die);
        dieAttachmentRef.current = dieAttachment;

        // Register machine components as parents for die attachment
        if (registryRef.current?.waferStage) {
          dieAttachment.registerParent('wafer' as any, registryRef.current.waferStage);
        }
        if (registryRef.current?.pickArm) {
          dieAttachment.registerParent('pick' as any, registryRef.current.pickArm);
        }
        if (registryRef.current?.pedestalRotaryBase) {
          dieAttachment.registerParent('pedestal' as any, registryRef.current.pedestalRotaryBase);
        }
        if (registryRef.current?.bondingHead) {
          dieAttachment.registerParent('bondhead' as any, registryRef.current.bondingHead);
        }

        // Initialize motion controller
        const motionController = new MotionController(animState, registryRef.current);
        motionControllerRef.current = motionController;

        console.log('[INIT] Scene initialization complete');
      } catch (error) {
        console.error('[ERROR] Scene initialization failed:', error);
      }
    };

    initializeScene();
  }, [scene]);

  // Animation loop
  useFrame((state, deltaTime) => {
    if (!animationStateRef.current || !motionControllerRef.current) {
      return;
    }

    // Determine current step and progress
    let step = currentStep;
    let progress = stepProgressRef.current;

    // If playing, update progress based on elapsed time
    if (isPlaying) {
      if (playStartTimeRef.current === 0) {
        playStartTimeRef.current = performance.now();
        stepStartTimeRef.current = performance.now();
      }

      const elapsed = performance.now() - stepStartTimeRef.current;
      const stepDuration = animationStateRef.current.getStepDuration(step);

      progress = Math.min(elapsed / stepDuration, 1.0);
      stepProgressRef.current = progress;

      // Auto-advance to next step when current step completes
      if (progress >= 1.0 && step < 17) {
        step += 1;
        onStepChange?.(step);
        stepProgressRef.current = 0;
        stepStartTimeRef.current = performance.now();
        playStartTimeRef.current = performance.now();
      }

      // Stop at end of final step
      if (step === 17 && progress >= 1.0) {
        // Process complete - could trigger QC display
        console.log('[PROCESS] Complete! QC Result: PASS');
      }
    } else {
      playStartTimeRef.current = 0;
    }

    // Reconstruct state at current timeline position
    const currentState = StateReconstructor.reconstructState(step, progress);

    // Update animation state
    animationStateRef.current.updateState(step, progress, deltaTime);

    // Apply transforms to scene
    motionControllerRef.current.updateScene();

    // Update die attachment/position
    if (dieAttachmentRef.current) {
      const dieState = StateReconstructor.reconstructState(step, progress);
      dieAttachmentRef.current.updatePosition(dieState.dieWorldPosition);
      dieAttachmentRef.current.updateRotation(dieState.dieWorldRotation);
    }

    // Callback for telemetry update
    onStateUpdate?.(currentState);
  });

  return null;
}

// ═══════════════════════════════════════════════════════════════
// MAIN COMPONENT
// ═══════════════════════════════════════════════════════════════

interface FlipChipBonder3DProps {
  currentStep?: number;
  isPlaying?: boolean;
  onStepChange?: (step: number) => void;
  onStateUpdate?: (state: any) => void;
  width?: number | string;
  height?: number | string;
}

export function FlipChipBonder3D({
  currentStep = 1,
  isPlaying = false,
  onStepChange,
  onStateUpdate,
  width = '100%',
  height = '600px',
}: FlipChipBonder3DProps) {
  const canvasRef = useRef<HTMLDivElement>(null);

  return (
    <div
      ref={canvasRef}
      style={{
        width,
        height,
        position: 'relative',
        border: '1px solid #ccc',
        borderRadius: '8px',
        overflow: 'hidden',
      }}
    >
      <Canvas
        camera={{
          position: [0.5, 0.8, 1.2],
          fov: 75,
          near: 0.001,
          far: 100,
        }}
        shadows
        dpr={Math.min(window.devicePixelRatio, 2)}
      >
        {/* Lighting setup */}
        <ambientLight intensity={MachineCalibration.SCENE.AMBIENT_LIGHT_INTENSITY} />
        <directionalLight
          position={[5, 8, 5]}
          intensity={MachineCalibration.SCENE.KEY_LIGHT_INTENSITY}
          castShadow
          shadow-mapSize-width={MachineCalibration.SCENE.SHADOW_MAP_SIZE}
          shadow-mapSize-height={MachineCalibration.SCENE.SHADOW_MAP_SIZE}
          shadow-bias={MachineCalibration.SCENE.SHADOW_BIAS}
        />
        <pointLight position={[-5, 4, 3]} intensity={MachineCalibration.SCENE.FILL_LIGHT_INTENSITY} />

        {/* Environment */}
        <Environment preset="studio" />
        <ContactShadows position={[0, -0.5, 0]} opacity={0.4} scale={2} blur={1.5} />

        {/* Main scene with animation loop */}
        <Scene3D
          currentStep={currentStep}
          isPlaying={isPlaying}
          onStepChange={onStepChange}
          onStateUpdate={onStateUpdate}
        />

        {/* Camera controls */}
        <OrbitControls
          makeDefault
          minDistance={0.5}
          maxDistance={5}
          autoRotate={false}
          enablePan={true}
          enableZoom={true}
          enableRotate={true}
        />
      </Canvas>
    </div>
  );
}

export default FlipChipBonder3D;
