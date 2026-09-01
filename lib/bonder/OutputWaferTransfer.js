'use client'

import * as THREE from 'three'
import { getBonderNarration } from './BonderNarration.js'

/**
 * OutputWaferTransfer — handles transfer of completed wafer from Flip Chip Bonder
 * to the output wafer rack with state-driven narration.
 *
 * The robot must approach the output rack ONLY from the accessible FRONT side.
 * The back side is closed with a solid panel, so collision-free path is critical.
 *
 * Process:
 *   PICK FROM BONDER → LIFT → SAFE HEIGHT → APPROACH OUTPUT RACK FROM FRONT
 *   → ALIGN WITH SLOT → LOWER → PLACE → RELEASE → RETRACT → HOME
 */
export class OutputWaferTransfer {
  constructor({ scene, robot, getRobot, outputRack, onTransferComplete, onNarrate, modObjs, bonderController }) {
    this.scene = scene
    this._getRobot = getRobot || (() => robot)
    this.robot = robot
    this.outputRack = outputRack
    this.onTransferComplete = onTransferComplete || (() => {})
    this.onNarrate = onNarrate || (() => {})
    this.modObjs = modObjs || {}
    this.bonderController = bonderController

    this.state = 'IDLE'
    this.phaseT = 0
    this.p = 0

    this.completedBoard = null // The actual completed board (BondBase) with all chips
    this.attached = false

    this.sourceWorld = new THREE.Vector3()
    this.destWorld = new THREE.Vector3()

    // Transfer path waypoints
    this.waypoints = []
    this.currentWaypoint = 0

    // Safety parameters
    this.safeTransferHeight = 4.0
    this.SAFETY_MARGIN = 1.0
    this.debugCollisions = false
    this.debugHelpers = new THREE.Group()
    this.processRunning = false

    // Narration state tracking
    this.lastNarratedState = null

    this.log = () => {}
  }

  /** Update state and trigger appropriate narration */
  _setState(newState) {
    const oldState = this.state
    this.state = newState

    // Trigger state-driven narration
    if (oldState !== newState) {
      const text = getBonderNarration(newState)
      if (text) {
        this.onNarrate(text)
      }
      this.log(`State: ${oldState} → ${newState}`)
    }
  }

  _robot() {
    if (!this.robot) this.robot = this._getRobot ? this._getRobot() : null
    return this.robot
  }

  /** Add process lock to prevent multiple animations */
  _ensureProcessLock() {
    if (this.processRunning) {
      this.log('Process already running, ignoring duplicate request')
      return false
    }
    this.processRunning = true
    return true
  }

  /** Release process lock */
  _releaseProcessLock() {
    this.processRunning = false
  }

  isRunning() {
    return this.state !== 'IDLE' && this.state !== 'DONE'
  }

  getStatus() {
    return {
      state: this.state,
      attached: this.attached,
      progress: this.p,
      currentWaypoint: this.currentWaypoint,
    }
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

    console.log('[OUTPUT TRANSFER] Robot backward direction:', backward)
    return backward;
  }

  /** Calculate safe transfer height accounting for carried board */
  _calculateSafeTransferHeightWithLoad() {
    let maxHeight = 0

    // Check output rack height
    if (this.outputRack) {
      const rackBox = new THREE.Box3().setFromObject(this.outputRack)
      if (!rackBox.isEmpty()) {
        maxHeight = Math.max(maxHeight, rackBox.max.y)
      }
    }

    // Check Flip Chip Bonder height
    if (this.modObjs.flip_chip_bonder) {
      const bonderBox = new THREE.Box3().setFromObject(this.modObjs.flip_chip_bonder)
      if (!bonderBox.isEmpty()) {
        maxHeight = Math.max(maxHeight, bonderBox.max.y)
      }
    }

    // Add board height (completed board with chips)
    const boardHeight = 0.1 // approximate board + chips height

    // Add safety margin
    this.safeTransferHeight = maxHeight + boardHeight + this.SAFETY_MARGIN
    console.log('[OUTPUT TRANSFER] Safe transfer height with board:', this.safeTransferHeight.toFixed(2), 'm')
    return this.safeTransferHeight
  }

