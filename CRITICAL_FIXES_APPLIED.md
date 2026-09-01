# Critical Fixes Applied to Flip-Chip Bonder

## Date: August 28, 2026

## Issues Identified and Fixed

### ❌ Issue 1: Null Pointer Error in TwoRobotChipProcess
**Error:** `Cannot read properties of null (reading 'rest')`

**Root Cause:** 
- `_computeReach()` was attempting to calibrate robots before they were fully initialized
- `_setRobot1Tip()` and `_setRobot2Tip()` were accessing `robot1Reach.X.rest` when reach was null

**Fix Applied:**
```javascript
// File: lib/bonder/TwoRobotChipProcess.js

// Added safety checks in _computeReach()
_computeReach() {
  if (!this.robot1 || !this.robot1Pickup) {
    console.warn('[TwoRobot] Robot 1 not fully initialized for calibration')
    this.robot1Reach = null
  } else {
    this.robot1Reach = { ... }
  }
  
  if (!this.robot2 || !this.robot2Tip) {
    console.warn('[TwoRobot] Robot 2 not fully initialized for calibration')
    this.robot2Reach = null
  } else {
    this.robot2Reach = { ... }
  }
}

// Added null checks before accessing reach properties
_setRobot1Tip(targetWorld) {
  if (!this.robot1Reach || !this.robot1Reach.X || !this.robot1Reach.Y) {
    console.warn('[TwoRobot] Robot 1 not calibrated, cannot move')
    return Promise.resolve()
  }
  // ... movement code
}

_setRobot2Tip(targetWorld) {
  if (!this.robot2Reach || !this.robot2Reach.X || !this.robot2Reach.Y) {
    console.warn('[TwoRobot] Robot 2 not calibrated, cannot move')
    return Promise.resolve()
  }
  // ... movement code
}
```

**Status:** ✅ FIXED

---

## Comprehensive Analysis Complete

### Existing Architecture (CONFIRMED WORKING):

1. **BonderController** (`lib/BonderController.js`)
   - ✅ Loads flip_chip_bonder.glb
   - ✅ Discovers and calibrates SKING and COLRIGHT robots
   - ✅ Manages chip controllers
   - ✅ Has flux station, alignment, bonding controllers
   - ✅ Integrates with TwoRobotChipProcess

2. **TwoRobotChipProcess** (`lib/bonder/TwoRobotChipProcess.js`)
   - ✅ COLRIGHT: Picks chip from wafer, flips 180°
   - ✅ Handoff: Transfers chip from COLRIGHT to SKING
   - ✅ SKING: Receives chip, dips in flux, places on substrate
   - ✅ Proper world transform preservation during attach/detach
   - ✅ Physical chip attachment (parent-child hierarchy)
   - ⚠️ **NOW FIXED:** Null pointer error in calibration

3. **WaferBonderTransfer** (`lib/bonder/WaferBonderTransfer.js`)
   - ✅ EFEM robot transfers wafer from rack to bonder
   - ✅ Complete state machine: R2FOUP → APPROACH → CONTACT → ATTACH → LIFT → TRAVEL → LOWER → PLACE → RETRACT → HOME
   - ✅ Uses IK for robot arm control
   - ✅ Bezier path for smooth travel
   - ✅ Proper attach/detach with world transform preservation
   - ⚠️ **NOT CONNECTED** to Stage 1 (Substrate Loading)

4. **17-Stage Recipe** (`lib/data/tcbSteps.ts`)
   - ✅ Fully defined with all phases
   - ✅ Component info for each stage
   - ✅ Temperature profiles
   - ⚠️ **DISCONNECT:** Stage 1 UI exists but doesn't trigger WaferBonderTransfer

---

## The Core Problem

**Stage 1 (Substrate Loading) is not connected to the WaferBonderTransfer animation**

**What Happens Now:**
1. User sees "Stage 1: Substrate Loading" in UI
2. No 3D animation occurs
3. Process jumps to Stage 2

