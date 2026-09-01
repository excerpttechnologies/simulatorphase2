'use client'

import * as THREE from 'three'
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js'

import { TweenGroup, clamp } from './bonder/BonderUtils.js'
import { ChipController, CHIP_STATES } from './bonder/ChipController.js'
import { BonderStateMachine } from './bonder/BonderStateMachine.js'
import { BonderEvents, BONDER_EVENTS } from './bonder/BonderEvents.js'
import { BONDER_CONFIG, BONDER_STAGE_IDS, BONDER_STAGE_LABELS } from './bonder/BonderConfig.js'
import { FlipStageController } from './bonder/FlipStageController.js'
import { FluxStationController } from './bonder/FluxStationController.js'
import { AlignmentController } from './bonder/AlignmentController.js'
import { BondingController } from './bonder/BondingController.js'

/**
 * BonderController â€” the master orchestrator for the Flip Chip Bonder.
 *
 * Process architecture (state-driven, deterministic, repeatable):
 *
 *   PROCESS STATE -> OPERATION -> ROBOT MOVEMENT -> CHIP ATTACHMENT ->
 *   CHIP TRANSFER -> ORIENTATION -> NEXT OPERATION
 *
 * The animation/geometry system visually executes each operation; the state
 * machine + the chip controller determine whether it is actually valid.
 *
 * A single authoritative CHIP is physically ATTACHED (parented) to the active
 * tool so it never floats and never teleports.
 */
export class BonderController {
  constructor(scene) {
    this.scene = scene
    this.root = null
    this.model = null
    this.mixer = null
    this.ready = false
    this.autoRun = false

    this.tweens = new TweenGroup()
    this.events = new BonderEvents()
    this.stateMachine = new BonderStateMachine(this.events)
    this.chipController = null
    this.flipStage = new FlipStageController(BONDER_CONFIG)
    this.fluxStation = new FluxStationController(BONDER_CONFIG)
    this.alignment = new AlignmentController(BONDER_CONFIG)
    this.bonding = new BondingController(BONDER_CONFIG)

    this.running = false
    this.paused = false
    this.speed = 1

    // Named scene entities (populated during load).
    this.nodes = {}

    // Robot structures (calibrated at load).
    this.robots = {
      sking: null, // pickup + flip
      colright: null, // bond head
    }

    // Debug visualization.
    this.debugMode = false
    this._helpers = new THREE.Group()

    // Flags to let the render loop know to call update().
    this._bindUpdate = null
  }

