import * as THREE from 'three';

export const TAU = Math.PI * 2;
export const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
export const lerp = (a, b, t) => a + (b - a) * t;
export const smoothstep = (t) => t * t * (3 - 2 * t);
export const rand = (a = 1, b) => (b === undefined ? Math.random() * a : a + Math.random() * (b - a));
export const randInt = (a, b) => Math.floor(rand(a, b + 1));
export const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];
export const damp = (a, b, lambda, dt) => lerp(a, b, 1 - Math.exp(-lambda * dt));

/* ------------------------------------------------------------------ *
 * geometry helpers
 * ------------------------------------------------------------------ */

// Merges geometries that only carry position / normal / uv.
export function mergeGeos(geos) {
  const list = geos.map((g) => (g.index ? g.toNonIndexed() : g));
  let total = 0;
  for (const g of list) total += g.attributes.position.count;
  const pos = new Float32Array(total * 3);
  const nor = new Float32Array(total * 3);
  const uv = new Float32Array(total * 2);
  let o3 = 0, o2 = 0;
  for (const g of list) {
    const c = g.attributes.position.count;
    pos.set(g.attributes.position.array, o3);
    if (g.attributes.normal) nor.set(g.attributes.normal.array, o3);
    if (g.attributes.uv) uv.set(g.attributes.uv.array, o2);
    o3 += c * 3; o2 += c * 2;
  }
  const out = new THREE.BufferGeometry();
  out.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  out.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
  out.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  out.computeBoundingSphere();
  return out;
}

export function placed(geo, x = 0, y = 0, z = 0, rx = 0, ry = 0, rz = 0, sx = 1, sy = sx, sz = sx) {
  const m = new THREE.Matrix4();
  m.compose(
    new THREE.Vector3(x, y, z),
    new THREE.Quaternion().setFromEuler(new THREE.Euler(rx, ry, rz)),
    new THREE.Vector3(sx, sy, sz)
  );
  return geo.applyMatrix4(m);
}

