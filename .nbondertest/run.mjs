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

function w(obj) { const p = new THREE.Vector3(); obj.getWorldPosition(p); return p.toArray().map(v=>+v.toFixed(2)).join(',') }

controller.on('PICK_SUCCESS', () => console.log('  >> EVENT PICK_SUCCESS'))
controller.on('FLIP_COMPLETE', () => console.log('  >> EVENT FLIP_COMPLETE'))
controller.on('FLUX_DIP_COMPLETE', () => console.log('  >> EVENT FLUX_DIP_COMPLETE'))
controller.on('ALIGNMENT_COMPLETE', () => console.log('  >> EVENT ALIGNMENT_COMPLETE'))
controller.on('BOND_COMPLETE', () => console.log('  >> EVENT BOND_COMPLETE'))
controller.on('RELEASE_COMPLETE', () => console.log('  >> EVENT RELEASE_COMPLETE'))
controller.on('PLACEMENT_VERIFIED', () => console.log('  >> EVENT PLACEMENT_VERIFIED'))
controller.on('PROCESS_COMPLETE', () => console.log('  >> EVENT PROCESS_COMPLETE'))
controller.on('PROCESS_ERROR', (p) => console.log('  >> EVENT PROCESS_ERROR', p.message))

const done = controller._runRecipe().then(
  () => { console.log('[RUN] recipe RESOLVED success'); },
  (err) => { console.log('[RUN] recipe REJECTED:', err && err.message ? err.message : err); }
)

const dt = 1 / 60
for (let i = 0; i < 60 * 180; i++) {
  controller.update(dt)
  const st = controller.stateMachine
  if (i % 30 === 0) {
    console.log(`t=${(i*dt).toFixed(1)} stage=${st.phase} chip=${chip.state} attached=${chip.attachedTo} chipPos=${chip.chip?w(chip.chip):'-'} nozzleY=${sking.nozzle?+w(sking.nozzle).split(',')[1]:'-'}`)
  }
  if (st.status === 'complete' || st.status === 'error') { console.log('BREAK at t=', (i*dt).toFixed(1)); break; }
  await new Promise(r => setImmediate(r))
}
await done
console.log('FINAL status=', controller.stateMachine.status, 'error=', controller.stateMachine.error)
console.log('FINAL chip=', chip.getStatus())
controller.dispose()
process.exit(0)
