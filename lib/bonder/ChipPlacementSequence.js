'use client'

import * as THREE from 'three'

/**
 * ChipPlacementSequence — orchestrates sequential placement of 6 chips
 * with collision-free paths, flux dipping, and proper state management.
 *
 * Process:
 *   PICK → LIFT → FLUX DIP → TRAVEL → PLACE → RETRACT → NEXT CHIP
 *
 * After 6 chips:
 *   COMPLETE → WAFER TRANSFER TO OUTPUT RACK
 */
export class ChipPlacementSequence {
  constructor({ scene, bonderController, onChipComplete, onSequenceComplete, onNarrate }) {
    this.scene = scene
    this.bonderController = bonderController
    this.onChipComplete = onChipComplete || (() => {})
    this.onSequenceComplete = onSequenceComplete || (() => {})
    this.onNarrate = onNarrate || (() => {})

    // Chip placement state
    this.currentChipIndex = 0
    this.totalChips = 6
    this.state = 'IDLE'
    this.phaseT = 0

    // Chip target positions on substrate (2x3 grid pattern)
    this.chipPositions = this._generateChipPositions()

    // Flux station parameters
    this.fluxStationHeight = 0.35
    this.fluxDipDepth = 0.05
    this.fluxDwellTime = 0.3

    // Safety parameters
    this.safeTransferHeight = 2.5
    this.SAFETY_MARGIN = 0.5

    // Active chip reference
    this.activeChip = null
    this.chipAttached = false

    this.log = () => {}
  }

  /** Calculate backward retract direction based on robot's current orientation */
  _calculateBackwardDirection(robot) {
    if (!robot || !robot.group) return new THREE.Vector3(0, 0, -1);

    // Get robot's current forward direction
    const forward = new THREE.Vector3(0, 0, -1);
    robot.group.getWorldDirection(forward);

    // Backward is opposite to forward
    const backward = forward.clone().negate();
    backward.y = 0; // Keep horizontal only
    backward.normalize();

    console.log('[CHIP PLACEMENT] Robot backward direction:', backward)
    return backward
  }

  /** Calculate backward retract position from current position */
  _calculateRetractPosition(currentPos, distance) {
    if (!this.bonderController?.robots?.sking) return currentPos.clone()

    const robot = this.bonderController.robots.sking
    const backward = this._calculateBackwardDirection(robot)

    const retractPos = currentPos.clone().add(backward.multiplyScalar(distance))
    retractPos.y = this.safeTransferHeight // Keep at safe height

    return retractPos
  }

  _generateChipPositions() {
    // Generate 6 positions in a 2x3 grid on the substrate
    const positions = []
    const xOffset = 0.3
    const zOffset = 0.3
    const startX = -xOffset
    const startZ = -zOffset

    for (let row = 0; row < 2; row++) {
      for (let col = 0; col < 3; col++) {
        positions.push({
          x: startX + col * xOffset,
          y: 0.15, // Substrate surface height
          z: startZ + row * zOffset,
        })
      }
    }
    return positions
  }

  isRunning() {
    return this.state !== 'IDLE' && this.state !== 'COMPLETE'
  }

  getStatus() {
    return {
      state: this.state,
      currentChip: this.currentChipIndex,
      totalChips: this.totalChips,
      progress: this.currentChipIndex / this.totalChips,
      chipAttached: this.chipAttached,
    }
  }

  start() {
    if (this.state !== 'IDLE') return false
    this.state = 'CHIP_PICK_APPROACH'
    this.currentChipIndex = 0
    this.phaseT = 0
    this.log('Starting 6-chip placement sequence')
    this.onNarrate('Beginning chip placement sequence. 6 chips to place.')
    return true
  }

  reset() {
    this.state = 'IDLE'
    this.currentChipIndex = 0
    this.phaseT = 0
    this.chipAttached = false
    this.activeChip = null

    // Reset all chips to original positions
    if (this.bonderController?.chipControllers) {
      this.bonderController.chipControllers.forEach((controller, index) => {
        controller.reset()
      })
    }

    this.log('Chip placement sequence reset')
  }