// Tube along a curve with per-length radius and optional elliptical cross-section.
export function taperedTube(curve, segs, radiusFn, radial = 10, shape = null) {
  const frames = curve.computeFrenetFrames(segs, false);
  const pos = [], nor = [], uvs = [], idx = [];
  const P = new THREE.Vector3(), N = new THREE.Vector3(), B = new THREE.Vector3();
  const v = new THREE.Vector3(), n = new THREE.Vector3();
  for (let i = 0; i <= segs; i++) {
    const t = i / segs;
    curve.getPointAt(t, P);
    N.copy(frames.normals[i]); B.copy(frames.binormals[i]);
    const r = typeof radiusFn === 'function' ? radiusFn(t) : radiusFn;
    const sx = shape ? shape(t).x : 1;
    const sy = shape ? shape(t).y : 1;
    for (let j = 0; j <= radial; j++) {
      const a = (j / radial) * TAU;
      const c = Math.cos(a), s = Math.sin(a);
      v.set(P.x + r * (c * sx * N.x + s * sy * B.x),
            P.y + r * (c * sx * N.y + s * sy * B.y),
            P.z + r * (c * sx * N.z + s * sy * B.z));
      pos.push(v.x, v.y, v.z);
      n.set(c / sx * N.x + s / sy * B.x, c / sx * N.y + s / sy * B.y, c / sx * N.z + s / sy * B.z).normalize();
      nor.push(n.x, n.y, n.z);
      uvs.push(t, j / radial);
    }
  }
  for (let i = 0; i < segs; i++) {
    for (let j = 0; j < radial; j++) {
      const a = i * (radial + 1) + j, b = a + radial + 1;
      idx.push(a, b, a + 1, b, b + 1, a + 1);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  g.setIndex(idx);
  return g;
}

export function tubeBetween(a, b, r1, r2 = r1, radial = 10) {
  const dir = new THREE.Vector3().subVectors(b, a);
  const len = dir.length();
  const curve = new THREE.LineCurve3(new THREE.Vector3(0, 0, 0), new THREE.Vector3(0, len, 0));
  const geo = taperedTube(curve, 1, (t) => lerp(r1, r2, t), radial);
  const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir.clone().normalize());
  geo.applyQuaternion(q);
  geo.translate(a.x, a.y, a.z);
  return geo;
}

export function limbMesh(a, b, r1, r2, material, radial = 9) {
  const mesh = new THREE.Mesh(new THREE.CylinderGeometry(r2, r1, 1, radial, 1, false), material);
  mesh.userData.unit = true;
  placeLimb(mesh, a, b);
  return mesh;
}

// Positions a unit-height cylinder mesh between two points.
const _dir = new THREE.Vector3(), _mid = new THREE.Vector3(), _up = new THREE.Vector3(0, 1, 0);
const _q = new THREE.Quaternion();
export function placeLimb(mesh, a, b) {
  _dir.subVectors(b, a);
  const len = _dir.length();
  _mid.addVectors(a, b).multiplyScalar(0.5);
  mesh.position.copy(_mid);
  _q.setFromUnitVectors(_up, _dir.normalize());
  mesh.quaternion.copy(_q);
  mesh.scale.set(1, len, 1);
}

// Two-bone IK in the XY plane; knee always bends toward +X.
export function solveIK(hip, target, l1, l2, knee, ankle) {
  const dx = target.x - hip.x, dy = target.y - hip.y;
  const raw = Math.hypot(dx, dy) || 1e-5;
  const d = clamp(raw, Math.abs(l1 - l2) + 1e-3, l1 + l2 - 1e-3);
  const ux = dx / raw, uy = dy / raw;
  const a = (l1 * l1 - l2 * l2 + d * d) / (2 * d);
  const h = Math.sqrt(Math.max(0, l1 * l1 - a * a));
  let px = -uy, py = ux;
  if (px < 0) { px = -px; py = -py; }
  knee.set(hip.x + ux * a + px * h, hip.y + uy * a + py * h, hip.z);
  ankle.set(hip.x + ux * d, hip.y + uy * d, target.z);
}

// Flat ribbon strip used for the scarf; positions are rewritten every frame.
export function ribbonGeometry(segs) {
  const g = new THREE.BufferGeometry();
  const count = (segs + 1) * 2;
  g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(count * 3), 3));
  g.setAttribute('normal', new THREE.BufferAttribute(new Float32Array(count * 3), 3));
  const uv = new Float32Array(count * 2);
  const idx = [];
  for (let i = 0; i <= segs; i++) {
    uv[i * 4] = i / segs; uv[i * 4 + 1] = 0;
    uv[i * 4 + 2] = i / segs; uv[i * 4 + 3] = 1;
    if (i < segs) {
      const a = i * 2;
      idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
    }
  }
  g.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  g.setIndex(idx);
  return g;
}

export function shadows(root, cast = true, receive = false) {
  root.traverse((o) => { if (o.isMesh) { o.castShadow = cast; o.receiveShadow = receive; } });
  return root;
}

/* ------------------------------------------------------------------ *
 * procedural textures — everything is generated locally, no downloads
 * ------------------------------------------------------------------ */

export function canvasTexture(w, h, draw, opts = {}) {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  const ctx = c.getContext('2d');
  draw(ctx, w, h);
  const tex = new THREE.CanvasTexture(c);
  tex.wrapS = tex.wrapT = opts.wrap ?? THREE.RepeatWrapping;
  if (opts.repeat) tex.repeat.set(opts.repeat[0], opts.repeat[1]);
  tex.colorSpace = opts.linear ? THREE.NoColorSpace : THREE.SRGBColorSpace;
  tex.anisotropy = opts.aniso ?? 4;
  if (opts.srgb === false) tex.colorSpace = THREE.NoColorSpace;
  return tex;
}

function speckle(ctx, w, h, n, colors, rmin = 0.5, rmax = 1.8) {
  for (let i = 0; i < n; i++) {
    ctx.fillStyle = colors[Math.floor(Math.random() * colors.length)];
    const r = rand(rmin, rmax);
    ctx.beginPath();
    ctx.arc(rand(w), rand(h), r, 0, TAU);
    ctx.fill();
  }
}

