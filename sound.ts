// Synthesized casino audio (no external assets). Ported and reworked from the original prototype:
// separate effect and ambience buses, each with its own volume, and nothing here can affect state.

import { prefs } from './settings.js';

let ctx: AudioContext | null = null;
let fxBus: GainNode, ambBus: GainNode;
let ambientStarted = false;

function ac() {
  if (!ctx) {
    ctx = new AudioContext();
    fxBus = ctx.createGain(); fxBus.connect(ctx.destination);
    ambBus = ctx.createGain(); ambBus.connect(ctx.destination);
    applyVolumes();
  }
  return ctx;
}
function applyVolumes() {
  if (!ctx) return;
  const p = prefs.get();
  fxBus.gain.setTargetAtTime(p.fxVolume, ctx.currentTime, 0.05);
  ambBus.gain.setTargetAtTime(p.ambientVolume * 0.18, ctx.currentTime, 0.4);
}
prefs.on(applyVolumes);

/** Browsers require a gesture before audio can start. */
export function unlockAudio() {
  const c = ac();
  if (c.state === 'suspended') c.resume();
  if (!ambientStarted) { ambientStarted = true; startAmbient(); }
}

function tone(f: number, type: OscillatorType, t: number, dur: number, vol: number, bus = fxBus) {
  const c = ac(), o = c.createOscillator(), g = c.createGain();
  o.type = type; o.frequency.setValueAtTime(f, t);
  g.gain.setValueAtTime(0.0001, t);
  g.gain.linearRampToValueAtTime(vol, t + 0.008);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  o.connect(g); g.connect(bus); o.start(t); o.stop(t + dur + 0.05);
}
function noise(t: number, dur: number, vol: number, freq: number, q = 0.7, bus = fxBus) {
  const c = ac();
  const buf = c.createBuffer(1, Math.ceil(c.sampleRate * dur), c.sampleRate);
  const d = buf.getChannelData(0);
  for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
  const src = c.createBufferSource(), f = c.createBiquadFilter(), g = c.createGain();
  f.type = 'bandpass'; f.frequency.value = freq; f.Q.value = q;
  g.gain.setValueAtTime(0.0001, t); g.gain.linearRampToValueAtTime(vol, t + 0.004); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  src.buffer = buf; src.connect(f); f.connect(g); g.connect(bus); src.start(t); src.stop(t + dur + 0.05);
}

const now = () => ac().currentTime;
const on = () => !!ctx && ctx.state === 'running' && prefs.get().fxVolume > 0;

export const sfx = {
  deal() { if (!on()) return; const t = now(); noise(t, 0.05, 0.25, 1800, 0.9); noise(t + 0.03, 0.04, 0.12, 700); },
  flip() { if (!on()) return; const t = now(); noise(t, 0.03, 0.3, 2600, 1.2); tone(420, 'sine', t + 0.012, 0.04, 0.05); },
  chip() {
    if (!on()) return; const t = now();
    [0, 0.045, 0.08].forEach((d, i) => { tone(2300 + i * 260 + Math.random() * 120, 'sine', t + d, 0.06, 0.07); noise(t + d, 0.025, 0.08, 4200, 2); });
  },
  payout() { if (!on()) return; const t = now(); for (let i = 0; i < 6; i++) { tone(2100 + Math.random() * 500, 'sine', t + i * 0.05, 0.07, 0.06); noise(t + i * 0.05, 0.02, 0.06, 4500, 2); } },
  win() { if (!on()) return; const t = now(); [523, 659, 784].forEach((f, i) => tone(f, 'triangle', t + i * 0.09, 0.32, 0.09)); },
  bigWin() { if (!on()) return; const t = now(); [523, 659, 784, 1047, 1319].forEach((f, i) => tone(f, 'triangle', t + i * 0.08, 0.45, 0.1)); },
  lose() { if (!on()) return; const t = now(); tone(196, 'sine', t, 0.3, 0.1); tone(147, 'sine', t + 0.14, 0.4, 0.08); },
  push() { if (!on()) return; const t = now(); tone(440, 'sine', t, 0.15, 0.06); tone(440, 'sine', t + 0.2, 0.15, 0.05); },
  tick() { if (!on()) return; tone(1200, 'square', now(), 0.03, 0.02); },
  notify() { if (!on()) return; const t = now(); tone(880, 'sine', t, 0.12, 0.05); tone(1320, 'sine', t + 0.08, 0.15, 0.04); },
};

function startAmbient() {
  const c = ac();
  // Room tone: filtered noise with slow movement
  const buf = c.createBuffer(2, c.sampleRate * 4, c.sampleRate);
  for (let ch = 0; ch < 2; ch++) { const d = buf.getChannelData(ch); for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1; }
  const src = c.createBufferSource(); src.buffer = buf; src.loop = true;
  const lp = c.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 380;
  const lfo = c.createOscillator(), lfoGain = c.createGain();
  lfo.frequency.value = 0.07; lfoGain.gain.value = 120; lfo.connect(lfoGain); lfoGain.connect(lp.frequency); lfo.start();
  src.connect(lp); lp.connect(ambBus); src.start();
  // Distant chip clinks
  const clink = () => {
    if (ctx && prefs.get().ambientVolume > 0) {
      const t = c.currentTime;
      tone(1800 + Math.random() * 900, 'sine', t, 0.08, 0.25, ambBus);
      if (Math.random() > 0.5) tone(2200 + Math.random() * 600, 'sine', t + 0.05, 0.06, 0.18, ambBus);
    }
    setTimeout(clink, 4000 + Math.random() * 9000);
  };
  setTimeout(clink, 3000);
}