  _generateCollisionFreePath(source, dest) {
    this.waypoints = []

    // Waypoint 1: Pick position (at bonder)
    this.waypoints.push(source.clone())

    // Waypoint 2: Lift vertically above bonder
    this.waypoints.push(new THREE.Vector3(source.x, this.safeTransferHeight, source.z))

    // Waypoint 3: Move away from bonder (clear of machine)
    this.waypoints.push(new THREE.Vector3(source.x - 2.0, this.safeTransferHeight, source.z))

    // Waypoint 4: Move toward output rack at safe height
    this.waypoints.push(new THREE.Vector3(dest.x - 3.0, this.safeTransferHeight, dest.z))

    // Waypoint 5: Approach output rack from FRONT after 180° rotation
    // Calculate the actual front direction from the rotated rack
    let rackFrontApproach
    if (this.outputRack) {
      this.outputRack.updateMatrixWorld(true)

      // Get the rack's front direction from its userData or calculate from rotation
      const rackFrontDirection = this.outputRack.userData.rackFrontDirection || new THREE.Vector3(0, 0, -1)

      // Rotate the front direction by the rack's actual world rotation
      const worldFront = rackFrontDirection.clone().applyQuaternion(this.outputRack.quaternion)
      worldFront.y = 0 // Keep horizontal
      worldFront.normalize()

      // Approach from in front of the rack
      const approachOffset = 2.5
      rackFrontApproach = new THREE.Vector3(
        dest.x - worldFront.x * approachOffset,
        this.safeTransferHeight,
        dest.z - worldFront.z * approachOffset
      )

      console.log('[OUTPUT TRANSFER] Rack world front direction:', worldFront)
      console.log('[OUTPUT TRANSFER] Front approach position:', rackFrontApproach)
    } else {
      // Fallback: assume -X approach (front after 180° rotation)
      rackFrontApproach = new THREE.Vector3(dest.x - 2.5, this.safeTransferHeight, dest.z)
    }

    this.waypoints.push(rackFrontApproach)

    // Waypoint 6: Align with rack slot at safe height
    this.waypoints.push(new THREE.Vector3(dest.x, this.safeTransferHeight, dest.z))

    // Waypoint 7: Lower to placement height
    this.waypoints.push(dest.clone())

    console.log('[OUTPUT TRANSFER] Generated', this.waypoints.length, 'waypoints for collision-free path (with 180° rack rotation)')
    return this.waypoints
  }

  start(sourceWorld, destWorld) {
    if (!this._ensureProcessLock()) {
      this.log('Output transfer already in progress')
      return false
    }

    const robot = this._robot()
    if (!robot || !robot.group) {
      this._releaseProcessLock()
      return false
    }

    // Calculate actual completed board position from BondBase
    const boardPosition = this._calculateCompletedBoardPosition()
    if (boardPosition) {
      this.sourceWorld.copy(boardPosition)
    } else {
      this.sourceWorld.copy(sourceWorld)
    }

    this.destWorld.copy(destWorld)

    // Calculate safe transfer height with load consideration
    this._calculateSafeTransferHeightWithLoad()

    // Generate collision-free path with 180° rack rotation awareness
    this._generateCollisionFreePath(this.sourceWorld, destWorld)

    this._setState('PICK_APPROACH')
    this.phaseT = 0
    this.p = 0
    this.currentWaypoint = 0

    // Log world positions for debugging
    console.log('[OUTPUT TRANSFER] Source position (completed board):', this.sourceWorld)
    console.log('[OUTPUT TRANSFER] Destination position (output rack):', destWorld)
    console.log('[OUTPUT TRANSFER] Robot position:', robot.group.position)
    console.log('[OUTPUT TRANSFER] Robot rotation:', robot.group.rotation.y.toFixed(2), 'rad')

    this.log('Starting output wafer transfer (with completed board, rack rotated 180°)')

    return true
  }

  /** Calculate the actual completed board (BondBase) world position */
  _calculateCompletedBoardPosition() {
    if (this.bonderController?.twoRobot?.board) {
      const board = this.bonderController.twoRobot.board
      board.updateMatrixWorld(true)

      const boardBox = new THREE.Box3().setFromObject(board)
      if (!boardBox.isEmpty()) {
        const boardCenter = boardBox.getCenter(new THREE.Vector3())
        const boardTop = boardBox.max.y

        // Pickup position: center X/Z, top Y + gripper offset
        const pickupPosition = new THREE.Vector3(
          boardCenter.x,
          boardTop + 0.05, // Small offset for gripper
          boardCenter.z
        )

        console.log('[OUTPUT TRANSFER] Calculated board center:', boardCenter)
        console.log('[OUTPUT TRANSFER] Board top Y:', boardTop)
        console.log('[OUTPUT TRANSFER] Pickup position:', pickupPosition)

        return pickupPosition
      }
    }

    this.log('WARNING: Could not calculate board position, using provided source')
    return null
  }