export function asphaltTexture() {
  return canvasTexture(512, 256, (ctx, w, h) => {
    ctx.fillStyle = '#4a4f55'; ctx.fillRect(0, 0, w, h);
    // aggregate
    speckle(ctx, w, h, 5200, ['rgba(255,255,255,.055)', 'rgba(0,0,0,.10)', 'rgba(190,180,165,.07)', 'rgba(30,32,36,.16)'], 0.6, 2.4);
    // patches / repairs
    for (let i = 0; i < 7; i++) {
      ctx.fillStyle = `rgba(${randInt(58, 78)},${randInt(62, 80)},${randInt(66, 84)},.5)`;
      ctx.beginPath();
      ctx.ellipse(rand(w), rand(h), rand(20, 70), rand(8, 26), rand(TAU), 0, TAU);
      ctx.fill();
    }
    // shoulders (v is across the road)
    const grd = ctx.createLinearGradient(0, 0, 0, h);
    grd.addColorStop(0, 'rgba(210,190,150,.30)');
    grd.addColorStop(0.09, 'rgba(210,190,150,0)');
    grd.addColorStop(0.91, 'rgba(210,190,150,0)');
    grd.addColorStop(1, 'rgba(210,190,150,.30)');
    ctx.fillStyle = grd; ctx.fillRect(0, 0, w, h);
    // edge lines
    ctx.fillStyle = 'rgba(238,232,214,.72)';
    ctx.fillRect(0, h * 0.075, w, 4);
    ctx.fillRect(0, h * 0.905, w, 4);
    // centre dashes: tile is 8 world metres
    ctx.fillStyle = 'rgba(246,232,190,.86)';
    ctx.fillRect(w * 0.06, h * 0.485, w * 0.42, 6);
    // cracks
    ctx.strokeStyle = 'rgba(24,26,29,.4)'; ctx.lineWidth = 1.2;
    for (let i = 0; i < 9; i++) {
      ctx.beginPath();
      let x = rand(w), y = rand(h);
      ctx.moveTo(x, y);
      for (let k = 0; k < 5; k++) { x += rand(-22, 22); y += rand(-14, 14); ctx.lineTo(x, y); }
      ctx.stroke();
    }
  }, { aniso: 8 });
}

export function sandTexture() {
  return canvasTexture(256, 256, (ctx, w, h) => {
    ctx.fillStyle = '#e3cda2'; ctx.fillRect(0, 0, w, h);
    speckle(ctx, w, h, 6000, ['rgba(255,246,220,.5)', 'rgba(160,132,94,.28)', 'rgba(210,186,146,.4)'], 0.4, 1.5);
    for (let i = 0; i < 26; i++) {
      ctx.strokeStyle = 'rgba(190,164,124,.16)'; ctx.lineWidth = rand(1, 3);
      ctx.beginPath();
      const y = rand(h);
      ctx.moveTo(0, y);
      for (let x = 0; x <= w; x += 16) ctx.lineTo(x, y + Math.sin(x * 0.05 + i) * 3);
      ctx.stroke();
    }
  }, { repeat: [26, 26] });
}

export function grassNoiseTexture() {
  return canvasTexture(256, 256, (ctx, w, h) => {
    ctx.fillStyle = '#8d9a5c'; ctx.fillRect(0, 0, w, h);
    speckle(ctx, w, h, 4200, ['rgba(160,176,96,.5)', 'rgba(96,110,60,.45)', 'rgba(206,196,130,.3)'], 0.6, 2.6);
  }, { repeat: [18, 18] });
}

export function featherBump() {
  return canvasTexture(256, 256, (ctx, w, h) => {
    ctx.fillStyle = '#8a8a8a'; ctx.fillRect(0, 0, w, h);
    for (let i = 0; i < 900; i++) {
      const x = rand(w), y = rand(h), r = rand(3, 9);
      const g = ctx.createRadialGradient(x, y, 0, x, y, r);
      g.addColorStop(0, 'rgba(255,255,255,.16)');
      g.addColorStop(1, 'rgba(0,0,0,.10)');
      ctx.fillStyle = g;
      ctx.beginPath(); ctx.ellipse(x, y, r, r * 0.62, rand(TAU), 0, TAU); ctx.fill();
    }
  }, { linear: true, repeat: [3, 3] });
}

