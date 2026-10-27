/* eslint-disable */
// CommonJS script — run with: node scripts/src/convert-step-to-glb.cjs
'use strict';

const fs = require('fs');
const path = require('path');

const STEP_PATH = path.resolve(__dirname, '../../attached_assets/DOBOT_MG400_1781179332321.stp');
const OUT_PATH  = path.resolve(__dirname, '../../artifacts/robot-control/public/mg400.glb');

async function main() {
  // Load wasm from the installed pnpm package
  const occtimportjs = require('occt-import-js');
  const occt = await occtimportjs();

  console.log('Reading STEP file …');
  const fileContent = fs.readFileSync(STEP_PATH);

  console.log('Tessellating (may take 20-60 s) …');
  const result = occt.ReadStepFile(fileContent, {
    linearDeflectionType: 'bounding_box_ratio',
    linearDeflection: 0.05,
    angularDeflection: 0.5,
  });

  if (!result.success) {
    console.error('STEP parse failed'); process.exit(1);
  }

  const meshes = result.meshes;
  console.log(`Parsed ${meshes.length} meshes`);

  // ── GLTF/GLB packing ──────────────────────────────────────────────────
  const buffers    = [];  // raw ArrayBuffers
  const accessors  = [];
  const bufViews   = [];
  const gltfMeshes = [];
  const nodes      = [];
  const materials  = [];
  const matMap     = new Map(); // colorKey → material index

  let byteOffset = 0;

  function addAccessor(array, compType, type, count) {
    const bytes = array.buffer instanceof ArrayBuffer ? array.buffer : array;
    const view = ArrayBuffer.isView(array) ? array : new Uint8Array(bytes);
    const buf  = Buffer.from(view.buffer, view.byteOffset, view.byteLength);
    buffers.push(buf);
    const bvIdx = bufViews.length;
    bufViews.push({ buffer: 0, byteOffset, byteLength: buf.byteLength });
    byteOffset += buf.byteLength;
    if (byteOffset % 4 !== 0) {
      const pad = 4 - (byteOffset % 4);
      buffers.push(Buffer.alloc(pad));
      bufViews[bvIdx].byteLength += pad;
      byteOffset += pad;
    }
    const aIdx = accessors.length;
    const acc  = { bufferView: bvIdx, componentType: compType, count, type };
    if (type !== 'SCALAR' || compType !== 5126) {
      // compute min/max for positions (required by spec)
      if (type === 'VEC3' && compType === 5126) {
        const f = new Float32Array(view.buffer, view.byteOffset, view.byteLength / 4);
        const min = [Infinity,Infinity,Infinity], max = [-Infinity,-Infinity,-Infinity];
        for (let i = 0; i < f.length; i += 3) {
          for (let j = 0; j < 3; j++) {
            if (f[i+j] < min[j]) min[j] = f[i+j];
            if (f[i+j] > max[j]) max[j] = f[i+j];
          }
        }
        acc.min = min; acc.max = max;
      }
    }
    accessors.push(acc);
    return aIdx;
  }

  function colorKey(c) { return `${(c[0]*255)|0}_${(c[1]*255)|0}_${(c[2]*255)|0}`; }

  function getMaterial(color) {
    const key = colorKey(color);
    if (matMap.has(key)) return matMap.get(key);
    const idx = materials.length;
    materials.push({
      pbrMetallicRoughness: {
        baseColorFactor: [color[0], color[1], color[2], 1.0],
        metallicFactor:  color[0] < 0.2 ? 0.72 : 0.18,
        roughnessFactor: color[0] < 0.2 ? 0.28 : 0.55,
      },
    });
    matMap.set(key, idx);
    return idx;
  }

  for (let mi = 0; mi < meshes.length; mi++) {
    const m = meshes[mi];
    if (!m.index || !m.attributes || !m.attributes.position) continue;

    const positions = new Float32Array(m.attributes.position.array);
    const indices   = m.index.bitCount === 32
      ? new Uint32Array(m.index.array)
      : new Uint16Array(m.index.array);

    const posAcc = addAccessor(positions, 5126 /* FLOAT */, 'VEC3', positions.length / 3);
    const idxCompType = indices instanceof Uint32Array ? 5125 : 5123;
    const idxAcc = addAccessor(indices, idxCompType, 'SCALAR', indices.length);

    const prim = {
      attributes: { POSITION: posAcc },
      indices: idxAcc,
      mode: 4, // TRIANGLES
    };

    if (m.attributes.normal) {
      const normals = new Float32Array(m.attributes.normal.array);
      prim.attributes.NORMAL = addAccessor(normals, 5126, 'VEC3', normals.length / 3);
    }

    const color = m.color || [0.7, 0.7, 0.7];
    prim.material = getMaterial(color);

    const meshIdx = gltfMeshes.length;
    gltfMeshes.push({ name: m.name || `mesh_${mi}`, primitives: [prim] });
    nodes.push({ mesh: meshIdx });

    if (mi % 10 === 0) process.stdout.write(`  mesh ${mi}/${meshes.length}\r`);
  }
  console.log(`\nPacked ${gltfMeshes.length} meshes`);

  // Binary buffer
  const binBuffer = Buffer.concat(buffers);

  // JSON
  const gltfJson = {
    asset: { version: '2.0', generator: 'convert-step-to-glb' },
    scene: 0,
    scenes: [{ nodes: nodes.map((_,i) => i) }],
    nodes,
    meshes: gltfMeshes,
    accessors,
    bufferViews: bufViews.map(bv => ({ ...bv })),
    buffers: [{ byteLength: binBuffer.byteLength }],
    materials,
  };

  const jsonStr  = JSON.stringify(gltfJson);
  let   jsonBuf  = Buffer.from(jsonStr, 'utf8');
  const jsonPad  = (4 - (jsonBuf.length % 4)) % 4;
  if (jsonPad) jsonBuf = Buffer.concat([jsonBuf, Buffer.alloc(jsonPad, 0x20)]);

  let binBuf = binBuffer;
  const binPad = (4 - (binBuf.length % 4)) % 4;
  if (binPad) binBuf = Buffer.concat([binBuf, Buffer.alloc(binPad)]);

  const totalLen = 12 + 8 + jsonBuf.length + 8 + binBuf.length;
  const header = Buffer.alloc(12);
  header.writeUInt32LE(0x46546C67, 0); // magic "glTF"
  header.writeUInt32LE(2, 4);          // version
  header.writeUInt32LE(totalLen, 8);

  const jsonChunkHeader = Buffer.alloc(8);
  jsonChunkHeader.writeUInt32LE(jsonBuf.length, 0);
  jsonChunkHeader.writeUInt32LE(0x4E4F534A, 4); // "JSON"

  const binChunkHeader = Buffer.alloc(8);
  binChunkHeader.writeUInt32LE(binBuf.length, 0);
  binChunkHeader.writeUInt32LE(0x004E4942, 4); // "BIN\0"

  const glb = Buffer.concat([header, jsonChunkHeader, jsonBuf, binChunkHeader, binBuf]);
  fs.writeFileSync(OUT_PATH, glb);
  console.log(`Wrote ${(glb.length / 1024 / 1024).toFixed(1)} MB → ${OUT_PATH}`);
}

main().catch(e => { console.error(e); process.exit(1); });
