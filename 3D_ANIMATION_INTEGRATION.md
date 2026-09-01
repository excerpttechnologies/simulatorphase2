# 3D ANIMATION SYSTEM - INTEGRATION GUIDE

## Overview

This guide explains how to integrate the new real-time 3D animation system into the existing Flip-Chip TCB simulator. The system includes:

- **ThreeDAnimationState.ts** - Central state management
- **BlenderModelLoader.ts** - GLB model loading and hierarchy inspection
- **MachineCalibration.ts** - Physical coordinates and calibration data
- **DieAttachmentSystem.ts** - Die ownership and reparenting logic
- **MotionController.ts** - Applies animation state to Three.js transforms
- **StateReconstructor.ts** - Deterministic state reconstruction for scrubbing
- **AnimationOrchestrator.ts** - Playback control (play, pause, step, seek)
- **FlipChipBonder3D.tsx** - React Three Fiber component

---

## Architecture

```
┌─────────────────────────────────────────────────────────┐
│              React UI Layer                             │
│  (Timeline controls, telemetry display, QC badge)      │
└────────────────────┬────────────────────────────────────┘
                     │
┌────────────────────▼────────────────────────────────────┐
│         AnimationOrchestrator                           │
│  (Playback state, step control, timeline seeking)      │
└────────────────────┬────────────────────────────────────┘
                     │
┌────────────────────▼────────────────────────────────────┐
│      StateReconstructor                                │
│  (Deterministic state at any timeline position)        │
└────────────────────┬────────────────────────────────────┘
                     │
┌────────────────────▼────────────────────────────────────┐
│      ThreeDAnimationState                              │
│  (All mechanical component values)                     │
└────────────────────┬────────────────────────────────────┘
                     │
┌────────────────────▼────────────────────────────────────┐
│        MotionController                                │
│  (Applies transforms to Three.js objects)             │
└────────────────────┬────────────────────────────────────┘
                     │
┌────────────────────▼────────────────────────────────────┐
│     FlipChipBonder3D (React Three Fiber)              │
│  ┌────────────────────────────────────────────────┐   │
│  │     Three.js Scene                            │   │
│  │  ├─ Blender GLB models (via ModelLoader)     │   │
│  │  ├─ Die mesh                                 │   │
│  │  ├─ Lighting & environment                   │   │
│  │  └─ Camera & OrbitControls                   │   │
│  └────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────┘
```

---

## Integration Steps

### 1. Add 3D Component to Your Page

In your main simulation page (e.g., `app/page.tsx` or `app/Recipe/page.tsx`):

```tsx
import { FlipChipBonder3D } from '@/components/FlipChipBonder3D';
import { AnimationOrchestrator } from '@/lib/AnimationOrchestrator';
import { useState, useEffect } from 'react';

export default function SimulatorPage() {
  const [currentStep, setCurrentStep] = useState(1);
  const [isPlaying, setIsPlaying] = useState(false);
  const [animationState, setAnimationState] = useState(null);
  const orchestratorRef = useRef(new AnimationOrchestrator());

  return (
    <div>
      {/* 3D Visualization */}
      <FlipChipBonder3D
        currentStep={currentStep}
        isPlaying={isPlaying}
        onStepChange={setCurrentStep}
        onStateUpdate={setAnimationState}
        width="100%"
        height="700px"
      />

      {/* Timeline Controls */}
      <div>
        <button onClick={() => setIsPlaying(!isPlaying)}>
          {isPlaying ? 'Pause' : 'Play'}
        </button>
        <button onClick={() => orchestratorRef.current.reset()}>Reset</button>
        <button onClick={() => orchestratorRef.current.stepBack()}>← Step</button>
        <button onClick={() => orchestratorRef.current.stepForward()}>Step →</button>

        {/* Timeline Scrubber */}
        <input
          type="range"
          min="0"
          max="100"
          value={animationState?.stepProgress * 100 || 0}
          onChange={(e) => {
            orchestratorRef.current.seek(parseInt(e.target.value) / 100);
            setCurrentStep(orchestratorRef.current.getState().currentStep);
          }}
        />
      </div>

      {/* Telemetry Display */}
      {animationState && (
        <div>
          <p>Step: {animationState.currentStep}/17</p>
          <p>Temp: {animationState.bondHeadTemperature.toFixed(1)}°C</p>
          <p>Force: {animationState.bondHeadForce.toFixed(2)}N</p>
          <p>Die Owner: {animationState.dieOwner}</p>
        </div>
      )}
    </div>
  );
}
```

