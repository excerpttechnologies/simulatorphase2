'use client'

import * as THREE from 'three'
import { attachObjectPreserveWorldTransform, detachToScene } from './BonderUtils.js'
import { BONDER_CONFIG } from './BonderConfig.js'
import { BONDER_EVENTS } from './BonderEvents.js'

export const CHIP_STATES = {
  IN_TRAY: 'IN_TRAY',
  PICKED: 'PICKED',
  FLIPPED: 'FLIPPED',
  FLUXED: 'FLUXED',
  ALIGNED: 'ALIGNED',
  BONDED: 'BONDED',
}

/**
 * ChipController (DieController) — the SINGLE authoritative source of truth for
 * the die. Owns which physical object is the active chip, who it is attached to,
 * and validates every state transition. No other code may mutate chip state.
 */
export class ChipController {
  constructor(scene, chipMeshDoubles) {
    this.scene = scene
    this.chip = null // THREE.Object3D (a tray chip mesh or a clone)
    this.pickupHold = null // the SKING tool anchor object
    this.bondHold = null // the COLRIGHT tool anchor object
    this.tray = null // group holding tray chips
    this.state = CHIP_STATES.IN_TRAY
    this.orientation = { faceUp: true, faceDown: false, flipped: false }

    this.pickup = {
      vacuum: false,
      chipAttached: false,
      pickupVerified: false,
      retries: 0,
    }

    this.flipped = false
    this.fluxed = false
    this.aligned = false
    this.bonded = false

    this.restTransform = null // {position, quaternion, parent}
    this.events = null
  }

  setBus(events) {
    this.events = events
  }

  setHoldTargets(pickupHold, bondHold) {
    this.pickupHold = pickupHold
    this.bondHold = bondHold
  }

  setTray(tray) {
    this.tray = tray
  }

  /** Register the physical chip mesh and record its tray rest transform. */
  registerChip(chip) {
    this.chip = chip
    this.chip.updateWorldMatrix(true, false)
    this.restTransform = {
      parent: chip.parent,
      position: chip.position.clone(),
      quaternion: chip.quaternion.clone(),
    }
    // strip user animation data so nothing pulls the chip back
    chip.traverse((o) => {
      delete o.userData._anim
    })
  }

  get attachedTo() {
    if (this.pickup && this.pickup.chipAttached && this.chip && this.chip.parent === this.pickupHold) {
      return 'pickup'
    }
    if (this.chip && this.bondHold && this.chip.parent === this.bondHold) {
      return 'bond'
    }
    return null
  }

  get isAttached() {
    return this.attachedTo !== null
  }

  resetRetries() {
    this.pickup.retries = 0
  }

  /** Attach chip to the pickup tool preserving world transform. */
  attachToPickup() {
    if (!this.chip || !this.pickupHold) return false
    const ok = this._attachTo(this.pickupHold)
    if (ok) {
      this.pickup.chipAttached = true
      this.pickup.vacuum = true
    }
    return ok
  }

  attachToBond() {
    if (!this.chip || !this.bondHold) return false
    return this._attachTo(this.bondHold)
  }

  _attachTo(holder) {
    const prev = this.chip.parent
    attachObjectPreserveWorldTransform(this.chip, holder)
    return this.chip.parent === holder
  }

  /** Remove chip from the pickup tool (places it in scene coords preserving world). */
  detachToScene() {
    if (!this.chip) return
    detachToScene(this.chip, this.scene)
    this.pickup.vacuum = false
    this.pickup.chipAttached = false
  }

  /**
   * Verify the physical pickup: chip must be a direct child of the pickup tool
   * AND within tolerance of the tool contact point.
   */
  verifyPickup(contactPointWorld, tolerance = BONDER_CONFIG.pickup.attachTolerance) {
    if (!this.chip) return false
    const attachedOk = this.chip.parent === this.pickupHold
    let distance = Infinity
    if (this.chip && contactPointWorld) {
      const cp = new THREE.Vector3()
      this.chip.getWorldPosition(cp)
      distance = cp.distanceTo(contactPointWorld)
    }
    this.pickup.pickupVerified = attachedOk && distance <= tolerance
    return this.pickup.pickupVerified
  }

