import * as THREE from 'three';
import {
  TAU, clamp, lerp, rand, mergeGeos, placed, taperedTube, tubeBetween,
  shadows, treadTexture, chainTexture, wickerTexture, glowTexture, ribbonGeometry,
} from './util.js';

export const BIKE = {
  R: 0.40,
  rearAxle: new THREE.Vector3(-0.66, 0.40, 0),
  frontAxle: new THREE.Vector3(0.66, 0.40, 0),
  BB: new THREE.Vector3(0, 0.34, 0),
  seatTop: new THREE.Vector3(-0.26, 0.92, 0),
  headTop: new THREE.Vector3(0.50, 0.95, 0),
  headBottom: new THREE.Vector3(0.575, 0.74, 0),
  saddle: new THREE.Vector3(-0.285, 0.985, 0),
  crank: 0.17,
  pedalZ: 0.145,
  gear: 2.15,
};

function materials() {
  const paint = new THREE.MeshPhysicalMaterial({
    color: 0x2f9c92, metalness: 0.25, roughness: 0.32, clearcoat: 1, clearcoatRoughness: 0.14,
  });
  const cream = new THREE.MeshPhysicalMaterial({
    color: 0xf2e3c8, metalness: 0.15, roughness: 0.38, clearcoat: 0.8, clearcoatRoughness: 0.25,
  });
  const chrome = new THREE.MeshStandardMaterial({ color: 0xe6ecef, metalness: 1, roughness: 0.17 });
  const steel = new THREE.MeshStandardMaterial({ color: 0x8d979e, metalness: 0.95, roughness: 0.36 });
  const dark = new THREE.MeshStandardMaterial({ color: 0x363c43, metalness: 0.7, roughness: 0.5 });
  const tread = treadTexture();
  const rubber = new THREE.MeshStandardMaterial({
    color: 0x1b1e22, roughness: 0.88, metalness: 0.04, map: tread, bumpMap: tread, bumpScale: 0.35,
  });
  const leather = new THREE.MeshPhysicalMaterial({ color: 0x7c4a2a, roughness: 0.5, clearcoat: 0.45, clearcoatRoughness: 0.5 });
  const brass = new THREE.MeshStandardMaterial({ color: 0xd8a44a, metalness: 1, roughness: 0.24 });
  const chainMap = chainTexture();
  chainMap.repeat.set(46, 1);
  const chain = new THREE.MeshStandardMaterial({ color: 0x9aa2aa, metalness: 0.9, roughness: 0.42, map: chainMap });
  const wickerMap = wickerTexture();
  const wicker = new THREE.MeshStandardMaterial({ color: 0xd9b183, roughness: 0.82, map: wickerMap, bumpMap: wickerMap, bumpScale: 0.12 });
  return { paint, cream, chrome, steel, dark, rubber, leather, brass, chain, chainMap, wicker };
}

function buildWheel(M) {
  const g = new THREE.Group();
  const R = BIKE.R;

  const tire = new THREE.Mesh(new THREE.TorusGeometry(R - 0.047, 0.047, 12, 56), M.rubber);
  g.add(tire);

  const rim = new THREE.Mesh(new THREE.TorusGeometry(R - 0.058, 0.019, 8, 56), M.chrome);
  g.add(rim);
  const rimInner = new THREE.Mesh(new THREE.TorusGeometry(R - 0.078, 0.008, 6, 48), M.steel);
  g.add(rimInner);

  const spokes = [];
  const n = 20;
  for (let i = 0; i < n; i++) {
    const a = (i / n) * TAU;
    const side = i % 2 ? 1 : -1;
    const a2 = a + side * 0.16;
    spokes.push(tubeBetween(
      new THREE.Vector3(Math.cos(a) * 0.031, Math.sin(a) * 0.031, side * 0.026),
      new THREE.Vector3(Math.cos(a2) * (R - 0.075), Math.sin(a2) * (R - 0.075), -side * 0.006),
      0.0042, 0.0042, 5
    ));
  }
  g.add(new THREE.Mesh(mergeGeos(spokes), M.chrome));

  const hub = new THREE.Mesh(placed(new THREE.CylinderGeometry(0.033, 0.033, 0.098, 14), 0, 0, 0, Math.PI / 2), M.chrome);
  g.add(hub);
  for (const z of [-0.055, 0.055]) {
    g.add(new THREE.Mesh(placed(new THREE.CylinderGeometry(0.017, 0.017, 0.016, 8), 0, 0, z, Math.PI / 2), M.dark));
  }
  // valve stem
  g.add(new THREE.Mesh(placed(new THREE.CylinderGeometry(0.006, 0.006, 0.03, 6), 0, R - 0.085, 0), M.brass));
  // spoke reflector
  const refl = new THREE.Mesh(placed(new THREE.BoxGeometry(0.055, 0.028, 0.008), 0.16, 0.11, 0.02), new THREE.MeshStandardMaterial({ color: 0xffb347, emissive: 0x552200, roughness: 0.35 }));
  g.add(refl);
  return g;
}

