import * as THREE from 'three';
import {
  TAU, clamp, lerp, rand, randInt, pick, mergeGeos, placed, taperedTube, tubeBetween,
  canvasTexture, asphaltTexture, sandTexture, grassNoiseTexture, waterNormalTexture,
  foamTexture, glowTexture, cloudTexture, starTexture,
} from './util.js';

const SPAN = 220;
const wrapX = (x0, dist, span = SPAN, lead = 0.68) => (((x0 - dist) % span) + span) % span - span * (1 - lead);

/* ------------------------------------------------------------------ *
 * moods
 * ------------------------------------------------------------------ */
const MOODS = {
  golden: {
    top: 0x2f5f92, mid: 0xef9f63, low: 0xffd9a2,
    sunDir: [-0.42, 0.155, -0.89], sunColor: 0xffb066, sunPower: 3.4, disc: 340,
    hemiSky: 0xbcd8f0, hemiGround: 0xd8b489, hemiPower: 0.85,
    fillColor: 0xffd7ad, fillPower: 0.62,
    fog: 0xeec093, fogNear: 70, fogFar: 640,
    ocean: 0x1f6f80, oceanRough: 0.14, env: 0.95, exposure: 1.06,
    cloud: 0xffc79c, cloudOpacity: 0.85, night: 0, lamp: 0.18, beam: 0,
    sand: 0xe8d2a8, grass: 0x93a063,
  },
  noon: {
    top: 0x2a7cc4, mid: 0x8ecbee, low: 0xe4f2fb,
    sunDir: [0.34, 0.76, -0.55], sunColor: 0xfff5e0, sunPower: 3.7, disc: 900,
    hemiSky: 0xd3e9ff, hemiGround: 0xe2d5b2, hemiPower: 1.05,
    fillColor: 0xeaf4ff, fillPower: 0.5,
    fog: 0xcfe4f2, fogNear: 95, fogFar: 780,
    ocean: 0x1a88a4, oceanRough: 0.12, env: 1.15, exposure: 1.0,
    cloud: 0xffffff, cloudOpacity: 0.92, night: 0, lamp: 0, beam: 0,
    sand: 0xf0dcb2, grass: 0x9fae62,
  },
  night: {
    top: 0x04081a, mid: 0x0e1e38, low: 0x27405c,
    sunDir: [-0.30, 0.22, -0.93], sunColor: 0xa9c9ec, sunPower: 1.05, disc: 1500,
    hemiSky: 0x2a4260, hemiGround: 0x0d141c, hemiPower: 0.55,
    fillColor: 0x6f93bd, fillPower: 0.26,
    fog: 0x15273a, fogNear: 45, fogFar: 470,
    ocean: 0x0b2434, oceanRough: 0.1, env: 0.3, exposure: 1.02,
    cloud: 0x2b405a, cloudOpacity: 0.5, night: 1, lamp: 1, beam: 0.5,
    sand: 0x8d95a1, grass: 0x3d4c46,
  },
};

function moodState(name) {
  const m = MOODS[name];
  return {
    top: new THREE.Color(m.top), mid: new THREE.Color(m.mid), low: new THREE.Color(m.low),
    sunDir: new THREE.Vector3(...m.sunDir).normalize(),
    sunColor: new THREE.Color(m.sunColor), sunPower: m.sunPower, disc: m.disc,
    hemiSky: new THREE.Color(m.hemiSky), hemiGround: new THREE.Color(m.hemiGround), hemiPower: m.hemiPower,
    fillColor: new THREE.Color(m.fillColor), fillPower: m.fillPower,
    fog: new THREE.Color(m.fog), fogNear: m.fogNear, fogFar: m.fogFar,
    ocean: new THREE.Color(m.ocean), oceanRough: m.oceanRough, env: m.env, exposure: m.exposure,
    cloud: new THREE.Color(m.cloud), cloudOpacity: m.cloudOpacity,
    night: m.night, lamp: m.lamp, beam: m.beam,
    sand: new THREE.Color(m.sand), grass: new THREE.Color(m.grass),
  };
}

/* ------------------------------------------------------------------ *
 * sky
 * ------------------------------------------------------------------ */
function buildSky() {
  const uniforms = {
    uTop: { value: new THREE.Color() }, uMid: { value: new THREE.Color() }, uLow: { value: new THREE.Color() },
    uSunDir: { value: new THREE.Vector3() }, uSunColor: { value: new THREE.Color() },
    uDisc: { value: 340 }, uNight: { value: 0 }, uTime: { value: 0 },
  };
  const mat = new THREE.ShaderMaterial({
    uniforms, side: THREE.BackSide, depthWrite: false, fog: false,
    vertexShader: /* glsl */`
      varying vec3 vDir;
      void main() {
        vDir = normalize(position);
        vec4 mv = modelViewMatrix * vec4(position, 1.0);
        gl_Position = projectionMatrix * mv;
      }`,
    fragmentShader: /* glsl */`
      uniform vec3 uTop, uMid, uLow, uSunColor, uSunDir;
      uniform float uDisc, uNight, uTime;
      varying vec3 vDir;
      float hash(vec3 p) {
        p = fract(p * 0.3183099 + 0.1);
        p *= 17.0;
        return fract(p.x * p.y * p.z * (p.x + p.y + p.z));
      }
      void main() {
        vec3 d = normalize(vDir);
        float h = clamp(d.y * 0.5 + 0.5, 0.0, 1.0);
        vec3 col = mix(uLow, uMid, smoothstep(0.44, 0.56, h));
        col = mix(col, uTop, smoothstep(0.55, 0.92, h));
        float sd = max(dot(d, normalize(uSunDir)), 0.0);
        col += uSunColor * pow(sd, uDisc) * 3.0;
        col += uSunColor * pow(sd, 26.0) * 0.30;
        col += uSunColor * pow(sd, 4.0) * 0.10;
        // stars
        vec3 sd3 = d * 260.0;
        vec3 id = floor(sd3);
        float hh = hash(id);
        float star = 0.0;
        if (hh > 0.9955) {
          vec3 f = fract(sd3) - 0.5;
          float tw = 0.65 + 0.35 * sin(uTime * 2.2 + hh * 90.0);
          star = smoothstep(0.34, 0.0, length(f)) * tw;
        }
        col += vec3(0.86, 0.92, 1.0) * star * uNight * 1.7 * smoothstep(0.0, 0.28, d.y);
        // horizon haze band
        col = mix(col, uLow, pow(1.0 - abs(d.y), 12.0) * 0.55);
        gl_FragColor = vec4(col, 1.0);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }`,
  });
  const mesh = new THREE.Mesh(new THREE.SphereGeometry(1200, 40, 26), mat);
  mesh.frustumCulled = false;
  mesh.renderOrder = -10;
  return { mesh, uniforms };
}