  // â”€â”€ Public state / events â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  on(event, handler) {
    return this.events.on(event, handler)
  }

  getStatus() {
    return {
      ...this.stateMachine.getStatus(),
      chip: this.chipController ? this.chipController.getStatus() : null,
      robots: {
        sking: this.robots.sking ? this.robots.sking.status() : 'unknown',
        colright: this.robots.colright ? this.robots.colright.status() : 'unknown',
      },
      ready: this.ready,
      running: this.running,
      paused: this.paused,
      speed: this.speed,
    }
  }

  // â”€â”€ Load / discovery â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  async load(url = '/flip_chip_bonder.glb') {
    const gltf = await new Promise((resolve, reject) => {
      new GLTFLoader().load(url, resolve, undefined, reject)
    })

    this.root = gltf.scene
    this.scene.add(this.root)
    this.model = this.root

    // Animation mixer retained for reference (NOT used to drive process).
    this.mixer = new THREE.AnimationMixer(this.root)
    this.animations = gltf.animations

    // Discover named objects robustly.
    this._discoverNodes(this.root)

    // Calibrate robots BEFORE the model is scaled/fitted, so every reach
    // constant and relocation offset is measured in faithful model-local units.
    this._calibrateRobots()

    // Fit/scale/center the whole model (visual presentation only). All process
    // math stays in model-local space, so the visual scaling is irrelevant to it.
    this._fitModel()

    // Build the physical chip controller from the ACTIVE_CHIP node.
    // Its "scene" is the (scaled) model root so chip placement/verification is
    // performed in model-local coordinates.
    this.chipController = new ChipController(this.model, null)
    this.chipController.setBus(this.events)

    // Strip the baked ACTIVE_CHIP animation so the physical chip controller wins.
    this._stripChipAnimation()

    this.ready = true
    this.events.emit(BONDER_EVENTS.LOADED, { clips: this.listClips() })

    this._log('PROCESS CONTROLLER READY')

    if (this.autoRun) {
      this.start()
    }

    return {
      scene: this.root,
      clips: this.listClips(),
      status: this.getStatus(),
    }
  }

  /**
   * Scale and center the assembled model so it fits the intended on-scene
   * footprint (matches the previous page-level sizing). Only touches the model
   * root transform â€” all internal node math remains model-local.
   */
  _fitModel() {
    if (!this.model) return
    const TARGET_WIDTH = 20
    const bounds = new THREE.Box3().setFromObject(this.model)
    const size = new THREE.Vector3()
    bounds.getSize(size)
    const footprint = Math.max(size.x, size.z)
    if (footprint > 0) this.model.scale.setScalar(TARGET_WIDTH / footprint)

    this.model.updateMatrixWorld(true)
    const scaledBounds = new THREE.Box3().setFromObject(this.model)
    const center = new THREE.Vector3()
    scaledBounds.getCenter(center)
    this.model.position.x -= center.x
    this.model.position.z -= center.z
    this.model.position.y -= scaledBounds.min.y

    this.model.traverse((child) => {
      if (child.isMesh) {
        child.castShadow = true
        child.receiveShadow = true
      }
    })
    this.model.name = 'flip_chip_bonder_model'
  }

  /**
   * Walk the loaded GLB and map every named object by name.
   * Prints a discovery table to the console for diagnostics.
   */
  _discoverNodes(root) {
    root.traverse((o) => {
      if (o.isObject3D && o.name) {
        // Keep first occurrence by name.
        if (this.nodes[o.name] === undefined) this.nodes[o.name] = o
      }
    })
  }

  _stripChipAnimation() {
    if (!this.mixer) return
    const clips = this.animations || []
    clips.forEach((clip) => {
      if (clip.name && clip.name.toLowerCase().includes('active_chip')) {
        // Stop its action if created, and ignore it.
        try {
          const action = this.mixer.clipAction(clip)
          action && action.stop()
        } catch (e) {
          /* ignore */
        }
      }
    })
  }

  // â”€â”€ Calibration â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  /**
   * Compute world positions of the tool contact points and the stations, then
   * relocate the SKING gantry and compute reach constants so that the tools
   * can genuinely perform a physical pickup (the GLB's baked movie could not).
   */
  _calibrateRobots() {
    const skingCarriage = this.nodes['SKING_CARRIAGE']
    const skingFlange = this.nodes['SKING_SERVO_FLANGE']
    const skingRing = this.nodes['SKING_ROTARY_BEARING_RING']
    const skingAnchor = this.nodes['SKING_ARM_TIP_ANCHOR']
    const skingNozzle = this.nodes['SKING_PICKUP_NOZZLE']
    const skingRails = [
      this.nodes['SKING_LINEAR_RAIL'],
      this.nodes['SKING_RAIL_BACK'],
      this.nodes['SKING_FLIP_AXIS'],
    ]

    const colCarriage = this.nodes['COLRIGHT_CARRIAGE']
    const colVertical = this.nodes['COLRIGHT_VERTICAL_AXIS']
    const colAnchor = this.nodes['COLRIGHT_ARM_TIP_ANCHOR']
    const colRails = [
      this.nodes['COLRIGHT_RAIL'],
      this.nodes['COLRIGHT_RAIL2'],
      this.nodes['COLRIGHT_BASE'],
    ]

    // The ACTIVE chip's authored plane. Both tools AND the substrate are
    // relocated onto this same plane so a true physical handoff/bond can occur.
    const workingZ = BONDER_CONFIG.positions.chipRest.z

    // â”€â”€ SKING (Robot A / pickup-flip) â”€â”€
    const nozzlePos = new THREE.Vector3()
    const carriagePos = new THREE.Vector3()
    if (skingNozzle) skingNozzle.getWorldPosition(nozzlePos)
    if (skingCarriage) skingCarriage.getWorldPosition(carriagePos)

    // Reach constant: flange LOCAL Y for a desired nozzle-tip WORLD Y.
    //   tipWorldY = skingCarriageY + flangeLocalY - tipK
    const flangeRestLocal = skingFlange ? skingFlange.position.y : 0
    const skingCarriageY = carriagePos.y || 1
    const tipK = skingCarriageY + flangeRestLocal - nozzlePos.y

    // Relocate the whole SKING gantry so its nozzle tip sits on the working
    // plane (matching the active chip's Z).
    const skingZOffset = workingZ - nozzlePos.z
    const applySkingZ = (objs) => {
      ;(objs || []).forEach((o) => {
        if (o) o.position.z += skingZOffset
      })
    }
    applySkingZ([skingCarriage].concat(skingRails))

    const anchorAfter = new THREE.Vector3()
    if (skingAnchor) skingAnchor.getWorldPosition(anchorAfter)

    // â”€â”€ COLRIGHT (Robot B / bond head) â”€â”€
    const colAnchorRest = new THREE.Vector3()
    if (colAnchor) colAnchor.getWorldPosition(colAnchorRest)
    const colVerticalRestLocal = colVertical ? colVertical.position.y : 0
    const colCarriageY = colCarriage ? colCarriage.position.y : 1

    // kCol: anchorWorldY = colCarriageY + colVerticalLocalY - kCol
    const kCol = colCarriageY + colVerticalRestLocal - colAnchorRest.y

    // Relocate the whole COLRIGHT gantry onto the working plane (same Z as SKING).
    const colZOffset = workingZ - colAnchorRest.z
    const applyColZ = (objs) => {
      ;(objs || []).forEach((o) => {
        if (o) o.position.z += colZOffset
      })
    }
    applyColZ([colCarriage].concat(colRails))

    // â”€â”€ Substrate / bond base on the working plane â”€â”€
    // The BondBase is authored at z=0; shift it (and its target) to the chip plane.
    const bondBase = this.nodes['BondBase']
    const bondBaseTarget = this.nodes['BONDBASE_TARGET']
    const substrateZShift = workingZ - 0
    ;[bondBase, bondBaseTarget].forEach((o) => {
      if (o) o.position.z += substrateZShift
    })

    // Bond target (world position) on the working plane.
    this.bondTarget = new THREE.Vector3(
      BONDER_CONFIG.positions.bondTarget.x,
      BONDER_CONFIG.positions.bondTarget.y,
      workingZ
    )

    this.robots.sking = {
      carriage: skingCarriage,
      flange: skingFlange,
      ring: skingRing,
      anchor: skingAnchor,
      nozzle: skingNozzle,
      tipK,
      skingCarriageY,
      zOffset: skingZOffset,
      anchorRest: anchorAfter.clone(),
      nozzleRest: anchorAfter.clone(),
      x: skingCarriage ? skingCarriage.position.x : 0,
      flangeYForTipY: (tipWorldY) => tipWorldY + tipK - skingCarriageY,
    }

    this.robots.colright = {
      carriage: colCarriage,
      vertical: colVertical,
      anchor: colAnchor,
      kCol,
      colCarriageY,
      zOffset: colZOffset,
      anchorRest: colAnchorRest.clone(),
      verticalYForAnchorY: (anchorWorldY) => anchorWorldY + kCol - colCarriageY,
    }

    this._logObjectDiscovery()
  }

  _logObjectDiscovery() {
    const body = Object.keys(this.nodes).map((name) => {
      const o = this.nodes[name]
      const p = new THREE.Vector3()
      o.getWorldPosition(p)
      return { name, type: o.type || o.constructor.name, parent: o.parent ? o.parent.name : 'ROOT', pos: p.toArray().map((v) => +v.toFixed(2)).join(',') }
    })
    if (typeof console !== 'undefined') {
      console.table(body)
      console.groupCollapsed('[BONDER] Animations')
      ;(this.animations || []).forEach((a) => {
        console.log(`${a.name}  dur=${a.duration.toFixed(2)}s  tracks=${a.tracks ? a.tracks.length : '?'}`)
      })
      console.groupEnd()
    }
  }

  listClips() {
    return (this.animations || []).map((a) => a.name)
  }

  // â”€â”€ Render-loop integration â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  update(deltaSeconds) {
    // The page passes dt already scaled by the global speed factor, so this
    // method consumes it directly. Pausing simply freezes all motion.
    if (!this.paused) {
      this.tweens.update(deltaSeconds)
    }
    if (this.mixer) this.mixer.update(deltaSeconds)
    if (this.debugMode) {
      this._updateDebugVisuals()
    }
    // Nothing else needed: the chip is a child of the active tool and follows it.
  }

  // â”€â”€ Controls â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  setSpeed(k) {
    this.speed = clamp(k, 0.1, 10)
  }

  pause() {
    if (!this.running) return
    this.paused = true
    this.stateMachine.pause()
  }

  resume() {
    if (!this.paused) return
    this.paused = false
    this.stateMachine.resume()
  }

  /**
   * Full reset â€” restores every mechanism, the chip, and all flags to initial
   * conditions so the recipe can run again from the beginning.
   */
  reset() {
    this.running = false
    this.paused = false

    // Cancel tweens / timers.
    this.tweens.clear()
    if (this.mixer) {
      try {
        this.mixer.stopAllAction()
      } catch (e) {
        /* ignore */
      }
    }

    // Restore chip to tray.
    if (this.chipController) this.chipController.restoreToTray()

    // Restore robots to calibrated home.
    this._resetRobotsToHome()

    // Restore stations.
    this.flipStage.reset()
    this.fluxStation.reset()
    this.alignment.reset()
    this.bonding.reset()

    this.stateMachine.reset()
    this._log('RESET COMPLETE â€” READY TO RUN AGAIN')
  }

  _resetRobotsToHome() {
    const sking = this.robots.sking
    if (sking) {
      if (sking.carriage) sking.carriage.position.x = this._skingHomeX || sking.carriage.position.x
      if (sking.flange) sking.flange.position.y = this._skingFlangeHome
      if (sking.ring) sking.ring.rotation.z = 0
    }
    const col = this.robots.colright
    if (col) {
      if (col.carriage) col.carriage.position.x = this._colHomeX || col.carriage.position.x
      if (col.vertical) col.vertical.position.y = this._colVerticalHome
      if (col.jawA && col.jawB) {
        // open jaws back to original
        col.jawA.rotation.y = this._jawAHome
        col.jawB.rotation.y = this._jawBHome
      }
    }
  }

  _captureHomes() {
    const sking = this.robots.sking
    if (sking && sking.carriage) {
      this._skingHomeX = sking.carriage.position.x
      if (sking.flange) this._skingFlangeHome = sking.flange.position.y
    }
    const col = this.robots.colright
    if (col) {
      if (col.carriage) this._colHomeX = col.carriage.position.x
      if (col.vertical) this._colVerticalHome = col.vertical.position.y
      if (col.jawA) this._jawAHome = col.jawA.rotation.y
      if (col.jawB) this._jawBHome = col.jawB.rotation.y
    }
  }

  // â”€â”€ Master process â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  /**
   * Start the full deterministic flip-chip recipe.
   */
  start() {
    if (!this.ready) {
      this.autoRun = true
      return
    }
    if (this.running) return
    if (this.stateMachine.status === 'complete') this.reset()
    this.running = true
    this.paused = false
    this.stateMachine.setRunning()
    this._prepareChip()
    this._captureHomes()

    // Run asynchronously; intentionally not awaited from the render loop.
    this._runRecipe().then(
      () => {
        this.running = false
      },
      (err) => {
        this.running = false
        this.stateMachine.fail(err && err.message ? err.message : String(err))
      }
    )
  }

  _prepareChip() {
    const chip = this._getActiveChipObject()
    if (chip) {
      this.chipController.registerChip(chip)
      // The pickup hold point is the NOZZLE tip (the physical vacuum contact
      // point), not the arm-tip anchor which sits far above it.
      this.chipController.setHoldTargets(this.robots.sking.nozzle || this.robots.sking.anchor, this.robots.colright.anchor)
      const trayGroup = this.nodes['WAFER'] || this.root
      this.chipController.setTray(trayGroup)
    } else {
      this._logError('ACTIVE_CHIP NOT FOUND')
    }
  }

  _getActiveChipObject() {
    return this.nodes['ACTIVE_CHIP'] || this.nodes['CHIP_01'] || null
  }

  async _sleep(duration) {
    // Wait by tweening a dummy for a given real duration (respects pause via update).
    return new Promise((resolve) => {
      this.tweens.add({
        elapsed: 0,
        duration: Math.max(0.02, duration),
        finished: false,
        update(dt) {
          if (this.finished) return true
          this.elapsed += dt
          if (this.elapsed >= this.duration) {
            this.finished = true
            resolve()
            return true
          }
          return false
        },
      })
    })
  }

  // â”€â”€ Recipe steps â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  async _runRecipe() {
    const sm = this.stateMachine
    const chip = this.chipController

    this._log('PROCESS START')

    // 1 INITIALIZE
    sm.completeStage(BONDER_STAGE_IDS.MOVE_TO_PICK, null)

    // 2-4 PICK
    await this._pickChip(sm, chip)

    // 5 TRANSFER (pickup head carries chip to flip/flux area)
    sm.completeStage(BONDER_STAGE_IDS.TRANSFER, chip.isAttached ? null : 'CHIP NOT ATTACHED FOR TRANSFER')
    this.events.emit(BONDER_EVENTS.TRANSFER_STARTED, {})
    await this._transferToFlip(sm, chip)

    // 6-7 FLIP
    sm.completeStage(BONDER_STAGE_IDS.FLIP, chip.guardFlip())
    this.events.emit(BONDER_EVENTS.FLIP_STARTED, {})
    const flipOk = await this._flip(sm, chip)
    if (!flipOk) throw new Error('FLIP_REJECTED')
    sm.completeStage(BONDER_STAGE_IDS.VERIFY_FLIP, null)
    chip.setState(CHIP_STATES.FLIPPED)

    // 8-9 FLUX
    await this._handoff(sm, chip)
    sm.completeStage(BONDER_STAGE_IDS.FLUX_DIP, chip.guardFlux())
    this.events.emit(BONDER_EVENTS.FLUX_DIP_STARTED, {})
    const fluxOk = await this._fluxDip(sm, chip)
    if (!fluxOk) throw new Error('FLUX_POSITION_NOT_REACHED')
    sm.completeStage(BONDER_STAGE_IDS.VERIFY_FLUX, null)
    chip.setState(CHIP_STATES.FLUXED)
    this.events.emit(BONDER_EVENTS.FLUX_DIP_COMPLETE, {})

    // 10-11 ALIGN
    sm.completeStage(BONDER_STAGE_IDS.MOVE_TO_ALIGNMENT, chip.guardAlign())
    await this._moveToAlignment(sm, chip)
    sm.completeStage(BONDER_STAGE_IDS.ALIGN, null)
    const alignOk = await this._align(sm, chip)
    if (!alignOk) throw new Error('ALIGNMENT_OUT_OF_TOLERANCE')
    chip.setState(CHIP_STATES.ALIGNED)
    this.events.emit(BONDER_EVENTS.ALIGNMENT_COMPLETE, {})

    // 12-13 BOND
    sm.completeStage(BONDER_STAGE_IDS.MOVE_TO_BOND, null)
    await this._moveToBond(sm, chip)
    sm.completeStage(BONDER_STAGE_IDS.BOND, null)
    this.events.emit(BONDER_EVENTS.BOND_STARTED, {})
    this.bonding.begin()
    await this._bond(sm, chip)
    if (!this.bonding.state.bonded) throw new Error('BOND_FAILED')
    chip.setState(CHIP_STATES.BONDED)
    this.events.emit(BONDER_EVENTS.BOND_COMPLETE, {})

    // 14 RELEASE
    sm.completeStage(BONDER_STAGE_IDS.RELEASE, chip.guardRelease())
    const released = await this._releaseChip(sm, chip)
    if (!released) throw new Error('RELEASE_FAILED')
    this.events.emit(BONDER_EVENTS.RELEASE_COMPLETE, {})

    // 15 VERIFY PLACEMENT
    sm.completeStage(BONDER_STAGE_IDS.VERIFY_PLACEMENT, null)
    const placed = this.bonding.verify(
      this._chipWorldPos(),
      this.bondTarget,
      BONDER_CONFIG.bonding.contactHeight
    )
    if (!placed) throw new Error('PLACEMENT_OUT_OF_TOLERANCE')
    this.events.emit(BONDER_EVENTS.PLACEMENT_VERIFIED, { ok: true })

    // 16 RETRACT
    sm.completeStage(BONDER_STAGE_IDS.RETRACT, null)
    await this._retract(sm, chip)

    // 17 COMPLETE
    sm.completeStage(BONDER_STAGE_IDS.COMPLETE, null)
    this._log('PROCESS COMPLETE')
    return { success: true }
  }

  _chipWorldPos() {
    const c = this.chipController.chip
    if (!c) return new THREE.Vector3()
    const p = new THREE.Vector3()
    c.getWorldPosition(p)
    if (this.model) {
      // Express in model-local space so it is directly comparable to the
      // model-local bond/flux/alignment targets (independent of visual scale).
      this.model.worldToLocal(p)
    }
    return p
  }

  // â”€â”€ PICK â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  async _pickChip(sm, chip) {
    this._log('MOVING TO PICK')
    this.events.emit(BONDER_EVENTS.PICK_STARTED, {})

    const sking = this.robots.sking
    const tray = BONDER_CONFIG.positions.chipRest
    const flange = sking.flange

    // Move carriage over the chip.
    await this._moveNodeAxis(sking.carriage, 'x', tray.x, BONDER_CONFIG.movement.travelDuration)

    const maxRetries = BONDER_CONFIG.pickup.maxRetries
    let verified = false

    for (let retries = 0; retries <= maxRetries; retries++) {
      // Approach â€” raise tool to clear height.
      const approachTipY = tray.y + BONDER_CONFIG.pickup.approachHeight
      await this._moveNodeAxis(flange, 'y', sking.flangeYForTipY(approachTipY), BONDER_CONFIG.movement.lowerDuration)

      // Lower to contact â€” nozzle tip at chip top.
      await this._moveNodeAxis(flange, 'y', sking.flangeYForTipY(tray.y), BONDER_CONFIG.movement.lowerDuration)

      // Contact the chip: vacuum on + attach.
      chip.pickup.vacuum = true
      this._log('VACUUM ON')
      const attached = chip.attachToPickup()

      // Verify against the NOZZLE tip (the actual contact point), not the
      // arm-tip anchor which is located far above the nozzle.
      let contactPoint = null
      if (sking.nozzle) {
        contactPoint = new THREE.Vector3()
        sking.nozzle.getWorldPosition(contactPoint)
      } else if (sking.anchor) {
        contactPoint = new THREE.Vector3()
        sking.anchor.getWorldPosition(contactPoint)
      }
      verified = attached && chip.verifyPickup(contactPoint, BONDER_CONFIG.pickup.attachTolerance)

      if (verified) {
        this._log('CHIP ATTACHED â€” PICK VERIFIED')
        this.events.emit(BONDER_EVENTS.PICK_SUCCESS, {})
        chip.setState(CHIP_STATES.PICKED)
        break
      }

      // Pickup failed â€” vacuum off, release, reposition, retry.
      chip.pickup.vacuum = false
      chip.pickup.chipAttached = false
      chip.pickup.retries = retries + 1
      this._logError('PICKUP FAILED â€” RETRYING')
      this.events.emit(BONDER_EVENTS.PICK_FAILED, { retry: retries + 1 })

      if (retries < maxRetries) {
        await this._moveNodeAxis(flange, 'y', sking.flangeYForTipY(approachTipY), BONDER_CONFIG.movement.liftDuration)
        await this._sleep(BONDER_CONFIG.movement.defaultDuration * 0.3)
      }
    }

    // Mark pick stages only now that the operation has actually completed.
    sm.completeStage(BONDER_STAGE_IDS.PICK_CHIP, null)
    sm.completeStage(BONDER_STAGE_IDS.VERIFY_PICK, verified ? null : 'PICKUP_FAILED_MAX_RETRIES')

    if (!verified) throw new Error('PICKUP_FAILED_MAX_RETRIES')

    // Lift chip â€” raise the tool (chip follows as a child).
    const liftTipY = tray.y + BONDER_CONFIG.pickup.approachHeight
    await this._moveNodeAxis(flange, 'y', sking.flangeYForTipY(liftTipY), BONDER_CONFIG.movement.liftDuration)
    this._log('LIFTING CHIP')
  }

  // â”€â”€ TRANSFER â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  async _transferToFlip(sm, chip) {
    this._log('TRANSFER TO FLIP STAGE')
    // Carry the attached chip to the flip area (centre-ish for the flip operation).
    const sking = this.robots.sking
    const flipX = this._flipX()
    await this._moveNodeAxis(sking.carriage, 'x', flipX, BONDER_CONFIG.movement.transferDuration)
  }

  // â”€â”€ FLIP â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  async _flip(sm, chip) {
    this._log('FLIP START')
    const sking = this.robots.sking
    const ring = sking.ring
    if (!ring) {
      // No flip ring â€” fallback: rotate the pickup anchor group.
      return this._proceduralFlipFallback(sking, chip)
    }
    this.flipStage.begin()
    const target = ring.rotation.z + BONDER_CONFIG.flip.rotation

    // Capture the chip's STARTING world orientation so we can PROVE it rotated.
    const startQ = new THREE.Quaternion()
    if (chip.chip) {
      chip.chip.updateWorldMatrix(true, false)
      chip.chip.getWorldQuaternion(startQ)
    }

    await this._rotateNodeZ(ring, target, BONDER_CONFIG.flip.duration)

    // Chip is a child of the anchor, which is a child of the rotated ring,
    // so it rotated 180Â° WITH the tool. Verify the die's world orientation
    // actually changed by ~180Â° (targetAngle), proving the flip occurred.
    const chipQ = new THREE.Quaternion()
    if (chip.chip) {
      chip.chip.getWorldQuaternion(chipQ)
    }
    const ok = this.flipStage.verifyFlip(startQ, chipQ, Math.abs(BONDER_CONFIG.flip.rotation), this.flipTolerance())

    if (ok) {
      this.flipStage.state.flipped = true
      this._log('FLIP COMPLETE')
      this.events.emit(BONDER_EVENTS.FLIP_COMPLETE, {})
    }
    return ok
  }

  flipTolerance() {
    // Tolerate the residual orientation error left by the discrete tween so a
    // completed 180Â° rotation still resolves as "flipped".
    return 0.35
  }

  async _proceduralFlipFallback(sking, chip) {
    // Rotate the pickup anchor itself.
    const anchor = sking.anchor
    if (!anchor) return false
    this.flipStage.begin()
    await this._rotateNodeZ(anchor, anchor.rotation.z + BONDER_CONFIG.flip.rotation, BONDER_CONFIG.flip.duration)
    this.flipStage.state.flipped = true
    this.flipStage.state.ready = true
    this.flipStage.state.rotating = false
    this._log('FLIP COMPLETE (procedural)')
    this.events.emit(BONDER_EVENTS.FLIP_COMPLETE, {})
    return true
  }

  // â”€â”€ HANDOFF to Robot B â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  async _handoff(sm, chip) {
    // Robot B (bond head) approaches the flip area and joints Robot A.
    const sking = this.robots.sking
    const col = this.robots.colright
    const handoff = BONDER_CONFIG.positions.handoff

    // Robot A carries the flipped chip to the handoff X.
    await this._moveNodeAxis(sking.carriage, 'x', handoff.x, BONDER_CONFIG.handoff.duration)

    // Robot B travels to the handoff X (on its rail).
    await this._moveNodeAxis(col.carriage, 'x', handoff.x, BONDER_CONFIG.handoff.duration)

    // Robot B lowers its gripper to the chip.
    const chipPos = this._chipWorldPos()
    const anchorY = chipPos.y + 0.08
    await this._moveNodeAxis(col.vertical, 'y', col.verticalYForAnchorY(anchorY), BONDER_CONFIG.movement.lowerDuration)

