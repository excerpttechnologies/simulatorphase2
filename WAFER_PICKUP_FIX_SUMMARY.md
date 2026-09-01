# Wafer Pickup Position Fix - Summary

## Problem
The robot was stopping to pick up the wafer from a position **too far forward** (at the FOUP front edge, Z=2.2) instead of reaching into the FOUP to the actual wafer location (Z=0.35 inside the FOUP).

```
WRONG (before):
    WAFER
    |
    |       (actual wafer inside FOUP)
    |
    X       (robot picking here - TOO FAR FORWARD)
        (too far away from actual wafer)

CORRECT (after):
    WAFER
    X       (robot end effector aligned HERE)
    |
    |       (only 0.47m from back of FOUP opening)
```

## Root Cause
Multiple issues in the coordinate system:

1. **Pickup anchor position was wrong**: Set to `(0, 1.15, 2.2)` - near the FOUP front edge, not at the wafer
2. **Approach target was wrong**: Set to `(0, 1.15, 2.7)` - even further forward
3. **Function overriding positions**: `startBonderWaferTransfer()` was forcing all sources to `WAFER_TRANSFER_Y = 3.35` (conveyor height), completely ignoring the FOUP's actual Y position

## Solution Implemented

### 1. Fixed Pickup Anchor Position
**File**: `app/page.tsx` (lines 9219-9232)

Changed pickup anchor from:
```typescript
// WRONG: Far forward at FOUP opening
pickupAnchor.position.set(0, 1.15, 2.2);
rackApproachTarget.position.set(0, 1.15, 2.7);
```

To:
```typescript
// CORRECT: Aligned with actual first wafer slot inside FOUP
pickupAnchor.position.set(0, 0.55, 0.47);     // Actual wafer slot Y + tool offset
rackApproachTarget.position.set(0, 0.55, 0.75);  // Safe approach point deeper inside
```

**Why these values?**
- Y = 0.55: First wafer slot vertical position (stack[0] is at 0.55 + 0 * 0.42 = 0.55)
- Z = 0.35: Where wafers actually sit inside FOUP
- Z = 0.47: Add 0.12m offset for gripper tool clearance to reach wafer center
- Approach Z = 0.75: Further back (0.28m behind pickup) for robot entry path

### 2. Fixed Procedural FOUP Section
**File**: `app/page.tsx` (lines 3405-3421)

Applied same fix to the procedurally-generated FOUP configuration for consistency.

### 3. Fixed `startBonderWaferTransfer()` Function
**File**: `app/page.tsx` (lines 12496-12518)

**Before** (WRONG):
```typescript
const anchors = foupGrp?.userData?.slotAnchors as THREE.Object3D[] | undefined;
const source = new THREE.Vector3();
if (anchors?.[0]) {
  anchors[0].getWorldPosition(source);
  source.y = WAFER_TRANSFER_Y;  // ❌ OVERRIDE with conveyor height (3.35)!
} else {
  source.set(ALL_STEPS[0].x + 4.0, WAFER_TRANSFER_Y, ALL_STEPS[0].z);
}
// More overrides...
source.x = Math.max(source.x, ALL_STEPS[0].x + 5.5);
source.y = WAFER_TRANSFER_Y;  // ❌ Force to wrong height
source.z = ALL_STEPS[0].z;    // ❌ Reset to track Z
```

**After** (CORRECT):
```typescript
const pickupAnchor = foupGrp?.userData?.pickupAnchor as THREE.Object3D | undefined;
const source = new THREE.Vector3();

if (pickupAnchor) {
  // Get actual world position of pickup anchor (inside FOUP)
  pickupAnchor.getWorldPosition(source);
  
  // Add small forward offset for gripper reach
  const foupFrontDir = foupGrp?.userData?.rackFrontDirection as THREE.Vector3 | undefined;
  if (foupFrontDir) {
    source.addScaledVector(foupFrontDir, 0.15);  // 150mm forward
  }
  
  this._addLog(`[WAFER PICK] Using actual FOUP pickup anchor at ...`, 'debug');
} else {
  source.set(ALL_STEPS[0].x + 4.0, 0.55, ALL_STEPS[0].z);  // Fallback
}
```

## Key Changes Summary

| Aspect | Before | After |
|--------|--------|-------|
| **Pickup Y** | 1.15 (wrong height) | 0.55 (actual wafer slot) |
| **Pickup Z** | 2.2 (far forward) | 0.47 (inside FOUP + tool offset) |
| **Approach Y** | 1.15 | 0.55 |
| **Approach Z** | 2.7 (even more forward) | 0.75 (safe entry) |
| **Robot behavior** | Stops far from wafer | Enters FOUP and reaches actual wafer |

## Coordinate System
- **FOUP Frame**: Local +Z points toward robot (after 90° rotation)
- **Wafer Slots**: Located at Z = 0.35 (deep inside FOUP)
- **FOUP Opening**: Front edge at Z ≈ 1.35-1.4
- **Robot Approach**: Z = 0.75 (safe depth to enter)
- **Pickup Point**: Z = 0.47 (with gripper offset for tool reach)

## Expected Behavior After Fix
1. ✅ Robot starts at home position
2. ✅ Robot moves to FOUP safely (no collision)
3. ✅ Robot approaches from **deeper position** (Z = 0.75)
4. ✅ Robot enters FOUP opening correctly
5. ✅ Robot reaches actual wafer position (Z = 0.47)
6. ✅ Robot end-effector aligns with wafer center
7. ✅ Gripper engages wafer
8. ✅ Wafer is lifted from FOUP
9. ✅ Robot transfers wafer to bonder pedestal
10. ✅ Wafer is placed on circular work surface
11. ✅ Stage 01 begins after placement verification

## Testing the Fix
1. Open the simulator in browser
2. Click **START** button
3. Watch the robot movement to FOUP:
   - ✅ Robot should approach from a deeper position
   - ✅ Robot should NOT stop at the far front
   - ✅ Robot should enter the FOUP opening
   - ✅ End-effector should visibly reach the wafer
4. Verify wafer picks up cleanly and transfers to bonder

## Files Modified
- `app/page.tsx` - Three locations:
  1. Line 9219-9232: Main FOUP pickup anchor fix
  2. Line 3405-3421: Procedural FOUP section fix  
  3. Line 12496-12518: `startBonderWaferTransfer()` function fix

## Build Status
✅ **Build successful** - No compilation errors after changes

## Notes
- No changes to robot model or FOUP geometry
- No changes to process flow or stages
- All changes are coordinate/position corrections only
- Fallback positions maintained for robustness
- Debug logging added to help diagnose any remaining issues
