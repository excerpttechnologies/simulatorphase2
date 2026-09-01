# MASTER FIX ANALYSIS — page.tsx SCARA Robot Integration

## ANALYSIS SECTION

### 1. **EXISTING ROBOT REFS — WRONG NODE NAMES**

**PROBLEM:** Current code searches for `Bone`, `Bone001`, `Bone002`, etc. but the verified GLB hierarchy uses:
- `Joint_Base_Rotation`
- `Joint_Z_Lift`
- `Joint_Shoulder_A` / `Joint_Shoulder_B`
- `Joint_Elbow_A` / `Joint_Elbow_B`
- `Joint_Extension_A` / `Joint_Extension_B`

**IMPACT:** Nodes are never found; fallback `new THREE.Group()` is created and invisible/non-functional. Robot appears loaded but doesn't move.

**LOCATION:** Line ~7195-7203

---

### 2. **ANIMATION SYSTEM — OBSOLETE IK IMPLEMENTATION**

**PROBLEM:** 
- Current `runIK()` uses Z-axis rotations: `shoulder.rotation.z = shoulderAngle`
- GLB hierarchy specifies **Y-axis rotations** for SCARA joints
- IK math includes extraneous `+Math.PI` offset and delta-smoothing that breaks direct positioning
- Code targets wrong variables (`turret`, `shoulder`, `elbow`, `wrist` instead of correct joint names)

**IMPACT:** IK calculations are correct in math but apply to wrong axes and wrong joint objects. Arm never moves.

**LOCATION:** Line ~7222-7270 (runIK function)

---

### 3. **WAFER LOGIC — INCOMPLETE ATTACHMENT**

