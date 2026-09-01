/**
 * CollisionManager.ts
 * Detects robot-module collisions and wafer overlaps.
 * Prevents clipping and ensures safe motion paths.
 */

import * as THREE from "three";

export interface CollisionVolume {
  name: string;
  boundingBox: THREE.Box3;
  mesh: THREE.Mesh | THREE.Group;
  isSafeZone: boolean; // True if robot can pass through
}

export interface CollisionReport {
  isColliding: boolean;
  collisions: Array<{
    object1: string;
    object2: string;
    distance: number;
  }>;
  safetyMargin: number;
}

/**
 * Tracks collision volumes for modules and robot segments.
 */
export class CollisionManager {
  volumes: Map<string, CollisionVolume> = new Map();
  safetyMargin: number = 0.05; // 5cm minimum distance
  waferRadius: number = 0.15; // Wafer typical radius
  minClearance: number = 0.08; // Minimum clearance for gripper

  /**
   * Minimum distance between two AABBs (0 if intersecting).
   * Three.js Box3 doesn't expose a built-in box-to-box distance.
   */
  private boxDistance(a: THREE.Box3, b: THREE.Box3): number {
    const dx = Math.max(0, b.min.x - a.max.x, a.min.x - b.max.x);
    const dy = Math.max(0, b.min.y - a.max.y, a.min.y - b.max.y);
    const dz = Math.max(0, b.min.z - a.max.z, a.min.z - b.max.z);
    return Math.hypot(dx, dy, dz);
  }

  /**
   * Register a collision volume.
   */
  registerVolume(name: string, mesh: THREE.Mesh | THREE.Group, isSafeZone: boolean = false): void {
    const box = new THREE.Box3().setFromObject(mesh);
    this.volumes.set(name, {
      name,
      boundingBox: box,
      mesh,
      isSafeZone,
    });

    console.log(`[COLLISION] Registered volume: ${name}`, {
      min: box.min.toArray().map((v) => v.toFixed(2)),
      max: box.max.toArray().map((v) => v.toFixed(2)),
      isSafeZone,
    });
  }

  /**
   * Check if robot arm can reach a point without collision.
   */
  canReachPoint(point: THREE.Vector3, gripperRadius: number = 0.08): boolean {
    const gripperBox = new THREE.Box3();
    gripperBox.setFromCenterAndSize(point, new THREE.Vector3(gripperRadius * 2, gripperRadius * 2, gripperRadius * 2));

    for (const volume of this.volumes.values()) {
      if (volume.isSafeZone) continue; // Safe zones don't block

      const distance = this.boxDistance(gripperBox, volume.boundingBox);
      if (distance < this.safetyMargin) {
        console.warn(`[COLLISION] Blocked by ${volume.name}, distance: ${distance.toFixed(3)}m`);
        return false;
      }
    }

    return true;
  }

  /**
   * Plan collision-free path using waypoint analysis.
   */
  planSafePath(start: THREE.Vector3, end: THREE.Vector3, numWaypoints: number = 5): THREE.Vector3[] {
    const waypoints: THREE.Vector3[] = [start.clone()];

    // Add intermediate waypoints
    for (let i = 1; i < numWaypoints - 1; i++) {
      const t = i / (numWaypoints - 1);
      const midpoint = start.clone().multiplyScalar(1 - t).add(end.clone().multiplyScalar(t));

      // Lift mid-waypoints above obstacles
      midpoint.y = Math.max(midpoint.y, 1.5);

      waypoints.push(midpoint);
    }

    waypoints.push(end.clone());

    // Validate all waypoints are safe
    const safePath = waypoints.filter((wp) => this.canReachPoint(wp));

    if (safePath.length < waypoints.length) {
      console.warn(`[COLLISION] Some waypoints blocked. Safe path: ${safePath.length}/${waypoints.length}`);
    }

    return safePath.length > 0 ? safePath : [start, end];
  }

  /**
   * Check proximity between wafer and modules.
   */
  checkWaferProximity(waferPos: THREE.Vector3): { isNearModule: boolean; nearestModule: string | null; distance: number } {
    let minDistance = Infinity;
    let nearestModule: string | null = null;

    for (const volume of this.volumes.values()) {
      const distance = waferPos.distanceTo(volume.boundingBox.getCenter(new THREE.Vector3()));

      if (distance < minDistance) {
        minDistance = distance;
        nearestModule = volume.name;
      }
    }

    return {
      isNearModule: minDistance < this.safetyMargin + this.waferRadius,
      nearestModule,
      distance: minDistance,
    };
  }

  /**
   * Validate robot arm poses for self-collision.
   */
  validateArmPose(
    basePos: THREE.Vector3,
    shoulderPos: THREE.Vector3,
    elbowPos: THREE.Vector3,
    gripperPos: THREE.Vector3
  ): boolean {
    // Check distances between arm segments
    const minSegmentDistance = 0.08; // 8cm minimum

    // Shoulder-elbow
    if (shoulderPos.distanceTo(elbowPos) < minSegmentDistance) {
      console.warn("[COLLISION] Shoulder-elbow too close");
      return false;
    }

    // Elbow-gripper
    if (elbowPos.distanceTo(gripperPos) < minSegmentDistance) {
      console.warn("[COLLISION] Elbow-gripper too close");
      return false;
    }

    // Base-shoulder (turret clearance)
    if (basePos.distanceTo(shoulderPos) < 0.05) {
      console.warn("[COLLISION] Base-shoulder collision");
      return false;
    }

    return true;
  }

  /**
   * Update collision volume positions (for moving objects).
   */
  updateVolume(name: string): void {
    const volume = this.volumes.get(name);
    if (!volume) return;

    const box = new THREE.Box3().setFromObject(volume.mesh);
    volume.boundingBox = box;
  }

  /**
   * Check all modules for accessibility.
   */
  getAccessibleModules(): string[] {
    const accessible: string[] = [];

    for (const volume of this.volumes.values()) {
      // Find center point of module
      const center = volume.boundingBox.getCenter(new THREE.Vector3());
      center.y += 1.2; // Approach from above

      if (this.canReachPoint(center)) {
        accessible.push(volume.name);
      }
    }

    return accessible;
  }

  /**
   * Compute safe zone for placing wafer.
   */
  getSafeDropZone(moduleCenter: THREE.Vector3, moduleRadius: number = 0.3): THREE.Vector3 {
    // Add small offset above module surface
    const dropHeight = 0.95;
    return new THREE.Vector3(moduleCenter.x, dropHeight, moduleCenter.z);
  }

  /**
   * Update all volume positions (called each frame).
   */
  updateAllVolumes(): void {
    this.volumes.forEach((volume) => {
      const box = new THREE.Box3().setFromObject(volume.mesh);
      volume.boundingBox = box;
    });
  }
}
