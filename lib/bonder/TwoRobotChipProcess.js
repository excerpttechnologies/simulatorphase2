'use client'

import * as THREE from 'three'
import {
  TweenGroup,
  easeInOut,
  attachObjectPreserveWorldTransform,
  detachObjectPreserveWorldTransform,
} from './BonderUtils'
import { BONDER_CONFIG } from './BonderConfig'
import { CHIP_STATES } from './ChipController'

/**
 * TwoRobotChipProcess — drives BOTH real mechanisms of the flip chip bonder:
 *
 *   ROBOT 1  COLRIGHT  gantry   : pick the die, 180° flip, deliver to handoff
 *   ROBOT 2  SKING     tower    : receiver head, flux dip, place on the board
 *
 * The robot movement is NOT re-implemented here — every joint is driven through
 * the orchestrator's existing tween engine (_moveNodeAxis / _rotateNodeZ /
 * _sleep), and chips are re-parented with the existing preserve-world helpers.
 *
 * When constructed with a BonderController it reuses the shared TweenGroup, so
 * the render loop's existing `update(dt)` already advances every motion and the
 * global speed / pause controls work unchanged.
 */
export class TwoRobotChipProcess {
  constructor(sceneOrBonder) {
    const candidate = sceneOrBonder || null
    const isBonder =
      candidate &&
      candidate.scene &&
      candidate.robots &&
      candidate.chipControllers &&
      typeof candidate._moveNodeAxis === 'function'

    this.bonder = isBonder ? candidate : null
    this.scene = this.bonder ? this.bonder.scene : candidate

    this.tweens = new TweenGroup()

    // Robot 1 — COLRIGHT (pick + flip)
    this.robot1 = null // COLRIGHT_CARRIAGE            (X travel)
    this.robot1Vertical = null // COLRIGHT_VERTICAL_AXIS / COLRIGHT_SERVO_FLANGE (Y lift)
    this.robot1Pickup = null // COLRIGHT_PICKUP_POINT   (chip attaches here)
    this.robot1FlipAxis = null // COLRIGHT_FLIP_AXIS      (180° flip)

    // Robot 2 — SKING (handoff + flux + board placement)
    this.robot2 = null // SKING_MOUNT_BRACKET_VAXIS   (X/Y positioning)
    this.robot2Vertical = null // SKING_SERVO_FLANGE     (Y lift)
    this.robot2Tip = null // SKING_ARM_TIP_ANCHOR       (chip attaches here)
    this.robot2Rotary = null // SKING_ROTARY_JOINT_BASE  (optional orientation)
    this.robot2Assembly = null // top-level parent that translates the SKING stub
    this.robot2AssemblyHome = null

    // Process objects
    this.chips = []
    this.board = null
    this.boardTarget = null

    this.fluxDipTarget = null

    this.currentChipIndex = 0
    this.state = 'IDLE'

    this.attachedChip = null
    this.chipOwner = null

    this.originalTransforms = new Map()
    this.robot1Reach = null
    this.robot2Reach = null
    this._running = false
  }

  // ---------------------------------------------------------------- discovery
  _findNode(exactName, aliases = []) {
    const scene = this.scene
    if (!scene) return null

    if (scene.getObjectByName(exactName)) return scene.getObjectByName(exactName)

    const normalize = (value) => String(value || '').toLowerCase().replace(/[^a-z0-9]/g, '')
    const target = normalize(exactName)
    let found = null
    scene.traverse((object) => {
      if (!found && object.isObject3D && object.name && normalize(object.name) === target) {
        found = object
      }
    })
    if (found) return found

    const terms = (aliases || []).map(normalize).filter(Boolean)
    if (terms.length) {
      scene.traverse((object) => {
        if (!found && object.isObject3D && object.name) {
          const name = normalize(object.name)
          if (terms.every((term) => name.includes(term))) found = object
        }
      })
    }
    if (found) return found

    if (this.bonder && typeof this.bonder._findNode === 'function') {
      return this.bonder._findNode(exactName, aliases)
    }
    return null
  }

  _collectChips() {
    if (this.bonder && this.bonder.chipControllers && this.bonder.chipControllers.length) {
      const nodes = this.bonder.chipControllers.map((controller) => controller.chip).filter(Boolean)
      if (nodes.length) return nodes
    }
    const found = []
    this.scene.traverse((object) => {
      if (/^CHIP_\d+$/.test(object.name)) found.push(object)
    })
    return found
  }

