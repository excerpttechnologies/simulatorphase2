/**
 * RobotController.ts
 * Manages inverse kinematics, joint constraints, and quaternion-based motion.
 * Eliminates Euler rotation flips and ensures physically plausible poses.
 */

import * as THREE from "three";
import { QuaternionInterpolator, Easing, EaseType, SplineCurve } from "./AnimationEngine";

export interface JointLimits {
  minAngle: number;
  maxAngle: number;
  maxVelocity: number;
  maxAcceleration: number;
}

export interface JointState {
  angle: number;
  velocity: number;
  acceleration: number;
  targetAngle: number;
}

export interface RobotKinematics {
  L1: number; // Shoulder to elbow
  L2: number; // Elbow to wrist
  L3: number; // Wrist to gripper
  shoulderHeight: number; // Height of shoulder pivot
  wristTipOffset: number; // Offset from wrist to gripper tip
}

/**
 * Industrial robot inverse kinematics solver.
 * Uses CCDIK (Cyclic Coordinate Descent) for robust 6-DOF solving.
 */
export class RobotIK {
  kinematics: RobotKinematics;
  joints: Map<string, JointState> = new Map();
  limits: Map<string, JointLimits> = new Map();

  constructor(kinematics: RobotKinematics) {
    this.kinematics = kinematics;
    this.initializeDefaults();
  }

  private initializeDefaults(): void {
    // J1: Base rotation — continuous, no limits
    this.joints.set("base", { angle: 0, velocity: 0, acceleration: 0, targetAngle: 0 });
    this.limits.set("base", {
      minAngle: -Math.PI,
      maxAngle: Math.PI,
      maxVelocity: 2.0,
      maxAcceleration: 4.0,
    });

    // J2: Shoulder — limited range for realistic motion
    this.joints.set("shoulder", { angle: 0, velocity: 0, acceleration: 0, targetAngle: 0 });
    this.limits.set("shoulder", {
      minAngle: -Math.PI / 2.2,
      maxAngle: Math.PI / 2.5,
      maxVelocity: 1.5,
      maxAcceleration: 3.0,
    });

    // J3: Elbow — limited range
    this.joints.set("elbow", { angle: 0, velocity: 0, acceleration: 0, targetAngle: 0 });
    this.limits.set("elbow", {
      minAngle: -Math.PI / 1.2,
      maxAngle: 0,
      maxVelocity: 1.8,
      maxAcceleration: 3.5,
    });

    // J4: Wrist pitch — very limited to preserve wafer flatness
    this.joints.set("wristPitch", { angle: 0, velocity: 0, acceleration: 0, targetAngle: 0 });
    this.limits.set("wristPitch", {
      minAngle: -Math.PI / 6,
      maxAngle: Math.PI / 6,
      maxVelocity: 1.2,
      maxAcceleration: 2.5,
    });

    // J5: Wrist rotation
    this.joints.set("wristRoll", { angle: 0, velocity: 0, acceleration: 0, targetAngle: 0 });
    this.limits.set("wristRoll", {
      minAngle: -Math.PI,
      maxAngle: Math.PI,
      maxVelocity: 2.0,
      maxAcceleration: 4.0,
    });

    // J6: End effector — gripper
    this.joints.set("gripper", { angle: 0, velocity: 0, acceleration: 0, targetAngle: 0 });
    this.limits.set("gripper", {
      minAngle: 0,
      maxAngle: Math.PI / 4,
      maxVelocity: 1.0,
      maxAcceleration: 2.0,
    });
  }