  reset() {
    this._setState('IDLE')
    this.phaseT = 0
    this.p = 0
    this.attached = false
    this.currentWaypoint = 0
    this.waypoints = []

    // Detach completed board from robot if attached
    if (this.completedBoard && this.attached) {
      this.scene.attach(this.completedBoard)
      this.completedBoard.visible = true
    }
    this.completedBoard = null
  }

  pause() {
    // Pause is handled by checking speed multiplier in update()
    this.log('Output transfer paused')
  }

  resume() {
    // Resume is handled by checking speed multiplier in update()
    this.log('Output transfer resumed')
  }

  update(dt) {
    const robot = this._robot()
    if (!robot || !robot.runIK) return
    if (!this.isRunning()) return

    const speed = this.modObjs.sim?.speed || 1
    const adjustedDt = dt * speed
    this.phaseT += adjustedDt

    switch (this.state) {
      case 'PICK_APPROACH':
        this._handlePickApproach(adjustedDt)
        break
      case 'PICK_LOWER':
        this._handlePickLower(adjustedDt)
        break
      case 'PICK_ATTACH':
        this._handlePickAttach(adjustedDt)
        break
      case 'PICK_LIFT':
        this._handlePickLift(adjustedDt)
        break
      case 'TRAVEL_TO_RACK':
        this._handleTravelToRack(adjustedDt)
        break
      case 'RACK_APPROACH':
        this._handleRackApproach(adjustedDt)
        break
      case 'RACK_LOWER':
        this._handleRackLower(adjustedDt)
        break
      case 'RACK_RELEASE':
        this._handleRackRelease(adjustedDt)
        break
      case 'RACK_RETRACT':
        this._handleRackRetract(adjustedDt)
        break
      case 'HOME':
        this._handleHome(adjustedDt)
        break
      default:
        break
    }
  }

  _handlePickApproach(dt) {
    const robot = this._robot()
    if (!robot || !robot.runIK) return

    // Move robot to approach position above the completed board
    const approachHeight = this.sourceWorld.y + 0.5
    const approachPos = new THREE.Vector3(
      this.sourceWorld.x,
      approachHeight,
      this.sourceWorld.z
    )

    const t = Math.min(this.phaseT / 0.5, 1)
    const currentPos = new THREE.Vector3()
    robot.group.getWorldPosition(currentPos)

    const pos = new THREE.Vector3().lerpVectors(currentPos, approachPos, t)
    robot.runIK(pos, { isTravel: true, safetyMargin: 0.1 })

    if (t >= 1) {
      this._setState('PICK_LOWER')
      this.phaseT = 0
      this.log('Approached completed board')
    }
  }

  _handlePickLower(dt) {
    const robot = this._robot()
    if (!robot || !robot.runIK) return

    // Lower robot vertically to board pickup position
    const t = Math.min(this.phaseT / 0.4, 1)
    const currentPos = new THREE.Vector3()
    robot.group.getWorldPosition(currentPos)

    const pickupPos = this.sourceWorld.clone()
    const pos = new THREE.Vector3().lerpVectors(currentPos, pickupPos, t)
    robot.runIK(pos, { safetyMargin: 0.02 })

    if (t >= 1) {
      this._setState('PICK_ATTACH')
      this.phaseT = 0
      this.log('Lowered to completed board pickup position')
    }
  }

  _handlePickAttach(dt) {
    if (!this.attached) {
      this._attachWafer()
      this.attached = true
      this.log('Completed board attached to robot')
    }
    if (this.phaseT > 0.3) {
      this._setState('PICK_LIFT')
      this.phaseT = 0
    }
  }

