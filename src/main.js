import * as THREE from 'three';
import { createBicycle, BIKE } from './bike.js';
import { createPelican } from './pelican.js';
import { createWorld } from './world.js';
import { createAudio } from './audio.js';
import { clamp, damp, rand, TAU } from './util.js';

const $ = (id) => document.getElementById(id);
const canvas = $('scene');
const app = $('app');
const nextFrame = () => new Promise((r) => requestAnimationFrame(() => r()));

function progress(p, text) {
  $('loadBar').style.width = `${p}%`;
  if (text) $('loadMsg').textContent = text;
}

let toastTimer = 0;
function toast(text, ms = 2100) {
  const el = $('toast');
  el.textContent = text;
  el.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove('show'), ms);
}

function fatal(message) {
  $('loader').classList.add('done');
  $('fatalMsg').textContent = message;
  $('fatal').hidden = false;
}

/* ------------------------------------------------------------------ *
 * camera presets
 * ------------------------------------------------------------------ */
const PRESETS = [
  { name: '伴骑', pos: [0.35, 1.74, 5.5], tgt: [0.02, 1.26, 0], drift: (t, p) => { p.x += Math.sin(t * 0.21) * 0.55; p.y += Math.sin(t * 0.33) * 0.07; } },
  { name: '迎面', pos: [3.45, 1.44, 3.25], tgt: [0.12, 1.24, 0], drift: (t, p) => { const a = Math.sin(t * 0.16) * 0.20; const x = p.x, z = p.z; p.x = x * Math.cos(a) - z * Math.sin(a); p.z = x * Math.sin(a) + z * Math.cos(a); } },
  { name: '贴地', pos: [2.05, 0.34, 2.85], tgt: [0.05, 0.66, 0], drift: (t, p) => { p.x += Math.sin(t * 0.27) * 0.45; p.y += Math.sin(t * 0.4) * 0.03; } },
  { name: '航拍', pos: [1.7, 6.1, 6.3], tgt: [0, 0.62, -2.0], drift: (t, p) => { const a = t * 0.075; const r = Math.hypot(p.x, p.z + 2); p.x = Math.sin(a) * r; p.z = Math.cos(a) * r - 2; } },
  { name: '特写', pos: [1.24, 2.02, 2.02], tgt: [0.48, 1.74, 0], drift: (t, p) => { p.y += Math.sin(t * 0.5) * 0.035; p.z += Math.sin(t * 0.31) * 0.08; } },
];

const state = {
  time: 0, distance: 0, velocity: 0, speed: 1, speedNorm: 0,
  crankAngle: 0, paused: false, bob: 0, lean: 0, lampOn: 0,
};