export function treadTexture() {
  return canvasTexture(256, 64, (ctx, w, h) => {
    ctx.fillStyle = '#22252a'; ctx.fillRect(0, 0, w, h);
    ctx.fillStyle = '#2f343a';
    for (let i = 0; i < 26; i++) {
      const x = (i / 26) * w;
      ctx.save(); ctx.translate(x, 0); ctx.rotate(0.35);
      ctx.fillRect(-3, -10, 6, h * 0.55);
      ctx.fillRect(-3, h * 0.55, 6, h * 0.6);
      ctx.restore();
    }
    ctx.fillStyle = 'rgba(120,130,140,.25)'; ctx.fillRect(0, h * 0.46, w, 3);
  }, { repeat: [16, 1] });
}

export function chainTexture() {
  return canvasTexture(128, 32, (ctx, w, h) => {
    ctx.fillStyle = '#2b2f34'; ctx.fillRect(0, 0, w, h);
    for (let i = 0; i < 8; i++) {
      const x = i * 16 + 8;
      ctx.fillStyle = '#6d757e';
      ctx.beginPath(); ctx.roundRect(x - 6, 8, 12, 16, 6); ctx.fill();
      ctx.fillStyle = '#3a4046';
      ctx.beginPath(); ctx.roundRect(x - 3.4, 11.5, 6.8, 9, 4); ctx.fill();
      ctx.fillStyle = '#9aa3ad';
      ctx.beginPath(); ctx.arc(x, 16, 1.7, 0, TAU); ctx.fill();
    }
  }, { repeat: [1, 1] });
}

export function wickerTexture() {
  return canvasTexture(128, 128, (ctx, w, h) => {
    ctx.fillStyle = '#b98d55'; ctx.fillRect(0, 0, w, h);
    const cell = 16;
    for (let y = 0; y < h; y += cell) {
      for (let x = 0; x < w; x += cell) {
        const odd = ((x / cell) + (y / cell)) % 2;
        ctx.fillStyle = odd ? '#c99f63' : '#a97c46';
        ctx.beginPath(); ctx.roundRect(x + 1, y + 1, cell - 2, cell - 2, 4); ctx.fill();
        ctx.strokeStyle = 'rgba(80,52,26,.45)'; ctx.lineWidth = 1;
        ctx.beginPath(); ctx.roundRect(x + 1, y + 1, cell - 2, cell - 2, 4); ctx.stroke();
        ctx.fillStyle = 'rgba(255,232,190,.18)';
        ctx.fillRect(x + 3, y + 3, cell - 6, 2);
      }
    }
  }, { repeat: [4, 2] });
}

export function pouchTexture() {
  return canvasTexture(256, 128, (ctx, w, h) => {
    const g = ctx.createLinearGradient(0, 0, 0, h);
    g.addColorStop(0, '#f8c08a');
    g.addColorStop(0.5, '#f2a869');
    g.addColorStop(1, '#e8945a');
    ctx.fillStyle = g; ctx.fillRect(0, 0, w, h);
    for (let x = 0; x < w; x += 6) {
      ctx.fillStyle = `rgba(190,100,60,${0.10 + Math.random() * 0.10})`;
      ctx.fillRect(x, 0, 1.6, h);
    }
    for (let i = 0; i < 400; i++) {
      ctx.fillStyle = 'rgba(255,220,180,.10)';
      ctx.fillRect(rand(w), rand(h), rand(1, 3), rand(1, 2));
    }
  }, { repeat: [1, 1] });
}

export function scarfTexture() {
  return canvasTexture(128, 32, (ctx, w, h) => {
    ctx.fillStyle = '#e2574c'; ctx.fillRect(0, 0, w, h);
    ctx.fillStyle = '#f6e3c8';
    for (let i = 0; i < 8; i++) ctx.fillRect(i * 16 + 4, 0, 5, h);
    ctx.fillStyle = 'rgba(120,32,26,.25)';
    for (let i = 0; i < 8; i++) ctx.fillRect(i * 16 + 11, 0, 2, h);
  }, { repeat: [3, 1] });
}

