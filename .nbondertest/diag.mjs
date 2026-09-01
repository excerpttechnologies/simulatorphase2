import * as THREE from 'three'
import { BonderController } from './BonderController.js'
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

const sking = controller.robots.sking
const chipObj = controller.chipController.chip
const config = (await import('./bonder/BonderConfig.js')).BONDER_CONFIG

function w(obj) { const p = new THREE.Vector3(); obj.getWorldPosition(p); return p.toArray().map(v=>+v.toFixed(3)).join(',') }

console.log('=== CALIBRATION CONSTANTS ===')
console.log('tipK=', sking.tipK.toFixed(4), 'skingCarriageY=', sking.skingCarriageY.toFixed(4), 'zOffset=', sking.zOffset.toFixed(4))
console.log('flangeRestLocal=', sking.flange.position.y.toFixed(4))

const trayY = config.positions.chipRest.y
console.log('chipRest local y=', trayY)
console.log('model scale=', controller.model.scale.x.toFixed(4))

const flangeTarget = sking.flangeYForTipY(trayY)
console.log('flangeYForTipY(chipY)=', flangeTarget.toFixed(4))

// set flange to contact target
sking.flange.position.y = flangeTarget
controller.model.updateMatrixWorld(true)
console.log('AFTER flange at contact:')
console.log('  nozzle=', w(sking.nozzle))
console.log('  anchor=', w(sking.anchor))
console.log('  chip  =', w(chipObj))
if (sking.carriage) { sking.carriage.position.x = config.positions.chipRest.x; controller.model.updateMatrixWorld(true); console.log('AFTER carriage x at chip x:'); console.log('  nozzle=', w(sking.nozzle), 'chip=', w(chipObj)); }

// Now what does verifyPickup measure?
const cp = new THREE.Vector3(); sking.anchor.getWorldPosition(cp)
const chp = new THREE.Vector3(); chipObj.getWorldPosition(chp)
console.log('distance chip->anchor=', chp.distanceTo(cp).toFixed(4), '(attachTolerance=0.06)')
const np = new THREE.Vector3(); sking.nozzle.getWorldPosition(np)
console.log('distance chip->nozzle=', chp.distanceTo(np).toFixed(4))
controller.dispose()
process.exit(0)
