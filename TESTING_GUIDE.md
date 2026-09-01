# TESTING & DEBUGGING GUIDE

## Browser Console Output to Expect

When the application loads with the GLB robot, you should see these logs:

```
GLB loaded! Nodes found: [list of node names...]
Joints bound: {
  baseRotation: true,
  zLift: true,
  shoulderA: true,
  elbowA: true,
  extensionA: true,
  shoulderB: true,
  elbowB: true,
  extensionB: true
}
=== ROBOT JOINT TEST ===
baseRotation: Joint_Base_Rotation | parent: Robot_Master_Control
zLift: Joint_Z_Lift | parent: Joint_Base_Rotation
shoulderA: Joint_Shoulder_A | parent: Joint_Z_Lift
elbowA: Joint_Elbow_A | parent: Joint_Shoulder_A
extensionA: Joint_Extension_A | parent: Joint_Elbow_A
shoulderB: Joint_Shoulder_B | parent: Joint_Z_Lift
elbowB: Joint_Elbow_B | parent: Joint_Shoulder_B
extensionB: Joint_Extension_B | parent: Joint_Elbow_B
```

**If you see these logs**: ✅ Joint mapping is working correctly

---

## Common Issues & Solutions

### Issue 1: Robot Doesn't Move
**Symptom**: Robot loads but arm doesn't respond to IK targets

**Diagnosis**:
```js
// In console, check if nodes are bound:
console.log('Nodes found:', !!window.robotEFEM?.shoulderA);
console.log('Shoulder A:', window.robotEFEM?.shoulderA);
```

**Likely Causes**:
1. GLB file not found → Check network tab for `/roboticarm.glb` 404 error
2. Joint names don't match → Compare console logs with expected names
3. IK not being called → Check if `robot.runIK()` is invoked in animation loop

**Fix**:
- Verify GLB is in `/public/roboticarm.glb`
- Check that joint names in GLB exactly match code expectations
- Add console.log in `runIK()` to verify it's being called

---

### Issue 2: Arm Rotates on Wrong Axis
**Symptom**: Base spins up/down instead of left/right; shoulder lifts instead of rotating

**Diagnosis**:
```js
// Before fix: rotations were applied to Z-axis
shoulder.rotation.z = angle; // ❌ WRONG

// After fix: rotations on Y-axis
shoulderA.rotation.y = angle; // ✅ CORRECT
```

**Root Cause**: Old code was using Z-axis for all rotations (Blender Z-up assumption)

**Verification**:
1. Set IK target directly to the right of robot (X+)
2. Base should rotate left (negative Y) to face target
3. If base rotates up instead → Still using wrong axis

**Fix**: Already applied in the code. If still wrong, check that `baseRotation`, `shoulderA`, etc. are actually being manipulated (not old `turret`, `shoulder` names).

---

### Issue 3: Wafer Clips Through Fork
**Symptom**: Wafer sinks into fork geometry when grabbed

**Diagnosis**:
```js
// The offset calculation:
const offset = new THREE.Vector3(0.4, 0.004, 0);
offset.applyQuaternion(forkWorldQuat);
forkWorldPos.add(offset);
forkWorldPos.y += 0.002; // This prevents clipping
```

**Likely Causes**:
1. Offset vector is wrong (0.4, 0.004, 0) doesn't match actual fork dimensions
2. Fork frame orientation is inverted
3. Wafer mesh origin is not centered

**Diagnostic Steps**:
1. Log the wafer position after attachment:
   ```js
   console.log('Wafer at:', sm.mesh.position.toArray());
   console.log('Fork at:', robot.extensionA.getWorldPosition(new THREE.Vector3()).toArray());
   ```
2. Manually adjust offset values in the code:
   - Increase X: `new THREE.Vector3(0.5, ...)`  (move further out)
   - Increase Y: `forkWorldPos.y += 0.005;` (lift higher)

**Fix**: Edit the offset vector in `attachTo()` and frame loop section

---

### Issue 4: Wafer Drifts or Teleports
**Symptom**: Wafer jumps around or lags behind arm motion

**Diagnosis**:
```js
// The frame loop sync code:
sm.mesh.position.lerp(forkWorldPos, 0.15);
sm.mesh.quaternion.slerp(forkWorldQuat, 0.15);
```

**Likely Causes**:
1. Lerp factor (0.15) is too low/high → adjust interpolation speed
2. extensionA joint doesn't exist → wafer stays in world space
3. Position/quaternion not recalculated each frame

**Diagnostic Steps**:
1. Check if extensionA is moving:
   ```js
   setInterval(() => {
     const pos = new THREE.Vector3();
     robot.extensionA.getWorldPosition(pos);
     console.log('extensionA:', pos.toArray());
   }, 100);
   ```
2. Verify frame loop is running at 60 FPS

**Fix Options**:
- Increase lerp factor for snappier motion: `0.25` instead of `0.15`
- Decrease for smoother motion: `0.08` instead of `0.15`
- Ensure extensionA is being transformed by parent joints

---

### Issue 5: Z-Lift Doesn't Work
**Symptom**: Robot can't raise/lower arm vertically

**Diagnosis**:
```js
// Z-lift code:
zLift.position.y = THREE.MathUtils.lerp(currentZ, Math.max(0, Math.min(0.35, targetZ)), 0.1);
```

**Likely Causes**:
1. zLift node not found → fallback empty group created
2. IK target Y coordinate not being set correctly
3. Lerp factor too small → motion too slow to see

**Diagnostic Steps**:
1. Manually test the zLift:
   ```js
   robot.zLift.position.y = 0.2;  // Should move arm up
   ```
2. Check if target Y values are being passed to runIK()

**Fix**:
- Verify zLift node exists: check console logs
- Increase lerp factor: `0.25` instead of `0.1` for faster motion
- Debug IK target Y values being set

