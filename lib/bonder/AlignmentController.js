'use client'

import * as THREE from 'three'

/**
 * AlignmentController — coarse then fine alignment of the chip to the bond
 * target before placement. Tracks X/Y/Z/theta error against the configuration
 * tolerance so the machine never proceeds with a misaligned chip.
 */
export class AlignmentController {
  constructor(config) {
    this.config = config.alignment
    this.state = { coarse: false, fine: false, ready: false }
    this._target = null
  }

  setTarget(target) {
    this._target = target // { position: Vector3, rotation: number }
  }

  begin() {
    this.state.coarse = false
    this.state.fine = false
    this.state.ready = false
  }

  markCoarse() {
    this.state.coarse = true
  }

  /**
   * @param chipPos world position
   * @param chipTheta chip orientation (radians)
   */
  verifyFine(chipPos, chipTheta) {
    if (!this._target) {
      this.state.fine = false
      this.state.ready = false
      return false
    }
    const dx = chipPos.x - this._target.position.x
    const dy = chipPos.y - this._target.position.y
    const dz = chipPos.z - this._target.position.z
    const dTheta = Math.abs(chipTheta - this._target.rotation)
    const posOk = Math.abs(dx) <= this.config.positionTolerance &&
      Math.abs(dy) <= this.config.positionTolerance &&
      Math.abs(dz) <= this.config.positionTolerance
    const rotOk = dTheta <= this.config.rotationTolerance

    this.state.fine = posOk && rotOk
    this.state.ready = this.state.fine && this.state.coarse
    return this.state.ready
  }

  reset() {
    this.state = { coarse: false, fine: false, ready: false }
  }
}