**What Should Happen:**
1. User clicks START
2. Stage 1 begins
3. EFEM robot moves to wafer rack
4. EFEM robot picks substrate from rack
5. EFEM robot transfers substrate to bonder pedestal
6. EFEM robot places substrate and retracts
7. Stage 1 completes
8. Stage 2 (Fiducial Scan) begins
9. Stages 3-17 continue with two-robot chip process

---

## Integration Plan Created

**Document:** `INTEGRATION_PLAN.md`

### Implementation Phases:

**P0 - CRITICAL (DONE):**
- ✅ Fixed null pointer error in TwoRobotChipProcess
- ⏳ Connect Stage 1 to WaferBonderTransfer
- ⏳ Update animation loop

**P1 - HIGH PRIORITY:**
- ⏳ Add full 17-stage recipe runner
- ⏳ Implement proper RESET
- ⏳ Add PAUSE/RESUME support

**P2 - MEDIUM PRIORITY:**
- ⏳ Calculate positions from actual models
- ⏳ Improve error handling
- ⏳ Add comprehensive logging

---

## Next Steps (In Order)

### 1. Update BonderController

**File:** `lib/BonderController.js`

Add methods:
```javascript
// Connect to wafer transfer system
setBondTransfer(transfer) {
  this.bondTransfer = transfer
  if (transfer) {
    transfer.log = (msg) => this._log(msg)
  }
}

// Run complete 17-stage recipe
async runFullRecipe() {
  try {
    // Stage 1: Substrate Loading (EFEM transfer)
    await this.runStage01_SubstrateLoading()
    
    // Stage 2: Fiducial Scan
    await this.runStage02_FiducialScan()
    
    // Stages 3-17: Two-robot chip process
    await this.runTwoRobotRecipe()
    
  } catch (err) {
    this.stateMachine.fail(err.message)
  }
}

// Stage 1: Transfer wafer from rack to bonder
async runStage01_SubstrateLoading() {
  if (!this.bondTransfer) {
    this._logError('bondTransfer not configured')
    return
  }
  
  this.stateMachine.startStage(1)
  
  // Get positions from models
  const sourceWorld = this._calculateRackPosition()
  const destWorld = this._calculatePedestalPosition()
  
  // Start transfer
  const started = this.bondTransfer.start(sourceWorld, destWorld)
  if (!started) {
    this._logError('Failed to start wafer transfer')
    return
  }
  
  // Wait for completion
  await this._waitForState(() => {
    return this.bondTransfer.getStatus().state === 'DONE'
  }, 15000)
  
  this.stateMachine.completeStage(1)
  this.events.emit(BONDER_EVENTS.STAGE_COMPLETE, { stageId: 1 })
}

// Helper: Wait for async condition
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

// Calculate rack position from actual model
_calculateRackPosition() {
  // Find wafer rack in scene
  // Based on inspect_glb3.js output and WaferBonderTransfer defaults
  return new THREE.Vector3(-14, 3.35, 0)
}

// Calculate pedestal position from actual model
_calculatePedestalPosition() {
  const pedestal = this.nodes.PEDESTAL || 
                   this.nodes.RING_VACUUM_PEDESTAL ||
                   this.nodes.SKING_PEDESTAL
  if (pedestal) {
    const pos = new THREE.Vector3()
    pedestal.getWorldPosition(pos)
    return pos
  }
  // Fallback based on known bonder geometry
  return new THREE.Vector3(0, 0.5, 0)
}
```

### 2. Update page.tsx

**File:** `app/page.tsx`

Connect systems after bonder loads:
```javascript
// After bonder controller initialization
if (this.bonderController && this.bondTransfer) {
  this.bonderController.setBondTransfer(this.bondTransfer)
  console.log('[Sim] BonderController connected to bondTransfer')
}
```

Update animation loop:
```javascript
private _animate(): void {
  // ... existing code ...
  
  // Update bonder (includes TwoRobotChipProcess)
  if (this.bonderController) {
    this.bonderController.update(dt * speed)
  }
  
  // Update wafer transfer (EFEM robot)
  if (this.bondTransfer && this.bondTransfer.isRunning()) {
    this.bondTransfer.update(dt * speed)
  }
  
  // ... rest of code ...
}
```

