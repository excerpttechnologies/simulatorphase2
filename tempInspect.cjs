const THREE = require("three");
const { GLTFLoader } = require("three/examples/jsm/loaders/GLTFLoader.js");
const fs = require("fs");
const loader = new GLTFLoader();
const data = fs.readFileSync("public/flip_chip_bonder.glb");
loader.parse(data.buffer, "", (gltf) => {
  const scene = gltf.scene;
  scene.updateMatrixWorld(true);
  const names = ["SKING_CARRIAGE","SKING_SERVO_FLANGE","SKING_SERVO_MOTOR","SKING_ROTARY_JOINT_BASE","SKING_ROTARY_BEARING_RING","SKING_ARM_TIP_ANCHOR","SKING_PICKUP_NOZZLE","ACTIVE_CHIP","BondBase","BONDBASE_TARGET","COLRIGHT_CARRIAGE","COLRIGHT_ARM_TIP_ANCHOR","COLRIGHT_GRIPPER_JAW_A","WAFER","SKING_FLIP_AXIS"];
  const byName = {};
  scene.traverse(o => { if (o.name && !byName[o.name]) byName[o.name] = o; });
  for (const n of names) {
    const o = byName[n];
    if (!o) { console.log(n.padEnd(28), "NOT FOUND"); continue; }
    const p = new THREE.Vector3(); o.getWorldPosition(p);
    const q = new THREE.Quaternion(); o.getWorldQuaternion(q);
    const e = new THREE.Euler().setFromQuaternion(q, "XYZ");
    console.log(n.padEnd(28), "pos=", p.toArray().map(v=>v.toFixed(3)).join(","), " rot(deg)=", e.x*180/Math.PI.toFixed? (e.x*180/Math.PI).toFixed(1)+","+(e.y*180/Math.PI).toFixed(1)+","+(e.z*180/Math.PI).toFixed(1):"");
  }
}, (err)=>{console.log("ERR", err);});