export function makeEnvTexture(renderer, mood = 'golden') {
  const m = MOODS[mood];
  const tex = canvasTexture(512, 256, (ctx, w, h) => {
    const g = ctx.createLinearGradient(0, 0, 0, h);
    const c = (hex) => '#' + hex.toString(16).padStart(6, '0');
    g.addColorStop(0, c(m.top));
    g.addColorStop(0.42, c(m.mid));
    g.addColorStop(0.5, c(m.low));
    g.addColorStop(0.56, c(m.sand));
    g.addColorStop(1, '#4a4238');
    ctx.fillStyle = g; ctx.fillRect(0, 0, w, h);
    const sx = w * (0.5 + Math.atan2(m.sunDir[0], -m.sunDir[2]) / TAU);
    const sy = h * (0.5 - m.sunDir[1] * 0.5);
    const rg = ctx.createRadialGradient(sx, sy, 0, sx, sy, 90);
    rg.addColorStop(0, 'rgba(255,240,214,1)');
    rg.addColorStop(0.18, 'rgba(255,206,150,.75)');
    rg.addColorStop(1, 'rgba(255,190,130,0)');
    ctx.fillStyle = rg; ctx.fillRect(0, 0, w, h);
  }, { wrap: THREE.ClampToEdgeWrapping });
  tex.mapping = THREE.EquirectangularReflectionMapping;
  const pmrem = new THREE.PMREMGenerator(renderer);
  pmrem.compileEquirectangularShader();
  const rt = pmrem.fromEquirectangular(tex);
  tex.dispose(); pmrem.dispose();
  return rt.texture;
}

/* ------------------------------------------------------------------ *
 * props
 * ------------------------------------------------------------------ */
function barkTexture() {
  return canvasTexture(128, 256, (ctx, w, h) => {
    ctx.fillStyle = '#8a7159'; ctx.fillRect(0, 0, w, h);
    for (let y = 0; y < h; y += 9) {
      ctx.fillStyle = `rgba(${randInt(96, 140)},${randInt(78, 112)},${randInt(58, 86)},.85)`;
      ctx.beginPath(); ctx.roundRect(0, y, w, 7, 3); ctx.fill();
      ctx.fillStyle = 'rgba(50,38,28,.35)';
      ctx.fillRect(0, y + 7, w, 2);
    }
    for (let i = 0; i < 260; i++) {
      ctx.fillStyle = 'rgba(60,46,34,.18)';
      ctx.fillRect(rand(w), rand(h), rand(1, 4), rand(1, 3));
    }
  }, { repeat: [2, 3] });
}

