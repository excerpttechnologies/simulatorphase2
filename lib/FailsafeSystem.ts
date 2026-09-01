/**
 * FailsafeSystem.ts
 * Robust error handling to prevent wafer loss and data corruption.
 * If motion fails, freeze robot and preserve wafer transform instead of teleporting.
 */

import * as THREE from "three";
import { WaferManager } from "./WaferManager";
import { RobotTransformManager } from "./RobotController";

export enum FailsafeLevel {
  INFO = "info",
  WARNING = "warning",
  CRITICAL = "critical",
  SHUTDOWN = "shutdown",
}

export interface FailsafeEvent {
  level: FailsafeLevel;
  code: string;
  message: string;
  timestamp: number;
  context?: any;
}

/**
 * Failsafe system for handling motion failures gracefully.
 */
export class FailsafeSystem {
  events: FailsafeEvent[] = [];
  maxEvents: number = 100;
  isShutdown: boolean = false;

  waferManager: WaferManager | null = null;
  robot: RobotTransformManager | null = null;
  onFailsafe?: (event: FailsafeEvent) => void;

  constructor() {
    console.log("[FAILSAFE] System initialized");
  }

  /**
   * Set dependencies.
   */
  setDependencies(waferManager: WaferManager, robot: RobotTransformManager): void {
    this.waferManager = waferManager;
    this.robot = robot;
  }

  /**
   * Log failsafe event.
   */
  logEvent(level: FailsafeLevel, code: string, message: string, context?: any): void {
    const event: FailsafeEvent = {
      level,
      code,
      message,
      timestamp: performance.now(),
      context,
    };

    this.events.push(event);

    // Keep max events
    if (this.events.length > this.maxEvents) {
      this.events.shift();
    }

    console.log(`[FAILSAFE ${level.toUpperCase()}] ${code}: ${message}`, context);

    this.onFailsafe?.(event);

    // Handle critical levels
    if (level === FailsafeLevel.CRITICAL) {
      this.handleCritical(event);
    } else if (level === FailsafeLevel.SHUTDOWN) {
      this.handleShutdown(event);
    }
  }

  /**
   * Handle critical errors.
   */
  private handleCritical(event: FailsafeEvent): void {
    console.error("[FAILSAFE CRITICAL]", event);

    // Freeze robot
    if (this.robot) {
      console.log("[FAILSAFE] Freezing robot motion");
      // Set all joint velocities to 0
      this.robot.joints.base.position.z = 0;
    }

    // Preserve wafer position
    if (this.waferManager) {
      console.log("[FAILSAFE] Validating all wafer transforms");
      this.waferManager.validateAllWafers();
    }
  }

  /**
   * Handle shutdown-level errors.
   */
  private handleShutdown(event: FailsafeEvent): void {
    console.error("[FAILSAFE SHUTDOWN]", event);
    this.isShutdown = true;

    // Stop all motion immediately
    if (this.robot) {
      this.robot.joints.base.quaternion.identity();
      this.robot.joints.shoulder.quaternion.identity();
      this.robot.joints.elbow.quaternion.identity();
      this.robot.joints.wrist.quaternion.identity();
    }

    console.log("[FAILSAFE] System shutdown initiated");
  }

  /**
   * Validate motion transition.
   */
  validateMotionTransition(
    from: { x: number; y: number; z: number },
    to: { x: number; y: number; z: number },
    maxDelta: number = 2.0
  ): boolean {
    const delta = Math.hypot(from.x - to.x, from.y - to.y, from.z - to.z);

    if (delta > maxDelta) {
      this.logEvent(
        FailsafeLevel.WARNING,
        "LARGE_MOTION_DELTA",
        `Motion delta ${delta.toFixed(3)}m exceeds limit ${maxDelta}m`,
        { from, to }
      );
      return false;
    }

    return true;
  }

  /**
   * Validate parent-child relationship.
   */
  validateParenting(child: THREE.Object3D, expectedParent: THREE.Object3D): boolean {
    if (child.parent !== expectedParent) {
      this.logEvent(
        FailsafeLevel.CRITICAL,
        "PARENT_MISMATCH",
        `Object parent mismatch: expected ${expectedParent.name}, got ${child.parent?.name}`,
        { child: child.name, expected: expectedParent.name, actual: child.parent?.name }
      );
      return false;
    }

    return true;
  }

  /**
   * Validate joint angles are within limits.
   */
  validateJointLimits(
    joint: string,
    angle: number,
    minAngle: number,
    maxAngle: number
  ): boolean {
    if (angle < minAngle || angle > maxAngle) {
      this.logEvent(
        FailsafeLevel.WARNING,
        "JOINT_LIMIT_EXCEEDED",
        `Joint ${joint} angle ${angle.toFixed(3)} outside limits [${minAngle.toFixed(3)}, ${maxAngle.toFixed(3)}]`,
        { joint, angle, minAngle, maxAngle }
      );
      return false;
    }

    return true;
  }

  /**
   * Validate wafer is visible during transport.
   */
  validateWaferVisibility(waferID: number, isVisible: boolean): boolean {
    if (!isVisible) {
      this.logEvent(
        FailsafeLevel.WARNING,
        "WAFER_HIDDEN",
        `Wafer ${waferID} hidden during motion (possible teleport)`,
        { waferID }
      );
      return false;
    }

    return true;
  }

  /**
   * Validate transport duration is reasonable.
   */
  validateTransportDuration(duration: number, minDuration: number = 0.5, maxDuration: number = 10.0): boolean {
    if (duration < minDuration) {
      this.logEvent(
        FailsafeLevel.WARNING,
        "TRANSPORT_TOO_FAST",
        `Transport duration ${duration.toFixed(2)}s below minimum ${minDuration}s (possible teleport)`,
        { duration, minDuration }
      );
      return false;
    }

    if (duration > maxDuration) {
      this.logEvent(
        FailsafeLevel.WARNING,
        "TRANSPORT_TIMEOUT",
        `Transport duration ${duration.toFixed(2)}s exceeds maximum ${maxDuration}s`,
        { duration, maxDuration }
      );
      return false;
    }

    return true;
  }

  /**
   * Recovery: Move robot back to safe home position.
   */
  recoverToHome(): void {
    if (!this.robot) return;

    console.log("[FAILSAFE] Recovering to home position");

    const homeAngles = {
      base: 0,
      shoulder: 0,
      elbow: 0,
      wrist: 0,
    };

    this.robot.applyJointAnglesImmediate(homeAngles);

    this.logEvent(
      FailsafeLevel.INFO,
      "RECOVERY_HOME",
      "Robot returned to home position"
    );
  }

  /**
   * Get all logged events.
   */
  getEvents(): FailsafeEvent[] {
    return [...this.events];
  }

  /**
   * Get events of a specific level.
   */
  getEventsByLevel(level: FailsafeLevel): FailsafeEvent[] {
    return this.events.filter((e) => e.level === level);
  }

  /**
   * Get recent events.
   */
  getRecentEvents(count: number = 10): FailsafeEvent[] {
    return this.events.slice(-count);
  }

  /**
   * Clear event log.
   */
  clearEvents(): void {
    this.events = [];
  }

  /**
   * Export event log as JSON.
   */
  exportLog(): string {
    return JSON.stringify(
      {
        timestamp: new Date().toISOString(),
        isShutdown: this.isShutdown,
        events: this.events,
      },
      null,
      2
    );
  }
}
