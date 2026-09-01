import * as THREE from 'three'
import { BonderController } from './_patched/lib/BonderController.js'
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
controller._registerChips()
controller._stripChipAnimation()

const { TwoRobotChipProcess } = await import('./_patched/lib/bonder/TwoRobotChipProcess.js')
const proc = new TwoRobotChipProcess(controller)
proc.findObjects()

const flipRest = proc.robot1FlipAxis.rotation.z
const chip = proc.chips[0]
const target = proc.getChipTarget(0)

const donePromise = proc.processChip(0)
const pump = () => {
  controller.update(0.1)
  controller.model.updateMatrixWorld(true)
}
const start = Date.now()
const timer = setInterval(pump, 100)
const timeout = setTimeout(() => { console.log('TIMEOUT'); process.exit(1) }, 60000)
await donePromise
clearInterval(timer)
clearTimeout(timeout)

let pass = 0
let fail = 0
const ok = (cond, msg, extra) => { if (cond) { pass++ } else { fail++; console.log('FAIL:', msg, extra ?? '') } }

const chipLocal = proc._localPosition(chip)
console.log(`chip final local = ${chipLocal.toArray().map((v) => +v.toFixed(3)).join(',')} target = ${target.toArray().map((v) => +v.toFixed(3)).join(',')}`)
ok(chip.parent !== proc.robot1Pickup && chip.parent !== proc.robot2Tip, `chip released from robots (parent=${chip.parent.name})`)
ok(chip.userData.owner === 'BOARD', `chip owner BOARD (${chip.userData.owner})`)
ok(Math.abs(chipLocal.x - target.x) < 0.02 && Math.abs(chipLocal.y - target.y) < 0.06, `chip placed on target (${Math.abs(chipLocal.x - target.x).toFixed(3)}, ${Math.abs(chipLocal.y - target.y).toFixed(3)})`)
ok(Math.abs(proc.robot1FlipAxis.rotation.z - flipRest - Math.PI) < 0.05, `flip axis rotated π (${proc.robot1FlipAxis.rotation.z.toFixed(3)} vs ${(flipRest + Math.PI).toFixed(3)})`)
ok(proc.attachedChip === null, 'no attached chip after place')
ok(proc.state === 'IDLE' || proc.currentChipIndex === 0, `state=${proc.state}`)
console.log(`\nRESULT: ${pass} passed, ${fail} failed (elapsed ${Date.now() - start}ms)`)

controller.dispose()
process.exit(fail ? 1 : 0)