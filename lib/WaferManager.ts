/**
 * WaferManager.ts
 * Manages wafer ownership, parenting hierarchy, and transform validation.
 * Eliminates wafer teleportation by ensuring proper parent-child relationships.
 */

import * as THREE from "three";
import { RobotTransformManager } from "./RobotController";
import { MotionTimeline } from "./AnimationEngine";

export interface WaferTransport {
  wafer: THREE.Group;
  fromStation: string;
  toStation: string;
  startTime: number;
  duration: number;
  isComplete: boolean;
}

export interface WaferTransformCache {
  worldPos: THREE.Vector3;
  worldQuat: THREE.Quaternion;
  localPos: THREE.Vector3;
  localQuat: THREE.Quaternion;
  parent: THREE.Object3D | null;
  lastUpdate: number;
}

/**
 * Tracks individual wafer state and transform continuity.
 */
export class WaferTracker {
  wafer: THREE.Group;
  id: number;
  currentStation: string = "foup";
  currentParent: THREE.Object3D | null = null;
  isAttachedToRobot: boolean = false;
  robot: RobotTransformManager | null = null;

  // Transform cache to detect discontinuities
  transformCache: WaferTransformCache = {
    worldPos: new THREE.Vector3(),
    worldQuat: new THREE.Quaternion(),
    localPos: new THREE.Vector3(),
    localQuat: new THREE.Quaternion(),
    parent: null,
    lastUpdate: 0,
  };

  // Motion tracking
  transport: WaferTransport | null = null;
  transportProgress: number = 0;

  constructor(id: number, wafer: THREE.Group) {
    this.id = id;
    this.wafer = wafer;
    this.updateTransformCache();
  }

  /**
   * Cache current world transform to detect discontinuities.
   */
  updateTransformCache(): void {
    this.wafer.getWorldPosition(this.transformCache.worldPos);
    this.wafer.getWorldQuaternion(this.transformCache.worldQuat);
    this.transformCache.parent = this.wafer.parent;
    this.transformCache.lastUpdate = performance.now();
  }

  /**
   * Check if wafer has teleported (parent changed without animation).
   */
  hasTeleported(): boolean {
    if (this.transformCache.parent !== this.wafer.parent) {
      const posDelta = this.transformCache.worldPos.distanceTo(this.wafer.position);
      // If parent changed and position jumped > 0.5m, it's a teleport
      return posDelta > 0.5;
    }
    return false;
  }

  /**
   * Attach wafer to robot gripper.
   * CRITICAL: This must happen smoothly, with the wafer position set to (0,0,0) relative to gripper.
   */
  attachToRobot(robot: RobotTransformManager, scene: THREE.Scene): void {
    // Step 1: Get world position before reparenting
    const worldPosBefore = new THREE.Vector3();
    this.wafer.getWorldPosition(worldPosBefore);

    // Step 2: Remove from current parent (always the scene initially)
    if (this.wafer.parent) {
      this.wafer.parent.remove(this.wafer);
    }

    // Step 3: Attach to robot gripper
    robot.joints.gripper.add(this.wafer);

    // Step 4: Set local position so wafer stays at world position
    const gripperWorldPos = new THREE.Vector3();
    robot.joints.gripper.getWorldPosition(gripperWorldPos);
    this.wafer.position.copy(worldPosBefore).sub(gripperWorldPos);

    // Step 5: Update state
    this.isAttachedToRobot = true;
    this.robot = robot;
    this.currentParent = robot.joints.gripper;

    console.log(`[WAFER ${this.id}] Attached to robot gripper at local pos:`, this.wafer.position.toArray().map((v) => v.toFixed(3)));
  }

  /**
   * Detach wafer from robot and place in scene.
   */
  detachFromRobot(scene: THREE.Scene, worldPos: THREE.Vector3): void {
    if (!this.isAttachedToRobot) return;

    // Step 1: Get world position
    const worldPosBefore = new THREE.Vector3();
    this.wafer.getWorldPosition(worldPosBefore);

    // Step 2: Remove from gripper
    if (this.robot) {
      this.robot.joints.gripper.remove(this.wafer);
    }

    // Step 3: Add back to scene
    scene.add(this.wafer);

    // Step 4: Set world position so it stays at the station
    this.wafer.position.copy(worldPos);

    // Step 5: Keep wafer flat (only Y rotation)
    this.wafer.rotation.set(0, Math.random() * Math.PI * 2, 0);

    // Step 6: Update state
    this.isAttachedToRobot = false;
    this.robot = null;
    this.currentParent = scene;

    console.log(`[WAFER ${this.id}] Detached from robot, placed at:`, worldPos.toArray().map((v) => v.toFixed(3)));
  }

  /**
   * Update wafer position relative to robot if attached.
   * Called every frame during robot transport.
   */
  updateIfAttached(): void {
    if (!this.isAttachedToRobot || !this.robot) return;

    // Wafer automatically moves with gripper due to parent-child relationship
    // Just validate that the parenting is still correct
    if (this.wafer.parent !== this.robot.joints.gripper) {
      console.warn(`[WAFER ${this.id}] Lost parent-child relationship!`);
      this.attachToRobot(this.robot, this.wafer.parent as THREE.Scene);
    }
  }

  /**
   * Verify transform continuity (no sudden jumps).
   */
  validateTransforms(): boolean {
    const currentWorldPos = new THREE.Vector3();
    this.wafer.getWorldPosition(currentWorldPos);

    const delta = currentWorldPos.distanceTo(this.transformCache.worldPos);
    const maxAllowedDelta = 1.0; // 1 meter max per frame (60fps)

    if (delta > maxAllowedDelta) {
      console.warn(
        `[WAFER ${this.id}] Large transform delta detected: ${delta.toFixed(3)}m ` +
          `(expected < ${maxAllowedDelta}m). Parent: ${this.wafer.parent?.name}`
      );
      return false;
    }

    this.updateTransformCache();
    return true;
  }

