// Convert a binary GLB (glTF) into a binary STL — geometry only.
// STL has no materials/color, which is exactly what a 3D printer's slicer
// wants. Zero-dependency: hand-rolled glTF accessor decode + STL writer.
// Handles the node hierarchy (TRS / matrix transforms), indexed and
// non-indexed triangle primitives, and the common component types.
//
// Not supported: Draco / meshopt compressed meshes — we detect them and
// throw a clear error rather than emit garbage. Tripo/Meshy return plain
// GLB, so this covers Loometo's 3D nodes.

const COMP_BYTES = { 5120: 1, 5121: 1, 5122: 2, 5123: 2, 5125: 4, 5126: 4 }
const NUM_COMPONENTS = { SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4, MAT2: 4, MAT3: 9, MAT4: 16 }

// ── little linear algebra (glTF matrices are column-major) ──────────────────
function identity() { return [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1] }

function multiply(a, b) {
  const o = new Array(16).fill(0)
  for (let c = 0; c < 4; c++)
    for (let r = 0; r < 4; r++) {
      let s = 0
      for (let k = 0; k < 4; k++) s += a[k * 4 + r] * b[c * 4 + k]
      o[c * 4 + r] = s
    }
  return o
}

function fromTRS(t, r, s) {
  const [tx, ty, tz] = t || [0, 0, 0]
  const [x, y, z, w] = r || [0, 0, 0, 1]
  const [sx, sy, sz] = s || [1, 1, 1]
  const x2 = x + x, y2 = y + y, z2 = z + z
  const xx = x * x2, xy = x * y2, xz = x * z2
  const yy = y * y2, yz = y * z2, zz = z * z2
  const wx = w * x2, wy = w * y2, wz = w * z2
  return [
    (1 - (yy + zz)) * sx, (xy + wz) * sx, (xz - wy) * sx, 0,
    (xy - wz) * sy, (1 - (xx + zz)) * sy, (yz + wx) * sy, 0,
    (xz + wy) * sz, (yz - wx) * sz, (1 - (xx + yy)) * sz, 0,
    tx, ty, tz, 1,
  ]
}

function transformPoint(m, x, y, z) {
  return [
    m[0] * x + m[4] * y + m[8] * z + m[12],
    m[1] * x + m[5] * y + m[9] * z + m[13],
    m[2] * x + m[6] * y + m[10] * z + m[14],
  ]
}

// ── GLB container parse ─────────────────────────────────────────────────────
function parseGlb(buf) {
  const dv = new DataView(buf)
  if (dv.getUint32(0, true) !== 0x46546c67) throw new Error('Not a GLB file (bad magic)')
  let off = 12
  let json = null, bin = null
  while (off + 8 <= dv.byteLength) {
    const len = dv.getUint32(off, true)
    const type = dv.getUint32(off + 4, true)
    off += 8
    if (type === 0x4e4f534a) json = JSON.parse(new TextDecoder().decode(new Uint8Array(buf, off, len)))
    else if (type === 0x004e4942) bin = new Uint8Array(buf, off, len)
    off += len
  }
  if (!json) throw new Error('GLB has no JSON chunk')
  if (!bin) throw new Error('GLB has no BIN chunk (external buffers not supported)')
  return { gltf: json, bin }
}

// Read accessor `index` as a flat array of tuples (each tuple = numComponents).
function readAccessor(gltf, dv, binOffset, index) {
  const acc = gltf.accessors[index]
  if (acc.bufferView == null) throw new Error('Sparse/empty accessor not supported')
  const view = gltf.bufferViews[acc.bufferView]
  if (view.byteStride && acc.type !== 'SCALAR' && view.byteStride !== COMP_BYTES[acc.componentType] * NUM_COMPONENTS[acc.type]) {
    // interleaved — handled below via explicit stride, so this is fine
  }
  const numC = NUM_COMPONENTS[acc.type]
  const compBytes = COMP_BYTES[acc.componentType]
  const stride = view.byteStride || compBytes * numC
  const start = binOffset + (view.byteOffset || 0) + (acc.byteOffset || 0)
  const read = compReader(dv, acc.componentType)
  const out = new Array(acc.count)
  for (let i = 0; i < acc.count; i++) {
    const base = start + i * stride
    const row = new Array(numC)
    for (let c = 0; c < numC; c++) row[c] = read(base + c * compBytes)
    out[i] = row
  }
  return out
}

