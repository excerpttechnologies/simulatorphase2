'use client'

import * as THREE from 'three'
import { BonderNarrationManager, getBonderNarration } from './BonderNarration.js'

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

    // State-driven narration manager
    this.narrationManager = null
    if (bonderController?.narration) {
      this.narrationManager = new BonderNarrationManager(bonderController.narration)
    }

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

  /** Update state and trigger appropriate narration */
  _setState(newState) {
    const oldState = this.state
    this.state = newState

    // Trigger state-driven narration with current chip index
    if (this.narrationManager) {
      this.narrationManager.speakForState(newState, this.currentChipIndex + 1)
    }

    this.log(`State: ${oldState} → ${newState}`)
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
    this._setState('CHIP_PICK_APPROACH')
    this.currentChipIndex = 0
    this.phaseT = 0
    this.log('Starting 6-chip placement sequence')
    this.onNarrate('Beginning chip placement sequence. 6 chips to place.')
    return true
  }

  reset() {
    this._setState('IDLE')
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

    // Reset narration
    if (this.narrationManager) {
      this.narrationManager.reset()
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
      this._setState('CHIP_PICK_LOWER')
      this.phaseT = 0
      this.log(`Approaching chip ${this.currentChipIndex + 1}`)
    }
  }

  _handlePickLower(dt) {
    // Lower robot to chip
    if (this.phaseT > 0.4) {
      this._setState('CHIP_PICK_ATTACH')
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
      this._setState('CHIP_PICK_LIFT')
      this.phaseT = 0
    }
  }

  _handlePickLift(dt) {
    // Lift chip vertically
    if (this.phaseT > 0.4) {
      this._setState('CHIP_FLUX_APPROACH')
      this.phaseT = 0
      this.log(`Chip ${this.currentChipIndex + 1} lifted`)
    }
  }

  _handleFluxApproach(dt) {
    // Move to flux station at safe height
    if (this.phaseT > 0.6) {
      this._setState('CHIP_FLUX_LOWER')
      this.phaseT = 0
      this.log(`Moving to flux station`)
    }
  }

  _handleFluxLower(dt) {
    // Lower chip into flux
    if (this.phaseT > 0.3) {
      this._setState('CHIP_FLUX_DWELL')
      this.phaseT = 0
      this.log(`Dipping chip ${this.currentChipIndex + 1} in flux`)
    }
  }

  _handleFluxDwell(dt) {
    // Hold chip in flux for dwell time
    if (this.phaseT > this.fluxDwellTime) {
      this._setState('CHIP_FLUX_RETRACT')
      this.phaseT = 0
      this.log(`Flux dwell complete`)
    }
  }

  _handleFluxRetract(dt) {
    // Retract from flux
    if (this.phaseT > 0.3) {
      this._setState('CHIP_PLACE_APPROACH')
      this.phaseT = 0
      this.log(`Retracting from flux`)
    }
  }

  _handlePlaceApproach(dt) {
    // Move to placement position at safe height
    const targetPos = this.chipPositions[this.currentChipIndex]
    if (this.phaseT > 0.6) {
      this._setState('CHIP_PLACE_LOWER')
      this.phaseT = 0
      this.log(`Approaching placement position ${this.currentChipIndex + 1}`)
    }
  }

  _handlePlaceLower(dt) {
    // Lower chip to substrate
    if (this.phaseT > 0.4) {
      this._setState('CHIP_PLACE_RELEASE')
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
      this._setState('CHIP_RETRACT')
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
        this._setState('COMPLETE')
        this.phaseT = 0
        this.log('All 6 chips placed')
        this.onNarrate('All 6 chips placed successfully.')
      } else {
        // Move to next chip
        this.currentChipIndex++
        this.chipAttached = false
        this.activeChip = null
        this._setState('CHIP_PICK_APPROACH')
        this.phaseT = 0
        this.log(`Moving to chip ${this.currentChipIndex + 1}`)
      }
    }
  }

  _handleComplete(dt) {
    if (this.phaseT > 1.0) {
      this._setState('IDLE')
      this.onSequenceComplete()
      this.log('Chip placement sequence complete')

      // Trigger board completion narration
      this.onNarrate('All six chips have been successfully placed. The chip assembly is now complete.')
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

      // Get the actual board (BondBase) from the two-robot process
      const board = this.bonderController?.twoRobot?.board

      if (this.activeChip && board) {
        // Update world matrix for accurate transform
        this.activeChip.updateMatrixWorld(true)
        board.updateMatrixWorld(true)

        // Store current world transform
        const worldPosition = new THREE.Vector3()
        const worldQuaternion = new THREE.Quaternion()
        const worldScale = new THREE.Vector3()

        this.activeChip.getWorldPosition(worldPosition)
        this.activeChip.getWorldQuaternion(worldQuaternion)
        this.activeChip.getWorldScale(worldScale)

        // Attach chip to board while preserving world transform
        board.add(this.activeChip)

        // Set chip position on board (in board's local space)
        this.activeChip.position.set(targetPos.x, targetPos.y, targetPos.z)
        this.activeChip.quaternion.identity()
        this.activeChip.scale.copy(worldScale)

        this.activeChip.visible = true

        this.log(`Chip ${this.currentChipIndex + 1} attached to board (BondBase)`)
        console.log(`[CHIP PLACEMENT] Chip ${this.currentChipIndex + 1} attached to board:`, board.name)
      } else if (this.activeChip) {
        // Fallback: position chip at target without board attachment
        this.activeChip.position.set(targetPos.x, targetPos.y, targetPos.z)
        this.log(`Chip ${this.currentChipIndex + 1} positioned at target (no board attachment)`)
      }
    }
  }
}