---

### Issue 6: Wafer Doesn't Attach
**Symptom**: Pick command runs but wafer stays in place

**Diagnosis**:
```js
// Attachment code creates wafer parent-child relationship:
robot.extensionA.attach(this.mesh);
```

**Likely Causes**:
1. extensionA doesn't exist → attach fails silently
2. robot object is null when attachTo() called
3. Wafer mesh is already parented elsewhere

**Diagnostic Steps**:
1. Check that robot object exists:
   ```js
   console.log('Robot:', !!this.carrierRobot);
   console.log('extensionA:', !!this.carrierRobot?.extensionA);
   ```
2. Add logs in attachTo():
   ```js
   console.log('[ATTACH] Attaching wafer to', robot.extensionA.name);
   ```

**Fix**:
- Verify robot is passed to attachTo()
- Check that extensionA joint exists and is accessible
- Ensure wafer mesh is not already attached to another parent

---

### Issue 7: Joint Angles Wrong in UI Display
**Symptom**: UI shows joint angles that don't match visual arm position

**Diagnosis**:
```js
// getJoints() returns current state:
return {
  base:     { c: baseRotation.rotation.y },
  shoulderA: { c: shoulderA.rotation.y },
  ...
};
```

**Likely Causes**:
1. Still reading from old node names (turret instead of baseRotation)
2. Reading from wrong axis (rotation.x instead of rotation.y)

**Verification**:
- Physically move the robot manually in scene
- UI joint display should update in real time
- If UI shows wrong values, check getJoints() implementation

**Fix**: Already applied. If still wrong, verify that the exact joint references are used in getJoints().

---

## Manual Testing Procedure

### Test 1: Joint Loading
```
1. Open browser DevTools (F12)
2. Open Application in browser
3. Check console for "JOINT TEST" logs
4. Verify all 8 joints are listed as "true"
```

### Test 2: Base Rotation
```
1. Use IK waypoint selector to place target to the right (+X)
2. Robot should rotate counter-clockwise (negative Y rotation)
3. Observe shoulder/elbow stay bent at same angle
4. Base only rotates, no other motion
```

### Test 3: Arm Reach
```
1. Place IK target in front of robot (base rotation ~0)
2. Target should be reachable (within 2m)
3. Shoulder and elbow should bend to reach
4. Arm should NOT flip or invert
```

### Test 4: Z-Lift
```
1. Trigger move to elevated position (Y > 0.5)
2. Watch Z-lift joint raise the arm
3. Motion should be smooth and continuous
4. Arm should stop at target height
```

### Test 5: Pick/Place
```
1. Use UI to trigger pick-place sequence
2. Robot should move to source slot
3. Wafer should attach without jump
4. Robot should carry wafer to destination
5. Wafer should detach cleanly
```

### Test 6: Performance
```
1. Open DevTools > Performance tab
2. Record 5-10 seconds of motion
3. Check FPS: should be 50-60 FPS
4. Look for frame drops or stutters
5. Check main thread CPU usage: should be < 30%
```

---

## Advanced Debugging

### Enable Extra Console Logs
```js
// Add to runIK function:
console.log('IK Target:', tgt.toArray());
console.log('Base rotation Y:', baseRotation.rotation.y);
console.log('Shoulder A Y:', shoulderA.rotation.y);
console.log('Elbow A Y:', elbowA.rotation.y);
```

### Visualize Joint Hierarchy
```js
// In browser console:
function showHierarchy(obj, indent = 0) {
  const prefix = '  '.repeat(indent);
  console.log(`${prefix}${obj.name} (${obj.type})`);
  obj.children.forEach(child => showHierarchy(child, indent + 1));
}
showHierarchy(window.robotEFEM.group);
```

### Check Joint World Positions
```js
// In browser console:
const pos = new THREE.Vector3();
window.robotEFEM.extensionA.getWorldPosition(pos);
console.log('extensionA world position:', pos);

const quat = new THREE.Quaternion();
window.robotEFEM.extensionA.getWorldQuaternion(quat);
console.log('extensionA world quaternion:', quat);
```

### Monitor Animation Loop
```js
// Add to _loop function:
const startTime = performance.now();
// ... existing loop code ...
const endTime = performance.now();
console.log(`Frame time: ${(endTime - startTime).toFixed(1)}ms`);
```

---

## Performance Profiling

### Identify Bottlenecks
1. DevTools > Performance > Record
2. Look for "purple" (scripting) blocks > 10ms
3. Click on spikes to see which function is slow
4. Common culprits:
   - Wafer state machine ticking
   - Multiple vector allocations in IK
   - Physics/collision calculations

### Memory Leaks
1. DevTools > Memory > Take Snapshot
2. Filter by "Wafer" or "Three"
3. Compare snapshots after pick/place cycles
4. Growing arrays = memory leak

---

## Rollback Instructions

If something breaks and you need to revert:

1. **Specific Patch**: 
   - Find the patch in ANALYSIS_AND_FIXES.md
   - Copy "REPLACE" code
   - Use Find & Replace to swap

2. **Full Rollback**:
   - Use Git: `git checkout app/page.tsx`
   - Or restore from backup

---

## Success Indicators ✅

You'll know the fixes are working when you see:

1. ✅ Console logs show all 8 joints are bound
2. ✅ Robot base rotates on Y-axis (left/right)
3. ✅ Shoulder/elbow rotate on Y-axis (bend)
4. ✅ Z-lift moves smoothly (up/down)
5. ✅ Wafers attach without teleporting
6. ✅ Wafers follow arm motion during transport
7. ✅ No clipping through fork geometry
8. ✅ Frame rate stays above 50 FPS
9. ✅ All wafers successfully complete pick/place

