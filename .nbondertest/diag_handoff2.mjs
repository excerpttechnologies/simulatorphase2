import * as THREE from 'three'
import { BonderController } from './BonderController.js'
import { BONDER_CONFIG } from './bonder/BonderConfig.js'
console.table = () => {}

const scene = new THREE.Scene()
const controller = new BonderController(scene)

const fs = await import('fs')
const data = fs.readFileSync(new URL('../public/flip_chip_bonder.glb', import.meta.url))
const { GLTFLoader } = await import('three/examples/jsm/loaders/GLTFLoader.js')
const loader = new GLTFLoader()
const gltf = await new Promise((res, rej) => loader.parse(data.buffer, '', res, rej))
controller.root = gltf.scene
scene.add(controller.root)
controller.model = controller.root
controller.mixer = new THREE.AnimationMixer(controller.root)
controller.animations = gltf.animations
controller._discoverNodes(controller.root)
controller._calibrateRobots()
controller._fitModel()
controller.chipController = new (await import('./bonder/ChipController.js')).ChipController(controller.model, null)
controller.chipController.setBus(controller.events)
controller._stripChipAnimation()
controller.ready = true
controller._prepareChip()
controller._captureHomes()

const chip = controller.chipController
const sking = controller.robots.sking
const col = controller.robots.colright

function wv(obj) { const p = new THREE.Vector3(); obj.getWorldPosition(p); return p.toArray().map(v=>+v.toFixed(3)).join(',') }

// Set up the exact state at handoff manually
// 1. Move SKING carriage to handoff.x
sking.carriage.position.x = BONDER_CONFIG.positions.handoff.x
controller.model.updateMatrixWorld(true)
console.log('SKING carriage moved to handoff.x')

// 2. Move col carriage to handoff.x
col.carriage.position.x = BONDER_CONFIG.positions.handoff.x
controller.model.updateMatrixWorld(true)
console.log('COL carriage moved to handoff.x')

// 3. Move col vertical down to chip level
const chipPos = new THREE.Vector3()
chip.chip.getWorldPosition(chipPos)
console.log('Chip world pos before vertical move:', wv(chip.chip))
const anchorY = chipPos.y + 0.08
col.vertical.position.y = col.verticalYForAnchorY(anchorY)
controller.model.updateMatrixWorld(true)
console.log('COL vertical lowered, anchorY=', anchorY.toFixed(3))
console.log('col.anchor world pos:', wv(col.anchor))
console.log('chip world pos after vertical:', wv(chip.chip))

// 4. Now attach to bond
console.log('=== BEFORE attachToBond ===')
console.log('chip parent:', chip.chip.parent?.name)
console.log('col.anchor:', col.anchor?.name)

const attached = chip.attachToBond()
console.log('=== AFTER attachToBond ===')
console.log('attached:', attached)
console.log('chip world pos:', wv(chip.chip))
console.log('chip parent:', chip.chip.parent?.name)
console.log('chip local pos:', chip.chip.position.toArray().map(v=>+v.toFixed(3)).join(','))
console.log('col.anchor world pos:', wv(col.anchor))

// My recenter code
if (chip.chip && chip.chip.parent === col.anchor) {
  console.log('RECENTERING: setting local z = 0')
  chip.chip.position.z = 0
  chip.chip.updateMatrix()
  controller.model.updateMatrixWorld(true)
  console.log('chip world pos after recenter:', wv(chip.chip))
  console.log('chip local z:', chip.chip.position.z.toFixed(3))
} else {
  console.log('RECENTER CONDITION FALSE')
  console.log('  chip.chip exists:', !!chip.chip)
  console.log('  chip.parent:', chip.chip?.parent?.name)
  console.log('  col.anchor:', col.anchor?.name)
  console.log('  equal:', chip.chip?.parent === col.anchor)
}

controller.dispose()
process.exit(0)