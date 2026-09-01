'use client'

import * as THREE from 'three'

/**
 * WaferBonderTransfer — drives the EFEM robot to carry a 300mm wafer from the
 * input wafer rack (FOUP) to the Flip Chip Bonder's Ring Vacuum Pedestal bond
 * working plane.
 *
 * It reuses the existing robot IK (robot.runIK) and the wafer attach/detach
 * helpers so the motion is real (rail travel + articulated arm + gripper), not
 * teleported. It runs its own lightweight timeline so it can live beside the
 * photolithography flow without interfering with it, and it is pause/speed
 * aware (call update(dt*speed) only while running).
 *
 * State machine:
 *   IDLE → R2FOUP (rail to rack) → APPROACH → INSERT → CONTACT → ATTACH
 *   → LIFT → TRAVEL (rail + bezier arc to bonder) → LOWER → PLACE → RETRACT
 *   → HOME
 */
export class WaferBonderTransfer {
  constructor({ scene, robot, getRobot, onPlacementComplete, onNarrate, modObjs }) {
    this.scene = scene
    this._getRobot = getRobot || (() => robot)
    this.robot = robot
    this.onPlacementComplete = onPlacementComplete || (() => {})
    this.onNarrate = onNarrate || (() => {})
    this.modObjs = modObjs || {}

    this.state = 'IDLE'
    this.phaseT = 0
    this.p = 0

    this.wafer = null // the wafer mesh we create for the transfer
    this.attached = false

    this.sourceWorld = new THREE.Vector3()
    this.destWorld = new THREE.Vector3()

    // Bezier travel path
    this.bezierStart = new THREE.Vector3()
    this.bezierEnd = new THREE.Vector3()
    this.bezierCP1 = new THREE.Vector3()
    this.bezierCP2 = new THREE.Vector3()
    this.bezierT = 0

    this.transferHeight = 4.8 // safe cruise height (world y) - will be calculated from bounding boxes
    this.pickY = 0
    this.destY = 0

    // Collision detection
    this.SAFETY_MARGIN = 1.5 // meters above highest obstacle
    this.debugCollisions = false
    this.debugHelpers = new THREE.Group()
    this.processRunning = false

    this.log = () => {}
  }

  // Resolve the robot at call time (the EFEM robot loads asynchronously from
  // GLB, so it may not exist yet when the controller is constructed).
  _robot() {
    if (!this.robot) this.robot = this._getRobot ? this._getRobot() : null
    return this.robot
  }

  isRunning() {
    return this.state !== 'IDLE' && this.state !== 'DONE'
  }