function frondGeometry(len, width, droop) {
  const segs = 16;
  const pos = [], uv = [], idx = [];
  for (let i = 0; i <= segs; i++) {
    const t = i / segs;
    const x = t * len;
    const y = Math.sin(t * Math.PI * 0.62) * len * 0.20 - t * t * droop;
    const z = 0;
    const serr = 0.78 + 0.22 * Math.abs(Math.sin(t * 15));
    const w = width * Math.sin(Math.pow(t, 0.62) * Math.PI) * serr * (1 - t * 0.25);
    const fold = Math.abs(Math.sin(t * 15)) * w * 0.22;
    pos.push(x, y - fold, z - w, x, y + w * 0.16, z, x, y - fold, z + w);
    uv.push(t, 0, t, 0.5, t, 1);
    if (i < segs) {
      const a = i * 3;
      idx.push(a, a + 3, a + 1, a + 1, a + 3, a + 4, a + 1, a + 4, a + 2, a + 2, a + 4, a + 5);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}

function buildPalm(height, lean, barkMat, leafMat) {
  const g = new THREE.Group();
  const curve = new THREE.CatmullRomCurve3([
    new THREE.Vector3(0, -0.15, 0),
    new THREE.Vector3(lean * 0.22, height * 0.34, lean * 0.1),
    new THREE.Vector3(lean * 0.62, height * 0.68, lean * 0.22),
    new THREE.Vector3(lean, height, lean * 0.34),
  ]);
  const trunk = new THREE.Mesh(taperedTube(curve, 18, (t) => lerp(0.20, 0.105, Math.pow(t, 0.7)), 10), barkMat);
  trunk.castShadow = true;
  g.add(trunk);
  const base = new THREE.Mesh(new THREE.ConeGeometry(0.30, 0.42, 12), barkMat);
  base.position.y = 0.06;
  g.add(base);

  const crown = new THREE.Group();
  crown.position.set(lean, height, lean * 0.34);
  g.add(crown);
  const fronds = [];
  const n = 11;
  for (let i = 0; i < n; i++) {
    const a = (i / n) * TAU + rand(-0.12, 0.12);
    const len = rand(1.9, 2.7);
    const f = frondGeometry(len, rand(0.42, 0.55), rand(0.85, 1.5));
    f.rotateZ(rand(0.10, 0.34));
    f.rotateY(a);
    fronds.push(f);
  }
  const leafMesh = new THREE.Mesh(mergeGeos(fronds), leafMat);
  leafMesh.castShadow = true;
  crown.add(leafMesh);
  const nuts = [];
  for (let i = 0; i < 4; i++) {
    const a = rand(TAU);
    nuts.push(placed(new THREE.SphereGeometry(0.085, 8, 6), Math.cos(a) * 0.16, -0.14, Math.sin(a) * 0.16));
  }
  crown.add(new THREE.Mesh(mergeGeos(nuts), new THREE.MeshStandardMaterial({ color: 0x7d6a3a, roughness: 0.8 })));
  g.userData.crown = crown;
  g.userData.leaves = leafMesh;
  return g;
}

function tuftGeometry() {
  const blades = [];
  for (let i = 0; i < 7; i++) {
    const a = (i / 7) * TAU + rand(0.4);
    const h = rand(0.24, 0.52);
    const bend = rand(0.10, 0.26);
    const c = new THREE.CatmullRomCurve3([
      new THREE.Vector3(0, 0, 0),
      new THREE.Vector3(Math.cos(a) * bend * 0.4, h * 0.6, Math.sin(a) * bend * 0.4),
      new THREE.Vector3(Math.cos(a) * bend, h, Math.sin(a) * bend),
    ]);
    blades.push(taperedTube(c, 5, (t) => 0.022 * (1 - t * 0.92), 3, () => ({ x: 0.35, y: 1 })));
  }
  return mergeGeos(blades);
}

function rockGeometry() {
  const g = new THREE.DodecahedronGeometry(0.42, 0);
  const p = g.attributes.position;
  for (let i = 0; i < p.count; i++) {
    p.setXYZ(i, p.getX(i) * rand(0.82, 1.18), p.getY(i) * rand(0.55, 0.85), p.getZ(i) * rand(0.82, 1.18));
  }
  g.computeVertexNormals();
  return g;
}

function bushGeometry() {
  const parts = [];
  for (let i = 0; i < 5; i++) {
    parts.push(placed(new THREE.IcosahedronGeometry(rand(0.22, 0.38), 0), rand(-0.3, 0.3), rand(0.12, 0.34), rand(-0.3, 0.3), rand(TAU), rand(TAU), 0, 1, rand(0.6, 0.85), 1));
  }
  return mergeGeos(parts);
}

function buildLighthouse() {
  const g = new THREE.Group();
  const white = new THREE.MeshStandardMaterial({ color: 0xf2ece0, roughness: 0.78 });
  const red = new THREE.MeshStandardMaterial({ color: 0xc4483a, roughness: 0.66 });
  const dark = new THREE.MeshStandardMaterial({ color: 0x3b444d, roughness: 0.6, metalness: 0.4 });
  const tower = new THREE.Mesh(new THREE.CylinderGeometry(1.5, 2.5, 15, 20), white);
  tower.position.y = 7.5;
  g.add(tower);
  for (const y of [4.2, 9.4]) {
    const band = new THREE.Mesh(new THREE.CylinderGeometry(lerp(2.5, 1.5, y / 15) + 0.04, lerp(2.5, 1.5, (y - 1.7) / 15) + 0.04, 1.7, 20), red);
    band.position.y = y;
    g.add(band);
  }
  const gallery = new THREE.Mesh(new THREE.CylinderGeometry(2.05, 2.05, 0.35, 20), dark);
  gallery.position.y = 15.2; g.add(gallery);
  const rail = new THREE.Mesh(new THREE.TorusGeometry(1.95, 0.07, 6, 24), dark);
  rail.rotation.x = Math.PI / 2; rail.position.y = 15.9; g.add(rail);
  const lantern = new THREE.Mesh(new THREE.CylinderGeometry(1.15, 1.15, 2.0, 14), new THREE.MeshStandardMaterial({ color: 0xffe6b0, emissive: 0xffc46a, emissiveIntensity: 1.2, roughness: 0.3, transparent: true, opacity: 0.92 }));
  lantern.position.y = 16.5; g.add(lantern);
  const roof = new THREE.Mesh(new THREE.ConeGeometry(1.5, 1.5, 14), red);
  roof.position.y = 18.2; g.add(roof);
  const beamMat = new THREE.ShaderMaterial({
    uniforms: { uOpacity: { value: 0 }, uColor: { value: new THREE.Color(0xffd79a) } },
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide,
    vertexShader: /* glsl */`
      varying vec2 vUv; varying vec3 vN; varying vec3 vV;
      void main() {
        vUv = uv;
        vec4 mv = modelViewMatrix * vec4(position, 1.0);
        vN = normalize(normalMatrix * normal);
        vV = normalize(-mv.xyz);
        gl_Position = projectionMatrix * mv;
      }`,
    fragmentShader: /* glsl */`
      uniform float uOpacity; uniform vec3 uColor;
      varying vec2 vUv; varying vec3 vN; varying vec3 vV;
      void main() {
        float along = pow(clamp(vUv.y, 0.0, 1.0), 1.7);
        float edge = pow(abs(dot(normalize(vN), normalize(vV))), 1.6);
        gl_FragColor = vec4(uColor, along * edge * uOpacity);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }`,
  });
  const beams = new THREE.Group();
  for (const s of [1, -1]) {
    const cone = new THREE.Mesh(new THREE.ConeGeometry(7.5, 78, 14, 1, true), beamMat);
    cone.rotation.z = s * Math.PI / 2;
    cone.position.set(s * 39, 16.5, 0);
    beams.add(cone);
  }
  g.add(beams);
  const glow = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTexture('rgba(255,214,150,1)', 'rgba(255,190,120,0)'), blending: THREE.AdditiveBlending, transparent: true, depthWrite: false, opacity: 0.5 }));
  glow.scale.set(14, 14, 1); glow.position.y = 16.5;
  g.add(glow);
  g.userData = { beams, beamMat, lantern, glow };
  return g;
}

function buildHeadland() {
  const g = new THREE.Group();
  const mat = new THREE.MeshStandardMaterial({ color: 0x5c6a72, roughness: 1, flatShading: true });
  const parts = [];
  for (let i = 0; i < 16; i++) {
    const x = -150 + i * 19 + rand(-6, 6);
    const h = rand(6, 26) * (1 - Math.abs(i - 7) / 14);
    const sy = rand(0.45, 0.7);
    parts.push(placed(new THREE.ConeGeometry(rand(16, 34), Math.max(4, h), randInt(5, 7), 1), x, (Math.max(4, h) * sy) / 2 - 2, rand(-24, 24), 0, rand(TAU), 0, rand(1.6, 2.4), sy, rand(0.6, 1.1)));
  }
  g.add(new THREE.Mesh(mergeGeos(parts), mat));
  return g;
}