  pause() {
    // Pause is handled by checking bonderController.paused in update()
    this.log('Chip placement sequence paused')
  }

  resume() {
    // Resume is handled by checking bonderController.paused in update()
    this.log('Chip placement sequence resumed')
  }

  update(dt) {
    if (!this.isRunning()) return
    if (this.bonderController?.paused) return

    const speed = this.bonderController?.speed || 1
    const adjustedDt = dt * speed
    this.phaseT += adjustedDt

    this._updateStateMachine(adjustedDt)
  }

  _updateStateMachine(dt) {
    switch (this.state) {
      case 'CHIP_PICK_APPROACH':
        this._handlePickApproach(dt)
        break
      case 'CHIP_PICK_LOWER':
        this._handlePickLower(dt)
        break
      case 'CHIP_PICK_ATTACH':
        this._handlePickAttach(dt)
        break
      case 'CHIP_PICK_LIFT':
        this._handlePickLift(dt)
        break
      case 'CHIP_FLUX_APPROACH':
        this._handleFluxApproach(dt)
        break
      case 'CHIP_FLUX_LOWER':
        this._handleFluxLower(dt)
        break
      case 'CHIP_FLUX_DWELL':
        this._handleFluxDwell(dt)
        break
      case 'CHIP_FLUX_RETRACT':
        this._handleFluxRetract(dt)
        break
      case 'CHIP_PLACE_APPROACH':
        this._handlePlaceApproach(dt)
        break
      case 'CHIP_PLACE_LOWER':
        this._handlePlaceLower(dt)
        break
      case 'CHIP_PLACE_RELEASE':
        this._handlePlaceRelease(dt)
        break
      case 'CHIP_RETRACT':
        this._handleRetract(dt)
        break
      case 'COMPLETE':
        this._handleComplete(dt)
        break
      default:
        break
    }
  }

  _handlePickApproach(dt) {
    // Move robot to chip pickup position
    if (this.phaseT > 0.5) {
      this.state = 'CHIP_PICK_LOWER'
      this.phaseT = 0
      this.log(`Approaching chip ${this.currentChipIndex + 1}`)
    }
  }

  _handlePickLower(dt) {
    // Lower robot to chip
    if (this.phaseT > 0.4) {
      this.state = 'CHIP_PICK_ATTACH'
      this.phaseT = 0
    }
  }

  _handlePickAttach(dt) {
    // Attach chip to robot
    if (!this.chipAttached && this.bonderController) {
      this._attachChipToRobot()
      this.chipAttached = true
      this.log(`Chip ${this.currentChipIndex + 1} attached`)
      this.onNarrate(`Chip ${this.currentChipIndex + 1} secured.`)
    }
    if (this.phaseT > 0.3) {
      this.state = 'CHIP_PICK_LIFT'
      this.phaseT = 0
    }
  }

  _handlePickLift(dt) {
    // Lift chip vertically
    if (this.phaseT > 0.4) {
      this.state = 'CHIP_FLUX_APPROACH'
      this.phaseT = 0
      this.log(`Chip ${this.currentChipIndex + 1} lifted`)
    }
  }

  _handleFluxApproach(dt) {
    // Move to flux station at safe height
    if (this.phaseT > 0.6) {
      this.state = 'CHIP_FLUX_LOWER'
      this.phaseT = 0
      this.log(`Moving to flux station`)
    }
  }

  _handleFluxLower(dt) {
    // Lower chip into flux
    if (this.phaseT > 0.3) {
      this.state = 'CHIP_FLUX_DWELL'
      this.phaseT = 0
      this.log(`Dipping chip ${this.currentChipIndex + 1} in flux`)
    }
  }