  /**
   * Get visibility based on transport state.
   */
  shouldBeVisible(): boolean {
    // Wafer visible unless explicitly hidden
    return true;
  }
}

/**
 * Central wafer manager.
 * Coordinates all wafer ownership and transport operations.
 */
export class WaferManager {
  scene: THREE.Scene;
  wafers: WaferTracker[] = [];
  activeTransports: Map<number, WaferTransport> = new Map();
  stationOccupancy: Map<string, number> = new Map(); // Which wafer is at which station

  constructor(scene: THREE.Scene) {
    this.scene = scene;
  }

  /**
   * Register a wafer.
   */
  registerWafer(id: number, mesh: THREE.Group): WaferTracker {
    const tracker = new WaferTracker(id, mesh);
    this.wafers.push(tracker);
    return tracker;
  }

  /**
   * Get wafer tracker by ID.
   */
  getWafer(id: number): WaferTracker | null {
    return this.wafers.find((w) => w.id === id) || null;
  }

  /**
   * Attach wafer to robot.
   * This initiates a transport operation.
   */
  pickupWafer(waferID: number, robot: RobotTransformManager): boolean {
    const wafer = this.getWafer(waferID);
    if (!wafer) {
      console.error(`[WAFER MGR] Cannot find wafer ${waferID}`);
      return false;
    }

    if (wafer.isAttachedToRobot) {
      console.warn(`[WAFER MGR] Wafer ${waferID} already attached to robot`);
      return false;
    }

    // Perform attachment
    wafer.attachToRobot(robot, this.scene);
    return true;
  }

  /**
   * Place wafer at station.
   * This completes a transport operation.
   */
  placeWaferAt(waferID: number, stationID: string, position: THREE.Vector3): boolean {
    const wafer = this.getWafer(waferID);
    if (!wafer) {
      console.error(`[WAFER MGR] Cannot find wafer ${waferID}`);
      return false;
    }

    if (!wafer.isAttachedToRobot) {
      console.warn(`[WAFER MGR] Wafer ${waferID} not attached to robot`);
      return false;
    }

    // ── SCANNER: place wafer precisely on the internal chuck ──
    if (stationID === 'scanner') {
      let scannerGroup: THREE.Group | null = null;
      this.scene.traverse((obj) => {
        if (scannerGroup) return;
        if (obj instanceof THREE.Group && obj.userData?.id === 'scanner') {
          scannerGroup = obj;
        }
      });

      const chuck = scannerGroup?.userData?.scannerChuckTop as THREE.Object3D | undefined;
      if (chuck) {
        const chuckWorldPos = new THREE.Vector3();
        chuck.getWorldPosition(chuckWorldPos);
        const WAFER_HALF_THICKNESS = 0.035;
        const SEATING_GAP = 0.002;
        const seatY = chuckWorldPos.y + 0.03 + WAFER_HALF_THICKNESS + SEATING_GAP;
        const placePos = new THREE.Vector3(chuckWorldPos.x, seatY, chuckWorldPos.z);

        wafer.detachFromRobot(this.scene, placePos);
        wafer.wafer.rotation.set(0, 0, 0);
        wafer.wafer.quaternion.identity();
        wafer.wafer.updateMatrixWorld(true);

        this.stationOccupancy.set(stationID, waferID);
        wafer.currentStation = stationID;
        return true;
      }
    }

    // Perform detachment
    wafer.detachFromRobot(this.scene, position);

    // Update station tracking
    this.stationOccupancy.set(stationID, waferID);
    wafer.currentStation = stationID;

    return true;
  }

  /**
   * Update all wafers (should be called every frame).
   */
  update(): void {
    this.wafers.forEach((wafer) => {
      wafer.updateIfAttached();
      wafer.validateTransforms();
    });
  }

  /**
   * Get which wafer (if any) is at a station.
   */
  getWaferAtStation(stationID: string): WaferTracker | null {
    const waferID = this.stationOccupancy.get(stationID);
    return waferID !== undefined ? this.getWafer(waferID) : null;
  }

  /**
   * Start transport of wafer from one station to another.
   */
  startTransport(waferID: number, fromStation: string, toStation: string, duration: number): void {
    const transport: WaferTransport = {
      wafer: this.getWafer(waferID)?.wafer || new THREE.Group(),
      fromStation,
      toStation,
      startTime: performance.now(),
      duration,
      isComplete: false,
    };

    this.activeTransports.set(waferID, transport);
    console.log(`[WAFER MGR] Transport started: Wafer ${waferID} from ${fromStation} to ${toStation} (${duration.toFixed(2)}s)`);
  }

  /**
   * Update active transports.
   */
  updateTransports(currentTime: number): void {
    this.activeTransports.forEach((transport, waferID) => {
      if (transport.isComplete) return;

      const elapsed = currentTime - transport.startTime;
      const progress = Math.min(elapsed / transport.duration, 1);

      if (progress >= 1) {
        transport.isComplete = true;
        this.activeTransports.delete(waferID);
        console.log(`[WAFER MGR] Transport complete: Wafer ${waferID}`);
      }
    });
  }

  /**
   * Debug: Get occupancy status of all stations.
   */
  getOccupancyStatus(): Record<string, number | null> {
    const status: Record<string, number | null> = {};
    this.stationOccupancy.forEach((waferID, stationID) => {
      status[stationID] = waferID;
    });
    return status;
  }

  /**
   * Debug: Validate all wafer transforms.
   */
  validateAllWafers(): boolean {
    return this.wafers.every((wafer) => wafer.validateTransforms());
  }
}
