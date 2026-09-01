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

let pass = 0
let fail = 0
const ok = (cond, msg, extra) => { if (cond) { pass++ } else { fail++; console.log('FAIL:', msg, extra ?? '') } }

ok(!!proc.robot1, 'robot1 (COLRIGHT_CARRIAGE) found')
ok(!!proc.robot1Vertical, 'robot1 vertical lift found')
ok(!!proc.robot1Pickup, 'robot1 pickup point found')
ok(!!proc.robot1FlipAxis, 'robot1 flip axis found')
ok(!!proc.robot2, 'robot2 (SKING_MOUNT_BRACKET_VAXIS) found')
ok(!!proc.robot2Tip, 'robot2 tip (SKING_ARM_TIP_ANCHOR) found')
ok(!!proc.board, 'board found')
ok(!!proc.boardTarget, 'board target found')
ok(proc.chips.length === 6, `six chips found (${proc.chips.length})`)

const p = (cal) => ({ rest: +cal.rest.toFixed(3), gain: +cal.gain.toFixed(3), dir: cal.dir.toArray().map((v) => +v.toFixed(3)).join(',') })
console.log('cal1.X=', JSON.stringify(p(proc.robot1Reach.X)))
console.log('cal1.Y=', JSON.stringify(p(proc.robot1Reach.Y)))
console.log('cal2.X=', JSON.stringify(p(proc.robot2Reach.X)))
console.log('cal2.Y=', JSON.stringify(p(proc.robot2Reach.Y)))
ok(proc.robot1Reach.X.gain > 0.5 && proc.robot1Reach.X.gain < 1.5, `r1 carriage X gain sane (${proc.robot1Reach.X.gain.toFixed(3)})`)
ok(proc.robot2Reach.X.gain > 0.5 && proc.robot2Reach.X.gain < 1.5, `r2 bracket X gain sane (${proc.robot2Reach.X.gain.toFixed(3)})`)
ok(proc.robot2Reach.Y.gain > 0.5 && proc.robot2Reach.Y.gain < 1.5, `r2 bracket Y gain sane (${proc.robot2Reach.Y.gain.toFixed(3)})`)
ok(proc.robot1Reach.Y.gain > 0.5 && proc.robot1Reach.Y.gain < 3, `r1 flange Y gain sane (${proc.robot1Reach.Y.gain.toFixed(3)})`)

const targets = [0, 1, 2, 3, 4, 5].map((i) => proc.getChipTarget(i))
ok(targets.length === 6, 'six board targets')
ok(targets.every((t) => Number.isFinite(t.x) && Number.isFinite(t.y) && Number.isFinite(t.z)), 'targets finite')

const setTip1 = (t) => {
  proc.robot1.position.x = proc._axisFor(proc.robot1Reach.X, t)
  proc.robot1Vertical.position.y = proc._axisFor(proc.robot1Reach.Y, t)
  proc._updateWorld()
}

const chip = proc.chips[0]
const chipLocal = proc._chipLocalPos(chip)

setTip1(chipLocal)
const tip1 = proc._localPosition(proc.robot1Pickup)
console.log('r1 tip after axisFor =', tip1.toArray().map((v) => +v.toFixed(4)).join(','), 'target=', chipLocal.toArray().map((v) => +v.toFixed(4)).join(','))
const xy = (v) => new THREE.Vector2(v.x, v.y)
ok(xy(tip1).distanceTo(xy(chipLocal)) < 1e-3, `r1 tip X/Y lands on chip top (${xy(tip1).distanceTo(xy(chipLocal)).toExponential(2)})`)

proc.robot2.position.x = proc._axisFor(proc.robot2Reach.X, chipLocal)
proc.robot2.position.y = proc._axisFor(proc.robot2Reach.Y, chipLocal)
proc._updateWorld()
const tip2 = proc._localPosition(proc.robot2Tip)
console.log('r2 tip after axisFor =', tip2.toArray().map((v) => +v.toFixed(4)).join(','), 'target=', chipLocal.toArray().map((v) => +v.toFixed(4)).join(','))
ok(xy(tip2).distanceTo(xy(chipLocal)) < 1e-3, `r2 tip X/Y lands on target (${xy(tip2).distanceTo(xy(chipLocal)).toExponential(2)})`)

// Chip reparent helpers preserve world transforms; chip follows gantry X
const before = proc._localPosition(chip).clone()
proc.attachToRobot1(chip)
const after = proc._localPosition(chip)
ok(before.distanceTo(after) < 1e-3, `attach preserves world pos (${before.distanceTo(after).toExponential(2)})`)
ok(chip.parent === proc.robot1Pickup, 'chip parented under robot1 pickup')

proc.robot1.position.x += 5
proc._updateWorld()
const moved = proc._localPosition(chip)
ok(Math.abs(moved.x - before.x - 5) < 1e-2, `chip follows robot1 gantry (${(moved.x - before.x).toFixed(3)} vs 5)`)
proc.robot1.position.x -= 5
proc._updateWorld()

console.log(`\nRESULT: ${pass} passed, ${fail} failed`)
controller.dispose()
process.exit(fail ? 1 : 0)