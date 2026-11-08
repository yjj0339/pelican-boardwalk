import * as THREE from 'three';
import {
  TAU, clamp, lerp, rand, damp, placed, taperedTube,
  ribbonGeometry, solveIK, placeLimb, shadows, canvasTexture, featherBump, scarfTexture, pouchTexture,
} from './util.js';
import { BIKE } from './bike.js';

const HIP = new THREE.Vector3(-0.05, 1.00, 0);
const THIGH = 0.40, SHANK = 0.45;
const HEAD_AT = new THREE.Vector3(0.335, 1.855, 0);

function scaleSkinTexture() {
  return canvasTexture(128, 128, (ctx, w, h) => {
    ctx.fillStyle = '#9a9a9a'; ctx.fillRect(0, 0, w, h);
    for (let y = 0; y < h; y += 7) {
      for (let x = 0; x < w; x += 9) {
        const o = (y / 7) % 2 ? 4.5 : 0;
        ctx.fillStyle = 'rgba(255,255,255,.22)';
        ctx.beginPath(); ctx.roundRect(x + o + 1, y + 1, 7, 5, 2); ctx.fill();
        ctx.fillStyle = 'rgba(0,0,0,.20)';
        ctx.beginPath(); ctx.roundRect(x + o + 1, y + 4.4, 7, 1.6, 1); ctx.fill();
      }
    }
  }, { linear: true, repeat: [2, 3] });
}