function buildGull() {
  const g = new THREE.Group();
  const white = new THREE.MeshStandardMaterial({ color: 0xf4f4ef, roughness: 0.8, side: THREE.DoubleSide });
  const grey = new THREE.MeshStandardMaterial({ color: 0x9aa5ad, roughness: 0.8, side: THREE.DoubleSide });
  const body = new THREE.Mesh(new THREE.SphereGeometry(0.11, 10, 8), white);
  body.scale.set(1.7, 0.85, 0.8);
  g.add(body);
  const head = new THREE.Mesh(new THREE.SphereGeometry(0.062, 8, 6), white);
  head.position.set(0.19, 0.045, 0); g.add(head);
  const beak = new THREE.Mesh(new THREE.ConeGeometry(0.022, 0.10, 6), new THREE.MeshStandardMaterial({ color: 0xf0a63c, roughness: 0.5 }));
  beak.position.set(0.27, 0.035, 0); beak.rotation.z = -Math.PI / 2; g.add(beak);
  const wings = [];
  for (const s of [1, -1]) {
    const w = new THREE.Group();
    const shape = new THREE.Shape();
    shape.moveTo(0, 0); shape.quadraticCurveTo(0.10, s * 0.30, -0.06, s * 0.62);
    shape.quadraticCurveTo(-0.16, s * 0.30, -0.20, 0); shape.lineTo(0, 0);
    const mesh = new THREE.Mesh(new THREE.ShapeGeometry(shape, 6), s > 0 ? white : grey);
    mesh.rotation.x = -Math.PI / 2;
    w.add(mesh);
    const tip = new THREE.Mesh(new THREE.ShapeGeometry((() => { const sh = new THREE.Shape(); sh.moveTo(-0.06, s * 0.62); sh.lineTo(-0.20, s * 0.44); sh.lineTo(-0.20, 0); sh.lineTo(-0.10, s * 0.2); return sh; })(), 4), grey);
    tip.rotation.x = -Math.PI / 2;
    w.add(tip);
    g.add(w); wings.push({ group: w, side: s });
  }
  g.userData.wings = wings;
  return g;
}

/* ------------------------------------------------------------------ *
 * world
 * ------------------------------------------------------------------ */
