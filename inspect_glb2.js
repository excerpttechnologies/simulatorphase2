const fs = require('fs');
function parse(buffer) {
  const totalLen = buffer.readUInt32LE(8);
  let offset = 12;
  const chunks = [];
  while (offset < totalLen) {
    const len = buffer.readUInt32LE(offset);
    const type = buffer.toString('ascii', offset + 4, offset + 8);
    chunks.push({ type, data: buffer.slice(offset + 8, offset + 8 + len) });
    offset += 8 + len;
  }
  return chunks;
}
const b = fs.readFileSync('public/flip_chip_bonder.glb');
const gltf = JSON.parse(parse(b).find(c=>c.type==='JSON').data.toString('utf8'));
const bin = parse(b).find(c=>c.type.startsWith('BIN')).data;

function readAccessor(idx) {
  const a = gltf.accessors[idx];
  const bv = a.bufferView!==undefined ? gltf.bufferViews[a.bufferView] : null;
  const compSize = { 5120:1,5121:1,5122:2,5123:2,5125:4,5126:4 }[a.componentType];
  const comps = { SCALAR:1, VEC2:2, VEC3:3, VEC4:4 }[a.type];
  const baseOff = bv ? bv.byteOffset : 0;
  const byteStride = bv && bv.byteStride ? bv.byteStride : (comps*compSize);
  const out = [];
  for (let i=0;i<a.count;i++){
    const off = baseOff + (a.byteOffset||0) + i*byteStride;
    const row=[];
    for (let c=0;c<comps;c++){
      if(a.componentType===5126) row.push(bin.readFloatLE(off+c*4));
      else if(a.componentType===5123) row.push(bin.readUInt16LE(off+c*2));
      else row.push(bin.readUInt8(off+c));
    }
    out.push(row);
  }
  return out;
}

function fmtArr(rows){ return rows.map(r=>r.map(v=>v.toFixed(2)).join(',')).join(' | '); }

(gltf.animations||[]).forEach((a,i)=>{
  console.log(`\n===== ANIM[${i}] "${a.name}" =====`);
  a.channels.forEach(ch=>{
    const s = a.samplers[ch.sampler];
    const times = readAccessor(s.input).map(r=>r[0]);
    const values = readAccessor(s.output);
    const node = gltf.nodes[ch.target.node];
    console.log(`  ${node.name} .${ch.target.path} (${s.interpolation})`);
    if (ch.target.path === 'translation') {
      const xs=values.map(v=>v[0]), ys=values.map(v=>v[1]), zs=values.map(v=>v[2]);
      console.log(`    tRange=[${times[0].toFixed(2)}..${times[times.length-1].toFixed(2)}] x:[${Math.min(...xs).toFixed(3)}..${Math.max(...xs).toFixed(3)}] y:[${Math.min(...ys).toFixed(3)}..${Math.max(...ys).toFixed(3)}] z:[${Math.min(...zs).toFixed(3)}..${Math.max(...zs).toFixed(3)}]`);
      console.log(`    first=${fmtArr([values[0]])} last=${fmtArr([values[values.length-1]])}`);
    } else if (ch.target.path === 'rotation') {
      console.log(`    first=${fmtArr([values[0]])} last=${fmtArr([values[values.length-1]])} count=${values.length}`);
    } else {
      console.log(`    first=${fmtArr([values[0]])} last=${fmtArr([values[values.length-1]])} count=${values.length}`);
    }
  });
});