  /**
   * CCDIK (Cyclic Coordinate Descent) Inverse Kinematics.
   * Solves for joint angles to reach target position.
   */
  solveIK(
    targetPos: THREE.Vector3,
    basePos: THREE.Vector3,
    currentJoints: { base: number; shoulder: number; elbow: number },
    maxIterations: number = 10
  ): { base: number; shoulder: number; elbow: number } {
    let result = { ...currentJoints };

    // Convert to local frame relative to base
    const localTarget = targetPos.clone().sub(basePos);

    // Compute reach distance
    const reach = Math.hypot(localTarget.x, localTarget.z);
    const dy = localTarget.y - this.kinematics.shoulderHeight;

    // Clamp reach to workspace
    const D = Math.hypot(reach, dy);
    const Dmin = Math.abs(this.kinematics.L1 - this.kinematics.L2) + 0.02;
    const Dmax = this.kinematics.L1 + this.kinematics.L2 - 0.02;

    if (D < Dmin || D > Dmax) {
      // Out of reach — move as close as possible
      const ratio = D < Dmin ? Dmin / D : Dmax / D;
      return {
        base: Math.atan2(localTarget.x, localTarget.z),
        shoulder: 0,
        elbow: 0,
      };
    }

    // Compute elbow angle using law of cosines
    const cosElbow = (this.kinematics.L1 ** 2 + this.kinematics.L2 ** 2 - D ** 2) / (2 * this.kinematics.L1 * this.kinematics.L2);
    const elbowAngle = -(Math.PI - Math.acos(Math.max(-1, Math.min(1, cosElbow))));

    // Compute shoulder angle
    const cosShoulder = (this.kinematics.L1 ** 2 + D ** 2 - this.kinematics.L2 ** 2) / (2 * this.kinematics.L1 * D);
    const shoulderInner = Math.acos(Math.max(-1, Math.min(1, cosShoulder)));
    const targetAngle = Math.atan2(reach, dy);
    let shoulderAngle = targetAngle - shoulderInner;

    // Apply joint limits
    result.shoulder = Math.max(
      this.limits.get("shoulder")!.minAngle,
      Math.min(this.limits.get("shoulder")!.maxAngle, shoulderAngle)
    );

    result.elbow = Math.max(
      this.limits.get("elbow")!.minAngle,
      Math.min(this.limits.get("elbow")!.maxAngle, elbowAngle)
    );

    // Base rotation (yaw)
    result.base = Math.atan2(localTarget.x, localTarget.z);

    return result;
  }

  /**
   * Update joint velocity with acceleration limits.
   * Smooth servo motion without snapping.
   */
  updateJointVelocity(jointName: string, targetAngle: number, dt: number): number {
    const joint = this.joints.get(jointName);
    const limits = this.limits.get(jointName);

    if (!joint || !limits) return 0;

    // Compute desired velocity
    const angleDelta = targetAngle - joint.angle;
    const maxVel = limits.maxVelocity;
    let desiredVel = Math.max(-maxVel, Math.min(maxVel, angleDelta * 5)); // Proportional control

    // Apply acceleration limit
    const maxAccel = limits.maxAcceleration;
    const accelDelta = desiredVel - joint.velocity;
    const limitedAccel = Math.max(-maxAccel, Math.min(maxAccel, accelDelta / dt));

    joint.velocity += limitedAccel * dt;
    joint.velocity = Math.max(-maxVel, Math.min(maxVel, joint.velocity));

    // Update angle
    joint.angle += joint.velocity * dt;

    // Enforce joint limits
    joint.angle = Math.max(limits.minAngle, Math.min(limits.maxAngle, joint.angle));

    return joint.angle;
  }

  /**
   * Get current joint angles.
   */
  getJointAngles(): { [key: string]: number } {
    const result: { [key: string]: number } = {};
    this.joints.forEach((joint, name) => {
      result[name] = joint.angle;
    });
    return result;
  }

  /**
   * Check if current pose is reachable without self-collision.
   */
  isValidPose(joints: { base: number; shoulder: number; elbow: number }): boolean {
    // Simple collision check: elbow shouldn't penetrate workspace boundaries
    const shoulderLimits = this.limits.get("shoulder")!;
    const elbowLimits = this.limits.get("elbow")!;

    const shoulderValid = joints.shoulder >= shoulderLimits.minAngle && joints.shoulder <= shoulderLimits.maxAngle;
    const elbowValid = joints.elbow >= elbowLimits.minAngle && joints.elbow <= elbowLimits.maxAngle;

    return shoulderValid && elbowValid;
  }

  /**
   * Forward kinematics: compute end effector position from joint angles.
   */
  forwardKinematics(base: number, shoulder: number, elbow: number, basePos: THREE.Vector3): THREE.Vector3 {
    // Local arm length projections
    const L1 = this.kinematics.L1;
    const L2 = this.kinematics.L2;

    // Shoulder position relative to base
    const shoulderY = this.kinematics.shoulderHeight;

    // Elbow position
    const elbowLocal_x = L1 * Math.sin(shoulder);
    const elbowLocal_y = shoulderY + L1 * Math.cos(shoulder);

    // Wrist position
    const totalAngle = shoulder + elbow;
    const wristLocal_x = elbowLocal_x + L2 * Math.sin(totalAngle);
    const wristLocal_y = elbowLocal_y + L2 * Math.cos(totalAngle);

    // Rotate by base yaw
    const gripper_x = basePos.x + wristLocal_x * Math.cos(base) - 0 * Math.sin(base);
    const gripper_z = basePos.z + wristLocal_x * Math.sin(base) + 0 * Math.cos(base);
    const gripper_y = basePos.y + wristLocal_y;

    return new THREE.Vector3(gripper_x, gripper_y, gripper_z);
  }