  get verifyResult() {
    return this.pickup.pickupVerified
  }

  setState(next) {
    if (!Object.values(CHIP_STATES).includes(next)) return
    this.state = next
    switch (next) {
      case CHIP_STATES.PICKED:
        this.orientation.faceUp = true
        this.orientation.faceDown = false
        this.orientation.flipped = false
        break
      case CHIP_STATES.FLIPPED:
        this.orientation.faceUp = false
        this.orientation.faceDown = true
        this.orientation.flipped = true
        this.flipped = true
        break
      case CHIP_STATES.FLUXED:
        this.fluxed = true
        break
      case CHIP_STATES.ALIGNED:
        this.aligned = true
        break
      case CHIP_STATES.BONDED:
        this.bonded = true
        // no longer carried by any tool
        this.pickup.chipAttached = false
        this.pickup.vacuum = false
        break
      default:
        break
    }
  }

  /** Guards — return null if the operation is valid, else an error string. */
  guardPick() {
    if (this.state === CHIP_STATES.PICKED || this.pickup.chipAttached) return 'CHIP ALREADY PICKED'
    return null
  }

  guardFlip() {
    if (!this.pickup.chipAttached || this.chip.parent !== this.pickupHold) return 'CHIP NOT ATTACHED FOR FLIP'
    return null
  }

  guardFlux() {
    if (!this.flipped) return 'FLUX BEFORE FLIP COMPLETE'
    if (!this.pickup.chipAttached && !(this.chip.parent === this.bondHold)) return 'CHIP NOT ATTACHED FOR FLUX'
    return null
  }

  guardAlign() {
    if (!this.fluxed) return 'ALIGN BEFORE FLUX'
    return null
  }

  guardRelease() {
    if (!this.bonded && this.state !== CHIP_STATES.BONDED) return 'RELEASE BEFORE PLACEMENT'
    return null
  }

  /**
   * Place the chip at an absolute world position and detach from tool.
   * Returns true when placement succeeds.
   */
  placeChip(worldPosition, worldQuat) {
    if (!this.chip) return false
    if (this.chip.parent === this.pickupHold || this.chip.parent === this.bondHold) {
      detachToScene(this.chip, this.scene)
    }
    this.chip.position.copy(worldPosition)
    if (worldQuat) this.chip.quaternion.copy(worldQuat)
    return true
  }

  /** Restore the chip to its original tray slot. */
  restoreToTray() {
    if (!this.chip || !this.restTransform) return
    const parent = this.restTransform.parent
    if (this.chip.parent !== parent) {
      // re-add
      const prevParent = this.chip.parent
      const worldPos = new THREE.Vector3()
      const worldQ = new THREE.Quaternion()
      this.chip.updateWorldMatrix(true, false)
      this.chip.getWorldPosition(worldPos)
      this.chip.getWorldQuaternion(worldQ)
      if (parent) parent.add(this.chip)
      this.chip.position.copy(this.restTransform.position)
      this.chip.quaternion.copy(this.restTransform.quaternion)
    } else {
      this.chip.position.copy(this.restTransform.position)
      this.chip.quaternion.copy(this.restTransform.quaternion)
    }
    // reset all flags
    this.state = CHIP_STATES.IN_TRAY
    this.pickup.vacuum = false
    this.pickup.chipAttached = false
    this.pickup.pickupVerified = false
    this.pickup.retries = 0
    this.flipped = false
    this.fluxed = false
    this.aligned = false
    this.bonded = false
    this.orientation = { faceUp: true, faceDown: false, flipped: false }
  }

  getStatus() {
    return {
      state: this.state,
      attachedTo: this.attachedTo,
      vacuum: this.pickup.vacuum,
      picked: this.state !== CHIP_STATES.IN_TRAY,
      flipped: this.flipped,
      fluxed: this.fluxed,
      aligned: this.aligned,
      bonded: this.bonded,
      orientation: { ...this.orientation },
      retries: this.pickup.retries,
    }
  }
}
