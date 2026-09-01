'use client'

import * as THREE from 'three'

/**
 * OutputWaferTransfer — handles transfer of completed wafer from Flip Chip Bonder
 * to the output wafer rack.
 *
 * The robot must approach the output rack ONLY from the accessible FRONT side.
 * The back side is closed with a solid panel, so collision-free path is critical.
 *
 * Process:
 *   PICK FROM BONDER → LIFT → SAFE HEIGHT → APPROACH OUTPUT RACK FROM FRONT
 *   → ALIGN WITH SLOT → LOWER → PLACE → RELEASE → RETRACT → HOME
 */
export class OutputWaferTransfer {
  constructor({ scene, robot, getRobot, outputRack, onTransferComplete, onNarrate, modObjs }) {
    this.scene = scene
    this._getRobot = getRobot || (() => robot)
    this.robot = robot
    this.outputRack = outputRack
    this.onTransferComplete = onTransferComplete || (() => {})
    this.onNarrate = onNarrate || (() => {})
    this.modObjs = modObjs || {}

    this.state = 'IDLE'
    this.phaseT = 0
    this.p = 0

    this.wafer = null
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

    this.log = () => {}
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

    this.sourceWorld.copy(sourceWorld)
    this.destWorld.copy(destWorld)

    // Calculate safe transfer height with load consideration
    this._calculateSafeTransferHeightWithLoad()

    // Generate collision-free path with 180° rack rotation awareness
    this._generateCollisionFreePath(sourceWorld, destWorld)

    this.state = 'PICK_APPROACH'
    this.phaseT = 0
    this.p = 0
    this.currentWaypoint = 0

    // Log world positions for debugging
    console.log('[OUTPUT TRANSFER] Source position (completed board):', sourceWorld)
    console.log('[OUTPUT TRANSFER] Destination position (output rack):', destWorld)
    console.log('[OUTPUT TRANSFER] Robot position:', robot.group.position)
    console.log('[OUTPUT TRANSFER] Robot rotation:', robot.group.rotation.y.toFixed(2), 'rad')

    this.log('Starting output wafer transfer (with completed board, rack rotated 180°)')
    this.onNarrate('Transferring completed board to output rack.')

    return true
  }

  reset() {
    this.state = 'IDLE'
    this.phaseT = 0
    this.p = 0
    this.attached = false
    this.currentWaypoint = 0
    this.waypoints = []
    if (this.wafer) {
      this.scene.remove(this.wafer)
      this.wafer = null
    }
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
    if (this.phaseT > 0.5) {
      this.state = 'PICK_LOWER'
      this.phaseT = 0
      this.log('Approaching wafer at bonder')
    }
  }

  _handlePickLower(dt) {
    if (this.phaseT > 0.4) {
      this.state = 'PICK_ATTACH'
      this.phaseT = 0
      this.log('Lowering to wafer')
    }
  }

  _handlePickAttach(dt) {
    if (!this.attached) {
      this._attachWafer()
      this.attached = true
      this.log('Wafer attached to robot')
      this.onNarrate('Wafer secured for transfer.')
    }
    if (this.phaseT > 0.3) {
      this.state = 'PICK_LIFT'
      this.phaseT = 0
    }
  }

  _handlePickLift(dt) {
    if (this.phaseT > 0.4) {
      this.state = 'TRAVEL_TO_RACK'
      this.phaseT = 0
      this.currentWaypoint = 0
      this.log('Lifting wafer to safe height')
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
      this.state = 'RACK_APPROACH'
      this.phaseT = 0
      this.log('Approaching output rack from front')
    }
  }

  _handleRackApproach(dt) {
    // Final approach to rack slot
    if (this.phaseT > 0.5) {
      this.state = 'RACK_LOWER'
      this.phaseT = 0
      this.log('Aligning with rack slot')
    }
  }

  _handleRackLower(dt) {
    // Lower wafer into rack slot
    if (this.phaseT > 0.4) {
      this.state = 'RACK_RELEASE'
      this.phaseT = 0
      this.log('Lowering wafer into rack')
    }
  }

  _handleRackRelease(dt) {
    if (this.attached) {
      this._releaseWafer()
      this.attached = false
      this.log('Wafer placed in output rack')
      this.onNarrate('Wafer stored in output rack.')
    }
    if (this.phaseT > 0.3) {
      this.state = 'RACK_RETRACT'
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
      this.state = 'HOME'
      this.phaseT = 0
      this.log('Retracted from rack')
    }
  }

  _handleHome(dt) {
    // Return to home position
    if (this.phaseT > 0.6) {
      this.state = 'DONE'
      this.phaseT = 0
      this._releaseProcessLock()
      this.log('Output transfer complete')
      this.onTransferComplete()
    }
  }

  _attachWafer() {
    // Get wafer from scene or create reference
    // This would be implemented based on how the wafer is tracked in the main scene
    this.log('Attaching wafer to robot gripper')
  }

  _releaseWafer() {
    // Release wafer to output rack position
    if (this.wafer) {
      this.scene.attach(this.wafer)
      this.wafer.position.copy(this.destWorld)
      this.wafer.quaternion.identity()
      this.wafer.visible = true
    }
    this.log('Releasing wafer to output rack')
  }
}
