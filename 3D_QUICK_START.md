# 3D Flip-Chip TCB Animation System - Quick Start

## What You Now Have

A complete real-time 3D animation system for the Flip-Chip Thermo-Compression Bonding process with:

- ✅ All 17 process steps fully animated
- ✅ Realistic mechanical motion (industrial easing)
- ✅ Die ownership tracking (no floating die)
- ✅ Temperature visualization
- ✅ Force profiles (0-45N ramp)
- ✅ Timeline scrubbing support
- ✅ Play/Pause/Reset/Step navigation
- ✅ Deterministic state reconstruction
- ✅ Blender model integration
- ✅ React Three Fiber component

---

## Quick Integration (5 Minutes)

### Step 1: Import Component

```tsx
// In your page.tsx or component file
import { FlipChipBonder3D } from '@/components/FlipChipBonder3D';
import { AnimationOrchestrator } from '@/lib/AnimationOrchestrator';
import { useState, useRef } from 'react';

export default function YourPage() {
  const [step, setStep] = useState(1);
  const [playing, setPlaying] = useState(false);
  const [animState, setAnimState] = useState(null);
  const orch = useRef(new AnimationOrchestrator());

  return (
    <div>
      {/* 3D Visualization */}
      <FlipChipBonder3D
        currentStep={step}
        isPlaying={playing}
        onStepChange={setStep}
        onStateUpdate={setAnimState}
      />

      {/* Controls */}
      <button onClick={() => setPlaying(!playing)}>
        {playing ? '⏸ Pause' : '▶ Play'}
      </button>
      <button onClick={() => orch.current.reset()}>⟲ Reset</button>
      <button onClick={() => orch.current.stepBack()}>⬅</button>
      <button onClick={() => orch.current.stepForward()}>➜</button>
    </div>
  );
}
```

### Step 2: Check Models Load

In browser console, you should see:

```
[INIT] Starting 3D scene initialization...
[MODEL] Flip-chip-bonder loaded
[CALIBRATION] Model bounding box: { size: {...}, maxDim: ... }
[INIT] Scene initialization complete
```

### Step 3: Test Animation

- Click Play → machine should animate through step 1
- Click Pause → animation freezes
- Click Step Forward → advances to next step
- Use scrubber → timeline seeking
- Check console for values updating

---

## System Components At A Glance

### ThreeDAnimationState
```tsx
// Stores mechanical values
state.bondHeadTemperature = 260;  // °C
state.bondHeadForce = 45;         // Newtons
state.dieOwner = 'bondhead';      // WHO holds the die
state.pedestalRotation = 180;     // degrees
state.currentStep = 6;            // 1-17
```

### StateReconstructor
```tsx
// Reconstruct state at any timeline position
const state = StateReconstructor.reconstructState(step, progress);
// Returns complete state snapshot deterministically
```

### AnimationOrchestrator
```tsx
// Control playback
orch.play();              // Start
orch.pause();             // Pause
orch.reset();             // Reset to step 1
orch.stepForward();       // Next step
orch.stepBack();          // Previous step
orch.seek(0.5);           // Jump to 50% timeline
orch.update();            // Call every frame (handles in component)
```

### MotionController
```tsx
// Applied automatically in FlipChipBonder3D
controller.updateScene();
// Updates all Three.js transforms based on animation state
```

---

## Connecting to Your UI

### Display Telemetry

```tsx
{animState && (
  <div>
    <p>Step: {animState.currentStep}/17</p>
    <p>Temperature: {animState.bondHeadTemperature.toFixed(1)}°C</p>
    <p>Force: {animState.bondHeadForce.toFixed(2)}N</p>
    <p>Die Owner: {animState.dieOwner}</p>
    <p>Vacuum: {animState.bondHeadVacuumOn ? 'ON' : 'OFF'}</p>
  </div>
)}
```

### Timeline Scrubber

```tsx
<input
  type="range"
  min="0"
  max="100"
  value={animState?.stepProgress * 100 || 0}
  onChange={(e) => {
    orch.current.seek(parseInt(e.target.value) / 100);
    setStep(orch.current.getState().currentStep);
  }}
/>
```

### Synchronize with Narration

```tsx
useEffect(() => {
  if (playing && animState?.stepProgress > 0.8) {
    // Pause 3D animation while narration plays
    setPlaying(false);
    narrationManager.play(animState.currentStep);
  }
}, [animState?.stepProgress]);
```

---

## All 17 Steps Explained

### PHASE 1: Wafer Prep
1. **Substrate Loading** - Substrate enters stage, vacuum -85kPa, heat to 80°C
2. **Wafer Fiducial Scan** - Laser scans wafer surface for die registration

### PHASE 2: Pick & Flip
3. **Die Ejection** - Ejector pins rise 0.8mm to break tape adhesion
4. **Pick & Lift** - Pick arm descends, vacuum engages, lifts die
5. **Transfer to Pedestal** - Pick arm moves horizontally with die
6. **180° Flip** - Pedestal rotates 180°, die flips (bumps now facing down)
7. **Head → Pedestal** - Bonding head moves to pedestal position
8. **Head Picks Die** - Head descends, grips die from pedestal

### PHASE 3: Dip Flux
9. **Move to Flux Plate** - Head travels to flux station
10. **Dip, Dwell & Retract** - 5µm dip into flux, 200ms dwell, retract

### PHASE 4: Optics Align
11. **Move to Bond Site** - Head moves to substrate bonding location
12. **Dual-FOV Alignment** - Optics enter gap, laser alignment converges, then retracts

### PHASE 5: TCB Cycle
13. **Touchdown/Preheat** - Head descends to touch, force ramps to 45N at 150°C
14. **Peak Reflow Pulse** - Temperature rises 150°C → 260°C, solder melts
15. **Cool Down** - Temperature drops 260°C → 190°C, cooling gas activates

