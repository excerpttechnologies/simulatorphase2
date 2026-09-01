'use client'

import * as THREE from 'three'
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js'

import { TweenGroup, clamp } from './bonder/BonderUtils.js'
import { ChipController, CHIP_STATES } from './bonder/ChipController.js'
import { TwoRobotChipProcess } from './bonder/TwoRobotChipProcess.js'
import { BonderStateMachine } from './bonder/BonderStateMachine.js'
import { BonderEvents, BONDER_EVENTS } from './bonder/BonderEvents.js'
import { BONDER_CONFIG, BONDER_STAGE_IDS, BONDER_STAGE_LABELS, BONDER_STAGE_BY_ID } from './bonder/BonderConfig.js'
import { FlipStageController } from './bonder/FlipStageController.js'
import { FluxStationController } from './bonder/FluxStationController.js'
import { FluxStation } from './bonder/FluxStation.js'
import { AlignmentController } from './bonder/AlignmentController.js'
import { BondingController } from './bonder/BondingController.js'
import { ChipPlacementSequence } from './bonder/ChipPlacementSequence.js'
import { OutputWaferTransfer } from './bonder/OutputWaferTransfer.js'
import { BonderNarrationManager, getBonderNarration } from './bonder/BonderNarration.js'

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
    this.chipControllers = []
    this.currentChipIndex = -1
    this.totalChips = 6
    this.recipeProgress = 0
    this.fluxComplete = false
    this.flipStage = new FlipStageController(BONDER_CONFIG)
    this.fluxStation = new FluxStationController(BONDER_CONFIG)
    this.fluxStationVisual = null
    this.alignment = new AlignmentController(BONDER_CONFIG)
    this.bonding = new BondingController(BONDER_CONFIG)

    this.running = false
    this.paused = false
    this.speed = 1
    this.temperature = 80
    this.temperatureTarget = 80

    // Wafer transfer integration (Stage 1: Substrate Loading)
    this.bondTransfer = null
    this.recipeInProgress = false
    this.currentRecipePromise = null

    // Six-chip placement sequence
    this.chipPlacementSequence = null
    this.outputWaferTransfer = null
    this.processState = 'IDLE' // IDLE, WAFER_LOADING, CHIP_PLACEMENT, OUTPUT_TRANSFER, COMPLETE

    // State-driven narration manager
    this.bonderNarration = null

    // External references for output transfer
    this.externalRobot = null
    this.externalOutputRack = null
    this.externalModObjs = null

    // Named scene entities (populated during load).
    this.nodes = {}

    // Robot structures (calibrated at load).
    this.robots = {
      sking: null, // Robot 2: handoff, flux, and board placement
      colright: null, // Robot 1: pickup and flip
    }

    // Debug visualization.
    this.debugMode = false
    this._helpers = new THREE.Group()

    // Flags to let the render loop know to call update().
    this._bindUpdate = null

    // Narration system
    this.narration = null
    this._narrationInit = null
    this._narratedStages = new Set()

    // Initialize narration system
    this._initNarration()

    // Initialize state-driven narration manager
    this.bonderNarration = new BonderNarrationManager(this.narration)
  }

  async _initNarration() {
    if (typeof window !== 'undefined' && window.speechSynthesis) {
      try {
        // Dynamic import to avoid SSR issues
        const module = await import('./NarrationManager.ts')
        const NarrationManager = module.NarrationManager || module.default
        this.narration = new NarrationManager({
          rate: 0.95,
          pitch: 1.0,
          volume: 0.85,
        })
        console.log('[BONDER] Narration system initialized')
      } catch (err) {
        console.warn('[BONDER] Narration failed to load:', err)
      }
    }
  }

  // â”€â”€ Public state / events â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  on(event, handler) {
    return this.events.on(event, handler)
  }

  // ── External integration for output transfer ───────────────────────────────
  setOutputTransferReferences({ robot, outputRack, modObjs }) {
    this.externalRobot = robot
    this.externalOutputRack = outputRack
    this.externalModObjs = modObjs

    // Initialize output transfer controller
    this.outputWaferTransfer = new OutputWaferTransfer({
      scene: this.scene,
      robot: robot,
      getRobot: () => robot,
      outputRack: outputRack,
      onTransferComplete: () => {
        this._log('Output wafer transfer complete')
        this.processState = 'COMPLETE'
        this.events.emit(BONDER_EVENTS.OUTPUT_TRANSFER_COMPLETE)
      },
      onNarrate: (text) => {
        if (this.narration?.isEnabled) {
          this.narration.speak(text, 'normal')
        }
      },
      modObjs: modObjs,
      bonderController: this, // Pass reference for board access
    })

    this._log('Output transfer references configured')
  }

  startOutputTransfer(sourceWorld, destWorld) {
    if (!this.outputWaferTransfer) {
      this._logError('Output transfer not initialized')
      return false
    }
    this.processState = 'OUTPUT_TRANSFER'
    this.events.emit(BONDER_EVENTS.OUTPUT_TRANSFER_START)
    return this.outputWaferTransfer.start(sourceWorld, destWorld)
  }

  /** Update process state and trigger appropriate narration */
  _setProcessState(newState, chipIndex = null) {
    const oldState = this.processState
    this.processState = newState

    // Trigger state-driven narration
    if (this.bonderNarration) {
      this.bonderNarration.speakForState(newState, chipIndex)
    }

    this._log(`Process state: ${oldState} → ${newState}`)
  }

  /** Start the completed board transfer after all 6 chips are placed */
  _startCompletedBoardTransfer() {
    this._log('Starting completed board transfer sequence')

    // Get the completed board position (wafer/substrate on pedestal)
    const pedestalWorld = new THREE.Vector3()
    const pedestalNode = this._findNode('PEDESTAL', ['pedestal', 'substrate'])
    if (pedestalNode) {
      // Center the pickup position on the pedestal
      pedestalNode.updateMatrixWorld(true)
      const pedestalBox = new THREE.Box3().setFromObject(pedestalNode)
      const pedestalCenter = pedestalBox.getCenter(pedestalWorld)

      // Set pickup position at pedestal center with board height
      pedestalWorld.y = pedestalBox.max.y + 0.15 // Board height above pedestal top

      this._log('Completed board source (centered):', pedestalWorld)
      this._log('Pedestal center:', pedestalCenter)
    }

    // Get the output rack destination
    const destWorld = new THREE.Vector3()
    if (this.externalOutputRack && this.externalOutputRack.userData.pickupAnchor) {
      this.externalOutputRack.updateMatrixWorld(true)
      this.externalOutputRack.userData.pickupAnchor.getWorldPosition(destWorld)
    }

    this._log('Output rack destination:', destWorld)

    // Set process state to output transfer
    this._setProcessState('OUTPUT_TRANSFER')
    this.events.emit(BONDER_EVENTS.OUTPUT_TRANSFER_START)

    // Start output transfer with actual board reference
    this.startOutputTransfer(pedestalWorld, destWorld)
  }

  getStatus() {
    return {
      ...this.stateMachine.getStatus(),
      chip: this.currentChipIndex >= 0 && this.chipControllers[this.currentChipIndex]
        ? this.chipControllers[this.currentChipIndex].getStatus()
        : (this.chipController ? this.chipController.getStatus() : null),
      chips: this.chipControllers.map((controller) => controller.getStatus()),
      currentChipIndex: this.currentChipIndex,
      totalChips: this.totalChips,
      fluxComplete: this.fluxComplete,
      robots: {
        sking: this._getRobotStatus(this.robots.sking, ['carriage', 'flange', 'ring']),
        colright: this._getRobotStatus(this.robots.colright, ['carriage', 'vertical']),
      },
      ready: this.ready,
      temperature: this.temperature,
      temperatureTarget: this.temperatureTarget,
      running: this.running,
      paused: this.paused,
      speed: this.speed,
    }
  }

  _getRobotStatus(robot, axes) {
    if (!robot) return 'unknown'
    return {
      ready: true,
      axes: axes.reduce((state, axis) => {
        const node = robot[axis]
        if (!node) return state
        state[axis] = {
          x: node.position.x,
          y: node.position.y,
          z: node.position.z,
          rotationZ: node.rotation.z,
        }
        return state
      }, {}),
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

    // Add the physical central station in model-local coordinates so the
    // robot targets and the visual container share the same transform space.
    this.fluxStationVisual = new FluxStation(BONDER_CONFIG.flux)
    const fluxTarget = BONDER_CONFIG.positions.fluxTarget
    const fluxSurfaceY = this.fluxStationVisual.group.userData.fluxSurfaceY
    this.fluxStationVisual.group.position.set(
      fluxTarget.x,
      fluxTarget.y + BONDER_CONFIG.flux.approachHeight - (fluxSurfaceY + 0.34),
      fluxTarget.z
    )
    this.model.add(this.fluxStationVisual.group)

    // Fit/scale/center the whole model (visual presentation only). All process
    // math stays in model-local space, so the visual scaling is irrelevant to it.
    this._fitModel()

    // Build the physical chip controller from the ACTIVE_CHIP node.
    // Its "scene" is the (scaled) model root so chip placement/verification is
    // performed in model-local coordinates.
    this._registerChips()

    // Strip the baked ACTIVE_CHIP animation so the physical chip controller wins.
    this._stripChipAnimation()

    // Companion two-robot process (COLRIGHT pick/flip + SKING handoff/flux/board).
    // Reuses this controller's calibrated robots, tween engine and chip state.
    this.twoRobot = new TwoRobotChipProcess(this)
    this.twoRobot.findObjects()

    // Initialize six-chip placement sequence
    this.chipPlacementSequence = new ChipPlacementSequence({
      scene: this.scene,
      bonderController: this,
      onChipComplete: (chipIndex) => {
        this._log(`Chip ${chipIndex + 1} placement complete`)
        this.events.emit(BONDER_EVENTS.CHIP_PLACED, { chipIndex })
      },
      onSequenceComplete: () => {
        this._log('All 6 chips placed, starting output transfer')
        this.processState = 'OUTPUT_TRANSFER'
        this.events.emit(BONDER_EVENTS.CHIP_SEQUENCE_COMPLETE)
      },
      onNarrate: (text) => {
        if (this.narration?.isEnabled) {
          this.narration.speak(text, 'normal')
        }
      },
    })

    // Listen for wafer placement complete to start chip sequence
    this.events.on(BONDER_EVENTS.PLACEMENT_VERIFIED, () => {
      if (this.chipPlacementSequence && this.processState === 'IDLE') {
        this.processState = 'CHIP_PLACEMENT'
        this.chipPlacementSequence.start()
      }
    })

    // Listen for chip sequence complete to start output transfer
    this.events.on(BONDER_EVENTS.CHIP_SEQUENCE_COMPLETE, () => {
      this._log('Chip sequence complete, preparing to pick completed board')
      if (this.outputWaferTransfer && this.externalRobot && this.externalOutputRack) {
        this._startCompletedBoardTransfer()
      }
    })

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

  _findNode(exactName, keywords = []) {
    if (this.nodes[exactName]) return this.nodes[exactName]
    const normalize = (value) => String(value || '').toLowerCase().replace(/[^a-z0-9]/g, '')
    const exact = normalize(exactName)
    const exactMatch = Object.entries(this.nodes).find(([name]) => normalize(name) === exact)
    if (exactMatch) return exactMatch[1]
    const terms = keywords.map(normalize).filter(Boolean)
    const keywordMatch = Object.entries(this.nodes).find(([name]) => {
      const normalized = normalize(name)
      return terms.length > 0 && terms.every((term) => normalized.includes(term))
    })
    return keywordMatch ? keywordMatch[1] : null
  }

  _registerChips() {
    const activeChip = this._getActiveChipObject()
    if (activeChip) activeChip.visible = false
    const chipNodes = Array.from({ length: this.totalChips }, (_, index) =>
      this._findNode(`CHIP_0${index + 1}`, ['chip', String(index + 1)])
    ).filter(Boolean)
    const nodes = chipNodes.length === this.totalChips ? chipNodes : (activeChip ? [activeChip] : [])
    this.chipControllers = nodes.map((chip) => {
      const controller = new ChipController(this.model, null)
      controller.setBus(this.events)
      controller.registerChip(chip)
      controller.setHoldTargets(this.robots.colright.anchor, this.robots.sking.nozzle || this.robots.sking.anchor)
      controller.setTray(this.nodes.WAFER || this.root)
      return controller
    })
    this.chipController = this.chipControllers[0] || null
    this.totalChips = this.chipControllers.length
    if (this.totalChips !== 6) this._logError(`EXPECTED 6 CHIPS, FOUND ${this.totalChips}`)
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
    const skingCarriage = this._findNode('SKING_CARRIAGE', ['sking', 'carriage'])
    const skingFlange = this._findNode('SKING_SERVO_FLANGE', ['sking', 'flange'])
    const skingRing = this._findNode('SKING_ROTARY_BEARING_RING', ['sking', 'bearing', 'ring'])
    const skingAnchor = this._findNode('SKING_ARM_TIP_ANCHOR', ['sking', 'tip', 'anchor'])
    const skingNozzle = this._findNode('SKING_PICKUP_NOZZLE', ['sking', 'pickup', 'nozzle'])
    const skingFlipAxis = this._findNode('SKING_FLIP_AXIS', ['sking', 'flip', 'axis'])
    const skingRails = [
      this._findNode('SKING_LINEAR_RAIL', ['sking', 'linear', 'rail']),
      this._findNode('SKING_RAIL_BACK', ['sking', 'rail', 'back']),
      skingFlipAxis,
    ]

    const colCarriage = this._findNode('COLRIGHT_CARRIAGE', ['colright', 'carriage'])
    const colVerticalAxis = this._findNode('COLRIGHT_VERTICAL_AXIS', ['colright', 'vertical', 'axis'])
    const colServoFlange = this._findNode('COLRIGHT_SERVO_FLANGE', ['colright', 'servo', 'flange'])
    const colAnchor = this._findNode('COLRIGHT_PICKUP_POINT', ['colright', 'pickup', 'point']) ||
      this._findNode('COLRIGHT_ARM_TIP_ANCHOR', ['colright', 'tip', 'anchor'])
    const isAncestor = (ancestor, descendant) => {
      let current = descendant
      while (current) {
        if (current === ancestor) return true
        current = current.parent
      }
      return false
    }
    const colVertical = [colVerticalAxis, colServoFlange].find((candidate) => isAncestor(candidate, colAnchor)) ||
      colVerticalAxis || colServoFlange
    const colJawA = this._findNode('COLRIGHT_GRIPPER_JAW_A', ['colright', 'gripper', 'jaw', 'a'])
    const colJawB = this._findNode('COLRIGHT_GRIPPER_JAW_B', ['colright', 'gripper', 'jaw', 'b'])
    const colRails = [
      this._findNode('COLRIGHT_RAIL', ['colright', 'rail']),
      this._findNode('COLRIGHT_RAIL2', ['colright', 'rail2']),
      this._findNode('COLRIGHT_BASE', ['colright', 'base']),
    ]

    // The ACTIVE chip's authored plane. Both tools AND the substrate are
    // relocated onto this same plane so a true physical handoff/bond can occur.
    const workingZ = BONDER_CONFIG.positions.chipRest.z
    const toModelLocal = (object, target) => {
      if (!object) return target
      object.getWorldPosition(target)
      return this.model ? this.model.worldToLocal(target) : target
    }

    // â”€â”€ SKING (Robot A / pickup-flip) â”€â”€
    const nozzlePos = new THREE.Vector3()
    const carriagePos = new THREE.Vector3()
    toModelLocal(skingNozzle, nozzlePos)
    toModelLocal(skingCarriage, carriagePos)

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
    toModelLocal(colAnchor, colAnchorRest)
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
    const bondBase = this._findNode('BondBase', ['bond', 'base'])
    const bondBaseTarget = this._findNode('BONDBASE_TARGET', ['bondbase', 'target'])
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
      flipAxis: skingFlipAxis,
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
      flipAxis: colServoFlange || colVertical,
      anchor: colAnchor,
      jawA: colJawA,
      jawB: colJawB,
      kCol,
      colCarriageY,
      zOffset: colZOffset,
      anchorRest: colAnchorRest.clone(),
      verticalYForAnchorY: (anchorWorldY) => anchorWorldY + kCol - colCarriageY,
    }

    this._captureHomes()
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
      const stage = BONDER_STAGE_BY_ID[this.stateMachine.currentStage]
      this.temperatureTarget = stage ? stage.temperature : 80
      const rate = Math.max(1, Math.abs(this.temperatureTarget - this.temperature) / 1.5)
      const delta = rate * deltaSeconds
      if (Math.abs(this.temperatureTarget - this.temperature) <= delta) this.temperature = this.temperatureTarget
      else this.temperature += Math.sign(this.temperatureTarget - this.temperature) * delta
    }
    if (this.mixer) this.mixer.update(deltaSeconds)

    // Update chip placement sequence
    if (this.chipPlacementSequence) {
      this.chipPlacementSequence.update(deltaSeconds)
    }

    // Update output transfer
    if (this.outputWaferTransfer) {
      this.outputWaferTransfer.update(deltaSeconds)
    }

    if (this.debugMode) {
      this._updateDebugVisuals()
    }
    // Nothing else needed: the chip is a child of the active tool and follows it.
  }

  // â”€â”€ Controls â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  setSpeed(k) {
    this.speed = clamp(k, 0.1, 10)

    // Handle narration based on speed change
    if (this.narration) {
      if (k > 1) {
        // High speed: disable narration
        this.narration.setEnabled(false)
      } else if (k === 1) {
        // Normal speed: re-enable narration
        this.narration.setEnabled(true)
        // Clear tracking for current and future stages so they can be narrated
        const currentStage = this.stateMachine.currentStage
        for (let i = currentStage; i <= 17; i++) {
          this._narratedStages.delete(`${i}-stage`)
        }
      }
    }
  }

  setNarrationEnabled(enabled) {
    if (this.narration) {
      this.narration.setEnabled(enabled)
    }
  }

  isNarrationEnabled() {
    return this.narration ? this.narration.isEnabled() : false
  }

  setNarrationVolume(v) {
    if (this.narration) {
      this.narration.setVolume(v)
    }
  }

  setNarrationRate(r) {
    if (this.narration) {
      this.narration.setRate(r)
    }
  }

  pause() {
    if (!this.running) return
    this.paused = true
    this.stateMachine.pause()

    // Pause wafer transfer
    if (this.bondTransfer) {
      this.bondTransfer.pause()
    }

    // Pause chip placement sequence
    if (this.chipPlacementSequence) {
      this.chipPlacementSequence.pause()
    }

    // Pause output transfer
    if (this.outputWaferTransfer) {
      this.outputWaferTransfer.pause()
    }

    // Announce pause
    if (this.narration?.isEnabled()) {
      this.narration.speak('Process paused.', 'high')
    }
  }

  resume() {
    if (!this.paused) return
    this.paused = false
    this.stateMachine.resume()

    // Resume wafer transfer
    if (this.bondTransfer) {
      this.bondTransfer.resume()
    }

    // Resume chip placement sequence
    if (this.chipPlacementSequence) {
      this.chipPlacementSequence.resume()
    }

    // Resume output transfer
    if (this.outputWaferTransfer) {
      this.outputWaferTransfer.resume()
    }

    // Announce resume
    if (this.narration?.isEnabled()) {
      this.narration.speak('Process resumed.', 'high')
    }
  }

  /**
   * Full reset — restores every mechanism, the chip, and all flags to initial
   * conditions so the recipe can run again from the beginning.
   */
  reset() {
    this.running = false
    this.paused = false

    if (this.twoRobot) {
      this.twoRobot.reset().catch((error) => this._logError(`TWO-ROBOT RESET FAILED: ${error.message}`))
    }

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
    this.chipControllers.forEach((controller) => controller.restoreToTray())
    this.currentChipIndex = -1
    this.recipeProgress = 0
    this.fluxComplete = false
    this.stateMachine.progressOverride = 0

    // Reset chip placement sequence
    if (this.chipPlacementSequence) {
      this.chipPlacementSequence.reset()
    }

    // Reset output transfer
    if (this.outputWaferTransfer) {
      this.outputWaferTransfer.reset()
    }

    // Reset process state
    this.processState = 'IDLE'

    // Reset narration
    this._narratedStages.clear()
    if (this.narration) {
      this.narration.reset()
      this.narration.speak('Flip chip bonder reset. Ready to start.', 'high')
    }

    // Reset bonder narration manager
    if (this.bonderNarration) {
      this.bonderNarration.reset()
    }

    // Restore robots to calibrated home.
    this._resetRobotsToHome()

    // Restore stations.
    this.flipStage.reset()
    this.fluxStation.reset()
    this.alignment.reset()
    this.bonding.reset()

    this.stateMachine.reset()
    this.temperature = 80
    this.temperatureTarget = 80
    this._log('RESET COMPLETE â€” READY TO RUN AGAIN')
  }

  _resetRobotsToHome() {
    const sking = this.robots.sking
    if (sking) {
      if (sking.carriage && this._skingHomeX !== undefined) sking.carriage.position.x = this._skingHomeX
      if (sking.flange && this._skingFlangeHome !== undefined) sking.flange.position.y = this._skingFlangeHome
      if (sking.ring) sking.ring.rotation.z = 0
    }
    const col = this.robots.colright
    if (col) {
      if (col.carriage && this._colHomeX !== undefined) col.carriage.position.x = this._colHomeX
      if (col.vertical && this._colVerticalHome !== undefined) col.vertical.position.y = this._colVerticalHome
      if (col.ring && this._colRingHome !== undefined) col.ring.rotation.z = this._colRingHome
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
      if (col.ring) this._colRingHome = col.ring.rotation.z
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
    this._prepareChips()
    this._captureHomes()

    // Clear narration tracking for new run
    this._narratedStages.clear()

    // Announce process start
    if (this.narration?.isEnabled()) {
      this.narration.speak('Flip chip bonding process initiated. Beginning substrate loading and die attachment sequence.', 'high')
    }

    // Run the two-robot process through the shared motion helpers.
    this.runTwoRobotRecipe().then(
      () => {
        this.running = false
      },
      (err) => {
        this.running = false
        this.stateMachine.fail(err && err.message ? err.message : String(err))
      }
    )
  }

  /**
   * Run the two-robot chip process (COLRIGHT picks/flips, SKING does the
   * handoff, per-chip flux dip and board placement).
   */
  async runTwoRobotRecipe() {
    if (!this.twoRobot) {
      this.twoRobot = new TwoRobotChipProcess(this)
      this.twoRobot.findObjects()
    }
    if (this.running) return { success: false, reason: 'BUSY' }
    if (this.stateMachine.status === 'complete') await this.resetTwoRobot()
    this.running = true
    this.stateMachine.setRunning()
    try {
      await this.twoRobot.runSixChips()
      this.running = false
      this.stateMachine.status = 'complete'
      this.events.emit(BONDER_EVENTS.PROCESS_COMPLETE, { chips: this.twoRobot.chips.length })

      // Announce process completion
      if (this.narration?.isEnabled()) {
        this.narration.speak('Flip chip bonding process complete. All six dies have been successfully attached to the substrate.', 'high')
      }

      return { success: true }
    } catch (err) {
      this.running = false
      this.stateMachine.fail(err && err.message ? err.message : String(err))
      return { success: false, reason: err && err.message ? err.message : String(err) }
    }
  }

  /** Reset the two-robot process (chips to tray, both mechanisms to home). */
  async resetTwoRobot() {
    if (this.twoRobot) await this.twoRobot.reset()
  }

  _prepareChip() {
    this._prepareChips()
  }

  _prepareChips() {
    this.chipControllers.forEach((controller) => {
      controller.setHoldTargets(this.robots.colright.anchor, this.robots.sking.nozzle || this.robots.sking.anchor)
      controller.setTray(this.nodes.WAFER || this.root)
    })
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

  async _runSixChipRecipe() {
    const stageTracker = { completeStage: () => true }
    const placedTargets = this._getChipTargets()
    if (this.chipControllers.length !== 6) throw new Error('SIX_CHIPS_REQUIRED')

    for (let index = 0; index < this.chipControllers.length; index += 1) {
      this.currentChipIndex = index
      const chip = this.chipControllers[index]
      this._setProcessStage(BONDER_STAGE_IDS.DIE_EJECTION)
      await this._pickChip(stageTracker, chip)
      this._setProcessStage(BONDER_STAGE_IDS.PICK_LIFT)
      this._setProcessStage(BONDER_STAGE_IDS.TRANSFER_PEDESTAL)
      await this._transferToFlip(stageTracker, chip)
      this._setProcessStage(BONDER_STAGE_IDS.FLIP_180)
      if (!(await this._flip(stageTracker, chip))) throw new Error(`FLIP_FAILED_CHIP_${index + 1}`)
      this._setProcessStage(BONDER_STAGE_IDS.HEAD_TO_PEDESTAL)
      await this._handoff(stageTracker, chip)
      this._setProcessStage(BONDER_STAGE_IDS.HEAD_PICKS_DIE)
      this._setProcessStage(BONDER_STAGE_IDS.MOVE_TO_BOND_SITE)
      await this._moveToBond(stageTracker, chip)
      this._setProcessStage(BONDER_STAGE_IDS.TOUCHDOWN_PREHEAT)
      await this._bond(stageTracker, chip)
      if (!await this._releaseChip(stageTracker, chip, placedTargets[index])) {
        throw new Error(`PLACEMENT_FAILED_CHIP_${index + 1}`)
      }
      this._setProcessStage(BONDER_STAGE_IDS.RELEASE_RETRACT)
      this._setProcessStage(BONDER_STAGE_IDS.INDEX_NEXT_SITE)
      this.recipeProgress = (index + 1) / this.totalChips
      await this._retract(stageTracker, chip)
    }

    this._setProcessStage(BONDER_STAGE_IDS.COMPLETE)
    this._log('SIX CHIPS COMPLETE')
    await this._runPostPlacementFlux()
    this.fluxComplete = true
    this.recipeProgress = 1
    this.stateMachine.status = 'complete'
    this.events.emit(BONDER_EVENTS.PROCESS_COMPLETE, { chips: this.totalChips })
    return { success: true, chips: this.totalChips, flux: true }
  }

  _setProcessStage(stageId) {
    this.stateMachine.currentStage = stageId
    this.stateMachine.phase = BONDER_STAGE_LABELS[stageId]
    this.stateMachine.progressOverride = this.recipeProgress * 100
    this.events.emit(BONDER_EVENTS.STAGE_CHANGE, { stageId, label: this.stateMachine.phase })

    // Narration for stage change
    this._narrateStageChange(stageId)
  }

  async _narrateStageChange(stageId) {
    if (!this.narration?.isEnabled()) return

    const stageKey = `${stageId}-stage`
    if (this._narratedStages.has(stageKey)) return
    this._narratedStages.add(stageKey)

    try {
      const module = await import('./bonder/narrationScripts.js')
      const getBonderStepNarration = module.getBonderStepNarration || module.default
      const script = getBonderStepNarration(stageId)
      this.narration.speak(script.starting, 'normal')
    } catch (err) {
      console.warn('[BONDER] Failed to load narration script:', err)
    }
  }

  _getChipTargets() {
    const target = this.bondTarget.clone()
    const base = this._findNode('BondBase', ['bond', 'base'])
    const bounds = base ? new THREE.Box3().setFromObject(base) : null
    let size = new THREE.Vector3(0.6, 0, 0.74)
    if (bounds && this.model) {
      const min = this.model.worldToLocal(bounds.min.clone())
      const max = this.model.worldToLocal(bounds.max.clone())
      size = max.sub(min)
      size.set(Math.abs(size.x), Math.abs(size.y), Math.abs(size.z))
    }
    const spacingX = Math.min(0.18, size.x / 4)
    const spacingZ = Math.min(0.18, size.z / 3)
    const targets = []
    for (let row = 0; row < 2; row += 1) {
      for (let column = 0; column < 3; column += 1) {
        targets.push(new THREE.Vector3(
          target.x + (column - 1) * spacingX,
          target.y,
          target.z + (row - 0.5) * spacingZ
        ))
      }
    }
    return targets
  }

  async _runPostPlacementFlux() {
    const robot2 = this.robots.sking
    const flux = BONDER_CONFIG.positions.fluxTarget
    this._setProcessStage(BONDER_STAGE_IDS.FLUX_DIP)
    this.fluxStation.begin()
    await this._moveNodeAxis(robot2.carriage, 'x', flux.x, BONDER_CONFIG.movement.travelDuration)
    await this._moveNodeAxis(robot2.flange, 'y', robot2.flangeYForTipY(flux.y + BONDER_CONFIG.flux.dipDepth), BONDER_CONFIG.flux.dipDuration)
    await this._sleep(BONDER_CONFIG.flux.dwellDuration)
    if (!this.fluxStation.completeDip(true)) throw new Error('FLUX_DIP_FAILED')
    await this._moveNodeAxis(robot2.flange, 'y', robot2.flangeYForTipY(flux.y + BONDER_CONFIG.flux.approachHeight), BONDER_CONFIG.flux.retractDuration)
    this._setProcessStage(BONDER_STAGE_IDS.COMPLETE)
    this._log('FLUX COMPLETE')
  }

  _chipWorldPos(controller = this.chipController) {
    const c = controller && controller.chip
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

    const robot1 = this.robots.colright
    const tray = chip.restTransform
      ? chip.restTransform.position.clone()
      : BONDER_CONFIG.positions.chipRest
    const flange = robot1.vertical

    // Move carriage over the chip.
    await this._moveNodeAxis(robot1.carriage, 'x', tray.x, BONDER_CONFIG.movement.travelDuration)

    const maxRetries = BONDER_CONFIG.pickup.maxRetries
    let verified = false

    for (let retries = 0; retries <= maxRetries; retries++) {
      // Approach â€” raise tool to clear height.
      const approachTipY = tray.y + BONDER_CONFIG.pickup.approachHeight
      await this._moveNodeAxis(flange, 'y', robot1.verticalYForAnchorY(approachTipY), BONDER_CONFIG.movement.lowerDuration)

      // Lower to contact â€” nozzle tip at chip top.
      await this._moveNodeAxis(flange, 'y', robot1.verticalYForAnchorY(tray.y), BONDER_CONFIG.movement.lowerDuration)

      // Contact the chip: vacuum on + attach.
      chip.pickup.vacuum = true
      this._log('VACUUM ON')
      const attached = chip.attachToPickup()

      // Verify against the NOZZLE tip (the actual contact point), not the
      // arm-tip anchor which is located far above the nozzle.
      let contactPoint = null
      if (robot1.anchor) {
        contactPoint = new THREE.Vector3()
        robot1.anchor.getWorldPosition(contactPoint)
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
        await this._moveNodeAxis(flange, 'y', robot1.verticalYForAnchorY(approachTipY), BONDER_CONFIG.movement.liftDuration)
        await this._sleep(BONDER_CONFIG.movement.defaultDuration * 0.3)
      }
    }

    // Mark pick stages only now that the operation has actually completed.
    sm.completeStage(BONDER_STAGE_IDS.PICK_CHIP, null)
    sm.completeStage(BONDER_STAGE_IDS.VERIFY_PICK, verified ? null : 'PICKUP_FAILED_MAX_RETRIES')

    if (!verified) throw new Error('PICKUP_FAILED_MAX_RETRIES')

    // Lift chip â€” raise the tool (chip follows as a child).
    const liftTipY = tray.y + BONDER_CONFIG.pickup.approachHeight
    await this._moveNodeAxis(flange, 'y', robot1.verticalYForAnchorY(liftTipY), BONDER_CONFIG.movement.liftDuration)
    this._log('LIFTING CHIP')
  }

  // â”€â”€ TRANSFER â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  async _transferToFlip(sm, chip) {
    this._log('TRANSFER TO FLIP STAGE')
    // Carry the attached chip to the flip area (centre-ish for the flip operation).
    const robot1 = this.robots.colright
    const flipX = this._flipX()
    await this._moveNodeAxis(robot1.carriage, 'x', flipX, BONDER_CONFIG.movement.transferDuration)
  }

  // â”€â”€ FLIP â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  async _flip(sm, chip) {
    this._log('FLIP START')
    const robot1 = this.robots.colright
    const ring = robot1.ring
    if (!ring) {
      // No flip ring â€” fallback: rotate the pickup anchor group.
      return this._proceduralFlipFallback(robot1, chip)
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

  async _proceduralFlipFallback(robot1, chip) {
    // Rotate the pickup anchor itself.
    const anchor = robot1.anchor
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
    const robot1 = this.robots.colright
    const robot2 = this.robots.sking
    const handoff = BONDER_CONFIG.positions.handoff

    // Robot A carries the flipped chip to the handoff X.
    await this._moveNodeAxis(robot1.carriage, 'x', handoff.x, BONDER_CONFIG.handoff.duration)

    // Robot B travels to the handoff X (on its rail).
    await this._moveNodeAxis(robot2.carriage, 'x', handoff.x, BONDER_CONFIG.handoff.duration)

    // Robot B lowers its gripper to the chip.
    const chipPos = this._chipWorldPos(chip)

    // Log world positions for debugging rotated pickup
    console.log('[HANDOFF] Chip world position after flip:', chipPos)
    console.log('[HANDOFF] Robot2 flange position:', robot2.flange.position)
    console.log('[HANDOFF] Robot2 carriage position:', robot2.carriage.position)

    const anchorY = chipPos.y + 0.08
    await this._moveNodeAxis(robot2.flange, 'y', robot2.flangeYForTipY(anchorY), BONDER_CONFIG.movement.lowerDuration)

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
    if (chip.chip && chip.chip.parent === chip.bondHold) {
      const colAnchor = chip.bondHold
      colAnchor.updateWorldMatrix(true, false)
      const anchorWorldPos = new THREE.Vector3()
      colAnchor.getWorldPosition(anchorWorldPos)

      // Preserve world X,Y but set Z to the anchor's world Z (working plane).
      const desiredWorldPos = new THREE.Vector3()
      chip.chip.getWorldPosition(desiredWorldPos)
      desiredWorldPos.z = anchorWorldPos.z

      // Log final attachment position
      console.log('[HANDOFF] Attaching chip at world position:', desiredWorldPos)
      console.log('[HANDOFF] Anchor world position:', anchorWorldPos)

      // Convert desired world position to local space of the anchor.
      const parentWorldInv = new THREE.Matrix4().copy(colAnchor.matrixWorld).invert()
      const localPos = desiredWorldPos.clone().applyMatrix4(parentWorldInv)
      chip.chip.position.copy(localPos)
      chip.chip.updateMatrix()
    }

    // Open jaws (visual grip) — close A slightly.
    this._closeJaws(robot2, 0.012, 0.5)

    this._log('CHIP HANDED TO BOND HEAD')

    // Robot A retracts away from the handoff zone.
    await this._moveNodeAxis(robot1.carriage, 'x', this._colHomeX ?? robot1.carriage.position.x, BONDER_CONFIG.movement.travelDuration)
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
    const robot2 = this.robots.sking
    const flux = BONDER_CONFIG.positions.fluxTarget
    this.fluxStation.begin()

    // Move over the flux station.
    await this._moveNodeAxis(robot2.carriage, 'x', flux.x, BONDER_CONFIG.movement.travelDuration)

    // Lower into flux.
    const dipAnchorY = BONDER_CONFIG.positions.fluxTarget.y + BONDER_CONFIG.flux.dipDepth
    await this._moveNodeAxis(robot2.flange, 'y', robot2.flangeYForTipY(dipAnchorY), BONDER_CONFIG.flux.dipDuration)
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
    await this._moveNodeAxis(robot2.flange, 'y', robot2.flangeYForTipY(retractAnchorY), BONDER_CONFIG.flux.retractDuration)
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
    const robot2 = this.robots.sking
    await this._moveNodeAxis(robot2.carriage, 'x', this.bondTarget.x, BONDER_CONFIG.movement.travelDuration)
  }

  async _bond(sm, chip) {
    const robot2 = this.robots.sking
    this.bonding.begin()
    this._log('BOND START')

    // Lower chip onto the substrate.
    const contactAnchorY = this.bondTarget.y + BONDER_CONFIG.bonding.contactHeight
    await this._moveNodeAxis(robot2.flange, 'y', robot2.flangeYForTipY(contactAnchorY), BONDER_CONFIG.bonding.descentDuration)
    this.bonding.markTouchdown()

    // Dwell (apply+hold, visual).
    await this._sleep(BONDER_CONFIG.bonding.dwellDuration)
    this.bonding.markBond()
    this._log('BOND APPLIED')
  }

  async _releaseChip(sm, chip, target = this.bondTarget) {
    this._log('RELEASING CHIP')
    // Place at the exact bond position and detach.
    const placePos = target.clone()
    const placed = chip.placeChip(placePos)
    if (!placed) return false
    chip.setState(CHIP_STATES.BONDED)

    // Vacuum off.
    chip.pickup.vacuum = false
    chip.pickup.chipAttached = false

    // Open jaws.
    const robot2 = this.robots.sking
    if (robot2.jawA && robot2.jawB) {
      robot2.jawA.rotation.y = 0
      robot2.jawB.rotation.y = 0
    }

    this._log('CHIP RELEASED')
    return true
  }

  async _retract(sm, chip) {
    const robot2 = this.robots.sking
    const retractAnchorY = BONDER_CONFIG.positions.bondTarget.y + BONDER_CONFIG.bonding.approachHeight
    await this._moveNodeAxis(robot2.flange, 'y', robot2.flangeYForTipY(retractAnchorY), BONDER_CONFIG.movement.liftDuration)
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
    } else {
      this._clearDebugVisuals()
    }
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

  /**
   * Register the wafer transfer system for Stage 1 execution
   * @param {WaferBonderTransfer} transfer - The EFEM robot transfer system
   */
  setBondTransfer(transfer) {
    this.bondTransfer = transfer
    
    if (transfer) {
      // Connect logging to bonder's log system
      transfer.log = (msg) => this._log(`[Transfer] ${msg}`)
      this._log('WaferBonderTransfer registered for Stage 1')
    } else {
      this._log('WaferBonderTransfer unregistered')
    }
  }

  _log(msg) {
    console.log(`[BONDER] ${msg}`)
  }

  _logError(msg) {
    console.error(`[BONDER ERROR] ${msg}`)
  }

  _logWarn(msg) {
    console.warn(`[BONDER WARN] ${msg}`)
  }

  // ── Async Helper Methods (Task 1.2) ────────────────────────────────────────

  /**
   * Wait for an async condition to become true
   * Polls condition each animation frame until true or timeout
   * @param {Function} condition - Function returning boolean when condition met
   * @param {number} timeout - Maximum wait time in milliseconds
   * @param {string} errorMessage - Error message if timeout occurs
   * @returns {Promise<void>}
   * @throws {Error} If timeout expires
   * @private
   */
  async _waitForState(condition, timeout = 10000, errorMessage = 'Wait timeout') {
    const startTime = performance.now()
    
    return new Promise((resolve, reject) => {
      const check = () => {
        // Check if paused
        if (this.paused) {
          // Keep waiting while paused
          requestAnimationFrame(check)
          return
        }
        
        // Check condition
        if (condition()) {
          resolve()
        } else if (performance.now() - startTime > timeout) {
          const elapsed = ((performance.now() - startTime) / 1000).toFixed(2)
          reject(new Error(`${errorMessage} (${elapsed}s)`))
        } else {
          requestAnimationFrame(check)
        }
      }
      
      check()
    })
  }

  /**
   * Delay execution for specified duration
   * Respects pause state - continues counting only when not paused
   * @param {number} ms - Delay duration in milliseconds
   * @returns {Promise<void>}
   * @private
   */
  async _delay(ms) {
    let elapsed = 0
    const startTime = performance.now()
    
    return new Promise((resolve) => {
      const check = () => {
        if (!this.paused) {
          elapsed = performance.now() - startTime
        }
        
        if (elapsed >= ms) {
          resolve()
        } else {
          requestAnimationFrame(check)
        }
      }
      
      check()
    })
  }

  // ── Position Calculation Methods (Task 1.3) ────────────────────────────────

  /**
   * Calculate wafer rack source position from 3D model geometry
   * Searches for wafer rack node in scene, uses fallback if not found
   * @returns {THREE.Vector3} World space position of wafer rack slot
   * @private
   */
  _calculateRackPosition() {
    // Try to find wafer rack in scene
    // Note: Rack may be separate GLB, not in flip_chip_bonder.glb
    const rackNode = this.scene.getObjectByName('WAFER_RACK') ||
                     this.scene.getObjectByName('RACK') ||
                     this.scene.getObjectByName('FOUP')
    
    if (rackNode) {
      const pos = new THREE.Vector3()
      rackNode.getWorldPosition(pos)
      
      // Add offset to specific slot (e.g., slot 5 of 25)
      // Typical FOUP has 25 slots, ~6mm spacing
      const slotIndex = 5
      const slotSpacing = 0.006 // 6mm in meters
      pos.y += slotIndex * slotSpacing
      
      this._log(`  Found rack node: ${rackNode.name}`)
      return pos
    }
    
    // Fallback: Use known approximate position from system layout
    this._logWarn('  Rack node not found, using fallback position')
    return new THREE.Vector3(-14, 3.35, 0) // Left side, elevated
  }

  /**
   * Calculate bonder pedestal destination position from 3D model geometry
   * @returns {THREE.Vector3} World space position of pedestal working plane
   * @private
   */
  _calculatePedestalPosition() {
    // Search for pedestal node (multiple possible names)
    const pedestal = this.nodes.PEDESTAL ||
                     this.nodes.RING_VACUUM_PEDESTAL ||
                     this.nodes.SKING_PEDESTAL ||
                     this.nodes.SUBSTRATE_STAGE
    
    if (pedestal) {
      // Update world matrix for accurate bounding box
      pedestal.updateMatrixWorld(true)

      // Calculate pedestal center using Box3
      const pedestalBox = new THREE.Box3().setFromObject(pedestal)
      const pos = pedestalBox.getCenter(new THREE.Vector3())

      // Set Y to top of pedestal plus working height
      pos.y = pedestalBox.max.y + 0.15 // Working height above pedestal

      this._log(`  Found pedestal node: ${pedestal.name}`)
      this._log(`  Pedestal center: ${pos.x.toFixed(3)}, ${pos.y.toFixed(3)}, ${pos.z.toFixed(3)}`)
      return pos
    }
    
    // Fallback: Use known position from bonder geometry
    this._logWarn('  Pedestal node not found, using fallback position')
    return new THREE.Vector3(0, 0.5, 0) // Center of bonder, elevated
  }

  /**
   * Execute Stage 1: Substrate Loading
   * Uses WaferBonderTransfer to animate EFEM robot transferring wafer from rack to pedestal
   * Calculates positions from 3D geometry, starts transfer, waits for completion
   * @returns {Promise<void>}
   * @throws {Error} If bondTransfer not registered or transfer fails
   */
  async runStage01_SubstrateLoading() {
    this._log('>>> Stage 1: Substrate Loading')
    
    // Validate bondTransfer is configured
    if (!this.bondTransfer) {
      this._logError('bondTransfer not configured, cannot execute Stage 1')
      throw new Error('WaferBonderTransfer not registered')
    }
    
    // Update state machine
    this.stateMachine.startStage(1)
    const stageStartTime = performance.now()
    
    try {
      // Calculate source (rack) and destination (pedestal) positions
      const sourceWorld = this._calculateRackPosition()
      const destWorld = this._calculatePedestalPosition()
      
      this._log(`  Rack position: (${sourceWorld.x.toFixed(2)}, ${sourceWorld.y.toFixed(2)}, ${sourceWorld.z.toFixed(2)})`)
      this._log(`  Pedestal position: (${destWorld.x.toFixed(2)}, ${destWorld.y.toFixed(2)}, ${destWorld.z.toFixed(2)})`)
      
      // Start wafer transfer
      const started = this.bondTransfer.start(sourceWorld, destWorld)
      if (!started) {
        throw new Error('Failed to start wafer transfer')
      }
      
      this._log('  EFEM robot transferring wafer...')
      
      // Wait for transfer completion (with timeout)
      await this._waitForState(
        () => {
          const status = this.bondTransfer.getStatus()
          return status.state === 'DONE'
        },
        15000, // 15 second timeout
        'Wafer transfer timeout'
      )
      
      // Mark stage complete
      const duration = performance.now() - stageStartTime
      this.stateMachine.completeStage(1)
      this._log(`  Stage 1 complete (${(duration / 1000).toFixed(2)}s)`)
      
      this.events.emit(BONDER_EVENTS.STAGE_COMPLETE, {
        stageId: 1,
        timestamp: performance.now(),
        duration: duration
      })
      
    } catch (err) {
      this._logError(`Stage 1 failed: ${err.message}`)
      this.stateMachine.fail(`Stage 1: ${err.message}`)
      throw err
    }
  }

  /**
   * Execute Stage 2: Wafer Fiducial Scan
   * Placeholder implementation - logs and completes immediately
   * Future: Could trigger camera scan animation
   * @returns {Promise<void>}
   */
  async runStage02_FiducialScan() {
    this._log('>>> Stage 2: Wafer Fiducial Scan')
    
    this.stateMachine.startStage(2)
    const stageStartTime = performance.now()
    
    try {
      // Placeholder: Simulate scan duration
      this._log('  Scanning fiducial marks... (placeholder)')
      await this._delay(500) // 500ms simulated scan
      
      this._log('  Fiducials detected, alignment data acquired')
      
      // Mark stage complete
      const duration = performance.now() - stageStartTime
      this.stateMachine.completeStage(2)
      this._log(`  Stage 2 complete (${(duration / 1000).toFixed(2)}s)`)
      
      this.events.emit(BONDER_EVENTS.STAGE_COMPLETE, {
        stageId: 2,
        timestamp: performance.now(),
        duration: duration
      })
      
    } catch (err) {
      this._logError(`Stage 2 failed: ${err.message}`)
      this.stateMachine.fail(`Stage 2: ${err.message}`)
      throw err
    }
  }

  /**
   * Execute the complete 17-stage flip-chip bonding recipe
   * Orchestrates wafer loading (Stage 1), fiducial scan (Stage 2),
   * and chip bonding process (Stages 3-17)
   * @returns {Promise<void>}
   * @throws {Error} If any stage fails
   */
  async runFullRecipe() {
    if (this.recipeInProgress) {
      this._logWarn('Recipe already in progress')
      return
    }
    
    this.recipeInProgress = true
    this.stateMachine.start()
    
    try {
      this._log('=== Starting Full Recipe (17 Stages) ===')
      
      // Stage 1: Substrate Loading (EFEM wafer transfer)
      await this.runStage01_SubstrateLoading()
      
      // Stage 2: Wafer Fiducial Scan (placeholder)
      await this.runStage02_FiducialScan()
      
      // Stages 3-17: Two-robot chip bonding process
      await this.runTwoRobotRecipe()
      
      this._log('=== Recipe Complete ===')
      this.stateMachine.complete()
      this.events.emit(BONDER_EVENTS.RECIPE_COMPLETE)
      
    } catch (err) {
      this._logError(`Recipe failed: ${err.message}`)
      this.stateMachine.fail(err.message)
      throw err
      
    } finally {
      this.recipeInProgress = false
    }
  }
}

