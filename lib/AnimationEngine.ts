/**
 * AnimationEngine.ts
 * Handles all interpolation, quaternion slerp, easing, and motion curves.
 * Eliminates teleportation by ensuring smooth continuous motion.
 */

import * as THREE from "three";

export enum EaseType {
  LINEAR = "linear",
  QUAD_IN = "quadIn",
  QUAD_OUT = "quadOut",
  QUAD_INOUT = "quadInOut",
  CUBIC_IN = "cubicIn",
  CUBIC_OUT = "cubicOut",
  CUBIC_INOUT = "cubicInOut",
  SINE_IN = "sineIn",
  SINE_OUT = "sineOut",
  SINE_INOUT = "sineInOut",
}

export class Easing {
  static ease(t: number, type: EaseType): number {
    t = Math.max(0, Math.min(1, t)); // Clamp 0-1

    switch (type) {
      case EaseType.LINEAR:
        return t;
      case EaseType.QUAD_IN:
        return t * t;
      case EaseType.QUAD_OUT:
        return 1 - (1 - t) * (1 - t);
      case EaseType.QUAD_INOUT:
        return t < 0.5 ? 2 * t * t : 1 - 2 * (1 - t) * (1 - t);
      case EaseType.CUBIC_IN:
        return t * t * t;
      case EaseType.CUBIC_OUT:
        return 1 - (1 - t) * (1 - t) * (1 - t);
      case EaseType.CUBIC_INOUT:
        return t < 0.5 ? 4 * t * t * t : 1 - 4 * (1 - t) * (1 - t) * (1 - t);
      case EaseType.SINE_IN:
        return 1 - Math.cos((t * Math.PI) / 2);
      case EaseType.SINE_OUT:
        return Math.sin((t * Math.PI) / 2);
      case EaseType.SINE_INOUT:
        return -(Math.cos(Math.PI * t) - 1) / 2;
      default:
        return t;
    }
  }
}

/**
 * CatmullRom spline curve for smooth robot motion.
 * Prevents jerky wafer transport.
 */
export class SplineCurve {
  points: THREE.Vector3[] = [];
  private cache: Map<number, THREE.Vector3> = new Map();

  constructor(points: THREE.Vector3[]) {
    this.points = points.map((p) => p.clone());
  }

  evaluateAt(t: number): THREE.Vector3 {
    // Clamp t to [0, 1]
    t = Math.max(0, Math.min(1, t));

    const cacheKey = Math.round(t * 10000);
    if (this.cache.has(cacheKey)) {
      return this.cache.get(cacheKey)!.clone();
    }

    const numSegments = this.points.length - 3;
    if (numSegments <= 0) {
      return this.points[0].clone();
    }

    const segment = Math.floor(t * numSegments);
    const clampedSeg = Math.max(0, Math.min(numSegments - 1, segment));
    const localT = t * numSegments - clampedSeg;

    const p0 = this.points[clampedSeg];
    const p1 = this.points[clampedSeg + 1];
    const p2 = this.points[clampedSeg + 2];
    const p3 = clampedSeg + 3 < this.points.length ? this.points[clampedSeg + 3] : p2.clone().add(p2).sub(p1);

    // Catmull-Rom matrix calculation
    const v0 = p1.clone().sub(p0).multiplyScalar(0.5);
    const v1 = p2.clone().sub(p1).multiplyScalar(0.5);

    const t2 = localT * localT;
    const t3 = t2 * localT;

    const result = p1.clone()
      .multiplyScalar(2 * t3 - 3 * t2 + 1)
      .add(v0.clone().multiplyScalar(t3 - 2 * t2 + localT))
      .add(p2.clone().multiplyScalar(-2 * t3 + 3 * t2))
      .add(v1.clone().multiplyScalar(t3 - t2));

    this.cache.set(cacheKey, result.clone());
    return result;
  }
}

/**
 * Quaternion-based rotation interpolation.
 * Eliminates Euler flipping, gimbal lock, and yaw inversion.
 */
export class QuaternionInterpolator {
  static slerp(
    qStart: THREE.Quaternion,
    qEnd: THREE.Quaternion,
    t: number,
    easeType: EaseType = EaseType.CUBIC_INOUT
  ): THREE.Quaternion {
    const eased = Easing.ease(t, easeType);
    const result = qStart.clone();
    result.slerp(qEnd, eased);
    return result;
  }

