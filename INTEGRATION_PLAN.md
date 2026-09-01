# Flip-Chip Bonder Integration Plan

## Current State Assessment

### Existing Systems (WORKING):
1. **BonderController** (`lib/BonderController.js`)
   - Loads flip_chip_bonder.glb
   - Manages robots (SKING, COLRIGHT)
   - Has TwoRobotChipProcess for chip handling
   - Has chip controllers, flux station, alignment, bonding controllers

2. **TwoRobotChipProcess** (`lib/bonder/TwoRobotChipProcess.js`)
   - COLRIGHT: Picks die, flips 180°, hands off
   - SKING: Receives die, flux dips, places on substrate
   - Already implements proper world transform preservation
   - Already has proper chip attachment

3. **WaferBonderTransfer** (`lib/bonder/WaferBonderTransfer.js`)
   - EFEM robot transfers wafer from rack to bonder
   - Already implements IK, bezier paths, proper attach/detach
   - State machine: IDLE → R2FOUP → APPROACH → ATTACH → LIFT → TRAVEL → LOWER → PLACE → RETRACT → HOME

4. **17-Stage Recipe** (`lib/data/tcbSteps.ts`)
   - Phase 1: Wafer Prep (Stages 1-2)
   - Phase 2: Pick & Flip (Stages 3-8)
   - Phase 3: Dip Flux (Stages 9-10)
   - Phase 4: Optics Align (Stages 11-12)
   - Phase 5: TCB Cycle (Stages 13-15)
   - Phase 6: Release (Stages 16-17)

### The Problem:
**Stage 1 (Substrate Loading) UI exists but doesn't trigger WaferBonderTransfer animation**

The disconnect is:
- UI shows "Stage 1: Substrate Loading"
- But no actual 3D robot animation runs
- The wafer transfer needs to be integrated into the stage sequence

## Integration Strategy

### Phase 1: Connect Stage 1 to WaferBonderTransfer

**File:** `lib/BonderController.js`

Add method:
```javascript
async runStage01_SubstrateLoading() {
  // 1. Calculate source (rack) and destination (bonder pedestal) positions
  const sourceWorld = this._getRackWaferPosition()
  const destWorld = this._getPedestalPosition()
  
  // 2. Start the transfer
  if (this.bondTransfer) {
    this.bondTransfer.start(sourceWorld, destWorld)
  }
  
  // 3. Wait for completion
  await this._waitForTransferComplete()
  
  // 4. Mark stage complete
  this.stateMachine.completeStage(1)
}
```

### Phase 2: Make BonderController Aware of bondTransfer

**Problem:** BonderController doesn't currently have reference to bondTransfer (it's created in page.tsx)

**Solution:** Pass bondTransfer reference during initialization or via setter:

```javascript
// In BonderController
setBondTransfer(transfer) {
  this.bondTransfer = transfer
  transfer.log = (msg) => this._log(msg)
}
```

### Phase 3: Integrate with Existing State Machine

**File:** `lib/bonder/BonderStateMachine.js`

Current state machine needs to:
1. Recognize Stage 1 as requiring external animation (WaferBonderTransfer)
2. Wait for that animation to complete
3. Only then proceed to Stage 2

### Phase 4: Fix Robot Calibration

**Issue from Error Log:**
```
[BONDER ERROR] Cannot read properties of null (reading 'rest')
```

This suggests `robot1Reach` or `robot2Reach` is null in TwoRobotChipProcess.

**Root Cause:** Robot calibration (`_computeReach()`) may be failing

**Fix:** Ensure robots are fully discovered before calibration runs

### Phase 5: Synchronize UI with 3D Animation

**File:** `app/page.tsx`

The UI ProcessFlowPanel must reflect actual 3D state:
- When Stage 1 active → show "Substrate Loading" + robot should be moving
- When Stage 4 active → show "Pick & Lift" + COLRIGHT should be picking
- When Stage 10 active → show "Dip, Dwell & Retract" + chip should be in flux

## Implementation Steps

### Step 1: Add bondTransfer Reference to BonderController

**File:** `lib/BonderController.js`

```javascript
constructor(scene) {
  // ... existing code ...
  this.bondTransfer = null  // Add this
}

setBondTransfer(transfer) {
  this.bondTransfer = transfer
  if (transfer) {
    transfer.log = (msg) => this._log(msg)
  }
}
```

### Step 2: Create Stage 1 Handler

**File:** `lib/BonderController.js`

