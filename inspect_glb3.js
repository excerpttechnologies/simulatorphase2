const fs = require('fs');
function parse(b){const totalLen=b.readUInt32LE(8);let o=12;const c=[];while(o<totalLen){const l=b.readUInt32LE(o);const t=b.toString('ascii',o+4,o+8);c.push({t,data:b.slice(o+8,o+8+l)});o+=8+l;}return c;}
const gltf=JSON.parse(parse(fs.readFileSync('public/flip_chip_bonder.glb')).find(c=>c.t==='JSON').data.toString('utf8'));
const nodes=gltf.nodes;
// Build parent map from scene children
const parentMap={};
const kids={};
function addChildren(idx){
  const n=nodes[idx];
  (n.children||[]).forEach(c=>{ parentMap[c]=idx; (kids[idx]=kids[idx]||[]).push(c); addChildren(c); });
}
(addChildren(0)) // dummy
gltf.scenes[0].nodes.forEach(addChildren);
// compute world translate/rotate scale
function worldMatrix(idx){
  const n=nodes[idx];
  const m=[1,0,0,0,0,1,0,0,0,0,1,0,0,0,0,1];
  function mulVec(v){
    return [
      m[0]*v[0]+m[4]*v[1]+m[8]*v[2]+m[12],
      m[1]*v[0]+m[5]*v[1]+m[9]*v[2]+m[13],
      m[2]*v[0]+m[6]*v[1]+m[10]*v[2]+m[14]
    ];
  }
  // apply local then parent (simplified: compose)
  function localMatrix(i){
    const nd=nodes[i];
    const t=nd.translation||[0,0,0], s=nd.scale||[1,1,1];
    let r=[1,0,0,0, 0,1,0,0, 0,0,1,0, 0,0,0,1];
    if(nd.rotation){const [x,y,z,w]=nd.rotation;
      r=[1-2*(y*y+z*z),2*(x*y-z*w),2*(x*z+y*w),0,
         2*(x*y+z*w),1-2*(x*x+z*z),2*(y*z-x*w),0,
         2*(x*z-y*w),2*(y*z+x*w),1-2*(x*x+y*y),0,0,0,0,1];
    }
    const mt=[s[0],0,0,0, 0,s[1],0,0, 0,0,s[2],0, t[0],t[1],t[2],1];
    return matmul(mt,r);
  }
  function matmul(a,b){
    const o=new Array(16).fill(0);
    for(let col=0;col<4;col++)for(let row=0;row<4;row++){
      let s=0;for(let k=0;k<4;k++)s+=a[k*4+row]*b[col*4+k];o[col*4+row]=s;
    }
    return o;
  }
  function forward(i,acc){
    const lm=localMatrix(i);
    const composed=matmul(acc,lm); // parent * local
    if(parentMap[i]!==undefined) return forward(parentMap[i], composed);
    return {m:composed, lm};
  }
  const wm=forward(idx,[1,0,0,0,0,1,0,0,0,0,1,0,0,0,0,1]).m;
  const pos=[wm[12],wm[13],wm[14]];
  return pos;
}
const keys=['SKING_PICKUP_NOZZLE','SKING_ARM_TIP_ANCHOR','SKING_FLIP_AXIS','SKING_CARRIAGE','SKING_ROTARY_BEARING_RING','COLRIGHT_CARRIAGE','COLRIGHT_VERTICAL_AXIS','COLRIGHT_GRIPPER_JAW_A','ACTIVE_CHIP','CHIP_01','CHIP_13','BONDBASE_TARGET','BondBase','WAFER','COLRIGHT_GRIPPER_JAW_B'];
const idxByName={};
nodes.forEach((n,i)=>{ if(n.name) idxByName[n.name]=i; });
keys.forEach(k=>{
  const i=idxByName[k];
  if(i===undefined){console.log(k,'NOT FOUND');return;}
  console.log(k.padEnd(26), 'world=', worldMatrix(i).map(v=>v.toFixed(3)).join(','));
});