  /**
   * Shortest path quaternion interpolation.
   * Prevents 360° snapping issues.
   */
  static shortestPathSlerp(
    qStart: THREE.Quaternion,
    qEnd: THREE.Quaternion,
    t: number,
    easeType: EaseType = EaseType.CUBIC_INOUT
  ): THREE.Quaternion {
    // Compute dot product
    let dot = qStart.dot(qEnd);

    // If dot product negative, negate one quat for shorter path
    if (dot < 0) {
      qEnd = new THREE.Quaternion(-qEnd.x, -qEnd.y, -qEnd.z, -qEnd.w);
      dot = -dot;
    }

    // Clamp dot product
    dot = Math.max(-1, Math.min(1, dot));

    const eased = Easing.ease(t, easeType);
    const result = qStart.clone();
    result.slerp(qEnd, eased);
    return result;
  }
}

/**
 * Linear interpolation with easing.
 */
export function lerp(
  a: number,
  b: number,
  t: number,
  easeType: EaseType = EaseType.LINEAR
): number {
  const eased = Easing.ease(t, easeType);
  return a * (1 - eased) + b * eased;
}

/**
 * Vector interpolation with easing.
 */
export function lerpVector(
  a: THREE.Vector3,
  b: THREE.Vector3,
  t: number,
  easeType: EaseType = EaseType.LINEAR
): THREE.Vector3 {
  const eased = Easing.ease(t, easeType);
  return a.clone().multiplyScalar(1 - eased).add(b.clone().multiplyScalar(eased));
}

/**
 * Motion timeline executor.
 * Tracks animation progress and applies continuous updates.
 */
export class MotionTimeline {
  startTime: number = 0;
  duration: number = 0;
  elapsed: number = 0;
  isRunning: boolean = false;
  isComplete: boolean = false;

  onUpdate?: (progress: number) => void;
  onComplete?: () => void;

  constructor(duration: number, onUpdate?: (p: number) => void, onComplete?: () => void) {
    this.duration = Math.max(0.001, duration);
    this.onUpdate = onUpdate;
    this.onComplete = onComplete;
  }

  start(): void {
    this.startTime = performance.now();
    this.isRunning = true;
    this.isComplete = false;
  }

  update(currentTime: number): void {
    if (!this.isRunning) return;

    this.elapsed = currentTime - this.startTime;
    const progress = Math.min(this.elapsed / this.duration, 1);

    this.onUpdate?.(progress);

    if (progress >= 1) {
      this.isRunning = false;
      this.isComplete = true;
      this.onComplete?.();
    }
  }

  getProgress(): number {
    if (!this.isRunning && !this.isComplete) return 0;
    return Math.min(this.elapsed / this.duration, 1);
  }

  stop(): void {
    this.isRunning = false;
  }

  reset(): void {
    this.startTime = 0;
    this.elapsed = 0;
    this.isRunning = false;
    this.isComplete = false;
  }
}

/**
 * Delta motion calculator for smooth frame-by-frame updates.
 */
export class DeltaMotion {
  lastValue: number = 0;
  currentValue: number = 0;
  maxDelta: number = 1; // Max change per frame

  setMaxDelta(delta: number): void {
    this.maxDelta = Math.max(0.001, delta);
  }

  step(target: number, maxDelta: number = this.maxDelta): number {
    const delta = target - this.currentValue;
    const clampedDelta = Math.max(-maxDelta, Math.min(maxDelta, delta));
    this.lastValue = this.currentValue;
    this.currentValue += clampedDelta;
    return this.currentValue;
  }

  reset(): void {
    this.lastValue = 0;
    this.currentValue = 0;
  }
}

/**
 * Industrial servo motion profile.
 * Acceleration ramp, constant velocity, deceleration ramp.
 */
export class ServoMotionProfile {
  maxVelocity: number = 1;
  maxAcceleration: number = 2;
  distance: number = 0;
  elapsedTime: number = 0;

  constructor(maxVelocity: number = 1, maxAcceleration: number = 2) {
    this.maxVelocity = maxVelocity;
    this.maxAcceleration = maxAcceleration;
  }

  /**
   * Compute position along S-curve (acceleration → velocity → deceleration)
   */
  getPosition(time: number): number {
    const accelTime = this.maxVelocity / this.maxAcceleration;
    const accelDist = 0.5 * this.maxAcceleration * accelTime * accelTime;

    if (time < accelTime) {
      // Acceleration phase
      return 0.5 * this.maxAcceleration * time * time;
    }

    const decelTime = this.maxVelocity / this.maxAcceleration;
    const constVelTime = (this.distance - 2 * accelDist) / this.maxVelocity;
    const totalTime = accelTime + constVelTime + decelTime;

    if (time < accelTime + constVelTime) {
      // Constant velocity phase
      return accelDist + this.maxVelocity * (time - accelTime);
    }

    if (time < totalTime) {
      // Deceleration phase
      const decelElapsed = time - (accelTime + constVelTime);
      const decelPos = accelDist + this.maxVelocity * constVelTime;
      return decelPos + this.maxVelocity * decelElapsed - 0.5 * this.maxAcceleration * decelElapsed * decelElapsed;
    }

    return this.distance;
  }
}
