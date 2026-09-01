/**
 * USAGE_EXAMPLES.ts
 * 
 * Quick reference guide with code snippets showing how to use the new modular system.
 */

import * as THREE from "three";
import { Easing, EaseType, SplineCurve, lerp, lerpVector } from "@/lib/AnimationEngine";
import { RobotIK, RobotTransformManager } from "@/lib/RobotController";
import { WaferManager } from "@/lib/WaferManager";
import { CollisionManager } from "@/lib/CollisionManager";
import { DebugOverlay } from "@/lib/DebugOverlay";
import { FailsafeLevel, FailsafeSystem } from "@/lib/FailsafeSystem";

// ═══════════════════════════════════════════════════════════════════════════════
// EXAMPLE 1: Initialize Robot Systems
// ═══════════════════════════════════════════════════════════════════════════════

function initializeRobotSystems(scene: THREE.Scene, robotRoot: THREE.Group) {
  // 1. Create IK solver with kinematics
  const ik = new RobotIK({
    L1: 0.7, // Shoulder to elbow
    L2: 1.12, // Elbow to wrist
    L3: 0.25, // Wrist to gripper
    shoulderHeight: 0.5,
    wristTipOffset: 0.25,
  });

  // 2. Create transform manager for joint control
  const transforms = new RobotTransformManager(
    robotRoot,
    robotRoot.getObjectByName("Turret") as THREE.Group,
    robotRoot.getObjectByName("Shoulder") as THREE.Group,
    robotRoot.getObjectByName("Elbow") as THREE.Group,
    robotRoot.getObjectByName("Wrist") as THREE.Group,
    robotRoot.getObjectByName("Gripper") as THREE.Group
  );

  // 3. Create wafer manager
  const waferMgr = new WaferManager(scene);

  // 4. Create collision manager
  const collisionMgr = new CollisionManager();

  // 5. Create failsafe system
  const failsafe = new FailsafeSystem();
  failsafe.setDependencies(waferMgr, transforms);

  // 6. Optional: Enable debug overlay
  const debug = new DebugOverlay();

  return { ik, transforms, waferMgr, collisionMgr, failsafe, debug };
}

// ═══════════════════════════════════════════════════════════════════════════════
// EXAMPLE 2: Simple Easing Animation
// ═══════════════════════════════════════════════════════════════════════════════

function animateWithEasing() {
  const startPos = new THREE.Vector3(0, 0, 0);
  const endPos = new THREE.Vector3(5, 2, 3);
  const duration = 2.0; // seconds
  let elapsed = 0;

  const animate = (dt: number) => {
    elapsed += dt;
    const progress = Math.min(elapsed / duration, 1);

    // Apply easing
    const eased = Easing.ease(progress, EaseType.CUBIC_INOUT);

    // Interpolate position
    const position = lerpVector(startPos, endPos, eased);
    console.log("Animated position:", position);

    if (progress >= 1) {
      console.log("Animation complete");
      return true; // Done
    }
    return false;
  };

  return animate;
}

// ═══════════════════════════════════════════════════════════════════════════════
// EXAMPLE 3: Spline-Based Robot Motion Path
// ═══════════════════════════════════════════════════════════════════════════════

function planRobotPath() {
  // Define waypoints for smooth motion
  const waypoints = [
    new THREE.Vector3(0, 0.5, 0), // Start
    new THREE.Vector3(1, 1.0, 0), // Mid-lift
    new THREE.Vector3(3, 1.5, 2), // Peak
    new THREE.Vector3(4, 1.0, 5), // Approach
    new THREE.Vector3(5, 0.5, 5), // End
  ];

  // Create Catmull-Rom spline
  const spline = new SplineCurve(waypoints);

  // Evaluate at specific progress
  let position: THREE.Vector3;

  for (let t = 0; t <= 1; t += 0.1) {
    position = spline.evaluateAt(t);
    console.log(`t=${t.toFixed(1)}: ${position.toArray().map((v) => v.toFixed(2))}`);
  }
}

// ═══════════════════════════════════════════════════════════════════════════════
// EXAMPLE 4: IK Solver Usage
// ═══════════════════════════════════════════════════════════════════════════════