### 2. Update UI State Management

If using React Context or Redux, update your state slices:

```tsx
// Add to your context/store
const [threeD] = {
  animationOrchestrator: new AnimationOrchestrator(),
  currentStep: 1,
  isPlaying: false,
  animationState: null,
};
```

### 3. Connect to Existing Telemetry Display

Replace or augment your current telemetry with animation state values:

```tsx
// Before: static values
<TelemetryDisplay
  temperature={80}
  force={0}
  dieOwner="wafer"
/>

// After: live from animation state
<TelemetryDisplay
  temperature={animationState?.bondHeadTemperature}
  force={animationState?.bondHeadForce}
  dieOwner={animationState?.dieOwner}
  vacuum={animationState?.bondHeadVacuumOn}
  coolingMode={animationState?.coolingMode}
/>
```

### 4. Sync with Narration System

If using narration, synchronize playback:

```tsx
// In your narration component
useEffect(() => {
  if (isPlaying && animationState?.stepProgress > narrationThreshold) {
    // Pause animation while narration plays
    setIsPlaying(false);
    playNarration(currentStep);
  }
}, [animationState?.stepProgress]);
```

---

## Key Files & Functions

### ThreeDAnimationState

**Purpose**: Stores all animation values

**Key Methods**:
- `updateState(stepIndex, stepProgress, deltaTime)` - Update state based on current step
- `getState()` - Get current state snapshot
- `reset()` - Reset to initial state
- `getStepDuration(step)` - Get duration of a specific step

**Important Properties**:
- `currentStep` - 1-17
- `stepProgress` - 0-1 (normalized within current step)
- `bondHeadTemperature` - °C
- `bondHeadForce` - Newtons
- `dieOwner` - Who currently holds the die
- `pedestalRotation` - 0-180°
- etc.

### StateReconstructor

**Purpose**: Reconstructs complete state at any timeline position

**Key Method**:
```tsx
const state = StateReconstructor.reconstructState(stepIndex, stepProgress);
// Returns: AnimationStateSnapshot with all values at that position
```

This enables:
- **Scrubbing**: User drags timeline slider
- **Step Back**: Reconstruct previous step with progress=1.0
- **Jump to Step**: Reconstruct specific step with progress=0
- **Pause**: Scene matches exact paused frame

### MotionController

**Purpose**: Applies animation state to Three.js transforms

**Key Method**:
```tsx
motionController.updateScene();
// Updates positions of: pick arm, bondhead, pedestal, flux plate, optics, die, etc.
```

### AnimationOrchestrator

**Purpose**: Manages playback and timeline control

**Key Methods**:
```tsx
orchestrator.play()           // Start playback
orchestrator.pause()          // Pause at current position
orchestrator.reset()          // Reset to step 1
orchestrator.stepForward()    // Next step
orchestrator.stepBack()       // Previous step
orchestrator.seek(0.5)        // Jump to 50% progress
orchestrator.update()         // Call every frame
```

---

## Customization

### Adjusting Step Durations

In `ThreeDAnimationState.ts`, modify the `STEP_DURATIONS` object:

```tsx
private readonly STEP_DURATIONS: Record<number, number> = {
  1: 2200,   // Substrate Loading (milliseconds)
  2: 3000,   // Wafer Fiducial Scan
  // ... adjust as needed
};
```