  _localPosition(obj, out = new THREE.Vector3()) {
    if (!obj) return out
    obj.updateWorldMatrix(true, false)
    obj.getWorldPosition(out)
    if (this.bonder && this.bonder.model) {
      this.bonder.model.updateMatrixWorld(true)
      this.bonder.model.worldToLocal(out)
    }
    return out
  }

  _updateWorld() {
    if (this.bonder && this.bonder.model) this.bonder.model.updateMatrixWorld(true)
    else if (this.scene) this.scene.updateMatrixWorld(true)
  }

  _ancestorOf(node, descendant) {
    let current = descendant
    while (current && current.parent) {
      current = current.parent
      if (current === node) return true
    }
    return false
  }

  /**
   * Choose which node is the real vertical-lift axis for a given tip. In the
   * full GLB the tool hangs off COLRIGHT_VERTICAL_AXIS; in the simplified GLB
   * it hangs off COLRIGHT_SERVO_FLANGE. Rather than guess, perturb each
   * candidate and keep the one that actually translates the tip.
   */
  _resolveLiftNode(candidates, tip) {
    const usable = (candidates || []).filter(Boolean)
    const restTipY = this._localPosition(tip).y
    for (const cand of usable) {
      const restY = cand.position.y
      cand.position.y = restY + 1
      this._updateWorld()
      const shifted = this._localPosition(tip).y
      cand.position.y = restY
      this._updateWorld()
      if (Math.abs(shifted - restTipY) > 0.02) return cand
    }
    for (const cand of usable) if (this._ancestorOf(cand, tip)) return cand
    return usable[0] || null
  }

