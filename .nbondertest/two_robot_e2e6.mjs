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

const donePromise = proc.runSixChips()
const pump = () => {
  controller.update(0.5)
  controller.model.updateMatrixWorld(true)
}
const start = Date.now()
const timer = setInterval(pump, 100)
const timeout = setTimeout(() => { console.log('TIMEOUT'); process.exit(1) }, 180000)
await donePromise
clearInterval(timer)
clearTimeout(timeout)

let pass = 0
let fail = 0
const ok = (cond, msg, extra) => { if (cond) { pass++ } else { fail++; console.log('FAIL:', msg, extra ?? '') } }

for (let i = 0; i < 6; i += 1) {
  const chip = proc.chips[i]
  const target = proc.getChipTarget(i)
  const local = proc._localPosition(chip)
  ok(chip.userData.owner === 'BOARD', `chip${i + 1} owner BOARD (${chip.userData.owner})`)
  ok(Math.abs(local.x - target.x) < 0.02 && Math.abs(local.y - target.y) < 0.06, `chip${i + 1} placed (${local.toArray().map((v) => +v.toFixed(3)).join(',')} vs ${target.toArray().map((v) => +v.toFixed(3)).join(',')})`)
  console.log(`chip${i + 1} at ${local.toArray().map((v) => +v.toFixed(3)).join(',')}`)
}
ok(proc.state === 'SIX_CHIPS_COMPLETE', `state=${proc.state}`)
console.log(`\nRESULT: ${pass} passed, ${fail} failed (elapsed ${((Date.now() - start) / 1000).toFixed(1)}s)`)

controller.dispose()
process.exit(fail ? 1 : 0)