```javascript
async runFullRecipe() {
  try {
    // Stage 1: Substrate Loading (EFEM robot transfer)
    await this.runStage01_SubstrateLoading()
    
    // Stage 2: Wafer Fiducial Scan
    await this.runStage02_FiducialScan()
    
    // Stages 3-17: Existing two-robot process
    await this.runTwoRobotRecipe()
    
  } catch (err) {
    this.stateMachine.fail(err.message)
  }
}

async runStage01_SubstrateLoading() {
  if (!this.bondTransfer) {
    this._logError('bondTransfer not configured')
    return
  }
  
  this.stateMachine.startStage(1)
  
  // Calculate positions from actual models
  const sourceWorld = this._calculateRackPosition()
  const destWorld = this._calculatePedestalPosition()
  
  // Start transfer
  const started = this.bondTransfer.start(sourceWorld, destWorld)
  if (!started) {
    this._logError('Failed to start wafer transfer')
    return
  }
  
  // Wait for transfer to complete
  await this._waitForState(() => {
    return this.bondTransfer.getStatus().state === 'DONE'
  }, 15000) // 15 second timeout
  
  this.stateMachine.completeStage(1)
  this.events.emit(BONDER_EVENTS.STAGE_COMPLETE, { stageId: 1 })
}

async _waitForState(condition, timeout = 10000) {
  const start = performance.now()
  return new Promise((resolve, reject) => {
    const check = () => {
      if (condition()) {
        resolve()
      } else if (performance.now() - start > timeout) {
        reject(new Error('Timeout waiting for state'))
      } else {
        requestAnimationFrame(check)
      }
    }
    check()
  })
}

_calculateRackPosition() {
  // Find wafer rack position
  // This depends on the rack GLB model structure
  // For now, use known coordinates from inspection
  return new THREE.Vector3(-14, 3.35, 0) // Approximate rack position
}

_calculatePedestalPosition() {
  // Return pedestal working plane position
  const pedestal = this.nodes.PEDESTAL || this.nodes.RING_VACUUM_PEDESTAL
  if (pedestal) {
    const pos = new THREE.Vector3()
    pedestal.getWorldPosition(pos)
    return pos
  }
  // Fallback to known position
  return new THREE.Vector3(0, 0.5, 0)
}
```

### Step 3: Update page.tsx Integration

**File:** `app/page.tsx`

Find where bonderController is created and add:

```javascript
// After bonder controller load
if (this.bonderController && this.bondTransfer) {
  this.bonderController.setBondTransfer(this.bondTransfer)
}
```

### Step 4: Fix Robot Calibration Error

**File:** `lib/bonder/TwoRobotChipProcess.js`

Add safety checks in `_computeReach()`:

```javascript
_computeReach() {
  // Ensure robots exist
  if (!this.robot1 || !this.robot1Pickup) {
    console.warn('[TwoRobot] Robot 1 not fully initialized')
    this.robot1Reach = null
    return
  }
  
  if (!this.robot2 || !this.robot2Tip) {
    console.warn('[TwoRobot] Robot 2 not fully initialized')
    this.robot2Reach = null
    return
  }
  
  // Existing calibration code...
  this.robot1Reach = {
    X: this._calibrateAxis(this.robot1, 'x', this.robot1Pickup),
    Y: this._calibrateAxis(this.robot1Vertical, 'y', this.robot1Pickup),
    homeFlipZ: this.robot1FlipAxis ? this.robot1FlipAxis.rotation.z : 0,
  }
  
  this.robot2Reach = {
    X: this._calibrateAxis(this.robot2, 'x', this.robot2Tip),
    Y: this._calibrateAxis(this.robot2Vertical, 'y', this.robot2Tip),
    homeRotaryZ: this.robot2Rotary ? this.robot2Rotary.rotation.z : 0,
  }
}
```

And in methods that use reach, add null checks:

```javascript
_setRobot1Tip(targetWorld) {
  if (!this.robot1Reach || !this.robot1Reach.X) {
    console.warn('[TwoRobot] Robot 1 not calibrated')
    return Promise.resolve()
  }
  // ... existing code
}
```

### Step 5: Update Animation Loop

**File:** `app/page.tsx`

In the animation loop, ensure bondTransfer gets updated:

```javascript
private _animate(): void {
  // ... existing code ...
  
  // Update bonder controller (includes TwoRobotChipProcess)
  if (this.bonderController) {
    this.bonderController.update(dt * speed)
  }
  
  // Update wafer transfer (EFEM robot)
  if (this.bondTransfer && this.bondTransfer.isRunning()) {
    this.bondTransfer.update(dt * speed)
  }
  
  // ... rest of animation loop
}
```

### Step 6: Add START Button Handler

**File:** `app/page.tsx`

Update the START button to trigger the full recipe:

```javascript
startFullBonderRecipe(): void {
  const bc = this.bonderController
  if (!bc) return
  
  // Run full 17-stage recipe including substrate loading
  void bc.runFullRecipe()
}
```

And in the UI:

