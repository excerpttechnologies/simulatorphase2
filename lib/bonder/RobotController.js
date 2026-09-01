'use client'

import { TweenGroup, Tween, easeInOut } from './BonderUtils'

/**
 * RobotController — drives a gantry-style robot's articulation axes through
 * the tween engine. Each DOF is mapped to an axis object supplied by the
 * orchestrator (which knows the GLB node names).
 *
 * A robot exposes:
 *  - moveX(node, targetX, duration)   : carriage travel (X)
 *  - moveZ(node, targetY, duration)   : vertical lift (Y)
 *  - rotate(node, angleRad, duration) : rotary / flip (rotation.z)
 *  - grip(nodeA, nodeB, openAmount)   : gripper jaws
 */
export class RobotController {
  constructor(name, tweenGroup) {
    this.name = name
    this.tweens = tweenGroup || new TweenGroup()
    this.jawOpen = 1
  }

  moveX(node, targetX, duration) {
    if (!node) return Promise.resolve()
    const from = node.position.x
    return this._tweenAxis(node, 'position', 'x', from, targetX, duration)
  }

  moveZ(node, targetY, duration) {
    if (!node) return Promise.resolve()
    const from = node.position.y
    return this._tweenAxis(node, 'position', 'y', from, targetY, duration)
  }

  rotate(node, angleRad, duration) {
    if (!node) return Promise.resolve()
    const from = node.rotation.z
    return this._tweenRot(node, from, angleRad, duration)
  }

  grip(openAmount, closureDuration) {
    this.jawOpen = openAmount
    return Promise.resolve(this.jawOpen)
  }

  _tweenAxis(obj, comp, axis, from, to, duration) {
    return new Promise((resolve) => {
      const t = new Tween({
        from,
        to,
        duration,
        ease: easeInOut,
        onUpdate(p) {
          const e = easeInOut(p)
          obj[comp][axis] = from + (to - from) * e
        },
        onComplete() {
          obj[comp][axis] = to
          resolve()
        },
      })
      t.start()
      this.tweens.add(t)
    })
  }

  _tweenRot(obj, from, to, duration) {
    return new Promise((resolve) => {
      const t = new Tween({
        from,
        to,
        duration,
        ease: easeInOut,
        onUpdate(p) {
          const e = easeInOut(p)
          obj.rotation.z = from + (to - from) * e
        },
        onComplete() {
          obj.rotation.z = to
          resolve()
        },
      })
      t.start()
      this.tweens.add(t)
    })
  }

  clear() {
    this.tweens.clear()
  }
}
