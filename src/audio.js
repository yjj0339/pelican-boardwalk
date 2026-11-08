// Tiny procedural ambience: surf + wind, and a brass bell. No audio files.
export function createAudio() {
  let ctx = null, master = null, surfGain = null, windGain = null, enabled = false;

  function noiseBuffer(seconds, brown) {
    const len = Math.floor(ctx.sampleRate * seconds);
    const buf = ctx.createBuffer(1, len, ctx.sampleRate);
    const d = buf.getChannelData(0);
    let last = 0;
    for (let i = 0; i < len; i++) {
      const white = Math.random() * 2 - 1;
      if (brown) { last = (last + 0.02 * white) / 1.02; d[i] = last * 3.2; }
      else d[i] = white;
    }
    return buf;
  }

  function init() {
    if (ctx) return;
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    ctx = new AC();
    master = ctx.createGain();
    master.gain.value = 0;
    master.connect(ctx.destination);

    // surf: brown noise through a lowpass, swollen by a slow LFO
    const surf = ctx.createBufferSource();
    surf.buffer = noiseBuffer(4, true);
    surf.loop = true;
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass'; lp.frequency.value = 620; lp.Q.value = 0.6;
    surfGain = ctx.createGain(); surfGain.gain.value = 0.34;
    surf.connect(lp); lp.connect(surfGain); surfGain.connect(master);
    surf.start();

    const lfo = ctx.createOscillator();
    lfo.frequency.value = 0.085;
    const lfoGain = ctx.createGain(); lfoGain.gain.value = 0.20;
    lfo.connect(lfoGain); lfoGain.connect(surfGain.gain);
    const lfo2 = ctx.createOscillator();
    lfo2.frequency.value = 0.131;
    const lfo2g = ctx.createGain(); lfo2g.gain.value = 260;
    lfo2.connect(lfo2g); lfo2g.connect(lp.frequency);
    lfo.start(); lfo2.start();

    // wind
    const wind = ctx.createBufferSource();
    wind.buffer = noiseBuffer(3, false);
    wind.loop = true;
    const bp = ctx.createBiquadFilter();
    bp.type = 'bandpass'; bp.frequency.value = 1050; bp.Q.value = 0.8;
    windGain = ctx.createGain(); windGain.gain.value = 0.035;
    wind.connect(bp); bp.connect(windGain); windGain.connect(master);
    wind.start();
    const wlfo = ctx.createOscillator(); wlfo.frequency.value = 0.17;
    const wlg = ctx.createGain(); wlg.gain.value = 0.022;
    wlfo.connect(wlg); wlg.connect(windGain.gain); wlfo.start();
  }

  function setEnabled(on) {
    enabled = on;
    if (on) {
      init();
      if (!ctx) return false;
      if (ctx.state === 'suspended') ctx.resume();
      master.gain.cancelScheduledValues(ctx.currentTime);
      master.gain.setTargetAtTime(0.5, ctx.currentTime, 0.6);
    } else if (ctx) {
      master.gain.setTargetAtTime(0, ctx.currentTime, 0.35);
    }
    return true;
  }

  function setSpeed(norm) {
    if (!ctx || !enabled) return;
    windGain.gain.setTargetAtTime(0.022 + norm * 0.055, ctx.currentTime, 0.4);
  }

  function bell() {
    if (!ctx) init();
    if (!ctx) return;
    if (ctx.state === 'suspended') ctx.resume();
    const t = ctx.currentTime;
    const out = ctx.createGain();
    out.gain.value = enabled ? 0.5 : 0.34;
    out.connect(ctx.destination);
    const partials = [[1568, 0.30, 1.5], [2349, 0.18, 1.05], [3136, 0.10, 0.7], [1046, 0.12, 1.8]];
    for (const [f, g, dur] of partials) {
      const o = ctx.createOscillator();
      o.type = 'sine'; o.frequency.value = f;
      const env = ctx.createGain();
      env.gain.setValueAtTime(0, t);
      env.gain.linearRampToValueAtTime(g, t + 0.004);
      env.gain.exponentialRampToValueAtTime(0.0001, t + dur);
      o.connect(env); env.connect(out);
      o.start(t); o.stop(t + dur + 0.05);
    }
    // second strike of the bell hammer
    const o2 = ctx.createOscillator();
    o2.type = 'triangle'; o2.frequency.value = 2093;
    const e2 = ctx.createGain();
    e2.gain.setValueAtTime(0, t + 0.085);
    e2.gain.linearRampToValueAtTime(0.14, t + 0.09);
    e2.gain.exponentialRampToValueAtTime(0.0001, t + 0.9);
    o2.connect(e2); e2.connect(out);
    o2.start(t + 0.085); o2.stop(t + 1);
  }

  return { setEnabled, bell, setSpeed, get enabled() { return enabled; } };
}