**PROBLEM:**
- `attachTo()` method exists but references obsolete `gripper` reference (which doesn't exist in correct mapping)
- No world-space transform synchronization for wafer during motion
- Wafer parenting via `gripper.attach(mesh)` works BUT gripper joint doesn't exist

**IMPACT:** Wafers can't be picked up or moved. They remain floating or don't follow robot.

**LOCATION:** Line ~8908-8945 (attachTo method)

---

### 4. **COORDINATE SYSTEM — Z-UP BLENDER ASSUMPTIONS**

**PROBLEM:**
- Old code applies rotations on Z axis assuming Blender Z-up export
- GLB hierarchy clearly uses Y-up (standard THREE.js)
- No quaternion normalization safeguards
- Base rotation includes `+Math.PI` correction that doesn't match actual GLB orientation

**IMPACT:** All joint rotations apply to wrong axes; arm geometry doesn't follow bone animation.

**LOCATION:** Throughout `runIK()` and bone access patterns

---

### 5. **GLB HIERARCHY MISUSE — WRONG BONE NAMES**

**PROBLEM:**
- `Bone001` ≠ `Joint_Shoulder_A`
- Code searches for generic names; GLB uses semantic names
- If any Bone nodes exist in GLB, code will incorrectly bind to them instead of correct joints
- No name validation or fallback warning

**IMPACT:** Even if node matching works, wrong meshes/groups are manipulated.

**LOCATION:** Line ~7195-7203 (node binding)

---

### 6. **BROKEN GLTF ANIMATIONS**

**PROBLEM:**
- Code comments mention `useAnimations()` and `AnimationMixer` (commented out)
- No animation cleanup or proper bone-driven animation setup
- The code tries to use hand-written IK instead of baked animations (correct approach)
- BUT hand-written IK is broken (wrong axes + wrong node refs)

**IMPACT:** Robot doesn't animate at all because both paths are broken.

**LOCATION:** Line ~7289 onward (animation test)

---

### 7. **WAFER ATTACHMENT — NO WORLD TRANSFORM SYNC**

**PROBLEM:**
- `attachTo()` snapshots gripper position once but doesn't track it per-frame
- Wafer is parented and moves, but no explicit world-space offset applied
- `extensionA` (the actual fork/end-effector) is never used for wafer positioning
- Wafer clipping through fork because no upward offset is applied

**IMPACT:** Wafer moves erratically or clips through robot arm during motion.

**LOCATION:** Line ~8908-8945

---

### 8. **MOTION SEQUENCING — DELTA-BASED SMOOTHING BREAKS IK**

**PROBLEM:**
- `_animRobots()` applies delta-rotation smoothing on top of IK results
- This causes arm to lag behind IK target and creates jitter
- Each frame increments rotation instead of setting absolute position
- Smooth motion exists but it's fighting against IK

**IMPACT:** Robot arm oscillates or lags instead of reaching target precisely.

**LOCATION:** Line ~9115-9150 (_animRobots method)

---

### 9. **ROTATION AXIS PROBLEMS — Z-AXIS NOT Y-AXIS**

**PROBLEM:**
```js
shoulder.rotation.z = shoulderAngle;  // WRONG — should be .y
```
All SCARA joints rotate on Y-axis (vertical spin axis), not Z.

**IMPACT:** If nodes were found, they'd rotate on wrong axis and appear frozen.

**LOCATION:** Line ~7260-7265 in runIK

---

### 10. **JOINT LIMITS — NOT ENFORCED**

**PROBLEM:**
- IK has some clamping but it's inconsistent
- Base rotation clamped to ±90° but should be ±π
- Z-lift not clamped to 0→0.35 range
- Shoulder/elbow limits missing

**IMPACT:** Arm can flip to unrealistic poses; Z-lift doesn't respect physical bounds.

**LOCATION:** Line ~7252-7265

---

### 11. **R3F RENDERING — NOT OPTIMIZED**

**PROBLEM:**
- Heavy object allocations inside `runIK()` every frame
- No temp vector reuse
- Quaternion.setFromEuler() called frequently without pooling
- Matrix calculations redundant

**IMPACT:** Memory churn; GC pauses; frame drops.

**LOCATION:** Throughout runIK and _animRobots

---

### 12. **SHADOWS — PARTIALLY SET**

**PROBLEM:**
- Shadows enabled in buildRobotGLB mesh setup
- But only on load-time meshes
- Wafer shadows state not controlled
- Cast/receive flags inconsistent

**IMPACT:** Visual inconsistency; wafer may not cast shadow or may be overlit.

**LOCATION:** Line ~7177-7185

---

### 13. **MATERIAL REPAIR — GLTF MATERIALS DARK**

**PROBLEM:**
- LED color applied only to specific named materials
- No envMap or metalness adjustment for robot body
- Materials may be too dark if GLB doesn't include proper textures

**IMPACT:** Robot appears dark/invisible in scene.

**LOCATION:** Line ~7179-7185

---

### 14. **CAMERA TARGET — NODES IGNORED**

**PROBLEM:**
- CameraTarget nodes exist but aren't used
- Camera is hardcoded to look at (0, 0, 0)
- No dynamic focus on robot

**IMPACT:** Robot may be off-center or out of view; not critical but poor UX.

**LOCATION:** Not critical; canvas camera setup elsewhere

---

### 15. **WAFER_NOTCH — DETACHED MESH**

**PROBLEM:**
- GLB contains orphan `Wafer_Notch` mesh
- Current code doesn't hide it
- Should be hidden and notch created procedurally on wafer

**IMPACT:** Extra geometry visible; visual clutter.

**LOCATION:** Not currently handled; should be in GLB loading

---

### 16. **COORDINATE SYSTEM MISMATCH**

**PROBLEM:**
- Root rotation is `root.rotation.y = Math.PI` (180° inversion)
- But IK calculations add `+Math.PI` assuming this state
- When correct joint nodes are used, this offset becomes redundant/wrong
- No clear documentation of coordinate frame

**IMPACT:** Base rotation calculations will be inverted when using correct nodes.

**LOCATION:** Line ~7147 (root.rotation.y = Math.PI)

---

## REQUIRED PATCHES

### **PATCH 1 — FIX JOINT NODE MAPPING** (Line ~7195-7210)

**REPLACE:**
```js
const turret   = (byName['Bone']    ?? new THREE.Group()) as THREE.Group;
const shoulder = (byName['Bone001'] ?? new THREE.Group()) as THREE.Group;
const upperArm = (byName['Bone002'] ?? new THREE.Group()) as THREE.Group;
const elbow    = (byName['Bone003'] ?? new THREE.Group()) as THREE.Group;
const foreArm  = (byName['Bone004'] ?? new THREE.Group()) as THREE.Group;
const wrist    = (byName['Bone005'] ?? new THREE.Group()) as THREE.Group;
const gripper  = (byName['Bone006'] ?? new THREE.Group()) as THREE.Group;
```

**WITH:**
```js
// FIX 1: Use correct joint names from verified GLB hierarchy
const baseRotation   = (byName['Joint_Base_Rotation']   ?? new THREE.Group()) as THREE.Group;
const zLift          = (byName['Joint_Z_Lift']          ?? new THREE.Group()) as THREE.Group;
const shoulderA      = (byName['Joint_Shoulder_A']      ?? new THREE.Group()) as THREE.Group;
const elbowA         = (byName['Joint_Elbow_A']         ?? new THREE.Group()) as THREE.Group;
const extensionA     = (byName['Joint_Extension_A']     ?? new THREE.Group()) as THREE.Group;
const shoulderB      = (byName['Joint_Shoulder_B']      ?? new THREE.Group()) as THREE.Group;
const elbowB         = (byName['Joint_Elbow_B']         ?? new THREE.Group()) as THREE.Group;
const extensionB     = (byName['Joint_Extension_B']     ?? new THREE.Group()) as THREE.Group;
```

---

### **PATCH 2 — FIX BASE ROTATION AXIS** (Line ~7222-7240)

**REPLACE:**
```js
function runIK(tgt: THREE.Vector3): void {
  // 1. Base yaw — corrected for GLB inversion (root.rotation.y = π)
  const baseWP = new THREE.Vector3();
  root.getWorldPosition(baseWP);
  const dx = tgt.x - baseWP.x;
  const dz = tgt.z - baseWP.z;
  let rawYaw = Math.atan2(dx, dz) + Math.PI;
  rawYaw = normalizeAngle(rawYaw);

  // Shortest-path turret with ±90° clamp
  const restY = 0;
  let delta = normalizeAngle(rawYaw - turret.rotation.y);
  delta = Math.max(-Math.PI / 2, Math.min(Math.PI / 2, delta));
  turret.rotation.y = normalizeAngle(turret.rotation.y + delta);
```

**WITH:**
```js
function runIK(tgt: THREE.Vector3): void {
  // FIX 2: Base rotation on Y axis (SCARA theta axis)
  const baseWP = new THREE.Vector3();
  root.getWorldPosition(baseWP);
  const dx = tgt.x - baseWP.x;
  const dz = tgt.z - baseWP.z;
  let rawYaw = Math.atan2(dx, dz);
  rawYaw = normalizeAngle(rawYaw);
  // Clamp base rotation to prevent unrealistic inversion
  baseRotation.rotation.y = Math.max(-Math.PI, Math.min(Math.PI, rawYaw));
```

---

### **PATCH 3 — FIX Z-LIFT APPLICATION** (After line ~7240)

**ADD AFTER base rotation code:**
```js
  // FIX 3: Z-lift - apply vertical motion via position.y
  // Calculate target height and apply with smooth interpolation
  const targetZ = tgt.y;
  const currentZ = zLift.position.y;
  zLift.position.y = THREE.MathUtils.lerp(currentZ, Math.max(0, Math.min(0.35, targetZ)), 0.1);
```

---

### **PATCH 4 — FIX SHOULDER/ELBOW ROTATION** (Line ~7241-7265)

**REPLACE:**
```js
  // 2. Convert target to turret-local
  const localTgt = turret.worldToLocal(tgt.clone());

  // ... existing IK math ...

  // 7. Apply on Z axis (Blender-exported bones bend on Z)
  shoulder.rotation.z = shoulderAngle;
  elbow.rotation.z = elbowAngle;

  // 8. Wrist keeps blade horizontal ...
  const totalPitch = shoulderAngle + elbowAngle;
  let wristAngle = -totalPitch;
  // Apply industrial -15° tilt during low-Y placement (chuck height ≈ 0.93)
  const isPlacing = Math.abs(localTgt.y - 0.93) < 0.25;
  if (isPlacing) wristAngle += -0.26; // -15° downward tilt for flush placement
  wrist.rotation.z = Math.max(-Math.PI / 2, Math.min(Math.PI / 2, wristAngle));
}
```

**WITH:**
```js
  // FIX 4: Shoulder/Elbow rotation on Y axis
  // Convert target to base-local coordinates
  const localTgt = baseRotation.worldToLocal(tgt.clone());

  // SCARA kinematics - 2D planar motion
  const reach = Math.hypot(localTgt.x, localTgt.z);
  const L1 = 0.730 * scale; // Upper arm length
  const L2 = 1.350 * scale; // Forearm length

  // Clamp reach to workspace
  const clampedReach = Math.max(Math.abs(L1 - L2), Math.min(L1 + L2, reach));

  // Shoulder angle (first joint) — law of cosines
  const cosShoulder = (L1*L1 + clampedReach*clampedReach - L2*L2) / (2 * L1 * clampedReach);
  const shoulderAngle = Math.acos(Math.max(-1, Math.min(1, cosShoulder)));
  const targetAngle = Math.atan2(localTgt.z, localTgt.x);
  const shoulderFinal = targetAngle - shoulderAngle;

  // Elbow angle (second joint) — law of cosines
  const cosElbow = (L1*L1 + L2*L2 - clampedReach*clampedReach) / (2 * L1 * L2);
  const elbowAngle = Math.acos(Math.max(-1, Math.min(1, cosElbow)));

  // FIX 5: Apply rotations on Y axis with joint limits
  shoulderA.rotation.y = Math.max(-Math.PI/2, Math.min(Math.PI/2, shoulderFinal));
  elbowA.rotation.y = Math.max(-0.8*Math.PI, Math.min(0.8*Math.PI, Math.PI - elbowAngle));

  // Mirror to arm B for dual-arm operation
  shoulderB.rotation.y = shoulderA.rotation.y;
  elbowB.rotation.y = elbowA.rotation.y;
}
```

---

### **PATCH 5 — FIX JOINT STATE REPORTING** (Line ~7304-7311)

**REPLACE:**
```js
function getJoints(): JointData {
  return {
    base:     { c: turret.rotation.y },
    shoulder: { c: shoulder.rotation.x },
    elbow:    { c: elbow.rotation.x },
    wrist:    { c: wrist.rotation.x },
  };
}
```

**WITH:**
```js
function getJoints(): JointData {
  return {
    base:     { c: baseRotation.rotation.y },
    zLift:    { c: zLift.position.y },
    shoulderA: { c: shoulderA.rotation.y },
    elbowA:   { c: elbowA.rotation.y },
    extensionA: { c: extensionA.position.z },
    shoulderB: { c: shoulderB.rotation.y },
    elbowB:   { c: elbowB.rotation.y },
    extensionB: { c: extensionB.position.z },
  };
}
```

---

### **PATCH 6 — FIX CALLBACK PARAMETER PASSING** (Line ~7333-7336)

**REPLACE:**
```js
onReady({
  group: root, turret, shoulder, upperArm, elbow, foreArm, wrist, gripper,
  statusPL, basePos: basePos.clone(), runIK, getJoints,
  worldPos: () => { const v = new THREE.Vector3(); gripper.getWorldPosition(v); return v; },
});
```

**WITH:**
```js
onReady({
  group: root, baseRotation, zLift, shoulderA, elbowA, extensionA, shoulderB, elbowB, extensionB,
  statusPL, basePos: basePos.clone(), runIK, getJoints,
  worldPos: () => { const v = new THREE.Vector3(); extensionA.getWorldPosition(v); return v; },
});
```

---

### **PATCH 7 — FIX WAFER ATTACHMENT** (Line ~8908-8945)

**REPLACE the entire `attachTo()` method with:**
```js
attachTo(robot: RobotObject): void {
  this.carrierRobot = robot;
  this.onConveyor = false;
  this.mesh.visible = true;
  this.mesh.scale.setScalar(1);

  // FIX 6: Snap wafer to extension_A world position before parenting
  const forkWorldPos = new THREE.Vector3();
  const forkWorldQuat = new THREE.Quaternion();
  robot.extensionA.getWorldPosition(forkWorldPos);
  robot.extensionA.getWorldQuaternion(forkWorldQuat);

  // Apply fork offset (0.4m along X-axis in fork frame)
  const offset = new THREE.Vector3(0.4, 0.004, 0);
  offset.applyQuaternion(forkWorldQuat);
  forkWorldPos.add(offset);

  // FIX 7: Prevent wafer clipping - lift above fork surface
  forkWorldPos.y += 0.002;

  // Snap position before parenting
  this.mesh.position.copy(forkWorldPos);
  this.mesh.quaternion.copy(forkWorldQuat);

  // Parent to extension_A for automatic world-space following
  robot.extensionA.attach(this.mesh);

  // Local offset after parenting
  this.mesh.position.set(0, 0.004, 0);
  this.mesh.rotation.set(0, 0, 0);

  const pr = this.mesh.userData.prLayer as THREE.Mesh | undefined;
  if (pr) {
    const mat = pr.material as THREE.MeshStandardMaterial;
    mat.emissive.setHex(0xffffff);
    mat.emissiveIntensity = 3.5;
    setTimeout(() => {
      mat.emissive.setHex(WAFER_COLORS[this.wi]);
      mat.emissiveIntensity = 0.9;
    }, 180);
  }
  robot.statusPL.intensity = 3.0;
  setTimeout(() => { if (robot.statusPL) robot.statusPL.intensity = 1.2; }, 300);
}
```

---

### **PATCH 8 — FIX DETACH METHOD** (Line ~8947+)

**REPLACE:**
```js
ddetachAt(worldPos: THREE.Vector3): void {
  if (!this.carrierRobot) return;
  this.scene.attach(this.mesh);
  this.mesh.scale.setScalar(1);
```

**WITH:**
```js
detachAt(worldPos: THREE.Vector3): void {
  if (!this.carrierRobot) return;
  // Preserve world transform when reparenting to scene
  this.scene.attach(this.mesh);
  this.mesh.scale.setScalar(1);
```

---

### **PATCH 9 — FIX ANIMATION LOOP WAFER TRACKING** (Line ~9823-9840)

**REPLACE:**
```js
// ── 2. Carried wafers follow the gripper in world space ──
// ── 2. Carried wafers — visibility only; transform handled by parent (gripper) ──
// ── Carried wafers: rely on parenting, do NOT lerp/override position ──
this.wSMs.forEach((sm) => {
  if (sm.carrierRobot && sm.launched && !sm.done) {
    // Ensure wafer is visible (parenting already sets world transform)
    sm.mesh.visible = true;
    sm.mesh.scale.setScalar(1);
    // Gentle rotation for visual interest (does not affect position/orientation)
    sm.mesh.rotation.y += 0.04;
    // No position lerp here – the wafer moves exactly with the gripper
  }
});
```

**WITH:**
```js
// ── 2. Carried wafers follow the gripper via world-space transform sync ──
// FIX 8: Every frame, sync wafer world position to extension_A
this.wSMs.forEach((sm) => {
  if (sm.carrierRobot && sm.launched && !sm.done) {
    sm.mesh.visible = true;
    sm.mesh.scale.setScalar(1);
    
    // Get fork (extension_A) world transform
    const forkWorldPos = new THREE.Vector3();
    const forkWorldQuat = new THREE.Quaternion();
    sm.carrierRobot.extensionA.getWorldPosition(forkWorldPos);
    sm.carrierRobot.extensionA.getWorldQuaternion(forkWorldQuat);

    // Apply fork offset
    const offset = new THREE.Vector3(0.4, 0.004, 0);
    offset.applyQuaternion(forkWorldQuat);
    forkWorldPos.add(offset);
    forkWorldPos.y += 0.002; // Prevent clipping

    // Smooth interpolation (no snapping)
    sm.mesh.position.lerp(forkWorldPos, 0.15);
    sm.mesh.quaternion.slerp(forkWorldQuat, 0.15);
  }
});
```

---

## SUMMARY OF FIXES

| Fix | Issue | Solution | Location |
|-----|-------|----------|----------|
| 1 | Wrong node names | Map to Joint_* names | Line ~7195 |
| 2 | Base rotation on Z | Apply to Y-axis | Line ~7222 |
| 3 | Z-lift not implemented | Apply position.y with lerp | Line ~7240 |
| 4 | Shoulder/Elbow on Z | Apply to Y-axis with IK | Line ~7241 |
| 5 | Joint state reports wrong axes | Report Y rotations + Z positions | Line ~7304 |
| 6 | Callback uses wrong nodes | Pass correct joint refs | Line ~7333 |
| 7 | Wafer doesn't attach | Sync to extensionA with offset | Line ~8908 |
| 8 | Wafer clips/drifts | World-space tracking + offset | Line ~9823 |
| 9 | Coordinate system inverted | Remove +Math.PI; use direct angles | Line ~7222-7245 |
| 10 | No joint limits | Add Math.max/min clamping | Line ~7256-7260 |

---

## VERIFICATION CHECKLIST

After applying patches, verify:

- [ ] GLB loads with console showing correct joint names
- [ ] Base rotates smoothly on Y-axis when IK target moves horizontally
- [ ] Z-lift raises/lowers without clipping
- [ ] Shoulder and elbow rotate on Y-axis visibly
- [ ] Wafer attaches to extensionA without teleporting
- [ ] Wafer follows arm motion smoothly during pick/place
- [ ] Wafer never clips through fork geometry
- [ ] Home position (all angles zero) is reachable
- [ ] No frame drops or jitter
- [ ] Dual-arm B mirrors arm A correctly

