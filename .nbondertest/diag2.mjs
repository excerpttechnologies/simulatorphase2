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
const tray = BONDER_CONFIG.positions.chipRest

function wv(obj) { const p = new THREE.Vector3(); obj.getWorldPosition(p); return p.toArray().map(v=>+v.toFixed(3)).join(',') }

console.log('model scale=', controller.model.scale.x.toFixed(3))
console.log('chip orig world=', wv(chip.chip), 'parent=', chip.chip.parent && chip.chip.parent.name)
console.log('pickupHold name=', chip.pickupHold && chip.pickupHold.name, 'bondHold=', chip.bondHold && chip.bondHold.name)
console.log('nozzle world before=', wv(sking.nozzle))
console.log('tray.x(local)=', tray.x, 'flangeYForTipY(tray.y)=', sking.flangeYForTipY(tray.y).toFixed(3))

// Manually move carriage to chip x and flange to contact, then update worlds
sking.carriage.position.x = tray.x
sking.flange.position.y = sking.flangeYForTipY(tray.y)
controller.model.updateMatrixWorld(true)

console.log('--- after positioning ---')
console.log('nozzle world=', wv(sking.nozzle), 'parent chain ok')
console.log('chip world  =', wv(chip.chip))
console.log('dist chip->nozzle=', chip.chip.getWorldPosition(new THREE.Vector3()).distanceTo(sking.nozzle.getWorldPosition(new THREE.Vector3())).toFixed(3))

const ok = chip.attachToPickup()
console.log('--- after attachToPickup ---')
console.log('ok=', ok, 'attachedTo=', chip.attachedTo)
console.log('chip parent=', chip.chip.parent && chip.chip.parent.name)
console.log('chip world now =', wv(chip.chip))
console.log('nozzle world   =', wv(sking.nozzle))
console.log('dist chip->nozzle=', chip.chip.getWorldPosition(new THREE.Vector3()).distanceTo(sking.nozzle.getWorldPosition(new THREE.Vector3())).toFixed(3))
console.log('verifyPickup=', chip.verifyPickup(sking.nozzle.getWorldPosition(new THREE.Vector3()), BONDER_CONFIG.pickup.attachTolerance))

controller.dispose()
process.exit(0)
