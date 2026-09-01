const fs = require('fs');
function parse(buffer) {
  const magic = buffer.readUInt32LE(0);
  const version = buffer.readUInt32LE(4);
  const totalLen = buffer.readUInt32LE(8);
  let offset = 12;
  const chunks = [];
  while (offset < totalLen) {
    const len = buffer.readUInt32LE(offset);
    const type = buffer.toString('ascii', offset + 4, offset + 8);
    const data = buffer.slice(offset + 8, offset + 8 + len);
    chunks.push({ type, data });
    offset += 8 + len;
  }
  return chunks;
}
const b = fs.readFileSync('public/flip_chip_bonder.glb');
const chunks = parse(b);
const jsonChunk = chunks.find(c => c.type === 'JSON');
const gltf = JSON.parse(jsonChunk.data.toString('utf8'));

console.log('=== GLTF TOP LEVEL KEYS ===');
console.log(Object.keys(gltf));

console.log('\n=== SCENES ===');
console.log(JSON.stringify(gltf.scenes));

console.log('\n=== NODES ===');
(gltf.nodes || []).forEach((n, i) => {
  console.log(i, JSON.stringify(n));
});

if (gltf.animations) {
  console.log('\n=== ANIMATIONS ===');
  gltf.animations.forEach((a, i) => {
    console.log(`\nANIM[${i}] name="${a.name}"`);
    (a.channels || []).forEach(ch => {
      const sampler = a.samplers[ch.sampler];
      const target = ch.target;
      const node = gltf.nodes[target.node];
      const inputAccessor = gltf.accessors[sampler.input];
      const outputAccessor = gltf.accessors[sampler.output];
      console.log(`  channel -> node[${target.node}] "${node ? node.name : '?'}" .${target.path} | sampler=${sampler.interpolation} | input(${inputAccessor.count} keys, ${inputAccessor.type}) | output(${outputAccessor.count}, ${outputAccessor.type})`);
    });
  });
}