```javascript
<button
  onClick={() => simRef.current?.startFullBonderRecipe()}
  disabled={ui.bonder.status === 'running'}
>
  START FULL RECIPE (17 STAGES)
</button>
```

### Step 7: Add RESET Handler

**File:** `lib/BonderController.js`

```javascript
async reset() {
  // Reset bonder state
  this.stateMachine.reset()
  
  // Reset two-robot process
  if (this.twoRobot) {
    await this.twoRobot.reset()
  }
  
  // Reset wafer transfer
  if (this.bondTransfer) {
    this.bondTransfer.reset()
  }
  
  // Reset chip controllers
  this.chipControllers.forEach(c => c.reset())
  
  // Reset visual state
  this.temperature = 80
  this.running = false
  this.paused = false
  
  this.events.emit(BONDER_EVENTS.RESET)
}
```

### Step 8: Add PAUSE/RESUME Support

**File:** `lib/BonderController.js`

```javascript
pause() {
  this.paused = true
  this.events.emit(BONDER_EVENTS.PAUSED)
}

resume() {
  this.paused = false
  this.events.emit(BONDER_EVENTS.RESUMED)
}

update(dt) {
  if (this.paused || !this.running) return
  
  // Update tweens (robot movements)
  this.tweens.update(dt)
  
  // Update controllers
  this.flipStage.update(dt)
  this.fluxStation.update(dt)
  this.alignment.update(dt)
  this.bonding.update(dt)
  
  // Update flux station visual
  if (this.fluxStationVisual) {
    this.fluxStationVisual.update(dt)
  }
}
```

## Testing Plan

### Test 1: Stage 1 Substrate Loading
1. Click START
2. Verify EFEM robot moves to rack
3. Verify robot picks wafer from rack slot
4. Verify robot travels to bonder
5. Verify robot places wafer on pedestal
6. Verify robot retracts and returns home
7. Verify Stage 1 completes and Stage 2 becomes active

### Test 2: Complete 17-Stage Sequence
1. Click START
2. Verify each stage progresses in order
3. Verify UI stage indicator matches 3D animation
4. Verify no teleportation or jumping
5. Verify chip attachment/detachment works
6. Verify flux dipping is visible
7. Verify final placement succeeds

### Test 3: PAUSE/RESUME
1. Start process
2. Click PAUSE during transfer
3. Verify everything freezes
4. Click RESUME
5. Verify continues from same position

### Test 4: RESET
1. Start process
2. Let it run partway
3. Click RESET
4. Verify all objects return to initial positions
5. Click START again
6. Verify process works correctly

### Test 5: Speed Controls
1. Start at 1x
2. Change to 2x mid-process
3. Verify animation speeds up proportionally
4. Try 5x and 10x
5. Verify mechanical relationships remain correct

## Files to Modify

1. **lib/BonderController.js**
   - Add `setBondTransfer()`
   - Add `runFullRecipe()`
   - Add `runStage01_SubstrateLoading()`
   - Add `runStage02_FiducialScan()`
   - Add position calculation methods
   - Add wait helpers
   - Improve `reset()`, `pause()`, `resume()`

2. **lib/bonder/TwoRobotChipProcess.js**
   - Add null checks in `_computeReach()`
   - Add null checks in movement methods
   - Improve error handling

3. **app/page.tsx**
   - Call `bonderController.setBondTransfer(this.bondTransfer)`
   - Update animation loop to call `bondTransfer.update()`
   - Add `startFullBonderRecipe()` method
   - Update START button handler
   - Ensure RESET calls both systems

4. **lib/bonder/BonderStateMachine.js** (if needed)
   - Ensure stages can wait for external animations

## Success Criteria

✅ Stage 1: EFEM robot visibly transfers wafer from rack to bonder
✅ Stage 2-17: Existing two-robot process runs correctly
✅ UI matches 3D animation at all times
✅ No object teleportation
✅ No object duplication
✅ No floating objects
✅ PAUSE freezes everything
✅ RESUME continues correctly
✅ RESET restores all to initial state
✅ Speed controls work (1x, 2x, 5x, 10x)
✅ Complete 17-stage sequence works end-to-end

## Implementation Priority

**P0 (Critical):**
1. Fix robot calibration null error
2. Connect Stage 1 to WaferBonderTransfer
3. Update animation loop

**P1 (High):**
4. Add full recipe runner
5. Implement proper RESET
6. Add PAUSE/RESUME

**P2 (Medium):**
7. Add position calculation from actual models
8. Improve error handling
9. Add comprehensive logging

**P3 (Nice to have):**
10. Add debug visualization
11. Add collision detection
12. Add detailed telemetry

---

**Next Step:** Implement P0 changes first, test, then proceed to P1.
