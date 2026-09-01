/**
 * ProcessStateMachine.ts
 * Orchestrates semiconductor process sequence.
 * Ensures wafer transport is animated and synchronized with robot motion.
 * NO TELEPORTATION - Only smooth interpolated motion.
 */

import * as THREE from "three";
import { RobotIK, RobotTransformManager } from "./RobotController";
import { WaferManager } from "./WaferManager";
import { CollisionManager } from "./CollisionManager";
import { FailsafeSystem } from "./FailsafeSystem";
import { SplineCurve, MotionTimeline, Easing, EaseType } from "./AnimationEngine";

export interface ProcessStep {
  id: string;
  name: string;
  x: number;
  z: number;
  type: "foup" | "hot" | "cold" | "wet" | "dry" | "coat" | "scan" | "iface";
  duration: number; // Process duration at station
}

export enum TransportPhase {
  IDLE = "idle",
  APPROACHING = "approaching",
  PICKUP = "pickup",
  LIFTING = "lifting",
  TRANSPORTING = "transporting",
  APPROACHING_DEST = "approachingDest",
  PLACING = "placing",
  RELEASING = "releasing",
}

/**
 * Manages a single wafer transport operation.
 */
export class WaferTransportSequence {
  waferID: number;
  fromStation: ProcessStep;
  toStation: ProcessStep;
  phase: TransportPhase = TransportPhase.IDLE;

  robot: RobotTransformManager;
  ik: RobotIK;
  waferManager: WaferManager;
  collisions: CollisionManager;
  failsafe: FailsafeSystem;

  startTime: number = 0;
  phaseDuration: number = 0;
  phaseElapsed: number = 0;
  totalDuration: number = 0;

  splinePath: SplineCurve | null = null;
  timeline: MotionTimeline | null = null;

  // Waypoints for collision-free path
  waypoints: THREE.Vector3[] = [];

  constructor(
    waferID: number,
    fromStation: ProcessStep,
    toStation: ProcessStep,
    robot: RobotTransformManager,
    ik: RobotIK,
    waferManager: WaferManager,
    collisions: CollisionManager,
    failsafe: FailsafeSystem
  ) {
    this.waferID = waferID;
    this.fromStation = fromStation;
    this.toStation = toStation;
    this.robot = robot;
    this.ik = ik;
    this.waferManager = waferManager;
    this.collisions = collisions;
    this.failsafe = failsafe;
  }

  /**
   * Start the transport sequence.
   */
  start(): void {
    console.log(`[TRANSPORT] Starting wafer ${this.waferID} from ${this.fromStation.id} to ${this.toStation.id}`);

    this.startTime = performance.now();
    this.phase = TransportPhase.APPROACHING;
    this.phaseElapsed = 0;
    this.phaseDuration = 1.2; // 1.2s approach

    // Compute safe waypoints
    const pickupPos = new THREE.Vector3(this.fromStation.x, 0.95, this.fromStation.z);
    const placePos = new THREE.Vector3(this.toStation.x, 0.95, this.toStation.z);

    this.waypoints = this.collisions.planSafePath(pickupPos, placePos);

    // Store total duration
    const distance = pickupPos.distanceTo(placePos);
    this.totalDuration = 0.8 + // Approach
      0.4 + // Pickup
      0.6 + // Lift
      distance * 0.4 + // Transport (1.5s per meter)
      0.6 + // Approach dest
      0.4 + // Place
      0.3; // Release

    // Validate motion
    if (!this.failsafe.validateTransportDuration(this.totalDuration)) {
      console.warn("[TRANSPORT] Invalid duration, aborting");
      this.phase = TransportPhase.IDLE;
      return;
    }

    this.waferManager.startTransport(this.waferID, this.fromStation.id, this.toStation.id, this.totalDuration);
  }

