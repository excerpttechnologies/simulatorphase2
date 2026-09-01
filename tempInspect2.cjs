const THREE = require("three");
const { GLTFLoader } = require("three/examples/jsm/loaders/GLTFLoader.js");
const fs = require("fs");
const loader = new GLTFLoader();
const data = fs.readFileSync("public/flip_chip_bonder.glb");
loader.parse(data.buffer, "", (gltf) => {
  const scene = gltf.scene;
  scene.updateMatrixWorld(true);
  const byName = {};
  scene.traverse(o => { if (o.name && !byName[o.name]) byName[o.name] = o; });
  const flange = byName["SKING_SERVO_FLANGE"];
  const nozzle = byName["SKING_PICKUP_NOZZLE"];
  const anchor = byName["SKING_ARM_TIP_ANCHOR"];
  const chip = byName["ACTIVE_CHIP"];
  function show(label){
    const p=new THREE.Vector3(); nozzle.getWorldPosition(p);
    const a=new THREE.Vector3(); anchor.getWorldPosition(a);
    scene.updateMatrixWorld(true);
    console.log(label.padEnd(30), "nozzle=", p.toArray().map(v=>v.toFixed(3)).join(","), " anchor=", a.toArray().map(v=>v.toFixed(3)).join(","));
  }
  show("REST (flangeY="+flange.position.y.toFixed(3)+")");
  // move flange y by -0.3
  flange.position.y = flange.position.y - 0.3;
  show("flangeY-0.3");
  // Try moving flange z
  flange.position.y = -0.56; // reset
  flange.position.z = flange.position.z - 0.3;
  show("flangeZ-0.3");
  // Try moving carriage z
  const carriage = byName["SKING_CARRIAGE"];
  carriage.position.z = carriage.position.z - 0.3;
  show("carriageZ-0.3 (nozzle)");
}, (err)=>{console.log("ERR", err);});