### PHASE 6: Release
16. **Release & Retract** - Vacuum releases, head retracts, die stays bonded
17. **Index to Next Site** - Substrate indexes to next die, head returns home, QC PASS

---

## Customization

### Adjust Step Duration

In `ThreeDAnimationState.ts`:

```tsx
private readonly STEP_DURATIONS: Record<number, number> = {
  1: 2200,  // Substrate Loading - change millisecond value
  2: 3000,  // Wafer Scan
  // ... etc
};
```

### Change Machine Coordinates

In `MachineCalibration.ts`:

```tsx
static readonly STATIONS = {
  WAFER_STAGE: { x: 0.0, y: 0.0, z: 0.0, ... },
  PEDESTAL_CENTER: { x: -0.3, y: 0.0, z: 0.0, ... },
  FLUX_PLATE_CENTER: { x: 0.3, y: 0.0, z: 0.0, ... },
  BOND_SITE: { x: -0.1, y: 0.0, z: 0.0, ... },
};
```

### Adjust Temperature Colors

In `MotionController.ts`, `updateThermalMaterials()`:

```tsx
if (temp >= 260) {
  emissiveColor = new THREE.Color('#FF4B4B');  // Red
  emissiveIntensity = 1.0;
}
```

### Change Die Dimensions

In `MachineCalibration.ts`:

```tsx
static readonly DIE = {
  WIDTH: 0.08,      // 3D units
  LENGTH: 0.08,
  THICKNESS: 0.004,
};
```

---

## Debugging

### Check If Models Load

```
Open browser console (F12)
Look for: "[MODEL] Flip-chip-bonder loaded"
```

### Inspect Die Ownership

In your component:

```tsx
if (animState) {
  console.log('Die owner:', animState.dieOwner);
  console.log('Die position:', animState.dieWorldPosition);
}
```

### Enable Debug Logging

In `FlipChipBonder3D.tsx`, add:

```tsx
motionControllerRef.current?.logState();  // Log every frame
```

### Check Step Progress

```tsx
console.log(`Step ${animState.currentStep}/${17} - ${(animState.stepProgress * 100).toFixed(1)}%`);
```

---

## Performance Tips

1. **Reduce Shadow Map Size** (if slow)
   - In `MachineCalibration.ts`: `SHADOW_MAP_SIZE: 1024` (default 2048)

2. **Disable Auto-Rotation** (keep camera still)
   - In `FlipChipBonder3D.tsx`: `autoRotate={false}`

3. **Limit Frame Rate** (if GPU high)
   - Browser handles this, but you can add frame rate cap

4. **Use DevTools Performance Tab**
   - Record animation frame and check for bottlenecks

---

## Testing Your Setup

Run through this checklist:

- [ ] 3D canvas renders without errors
- [ ] Models load (check console)
- [ ] Play button starts animation
- [ ] Pause button freezes at current frame
- [ ] Reset returns to step 1
- [ ] Step Forward advances one step
- [ ] Step Back goes previous step
- [ ] Scrubber seeks to correct timeline position
- [ ] Temperature numbers update (25°C → 260°C peak)
- [ ] Force ramps in step 13 (0 → 45N)
- [ ] Die moves through process (wafer → pick → pedestal → bondhead → substrate)
- [ ] Pedestal rotates 180° in step 6
- [ ] Cooling appears in step 15
- [ ] QC shows PASS in step 17
- [ ] No console errors or warnings

---

## Common Issues & Fixes

### "GLB not found" Error
```
Fix: Ensure public/ folder has:
  - flip_chip_bonder.glb
  - roboticarm.glb (optional)
  - wafer_rack_module.glb (optional)
```

### Die Floating or Disappearing
```
Fix: Check DieAttachmentSystem.registerParent() calls
Verify all machine components are registered
Check MotionController.updateDie() is being called
```

### Animation Stuttering
```
Fix: Check frame rate (should be 60 FPS)
Reduce shadow map size
Disable any post-processing effects
Check for console errors
```

### Pedestal Not Rotating
```
Fix: Verify rotation axis in MotionController (X, Y, or Z)
Check getPedestalRotation() in StateReconstructor
Ensure pedestalRotaryBase is found in model hierarchy
```

### Temperature Not Changing Color
```
Fix: Check updateThermalMaterials() in MotionController
Verify bondHeadTemperature is updating in state
Check material emissive is being applied
```

---

## File Locations

```
/lib/ThreeDAnimationState.ts       ← Core state machine
/lib/BlenderModelLoader.ts         ← Model loading
/lib/MachineCalibration.ts         ← Physical coordinates
/lib/DieAttachmentSystem.ts        ← Die ownership
/lib/MotionController.ts           ← Transform updates
/lib/StateReconstructor.ts         ← State reconstruction
/lib/AnimationOrchestrator.ts      ← Playback control
/components/FlipChipBonder3D.tsx   ← React component
/3D_ANIMATION_INTEGRATION.md       ← Full integration guide
```

---

## Next Steps

1. ✅ Copy all files (already done)
2. ✅ Review architecture (read this guide + integration.md)
3. Add `FlipChipBonder3D` to your page
4. Connect to existing UI buttons
5. Test all 17 steps
6. Integrate narration
7. Adjust calibration values as needed
8. Deploy!

---

## Questions?

Check:
1. Browser console for error messages
2. `3D_ANIMATION_INTEGRATION.md` for detailed guide
3. Code comments in individual system files
4. FlipChipBonder3D.tsx for React integration pattern

---

**Status**: ✅ Complete implementation - ready for integration and testing