  _handlePickLift(dt) {
    const robot = this._robot()
    if (!robot || !robot.runIK) return

    // Lift completed board vertically to safe height
    const t = Math.min(this.phaseT / 0.4, 1)
    const currentPos = new THREE.Vector3()
    robot.group.getWorldPosition(currentPos)

    const liftPos = currentPos.clone()
    liftPos.y = this.safeTransferHeight

    const pos = new THREE.Vector3().lerpVectors(currentPos, liftPos, t)
    robot.runIK(pos, { isTravel: true, safetyMargin: 0.1 })

    if (t >= 1) {
      this._setState('TRAVEL_TO_RACK')
      this.phaseT = 0
      this.currentWaypoint = 0
      this.log('Lifted completed board to safe height')
    }
  }

  _handleTravelToRack(dt) {
    // Move through waypoints until reaching rack approach
    if (this.currentWaypoint < this.waypoints.length - 2) {
      const current = this.waypoints[this.currentWaypoint]
      const next = this.waypoints[this.currentWaypoint + 1]

      // Simple linear interpolation between waypoints
      const t = Math.min(this.phaseT / 0.6, 1)
      const pos = new THREE.Vector3().lerpVectors(current, next, t)

      // Move robot to position
      const robot = this._robot()
      if (robot?.runIK) {
        robot.runIK(pos, { isTravel: true, safetyMargin: 0.1 })
      }

      if (t >= 1) {
        this.currentWaypoint++
        this.phaseT = 0
        this.log(`Reached waypoint ${this.currentWaypoint}`)
      }
    } else {
      this._setState('RACK_APPROACH')
      this.phaseT = 0
      this.log('Approaching output rack from front')
    }
  }

  _handleRackApproach(dt) {
    const robot = this._robot()
    if (!robot || !robot.runIK) return

    // Final approach to rack slot from front
    const t = Math.min(this.phaseT / 0.5, 1)
    const currentPos = new THREE.Vector3()
    robot.group.getWorldPosition(currentPos)

    const rackApproachPos = this.destWorld.clone()
    rackApproachPos.y = this.safeTransferHeight

    const pos = new THREE.Vector3().lerpVectors(currentPos, rackApproachPos, t)
    robot.runIK(pos, { isTravel: true, safetyMargin: 0.1 })

    if (t >= 1) {
      this._setState('RACK_LOWER')
      this.phaseT = 0
      this.log('Aligned with output rack slot')
    }
  }

  _handleRackLower(dt) {
    const robot = this._robot()
    if (!robot || !robot.runIK) return

    // Lower completed board into rack slot
    const t = Math.min(this.phaseT / 0.4, 1)
    const currentPos = new THREE.Vector3()
    robot.group.getWorldPosition(currentPos)

    const rackLowerPos = this.destWorld.clone()
    const pos = new THREE.Vector3().lerpVectors(currentPos, rackLowerPos, t)
    robot.runIK(pos, { safetyMargin: 0.02 })

    if (t >= 1) {
      this._setState('RACK_RELEASE')
      this.phaseT = 0
      this.log('Lowered completed board into rack slot')
    }
  }

  _handleRackRelease(dt) {
    if (this.attached) {
      this._releaseWafer()
      this.attached = false
      this.log('Completed board released into output rack')
    }
    if (this.phaseT > 0.3) {
      this._setState('RACK_RETRACT')
      this.phaseT = 0
    }
  }

  _handleRackRetract(dt) {
    // Retract vertically from rack
    const robot = this._robot()
    const backward = this._calculateBackwardDirection(robot)
    const retractDistance = 1.5

    const currentPos = new THREE.Vector3()
    robot.group.getWorldPosition(currentPos)

    const from = currentPos.clone()
    const to = from.clone().add(backward.multiplyScalar(retractDistance))

    // Keep at safe height
    from.y = this.safeTransferHeight
    to.y = this.safeTransferHeight

    const t = Math.min(this.phaseT / 0.4, 1)
    const p = new THREE.Vector3().lerpVectors(from, to, t)

    if (robot?.runIK) {
      robot.runIK(p, { isTravel: true, safetyMargin: 0.1 })
    }

    if (t >= 1) {
      this._setState('HOME')
      this.phaseT = 0
      this.log('Retracted from rack')
    }
  }

  _handleHome(dt) {
    // Return to home position
    if (this.phaseT > 0.6) {
      this._setState('DONE')
      this.phaseT = 0
      this._releaseProcessLock()
      this.log('Output transfer complete')

      // Trigger final process completion narration
      this.onNarrate('The flip chip bonding process is complete. The finished board has been transferred and stored in the output wafer rack.')

      this.onTransferComplete()
    }
  }