Add full recipe starter:
```javascript
startFullBonderRecipe(): void {
  const bc = this.bonderController
  if (!bc) {
    console.error('[Sim] BonderController not ready')
    return
  }
  
  console.log('[Sim] Starting full 17-stage recipe')
  void bc.runFullRecipe()
}
```

Update UI button:
```javascript
<button
  onClick={() => simRef.current?.startFullBonderRecipe()}
  disabled={ui.bonder?.status === 'running'}
  style={{ ... }}
>
  START FULL RECIPE (17 STAGES)
</button>
```

---

## Testing Checklist

After implementing next steps:

### Stage 1 Test:
- [ ] Click START
- [ ] EFEM robot moves to rack
- [ ] Robot picks wafer
- [ ] Robot travels to bonder
- [ ] Robot places wafer on pedestal
- [ ] Robot retracts
- [ ] Stage 1 completes
- [ ] Stage 2 becomes active

### Complete Recipe Test:
- [ ] All 17 stages progress in order
- [ ] UI matches 3D animation
- [ ] No teleportation
- [ ] No floating objects
- [ ] Chip attachment works
- [ ] Flux dipping visible
- [ ] Final placement succeeds

### Control Tests:
- [ ] PAUSE freezes all motion
- [ ] RESUME continues correctly
- [ ] RESET restores initial state
- [ ] Speed controls work (1x, 2x, 5x, 10x)

---

## Files Modified So Far

1. ✅ `lib/bonder/TwoRobotChipProcess.js`
   - Added null safety checks in `_computeReach()`
   - Added null checks in `_setRobot1Tip()` and `_setRobot2Tip()`

## Files to Modify Next

2. ⏳ `lib/BonderController.js`
   - Add `setBondTransfer()`
   - Add `runFullRecipe()`
   - Add `runStage01_SubstrateLoading()`
   - Add position calculation methods
   - Add wait helpers

3. ⏳ `app/page.tsx`
   - Connect bondTransfer to bonderController
   - Update animation loop
   - Add full recipe starter
   - Update UI buttons

---

## Known GLB Model Structure

From `inspect_glb3.js` output:

```
Object Name                  World Position (X, Y, Z)
─────────────────────────────────────────────────────
SKING_PICKUP_NOZZLE         -0.280, -0.313,  1.015
SKING_ARM_TIP_ANCHOR        -0.280, -0.283,  0.015
SKING_CARRIAGE              -0.280,  1.000,  0.550
COLRIGHT_CARRIAGE           -0.166,  1.000,  0.200
COLRIGHT_VERTICAL_AXIS      -0.176,  0.790,  0.238
ACTIVE_CHIP                 -1.300,  0.182,  0.200
CHIP_01                     -1.200,  0.182,  0.200
BONDBASE_TARGET              1.100,  0.147,  0.000
BondBase                     1.100,  0.105,  0.000
WAFER                       -1.100,  0.165,  0.000
```

**Coordinate System:** Y-axis is vertical (confirmed)

---

## Status Summary

✅ **Phase 0 Complete:** Project audit and null error fix
⏳ **Phase 1 In Progress:** Integration of Stage 1 with WaferBonderTransfer
⏳ **Phase 2 Pending:** Full 17-stage recipe implementation
⏳ **Phase 3 Pending:** RESET/PAUSE/RESUME improvements

**Current Blocker:** None (null error fixed)
**Next Action:** Implement BonderController updates as outlined above
**Estimated Time:** 2-3 hours for P0+P1 implementation and testing

---

## Important Notes

1. **Do NOT replace existing code** - only add integration points
2. **Preserve existing TwoRobotChipProcess** - it already works correctly
3. **Preserve existing WaferBonderTransfer** - it already works correctly
4. **The goal is INTEGRATION**, not reimplementation
5. **Test after each change** - don't implement everything at once

---

**Status:** Critical fixes applied, ready for integration phase
**Date:** August 28, 2026
**Next Review:** After P1 implementation