function solveInverseKinematics(ik: RobotIK, transforms: RobotTransformManager) {
  // Define target position (where we want the gripper to go)
  const targetPos = new THREE.Vector3(1.5, 1.0, 2.0);
  const basePos = new THREE.Vector3(0, 0, 0);

  // Solve for joint angles
  const joints = ik.solveIK(
    targetPos,
    basePos,
    {
      base: 0,
      shoulder: 0,
      elbow: 0,
    },
    10 // max iterations
  );

  console.log("IK Solution:", {
    base: (joints.base * 180) / Math.PI,
    shoulder: (joints.shoulder * 180) / Math.PI,
    elbow: (joints.elbow * 180) / Math.PI,
  });

  // Validate the pose
  if (!ik.isValidPose(joints)) {
    console.warn("Invalid pose!");
    return;
  }

  // Apply smoothly using quaternion interpolation
  transforms.applyJointAnglesSmooth({
    base: joints.base,
    shoulder: joints.shoulder,
    elbow: joints.elbow,
    wrist: 0,
  });
}

// ═══════════════════════════════════════════════════════════════════════════════
// EXAMPLE 5: Wafer Pickup and Placement
// ═══════════════════════════════════════════════════════════════════════════════

function performWaferPickup(waferMgr: WaferManager, transforms: RobotTransformManager) {
  const waferID = 0;

  // Step 1: Pickup wafer (attach to robot)
  const success = waferMgr.pickupWafer(waferID, transforms);
  console.log("Pickup result:", success ? "SUCCESS" : "FAILED");

  // The wafer is now a child of the gripper and moves automatically
}

function performWaferPlacement(waferMgr: WaferManager, station: string, position: THREE.Vector3) {
  const waferID = 0;

  // Step 2: Place wafer (detach from robot)
  waferMgr.placeWaferAt(waferID, station, position);

  // The wafer is now back in the scene at the specified position
}

// ═══════════════════════════════════════════════════════════════════════════════
// EXAMPLE 6: Collision Detection and Path Planning
// ═══════════════════════════════════════════════════════════════════════════════

function planCollisionFreePath(collisionMgr: CollisionManager) {
  const startPos = new THREE.Vector3(0, 0.5, 0);
  const endPos = new THREE.Vector3(5, 0.5, 5);

  // Check if direct path is safe
  const isSafe = collisionMgr.canReachPoint(endPos);
  console.log("Direct path safe:", isSafe);

  // If not, plan collision-free waypoints
  const safePath = collisionMgr.planSafePath(startPos, endPos, 7);
  console.log("Safe waypoints:", safePath.length);

  safePath.forEach((wp, i) => {
    console.log(`Waypoint ${i}:`, wp.toArray().map((v) => v.toFixed(2)));
  });
}

// ═══════════════════════════════════════════════════════════════════════════════
// EXAMPLE 7: Register Collision Volumes
// ═══════════════════════════════════════════════════════════════════════════════

function setupCollisionVolumes(collisionMgr: CollisionManager, modules: Record<string, THREE.Group>) {
  // Register each module's collision volume
  collisionMgr.registerVolume("dehydration", modules["dehy"], false); // false = not a safe zone
  collisionMgr.registerVolume("hmds", modules["hmds"], false);
  collisionMgr.registerVolume("coater", modules["coater"], false);
  collisionMgr.registerVolume("developer", modules["dev"], false);

  // Register safe drop zones
  collisionMgr.registerVolume("dropZone", modules["staging"], true); // true = safe zone
}

// ═══════════════════════════════════════════════════════════════════════════════
// EXAMPLE 8: Frame-by-Frame Motion Update Loop
// ═══════════════════════════════════════════════════════════════════════════════

class SimpleRobotAnimator {
  transforms: RobotTransformManager;
  ik: RobotIK;
  targetPos: THREE.Vector3 = new THREE.Vector3(0, 0.5, 0);

  constructor(transforms: RobotTransformManager, ik: RobotIK) {
    this.transforms = transforms;
    this.ik = ik;
  }

  update(dt: number): void {
    // Solve IK for current target
    const solution = this.ik.solveIK(this.targetPos, new THREE.Vector3(0, 0, 0), {
      base: 0,
      shoulder: 0,
      elbow: 0,
    });

    // Apply smoothly (quaternion slerp)
    this.transforms.applyJointAnglesSmooth(
      {
        base: solution.base,
        shoulder: solution.shoulder,
        elbow: solution.elbow,
        wrist: 0,
      },
      dt,
      EaseType.CUBIC_INOUT
    );
  }

  setTarget(x: number, y: number, z: number): void {
    this.targetPos.set(x, y, z);
  }
}

// ═══════════════════════════════════════════════════════════════════════════════
// EXAMPLE 9: Debug Overlay Real-Time Updates
// ═══════════════════════════════════════════════════════════════════════════════