### Adjusting Physical Coordinates

In `MachineCalibration.ts`, modify station positions:

```tsx
static readonly STATIONS = {
  WAFER_STAGE: { x: 0.0, y: 0.0, z: 0.0, ... },
  PEDESTAL_CENTER: { x: -0.3, y: 0.0, z: 0.0, ... },
  // ... adjust positions to match Blender model layout
};
```

### Adjusting Temperature Colors

In `MotionController.ts`, modify `updateThermalMaterials()`:

```tsx
if (temp <= 80) {
  emissiveColor = new THREE.Color('#2b2d31'); // Change this color
  emissiveIntensity = 0;
}
```

---

## Debugging

### Enable Debug Logging

In `MotionController.ts`, uncomment debug logs:

```tsx
motionController.logState(); // Call periodically to log state
```

### Inspect Model Hierarchy

When models load, hierarchy is automatically logged:

```
[MODEL] Flip-chip-bonder loaded
├─ MachineBody
├─ HeatedStage
├─ PickRobot
│  ├─ Base
│  ├─ Shoulder
│  └─ Collet
...
```

### Verify Die Attachment

```tsx
dieAttachment.logState(); // Check current die ownership and position
```

---

## Troubleshooting

### Die not moving
- Check `DieAttachmentSystem.registerParent()` calls in FlipChipBonder3D
- Verify `MotionController.updateDie()` is being called
- Check `StateReconstructor.getDiePosition()` returns correct values

### Models not loading
- Verify GLB files exist in `public/` folder
- Check browser console for loader errors
- Ensure GLTFLoader is properly installed

### Animation jumping/skipping
- Check `StateReconstructor` calculations for step boundaries
- Verify `getStepDuration()` values are reasonable
- Check frame rate - use `deltaTime` param to scale animations

### Pedestal not rotating
- Verify rotation axis (X, Y, or Z) matches Blender model
- Check `getBondHeadZ()` in StateReconstructor
- Ensure `pedestalRotaryBase` is found in model hierarchy

---

## Performance Optimization

1. **Model Scale**: Adjust in `BlenderModelLoader.calibrateModelScale()`
2. **Shadow Maps**: Reduce `SHADOW_MAP_SIZE` if too slow
3. **Particle Effects**: Limit cooling gas particle count
4. **Materials**: Use fewer transparent materials
5. **LOD**: Implement Level-of-Detail for complex models

---

## Testing Checklist

- [ ] All 17 steps render correctly
- [ ] Die follows expected path (wafer → pick → pedestal → bondhead → substrate)
- [ ] Temperature gradient visualizes correctly
- [ ] Pedestal rotates exactly 180° in step 6
- [ ] Force ramps smoothly from 0 to 45N in step 13
- [ ] Cooling gas appears in step 15
- [ ] Scrubber seeks to correct position
- [ ] Step Back/Forward work correctly
- [ ] Reset returns to initial state
- [ ] Pause freezes exact current frame
- [ ] No die floating or gaps visible
- [ ] No model jittering or flicker

---

## Future Enhancements

1. **Collision Detection**: Add warnings if components intersect
2. **Virtual Probes**: Show temperature/force at specific points
3. **Virtual Oscilloscope**: Real-time X/Y/Z position plots
4. **Slow Motion**: 0.5x, 0.25x playback speed modes
5. **Step Branching**: Simulate different recipe parameters
6. **Recording**: Capture animation as video
7. **VR/AR**: WebXR support for immersive viewing
8. **Multi-die**: Show entire wafer processing

---

## Support

For issues or questions:
1. Check console logs for `[ERROR]` and `[WARN]` messages
2. Enable debug mode in development environment
3. Inspect Three.js scene with browser DevTools (use three.js inspector extension)
4. Review `StateReconstructor` for animation logic of specific step