function buildFender(M, radius, arc, mat) {
  const geo = new THREE.TorusGeometry(radius, 0.022, 6, 40, arc);
  const shell = new THREE.Mesh(geo, mat);
  shell.scale.set(1, 1, 2.6);
  const stays = [];
  for (const s of [-1, 1]) {
    stays.push(tubeBetween(
      new THREE.Vector3(Math.cos(arc * 0.12) * radius * s, Math.sin(arc * 0.12) * radius, 0),
      new THREE.Vector3(0, 0, s * 0.045), 0.005, 0.005, 5
    ));
  }
  const grp = new THREE.Group();
  grp.add(shell, new THREE.Mesh(mergeGeos(stays), M.chrome));
  return grp;
}

export function createBicycle() {
  const M = materials();
  const root = new THREE.Group();
  const body = new THREE.Group();          // leans / bounces
  root.add(body);

  const { rearAxle: RA, frontAxle: FA, BB, seatTop: ST, headTop: HT, headBottom: HB } = BIKE;

  /* ---- rear triangle + main frame ---- */
  const tubes = [];
  const tr = 0.021;
  tubes.push(tubeBetween(BB, ST, tr * 1.12, tr));                       // seat tube
  tubes.push(tubeBetween(ST, HT, tr, tr * 0.95));                       // top tube
  tubes.push(tubeBetween(BB, HB, tr * 1.2, tr * 1.05));                 // down tube
  tubes.push(tubeBetween(HB, HT, tr * 1.25, tr * 1.25));                // head tube
  for (const s of [-1, 1]) {
    const off = new THREE.Vector3(0, 0, s * 0.045);
    tubes.push(tubeBetween(BB.clone().add(off), RA.clone().add(off), 0.014, 0.012));   // chain stay
    tubes.push(tubeBetween(ST.clone().add(new THREE.Vector3(0, -0.03, s * 0.03)), RA.clone().add(off), 0.012, 0.010)); // seat stay
  }
  const frame = new THREE.Mesh(mergeGeos(tubes), M.paint);
  body.add(frame);

  // chrome lugs at joints
  const lugs = [];
  for (const p of [BB, ST, HB, HT]) lugs.push(placed(new THREE.TorusGeometry(0.028, 0.006, 6, 16), p.x, p.y, p.z, Math.PI / 2, 0, 0));
  lugs.push(placed(new THREE.SphereGeometry(0.031, 12, 10), BB.x, BB.y, BB.z, 0, 0, 0, 1, 1, 1.7));
  body.add(new THREE.Mesh(mergeGeos(lugs), M.chrome));

 // head badge
  const badge = new THREE.Mesh(placed(new THREE.CircleGeometry(0.019, 16), HT.x + 0.012, HT.y - 0.07, 0.0245, 0, 0.34, 0), M.brass);
  body.add(badge);

  /* ---- wheels ---- */
  const rearWheel = buildWheel(M);
  rearWheel.position.copy(RA);
  body.add(rearWheel);

  const rearCog = new THREE.Mesh(placed(new THREE.CylinderGeometry(0.052, 0.052, 0.012, 22), RA.x, RA.y, 0.075, Math.PI / 2), M.dark);
  body.add(rearCog);
  const cogTeeth = [];
  for (let i = 0; i < 18; i++) {
    const a = (i / 18) * TAU;
    cogTeeth.push(placed(new THREE.BoxGeometry(0.012, 0.014, 0.011), RA.x + Math.cos(a) * 0.055, RA.y + Math.sin(a) * 0.055, 0.075, 0, 0, a));
  }
  body.add(new THREE.Mesh(mergeGeos(cogTeeth), M.steel));

  /* ---- steering assembly (rotates about the head axis) ---- */
  const steer = new THREE.Group();
  steer.position.copy(HB);
  const steerContent = new THREE.Group();
  steerContent.position.copy(HB).negate();
  steer.add(steerContent);
  body.add(steer);
  const steerAxis = new THREE.Vector3().subVectors(HT, HB).normalize();

  const forkBlades = [];
  for (const s of [-1, 1]) {
    const c = new THREE.CatmullRomCurve3([
      HB.clone().add(new THREE.Vector3(0, 0, s * 0.042)),
      new THREE.Vector3(0.615, 0.60, s * 0.045),
      new THREE.Vector3(0.645, 0.49, s * 0.045),
      FA.clone().add(new THREE.Vector3(0, 0, s * 0.045)),
    ]);
    forkBlades.push(taperedTube(c, 14, (t) => lerp(0.017, 0.011, t), 8));
  }
  forkBlades.push(placed(new THREE.CylinderGeometry(0.026, 0.026, 0.10, 12), HB.x, HB.y + 0.03, 0, 0, 0, -0.35));
  steerContent.add(new THREE.Mesh(mergeGeos(forkBlades), M.chrome));

  const frontWheel = buildWheel(M);
  frontWheel.position.copy(FA);
  steerContent.add(frontWheel);

  const frontFender = buildFender(M, BIKE.R + 0.012, Math.PI * 0.62, M.cream);
  frontFender.position.copy(FA);
  frontFender.rotation.z = Math.PI * 0.19;
  steerContent.add(frontFender);

  // handlebar
  const barCurve = new THREE.CatmullRomCurve3([
    new THREE.Vector3(0.30, 1.175, -0.27),
    new THREE.Vector3(0.40, 1.205, -0.17),
    new THREE.Vector3(0.465, 1.21, 0),
    new THREE.Vector3(0.40, 1.205, 0.17),
    new THREE.Vector3(0.30, 1.175, 0.27),
  ]);
  const bar = new THREE.Mesh(taperedTube(barCurve, 30, 0.014, 9), M.chrome);
  steerContent.add(bar);
  const stem = new THREE.Mesh(tubeBetween(HT.clone(), new THREE.Vector3(0.462, 1.205, 0), 0.02, 0.018), M.chrome);
  steerContent.add(stem);
  const grips = [];
  for (const s of [-1, 1]) {
    const grip = new THREE.Mesh(placed(new THREE.CylinderGeometry(0.021, 0.019, 0.115, 12), 0.313, 1.182, s * 0.245, Math.PI / 2, 0, 0.52 * s), M.leather);
    steerContent.add(grip);
    grips.push(grip);
    const lever = new THREE.Mesh(placed(new THREE.BoxGeometry(0.085, 0.014, 0.016), 0.372, 1.158, s * 0.205, 0, 0, -0.3), M.chrome);
    steerContent.add(lever);
  }

  // handlebar streamers
  const streamers = [];
  const streamerMats = [
    new THREE.MeshStandardMaterial({ color: 0xe2574c, roughness: 0.7, side: THREE.DoubleSide }),
    new THREE.MeshStandardMaterial({ color: 0x57d6c4, roughness: 0.7, side: THREE.DoubleSide }),
  ];
  for (const sd of [-1, 1]) {
    const segs = 12;
    const geo = ribbonGeometry(segs);
    const mesh = new THREE.Mesh(geo, streamerMats[sd > 0 ? 0 : 1]);
    mesh.frustumCulled = false;
    steerContent.add(mesh);
    streamers.push({ geo, segs, side: sd, phase: sd * 2.1 });
  }

  // bell
  const bell = new THREE.Group();
  bell.position.set(0.392, 1.223, 0.185);
  const dome = new THREE.Mesh(new THREE.SphereGeometry(0.036, 18, 12, 0, TAU, 0, Math.PI * 0.55), M.brass);
  bell.add(dome);
  bell.add(new THREE.Mesh(placed(new THREE.CylinderGeometry(0.037, 0.037, 0.008, 18), 0, -0.004, 0), M.brass));
  const leverKnob = new THREE.Mesh(placed(new THREE.SphereGeometry(0.011, 10, 8), -0.034, 0.012, 0), M.dark);
  bell.add(leverKnob);
  steerContent.add(bell);

  // head lamp
  const lamp = new THREE.Group();
  lamp.position.set(0.60, 0.80, 0);
  const lampBody = new THREE.Mesh(placed(new THREE.CylinderGeometry(0.045, 0.038, 0.07, 18), 0, 0, 0, 0, 0, Math.PI / 2), M.chrome);
  lamp.add(lampBody);
  const lensMat = new THREE.MeshStandardMaterial({ color: 0xfff2cf, emissive: 0xffd489, emissiveIntensity: 0.6, roughness: 0.25 });
  const lens = new THREE.Mesh(placed(new THREE.CircleGeometry(0.042, 20), 0.036, 0, 0, 0, Math.PI / 2, 0), lensMat);
  lamp.add(lens);
  const lampGlow = new THREE.Sprite(new THREE.SpriteMaterial({
    map: glowTexture('rgba(255,214,150,1)', 'rgba(255,190,120,0)'),
    blending: THREE.AdditiveBlending, transparent: true, depthWrite: false, opacity: 0.0,
  }));
  lampGlow.scale.set(0.55, 0.55, 1);
  lampGlow.position.set(0.06, 0, 0);
  lamp.add(lampGlow);
  steerContent.add(lamp);

  /* ---- basket + fish ---- */
  const basket = new THREE.Group();
  basket.position.set(0.60, 1.02, 0);
  const basketBody = new THREE.Mesh(new THREE.CylinderGeometry(0.165, 0.125, 0.185, 20, 1, true), M.wicker);
  basketBody.material.side = THREE.DoubleSide;
  basket.add(basketBody);
  const basketRim = new THREE.Mesh(placed(new THREE.TorusGeometry(0.166, 0.012, 6, 24), 0, 0.092, 0, Math.PI / 2), M.wicker);
  basket.add(basketRim);
  const basketFloor = new THREE.Mesh(placed(new THREE.CircleGeometry(0.126, 20), 0, -0.09, 0, -Math.PI / 2), M.wicker);
  basket.add(basketFloor);
  for (const s of [-1, 1]) {
    basket.add(new THREE.Mesh(tubeBetween(new THREE.Vector3(-0.05, 0.09, s * 0.14), new THREE.Vector3(-0.14, 0.02, s * 0.05), 0.008, 0.008, 6), M.steel));
  }
  steerContent.add(basket);

  const fish = new THREE.Group();
  fish.position.set(0.02, 0.075, 0.01);
  fish.rotation.set(0.2, 0.3, 0.42);
  const fishMat = new THREE.MeshPhysicalMaterial({ color: 0x9fc4d8, metalness: 0.55, roughness: 0.28, clearcoat: 0.9, iridescence: 0.7, iridescenceIOR: 1.6 });
  const fishBody = new THREE.Mesh(new THREE.SphereGeometry(0.055, 16, 12), fishMat);
  fishBody.scale.set(1.85, 0.78, 0.5);
  fish.add(fishBody);
  const tail = new THREE.Mesh(new THREE.ConeGeometry(0.045, 0.09, 4), fishMat);
  tail.position.set(-0.13, 0.01, 0); tail.rotation.z = Math.PI / 2; tail.scale.set(1, 1, 0.35);
  fish.add(tail);
  const fin = new THREE.Mesh(new THREE.ConeGeometry(0.022, 0.05, 4), fishMat);
  fin.position.set(0.01, 0.045, 0); fin.scale.set(1, 1, 0.3);
  fish.add(fin);
  fish.add(new THREE.Mesh(placed(new THREE.SphereGeometry(0.009, 8, 8), 0.075, 0.012, 0.022), new THREE.MeshStandardMaterial({ color: 0x16222b, roughness: 0.2 })));
  basket.add(fish);

  /* ---- saddle ---- */
  const saddleGrp = new THREE.Group();
  saddleGrp.position.copy(BIKE.saddle);
  const saddleShape = new THREE.Mesh(new THREE.SphereGeometry(0.09, 20, 14), M.leather);
  saddleShape.scale.set(1.65, 0.42, 0.95);
  saddleShape.position.set(0.01, 0.012, 0);
  saddleGrp.add(saddleShape);
  const nose = new THREE.Mesh(new THREE.SphereGeometry(0.045, 14, 10), M.leather);
  nose.scale.set(1.9, 0.4, 0.72); nose.position.set(0.15, 0.006, 0);
  saddleGrp.add(nose);
  for (const s of [-1, 1]) {
    const spring = new THREE.Mesh(new THREE.TorusGeometry(0.022, 0.005, 5, 14, TAU * 0.8), M.chrome);
    spring.position.set(-0.09, -0.045, s * 0.045); spring.rotation.y = Math.PI / 2;
    saddleGrp.add(spring);
    saddleGrp.add(new THREE.Mesh(tubeBetween(new THREE.Vector3(-0.08, -0.05, s * 0.04), new THREE.Vector3(0.06, -0.035, s * 0.02), 0.006, 0.006, 6), M.chrome));
  }
  body.add(saddleGrp);
  body.add(new THREE.Mesh(tubeBetween(ST.clone(), BIKE.saddle.clone().add(new THREE.Vector3(0, -0.04, 0)), 0.016, 0.016), M.chrome));

  const rearFender = buildFender(M, BIKE.R + 0.012, Math.PI * 0.72, M.cream);
  rearFender.position.copy(RA);
  rearFender.rotation.z = Math.PI * 0.06;
  body.add(rearFender);
  const rearLight = new THREE.Mesh(placed(new THREE.BoxGeometry(0.02, 0.035, 0.05), RA.x - 0.05, RA.y + BIKE.R + 0.02, 0), new THREE.MeshStandardMaterial({ color: 0xd93a2b, emissive: 0x8c1408, emissiveIntensity: 0.7, roughness: 0.3 }));
  body.add(rearLight);

  /* ---- crank + chainring + pedals ---- */
  const crank = new THREE.Group();
  crank.position.copy(BB);
  body.add(crank);

  const chainring = new THREE.Mesh(placed(new THREE.CylinderGeometry(0.113, 0.113, 0.008, 30), 0, 0, 0.075, Math.PI / 2), M.steel);
  crank.add(chainring);
  const teeth = [];
  for (let i = 0; i < 30; i++) {
    const a = (i / 30) * TAU;
    teeth.push(placed(new THREE.BoxGeometry(0.014, 0.016, 0.008), Math.cos(a) * 0.117, Math.sin(a) * 0.117, 0.075, 0, 0, a));
  }
  crank.add(new THREE.Mesh(mergeGeos(teeth), M.steel));
  const ringArm = [];
  for (let i = 0; i < 5; i++) {
    const a = (i / 5) * TAU;
    ringArm.push(placed(new THREE.BoxGeometry(0.085, 0.022, 0.007), Math.cos(a) * 0.055, Math.sin(a) * 0.055, 0.075, 0, 0, a));
  }
  crank.add(new THREE.Mesh(mergeGeos(ringArm), M.chrome));

  const pedals = [];
  for (const s of [1, -1]) {
    const arm = new THREE.Mesh(placed(new THREE.BoxGeometry(0.185, 0.032, 0.018), 0.085 * s, 0, s * 0.10, 0, 0, s > 0 ? 0 : Math.PI), M.chrome);
    crank.add(arm);
    const pedal = new THREE.Group();
    pedal.position.set(BIKE.crank * s, 0, s * BIKE.pedalZ);
    const cage = new THREE.Mesh(new THREE.BoxGeometry(0.095, 0.018, 0.062), M.dark);
    pedal.add(cage);
    const reflector = new THREE.Mesh(placed(new THREE.BoxGeometry(0.03, 0.012, 0.008), 0.03, 0, s * 0.033), new THREE.MeshStandardMaterial({ color: 0xffb347, emissive: 0x4a2000, roughness: 0.4 }));
    pedal.add(reflector);
    for (const k of [-1, 1]) {
      pedal.add(new THREE.Mesh(placed(new THREE.BoxGeometry(0.095, 0.008, 0.006), 0, 0.012, k * 0.028), M.steel));
    }
    crank.add(pedal);
    pedals.push(pedal);
  }
  crank.add(new THREE.Mesh(placed(new THREE.CylinderGeometry(0.022, 0.022, 0.19, 12), 0, 0, 0, Math.PI / 2), M.dark));

  /* ---- chain ---- */
  const C1 = new THREE.Vector2(BB.x, BB.y), r1 = 0.117;
  const C2 = new THREE.Vector2(RA.x, RA.y), r2 = 0.057;
  const d = new THREE.Vector2().subVectors(C2, C1);
  const dist = d.length(), phi = Math.atan2(d.y, d.x);
  const beta = Math.acos(clamp((r1 - r2) / dist, -1, 1));
  const a1 = phi + beta, a2 = phi - beta;
  const pts = [];
  const zc = 0.075;
  const p = (c, r, a) => new THREE.Vector3(c.x + Math.cos(a) * r, c.y + Math.sin(a) * r, zc);
  pts.push(p(C1, r1, a1), p(C2, r2, a1));
  for (let i = 1; i <= 10; i++) pts.push(p(C2, r2, a1 + ((a2 + TAU - a1) * i) / 10));
  pts.push(p(C1, r1, a2));
  for (let i = 1; i < 22; i++) pts.push(p(C1, r1, a2 + ((a1 + TAU - a2) * i) / 22));
  const chainCurve = new THREE.CatmullRomCurve3(pts, true, 'catmullrom', 0.06);
  const chainMesh = new THREE.Mesh(new THREE.TubeGeometry(chainCurve, 220, 0.011, 6, true), M.chain);
  body.add(chainMesh);
  // chain guard
  const guard = new THREE.Mesh(new THREE.TorusGeometry(0.135, 0.012, 6, 26, Math.PI * 1.05), M.cream);
  guard.position.set(BB.x, BB.y, 0.098);
  guard.rotation.z = Math.PI * 0.47;
  guard.scale.set(1, 1, 1.6);
  body.add(guard);

  /* ---- rear rack + rolled towel ---- */
  const rack = [];
  for (const s of [-1, 1]) {
    rack.push(tubeBetween(new THREE.Vector3(RA.x + 0.02, RA.y + 0.05, s * 0.05), new THREE.Vector3(RA.x + 0.10, 0.80, s * 0.075), 0.008, 0.008, 6));
    rack.push(tubeBetween(new THREE.Vector3(RA.x - 0.16, 0.80, s * 0.075), new THREE.Vector3(RA.x + 0.20, 0.80, s * 0.075), 0.008, 0.008, 6));
  }
  rack.push(tubeBetween(new THREE.Vector3(RA.x - 0.16, 0.80, -0.075), new THREE.Vector3(RA.x - 0.16, 0.80, 0.075), 0.008, 0.008, 6));
  body.add(new THREE.Mesh(mergeGeos(rack), M.chrome));
  const towel = new THREE.Mesh(placed(new THREE.CylinderGeometry(0.052, 0.052, 0.24, 14), RA.x + 0.02, 0.855, 0, Math.PI / 2), new THREE.MeshStandardMaterial({ color: 0xf0e6d2, roughness: 0.95 }));
  body.add(towel);
  const towelStripe = new THREE.Mesh(placed(new THREE.CylinderGeometry(0.053, 0.053, 0.035, 14), RA.x + 0.02, 0.855, 0.055, Math.PI / 2), new THREE.MeshStandardMaterial({ color: 0xe2574c, roughness: 0.95 }));
  body.add(towelStripe);

  shadows(root, true, false);
  basketBody.castShadow = false;

  /* ---- state ---- */
  let wheelAngle = 0;
  let bellT = 99;
  const pedalWorld = [new THREE.Vector3(), new THREE.Vector3()];
  const gripWorld = [new THREE.Vector3(), new THREE.Vector3()];
  const _v = new THREE.Vector3();

  function ring() { bellT = 0; }

  function update(dt, s) {
    const v = s.velocity;
    wheelAngle -= (v / BIKE.R) * dt;
    rearWheel.rotation.z = wheelAngle;
    frontWheel.rotation.z = wheelAngle * 1.0;

    const crankAngle = s.crankAngle;
    crank.rotation.z = crankAngle;
    for (let i = 0; i < pedals.length; i++) {
      pedals[i].rotation.z = -crankAngle;
      pedals[i].getWorldPosition(pedalWorld[i]);
      body.worldToLocal(pedalWorld[i]);
    }
    for (let i = 0; i < grips.length; i++) {
      grips[i].getWorldPosition(gripWorld[i]);
      body.worldToLocal(gripWorld[i]);
    }
    M.chainMap.offset.x = -crankAngle * 0.055;

    for (const st of streamers) {
      const arr = st.geo.attributes.position.array;
      const wind = 0.4 + s.speedNorm * 1.2;
      for (let i = 0; i <= st.segs; i++) {
        const u = i / st.segs;
        const x = 0.295 - u * 0.36 * (0.7 + s.speedNorm * 0.5);
        const y = 1.172 + Math.sin(u * 7 - s.time * 10 + st.phase) * 0.035 * u * wind - u * 0.02;
        const z = st.side * 0.272 + Math.cos(u * 5 - s.time * 8 + st.phase) * 0.04 * u * wind;
        const hw = 0.020 * (1 - u * 0.5);
        const k = i * 6;
        arr[k] = x; arr[k + 1] = y - hw; arr[k + 2] = z;
        arr[k + 3] = x; arr[k + 4] = y + hw; arr[k + 5] = z;
      }
      st.geo.attributes.position.needsUpdate = true;
      st.geo.computeVertexNormals();
    }

    // gentle steering wobble + road bumps
    const wobble = Math.sin(s.time * 1.1) * 0.035 + Math.sin(s.time * 2.7) * 0.012;
    steer.quaternion.setFromAxisAngle(steerAxis, wobble * (0.4 + s.speedNorm * 0.6));

    body.rotation.x = Math.sin(s.time * 0.8) * 0.022 + s.lean;
    body.rotation.y = Math.sin(s.time * 0.63) * 0.014;
    body.position.y = s.bob;

    // bell
    bellT += dt;
    const b = bellT < 0.6 ? Math.exp(-bellT * 7) * Math.sin(bellT * 46) : 0;
    bell.rotation.z = b * 0.22;
    bell.scale.setScalar(1 + Math.abs(b) * 0.12);
    leverKnob.position.x = -0.034 + b * 0.012;

    fish.rotation.z = 0.42 + Math.sin(s.time * 1.6) * 0.06 + (bellT < 0.8 ? Math.sin(bellT * 30) * 0.12 * Math.exp(-bellT * 4) : 0);
    fish.position.y = 0.075 + Math.abs(Math.sin(s.time * 0.9)) * 0.008;

    lampGlow.material.opacity = s.lampOn * 0.85;
    lensMat.emissiveIntensity = 0.35 + s.lampOn * 2.6;
    rearLight.material.emissiveIntensity = 0.4 + s.lampOn * 1.8;
  }

  return { group: root, body, update, ring, bell, pedalWorld, gripWorld, frontWheel, rearWheel, crank, steer, steerContent, materials: M };
}