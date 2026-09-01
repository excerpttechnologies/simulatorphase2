'use client'

/**
 * FlipStageController — models the 180° die flip.
 * The actual motion is executed by the orchestrator (rotating the pickup/
 * flipper tool that the chip is attached to), so the chip stays attached and
 * rotates TOGETHER with the tool (never independently).
 */
export class FlipStageController {
  constructor(config) {
    this.config = config.flip
    this.state = { ready: false, rotating: false, flipped: false }
  }

  begin() {
    this.state.ready = true
    this.state.rotating = true
    this.state.flipped = false
  }

  /**
   * Called by orchestrator after the tool has completed its 180° rotation.
   * Proves the die actually flipped by comparing the chip's WORLD orientation
   * before vs after the tool rotation: the angular change must equal the
   * commanded flip angle (≈180°), because the chip is rigidly carried by the
   * rotating tool.
   */
  verifyFlip(startQuat, endQuat, targetAngle, tolerance = 0.3) {
    const angle = 2 * Math.acos(Math.min(1, Math.abs(startQuat.dot(endQuat))))
    const flipped = Math.abs(angle - targetAngle) <= tolerance
    this.state.flipped = flipped
    this.state.rotating = false
    this.state.ready = flipped
    return flipped
  }

  reset() {
    this.state = { ready: false, rotating: false, flipped: false }
  }
}