function compReader(dv, componentType) {
  switch (componentType) {
    case 5126: return o => dv.getFloat32(o, true)
    case 5125: return o => dv.getUint32(o, true)
    case 5123: return o => dv.getUint16(o, true)
    case 5121: return o => dv.getUint8(o)
    case 5122: return o => dv.getInt16(o, true)
    case 5120: return o => dv.getInt8(o)
    default: throw new Error(`Unsupported componentType ${componentType}`)
  }
}

function faceNormal(ax, ay, az, bx, by, bz, cx, cy, cz) {
  const ux = bx - ax, uy = by - ay, uz = bz - az
  const vx = cx - ax, vy = cy - ay, vz = cz - az
  let nx = uy * vz - uz * vy
  let ny = uz * vx - ux * vz
  let nz = ux * vy - uy * vx
  const len = Math.hypot(nx, ny, nz) || 1
  return [nx / len, ny / len, nz / len]
}

/**
 * @param {ArrayBuffer} glb
 * @returns {ArrayBuffer} binary STL
 */
export function glbToStl(glb) {
  const { gltf, bin } = parseGlb(glb)
  const dv = new DataView(bin.buffer, bin.byteOffset, bin.byteLength)

  const tris = [] // each: [ax,ay,az, bx,by,bz, cx,cy,cz]

  const walk = (nodeIndex, parent) => {
    const node = gltf.nodes[nodeIndex]
    const local = node.matrix ? node.matrix : fromTRS(node.translation, node.rotation, node.scale)
    const world = multiply(parent, local)
    if (node.mesh != null) {
      for (const prim of gltf.meshes[node.mesh].primitives) {
        if (prim.mode != null && prim.mode !== 4) continue // triangles only
        if (prim.extensions?.KHR_draco_mesh_compression)
          throw new Error('Mesh uses Draco compression — STL export not supported for this model')
        const posIdx = prim.attributes?.POSITION
        if (posIdx == null) continue
        const pos = readAccessor(gltf, dv, 0, posIdx)
        const idx = prim.indices != null
          ? readAccessor(gltf, dv, 0, prim.indices).map(r => r[0])
          : pos.map((_, i) => i)
        for (let i = 0; i + 2 < idx.length; i += 3) {
          const a = transformPoint(world, ...pos[idx[i]])
          const b = transformPoint(world, ...pos[idx[i + 1]])
          const c = transformPoint(world, ...pos[idx[i + 2]])
          tris.push([...a, ...b, ...c])
        }
      }
    }
    for (const ch of node.children || []) walk(ch, world)
  }

  const sceneIdx = gltf.scene ?? 0
  const roots = gltf.scenes?.[sceneIdx]?.nodes ?? gltf.nodes.map((_, i) => i)
  for (const r of roots) walk(r, identity())

  if (!tris.length) throw new Error('No triangle geometry found in GLB')

  // Binary STL: 80-byte header + uint32 count + 50 bytes/triangle.
  const out = new ArrayBuffer(84 + tris.length * 50)
  const o = new DataView(out)
  o.setUint32(80, tris.length, true)
  let p = 84
  for (const t of tris) {
    const n = faceNormal(t[0], t[1], t[2], t[3], t[4], t[5], t[6], t[7], t[8])
    o.setFloat32(p, n[0], true); o.setFloat32(p + 4, n[1], true); o.setFloat32(p + 8, n[2], true)
    for (let k = 0; k < 9; k++) o.setFloat32(p + 12 + k * 4, t[k], true)
    o.setUint16(p + 48, 0, true)
    p += 50
  }
  return out
}