  getStatus() {
    return {
      state: this.state,
      attached: this.attached,
      progress: this.p,
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

    console.log('[TRANSFER] Robot backward direction:', backward);
    return backward;
  }

  /** Calculate safe transfer height accounting for carried wafer/board */
  _calculateSafeTransferHeightWithLoad() {
    let maxHeight = 0

    // Check Flip Chip Bonder height
    if (this.modObjs.flip_chip_bonder) {
      const bonderBox = new THREE.Box3().setFromObject(this.modObjs.flip_chip_bonder)
      if (!bonderBox.isEmpty()) {
        maxHeight = Math.max(maxHeight, bonderBox.max.y)
        if (this.debugCollisions) {
          this._addDebugBox(bonderBox, 0xff0000, 'Bonder')
        }
      }
    }

    // Check input rack height
    if (this.modObjs.foup) {
      const rackBox = new THREE.Box3().setFromObject(this.modObjs.foup)
      if (!rackBox.isEmpty()) {
        maxHeight = Math.max(maxHeight, rackBox.max.y)
        if (this.debugCollisions) {
          this._addDebugBox(rackBox, 0x00ff00, 'Input Rack')
        }
      }
    }

    // Check output rack height
    if (this.modObjs.final_wafer_rack) {
      const outputBox = new THREE.Box3().setFromObject(this.modObjs.final_wafer_rack)
      if (!outputBox.isEmpty()) {
        maxHeight = Math.max(maxHeight, outputBox.max.y)
        if (this.debugCollisions) {
          this._addDebugBox(outputBox, 0x0000ff, 'Output Rack')
        }
      }
    }

    // Add wafer/board height (approximate wafer thickness + safety)
    const waferHeight = 0.05 // 300mm wafer thickness

    // Add safety margin
    this.transferHeight = maxHeight + waferHeight + this.SAFETY_MARGIN
    console.log('[TRANSFER] Safe transfer height with load:', this.transferHeight.toFixed(2), 'm (max obstacle:', maxHeight.toFixed(2), 'm, wafer:', waferHeight.toFixed(2), 'm)')

    // Add debug helper for safe height plane
    if (this.debugCollisions) {
      this._addDebugHeightPlane(this.transferHeight)
    }

    return this.transferHeight
  }

  /** Add debug bounding box helper */
  _addDebugBox(box, color, name) {
    const helper = new THREE.Box3Helper(box, color)
    helper.name = `DebugBox_${name}`
    this.debugHelpers.add(helper)
    this.scene.add(this.debugHelpers)
  }

  /** Add debug plane showing safe transfer height */
  _addDebugHeightPlane(height) {
    const geometry = new THREE.PlaneGeometry(100, 100)
    const material = new THREE.MeshBasicMaterial({
      color: 0xffff00,
      side: THREE.DoubleSide,
      transparent: true,
      opacity: 0.3,
    })
    const plane = new THREE.Mesh(geometry, material)
    plane.rotation.x = -Math.PI / 2
    plane.position.y = height
    plane.name = 'DebugSafeHeightPlane'
    this.debugHelpers.add(plane)
    this.scene.add(this.debugHelpers)
  }

  /** Toggle collision debug mode */
  setDebugMode(enabled) {
    this.debugCollisions = enabled
    if (!enabled) {
      this.scene.remove(this.debugHelpers)
      this.debugHelpers.clear()
    } else {
      // Re-calculate safe height to show debug boxes
      this._calculateSafeTransferHeightWithLoad()
    }
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

  /** Center the wafer/plate on the pedestal using world-space bounding boxes */
  _centerPlateOnPedestal() {
    if (!this.modObjs.flip_chip_bonder || !this.wafer) {
      this.log('Cannot center plate: missing bonder or wafer')
      return
    }

    // Find pedestal node in the bonder model
    const bonderModel = this.modObjs.flip_chip_bonder
    const pedestal = bonderModel.getObjectByName('PEDESTAL') ||
                     bonderModel.getObjectByName('RING_VACUUM_PEDESTAL') ||
                     bonderModel.getObjectByName('SKING_PEDESTAL') ||
                     bonderModel.getObjectByName('SUBSTRATE_STAGE')

    if (!pedestal) {
      this.log('Pedestal node not found in bonder model')
      return
    }

    // Update world matrices for accurate bounding boxes
    pedestal.updateMatrixWorld(true)
    this.wafer.updateMatrixWorld(true)

    // Calculate world-space bounding boxes
    const pedestalBox = new THREE.Box3().setFromObject(pedestal)
    const waferBox = new THREE.Box3().setFromObject(this.wafer)

    if (pedestalBox.isEmpty() || waferBox.isEmpty()) {
      this.log('Could not calculate bounding boxes for centering')
      return
    }

    // Get centers
    const pedestalCenter = pedestalBox.getCenter(new THREE.Vector3())
    const waferCenter = waferBox.getCenter(new THREE.Vector3())

    // Calculate offset needed to center wafer on pedestal
    const offsetX = pedestalCenter.x - waferCenter.x
    const offsetZ = pedestalCenter.z - waferCenter.z

    // Calculate Y position so wafer sits on top of pedestal
    const pedestalTopY = pedestalBox.max.y
    const waferBottomY = waferBox.min.y
    const offsetY = pedestalTopY - waferBottomY

    // Apply correction to wafer world position
    this.wafer.position.x += offsetX
    this.wafer.position.z += offsetZ
    this.wafer.position.y = offsetY

    this.wafer.updateMatrixWorld(true)

    // Verify centering
    const newWaferBox = new THREE.Box3().setFromObject(this.wafer)
    const newWaferCenter = newWaferBox.getCenter(new THREE.Vector3())
    const tolerance = 0.005

    const centeredX = Math.abs(newWaferCenter.x - pedestalCenter.x) < tolerance
    const centeredZ = Math.abs(newWaferCenter.z - pedestalCenter.z) < tolerance

    console.log('[CENTERING] Pedestal center:', pedestalCenter)
    console.log('[CENTERING] Original wafer center:', waferCenter)
    console.log('[CENTERING] New wafer center:', newWaferCenter)
    console.log('[CENTERING] Applied offset:', { x: offsetX, y: offsetY, z: offsetZ })
    console.log('[CENTERING] Centered X:', centeredX, 'Centered Z:', centeredZ)

    this.log(`Plate centered on pedestal (X: ${centeredX}, Z: ${centeredZ})`)

    // Update destination to centered position
    this.destWorld.copy(newWaferCenter)
    this.destWorld.y = this.wafer.position.y
  }

  /** Begin a transfer from the rack anchor to the pedestal working plane. */
  start(sourceWorld, destWorld) {
    if (!this._ensureProcessLock()) {
      this.log('Transfer already in progress')
      return false
    }

    const robot = this._robot()
    if (!robot || !robot.group) {
      this._releaseProcessLock()
      return false
    }

    this.sourceWorld.copy(sourceWorld)
    this.destWorld.copy(destWorld)
    this.pickY = sourceWorld.y
    this.destY = destWorld.y

    // Calculate safe transfer height with load consideration
    this._calculateSafeTransferHeightWithLoad()

    // Reset rail to just in front of the source rack.
    const ud = robot.group.userData
    ud.railX = Math.max(this.sourceWorld.x + 2.0, -14)
    robot.group.position.x = ud.railX
    ud.armPhase = 'idle'

    this.state = 'R2FOUP'
    this.phaseT = 0
    this.p = 0
    this.bezierT = 0

    // Log world positions for debugging
    console.log('[TRANSFER] Source position:', sourceWorld)
    console.log('[TRANSFER] Destination position:', destWorld)
    console.log('[TRANSFER] Robot position:', robot.group.position)
    console.log('[TRANSFER] Robot rotation:', robot.group.rotation.y.toFixed(2), 'rad')

    return true
  }

  /** Build a fresh wafer mesh for the transfer (independent of photolithography). */
  createWafer() {
    const g = new THREE.Group()
    g.name = 'BondTransferWafer'

    const waferRadius = 1.22
    const waferThickness = 0.045
    const dieSize = 0.11

    const baseMat = new THREE.MeshPhysicalMaterial({
      color: 0xc8ccd0,
      metalness: 0.88,
      roughness: 0.18,
      clearcoat: 0.6,
      clearcoatRoughness: 0.12,
      emissive: 0x0c0f15,
      emissiveIntensity: 0.12,
    })
    const disc = new THREE.Mesh(new THREE.CylinderGeometry(waferRadius, waferRadius, waferThickness, 96), baseMat)
    disc.castShadow = true
    disc.receiveShadow = true
    g.add(disc)

    const edge = new THREE.Mesh(
      new THREE.TorusGeometry(waferRadius, 0.015, 10, 96),
      new THREE.MeshStandardMaterial({
        color: 0x9aa7bb,
        metalness: 0.98,
        roughness: 0.08,
        emissive: 0x20314f,
        emissiveIntensity: 0.25,
      })
    )
    edge.rotation.x = Math.PI / 2
    edge.position.y = waferThickness / 2 + 0.002
    g.add(edge)

    const dieLayer = new THREE.Group()
    for (let ix = -4; ix <= 4; ix += 1) {
      for (let iz = -4; iz <= 4; iz += 1) {
        if (ix * ix + iz * iz > 20) continue
        const die = new THREE.Mesh(
          new THREE.BoxGeometry(dieSize, 0.004, dieSize),
          new THREE.MeshStandardMaterial({
            color: 0xc5ced8,
            roughness: 0.1,
            metalness: 0.9,
            emissive: 0x2b3b52,
            emissiveIntensity: 0.18,
          })
        )
        die.position.set(ix * 0.16, waferThickness / 2 + 0.004, iz * 0.16)
        dieLayer.add(die)
      }
    }
    g.add(dieLayer)

    const notch = new THREE.Mesh(
      new THREE.BoxGeometry(0.06, 0.03, 0.04),
      new THREE.MeshStandardMaterial({
        color: 0x9ba8c5,
        roughness: 0.08,
        metalness: 0.9,
        emissive: 0x415c8d,
        emissiveIntensity: 0.35,
      })
    )
    notch.position.set(waferRadius, 0, 0)
    g.add(notch)

    g.userData.prLayer = disc
    this.scene.add(g)
    this.wafer = g
    this.wafer.visible = false
    return g
  }

  reset() {
    this.state = 'IDLE'
    this.phaseT = 0
    this.p = 0
    this.attached = false
    this.paused = false
    if (this.wafer) {
      this.scene.remove(this.wafer)
      this.wafer = null
    }
  }

  pause() {
    this.paused = true
  }

  resume() {
    this.paused = false
  }

  // ── helpers (mirror app/page.tsx conventions) ─────────────────────────────
  _sCurve(x) {
    x = Math.max(0, Math.min(1, x))
    return x * x * (3 - 2 * x)
  }

  _evalBezier(out, t) {
    const u = 1 - t
    const p0 = this.bezierStart
    const p1 = this.bezierCP1
    const p2 = this.bezierCP2
    const p3 = this.bezierEnd
    out.set(
      u * u * u * p0.x + 3 * u * u * t * p1.x + 3 * u * t * t * p2.x + t * t * t * p3.x,
      u * u * u * p0.y + 3 * u * u * t * p1.y + 3 * u * t * t * p2.y + t * t * t * p3.y,
      u * u * u * p0.z + 3 * u * u * t * p1.z + 3 * u * t * t * p2.z + t * t * t * p3.z,
    )
  }

  _fingerOffset() {
    const ud = this.robot?.group?.userData || {}
    const r = this.robot
    const t1 = ud.fingerTop1
    const d1 = ud.fingerDown1
    if (!t1 || !d1 || !r?.gripper) return new THREE.Vector3()
    const tmp = new THREE.Vector3()
    const mid = new THREE.Vector3()
    t1.getWorldPosition(tmp); mid.add(tmp)
    d1.getWorldPosition(tmp); mid.add(tmp)
    mid.multiplyScalar(0.5)
    const grip = new THREE.Vector3()
    r.gripper.getWorldPosition(grip)
    return mid.clone().sub(grip)
  }

  _targetForGripper(worldTarget) {
    const out = worldTarget.clone().sub(this._fingerOffset())
    return out
  }

  _moveRailToward(targetX, dt) {
    const ud = this.robot.group.userData
    const speed = 9.0
    const cur = ud.railX
    const clamped = THREE.MathUtils.clamp(targetX, -14, 22)
    const dx = clamped - cur
    const step = Math.sign(dx) * Math.min(Math.abs(dx), speed * dt)
    ud.railX = cur + step
    this.robot.group.position.x = ud.railX
    return Math.abs(clamped - ud.railX) < 0.4
  }

  // ── main update ───────────────────────────────────────────────────────────
  update(dt) {
    const robot = this._robot()
    if (!robot || !robot.runIK) return
    if (!this.isRunning()) return
    if (this.paused) return

    const r = robot
    const ud = r.group.userData
    this.phaseT += dt

    const step = (dur) => this._sCurve(Math.min(this.phaseT / dur, 1))

    switch (this.state) {
      // 1) Rail to the rack front
      case 'R2FOUP': {
        this._moveRailToward(this.sourceWorld.x + 3.0, dt)
        const idle = new THREE.Vector3(ud.railX + 1.5, 2.5, this.sourceWorld.z)
        r.runIK(this._targetForGripper(idle), { safetyMargin: 0.1 })
        if (this.phaseT > 0.6 && this._moveRailToward(this.sourceWorld.x + 3.0, dt * 2)) {
          this._beginApproach()
          this.onNarrate('Wafer pickup initiated.')
        }
        break
      }

      // 2) Approach rack
      case 'APPROACH': {
        const t = step(0.8)
        const a = new THREE.Vector3(
          this.sourceWorld.x + 1.2,
          this.sourceWorld.y + 0.5,
          this.sourceWorld.z,
        )
        const c = new THREE.Vector3(
          this.sourceWorld.x + 0.5,
          this.sourceWorld.y,
          this.sourceWorld.z,
        )
        const p = new THREE.Vector3().lerpVectors(a, c, t)
        r.runIK(this._targetForGripper(p), { safetyMargin: 0.08 })
        this._gripper(0, dt)
        if (t >= 1) { this.state = 'CONTACT'; this.phaseT = 0 }
        break
      }

      // 3) Contact the wafer
      case 'CONTACT': {
        const t = step(0.6)
        const c = new THREE.Vector3(
          this.sourceWorld.x + 0.5,
          this.sourceWorld.y,
          this.sourceWorld.z,
        )
        const p = c.clone()
        p.y = c.y - 0.05 * t
        r.runIK(this._targetForGripper(p), { safetyMargin: 0.05 })
        this._gripper(0.3, dt)
        if (t >= 1) { this.state = 'ATTACH'; this.phaseT = 0 }
        break
      }

      // 4) Attach wafer, brief vacuum dwell
      case 'ATTACH': {
        if (!this.wafer) this.createWafer()
        if (!this.attached) {
          this.wafer.visible = true
          this.wafer.attachTo = (robot) => {
            const fork = robot.fork ?? robot.gripper
            robot.group.updateWorldMatrix(true, true)
            fork.updateWorldMatrix(true, false)
            const wp = new THREE.Vector3()
            const wq = new THREE.Quaternion()
            fork.getWorldPosition(wp)
            fork.getWorldQuaternion(wq)
            const off = new THREE.Vector3(0, 0.04, 0)
            off.applyQuaternion(wq)
            wp.add(off)
            this.scene.attach(this.wafer)
            this.wafer.position.copy(wp)
            this.wafer.quaternion.copy(wq)
            fork.attach(this.wafer)
            this.attached = true
          }
          this.wafer.attachTo(r)
          this.log('PICK ↑ wafer rack')
          this.onNarrate('Wafer secured.')
        }
        this._gripper(1, dt)
        if (this.phaseT > 0.4) {
          this._setupBezier()
          this.state = 'LIFT'
          this.phaseT = 0
        }
        break
      }

      // 5) Lift clear of the rack
      case 'LIFT': {
        const t = step(0.6)
        const from = new THREE.Vector3(
          this.sourceWorld.x + 0.5,
          this.sourceWorld.y,
          this.sourceWorld.z,
        )
        const to = from.clone()
        to.y = this.transferHeight
        const p = new THREE.Vector3().lerpVectors(from, to, t)
        r.runIK(this._targetForGripper(p), { isTravel: true, safetyMargin: 0.1 })
        this._gripper(1, dt)
        if (t >= 1) {
          // Move BACKWARD from rack instead of forward
          this._beginBackwardRetract()
          this.state = 'BACKWARD_RETRACT'
          this.phaseT = 0
          this.onNarrate('Moving away from rack.')
        }
        break
      }

      // 5.5) Move backward/retract from rack
      case 'BACKWARD_RETRACT': {
        const t = step(0.6)
        const robot = this._robot()
        const backward = this._calculateBackwardDirection(robot)
        const retractDistance = 2.0

        const currentPos = new THREE.Vector3()
        robot.group.getWorldPosition(currentPos)

        const from = currentPos.clone()
        const to = from.clone().add(backward.multiplyScalar(retractDistance))

        // Keep at safe height
        from.y = this.transferHeight
        to.y = this.transferHeight

        const p = new THREE.Vector3().lerpVectors(from, to, t)
        r.runIK(this._targetForGripper(p), { isTravel: true, safetyMargin: 0.1 })
        this._gripper(1, dt)

        if (t >= 1) {
          this._beginLift()
          this.state = 'TRAVEL'
          this.phaseT = 0
          this.bezierT = 0
          this.onNarrate('Transferring wafer to placement stage.')
        }
        break
      }

      // 6) Rail + bezier arc travel to the bonder pedestal
      case 'TRAVEL': {
        const railDone = this._moveRailToward(this.destWorld.x - 1.0, dt)
        this.bezierT = Math.min(this.bezierT + dt, 1)
        const wp = new THREE.Vector3()
        this._evalBezier(wp, this.bezierT)
        r.runIK(this._targetForGripper(wp), { isTravel: true, safetyMargin: 0.1 })
        this._gripper(1, dt)
        if (railDone && this.bezierT >= 1) {
          this.state = 'LOWER'
          this.phaseT = 0
        }
        break
      }

      // 7) Lower onto the pedestal working plane
      case 'LOWER': {
        const t = step(0.7)
        const above = new THREE.Vector3(this.destWorld.x, this.destWorld.y + 0.6, this.destWorld.z)
        const at = this.destWorld.clone()
        const p = new THREE.Vector3().lerpVectors(above, at, t)
        r.runIK(this._targetForGripper(p), { placeHeightOffset: 0.02, safetyMargin: 0.05 })
        this._gripper(1, dt)
        if (t >= 1) { this.state = 'PLACE'; this.phaseT = 0 }
        break
      }

      // 8) Detach onto pedestal
      case 'PLACE': {
        this._gripper(0, dt)
        if (this.wafer && this.attached) {
          // Center the wafer/plate on the pedestal before detaching
          this._centerPlateOnPedestal()

          this.wafer.detachAt = (worldPos) => {
            this.scene.attach(this.wafer)
            this.wafer.scale.setScalar(1)
            this.wafer.position.copy(worldPos || this.destWorld)
            this.wafer.quaternion.identity()
            this.wafer.visible = true
            this.attached = false
          }
          this.wafer.detachAt(this.destWorld)
          this.log('PLACE @ bonder pedestal (centered)')
          this.onNarrate('Wafer placement complete.')
        }
        if (this.phaseT > 0.4) { this.state = 'RETRACT'; this.phaseT = 0 }
        break
      }

      // 9) Retract arm + return rail home
      case 'RETRACT': {
        const t = step(0.7)
        const robot = this._robot()
        const backward = this._calculateBackwardDirection(robot)
        const retractDistance = 1.5

        const currentPos = new THREE.Vector3()
        robot.group.getWorldPosition(currentPos)

        const from = currentPos.clone()
        const to = from.clone().add(backward.multiplyScalar(retractDistance))

        // Keep at safe height
        from.y = this.transferHeight
        to.y = this.transferHeight

        const p = new THREE.Vector3().lerpVectors(from, to, t)
        r.runIK(this._targetForGripper(p), { isTravel: true, safetyMargin: 0.1 })
        this._gripper(0, dt)

        if (t >= 1) {
          this.state = 'HOME'
          this.phaseT = 0
        }
        break
      }

      // 10) Drive rail back toward rack / home
      case 'HOME': {
        const homeX = this.sourceWorld.x + 3.0
        const done = this._moveRailToward(homeX, dt)
        const idle = new THREE.Vector3(ud.railX + 1.5, 2.5, this.sourceWorld.z)
        r.runIK(this._targetForGripper(idle), { safetyMargin: 0.1 })
        this._gripper(0, dt)
        if (done && this.phaseT > 1.0) {
          this.state = 'DONE'
          this.phaseT = 0
          this._releaseProcessLock()
          this.log('Wafer transfer complete')
          this.onPlacementComplete()
        }
        break
      }

      default:
        break
    }
  }

  // ── internal timing helpers ───────────────────────────────────────────────
  _beginApproach() {
    this.state = 'APPROACH'
    this.phaseT = 0
  }

  _beginBackwardRetract() {
    // Start backward retract movement from current position
    this.state = 'BACKWARD_RETRACT'
    this.phaseT = 0
    this.log('Starting backward retract from rack')
  }

  _beginLift() {
    // Start of bezier = current lifted position above source with clearance
    // Use waypoint approach: lift vertically first, then move horizontally at safe height
    this.bezierStart.set(this.sourceWorld.x + 0.5, this.transferHeight, this.sourceWorld.z)
    this.bezierEnd.set(this.destWorld.x, this.transferHeight, this.destWorld.z)
    // Control points ensure robot clears the bonder geometry
    this.bezierCP1.set(this.sourceWorld.x + 3.0, this.transferHeight, this.sourceWorld.z)
    this.bezierCP2.set(this.destWorld.x - 2.0, this.transferHeight, this.destWorld.z)
  }

  _setupBezier() {
    // Setup waypoint-based transfer: lift → move horizontal → lower
    this.bezierStart.set(this.sourceWorld.x + 0.5, this.sourceWorld.y, this.sourceWorld.z)
    this.bezierEnd.set(this.destWorld.x, this.transferHeight, this.destWorld.z)
    // Control points for smooth arc above obstacles
    this.bezierCP1.set(this.sourceWorld.x + 3.0, this.transferHeight, this.sourceWorld.z)
    this.bezierCP2.set(this.destWorld.x - 2.0, this.transferHeight, this.destWorld.z)
  }

  /** Get safe waypoints for collision-free transfer */
  _getTransferWaypoints() {
    const waypoints = []

    // Waypoint 1: Pick position (at wafer)
    waypoints.push(new THREE.Vector3(
      this.sourceWorld.x + 0.5,
      this.sourceWorld.y,
      this.sourceWorld.z
    ))

    // Waypoint 2: Lift vertically above rack
    waypoints.push(new THREE.Vector3(
      this.sourceWorld.x + 0.5,
      this.transferHeight,
      this.sourceWorld.z
    ))

    // Waypoint 3: Clear of rack, moving toward bonder
    waypoints.push(new THREE.Vector3(
      this.sourceWorld.x + 3.0,
      this.transferHeight,
      this.sourceWorld.z
    ))

    // Waypoint 4: Above bonder, aligned for approach
    waypoints.push(new THREE.Vector3(
      this.destWorld.x - 2.0,
      this.transferHeight,
      this.destWorld.z
    ))

    // Waypoint 5: Final approach above placement
    waypoints.push(new THREE.Vector3(
      this.destWorld.x,
      this.transferHeight,
      this.destWorld.z
    ))

    // Waypoint 6: Placement position
    waypoints.push(new THREE.Vector3(
      this.destWorld.x,
      this.destWorld.y,
      this.destWorld.z
    ))

    return waypoints
  }

  _gripper(target, dt) {
    const robot = this._robot()
    if (!robot || !robot.group) return
    const ud = robot.group.userData
    const cur = ud.gripperState ?? 0
    ud.gripperState = THREE.MathUtils.lerp(cur, target, 0.18)
    ud.vacuumEngaged = ud.gripperState > 0.7
    if (robot.statusPL) {
      robot.statusPL.intensity = target > 0.5 ? 3.0 : 1.2
    }
  }
}
