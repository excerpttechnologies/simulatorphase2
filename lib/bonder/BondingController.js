'use client'

/**
 * BondingController — models touchdown, bond-force application (visual), dwell,
 * and the release/verify sequence. The chip is only released AFTER it reaches
 * the substrate contact height, and placement is only verified against the
 * bond target before the recipe marks the stage complete.
 */
export class BondingController {
  constructor(config) {
    this.config = config.bonding
    this.state = {
      started: false,
      touchedDown: false,
      bonded: false,
      released: false,
      verified: false,
    }
  }

  begin() {
    this.state = {
      started: true,
      touchedDown: false,
      bonded: false,
      released: false,
      verified: false,
    }
  }

  markTouchdown() {
    this.state.touchedDown = true
  }

  markBond() {
    this.state.bonded = this.state.touchedDown
    return this.state.bonded
  }

  markReleased() {
    if (!this.state.bonded) return false
    this.state.released = true
    return true
  }

  /**
   * Verify final placement distance to the bond target.
   */
  verify(chipWorldPos, targetPos, tolerance = 0.08) {
    const dx = chipWorldPos.x - targetPos.x
    const dy = chipWorldPos.y - targetPos.y
    const dz = chipWorldPos.z - targetPos.z
    const dist = Math.sqrt(dx * dx + dy * dy + dz * dz)
    this.state.verified = dist <= tolerance
    return this.state.verified
  }

  reset() {
    this.state = {
      started: false,
      touchedDown: false,
      bonded: false,
      released: false,
      verified: false,
    }
  }
}
