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
controller.running = true
controller.stateMachine.setRunning()

const chip = controller.chipController
const sking = controller.robots.sking
const col = controller.robots.colright
const tray = BONDER_CONFIG.positions.chipRest

function wv(obj) { const p = new THREE.Vector3(); obj.getWorldPosition(p); return p.toArray().map(v=>+v.toFixed(3)).join(',') }

console.log('=== BEFORE HANDOFF ===')
// Position for handoff
await controller._pickChip(controller.stateMachine, chip)
await controller._transferToFlip(controller.stateMachine, chip)
await controller._flip(controller.stateMachine, chip)

console.log('After flip:')
console.log('  chip world pos:', wv(chip.chip))
console.log('  chip parent:', chip.chip.parent?.name)
console.log('  sking.anchor:', sking.anchor?.name, wv(sking.anchor))
console.log('  col.anchor:', col.anchor?.name, wv(col.anchor))

// Now do the handoff steps manually up to the attach
const handoff = BONDER_CONFIG.positions.handoff
await controller._moveNodeAxis(sking.carriage, 'x', handoff.x, BONDER_CONFIG.handoff.duration)
await controller._moveNodeAxis(col.carriage, 'x', handoff.x, BONDER_CONFIG.handoff.duration)
const chipPos = controller._chipWorldPos()
const anchorY = chipPos.y + 0.08
await controller._moveNodeAxis(col.vertical, 'y', col.verticalYForAnchorY(anchorY), BONDER_CONFIG.movement.lowerDuration)

console.log('=== BEFORE attachToBond ===')
console.log('  chip world pos:', wv(chip.chip))
console.log('  chip parent:', chip.chip.parent?.name)
console.log('  col.anchor world pos:', wv(col.anchor))
console.log('  col.anchor world scale:', col.anchor.getWorldScale(new THREE.Vector3()).toArray().map(v=>+v.toFixed(3)).join(','))

const attached = chip.attachToBond()
console.log('=== AFTER attachToBond ===')
console.log('  attached:', attached)
console.log('  chip world pos:', wv(chip.chip))
console.log('  chip parent:', chip.chip.parent?.name)
console.log('  chip local z:', chip.chip.position.z.toFixed(3))

// My recenter code
if (chip.chip && chip.chip.parent === col.anchor) {
  console.log('  RECENTERING: setting local z = 0')
  chip.chip.position.z = 0
  chip.chip.updateMatrix()
  console.log('  chip world pos after recenter:', wv(chip.chip))
}

controller.dispose()
process.exit(0)