function pouchGeometry(len, widthFn, depthFn, uSeg = 26, aSeg = 18) {
  const pos = [], uv = [], idx = [];
  for (let i = 0; i <= uSeg; i++) {
    const u = i / uSeg;
    const x = u * len;
    const y = -0.016 - u * 0.020;
    const w = widthFn(u), dep = depthFn(u);
    for (let j = 0; j <= aSeg; j++) {
      const a = (j / aSeg) * TAU;
      const ca = Math.cos(a), sa = Math.sin(a);
      // closed sac: top edge meets the jaw line, belly hangs below
      pos.push(x, y - dep * 0.5 * (1 + sa), w * ca);
      uv.push(u * 3, j / aSeg);
    }
  }
  for (let i = 0; i < uSeg; i++) {
    for (let j = 0; j < aSeg; j++) {
      const a = i * (aSeg + 1) + j, b = a + aSeg + 1;
      idx.push(a, b, a + 1, b, b + 1, a + 1);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}

function featherGeo(len, w, thick) {
  const c = new THREE.CatmullRomCurve3([
    new THREE.Vector3(0, 0, 0),
    new THREE.Vector3(-len * 0.45, 0.012, 0),
    new THREE.Vector3(-len, -0.02, 0),
  ]);
  return taperedTube(c, 10, (t) => w * (1 - t * 0.82) * (0.4 + 0.6 * Math.sin(Math.PI * Math.min(1, t * 1.6))), 6,
    () => ({ x: thick, y: 1 }));
}

function webbedFoot(material) {
  const g = new THREE.Group();
  // webbing: a flat fan with three toe lobes
  const shape = new THREE.Shape();
  shape.moveTo(-0.035, 0);
  shape.quadraticCurveTo(0.02, 0.062, 0.10, 0.052);
  shape.quadraticCurveTo(0.135, 0.036, 0.115, 0.012);
  shape.quadraticCurveTo(0.145, 0.006, 0.142, -0.012);
  shape.quadraticCurveTo(0.12, -0.03, 0.10, -0.05);
  shape.quadraticCurveTo(0.02, -0.062, -0.035, 0);
  const web = new THREE.Mesh(new THREE.ExtrudeGeometry(shape, { depth: 0.014, bevelEnabled: true, bevelSize: 0.005, bevelThickness: 0.004, bevelSegments: 2, curveSegments: 10 }), material);
  web.rotation.x = -Math.PI / 2;
  web.position.y = 0.006;
  g.add(web);
  for (const z of [-0.036, 0, 0.036]) {
    const toe = new THREE.Mesh(taperedTube(new THREE.CatmullRomCurve3([
      new THREE.Vector3(-0.02, 0.012, z * 0.4),
      new THREE.Vector3(0.06, 0.014, z * 0.85),
      new THREE.Vector3(0.125, 0.006, z),
    ]), 8, (t) => 0.011 * (1 - t * 0.6), 6), material);
    g.add(toe);
  }
  const hind = new THREE.Mesh(taperedTube(new THREE.LineCurve3(new THREE.Vector3(-0.02, 0.01, 0), new THREE.Vector3(-0.062, -0.004, 0.012)), 3, 0.008, 6), material);
  g.add(hind);
  return g;
}

export function createPelican() {
  const M = {
    body: new THREE.MeshPhysicalMaterial({
      color: 0xf7f2e6, roughness: 0.82, metalness: 0, sheen: 0.75, sheenRoughness: 0.65,
      sheenColor: new THREE.Color(0xffe9c9), bumpMap: featherBump(), bumpScale: 0.014,
    }),
    shade: new THREE.MeshPhysicalMaterial({
      color: 0xe4ddcd, roughness: 0.85, sheen: 0.5, sheenColor: new THREE.Color(0xffe9c9),
      bumpMap: featherBump(), bumpScale: 0.012,
    }),
    wing: new THREE.MeshPhysicalMaterial({
      color: 0x78838c, roughness: 0.74, sheen: 0.6, sheenColor: new THREE.Color(0xdfe8ee),
      bumpMap: featherBump(), bumpScale: 0.016,
    }),
    tip: new THREE.MeshStandardMaterial({ color: 0x39434c, roughness: 0.66, bumpMap: featherBump(), bumpScale: 0.02 }),
    bill: new THREE.MeshPhysicalMaterial({ color: 0xf3a63c, roughness: 0.4, clearcoat: 0.55, clearcoatRoughness: 0.35 }),
    billTip: new THREE.MeshStandardMaterial({ color: 0xd9762c, roughness: 0.45 }),
    pouch: new THREE.MeshPhysicalMaterial({
      color: 0xffffff, map: pouchTexture(), roughness: 0.46, sheen: 1, sheenRoughness: 0.4, sheenColor: new THREE.Color(0xff9d6b),
      emissive: 0x40170a, emissiveIntensity: 0.25, side: THREE.DoubleSide,
      bumpMap: featherBump(), bumpScale: 0.006,
    }),
    skin: new THREE.MeshStandardMaterial({ color: 0xf2d9a4, roughness: 0.55 }),
    legs: new THREE.MeshStandardMaterial({ color: 0xe79a5f, roughness: 0.62, bumpMap: scaleSkinTexture(), bumpScale: 0.02 }),
    feet: new THREE.MeshStandardMaterial({ color: 0xef9443, roughness: 0.55, bumpMap: scaleSkinTexture(), bumpScale: 0.015 }),
    eye: new THREE.MeshPhysicalMaterial({ color: 0x1b2a33, roughness: 0.12, clearcoat: 1, clearcoatRoughness: 0.05 }),
    eyeWhite: new THREE.MeshStandardMaterial({ color: 0xf2efe2, roughness: 0.3 }),
    glint: new THREE.MeshBasicMaterial({ color: 0xffffff }),
    scarf: new THREE.MeshStandardMaterial({ map: scarfTexture(), color: 0xffffff, roughness: 0.78, side: THREE.DoubleSide }),
  };

  const bird = new THREE.Group();

  /* ---------------- torso ---------------- */
  const torso = new THREE.Group();
  bird.add(torso);

  const bodyGeo = new THREE.SphereGeometry(0.30, 30, 22);
  {
    const p = bodyGeo.attributes.position;
    for (let i = 0; i < p.count; i++) {
      const x = p.getX(i), y = p.getY(i), z = p.getZ(i);
      const t = clamp((x / 0.30 + 1) / 2, 0, 1);   // 0 tail .. 1 breast
      const taper = 1 - 0.34 * Math.pow(1 - t, 1.7);
      p.setXYZ(i, x * 1.30, y * (0.98 + 0.10 * t), z * taper * 0.95);
    }
    bodyGeo.computeVertexNormals();
  }
  const bodyMesh = new THREE.Mesh(bodyGeo, M.body);
  bodyMesh.position.set(-0.10, 1.315, 0);
  bodyMesh.rotation.z = 0.06;
  torso.add(bodyMesh);

  const breast = new THREE.Mesh(new THREE.SphereGeometry(0.20, 22, 16), M.body);
  breast.scale.set(1.0, 1.02, 0.90);
  breast.position.set(0.075, 1.30, 0);
  torso.add(breast);

  const rump = new THREE.Mesh(new THREE.SphereGeometry(0.17, 18, 14), M.shade);
  rump.scale.set(1.25, 0.85, 0.85);
  rump.position.set(-0.36, 1.30, 0);
  torso.add(rump);

  // feathered thigh covers
  const thighPuffs = [];
  for (const s of [1, -1]) {
    const puff = new THREE.Mesh(new THREE.SphereGeometry(0.10, 16, 12), M.body);
    puff.scale.set(1.2, 0.95, 0.8);
    puff.position.set(HIP.x + 0.01, HIP.y + 0.075, s * 0.125);
    torso.add(puff);
    thighPuffs.push(puff);
  }

  /* ---------------- tail ---------------- */
  const tail = new THREE.Group();
  tail.position.set(-0.475, 1.30, 0);
  torso.add(tail);
  for (let i = 0; i < 6; i++) {
    const z = (i - 2.5) * 0.036;
    const f = new THREE.Mesh(featherGeo(0.24 - Math.abs(i - 2.5) * 0.022, 0.05, 0.22), i === 0 || i === 5 ? M.tip : M.shade);
    f.position.set(0, -0.012 * Math.abs(i - 2.5), z);
    f.rotation.y = z * 1.5;
    f.rotation.z = -0.16 - Math.abs(i - 2.5) * 0.03;
    tail.add(f);
  }

  /* ---------------- wings as riding arms ---------------- */
  // The wings reach forward and grip the handlebar; hands stay glued to the grips.
  const armsRoot = new THREE.Group();
  const arms = [];
  for (const s of [1, -1]) {
    for (let i = 0; i < 3; i++) {
      const f = new THREE.Mesh(featherGeo(0.13, 0.045, 0.22), M.wing);
      f.position.set(0.02 - i * 0.075, 1.43, s * 0.20);
      f.rotation.y = s * 0.10;
      f.rotation.z = 0.10;
      torso.add(f);
    }
    const upper = new THREE.Mesh(new THREE.CylinderGeometry(0.048, 0.068, 1, 10), M.wing);
    const fore = new THREE.Mesh(new THREE.CylinderGeometry(0.034, 0.048, 1, 10), M.wing);
    const elbowGrp = new THREE.Group();
    elbowGrp.add(new THREE.Mesh(new THREE.SphereGeometry(0.055, 12, 10), M.wing));
    for (let i = 0; i < 4; i++) {
      const f = new THREE.Mesh(featherGeo(0.20 - i * 0.02, 0.05, 0.18), i > 1 ? M.tip : M.wing);
      f.position.set(0, -0.03 - i * 0.010, s * (0.02 + i * 0.008));
      f.rotation.z = Math.PI / 2 + (i - 1.5) * 0.10;
      f.rotation.y = s * (0.15 + i * 0.06);
      elbowGrp.add(f);
    }
    const hand = new THREE.Group();
    const mitt = new THREE.Mesh(new THREE.SphereGeometry(0.048, 14, 12), M.wing);
    mitt.scale.set(1.0, 1.35, 1.0);
    hand.add(mitt);
    for (let i = 0; i < 3; i++) {
      const f = new THREE.Mesh(taperedTube(new THREE.CatmullRomCurve3([
        new THREE.Vector3(-0.022 + i * 0.022, 0.030, 0.032),
        new THREE.Vector3(-0.022 + i * 0.022, 0.048, 0.0),
        new THREE.Vector3(-0.022 + i * 0.022, 0.030, -0.036),
      ]), 6, (t) => 0.012 * (1 - t * 0.5), 6), M.wing);
      hand.add(f);
    }
    const thumb = new THREE.Mesh(taperedTube(new THREE.CatmullRomCurve3([
      new THREE.Vector3(0.030, -0.012, 0.020),
      new THREE.Vector3(0.046, 0.010, -0.010),
      new THREE.Vector3(0.030, 0.022, -0.032),
    ]), 6, (t) => 0.013 * (1 - t * 0.5), 6), M.wing);
    hand.add(thumb);
    armsRoot.add(upper, fore, elbowGrp, hand);
    shadows(upper); shadows(fore); shadows(elbowGrp); shadows(hand);
    arms.push({
      side: s, upper, fore, elbowGrp, hand,
      shoulder: new THREE.Vector3(0.12, 1.46, s * 0.235),
      elbowV: new THREE.Vector3(), handV: new THREE.Vector3(), target: new THREE.Vector3(),
    });
  }

  /* ---------------- neck ---------------- */
  const neckCurve = new THREE.CatmullRomCurve3([
    new THREE.Vector3(0.045, 1.43, 0),
    new THREE.Vector3(0.155, 1.52, 0),
    new THREE.Vector3(0.125, 1.65, 0),
    new THREE.Vector3(0.215, 1.775, 0),
    HEAD_AT.clone(),
  ]);
  const neck = new THREE.Mesh(taperedTube(neckCurve, 26, (t) => lerp(0.125, 0.072, Math.pow(t, 0.75)), 16), M.body);
  torso.add(neck);

  /* ---------------- head ---------------- */
  const headPivot = new THREE.Group();
  headPivot.position.copy(HEAD_AT);
  bird.add(headPivot);

  const head = new THREE.Mesh(new THREE.SphereGeometry(0.125, 24, 18), M.body);
  head.scale.set(1.30, 1.02, 0.96);
  head.position.set(0.04, 0.05, 0);
  headPivot.add(head);

  const crown = new THREE.Mesh(new THREE.SphereGeometry(0.085, 16, 12), M.shade);
  crown.scale.set(1.1, 0.55, 0.85);
  crown.position.set(-0.015, 0.115, 0);
  headPivot.add(crown);

  for (let i = 0; i < 5; i++) {
    const f = new THREE.Mesh(featherGeo(0.10 + i * 0.008, 0.028, 0.3), M.shade);
    f.position.set(-0.075, 0.075 - i * 0.012, (i - 2) * 0.022);
    f.rotation.y = (i - 2) * 0.16;
    f.rotation.z = 0.42;
    headPivot.add(f);
  }

  // eyes
  const eyes = [];
  for (const s of [1, -1]) {
    const eyeGrp = new THREE.Group();
    eyeGrp.position.set(0.072, 0.062, s * 0.100);
    headPivot.add(eyeGrp);
    const patch = new THREE.Mesh(new THREE.SphereGeometry(0.034, 14, 12), M.skin);
    patch.scale.set(1.25, 1.0, 0.40);
    patch.position.set(0.012, -0.002, s * 0.002);
    eyeGrp.add(patch);
    const ball = new THREE.Group();
    eyeGrp.add(ball);
    const sclera = new THREE.Mesh(new THREE.SphereGeometry(0.021, 16, 12), M.eyeWhite);
    sclera.scale.set(1, 1, 0.72);
    ball.add(sclera);
    const iris = new THREE.Mesh(new THREE.SphereGeometry(0.014, 14, 12), M.eye);
    iris.position.set(0.006, 0.001, s * 0.013);
    iris.scale.set(1, 1, 0.7);
    ball.add(iris);
    const glint = new THREE.Mesh(new THREE.SphereGeometry(0.0045, 8, 6), M.glint);
    glint.position.set(0.011, 0.007, s * 0.020);
    ball.add(glint);
    const lidLine = new THREE.Mesh(placed(new THREE.BoxGeometry(0.042, 0.005, 0.010), 0.004, 0.001, s * 0.016), M.shade);
    lidLine.visible = false;
    eyeGrp.add(lidLine);
    eyes.push({ group: eyeGrp, ball, lidLine, side: s });
  }

  /* ---------------- beak + pouch ---------------- */
  const beak = new THREE.Group();
  beak.position.set(0.125, 0.012, 0);
  beak.rotation.z = -0.10;
  headPivot.add(beak);

  const upperCurve = new THREE.CatmullRomCurve3([
    new THREE.Vector3(0, 0.006, 0),
    new THREE.Vector3(0.24, 0.004, 0),
    new THREE.Vector3(0.48, -0.012, 0),
    new THREE.Vector3(0.66, -0.038, 0),
  ]);
  const upper = new THREE.Mesh(taperedTube(upperCurve, 24, (t) => lerp(0.060, 0.016, Math.pow(t, 0.8)), 12,
    (t) => ({ x: lerp(0.78, 0.55, t), y: lerp(1.0, 0.55, t) })), M.bill);
  beak.add(upper);
  const hook = new THREE.Mesh(new THREE.ConeGeometry(0.019, 0.05, 10), M.billTip);
  hook.position.set(0.66, -0.056, 0);
  hook.rotation.z = 0.5;
  beak.add(hook);
  for (const s of [1, -1]) {
    const nostril = new THREE.Mesh(placed(new THREE.BoxGeometry(0.030, 0.005, 0.004), 0.085, 0.020, s * 0.028, 0, 0, -0.1), M.billTip);
    beak.add(nostril);
  }

  const jaw = new THREE.Group();
  beak.add(jaw);
  const lowerCurve = new THREE.CatmullRomCurve3([
    new THREE.Vector3(0.005, -0.024, 0),
    new THREE.Vector3(0.26, -0.032, 0),
    new THREE.Vector3(0.50, -0.046, 0),
    new THREE.Vector3(0.643, -0.060, 0),
  ]);
  const lower = new THREE.Mesh(taperedTube(lowerCurve, 20, (t) => lerp(0.042, 0.011, t), 10,
    () => ({ x: 0.34, y: 0.95 })), M.bill);
  jaw.add(lower);

  const pouch = new THREE.Mesh(pouchGeometry(0.615,
    (u) => 0.055 * (1 - u * 0.62),
    (u) => 0.23 * Math.pow(Math.sin(Math.PI * Math.pow(u, 0.62)), 0.6)
  ), M.pouch);
  pouch.position.set(0.012, -0.014, 0);
  jaw.add(pouch);

  /* ---------------- scarf ---------------- */
  const scarf = new THREE.Group();
  scarf.position.set(0.145, 1.545, 0);
  bird.add(scarf);
  const band = new THREE.Mesh(new THREE.TorusGeometry(0.104, 0.028, 10, 22), M.scarf);
  band.rotation.set(Math.PI / 2, 0, -0.40);
  band.scale.set(1, 1, 1.15);
  scarf.add(band);
  const knot = new THREE.Mesh(new THREE.SphereGeometry(0.040, 14, 12), M.scarf);
  knot.scale.set(1.1, 0.85, 0.9);
  knot.position.set(-0.045, -0.03, 0.095);
  scarf.add(knot);

  const ribbons = [];
  for (let i = 0; i < 2; i++) {
    const segs = 22;
    const geo = ribbonGeometry(segs);
    const mesh = new THREE.Mesh(geo, M.scarf);
    mesh.frustumCulled = false;
    scarf.add(mesh);
    ribbons.push({ mesh, geo, segs, len: i ? 0.66 : 0.95, w: i ? 0.072 : 0.095, phase: i * 1.7, z: i ? 0.055 : 0.115, sideSpread: i ? -0.03 : 0.06 });
  }

  /* ---------------- legs ---------------- */
  // Legs live outside the bobbing torso group so the feet stay glued to the pedals.
  const legsRoot = new THREE.Group();
  const legs = [];
  for (const s of [1, -1]) {
    const thigh = new THREE.Mesh(new THREE.CylinderGeometry(0.052, 0.075, 1, 10), M.legs);
    const shank = new THREE.Mesh(new THREE.CylinderGeometry(0.032, 0.045, 1, 10), M.legs);
    const knee = new THREE.Mesh(new THREE.SphereGeometry(0.047, 12, 10), M.legs);
    const ankle = new THREE.Mesh(new THREE.SphereGeometry(0.033, 10, 8), M.legs);
    const foot = webbedFoot(M.feet);
    foot.scale.setScalar(1.15);
    legsRoot.add(thigh, shank, knee, ankle, foot);
    shadows(thigh); shadows(shank); shadows(knee); shadows(ankle); shadows(foot);
    legs.push({
      side: s, thigh, shank, knee, ankle, foot,
      hip: new THREE.Vector3(HIP.x, HIP.y, s * 0.14),
      kneeV: new THREE.Vector3(), ankleV: new THREE.Vector3(),
      target: new THREE.Vector3(),
    });
  }

  shadows(bird, true, false);
  pouch.castShadow = false;
  neck.castShadow = true;

  /* ---------------- animation state ---------------- */
  let blinkTimer = rand(1.5, 4);
  let blink = 0;
  let flapTimer = rand(4, 8);
  let flapT = 99;
  let lookTimer = rand(3, 7);
  let lookT = 99;
  let lookDir = 1;
  let pouchWobble = 0;
  let waveT = 99;
  const _hip = new THREE.Vector3(), _pedal = new THREE.Vector3();
  const _shoulder = new THREE.Vector3(), _dirv = new THREE.Vector3(), _gripAxis = new THREE.Vector3();
  const UP = new THREE.Vector3(0, 1, 0), WAVE_AXIS = new THREE.Vector3(0, 0.2, 1);

  function startle() { flapT = 0; waveT = 0; flapTimer = rand(6, 10); pouchWobble = 1; lookT = 0; lookDir = 1; }
  function bump() { pouchWobble = Math.max(pouchWobble, 0.6); }

  function update(dt, s, pedalTargets, gripTargets) {
    const t = s.time;
    const cad = s.crankAngle;
    const effort = s.speedNorm;

    // whole-bird cadence bob
    bird.position.y = Math.sin(cad * 2) * 0.017 * (0.5 + effort * 0.8);
    bird.position.x = Math.sin(cad) * 0.006;
    bird.rotation.z = -0.035 * effort + Math.sin(cad * 2 + 0.6) * 0.014;
    bird.rotation.x = Math.sin(cad) * 0.018;

    torso.rotation.z = Math.sin(cad * 2 + 1.2) * 0.012;
    torso.position.y = Math.sin(cad * 2 + 0.4) * 0.008;

    // head: stabilised against the bob, occasional nods and looks
    headPivot.rotation.z = -bird.rotation.z * 0.55 + Math.sin(cad * 2 + 2.2) * 0.022 + Math.sin(t * 0.7) * 0.02;
    headPivot.position.y = HEAD_AT.y - bird.position.y * 0.45;
    lookT += dt; lookTimer -= dt;
    if (lookTimer <= 0) { lookT = 0; lookTimer = rand(5, 11); lookDir = Math.random() < 0.5 ? -1 : 1; }
    const look = lookT < 2.2 ? Math.sin(Math.min(1, lookT / 2.2) * Math.PI) : 0;
    headPivot.rotation.y = damp(headPivot.rotation.y, look * lookDir * 0.34, 8, dt);
    headPivot.rotation.x = look * 0.06;

    // beak + pouch
    const gape = (lookT < 2.2 ? look * 0.10 : 0) + (flapT < 1.2 ? Math.max(0, Math.sin(flapT * 9)) * 0.10 : 0);
    jaw.rotation.z = damp(jaw.rotation.z, -gape, 10, dt);
    pouchWobble = Math.max(0, pouchWobble - dt * 1.6);
    const jig = Math.sin(cad * 2 + 1.0) * 0.045 + Math.sin(t * 17) * 0.07 * pouchWobble;
    pouch.scale.set(1 + jig * 0.25, 1 + jig, 1 + jig * 0.5);
    pouch.rotation.z = Math.sin(cad * 2 + 0.4) * 0.02;

    // blink
    blinkTimer -= dt;
    if (blinkTimer <= 0) { blink = 0.16; blinkTimer = rand(2.4, 6.2); }
    blink = Math.max(0, blink - dt);
    const closed = blink > 0 ? Math.sin((blink / 0.16) * Math.PI) : 0;
    for (const e of eyes) {
      e.ball.scale.y = lerp(1, 0.08, closed);
      e.ball.visible = closed < 0.82;
      e.lidLine.visible = closed >= 0.55;
    }

    // shoulders shrug now and then; a startle lifts one hand into a wave
    flapTimer -= dt; flapT += dt; waveT += dt;
    if (flapTimer <= 0) { flapT = 0; flapTimer = rand(7, 13); }
    const shrug = flapT < 1.7 ? Math.sin(Math.min(1, flapT / 1.7) * Math.PI) * 0.045 : 0;
    const waveEnv = waveT < 1.7 ? Math.sin(Math.min(1, waveT / 1.7) * Math.PI) : 0;
    for (const a of arms) {
      const grip = gripTargets[a.side > 0 ? 1 : 0];
      a.target.copy(grip);
      if (a.side > 0 && waveEnv > 0) {
        a.target.x = lerp(a.target.x, 0.06, waveEnv);
        a.target.y = lerp(a.target.y, 2.12, waveEnv);
        a.target.z = lerp(a.target.z, 0.50 + Math.sin(waveT * 13) * 0.07, waveEnv);
      }
      _shoulder.copy(a.shoulder);
      _shoulder.y += bird.position.y * 0.6 + torso.position.y * 0.4 + shrug;
      solveIK(_shoulder, a.target, 0.22, 0.20, a.elbowV, a.handV, -1);
      a.elbowV.z = a.shoulder.z + a.side * 0.13;
      placeLimb(a.upper, _shoulder, a.elbowV);
      placeLimb(a.fore, a.elbowV, a.handV);
      a.elbowGrp.position.copy(a.elbowV);
      _dirv.subVectors(a.handV, a.elbowV).normalize();
      a.elbowGrp.quaternion.setFromUnitVectors(UP, _dirv);
      a.hand.position.copy(a.handV);
      _gripAxis.set(-a.side * 0.5, 0, 0.87).normalize();
      if (a.side > 0) _gripAxis.lerp(WAVE_AXIS, waveEnv).normalize();
      a.hand.quaternion.setFromUnitVectors(UP, _gripAxis);
    }
    tail.rotation.z = Math.sin(cad * 2 + 2.6) * 0.05 - shrug * 2.0;
    tail.rotation.y = Math.sin(t * 0.9) * 0.05;

    // legs: two-bone IK onto the pedals
    for (let i = 0; i < legs.length; i++) {
      const L = legs[i];
      const src = pedalTargets[i];
      L.target.set(src.x, src.y + 0.004, src.z);
      _hip.copy(L.hip);
      _hip.y += bird.position.y * 0.55 + torso.position.y * 0.4;
      _hip.x += bird.position.x;
      solveIK(_hip, L.target, THIGH, SHANK, L.kneeV, L.ankleV);
      placeLimb(L.thigh, _hip, L.kneeV);
      L.thigh.scale.x = L.thigh.scale.z = 1;
      placeLimb(L.shank, L.kneeV, L.ankleV);
      L.knee.position.copy(L.kneeV);
      L.ankle.position.copy(L.ankleV);
      L.ankle.position.y += 0.026;
      L.foot.position.copy(L.ankleV);
      const shankAng = Math.atan2(L.ankleV.y - L.kneeV.y, L.ankleV.x - L.kneeV.x);
      L.foot.rotation.z = clamp((shankAng + Math.PI / 2) * 0.35, -0.42, 0.30) + Math.sin(cad + i * Math.PI) * 0.06;
      L.foot.rotation.y = L.side * 0.06;
      thighPuffs[i].position.set(_hip.x + 0.012, _hip.y + 0.07, L.side * 0.125);
      thighPuffs[i].rotation.z = clamp((L.kneeV.y - _hip.y) * 0.5, -0.4, 0.4);
    }

    // scarf ribbons flutter in the slipstream
    const wind = 0.35 + effort * 1.15;
    for (const r of ribbons) {
      const pos = r.geo.attributes.position;
      const arr = pos.array;
      for (let i = 0; i <= r.segs; i++) {
        const u = i / r.segs;
        const wob = Math.sin(u * 6.2 - t * (7 + effort * 7) + r.phase) * 0.10 * u * wind;
        const wob2 = Math.cos(u * 4.6 - t * (5.5 + effort * 5) + r.phase * 1.3) * 0.11 * u * wind;
        const x = -0.045 - u * r.len * (0.82 + effort * 0.30);
        const y = -0.03 + u * u * 0.16 + wob - u * 0.045;
        const z = r.z + wob2 + u * r.sideSpread;
        const twist = Math.sin(u * 3.6 - t * 6 + r.phase) * 1.15 * u;
        const hw = r.w * 0.5 * (1 - u * 0.42);
        const wy = Math.cos(twist) * hw, wz = Math.sin(twist) * hw;
        const k = i * 6;
        arr[k] = x; arr[k + 1] = y - wy; arr[k + 2] = z - wz;
        arr[k + 3] = x; arr[k + 4] = y + wy; arr[k + 5] = z + wz;
      }
      pos.needsUpdate = true;
      r.geo.computeVertexNormals();
    }
    band.rotation.z = -0.40 + Math.sin(t * 3) * 0.01;
    knot.scale.setScalar(1 + Math.sin(t * 6) * 0.02 * wind);
  }

  return { group: bird, legsRoot, armsRoot, update, startle, bump, headPivot, beak, pouch, arms, materials: M };
}