  /**
   * Update transport progress (called each frame).
   */
  update(dt: number): boolean {
    if (this.phase === TransportPhase.IDLE) return false;

    this.phaseElapsed += dt;
    const phaseProgress = Math.min(this.phaseElapsed / this.phaseDuration, 1);

    try {
      switch (this.phase) {
        case TransportPhase.APPROACHING:
          this.updateApproaching(phaseProgress);
          if (phaseProgress >= 1) {
            this.phase = TransportPhase.PICKUP;
            this.phaseElapsed = 0;
            this.phaseDuration = 0.4;
          }
          break;

        case TransportPhase.PICKUP:
          this.updatePickup(phaseProgress);
          if (phaseProgress >= 1) {
            // Actually attach wafer to robot
            const wafer = this.waferManager.getWafer(this.waferID);
            if (wafer) {
              this.waferManager.pickupWafer(this.waferID, this.robot);
            }

            this.phase = TransportPhase.LIFTING;
            this.phaseElapsed = 0;
            this.phaseDuration = 0.6;
          }
          break;

        case TransportPhase.LIFTING:
          this.updateLifting(phaseProgress);
          if (phaseProgress >= 1) {
            this.phase = TransportPhase.TRANSPORTING;
            this.phaseElapsed = 0;

            // Compute transport time based on distance
            const waferPos = this.waferManager.getWafer(this.waferID)?.wafer.position || new THREE.Vector3();
            const destPos = new THREE.Vector3(this.toStation.x, 1.5, this.toStation.z);
            const distance = waferPos.distanceTo(destPos);
            this.phaseDuration = Math.max(1.0, distance * 0.4);

            // Create spline for transport
            const pickupPos = new THREE.Vector3(this.fromStation.x, 1.2, this.fromStation.z);
            const midPos = new THREE.Vector3(
              (this.fromStation.x + this.toStation.x) / 2,
              1.8,
              (this.fromStation.z + this.toStation.z) / 2
            );
            const approachPos = new THREE.Vector3(this.toStation.x, 1.2, this.toStation.z);

            this.splinePath = new SplineCurve([
              waferPos,
              pickupPos,
              midPos,
              approachPos,
            ]);
          }
          break;

        case TransportPhase.TRANSPORTING:
          this.updateTransporting(phaseProgress);
          if (phaseProgress >= 1) {
            this.phase = TransportPhase.APPROACHING_DEST;
            this.phaseElapsed = 0;
            this.phaseDuration = 0.4;
          }
          break;

        case TransportPhase.APPROACHING_DEST:
          this.updateApproachingDest(phaseProgress);
          if (phaseProgress >= 1) {
            this.phase = TransportPhase.PLACING;
            this.phaseElapsed = 0;
            this.phaseDuration = 0.4;
          }
          break;

        case TransportPhase.PLACING:
          this.updatePlacing(phaseProgress);
          if (phaseProgress >= 1) {
            // Detach wafer and place at station
            const placePos = this.collisions.getSafeDropZone(
              new THREE.Vector3(this.toStation.x, 0, this.toStation.z)
            );
            this.waferManager.placeWaferAt(this.waferID, this.toStation.id, placePos);

            this.phase = TransportPhase.RELEASING;
            this.phaseElapsed = 0;
            this.phaseDuration = 0.3;
          }
          break;

        case TransportPhase.RELEASING:
          // Retract robot
          if (phaseProgress >= 1) {
            console.log(`[TRANSPORT] Complete: Wafer ${this.waferID} at ${this.toStation.id}`);
            this.phase = TransportPhase.IDLE;
            return true; // Transport finished
          }
          break;
      }
    } catch (error) {
      console.error("[TRANSPORT] Error during update:", error);
      this.failsafe.logEvent(
        "critical" as any,
        "TRANSPORT_ERROR",
        String(error),
        { waferID: this.waferID, phase: this.phase }
      );
      this.phase = TransportPhase.IDLE;
      return true;
    }

    return false; // Still in progress
  }