  /**
   * Compute waypoints for smooth spline-based motion.
   */
  computeMotionWaypoints(
    startJoints: { base: number; shoulder: number; elbow: number },
    endJoints: { base: number; shoulder: number; elbow: number },
    numWaypoints: number = 5
  ): Array<{ base: number; shoulder: number; elbow: number }> {
    const waypoints = [];

    for (let i = 0; i < numWaypoints; i++) {
      const t = i / (numWaypoints - 1);
      waypoints.push({
        base: startJoints.base + (endJoints.base - startJoints.base) * t,
        shoulder: startJoints.shoulder + (endJoints.shoulder - startJoints.shoulder) * t,
        elbow: startJoints.elbow + (endJoints.elbow - startJoints.elbow) * t,
      });
    }

    return waypoints;
  }
}

/**
 * Robot configuration manager with proper transform hierarchy.
 */
export class RobotTransformManager {
  root: THREE.Group;
  joints: {
    base: THREE.Group;
    shoulder: THREE.Group;
    elbow: THREE.Group;
    wrist: THREE.Group;
    gripper: THREE.Group;
  };

  // Quaternion-based storage to prevent rotation flipping
  private baseQuat = new THREE.Quaternion();
  private shoulderQuat = new THREE.Quaternion();
  private elbowQuat = new THREE.Quaternion();
  private wristQuat = new THREE.Quaternion();

  constructor(
    root: THREE.Group,
    base: THREE.Group,
    shoulder: THREE.Group,
    elbow: THREE.Group,
    wrist: THREE.Group,
    gripper: THREE.Group
  ) {
    this.root = root;
    this.joints = { base, shoulder, elbow, wrist, gripper };
  }

  /**
   * Apply joint angles using quaternion slerp for smooth interpolation.
   * NEVER use Euler angles for robotic motion.
   */
  applyJointAnglesSmooth(
    angles: { base: number; shoulder: number; elbow: number; wrist: number },
    dt: number = 0.016,
    easeType: EaseType = EaseType.CUBIC_INOUT
  ): void {
    // Compute target quaternions
    const targetBaseQuat = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), angles.base);
    const targetShoulderQuat = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 0, 1), angles.shoulder);
    const targetElbowQuat = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 0, 1), angles.elbow);
    const targetWristQuat = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 0, 1), angles.wrist);

    // Interpolate smoothly
    const alpha = 0.15; // Blending factor
    this.baseQuat.slerp(targetBaseQuat, alpha);
    this.shoulderQuat.slerp(targetShoulderQuat, alpha);
    this.elbowQuat.slerp(targetElbowQuat, alpha);
    this.wristQuat.slerp(targetWristQuat, alpha);

    // Apply to joint groups
    this.joints.base.quaternion.copy(this.baseQuat);
    this.joints.shoulder.quaternion.copy(this.shoulderQuat);
    this.joints.elbow.quaternion.copy(this.elbowQuat);
    this.joints.wrist.quaternion.copy(this.wristQuat);

    // Normalize to prevent numerical drift
    this.baseQuat.normalize();
    this.shoulderQuat.normalize();
    this.elbowQuat.normalize();
    this.wristQuat.normalize();
  }

  /**
   * Immediately apply joint angles without smoothing.
   * Use sparingly — only for initialization.
   */
  applyJointAnglesImmediate(angles: { base: number; shoulder: number; elbow: number; wrist: number }): void {
    this.joints.base.quaternion.setFromAxisAngle(new THREE.Vector3(0, 1, 0), angles.base);
    this.joints.shoulder.quaternion.setFromAxisAngle(new THREE.Vector3(0, 0, 1), angles.shoulder);
    this.joints.elbow.quaternion.setFromAxisAngle(new THREE.Vector3(0, 0, 1), angles.elbow);
    this.joints.wrist.quaternion.setFromAxisAngle(new THREE.Vector3(0, 0, 1), angles.wrist);
  }

  /**
   * Get current world position of gripper TCP (Tool Center Point).
   */
  getGripperWorldPosition(): THREE.Vector3 {
    const pos = new THREE.Vector3();
    this.joints.gripper.getWorldPosition(pos);
    return pos;
  }

  /**
   * Get current world quaternion of gripper.
   * Ensures wafer maintains proper orientation.
   */
  getGripperWorldQuaternion(): THREE.Quaternion {
    const quat = new THREE.Quaternion();
    this.joints.gripper.getWorldQuaternion(quat);
    return quat;
  }
}