  findObjects() {
    this.robot1 = this.bonder?.robots?.colright?.carriage || this._findNode('COLRIGHT_CARRIAGE', ['colright', 'carriage'])
    this.robot1Pickup =
      this._findNode('COLRIGHT_PICKUP_POINT', ['colright', 'pickup', 'point']) ||
      this._findNode('COLRIGHT_ARM_TIP_ANCHOR', ['colright', 'tip', 'anchor']) ||
      (this.bonder && this.bonder.robots && this.bonder.robots.colright
        ? this.bonder.robots.colright.anchor
        : null)
    this.robot1Vertical = this.bonder?.robots?.colright?.vertical || this._resolveLiftNode(
      [
        this._findNode('COLRIGHT_VERTICAL_AXIS', ['colright', 'vertical']),
        this._findNode('COLRIGHT_SERVO_FLANGE', ['colright', 'servo', 'flange']),
      ],
      this.robot1Pickup
    )
    this.robot1FlipAxis = this.bonder?.robots?.colright?.flipAxis ||
      this._findNode('COLRIGHT_FLIP_AXIS', ['colright', 'flip', 'axis']) ||
      this._findNode('COLRIGHT_ARM_BEARING_RING', ['colright', 'bearing', 'ring']) ||
      this.robot1Pickup

    this.robot2 = this.bonder?.robots?.sking?.carriage || this._findNode('SKING_CARRIAGE', ['sking', 'carriage']) || this._findNode('SKING_MOUNT_BRACKET_VAXIS', ['sking', 'mount', 'bracket', 'vaxis'])
    this.robot2Vertical = this.bonder?.robots?.sking?.flange || this._findNode('SKING_SERVO_FLANGE', ['sking', 'servo', 'flange'])
    this.robot2Tip =
      this._findNode('SKING_ARM_TIP_ANCHOR', ['sking', 'tip', 'anchor']) ||
      this._findNode('SKING_PICKUP_NOZZLE', ['sking', 'pickup', 'nozzle'])
    this.robot2Rotary = this._findNode('SKING_ROTARY_JOINT_BASE', ['sking', 'rotary', 'joint'])

    this.board = this._findNode('BondBase', ['bond', 'base'])
    this.boardTarget = this._findNode('BONDBASE_TARGET', ['bondbase', 'target'])

    this.waypoints = {
      sourceApproach: this._findNode('Source_Approach', ['source', 'approach']),
      sourcePick: this._findNode('Source_Pick', ['source', 'pick']),
      sourceRetract: this._findNode('Source_Retract', ['source', 'retract']),
      destinationApproach: this._findNode('Destination_Approach', ['destination', 'approach']),
      destinationDrop: this._findNode('Destination_Drop', ['destination', 'drop']),
      destinationRetract: this._findNode('Destination_Retract', ['destination', 'retract']),
      robotHome: this._findNode('Robot_Home', ['robot', 'home']),
    }

    // The current SKING asset is a four-empty stub with no linear axes. Its
    // highest parent is the only safe translation carrier for the whole tip.
    if (this.robot2Tip) {
      let assembly = this.robot2Tip
      while (assembly.parent && assembly.parent !== this.scene && assembly.parent !== this.bonder?.model) {
        assembly = assembly.parent
      }
      this.robot2Assembly = assembly
      this.robot2AssemblyHome = assembly.position.clone()
    }

    this.chips = this._collectChips()
    this.chips.sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }))
    this.chips = this.chips.slice(0, 6)

    this._computeReach()
    this.saveOriginalTransforms()

    console.log('[TwoRobot] Robot 1:', this.robot1 && this.robot1.name)
    console.log('[TwoRobot] Robot 1 lift:', this.robot1Vertical && this.robot1Vertical.name)
    console.log('[TwoRobot] Robot 1 pickup:', this.robot1Pickup && this.robot1Pickup.name)
    console.log('[TwoRobot] Robot 1 flip axis:', this.robot1FlipAxis && this.robot1FlipAxis.name)
    console.log('[TwoRobot] Robot 2:', this.robot2 && this.robot2.name)
    console.log('[TwoRobot] Robot 2 tip:', this.robot2Tip && this.robot2Tip.name)
    console.log('[TwoRobot] Board:', this.board && this.board.name)
    console.log('[TwoRobot] Chips:', this.chips.map((c) => c.name).join(', '))
  }

  /**
   * Calibrate a single moving axis empirically. Perturbing the axis position
   * by +1 and measuring the tip tells us both the direction and the gain of
   * the transmission, which may include rotations / non-unit scales in the
   * tool chain:
   *
   *   tipModelLocal = tipRest + dir * (axisPos - rest) * gain
   *   => axisPos = rest + ( (target - tipRest) . dir ) / gain
   */
  _calibrateAxis(node, axis, tip) {
    if (!node || !tip) return null
    const rest = node.position[axis]
    this._updateWorld()
    const tipRest = this._localPosition(tip)
    node.position[axis] = rest + 1
    this._updateWorld()
    const tipMoved = this._localPosition(tip)
    node.position[axis] = rest
    this._updateWorld()
    const delta = new THREE.Vector3().subVectors(tipMoved, tipRest)
    const gain = delta.length()
    const dir = gain > 1e-6 ? delta.clone().divideScalar(gain) : new THREE.Vector3()
    return { node, axis, rest, tipRest, dir, gain }
  }

  /** Axis position whose tip lands exactly on the desired model-local point. */
  _axisFor(cal, targetLocal) {
    if (!cal || cal.gain <= 1e-6) return cal ? cal.rest : 0
    const along =
      (targetLocal.x - cal.tipRest.x) * cal.dir.x +
      (targetLocal.y - cal.tipRest.y) * cal.dir.y +
      (targetLocal.z - cal.tipRest.z) * cal.dir.z
    return cal.rest + along / cal.gain
  }

  _computeReach() {
    // Safety check: ensure robots are initialized
    if (!this.robot1 || !this.robot1Pickup) {
      console.warn('[TwoRobot] Robot 1 not fully initialized for calibration')
      this.robot1Reach = null
    } else {
      this.robot1Reach = {
        X: this._calibrateAxis(this.robot1, 'x', this.robot1Pickup),
        Y: this._calibrateAxis(this.robot1Vertical, 'y', this.robot1Pickup),
        homeFlipZ: this.robot1FlipAxis ? this.robot1FlipAxis.rotation.z : 0,
      }
    }
    
    if (!this.robot2 || !this.robot2Tip) {
      console.warn('[TwoRobot] Robot 2 not fully initialized for calibration')
      this.robot2Reach = null
    } else {
      this.robot2Reach = {
        X: this._calibrateAxis(this.robot2, 'x', this.robot2Tip),
        Y: this._calibrateAxis(this.robot2Vertical, 'y', this.robot2Tip),
        homeRotaryZ: this.robot2Rotary ? this.robot2Rotary.rotation.z : 0,
      }
    }
  }

  saveOriginalTransforms() {
    for (const chip of this.chips) {
      this.originalTransforms.set(chip.name, {
        parent: chip.parent,
        position: chip.position.clone(),
        quaternion: chip.quaternion.clone(),
        scale: chip.scale.clone(),
      })
    }
  }

  getWorldPosition(object) {
    return object.getWorldPosition(new THREE.Vector3())
  }

  distance(a, b) {
    return a.distanceTo(b)
  }

  // ------------------------------------------------------------ chip handling
  attachPreserveWorld(child, parent) {
    attachObjectPreserveWorldTransform(child, parent)
  }

  detachPreserveWorld(child, newParent) {
    detachObjectPreserveWorldTransform(child, newParent)
  }

  getChip(index) {
    return this.chips[index] || null
  }

  getChipTarget(index) {
    if (this.bonder && typeof this.bonder._getChipTargets === 'function') {
      const targets = this.bonder._getChipTargets()
      if (targets && targets[index]) return targets[index].clone()
    }

    const center = this.boardTarget || this.board
    const centerWorld = this._localPosition(center)

    const offsets = [
      [-0.15, -0.08],
      [0.0, -0.08],
      [0.15, -0.08],

      [-0.15, 0.08],
      [0.0, 0.08],
      [0.15, 0.08],
    ]

    const [x, z] = offsets[index] || [0, 0]
    return new THREE.Vector3(
      centerWorld.x + x,
      centerWorld.y,
      centerWorld.z + z
    )
  }

  _chipLocalPos(chip) {
    return this._localPosition(chip)
  }

  attachToRobot1(chip) {
    this.attachPreserveWorld(chip, this.robot1Pickup || this.robot1FlipAxis)
    chip.userData.owner = 'ROBOT1'
    this.attachedChip = chip
    this.chipOwner = 'ROBOT1'
    this._syncChipState(chip, CHIP_STATES.PICKED)
  }

  transferToRobot2(chip) {
    this.detachPreserveWorld(chip, this.robot2Tip || this.robot2)
    chip.userData.owner = 'ROBOT2'
    this.attachedChip = chip
    this.chipOwner = 'ROBOT2'
  }

  releaseToBoard(chip, target) {
    const holder = this.board || (this.bonder ? this.bonder.model : this.scene)
    this.detachPreserveWorld(chip, holder)

    let worldTarget = target.clone()
    if (this.bonder && this.bonder.model) {
      this.bonder.model.updateMatrixWorld(true)
      worldTarget.applyMatrix4(this.bonder.model.matrixWorld)
    }
    holder.updateMatrixWorld(true)
    chip.position.copy(holder.worldToLocal(worldTarget))

    chip.userData.owner = 'BOARD'
    this.attachedChip = null
    this.chipOwner = null
    this._syncChipState(chip, CHIP_STATES.BONDED)
  }

  _syncChipState(chip, nextState) {
    if (!this.bonder || !this.bonder.chipControllers) return
    const controller = this.bonder.chipControllers.find((c) => c.chip === chip)
    if (controller) controller.setState(nextState)
  }

  // ---------------------------------------------------------------- movement
  _moveAxis(node, axis, to, duration) {
    if (!node) return Promise.resolve()
    if (this.bonder) return this.bonder._moveNodeAxis(node, axis, to, duration)
    return this._localTween(node, axis, to, duration)
  }

  _rotateZ(node, to, duration) {
    if (!node) return Promise.resolve()
    if (this.bonder) return this.bonder._rotateNodeZ(node, to, duration)
    return this._localRotTween(node, to, duration)
  }

  _sleep(seconds) {
    if (this.bonder) return this.bonder._sleep(seconds)
    return new Promise((resolve) => setTimeout(resolve, seconds * 1000))
  }

  async wait(ms) {
    return this._sleep(ms / 1000)
  }

  _localTween(node, axis, to, duration) {
    const from = node.position[axis]
    return new Promise((resolve) => {
      this.tweens.add({
        elapsed: 0,
        duration: Math.max(0.02, duration),
        finished: false,
        update(dt) {
          if (this.finished) return true
          this.elapsed += dt
          const p = Math.min(this.elapsed / this.duration, 1)
          const e = easeInOut(p)
          node.position[axis] = from + (to - from) * e
          if (p >= 1) {
            node.position[axis] = to
            this.finished = true
            resolve()
            return true
          }
          return false
        },
      })
    })
  }

  _localRotTween(node, to, duration) {
    const from = node.rotation.z
    return new Promise((resolve) => {
      this.tweens.add({
        elapsed: 0,
        duration: Math.max(0.02, duration),
        finished: false,
        update(dt) {
          if (this.finished) return true
          this.elapsed += dt
          const p = Math.min(this.elapsed / this.duration, 1)
          const e = easeInOut(p)
          node.rotation.z = from + (to - from) * e
          if (p >= 1) {
            node.rotation.z = to
            this.finished = true
            resolve()
            return true
          }
          return false
        },
      })
    })
  }

  /** Tick the standalone tween group. Ignored when sharing the bonder's group. */
  update(dt) {
    if (!this.bonder) this.tweens.update(dt)
  }

  _setRobot1Tip(targetWorld) {
    if (!this.robot1Reach || !this.robot1Reach.X || !this.robot1Reach.Y) {
      console.warn('[TwoRobot] Robot 1 not calibrated, cannot move')
      return Promise.resolve()
    }
    return this._moveAxis(this.robot1, 'x', this._axisFor(this.robot1Reach.X, targetWorld), 0.05).then(() =>
      this._moveAxis(this.robot1Vertical, 'y', this._axisFor(this.robot1Reach.Y, targetWorld), 0.05)
    )
  }

  _setRobot2Tip(targetWorld) {
    if (!this.robot2Reach || !this.robot2Reach.X || !this.robot2Reach.Y) {
      console.warn('[TwoRobot] Robot 2 not calibrated, cannot move')
      return Promise.resolve()
    }
    return this._moveAxis(this.robot2, 'x', this._axisFor(this.robot2Reach.X, targetWorld), 0.05).then(() =>
      this._moveAxis(this.robot2, 'y', this._axisFor(this.robot2Reach.Y, targetWorld), 0.05)
    )
  }

  _waypointPosition(name, fallback) {
    const waypoint = this.waypoints && this.waypoints[name]
    return waypoint ? this._localPosition(waypoint) : fallback.clone()
  }

  async _moveSkingTip(target, duration, swivel = null) {
    if (!this.robot2Assembly || !this.robot2Tip) return

    if (swivel !== null && this.robot2Rotary) {
      await this._rotateZ(this.robot2Rotary, swivel, duration * 0.35)
    }

    this._updateWorld()
    const current = this._localPosition(this.robot2Tip)
    const destination = this.robot2Assembly.position.clone().add(target).sub(current)
    await Promise.all(['x', 'y', 'z'].map((axis) =>
      this._moveAxis(this.robot2Assembly, axis, destination[axis], duration)
    ))
  }

  _handoffPosition() {
    const h = BONDER_CONFIG.positions.handoff
    return new THREE.Vector3(h.x, h.y, h.z)
  }

  // ------------------------------------------------------------------- flip
  async flipChip180(chip) {
    const axis = this.robot1FlipAxis
    if (!axis) return
    await this._rotateZ(axis, axis.rotation.z + BONDER_CONFIG.flip.rotation, BONDER_CONFIG.flip.duration)
    this._syncChipState(chip, CHIP_STATES.FLIPPED)
  }

  // ------------------------------------------------------------ robot 1 steps
  async moveRobot1ToChip(chip) {
    const target = this._waypointPosition('sourcePick', this._chipLocalPos(chip))
    const approachY = target.y + BONDER_CONFIG.pickup.approachHeight
    const approach = target.clone()
    approach.y = approachY

    const sourceApproach = this._waypointPosition('sourceApproach', approach)
    await this._moveAxis(this.robot1, 'x', this._axisFor(this.robot1Reach.X, sourceApproach), BONDER_CONFIG.movement.travelDuration)
    await this._moveAxis(this.robot1Vertical, 'y', this._axisFor(this.robot1Reach.Y, sourceApproach), BONDER_CONFIG.movement.lowerDuration)
    await this._moveAxis(this.robot1Vertical, 'y', this._axisFor(this.robot1Reach.Y, target), BONDER_CONFIG.movement.lowerDuration)
  }

  async moveRobot1Lift() {
    const chip = this.attachedChip
    const target = this._chipLocalPos(chip)
    const approach = target.clone()
    approach.y = target.y + BONDER_CONFIG.pickup.approachHeight
    const sourceRetract = this._waypointPosition('sourceRetract', approach)
    await this._moveAxis(this.robot1Vertical, 'y', this._axisFor(this.robot1Reach.Y, sourceRetract), BONDER_CONFIG.movement.liftDuration)
  }

  async moveRobot1ToFlip() {
    const target = this._handoffPosition()
    await this._moveAxis(this.robot1, 'x', this._axisFor(this.robot1Reach.X, target), BONDER_CONFIG.movement.transferDuration)
  }

  async moveRobot1ToHandoff() {
    const target = this._handoffPosition()
    await this._moveAxis(this.robot1, 'x', this._axisFor(this.robot1Reach.X, target), BONDER_CONFIG.movement.transferDuration)
    await this._moveAxis(this.robot1Vertical, 'y', this._axisFor(this.robot1Reach.Y, target), BONDER_CONFIG.movement.lowerDuration)
  }

  // ------------------------------------------------------------ robot 2 steps
  async moveRobot2ToHandoff() {
    const target = this._handoffPosition()
    if (this.robot2Assembly) return this._moveSkingTip(target, BONDER_CONFIG.handoff.duration)
    await this._moveAxis(this.robot2, 'x', this._axisFor(this.robot2Reach.X, target), BONDER_CONFIG.movement.transferDuration)
    await this._moveAxis(this.robot2, 'y', this._axisFor(this.robot2Reach.Y, target), BONDER_CONFIG.movement.lowerDuration)
  }

  async moveRobot2Lift() {
    const chip = this.attachedChip
    const chipPos = this._chipLocalPos(chip)
    const approach = chipPos.clone()
    approach.y += BONDER_CONFIG.pickup.approachHeight
    if (this.robot2Assembly) return this._moveSkingTip(approach, BONDER_CONFIG.movement.liftDuration)
    await this._moveAxis(this.robot2Vertical, 'y', this._axisFor(this.robot2Reach.Y, approach), BONDER_CONFIG.movement.liftDuration)
  }

  async moveRobot2ToFlux() {
    const approach = this.getFluxApproachPosition()
    if (this.robot2Assembly) return this._moveSkingTip(approach, BONDER_CONFIG.movement.travelDuration)
    await this._moveAxis(this.robot2, 'x', this._axisFor(this.robot2Reach.X, approach), BONDER_CONFIG.movement.travelDuration)
    await this._moveAxis(this.robot2Vertical, 'y', this._axisFor(this.robot2Reach.Y, approach), BONDER_CONFIG.movement.travelDuration)
  }

  async moveRobot2ToBoard(index) {
    const target = this.getChipTarget(index)
    const approach = target.clone()
    approach.y = target.y + BONDER_CONFIG.flux.approachHeight
    const destinationApproach = this._waypointPosition('destinationApproach', approach)
    if (this.robot2Assembly) return this._moveSkingTip(destinationApproach, BONDER_CONFIG.movement.travelDuration)
    await this._moveAxis(this.robot2, 'x', this._axisFor(this.robot2Reach.X, target), BONDER_CONFIG.movement.travelDuration)
    await this._moveAxis(this.robot2Vertical, 'y', this._axisFor(this.robot2Reach.Y, approach), BONDER_CONFIG.movement.travelDuration)
  }

  async lowerRobot2ToTarget(target) {
    const contact = target.clone()
    contact.y = target.y - 0.02
    const destinationDrop = this._waypointPosition('destinationDrop', contact)
    if (this.robot2Assembly) return this._moveSkingTip(destinationDrop, BONDER_CONFIG.bonding.descentDuration)
    await this._moveAxis(this.robot2Vertical, 'y', this._axisFor(this.robot2Reach.Y, contact), BONDER_CONFIG.movement.lowerDuration)
  }

  async retractRobot2() {
    const stuck = this._lastTarget || (this.boardTarget ? this._localPosition(this.boardTarget) : null)
    const baseY = stuck ? stuck.y : BONDER_CONFIG.positions.bondTarget.y
    const target = this._lastTarget ? this._lastTarget.clone() : new THREE.Vector3(BONDER_CONFIG.positions.bondTarget.x, baseY + BONDER_CONFIG.bonding.approachHeight, BONDER_CONFIG.positions.bondTarget.z)
    target.y = baseY + BONDER_CONFIG.bonding.approachHeight
    const destinationRetract = this._waypointPosition('destinationRetract', target)
    if (this.robot2Assembly) return this._moveSkingTip(destinationRetract, BONDER_CONFIG.movement.liftDuration)
    await this._moveAxis(this.robot2Vertical, 'y', this._axisFor(this.robot2Reach.Y, target), BONDER_CONFIG.movement.liftDuration)
  }

  async moveRobot2ToPosition(position) {
    if (this.robot2Assembly) return this._moveSkingTip(position, BONDER_CONFIG.movement.travelDuration)
    await this._moveAxis(this.robot2, 'x', this._axisFor(this.robot2Reach.X, position), BONDER_CONFIG.movement.travelDuration)
    await this._moveAxis(this.robot2Vertical, 'y', this._axisFor(this.robot2Reach.Y, position), BONDER_CONFIG.movement.travelDuration)
  }

  // ------------------------------------------------------------ flux station
  getFluxApproachPosition() {
    const stationPoint = this.bonder?.fluxStationVisual?.getPoint('FLUX_APPROACH_POINT')
    if (stationPoint) return this._localPosition(stationPoint)
    const f = BONDER_CONFIG.positions.fluxTarget
    return new THREE.Vector3(f.x, f.y + BONDER_CONFIG.flux.approachHeight, f.z)
  }

  getFluxDipPosition() {
    const stationPoint = this.bonder?.fluxStationVisual?.getPoint('FLUX_DIP_POINT')
    if (stationPoint) return this._localPosition(stationPoint)
    const f = BONDER_CONFIG.positions.fluxTarget
    return new THREE.Vector3(f.x, f.y - BONDER_CONFIG.flux.dipDepth, f.z)
  }

  getFluxRetractPosition() {
    const stationPoint = this.bonder?.fluxStationVisual?.getPoint('FLUX_RETRACT_POINT')
    if (stationPoint) return this._localPosition(stationPoint)
    return this.getFluxApproachPosition()
  }

  getReceivingPlatePosition() {
    const stationPoint = this.bonder?.fluxStationVisual?.getPoint('RECEIVING_PLATE_POINT')
    if (stationPoint) return this._localPosition(stationPoint)
    return this.getFluxApproachPosition()
  }

  async dipFlux(chip) {
    const approach = this.getFluxApproachPosition()
    const dip = this.getFluxDipPosition()
    const retract = this.getFluxRetractPosition()

    await this.moveRobot2ToPosition(approach)
    if (this.bonder && this.bonder.fluxStation) this.bonder.fluxStation.begin()
    await this.moveRobot2ToPosition(dip)
    await this._sleep(BONDER_CONFIG.flux.dwellDuration)
    if (this.bonder && this.bonder.fluxStation) this.bonder.fluxStation.completeDip(true)
    await this.moveRobot2ToPosition(retract)
    this._syncChipState(chip, CHIP_STATES.FLUXED)
  }

  // ------------------------------------------------------------ full process
  async processChip(index) {
    const chip = this.getChip(index)
    if (!chip) return

    console.log(`[TwoRobot] Processing ${chip.name}`)

    this.state = 'R1_MOVE_TO_CHIP'
    await this.moveRobot1ToChip(chip)

    this.state = 'R1_PICK'
    this.attachToRobot1(chip)
    await this.moveRobot1Lift()

    this.state = 'R1_MOVE_TO_FLIP'
    await this.moveRobot1ToFlip()

    this.state = 'R1_FLIP'
    await this.flipChip180(chip)

    this.state = 'R1_MOVE_TO_HANDOFF'
    await this.moveRobot1ToHandoff()

    this.state = 'R1_HANDOFF_READY'

    this.state = 'R2_MOVE_TO_HANDOFF'
    await this.moveRobot2ToHandoff()

    this.state = 'R2_PICK'
    this.transferToRobot2(chip)
    await this.moveRobot2Lift()

    this.state = 'R2_MOVE_TO_FLUX'
    await this.moveRobot2ToFlux()

    this.state = 'R2_FLUX_DIP'
    await this.dipFlux(chip)

    this.state = 'R2_MOVE_TO_BOARD'
    await this.moveRobot2ToBoard(index)

    this.state = 'R2_PLACE'
    const target = this.getChipTarget(index)
    this._lastTarget = target
    await this.lowerRobot2ToTarget(target)

    this.releaseToBoard(chip, target)
    await this.retractRobot2()

    console.log(`[TwoRobot] ${chip.name} COMPLETE`)
  }

  async runSixChips() {
    if (this._running) return
    this._running = true
    this.currentChipIndex = 0

    try {
      for (let i = 0; i < 6; i += 1) {
        this.currentChipIndex = i
        await this.processChip(i)
      }
      this.state = 'SIX_CHIPS_COMPLETE'
      console.log('[TwoRobot] SIX CHIP PROCESS COMPLETE')
    } finally {
      this._running = false
    }
  }

  // ------------------------------------------------------------------- reset
  async reset() {
    this.state = 'RESETTING'
    this._running = false
    this._lastTarget = null

    this.attachedChip = null
    this.chipOwner = null
    this.currentChipIndex = 0

    this.tweens.clear()

    for (const chip of this.chips) {
      const original = this.originalTransforms.get(chip.name)
      if (!original) continue

      if (chip.parent !== original.parent) {
        const holder = original.parent || (this.bonder ? this.bonder.model : this.scene)
        this.detachPreserveWorld(chip, holder)
      }
      chip.position.copy(original.position)
      chip.quaternion.copy(original.quaternion)
      chip.scale.copy(original.scale)
      chip.userData.owner = 'SOURCE'
    }

    if (this.bonder && this.bonder.chipControllers) {
      this.bonder.chipControllers.forEach((controller) => controller.restoreToTray())
    }

    await this.resetRobot1()
    await this.resetRobot2()

    this.state = 'IDLE'
  }

  async resetRobot1() {
    if (!this.robot1Reach) return
    await this._moveAxis(this.robot1, 'x', this.robot1Reach.X.rest, BONDER_CONFIG.movement.travelDuration)
    await this._moveAxis(this.robot1Vertical, 'y', this.robot1Reach.Y.rest, BONDER_CONFIG.movement.liftDuration)
    if (this.robot1FlipAxis && this.robot1Reach.homeFlipZ !== undefined) {
      await this._rotateZ(this.robot1FlipAxis, this.robot1Reach.homeFlipZ, BONDER_CONFIG.movement.defaultDuration)
    }
  }

  async resetRobot2() {
    if (this.robot2Assembly && this.robot2AssemblyHome) {
      const home = this.waypoints && this.waypoints.robotHome
        ? this._localPosition(this.waypoints.robotHome)
        : null
      if (home) {
        await this._moveSkingTip(home, BONDER_CONFIG.movement.travelDuration)
        if (this.robot2Rotary && this.robot2Reach.homeRotaryZ !== undefined) {
          await this._rotateZ(this.robot2Rotary, this.robot2Reach.homeRotaryZ, BONDER_CONFIG.movement.defaultDuration)
        }
        return
      }
      await Promise.all(['x', 'y', 'z'].map((axis) =>
        this._moveAxis(this.robot2Assembly, axis, this.robot2AssemblyHome[axis], BONDER_CONFIG.movement.travelDuration)
      ))
      if (this.robot2Rotary && this.robot2Reach.homeRotaryZ !== undefined) {
        await this._rotateZ(this.robot2Rotary, this.robot2Reach.homeRotaryZ, BONDER_CONFIG.movement.defaultDuration)
      }
      return
    }
    if (!this.robot2Reach) return
    await this._moveAxis(this.robot2, 'x', this.robot2Reach.X.rest, BONDER_CONFIG.movement.travelDuration)
    await this._moveAxis(this.robot2Vertical, 'y', this.robot2Reach.Y.rest, BONDER_CONFIG.movement.liftDuration)
    if (this.robot2Rotary && this.robot2Reach.homeRotaryZ !== undefined) {
      await this._rotateZ(this.robot2Rotary, this.robot2Reach.homeRotaryZ, BONDER_CONFIG.movement.defaultDuration)
    }
  }

  getStatus() {
    return {
      state: this.state,
      currentChipIndex: this.currentChipIndex,
      chipOwner: this.chipOwner,
      attachedChip: this.attachedChip ? this.attachedChip.name : null,
      totalChips: this.chips.length,
    }
  }
}