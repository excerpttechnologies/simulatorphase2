'use client'

import * as THREE from 'three'

/**
 * Attach a child to a new parent while perfectly preserving its WORLD transform
 * (position, rotation, scale). Used so the chip never jumps when picked up.
 */
export function attachObjectPreserveWorldTransform(child, newParent) {
  if (!child || !newParent || child === newParent) return
  const oldParent = child.parent
  if (!oldParent) return

  // Capture the child's WORLD transform BEFORE re-parenting. Reparenting
  // changes the meaning of the child's local coordinates, so the world
  // transform must be recorded first, then re-derived in the new parent's
  // frame (world = parentWorld * local  =>  local = parentWorld^-1 * world).
  child.updateWorldMatrix(true, false)
  const worldPos = new THREE.Vector3()
  const worldQuat = new THREE.Quaternion()
  const worldScale = new THREE.Vector3()
  child.matrixWorld.decompose(worldPos, worldQuat, worldScale)

  newParent.add(child)

  newParent.updateWorldMatrix(true, false)
  const parentWorldInverse = new THREE.Matrix4().copy(newParent.matrixWorld).invert()
  child.position.copy(worldPos.clone().applyMatrix4(parentWorldInverse))

  const parentWorldQuat = new THREE.Quaternion()
  newParent.getWorldQuaternion(parentWorldQuat)
  child.quaternion.copy(parentWorldQuat.clone().invert().multiply(worldQuat))

  const parentWorldScale = new THREE.Vector3()
  newParent.getWorldScale(parentWorldScale)
  child.scale.copy(worldScale.clone().divide(parentWorldScale))
  child.updateMatrix()
}

/**
 * Correct implementation: world = parentWorld * local  =>  local = parentWorld^-1 * world.
 */
export function recomputeLocalFromWorld(child, parent) {
  parent.updateWorldMatrix(true, false)
  const parentWorldInverse = new THREE.Matrix4().copy(parent.matrixWorld).invert()

  child.updateWorldMatrix(true, false)
  const worldPos = new THREE.Vector3()
  const worldQuat = new THREE.Quaternion()
  const worldScale = new THREE.Vector3()
  child.matrixWorld.decompose(worldPos, worldQuat, worldScale)

  const localPos = worldPos.clone().applyMatrix4(parentWorldInverse)

  const parentWorldQuat = new THREE.Quaternion()
  parent.getWorldQuaternion(parentWorldQuat)
  const localQuat = parentWorldQuat.clone().invert().multiply(worldQuat)

  const parentWorldScale = new THREE.Vector3()
  parent.getWorldScale(parentWorldScale)
  const localScale = new THREE.Vector3(
    worldScale.x / parentWorldScale.x,
    worldScale.y / parentWorldScale.y,
    worldScale.z / parentWorldScale.z
  )

  child.position.copy(localPos)
  child.quaternion.copy(localQuat)
  child.scale.copy(localScale)
  child.updateMatrix()
}

/**
 * Reparent child back to the scene / a target group while preserving world transform.
 */
export function detachObjectPreserveWorldTransform(child, newParent) {
  if (!child || !newParent || child === newParent) return
  const oldParent = child.parent
  if (!oldParent) return

  child.updateWorldMatrix(true, false)
  const worldPos = new THREE.Vector3()
  const worldQuat = new THREE.Quaternion()
  const worldScale = new THREE.Vector3()
  child.matrixWorld.decompose(worldPos, worldQuat, worldScale)

  newParent.add(child)

  if (newParent.parent) newParent.updateWorldMatrix(true, false)
  const parentWorldQuat = new THREE.Quaternion()
  newParent.getWorldQuaternion(parentWorldQuat)
  const parentWorldScale = new THREE.Vector3()
  newParent.getWorldScale(parentWorldScale)

  const parentWorldInv = new THREE.Matrix4().copy(newParent.matrixWorld).invert()
  child.position.copy(worldPos.clone().applyMatrix4(parentWorldInv))
  child.quaternion.copy(parentWorldQuat.clone().invert().multiply(worldQuat))
  child.scale.set(
    worldScale.x / parentWorldScale.x,
    worldScale.y / parentWorldScale.y,
    worldScale.z / parentWorldScale.z
  )
  child.updateMatrix()
}

/**
 * Detach chip: reparent to scene root preserving world transform.
 */
export function detachToScene(child, scene) {
  if (!child || !child.parent) return
  detachObjectPreserveWorldTransform(child, scene)
}

/** Smooth easing. */
export function easeInOut(t) {
  t = Math.max(0, Math.min(1, t))
  return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2
}
export function easeOut(t) {
  t = Math.max(0, Math.min(1, t))
  return 1 - Math.pow(1 - t, 3)
}
export function clamp(v, a, b) {
  return Math.max(a, Math.min(b, v))
}

// ─── Tween scheduler ─────────────────────────────────────────────────────────
// A simple deterministic tween engine driven from an external update(dt) call.
// All durations are specified in *real* seconds and scaled by the global speed.

export class Tween {
  constructor({ from, to, duration, onUpdate, onComplete, ease = easeInOut, object, propX, propY, propZ }) {
    this.from = from || new THREE.Vector3()
    this.to = to || new THREE.Vector3()
    this.duration = Math.max(0.001, duration)
    this.onUpdate = onUpdate
    this.onComplete = onComplete
    this.ease = ease
    this.elapsed = 0
    this.finished = false
    this.object = object
    this.propX = propX
    this.propY = propY
    this.propZ = propZ
  }

  start() {
    this.elapsed = 0
    this.finished = false
    return this
  }

  _apply(progress) {
    if (this.onUpdate) {
      this.onUpdate(progress, this)
      return
    }
    // Fallback: tween object transform component-wise.
    if (this.object && this.propX) {
      const e = this.ease(progress)
      if (this.propX.target !== undefined) this.propX.target.x = this.propX.from.x + (this.propX.to.x - this.propX.from.x) * e
      if (this.propY && this.propY.target) this.propY.target.y = this.propY.from.y + (this.propY.to.y - this.propY.from.y) * e
      if (this.propZ && this.propZ.target) this.propZ.target.z = this.propZ.from.z + (this.propZ.to.z - this.propZ.from.z) * e
    }
  }

  /** Advance by real dt (already not scaled; scaling applied by caller). Returns true when done. */
  update(dt) {
    if (this.finished) return true
    this.elapsed = Math.min(this.elapsed + dt, this.duration)
    const progress = this.duration > 0 ? this.elapsed / this.duration : 1
    this._apply(progress)
    if (progress >= 1) {
      this.finished = true
      if (this.onComplete) this.onComplete()
      return true
    }
    return false
  }
}

export class TweenGroup {
  constructor() {
    this.tweens = []
  }

  add(tween) {
    this.tweens.push(tween)
    return tween
  }

  update(dt) {
    for (let i = this.tweens.length - 1; i >= 0; i--) {
      const done = this.tweens[i].update(dt)
      if (done) this.tweens.splice(i, 1)
    }
  }

  get busy() {
    return this.tweens.length > 0
  }

  clear() {
    this.tweens.length = 0
  }
}

/** Tween a THREE.Object3D's world position along a path with easing (no scale/rotation change). */
export function makeMoveTween(object, to, duration, ease = easeInOut) {
  const fromPos = object.position.clone()
  const fromQ = object.quaternion.clone()
  const fromS = object.scale.clone()
  return new Tween({
    from: fromPos.clone(),
    to,
    duration,
    ease,
    onUpdate(p) {
      const e = ease(p)
      object.position.lerpVectors(fromPos, to, e)
    },
  })
}