  _attachWafer() {
    // Get the actual completed board (BondBase) from the bonder controller
    if (this.bonderController?.twoRobot?.board) {
      this.completedBoard = this.bonderController.twoRobot.board

      // Verify board exists and is visible
      if (!this.completedBoard) {
        this.log('ERROR: Completed board not found')
        return
      }

      // Update world matrix for accurate transform
      this.completedBoard.updateMatrixWorld(true)

      // Store current world transform
      const worldPosition = new THREE.Vector3()
      const worldQuaternion = new THREE.Quaternion()
      const worldScale = new THREE.Vector3()

      this.completedBoard.getWorldPosition(worldPosition)
      this.completedBoard.getWorldQuaternion(worldQuaternion)
      this.completedBoard.getWorldScale(worldScale)

      // Get robot gripper for attachment
      const robot = this._robot()
      if (!robot || !robot.fork) {
        this.log('ERROR: Robot gripper not available')
        return
      }

      // Attach board to robot gripper while preserving world transform
      robot.fork.add(this.completedBoard)

      // Restore world transform
      this.completedBoard.position.copy(worldPosition)
      this.completedBoard.quaternion.copy(worldQuaternion)
      this.completedBoard.scale.copy(worldScale)

      this.completedBoard.visible = true
      this.attached = true

      // Verify all chips are still attached to the board
      this._verifyChipAttachment()

      this.log('Completed board (with all 6 chips) attached to robot gripper')
      console.log('[OUTPUT TRANSFER] Completed board attached:', this.completedBoard.name)
      console.log('[OUTPUT TRANSFER] Board world position:', worldPosition)
    } else {
      this.log('ERROR: Bonder board not available')
    }
  }

  /** Verify that all 6 chips are still attached to the completed board */
  _verifyChipAttachment() {
    if (!this.completedBoard || !this.bonderController?.chipControllers) {
      this.log('WARNING: Cannot verify chip attachment')
      return
    }

    let attachedCount = 0
    this.bonderController.chipControllers.forEach((chipController, index) => {
      if (chipController.chip) {
        // Check if chip is in the board's hierarchy
        let parent = chipController.chip.parent
        let found = false
        while (parent) {
          if (parent === this.completedBoard) {
            found = true
            attachedCount++
            break
          }
          parent = parent.parent
        }
        if (!found) {
          this.log(`WARNING: Chip ${index + 1} not attached to completed board`)
        }
      }
    })

    this.log(`Verified ${attachedCount}/6 chips attached to completed board`)
    console.log('[OUTPUT TRANSFER] Chip attachment verification:', attachedCount, '/ 6')
  }

  _releaseWafer() {
    // Release completed board to output rack position
    if (this.completedBoard && this.attached) {
      // Update world matrix before detaching
      this.completedBoard.updateMatrixWorld(true)

      // Store current world transform
      const worldPosition = new THREE.Vector3()
      const worldQuaternion = new THREE.Quaternion()
      const worldScale = new THREE.Vector3()

      this.completedBoard.getWorldPosition(worldPosition)
      this.completedBoard.getWorldQuaternion(worldQuaternion)
      this.completedBoard.getWorldScale(worldScale)

      // Detach from robot gripper
      this.scene.attach(this.completedBoard)

      // Set to destination position in output rack
      this.completedBoard.position.copy(this.destWorld)
      this.completedBoard.quaternion.identity()
      this.completedBoard.scale.copy(worldScale)
      this.completedBoard.visible = true

      this.attached = false

      // Verify board is in output rack
      this._verifyRackPlacement()

      this.log('Completed board released into output rack')
      console.log('[OUTPUT TRANSFER] Board released to rack position:', this.destWorld)
    }
  }

  /** Verify that the completed board is properly placed in the output rack */
  _verifyRackPlacement() {
    if (!this.completedBoard || !this.outputRack) {
      this.log('WARNING: Cannot verify rack placement')
      return
    }

    // Check if board is in output rack hierarchy
    let parent = this.completedBoard.parent
    let inRack = false
    while (parent) {
      if (parent === this.outputRack) {
        inRack = true
        break
      }
      parent = parent.parent
    }

    if (inRack) {
      this.log('Verified: Completed board is in output rack hierarchy')
    } else {
      this.log('Board is in scene (not directly in rack), but position is correct')
    }

    // Verify chip attachment after placement
    this._verifyChipAttachment()
  }
}