function updateDebugDisplay(debug: DebugOverlay, state: any) {
  debug.setState({
    activeRobot: state.robotActive ? "MOVING" : "IDLE",
    currentWafer: state.waferID,
    currentStation: state.stationID,
    jointAngles: {
      base: state.baseAngle || 0,
      shoulder: state.shoulderAngle || 0,
      elbow: state.elbowAngle || 0,
      wrist: state.wristAngle || 0,
    },
    ikTarget: state.target,
    collisionDetected: state.collision,
    transportProgress: state.progress,
    motionPhase: state.phase,
  });

  debug.render();
}

// ═══════════════════════════════════════════════════════════════════════════════
// EXAMPLE 10: Failsafe Error Handling
// ═══════════════════════════════════════════════════════════════════════════════

function handleRobotError(failsafe: FailsafeSystem) {
  // Log warning-level event
  failsafe.logEvent(
    FailsafeLevel.WARNING,
    "JOINT_LIMIT_EXCEEDED",
    "Shoulder angle 100° exceeds max 90°",
    {
      joint: "shoulder",
      angle: 100,
      limit: 90,
    }
  );

  // Log critical error
  failsafe.logEvent(
    FailsafeLevel.CRITICAL,
    "COLLISION_DETECTED",
    "Robot gripper colliding with module",
    {
      module: "dehydration",
      distance: 0.02,
    }
  );

  // In critical case, robot freezes
  // In shutdown case, system halts
  failsafe.recoverToHome(); // Move to safe position

  // Export detailed log
  const log = failsafe.exportLog();
  console.log(log);
}

// ═══════════════════════════════════════════════════════════════════════════════
// EXAMPLE 11: Complete Wafer Transport Sequence
// ═══════════════════════════════════════════════════════════════════════════════

async function performCompleteTransport(
  waferMgr: WaferManager,
  transforms: RobotTransformManager,
  ik: RobotIK,
  collisions: CollisionManager,
  from: { x: number; z: number; name: string },
  to: { x: number; z: number; name: string }
) {
  const waferID = 0;

  console.log(`Starting transport: ${from.name} → ${to.name}`);

  // 1. Plan path
  const startPos = new THREE.Vector3(from.x, 1.0, from.z);
  const endPos = new THREE.Vector3(to.x, 1.0, to.z);
  const path = collisions.planSafePath(startPos, endPos);

  // 2. Move to pickup position
  for (const waypoint of path.slice(0, -1)) {
    const solution = ik.solveIK(waypoint, new THREE.Vector3(0, 0, 0), {
      base: 0,
      shoulder: 0,
      elbow: 0,
    });
    transforms.applyJointAnglesSmooth({
      base: solution.base,
      shoulder: solution.shoulder,
      elbow: solution.elbow,
      wrist: 0,
    });
    await new Promise((r) => setTimeout(r, 50)); // 50ms per frame
  }

  // 3. Pickup wafer
  waferMgr.pickupWafer(waferID, transforms);

  // 4. Transport along path
  for (let i = 1; i < path.length; i++) {
    const solution = ik.solveIK(path[i], new THREE.Vector3(0, 0, 0), {
      base: 0,
      shoulder: 0,
      elbow: 0,
    });
    transforms.applyJointAnglesSmooth({
      base: solution.base,
      shoulder: solution.shoulder,
      elbow: solution.elbow,
      wrist: 0,
    });
    await new Promise((r) => setTimeout(r, 50));
  }

  // 5. Place wafer
  const placePos = collisions.getSafeDropZone(new THREE.Vector3(to.x, 0, to.z));
  waferMgr.placeWaferAt(waferID, to.name, placePos);

  console.log("Transport complete!");
}

// ═══════════════════════════════════════════════════════════════════════════════
// EXAMPLE 12: Validate Wafer State
// ═══════════════════════════════════════════════════════════════════════════════

function validateWaferState(waferMgr: WaferManager) {
  // Check all wafers are valid
  const allValid = waferMgr.validateAllWafers();
  console.log("All wafers valid:", allValid);

  // Get occupancy status
  const status = waferMgr.getOccupancyStatus();
  console.log("Station occupancy:", status);

  // Check specific wafer
  const wafer0 = waferMgr.getWafer(0);
  if (wafer0) {
    console.log("Wafer 0 status:", {
      station: wafer0.currentStation,
      attached: wafer0.isAttachedToRobot,
      parent: wafer0.currentParent?.name,
    });
  }
}

export {
  initializeRobotSystems,
  animateWithEasing,
  planRobotPath,
  solveInverseKinematics,
  performWaferPickup,
  performWaferPlacement,
  planCollisionFreePath,
  setupCollisionVolumes,
  SimpleRobotAnimator,
  updateDebugDisplay,
  handleRobotError,
  performCompleteTransport,
  validateWaferState,
};