async function boot() {
  progress(8, '点燃渲染器');
  await nextFrame();

  const isMobile = /Android|iPhone|iPad|iPod|Mobile/i.test(navigator.userAgent) ||
    (navigator.maxTouchPoints > 1 && Math.min(window.innerWidth, window.innerHeight) < 820);
  const weak = (navigator.hardwareConcurrency || 8) <= 4 || (navigator.deviceMemory || 8) <= 4;
  const quality = isMobile || weak ? 'low' : 'high';

  let renderer;
  try {
    renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: false, powerPreference: 'high-performance' });
  } catch (err) {
    fatal('这台设备的浏览器没能创建 WebGL 上下文。请换用较新版本的 Chrome / Safari / Edge，或关闭省电模式后重试。');
    return;
  }
  if (!renderer.getContext()) { fatal('WebGL 不可用。'); return; }

  let pixelRatio = Math.min(window.devicePixelRatio || 1, quality === 'low' ? 1.6 : 2);
  renderer.setPixelRatio(pixelRatio);
  renderer.setSize(window.innerWidth, window.innerHeight, false);
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.06;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(42, window.innerWidth / window.innerHeight, 0.08, 3000);
  camera.position.set(0.35, 1.74, 5.5);

  progress(22, '铺开海岸线与黄昏');
  await nextFrame();
  const world = createWorld(scene, renderer, quality);

  progress(48, '组装复古单车');
  await nextFrame();
  const bike = createBicycle();
  scene.add(bike.group);

  // headlamp (only really needed after dark)
  const headlamp = new THREE.SpotLight(0xffd7a0, 0, 26, 0.46, 0.62, 1.25);
  headlamp.position.set(0.63, 0.80, 0);
  const lampTarget = new THREE.Object3D();
  lampTarget.position.set(7.5, -0.4, 0);
  bike.steerContent.add(headlamp, lampTarget);
  headlamp.target = lampTarget;

  progress(68, '请鹈鹕上车');
  await nextFrame();
  const pelican = createPelican();
  bike.body.add(pelican.group);
  bike.body.add(pelican.legsRoot);
  bike.body.add(pelican.armsRoot);

  const audio = createAudio();

  progress(86, '系好围巾，调好车铃');
  await nextFrame();

  /* ---------------- camera rig ---------------- */
  const rig = {
    mode: 'preset', preset: 0, auto: true, autoTimer: 0,
    theta: 0.06, phi: 1.30, radius: 5.6,
    target: new THREE.Vector3(0.02, 1.26, 0),
    freeTarget: new THREE.Vector3(0, 1.2, 0),
    desiredPos: new THREE.Vector3(), desiredTgt: new THREE.Vector3(),
    shake: 0, first: true,
  };
  const _off = new THREE.Vector3(), _look = new THREE.Vector3();
  let aspectFit = 1, frameBias = 0;

  function updateFraming() {
    const aspect = window.innerWidth / Math.max(1, window.innerHeight);
    aspectFit = clamp(1.05 / Math.max(aspect, 0.35), 1, 1.6);
    frameBias = aspect < 0.92 ? -0.10 : 0;
  }
  updateFraming();

  function enterFreeFromCamera() {
    _off.subVectors(camera.position, rig.target);
    rig.radius = clamp(_off.length(), 1.5, 26);
    rig.phi = clamp(Math.acos(clamp(_off.y / rig.radius, -1, 1)), 0.18, 1.50);
    rig.theta = Math.atan2(_off.x, _off.z);
    rig.freeTarget.copy(rig.target);
    rig.mode = 'free';
    rig.auto = false;
    syncChips();
  }

  function setPreset(i, announce = true) {
    rig.preset = clamp(i, 0, PRESETS.length - 1);
    rig.mode = 'preset';
    rig.autoTimer = 0;
    syncChips();
    if (announce) toast(`机位 · ${PRESETS[rig.preset].name}`, 1300);
  }

  function syncChips() {
    document.querySelectorAll('#camChips .chip').forEach((c) => {
      const idx = Number(c.dataset.cam);
      c.classList.toggle('is-on', rig.mode === 'free' ? idx === 5 : idx === rig.preset);
    });
  }

  function updateCamera(dt) {
    const t = state.time;
    if (rig.mode === 'preset') {
      const p = PRESETS[rig.preset];
      rig.desiredPos.set(p.pos[0], p.pos[1], p.pos[2]);
      rig.desiredTgt.set(p.tgt[0], p.tgt[1] + frameBias, p.tgt[2]);
      p.drift(t, rig.desiredPos);
      _off.subVectors(rig.desiredPos, rig.desiredTgt).multiplyScalar(aspectFit);
      rig.desiredPos.copy(rig.desiredTgt).add(_off);
      if (rig.auto) {
        rig.autoTimer += dt;
        if (rig.autoTimer > 15) { rig.autoTimer = 0; rig.preset = (rig.preset + 1) % PRESETS.length; syncChips(); }
      }
    } else {
      const sp = Math.sin(rig.phi), cp = Math.cos(rig.phi);
      const r = rig.radius * aspectFit;
      rig.desiredPos.set(
        rig.freeTarget.x + r * sp * Math.sin(rig.theta),
        rig.freeTarget.y + r * cp,
        rig.freeTarget.z + r * sp * Math.cos(rig.theta)
      );
      rig.desiredTgt.copy(rig.freeTarget);
      rig.desiredTgt.y += frameBias;
    }
    // handheld micro-motion
    const hh = 0.012 + state.speedNorm * 0.012;
    rig.desiredPos.x += Math.sin(t * 1.7) * hh;
    rig.desiredPos.y += Math.sin(t * 2.3 + 1.1) * hh * 0.7;

    const k = rig.first ? 1 : 1 - Math.exp(-(rig.mode === 'free' ? 9 : 2.3) * dt);
    camera.position.lerp(rig.desiredPos, k);
    rig.target.lerp(rig.desiredTgt, k);
    rig.first = false;

    if (rig.shake > 0.001) {
      camera.position.x += Math.sin(t * 61) * rig.shake;
      camera.position.y += Math.sin(t * 73 + 2) * rig.shake * 0.8;
      rig.shake *= Math.exp(-7 * dt);
    }
    _look.copy(rig.target);
    camera.lookAt(_look);
    camera.fov = damp(camera.fov, 42 + state.speedNorm * 4.5, 3, dt);
    camera.updateProjectionMatrix();
  }

  /* ---------------- pointer / touch ---------------- */
  const pointers = new Map();
  let dragging = false, downAt = 0, downXY = [0, 0], moved = 0, pinchDist = 0;
  const raycaster = new THREE.Raycaster();
  const ndc = new THREE.Vector2();

  canvas.addEventListener('pointerdown', (e) => {
    canvas.setPointerCapture(e.pointerId);
    pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (pointers.size === 1) {
      dragging = false; moved = 0; downAt = performance.now(); downXY = [e.clientX, e.clientY];
    } else if (pointers.size === 2) {
      const [a, b] = [...pointers.values()];
      pinchDist = Math.hypot(a.x - b.x, a.y - b.y);
    }
  });

  canvas.addEventListener('pointermove', (e) => {
    const p = pointers.get(e.pointerId);
    if (!p) return;
    const dx = e.clientX - p.x, dy = e.clientY - p.y;
    p.x = e.clientX; p.y = e.clientY;
    if (pointers.size === 2) {
      const [a, b] = [...pointers.values()];
      const d = Math.hypot(a.x - b.x, a.y - b.y);
      if (pinchDist > 0) {
        if (rig.mode !== 'free') enterFreeFromCamera();
        rig.radius = clamp(rig.radius * (pinchDist / Math.max(1, d)), 1.5, 26);
      }
      pinchDist = d;
      moved = 99;
      return;
    }
    moved += Math.abs(dx) + Math.abs(dy);
    if (moved > 6) {
      if (!dragging) { dragging = true; canvas.classList.add('dragging'); if (rig.mode !== 'free') enterFreeFromCamera(); }
      rig.theta -= dx * 0.0052;
      rig.phi = clamp(rig.phi - dy * 0.0044, 0.18, 1.50);
    }
  });

  function endPointer(e) {
    const had = pointers.has(e.pointerId);
    pointers.delete(e.pointerId);
    if (pointers.size < 2) pinchDist = 0;
    if (pointers.size === 0) {
      canvas.classList.remove('dragging');
      if (had && !dragging && moved < 8 && performance.now() - downAt < 420) tap(e.clientX, e.clientY);
      dragging = false;
    }
  }
  canvas.addEventListener('pointerup', endPointer);
  canvas.addEventListener('pointercancel', endPointer);

  canvas.addEventListener('wheel', (e) => {
    e.preventDefault();
    if (rig.mode !== 'free') enterFreeFromCamera();
    rig.radius = clamp(rig.radius * Math.exp(e.deltaY * 0.0011), 1.5, 26);
  }, { passive: false });

  canvas.addEventListener('dblclick', (e) => {
    e.preventDefault();
    rig.auto = !rig.auto;
    if (rig.auto) { rig.mode = 'preset'; rig.autoTimer = 0; toast('自动运镜已开启'); }
    else toast('自动运镜已关闭');
    syncChips();
  });

  function tap(cx, cy) {
    const r = canvas.getBoundingClientRect();
    ndc.set(((cx - r.left) / r.width) * 2 - 1, -((cy - r.top) / r.height) * 2 + 1);
    raycaster.setFromCamera(ndc, camera);
    const bellHit = raycaster.intersectObject(bike.bell, true);
    if (bellHit.length) { ringBell(); return; }
    const birdHit = raycaster.intersectObjects([pelican.group, pelican.legsRoot, pelican.armsRoot], true);
    if (birdHit.length) { pelican.startle(); toast('鹈鹕抬手向你挥了挥'); return; }
    const bikeHit = raycaster.intersectObject(bike.group, true);
    if (bikeHit.length) ringBell();
  }

  function ringBell() {
    bike.ring();
    audio.bell();
    rig.shake = Math.max(rig.shake, 0.006);
  }

  /* ---------------- UI ---------------- */
  const playBtn = $('playBtn');
  function setPaused(v) {
    state.paused = v;
    document.body.classList.toggle('paused', v);
    playBtn.setAttribute('aria-label', v ? '播放' : '暂停');
  }
  playBtn.addEventListener('click', () => setPaused(!state.paused));

  const speedInput = $('speed');
  speedInput.addEventListener('input', () => {
    state.speed = Number(speedInput.value);
    $('speedVal').textContent = `${state.speed.toFixed(2).replace(/0$/, '')}×`;
  });

  $('bellBtn').addEventListener('click', ringBell);

  const soundBtn = $('soundBtn');
  soundBtn.addEventListener('click', () => {
    const on = !audio.enabled;
    const ok = audio.setEnabled(on);
    if (!ok) { toast('这台浏览器不支持音频'); return; }
    soundBtn.classList.toggle('is-on', on);
    soundBtn.setAttribute('aria-pressed', String(on));
    toast(on ? '海浪与风声已开启' : '已静音', 1400);
  });

  let wantShot = false;
  $('shotBtn').addEventListener('click', () => { wantShot = true; });

  $('fsBtn').addEventListener('click', async () => {
    try {
      if (document.fullscreenElement) await document.exitFullscreen();
      else if (app.requestFullscreen) await app.requestFullscreen();
      else toast('iOS 请用「添加到主屏幕」获得全屏');
    } catch { toast('全屏被浏览器拒绝'); }
  });

  $('hideUi').addEventListener('click', () => {
    const hidden = document.body.classList.toggle('ui-hidden');
    toast(hidden ? '界面已隐藏 · 按 H 或点眼睛恢复' : '界面已恢复', 1600);
  });

  document.querySelectorAll('#camChips .chip').forEach((chip) => {
    chip.addEventListener('click', () => {
      const i = Number(chip.dataset.cam);
      rig.auto = false;
      if (i === 5) { enterFreeFromCamera(); toast('自由视角 · 拖动旋转，双指缩放'); }
      else setPreset(i);
    });
  });

  document.querySelectorAll('#moodChips .chip').forEach((chip) => {
    chip.addEventListener('click', () => {
      const name = chip.dataset.mood;
      world.setMood(name);
      document.querySelectorAll('#moodChips .chip').forEach((c) => c.classList.toggle('is-on', c === chip));
      toast({ golden: '黄昏 · 金色海面', noon: '正午 · 通透碧海', night: '夜航 · 灯塔与车灯' }[name], 1700);
    });
  });

  window.addEventListener('keydown', (e) => {
    if (e.target instanceof HTMLInputElement) return;
    const k = e.key.toLowerCase();
    if (k === ' ' || e.code === 'Space') { e.preventDefault(); setPaused(!state.paused); }
    else if (k >= '1' && k <= '6') { const i = Number(k) - 1; rig.auto = false; if (i === 5) enterFreeFromCamera(); else setPreset(i); }
    else if (k === 'arrowright') { speedInput.value = String(clamp(state.speed + 0.1, 0.25, 2.4)); speedInput.dispatchEvent(new Event('input')); }
    else if (k === 'arrowleft') { speedInput.value = String(clamp(state.speed - 0.1, 0.25, 2.4)); speedInput.dispatchEvent(new Event('input')); }
    else if (k === 'b') ringBell();
    else if (k === 'm') soundBtn.click();
    else if (k === 's') wantShot = true;
    else if (k === 'f') $('fsBtn').click();
    else if (k === 'h') $('hideUi').click();
  });

  function resize() {
    const w = window.innerWidth, h = window.innerHeight;
    camera.aspect = w / Math.max(1, h);
    camera.updateProjectionMatrix();
    renderer.setSize(w, h, false);
    updateFraming();
  }
  window.addEventListener('resize', resize);
  window.addEventListener('orientationchange', () => setTimeout(resize, 220));

  canvas.addEventListener('webglcontextlost', (e) => {
    e.preventDefault();
    fatal('显卡上下文丢失了（常见于切后台太久或显存紧张）。刷新页面即可重新出发。');
  });

  /* ---------------- bumps ---------------- */
  let bumpTimer = rand(3, 6), bumpT = 99;

  /* ---------------- loop ---------------- */
  let last = performance.now();
  let fpsAccum = 0, fpsFrames = 0, fpsTimer = 0, avgFps = 60;
  let perfChecked = 0, downgraded = 0;
  const clockStart = performance.now();

  function frame(now) {
    requestAnimationFrame(frame);
    let dt = (now - last) / 1000;
    last = now;
    if (dt > 0.06) dt = 0.06;
    if (dt <= 0) dt = 1 / 60;

    const simDt = state.paused ? 0 : dt;
    state.time += simDt;

    const targetVel = 5.0 * state.speed;
    state.velocity = damp(state.velocity, state.paused ? 0 : targetVel, 2.2, dt);
    state.speedNorm = clamp(state.velocity / 11, 0, 1);
    state.distance += state.velocity * simDt;
    state.crankAngle -= (state.velocity / (BIKE.R * BIKE.gear)) * simDt;
    state.crankAngle %= TAU;
    state.lean = Math.sin(state.time * 0.37) * 0.028 + Math.sin(state.time * 0.91) * 0.008;

    bumpTimer -= simDt; bumpT += simDt;
    if (bumpTimer <= 0) { bumpT = 0; bumpTimer = rand(4.5, 9.5); rig.shake = 0.012; if (state.velocity > 1) pelican.bump(); }
    state.bob = bumpT < 0.34 ? Math.sin((bumpT / 0.34) * Math.PI) * 0.032 * (0.4 + state.speedNorm) : 0;

    state.lampOn = world.lampOn;
    headlamp.intensity = state.lampOn * 30;

    bike.update(simDt, state);
    pelican.update(simDt, state, bike.pedalWorld, bike.gripWorld);
    world.update(dt, state);
    audio.setSpeed(state.speedNorm);
    updateCamera(dt);

    renderer.render(scene, camera);

    if (wantShot) {
      wantShot = false;
      try {
        canvas.toBlob((blob) => {
          if (!blob) { toast('截图失败'); return; }
          const url = URL.createObjectURL(blob);
          const a = document.createElement('a');
          a.href = url;
          a.download = `pelican-boardwalk-${Date.now()}.png`;
          document.body.appendChild(a);
          a.click();
          a.remove();
          setTimeout(() => URL.revokeObjectURL(url), 8000);
          toast('截图已保存');
        }, 'image/png');
      } catch { toast('截图被浏览器拒绝'); }
    }

    // fps + adaptive quality
    fpsAccum += dt; fpsFrames++; fpsTimer += dt;
    if (fpsTimer > 0.5) {
      avgFps = fpsFrames / fpsAccum;
      $('fps').textContent = String(Math.round(avgFps));
      $('km').textContent = (state.distance / 1000).toFixed(2);
      fpsAccum = 0; fpsFrames = 0; fpsTimer = 0;
      const age = (now - clockStart) / 1000;
      if (age > 4 && perfChecked < 2) {
        perfChecked++;
        if (avgFps < 38 && downgraded === 0) {
          downgraded = 1;
          pixelRatio = Math.max(1, pixelRatio - 0.6);
          renderer.setPixelRatio(pixelRatio);
          resize();
          toast('已自动降低分辨率以保持流畅');
        } else if (avgFps < 26 && downgraded === 1) {
          downgraded = 2;
          renderer.shadowMap.enabled = false;
          sunShadowsOff();
          toast('已关闭阴影以保持流畅');
        }
      }
    }
  }

  function sunShadowsOff() {
    world.sun.castShadow = false;
    scene.traverse((o) => { if (o.isMesh) o.castShadow = false; });
  }

  // prime a couple of frames so the first visible frame is already correct
  bike.update(0.016, state);
  pelican.update(0.016, state, bike.pedalWorld, bike.gripWorld);
  world.update(0.016, state);
  updateCamera(0.016);
  renderer.render(scene, camera);
  window.__pelican = { scene, camera, renderer, state, bike, pelican, world, rig };
  progress(100, '出发');
  await nextFrame();
  await nextFrame();
  $('loader').classList.add('done');
  setTimeout(() => { $('loader').style.display = 'none'; }, 1000);
  requestAnimationFrame(frame);

  if (quality === 'low') setTimeout(() => toast('已启用移动端画质预设', 1800), 1400);
}

boot().catch((err) => {
  console.error(err);
  fatal(`初始化失败：${err && err.message ? err.message : err}`);
});