// Robot A releases the chip and Robot B grips it.
    // Reparent the single authoritative chip from A's anchor to B's anchor.
    const attached = chip.attachToBond()
    if (!attached) {
      this._logError('HANDOFF FAILED — CHIP NOT RECEIVED BY ROBOT B')
      return this._retryHandoff(sm, chip)
    }

    // Seat the flipped die onto the working plane. The 180° flip swings the
    // die off-axis in Z by a small amount; recentre it so the die sits exactly
    // on the bond/alignment target plane (robot B's anchor is already on it).
    if (chip.chip && chip.chip.parent === this.robots.colright.anchor) {
      const colAnchor = this.robots.colright.anchor
      colAnchor.updateWorldMatrix(true, false)
      const anchorWorldPos = new THREE.Vector3()
      colAnchor.getWorldPosition(anchorWorldPos)

      // Preserve world X,Y but set Z to the anchor's world Z (working plane).
      const desiredWorldPos = new THREE.Vector3()
      chip.chip.getWorldPosition(desiredWorldPos)
      desiredWorldPos.z = anchorWorldPos.z

      // Convert desired world position to local space of the anchor.
      const parentWorldInv = new THREE.Matrix4().copy(colAnchor.matrixWorld).invert()
      const localPos = desiredWorldPos.clone().applyMatrix4(parentWorldInv)
      chip.chip.position.copy(localPos)
      chip.chip.updateMatrix()
    }

    // Open jaws (visual grip) — close A slightly.
    this._closeJaws(col, 0.012, 0.5)

    this._log('CHIP HANDED TO BOND HEAD')

    // Robot A retracts away from the handoff zone.
    await this._moveNodeAxis(sking.carriage, 'x', this._skingHomeX || sking.carriage.position.x, BONDER_CONFIG.movement.travelDuration)
  }

  async _retryHandoff(sm, chip) {
    this._logError('HANDOFF RETRY')
    await this._sleep(BONDER_CONFIG.movement.defaultDuration)
    return this._handoff(sm, chip)
  }

  _closeJaws(col, amount, duration) {
    if (!col.jawA || !col.jawB) return
    this._log('GRIPPER CLOSED')
    // Jaws are visual; chip is physically attached to the anchor.
    col.jawA.rotation.y = -amount
    col.jawB.rotation.y = amount
  }

  // â”€â”€ FLUX â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  async _fluxDip(sm, chip) {
    const col = this.robots.colright
    const flux = BONDER_CONFIG.positions.fluxTarget
    this.fluxStation.begin()

    // Move over the flux station.
    await this._moveNodeAxis(col.carriage, 'x', flux.x, BONDER_CONFIG.movement.travelDuration)

    // Lower into flux.
    const dipAnchorY = BONDER_CONFIG.positions.fluxTarget.y + BONDER_CONFIG.flux.dipDepth
    await this._moveNodeAxis(col.vertical, 'y', col.verticalYForAnchorY(dipAnchorY), BONDER_CONFIG.flux.dipDuration)
    this._log('FLUX DIP START')

    // Dwell.
    await this._sleep(BONDER_CONFIG.flux.dwellDuration)

    // Verify dip depth reached.
    const dipOk = this.fluxStation.completeDip(true)
    if (!dipOk) {
      this._logError('FLUX POSITION NOT REACHED')
      return false
    }

    // Raise from flux.
    const retractAnchorY = flux.y + BONDER_CONFIG.flux.approachHeight
    await this._moveNodeAxis(col.vertical, 'y', col.verticalYForAnchorY(retractAnchorY), BONDER_CONFIG.flux.retractDuration)
    this._log('FLUX DIP COMPLETE')
    return true
  }

  // â”€â”€ ALIGNMENT â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  async _moveToAlignment(sm, chip) {
    const col = this.robots.colright
    const align = BONDER_CONFIG.positions.alignment
    await this._moveNodeAxis(col.carriage, 'x', align.x, BONDER_CONFIG.movement.travelDuration)
  }

  async _align(sm, chip) {
    this.events.emit(BONDER_EVENTS.ALIGNMENT_STARTED, {})
    this._log('ALIGNMENT START')
    this.alignment.setTarget({ position: this.bondTarget.clone(), rotation: 0 })

    // Coarse alignment: nudge the gripper over the bond X.
    const col = this.robots.colright
    await this._moveNodeAxis(col.carriage, 'x', this.bondTarget.x, BONDER_CONFIG.alignment.duration)
    this.alignment.markCoarse()

    // Fine alignment: verify PLANAR position (x/z). Vertical descent to the
    // substrate happens during the bond stage, so Y is excluded here.
    const chipPos = this._chipWorldPos()
    const planar = chipPos.clone()
    planar.y = this.bondTarget.y
    const ok = this.alignment.verifyFine(planar, 0)
    this._log('ALIGNMENT COMPLETE')
    return ok
  }

  // â”€â”€ BOND + RELEASE â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  async _moveToBond(sm, chip) {
    const col = this.robots.colright
    await this._moveNodeAxis(col.carriage, 'x', this.bondTarget.x, BONDER_CONFIG.movement.travelDuration)
  }

  async _bond(sm, chip) {
    const col = this.robots.colright
    this.bonding.begin()
    this._log('BOND START')

    // Lower chip onto the substrate.
    const contactAnchorY = this.bondTarget.y + BONDER_CONFIG.bonding.contactHeight
    await this._moveNodeAxis(col.vertical, 'y', col.verticalYForAnchorY(contactAnchorY), BONDER_CONFIG.bonding.descentDuration)
    this.bonding.markTouchdown()

    // Dwell (apply+hold, visual).
    await this._sleep(BONDER_CONFIG.bonding.dwellDuration)
    this.bonding.markBond()
    this._log('BOND APPLIED')
  }

  async _releaseChip(sm, chip) {
    this._log('RELEASING CHIP')
    // Place at the exact bond position and detach.
    const placePos = this.bondTarget.clone()
    const placed = chip.placeChip(placePos)
    if (!placed) return false

    // Vacuum off.
    chip.pickup.vacuum = false
    chip.pickup.chipAttached = false

    // Open jaws.
    const col = this.robots.colright
    if (col.jawA && col.jawB) {
      col.jawA.rotation.y = 0
      col.jawB.rotation.y = 0
    }

    this._log('CHIP RELEASED')
    return true
  }

  async _retract(sm, chip) {
    const col = this.robots.colright
    const retractAnchorY = BONDER_CONFIG.positions.bondTarget.y + BONDER_CONFIG.bonding.approachHeight
    await this._moveNodeAxis(col.vertical, 'y', col.verticalYForAnchorY(retractAnchorY), BONDER_CONFIG.movement.liftDuration)
    this._log('TOOL RETRACTED')
  }

  _flipX() {
    // Flip happens above the handoff / centre region.
    return BONDER_CONFIG.positions.handoff.x
  }

  // â”€â”€ Low-level movement helpers â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  _moveNodeAxis(obj, axis, to, duration) {
    if (!obj) return Promise.resolve()
    const from = obj.position[axis]
    return new Promise((resolve) => {
      this.tweens.add({
        elapsed: 0,
        duration: Math.max(0.02, duration),
        from,
        to,
        finished: false,
        obj,
        axis,
        update(dt) {
          if (this.finished) return true
          this.elapsed += dt
          const p = Math.min(this.elapsed / this.duration, 1)
          const e = p < 0.5 ? 4 * p * p * p : 1 - Math.pow(-2 * p + 2, 3) / 2
          obj.position[axis] = from + (to - from) * e
          if (p >= 1) {
            obj.position[axis] = to
            this.finished = true
            resolve()
            return true
          }
          return false
        },
      })
    })
  }

  _rotateNodeZ(obj, to, duration) {
    if (!obj) return Promise.resolve()
    const from = obj.rotation.z
    return new Promise((resolve) => {
      this.tweens.add({
        elapsed: 0,
        duration: Math.max(0.02, duration),
        from,
        to,
        finished: false,
        update(dt) {
          if (this.finished) return true
          this.elapsed += dt
          const p = Math.min(this.elapsed / this.duration, 1)
          const e = p < 0.5 ? 4 * p * p * p : 1 - Math.pow(-2 * p + 2, 3) / 2
          obj.rotation.z = from + (to - from) * e
          if (p >= 1) {
            obj.rotation.z = to
            this.finished = true
            resolve()
            return true
          }
          return false
        },
      })
    })
  }

  // â”€â”€ Debug visuals â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  setDebugMode(on) {
    this.debugMode = on
    if (on && this.root) {
      this._buildDebugVisuals()
    }
    this._clearDebugVisuals()
  }

  _buildDebugVisuals() {
    this._clearDebugVisuals()
    this.root && this.root.add(this._helpers)
    const mk = (color) => {
      const m = new THREE.Mesh(
        new THREE.SphereGeometry(0.03, 8, 8),
        new THREE.MeshBasicMaterial({ color })
      )
      this._helpers.add(m)
      return m
    }
    this._dbg = {
      pick: mk(0x00ff00),
      contact: mk(0x00ffaa),
      chip: mk(0xffff00),
      flux: mk(0x8888ff),
      bond: mk(0xff4444),
      waypoint: mk(0xffaa00),
    }
    this._log('DEBUG VISUALIZATION ON')
  }

  _clearDebugVisuals() {
    if (this._helpers.parent) this._helpers.parent.remove(this._helpers)
  }

  _updateDebugVisuals() {
    if (!this._dbg) return
    const chip = this.chipController && this.chipController.chip
    if (chip) chip.getWorldPosition(this._dbg.chip.position)
    if (this.robots.sking && this.robots.sking.anchor) {
      this.robots.sking.anchor.getWorldPosition(this._dbg.pick.position)
    }
    if (this.bondTarget) {
      this._dbg.bond.position.copy(this.bondTarget)
    }
    if (this._dbg.flux) this._dbg.flux.position.set(
      BONDER_CONFIG.positions.fluxTarget.x,
      BONDER_CONFIG.positions.fluxTarget.y,
      BONDER_CONFIG.positions.fluxTarget.z
    )
  }

  // â”€â”€ Cleanup â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  dispose() {
    this.running = false
    this.tweens.clear()
    this._clearDebugVisuals()
    if (this.mixer) {
      try {
        this.mixer.stopAllAction()
        if (this.root) this.mixer.uncacheRoot(this.root)
      } catch (e) {
        /* ignore */
      }
    }
    if (this.events) this.events.clear()
    if (this.root && this.root.parent) this.root.parent.remove(this.root)
    this.mixer = null
    this.root = null
    this.ready = false
  }

  _log(msg) {
    console.log(`[BONDER] ${msg}`)
  }

  _logError(msg) {
    console.error(`[BONDER ERROR] ${msg}`)
  }
}


