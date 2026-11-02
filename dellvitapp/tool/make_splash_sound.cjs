// Run from dellvitapp: node tool/make_splash_sound.cjs assets/sounds/splash.wav
// Synthesises the Dellvit launch sound, timed to the logo intro in lib/widgets/brand.dart
// (1.7 s): the name fades in, the two leaves pop up, the arrow draws left to right, then the
// tagline. Output: 16-bit mono WAV.
const fs = require('fs');
const out = process.argv[2];
const SR = 44100;
const LEN = 3.0;
const n = Math.round(SR * LEN);
const buf = new Float64Array(n);
const intro = 1.7;
const at = (fraction) => fraction * intro;

// A warm, quiet chord that blooms in with the name.
for (const [f, a] of [[392, 0.05], [523.25, 0.045], [659.25, 0.035]]) {
  for (let i = 0; i < n; i++) {
    const t = i / SR;
    if (t > 1.7) break;
    const env = t < 0.5 ? Math.sin((t / 0.5) * Math.PI / 2) ** 2 : Math.max(0, 1 - (t - 0.5) / 1.2) ** 2;
    buf[i] += a * env * (Math.sin(2 * Math.PI * f * t) + 0.3 * Math.sin(2 * Math.PI * f * 2.003 * t));
  }
}

// Two soft pops as the leaves grow (small one first, then the big one).
function pop(start, f0, amp) {
  let phase = 0;
  for (let i = Math.round(start * SR); i < n; i++) {
    const t = i / SR - start;
    if (t > 0.25) break;
    const f = f0 * (1 + 0.6 * Math.exp(-t * 45));
    phase += (2 * Math.PI * f) / SR;
    const env = Math.min(1, t / 0.003) * Math.exp(-t * 28);
    buf[i] += amp * env * Math.sin(phase);
  }
}
pop(at(0.24) + 0.18, 740, 0.36);
pop(at(0.3) + 0.2, 988, 0.32);

// A whoosh that rises with the arrow drawing itself (0.36 to 0.86 of the intro).
{
  const a = at(0.36), b = at(0.86);
  let low = 0, band = 0;
  let seed = 7;
  const rnd = () => ((seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff) * 2 - 1;
  for (let i = Math.round(a * SR); i < Math.round((b + 0.15) * SR); i++) {
    const t = i / SR;
    const p = Math.min(1, (t - a) / (b - a));
    // Faster in the middle, like the arrow's ease-in-out.
    const env = Math.sin(Math.PI * Math.min(1, (t - a) / (b - a + 0.15))) ** 2;
    const fc = 350 * Math.pow(5200 / 350, p);
    const F = 2 * Math.sin((Math.PI * fc) / SR);
    const q = 0.55;
    const high = rnd() - low - q * band;
    band += F * high;
    low += F * band;
    buf[i] += 0.22 * env * band;
  }
}

// The finishing chime as the arrow completes: a bell-like rising fourth.
function bell(start, f0, amp) {
  const partials = [[1, 1, 2.2], [2.0, 0.42, 3.5], [3.0, 0.2, 5], [4.16, 0.12, 7], [5.43, 0.06, 9]];
  for (let i = Math.round(start * SR); i < n; i++) {
    const t = i / SR - start;
    const attack = Math.min(1, t / 0.004);
    let s = 0;
    for (const [r, a, d] of partials) s += a * Math.exp(-t * d) * Math.sin(2 * Math.PI * f0 * r * t);
    buf[i] += amp * attack * s;
  }
}
bell(at(0.86) - 0.04, 783.99, 0.2); // G5
bell(at(0.86) + 0.07, 1046.5, 0.24); // C6

// A small room, so it rings softly instead of stopping dead.
function reverb(x) {
  const y = new Float64Array(x.length);
  const combs = [1116, 1188, 1277, 1356].map((d) => ({ d, b: new Float64Array(d), i: 0, f: 0 }));
  const alls = [556, 441].map((d) => ({ d, b: new Float64Array(d), i: 0 }));
  for (let k = 0; k < x.length; k++) {
    let s = 0;
    for (const c of combs) {
      const o = c.b[c.i];
      c.f = o * 0.8 + c.f * 0.2;
      c.b[c.i] = x[k] + c.f * 0.78;
      c.i = (c.i + 1) % c.d;
      s += o;
    }
    s /= combs.length;
    for (const a of alls) {
      const o = a.b[a.i];
      a.b[a.i] = s + o * 0.5;
      a.i = (a.i + 1) % a.d;
      s = o - s;
    }
    y[k] = s;
  }
  return y;
}
const wet = reverb(buf);
const mix = buf.map((v, i) => v * 0.85 + wet[i] * 0.35);

// Fade the tail and level it to -4 dBFS.
for (let i = 0; i < n; i++) {
  const t = i / SR;
  if (t > LEN - 0.5) mix[i] *= Math.max(0, (LEN - t) / 0.5);
}
let peak = 0;
for (const v of mix) peak = Math.max(peak, Math.abs(v));
const gain = Math.pow(10, -4 / 20) / peak;

const data = Buffer.alloc(n * 2);
for (let i = 0; i < n; i++) data.writeInt16LE(Math.round(Math.max(-1, Math.min(1, mix[i] * gain)) * 32767), i * 2);
const head = Buffer.alloc(44);
head.write('RIFF', 0);
head.writeUInt32LE(36 + data.length, 4);
head.write('WAVE', 8);
head.write('fmt ', 12);
head.writeUInt32LE(16, 16);
head.writeUInt16LE(1, 20);
head.writeUInt16LE(1, 22);
head.writeUInt32LE(SR, 24);
head.writeUInt32LE(SR * 2, 28);
head.writeUInt16LE(2, 32);
head.writeUInt16LE(16, 34);
head.write('data', 36);
head.writeUInt32LE(data.length, 40);
fs.writeFileSync(out, Buffer.concat([head, data]));
console.log(`wrote ${out}: ${(n / SR).toFixed(2)} s, ${((44 + data.length) / 1024).toFixed(0)} KB`);