export function glowTexture(inner = 'rgba(255,255,255,1)', outer = 'rgba(255,255,255,0)') {
  return canvasTexture(128, 128, (ctx, w, h) => {
    const g = ctx.createRadialGradient(w / 2, h / 2, 0, w / 2, h / 2, w / 2);
    g.addColorStop(0, inner);
    g.addColorStop(0.22, inner.replace(/,1\)$/, ',.55)'));
    g.addColorStop(0.5, 'rgba(255,255,255,.13)');
    g.addColorStop(1, outer);
    ctx.fillStyle = g; ctx.fillRect(0, 0, w, h);
  }, { wrap: THREE.ClampToEdgeWrapping });
}

export function cloudTexture() {
  return canvasTexture(256, 128, (ctx, w, h) => {
    ctx.clearRect(0, 0, w, h);
    const blobs = [[70, 76, 46], [118, 60, 54], [166, 74, 42], [200, 84, 30], [40, 88, 28], [140, 88, 40]];
    for (const [x, y, r] of blobs) {
      const g = ctx.createRadialGradient(x, y, r * 0.15, x, y, r);
      g.addColorStop(0, 'rgba(255,255,255,.92)');
      g.addColorStop(0.55, 'rgba(255,255,255,.42)');
      g.addColorStop(1, 'rgba(255,255,255,0)');
      ctx.fillStyle = g;
      ctx.beginPath(); ctx.arc(x, y, r, 0, TAU); ctx.fill();
    }
  }, { wrap: THREE.ClampToEdgeWrapping });
}

export function waterNormalTexture() {
  const size = 256;
  const height = new Float32Array(size * size);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const u = (x / size) * TAU, v = (y / size) * TAU;
      height[y * size + x] =
        Math.sin(u * 6 + Math.cos(v * 3) * 1.6) * 0.42 +
        Math.sin(v * 9 - u * 2) * 0.26 +
        Math.sin((u + v) * 14) * 0.14 +
        Math.sin(u * 23 - v * 17) * 0.06 +
        Math.sin(u * 3 - v * 5 + 1.7) * 0.30 +
        Math.sin(u * 11 + v * 7 + 0.6) * 0.18;
    }
  }
  return canvasTexture(size, size, (ctx, w, h) => {
    const img = ctx.createImageData(w, h);
    const at = (x, y) => height[((y + size) % size) * size + ((x + size) % size)];
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const dx = (at(x + 1, y) - at(x - 1, y)) * 1.5;
        const dy = (at(x, y + 1) - at(x, y - 1)) * 1.5;
        const len = Math.hypot(dx, dy, 1);
        const i = (y * w + x) * 4;
        img.data[i] = ((-dx / len) * 0.5 + 0.5) * 255;
        img.data[i + 1] = ((-dy / len) * 0.5 + 0.5) * 255;
        img.data[i + 2] = ((1 / len) * 0.5 + 0.5) * 255;
        img.data[i + 3] = 255;
      }
    }
    ctx.putImageData(img, 0, 0);
  }, { linear: true, repeat: [26, 26], aniso: 4 });
}

export function foamTexture() {
  return canvasTexture(256, 64, (ctx, w, h) => {
    ctx.clearRect(0, 0, w, h);
    for (let i = 0; i < 220; i++) {
      const x = rand(w), y = rand(h);
      const fade = 1 - Math.abs(y / h - 0.45) * 2.1;
      if (fade <= 0) continue;
      const r = rand(2, 11);
      const g = ctx.createRadialGradient(x, y, 0, x, y, r);
      g.addColorStop(0, `rgba(255,255,255,${0.5 * fade})`);
      g.addColorStop(1, 'rgba(255,255,255,0)');
      ctx.fillStyle = g; ctx.beginPath(); ctx.arc(x, y, r, 0, TAU); ctx.fill();
    }
  }, { repeat: [12, 1] });
}

export function starTexture() {
  return canvasTexture(64, 64, (ctx, w, h) => {
    const g = ctx.createRadialGradient(32, 32, 0, 32, 32, 32);
    g.addColorStop(0, 'rgba(255,255,255,1)');
    g.addColorStop(0.28, 'rgba(220,235,255,.5)');
    g.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = g; ctx.fillRect(0, 0, w, h);
  }, { wrap: THREE.ClampToEdgeWrapping });
}