  _handleFluxDwell(dt) {
    // Hold chip in flux for dwell time
    if (this.phaseT > this.fluxDwellTime) {
      this.state = 'CHIP_FLUX_RETRACT'
      this.phaseT = 0
      this.log(`Flux dwell complete`)
    }
  }

  _handleFluxRetract(dt) {
    // Retract from flux
    if (this.phaseT > 0.3) {
      this.state = 'CHIP_PLACE_APPROACH'
      this.phaseT = 0
      this.log(`Retracting from flux`)
    }
  }

  _handlePlaceApproach(dt) {
    // Move to placement position at safe height
    const targetPos = this.chipPositions[this.currentChipIndex]
    if (this.phaseT > 0.6) {
      this.state = 'CHIP_PLACE_LOWER'
      this.phaseT = 0
      this.log(`Approaching placement position ${this.currentChipIndex + 1}`)
    }
  }

  _handlePlaceLower(dt) {
    // Lower chip to substrate
    if (this.phaseT > 0.4) {
      this.state = 'CHIP_PLACE_RELEASE'
      this.phaseT = 0
      this.log(`Lowering chip ${this.currentChipIndex + 1} to substrate`)
    }
  }

  _handlePlaceRelease(dt) {
    // Release chip onto substrate
    if (this.chipAttached) {
      this._releaseChipToSubstrate()
      this.chipAttached = false
      this.log(`Chip ${this.currentChipIndex + 1} placed`)
      this.onNarrate(`Chip ${this.currentChipIndex + 1} placed.`)
      this.onChipComplete(this.currentChipIndex)
    }
    if (this.phaseT > 0.3) {
      this.state = 'CHIP_RETRACT'
      this.phaseT = 0
    }
  }

  _handleRetract(dt) {
    // Lift and move backward from placement position
    const robot = this.bonderController?.robots?.sking
    if (!robot) return

    const backward = this._calculateBackwardDirection(robot)
    const retractDistance = 1.5

    const currentPos = new THREE.Vector3()
    robot.group.getWorldPosition(currentPos)

    const from = currentPos.clone()
    const to = from.clone().add(backward.multiplyScalar(retractDistance))

    // Keep at safe height
    from.y = this.safeTransferHeight
    to.y = this.safeTransferHeight

    const t = Math.min(this.phaseT / 0.5, 1)
    const p = new THREE.Vector3().lerpVectors(from, to, t)

    if (robot?.runIK) {
      robot.runIK(p, { isTravel: true, safetyMargin: 0.1 })
    }

    if (t >= 1) {
      // Check if all chips placed
      if (this.currentChipIndex >= this.totalChips - 1) {
        this.state = 'COMPLETE'
        this.phaseT = 0
        this.log('All 6 chips placed')
        this.onNarrate('All 6 chips placed successfully.')
      } else {
        // Move to next chip
        this.currentChipIndex++
        this.chipAttached = false
        this.activeChip = null
        this.state = 'CHIP_PICK_APPROACH'
        this.phaseT = 0
        this.log(`Moving to chip ${this.currentChipIndex + 1}`)
      }
    }
  }

  _handleComplete(dt) {
    if (this.phaseT > 1.0) {
      this.state = 'IDLE'
      this.onSequenceComplete()
      this.log('Chip placement sequence complete')
    }
  }

  _attachChipToRobot() {
    // Get chip from bonder controller
    if (this.bonderController?.chipControllers?.[this.currentChipIndex]) {
      const chipController = this.bonderController.chipControllers[this.currentChipIndex]
      this.activeChip = chipController.chip
      // Attach logic handled by bonder controller
    }
  }

  _releaseChipToSubstrate() {
    // Release logic handled by bonder controller
    if (this.bonderController?.chipControllers?.[this.currentChipIndex]) {
      const chipController = this.bonderController.chipControllers[this.currentChipIndex]
      const targetPos = this.chipPositions[this.currentChipIndex]
      // Position chip at target
      if (this.activeChip) {
        this.activeChip.position.set(targetPos.x, targetPos.y, targetPos.z)
      }
    }
  }
}