export function createWorld(scene, renderer, quality) {
  const root = new THREE.Group();
  scene.add(root);
  const low = quality === 'low';

  /* sky + lights */
  const sky = buildSky();
  scene.add(sky.mesh);

  const hemi = new THREE.HemisphereLight(0xffffff, 0xffffff, 1);
  scene.add(hemi);
  const sun = new THREE.DirectionalLight(0xffffff, 3);
  sun.castShadow = true;
  sun.shadow.mapSize.set(low ? 1024 : 2048, low ? 1024 : 2048);
  const sc = sun.shadow.camera;
  sc.left = -8; sc.right = 8; sc.top = 8; sc.bottom = -5; sc.near = 1; sc.far = 90;
  sun.shadow.bias = -0.0007;
  sun.shadow.normalBias = 0.022;
  sun.shadow.radius = 3;
  scene.add(sun, sun.target);
  const fill = new THREE.DirectionalLight(0xffffff, 0.6);
  fill.position.set(7, 5, 11);
  scene.add(fill);
  const bounce = new THREE.DirectionalLight(0xffffff, 0.22);
  bounce.position.set(-4, -2, 6);
  scene.add(bounce);

  scene.fog = new THREE.Fog(0xeec093, 70, 640);

  const sunGlow = new THREE.Sprite(new THREE.SpriteMaterial({
    map: glowTexture('rgba(255,236,200,1)', 'rgba(255,170,90,0)'),
    blending: THREE.AdditiveBlending, transparent: true, depthWrite: false, depthTest: false, opacity: 0.85,
  }));
  sunGlow.scale.set(150, 150, 1);
  sunGlow.renderOrder = -5;
  scene.add(sunGlow);

  /* ground: road */
  const roadTex = asphaltTexture();
  roadTex.repeat.set(75, 1);
  const road = new THREE.Mesh(new THREE.PlaneGeometry(600, 7.2), new THREE.MeshStandardMaterial({ map: roadTex, roughness: 0.92, metalness: 0.02, color: 0xffffff }));
  road.rotation.x = -Math.PI / 2;
  road.position.y = 0.012;
  road.receiveShadow = true;
  root.add(road);

  /* beach */
  const beachTex = sandTexture();
  beachTex.repeat.set(130, 1.8);
  const beachGeo = new THREE.PlaneGeometry(700, 12.8, 60, 8);
  beachGeo.rotateX(-Math.PI / 2);
  {
    const p = beachGeo.attributes.position;
    const col = new Float32Array(p.count * 3);
    for (let i = 0; i < p.count; i++) {
      const z = p.getZ(i);
      const t = clamp((6.4 - z) / 12.8, 0, 1);
      p.setY(i, -0.02 - 0.66 * Math.pow(t, 1.35) + Math.sin(p.getX(i) * 0.08) * 0.03 * t);
      const wet = clamp((t - 0.62) / 0.38, 0, 1);
      col[i * 3] = lerp(1, 0.60, wet);
      col[i * 3 + 1] = lerp(1, 0.57, wet);
      col[i * 3 + 2] = lerp(1, 0.53, wet);
    }
    beachGeo.setAttribute('color', new THREE.BufferAttribute(col, 3));
    beachGeo.computeVertexNormals();
  }
  const beachMat = new THREE.MeshStandardMaterial({ map: beachTex, color: 0xe8d2a8, roughness: 1, vertexColors: true });
  const beach = new THREE.Mesh(beachGeo, beachMat);
  beach.position.set(0, 0, -10);
  beach.receiveShadow = true;
  root.add(beach);

  /* inland */
  const grassTex = grassNoiseTexture();
  grassTex.repeat.set(90, 14);
  const inlandGeo = new THREE.PlaneGeometry(700, 150, 40, 12);
  inlandGeo.rotateX(-Math.PI / 2);
  {
    const p = inlandGeo.attributes.position;
    for (let i = 0; i < p.count; i++) {
      const x = p.getX(i), z = p.getZ(i);
      p.setY(i, Math.sin(x * 0.03) * Math.cos(z * 0.05) * 0.5 * clamp((z + 75) / 40, 0, 1) + rand(0, 0.04));
    }
    inlandGeo.computeVertexNormals();
  }
  const inlandMat = new THREE.MeshStandardMaterial({ map: grassTex, color: 0x93a063, roughness: 1 });
  const inland = new THREE.Mesh(inlandGeo, inlandMat);
  inland.position.set(0, -0.02, 78.5);
  inland.receiveShadow = true;
  root.add(inland);

  /* ocean */
  const oceanUniforms = { uTime: { value: 0 } };
  const normalMap = waterNormalTexture();
  normalMap.repeat.set(220, 110);
  const oceanMat = new THREE.MeshStandardMaterial({
    color: 0x1f6f80, roughness: 0.16, metalness: 0.06, normalMap, normalScale: new THREE.Vector2(0.22, 0.22),
    envMapIntensity: 0.5,
  });
  oceanMat.onBeforeCompile = (shader) => {
    shader.uniforms.uTime = oceanUniforms.uTime;
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', /* glsl */`
        #include <common>
        uniform float uTime;
        float waveH(vec2 p, float t, float amp) {
          return (sin(p.x * 0.055 + t * 0.85) * 0.50
                + sin(p.y * 0.09 - t * 1.15 + p.x * 0.02) * 0.32
                + sin((p.x * 0.5 + p.y) * 0.16 + t * 1.7) * 0.18) * amp;
        }
      `)
      .replace('#include <beginnormal_vertex>', /* glsl */`
        vec2 wp = position.xy;
        float offshore = smoothstep(-299.0, -210.0, wp.y);
        float amp = mix(0.035, 0.40, offshore);
        float h = waveH(wp, uTime, amp);
        float e = 0.6;
        float dx = (waveH(wp + vec2(e, 0.0), uTime, amp) - waveH(wp - vec2(e, 0.0), uTime, amp)) / (2.0 * e);
        float dy = (waveH(wp + vec2(0.0, e), uTime, amp) - waveH(wp - vec2(0.0, e), uTime, amp)) / (2.0 * e);
        vec3 objectNormal = normalize(vec3(-dx, -dy, 1.0));
        #ifdef USE_TANGENT
          vec3 objectTangent = vec3(tangent.xyz);
        #endif
      `)
      .replace('#include <begin_vertex>', /* glsl */`
        vec3 transformed = vec3(position);
        transformed.z += h;
      `);
  };
  const ocean = new THREE.Mesh(new THREE.PlaneGeometry(1400, 620, low ? 90 : 150, low ? 50 : 86), oceanMat);
  ocean.rotation.x = -Math.PI / 2;
  ocean.position.set(0, -0.55, -325);
  ocean.receiveShadow = false;
  root.add(ocean);

  /* shoreline foam */
  const foamTex = foamTexture();
  foamTex.repeat.set(16, 1);
  const foamMat = new THREE.MeshBasicMaterial({ map: foamTex, transparent: true, opacity: 0.72, depthWrite: false, color: 0xffffff });
  const foam = new THREE.Mesh(new THREE.PlaneGeometry(700, 6.5), foamMat);
  foam.rotation.x = -Math.PI / 2;
  foam.position.set(0, -0.47, -16.2);
  root.add(foam);
  const foam2 = new THREE.Mesh(new THREE.PlaneGeometry(700, 4.0), foamMat.clone());
  foam2.material.opacity = 0.4;
  foam2.rotation.x = -Math.PI / 2;
  foam2.position.set(0, -0.44, -19.5);
  root.add(foam2);

  /* guard rail */
  const woodMat = new THREE.MeshStandardMaterial({ color: 0x9a8a72, roughness: 0.92 });
  const railSeg = (() => {
    const parts = [];
    parts.push(placed(new THREE.BoxGeometry(0.13, 0.95, 0.13), 0, 0.44, 0));
    parts.push(placed(new THREE.BoxGeometry(4.0, 0.10, 0.07), 2.0, 0.78, 0));
    parts.push(placed(new THREE.BoxGeometry(4.0, 0.07, 0.05), 2.0, 0.50, 0));
    parts.push(placed(new THREE.BoxGeometry(0.16, 0.10, 0.16), 0, 0.94, 0));
    return mergeGeos(parts);
  })();
  const rails = [];
  const railCount = low ? 20 : 28;
  const railSpan = railCount * 4;
  for (let i = 0; i < railCount; i++) {
    const m = new THREE.Mesh(railSeg, woodMat);
    m.castShadow = true; m.receiveShadow = true;
    m.position.set(0, -0.05, -4.15);
    m.rotation.y = 0;
    root.add(m);
    rails.push({ mesh: m, x0: i * 4 });
  }

  /* palms */
  const barkMat = new THREE.MeshStandardMaterial({ map: barkTexture(), color: 0xa08a6e, roughness: 0.9 });
  const leafMat = new THREE.MeshStandardMaterial({ color: 0x4f7f45, roughness: 0.78, side: THREE.DoubleSide });
  const leafMat2 = new THREE.MeshStandardMaterial({ color: 0x5d8c4a, roughness: 0.78, side: THREE.DoubleSide });
  const palms = [];
  const palmCount = low ? 8 : 13;
  for (let i = 0; i < palmCount; i++) {
    const beachSide = i % 3 !== 2;
    const h = rand(4.2, 7.4);
    const p = buildPalm(h, rand(-0.9, 0.9), barkMat, i % 2 ? leafMat : leafMat2);
    const z = beachSide ? rand(-13.5, -6.2) : rand(7.5, 22);
    const y = beachSide ? -0.02 - 0.66 * Math.pow(clamp((-z - 3.6) / 12.8, 0, 1), 1.35) : 0;
    p.position.set(0, y, z);
    p.rotation.y = rand(TAU);
    const s = rand(0.85, 1.15);
    p.scale.setScalar(s);
    root.add(p);
    palms.push({ mesh: p, x0: (i / palmCount) * SPAN + rand(-4, 4), crown: p.userData.crown, phase: rand(TAU), z });
  }

  /* scattered rocks / tufts / bushes (instanced) */
  const rockMat = new THREE.MeshStandardMaterial({ color: 0x8d8579, roughness: 0.95, flatShading: true });
  const tuftMat = new THREE.MeshStandardMaterial({ color: 0x7d8f4e, roughness: 0.9, side: THREE.DoubleSide });
  const bushMat = new THREE.MeshStandardMaterial({ color: 0x55703f, roughness: 0.9, flatShading: true });
  const scatter = [];
  const defs = [
    { geo: rockGeometry(), mat: rockMat, n: low ? 26 : 44, zRange: [-13, 26], scale: [0.5, 1.7], shadow: true },
    { geo: tuftGeometry(), mat: tuftMat, n: low ? 60 : 130, zRange: [-12, 30], scale: [0.7, 1.7], shadow: false },
    { geo: bushGeometry(), mat: bushMat, n: low ? 16 : 34, zRange: [4.6, 34], scale: [0.7, 1.5], shadow: true },
  ];
  const _m = new THREE.Matrix4(), _q = new THREE.Quaternion(), _e = new THREE.Euler(), _s = new THREE.Vector3(), _p = new THREE.Vector3();
  for (const d of defs) {
    const im = new THREE.InstancedMesh(d.geo, d.mat, d.n);
    im.castShadow = d.shadow;
    im.receiveShadow = false;
    im.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    im.frustumCulled = false;
    root.add(im);
    const items = [];
    for (let i = 0; i < d.n; i++) {
      let z = rand(d.zRange[0], d.zRange[1]);
      if (z > -4.2 && z < 4.2) z = z < 0 ? rand(-13, -4.6) : rand(4.6, 26);
      items.push({
        x0: rand(SPAN), z, y: z < -3.6 ? -0.02 - 0.66 * Math.pow(clamp((-z - 3.6) / 12.8, 0, 1), 1.35) : 0,
        rot: rand(TAU), tilt: rand(-0.18, 0.18), sc: rand(d.scale[0], d.scale[1]),
      });
    }
    scatter.push({ im, items });
  }

  /* distant headland + lighthouse (slow parallax) */
  const farGroup = new THREE.Group();
  root.add(farGroup);
  const headland = buildHeadland();
  headland.position.set(-40, -2, -430);
  headland.scale.setScalar(2.2);
  farGroup.add(headland);
  const point = new THREE.Mesh(new THREE.CylinderGeometry(26, 40, 7, 14), new THREE.MeshStandardMaterial({ color: 0x6a6a63, roughness: 1, flatShading: true }));
  point.position.set(-150, 1.0, -395);
  point.scale.set(2.2, 1.6, 2.2);
  farGroup.add(point);
  const lighthouse = buildLighthouse();
  lighthouse.position.set(-150, 5.4, -395);
  lighthouse.scale.setScalar(1.5);
  farGroup.add(lighthouse);

  const hills = [];
  const hillMat = new THREE.MeshStandardMaterial({ color: 0x7b8a86, roughness: 1, flatShading: true });
  for (let i = 0; i < 9; i++) {
    const h = new THREE.Mesh(new THREE.ConeGeometry(rand(30, 60), rand(18, 40), randInt(5, 7)), hillMat);
    h.position.set(-260 + i * 62 + rand(-14, 14), rand(4, 12), rand(260, 340));
    h.rotation.y = rand(TAU);
    h.scale.set(1.8, rand(1.2, 1.9), rand(1.1, 1.9));
    farGroup.add(h);
    hills.push(h);
  }

  /* clouds */
  const cloudTex = cloudTexture();
  const clouds = [];
  const cloudCount = low ? 7 : 12;
  for (let i = 0; i < cloudCount; i++) {
    const mat = new THREE.SpriteMaterial({ map: cloudTex, transparent: true, depthWrite: false, opacity: 0.85, color: 0xffc79c, fog: false });
    const sp = new THREE.Sprite(mat);
    const s = rand(70, 190);
    sp.scale.set(s, s * 0.46, 1);
    sp.position.set(rand(-420, 420), rand(46, 120), rand(-520, -230));
    scene.add(sp);
    clouds.push({ sp, x0: sp.position.x, drift: rand(0.4, 1.3), s });
    if (i % 2 === 0) {
      const sp2 = new THREE.Sprite(mat.clone());
      sp2.material.opacity = 0.5;
      sp2.scale.set(s * 0.7, s * 0.3, 1);
      sp2.position.set(sp.position.x + s * 0.3, sp.position.y - s * 0.06, sp.position.z + 20);
      scene.add(sp2);
      clouds.push({ sp: sp2, x0: sp2.position.x, drift: rand(0.4, 1.1), s: s * 0.7 });
    }
  }

  /* gulls */
  const gulls = [];
  const gullCount = low ? 6 : 11;
  for (let i = 0; i < gullCount; i++) {
    const g = buildGull();
    const s = rand(0.7, 1.5);
    g.scale.setScalar(s);
    scene.add(g);
    gulls.push({
      mesh: g, wings: g.userData.wings, r: rand(9, 30), h: rand(5.5, 17),
      cx: rand(-26, 22), cz: rand(-52, -12), sp: rand(0.16, 0.4) * (Math.random() < 0.5 ? 1 : -1),
      ph: rand(TAU), flap: rand(4, 7), tilt: rand(0.2, 0.5),
    });
  }

  /* sea sparkle */
  const sparkN = low ? 130 : 300;
  const sparkGeo = new THREE.BufferGeometry();
  const spPos = new Float32Array(sparkN * 3), spPhase = new Float32Array(sparkN);
  for (let i = 0; i < sparkN; i++) {
    spPos[i * 3] = rand(-160, 160);
    spPos[i * 3 + 1] = -0.30 + rand(0.05);
    spPos[i * 3 + 2] = rand(-150, -18);
    spPhase[i] = rand(TAU);
  }
  sparkGeo.setAttribute('position', new THREE.BufferAttribute(spPos, 3));
  sparkGeo.setAttribute('aPhase', new THREE.BufferAttribute(spPhase, 1));
  const sparkMat = new THREE.ShaderMaterial({
    uniforms: { uTime: { value: 0 }, uColor: { value: new THREE.Color(0xffe6bd) }, uOpacity: { value: 0.9 }, uSize: { value: low ? 12 : 18 } },
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
    vertexShader: /* glsl */`
      attribute float aPhase;
      uniform float uTime, uSize;
      varying float vA;
      void main() {
        vA = pow(max(0.0, sin(uTime * 1.7 + aPhase)), 8.0);
        vec4 mv = modelViewMatrix * vec4(position, 1.0);
        gl_PointSize = uSize * (1.0 + vA) / max(1.0, -mv.z * 0.06);
        gl_Position = projectionMatrix * mv;
      }`,
    fragmentShader: /* glsl */`
      uniform vec3 uColor; uniform float uOpacity;
      varying float vA;
      void main() {
        vec2 c = gl_PointCoord - 0.5;
        float d = length(c);
        float a = smoothstep(0.5, 0.0, d);
        gl_FragColor = vec4(uColor, a * vA * uOpacity);
        #include <colorspace_fragment>
      }`,
  });
  const sparks = new THREE.Points(sparkGeo, sparkMat);
  sparks.frustumCulled = false;
  root.add(sparks);

  /* airborne motes */
  const moteN = low ? 70 : 150;
  const moteGeo = new THREE.BufferGeometry();
  const mPos = new Float32Array(moteN * 3);
  const moteData = [];
  for (let i = 0; i < moteN; i++) {
    moteData.push({ x: rand(-16, 16), y: rand(0.3, 6.5), z: rand(-9, 9), ph: rand(TAU), sp: rand(0.3, 1.1) });
    mPos[i * 3] = moteData[i].x; mPos[i * 3 + 1] = moteData[i].y; mPos[i * 3 + 2] = moteData[i].z;
  }
  moteGeo.setAttribute('position', new THREE.BufferAttribute(mPos, 3));
  const moteMat = new THREE.PointsMaterial({
    size: 0.045, map: starTexture(), transparent: true, depthWrite: false,
    blending: THREE.AdditiveBlending, opacity: 0.5, color: 0xffe9c4, sizeAttenuation: true,
  });
  const motes = new THREE.Points(moteGeo, moteMat);
  motes.frustumCulled = false;
  root.add(motes);

  /* wheel dust */
  const dustN = low ? 34 : 70;
  const dustGeo = new THREE.BufferGeometry();
  const dPos = new Float32Array(dustN * 3);
  const dust = [];
  for (let i = 0; i < dustN; i++) dust.push({ life: 1, max: 0, x: 0, y: -50, z: 0, vx: 0, vy: 0, vz: 0 });
  dustGeo.setAttribute('position', new THREE.BufferAttribute(dPos, 3));
  const dustMat = new THREE.PointsMaterial({ size: 0.10, map: starTexture(), transparent: true, depthWrite: false, opacity: 0.34, color: 0xd8c3a0, sizeAttenuation: true });
  const dustPts = new THREE.Points(dustGeo, dustMat);
  dustPts.frustumCulled = false;
  root.add(dustPts);
  let dustCursor = 0, dustAccum = 0;

  /* ---------------- mood transition ---------------- */
  let cur = moodState('golden');
  let target = moodState('golden');
  let moodName = 'golden';
  const envs = {
    golden: makeEnvTexture(renderer, 'golden'),
    noon: makeEnvTexture(renderer, 'noon'),
    night: makeEnvTexture(renderer, 'night'),
  };
  const envTex = envs.golden;
  scene.environment = envTex;
  scene.environmentIntensity = 0.95;
  let pendingEnv = null, mixT = 1;

  function setMood(name) {
    if (!MOODS[name] || name === moodName) return;
    moodName = name;
    target = moodState(name);
    pendingEnv = name;
    mixT = 0;
  }

  const _sunPos = new THREE.Vector3();
  const WHITE = new THREE.Color(0xffffff);
  function applyMood(dt) {
    const k = 1 - Math.exp(-2.1 * dt);
    for (const key of ['top', 'mid', 'low', 'sunColor', 'hemiSky', 'hemiGround', 'fillColor', 'fog', 'ocean', 'cloud', 'sand', 'grass']) {
      cur[key].lerp(target[key], k);
    }
    cur.sunDir.lerp(target.sunDir, k).normalize();
    for (const key of ['sunPower', 'disc', 'hemiPower', 'fillPower', 'fogNear', 'fogFar', 'oceanRough', 'env', 'exposure', 'cloudOpacity', 'night', 'lamp', 'beam']) {
      cur[key] = lerp(cur[key], target[key], k);
    }
    mixT = Math.min(1, mixT + dt / 1.6);
    if (pendingEnv && mixT >= 0.5) { scene.environment = envs[pendingEnv]; pendingEnv = null; }
    const u = sky.uniforms;
    u.uTop.value.copy(cur.top); u.uMid.value.copy(cur.mid); u.uLow.value.copy(cur.low);
    u.uSunDir.value.copy(cur.sunDir); u.uSunColor.value.copy(cur.sunColor);
    u.uDisc.value = cur.disc; u.uNight.value = cur.night;

    hemi.color.copy(cur.hemiSky); hemi.groundColor.copy(cur.hemiGround); hemi.intensity = cur.hemiPower;
    sun.color.copy(cur.sunColor); sun.intensity = cur.sunPower;
    _sunPos.copy(cur.sunDir).multiplyScalar(46);
    sun.position.copy(_sunPos);
    sun.target.position.set(0, 0.9, 0);
    fill.color.copy(cur.fillColor); fill.intensity = cur.fillPower;
    bounce.intensity = 0.16 + cur.night * 0.06;
    scene.fog.color.copy(cur.fog); scene.fog.near = cur.fogNear; scene.fog.far = cur.fogFar;
    scene.environmentIntensity = cur.env;
    renderer.toneMappingExposure = cur.exposure;

    oceanMat.color.copy(cur.ocean);
    oceanMat.roughness = cur.oceanRough;
    beachMat.color.copy(cur.sand);
    inlandMat.color.copy(cur.grass);
    tuftMat.color.copy(cur.grass).multiplyScalar(0.86);
    bushMat.color.copy(cur.grass).multiplyScalar(0.62);
    leafMat.color.copy(cur.grass).multiplyScalar(0.72).offsetHSL(0.02, 0.06, -0.06);
    leafMat2.color.copy(cur.grass).multiplyScalar(0.86).offsetHSL(0.01, 0.04, -0.02);
    sunGlow.position.copy(cur.sunDir).multiplyScalar(900);
    const gs = lerp(150, 74, cur.night);
    sunGlow.scale.set(gs, gs, 1);
    sunGlow.material.opacity = lerp(0.5, 0.3, cur.night);
    sunGlow.material.color.copy(cur.sunColor);
    sparkMat.uniforms.uColor.value.copy(cur.sunColor).lerp(WHITE, 0.35);
    sparkMat.uniforms.uOpacity.value = 0.22 + cur.sunPower * 0.10;
    moteMat.opacity = 0.18 + (1 - cur.night) * 0.34;
    foamMat.opacity = 0.34 + (1 - cur.night) * 0.42;
    foam2.material.opacity = foamMat.opacity * 0.55;
    for (const c of clouds) { c.sp.material.color.copy(cur.cloud); c.sp.material.opacity = cur.cloudOpacity * (c.s > 100 ? 1 : 0.62); }
    const lh = lighthouse.userData;
    lh.beamMat.uniforms.uOpacity.value = cur.beam * 0.5;
    lh.lantern.material.emissiveIntensity = 0.5 + cur.night * 3.2;
    lh.glow.material.opacity = 0.12 + cur.night * 0.85;
  }

  /* ---------------- per-frame ---------------- */
  function update(dt, s) {
    const dist = s.distance;
    const t = s.time;
    applyMood(dt);
    sky.uniforms.uTime.value = t;
    oceanUniforms.uTime.value = t;
    sparkMat.uniforms.uTime.value = t;
    normalMap.offset.set(t * 0.006, t * 0.011);
    roadTex.offset.x = (dist / 8) % 1;
    foamTex.offset.x = (dist * 0.02 + t * 0.06) % 1;
    foamTex.offset.y = Math.sin(t * 0.42) * 0.22;
    foam.position.z = -16.2 + Math.sin(t * 0.42) * 0.85;
    foam2.position.z = -19.5 + Math.sin(t * 0.42 + 1.1) * 1.3;

    for (const r of rails) r.mesh.position.x = wrapX(r.x0, dist, railSpan, 0.62);
    for (const p of palms) {
      p.mesh.position.x = wrapX(p.x0, dist);
      p.crown.rotation.z = Math.sin(t * 0.8 + p.phase) * 0.045 + s.speedNorm * 0.02;
      p.crown.rotation.x = Math.cos(t * 0.63 + p.phase) * 0.035;
    }
    for (const g of scatter) {
      for (let i = 0; i < g.items.length; i++) {
        const it = g.items[i];
        const x = wrapX(it.x0, dist);
        _p.set(x, it.y, it.z);
        const sway = Math.sin(t * 1.6 + it.x0) * 0.05 * s.speedNorm;
        _e.set(it.tilt + sway, it.rot, it.tilt * 0.6 + sway);
        _q.setFromEuler(_e);
        _s.set(it.sc, it.sc, it.sc);
        _m.compose(_p, _q, _s);
        g.im.setMatrixAt(i, _m);
      }
      g.im.instanceMatrix.needsUpdate = true;
    }

    farGroup.position.x = -dist * 0.045;
    if (farGroup.position.x < -150) farGroup.position.x += 150;
    lighthouse.userData.beams.rotation.y = t * 0.55;

    for (const c of clouds) {
      c.sp.position.x = wrapX(c.x0 + t * c.drift, dist * 0.06, 900, 0.5);
    }

    for (const g of gulls) {
      const a = t * g.sp + g.ph;
      const x = g.cx + Math.cos(a) * g.r - dist * 0.12;
      const wx = ((x + 200) % 400 + 400) % 400 - 200;
      g.mesh.position.set(wx, g.h + Math.sin(a * 2.3) * 0.7, g.cz + Math.sin(a) * g.r * 0.45);
      g.mesh.rotation.y = -a - Math.sign(g.sp) * Math.PI / 2;
      g.mesh.rotation.z = Math.sin(a * 2.3) * 0.12;
      const flap = Math.sin(t * g.flap + g.ph) * 0.62 + 0.18;
      for (const w of g.wings) w.group.rotation.x = w.side * flap;
    }

    // motes drift
    const mp = moteGeo.attributes.position.array;
    for (let i = 0; i < moteN; i++) {
      const d = moteData[i];
      d.x -= dt * (0.6 + s.velocity * 0.30) * d.sp;
      if (d.x < -18) { d.x = 18; d.y = rand(0.3, 6.5); d.z = rand(-9, 9); }
      mp[i * 3] = d.x;
      mp[i * 3 + 1] = d.y + Math.sin(t * d.sp + d.ph) * 0.35;
      mp[i * 3 + 2] = d.z + Math.cos(t * d.sp * 0.7 + d.ph) * 0.3;
    }
    moteGeo.attributes.position.needsUpdate = true;

    // wheel dust
    dustAccum += dt * (6 + s.velocity * 3.2);
    while (dustAccum > 1) {
      dustAccum -= 1;
      const d = dust[dustCursor];
      dustCursor = (dustCursor + 1) % dustN;
      d.life = 0; d.max = rand(0.5, 1.1);
      d.x = -0.66 + rand(-0.05, 0.05); d.y = 0.03; d.z = rand(-0.06, 0.06);
      d.vx = rand(-1.6, -0.4) - s.velocity * 0.16; d.vy = rand(0.25, 0.95); d.vz = rand(-0.35, 0.35);
    }
    const dp = dustGeo.attributes.position.array;
    for (let i = 0; i < dustN; i++) {
      const d = dust[i];
      if (d.life < d.max) {
        d.life += dt;
        d.x += (d.vx - s.velocity * 0.35) * dt;
        d.y += d.vy * dt; d.vy -= 1.1 * dt;
        d.z += d.vz * dt;
        if (d.y < 0.02) { d.y = 0.02; d.vy *= -0.22; }
      } else { d.y = -50; }
      dp[i * 3] = d.x; dp[i * 3 + 1] = d.y; dp[i * 3 + 2] = d.z;
    }
    dustGeo.attributes.position.needsUpdate = true;
    dustMat.opacity = 0.10 + s.speedNorm * 0.26;
  }

  applyMood(1);

  return {
    root, update, setMood, get mood() { return moodName; },
    sun, hemi, fill, sky, ocean, road, envTex,
    get lampOn() { return cur.lamp; },
    get night() { return cur.night; },
  };
}