  private updateApproaching(progress: number): void {
    const pickupPos = new THREE.Vector3(this.fromStation.x, 1.0, this.fromStation.z);
    const ikResult = this.ik.solveIK(pickupPos, this.robot.root.position, {
      base: 0,
      shoulder: 0,
      elbow: 0,
    });

    // Apply with easing
    const eased = Easing.ease(progress, EaseType.CUBIC_INOUT);
    this.robot.applyJointAnglesSmooth({
      base: ikResult.base,
      shoulder: ikResult.shoulder * eased,
      elbow: ikResult.elbow * eased,
      wrist: 0,
    });
  }

  private updatePickup(progress: number): void {
    // Gripper closes and fingers move to wafer
    console.log(`[TRANSPORT] Pickup ${(progress * 100).toFixed(0)}%`);
  }

  private updateLifting(progress: number): void {
    // Robot lifts vertically while keeping horizontal position
    const wafer = this.waferManager.getWafer(this.waferID);
    if (!wafer || !wafer.isAttachedToRobot) return;

    // Target wafer above module (safe height)
    const targetHeight = 1.2 + progress * 0.8; // 1.2m to 2.0m

    const liftTarget = new THREE.Vector3(
      this.fromStation.x,
      targetHeight,
      this.fromStation.z
    );

    const ikResult = this.ik.solveIK(liftTarget, this.robot.root.position, {
      base: 0,
      shoulder: 0,
      elbow: 0,
    });

    this.robot.applyJointAnglesSmooth({
      base: ikResult.base,
      shoulder: ikResult.shoulder,
      elbow: ikResult.elbow,
      wrist: 0,
    });
  }

  private updateTransporting(progress: number): void {
    if (!this.splinePath) return;

    // Move along spline curve
    const splinePos = this.splinePath.evaluateAt(progress);

    const ikResult = this.ik.solveIK(splinePos, this.robot.root.position, {
      base: 0,
      shoulder: 0,
      elbow: 0,
    });

    this.robot.applyJointAnglesSmooth({
      base: ikResult.base,
      shoulder: ikResult.shoulder,
      elbow: ikResult.elbow,
      wrist: 0,
    });

    // Update wafer position (it moves with gripper automatically via parenting)
  }

  private updateApproachingDest(progress: number): void {
    const approachPos = new THREE.Vector3(
      this.toStation.x,
      1.0,
      this.toStation.z
    );

    const ikResult = this.ik.solveIK(approachPos, this.robot.root.position, {
      base: 0,
      shoulder: 0,
      elbow: 0,
    });

    this.robot.applyJointAnglesSmooth({
      base: ikResult.base,
      shoulder: ikResult.shoulder,
      elbow: ikResult.elbow,
      wrist: 0,
    });
  }

  private updatePlacing(progress: number): void {
    // Descend onto chuck
    const currentHeight = 1.0 - progress * 0.05;
    const placePos = new THREE.Vector3(
      this.toStation.x,
      currentHeight,
      this.toStation.z
    );

    const ikResult = this.ik.solveIK(placePos, this.robot.root.position, {
      base: 0,
      shoulder: 0,
      elbow: 0,
    });

    this.robot.applyJointAnglesSmooth({
      base: ikResult.base,
      shoulder: ikResult.shoulder,
      elbow: ikResult.elbow,
      wrist: 0,
    });
  }

  /**
   * Get transport progress (0-1).
   */
  getProgress(): number {
    const elapsed = (performance.now() - this.startTime) / this.totalDuration;
    return Math.min(elapsed, 1);
  }

  /**
   * Get current phase.
   */
  getPhase(): string {
    return this.phase;
  }

  /**
   * Cancel transport (emergency).
   */
  cancel(): void {
    console.log(`[TRANSPORT] Cancelled: Wafer ${this.waferID}`);
    this.phase = TransportPhase.IDLE;
    this.failsafe.recoverToHome();
  }
}
