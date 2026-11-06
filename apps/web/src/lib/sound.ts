/** Sound is off by default and stays off with prefers-reduced-motion (UX-2). Tones are synthesised: no assets to ship. */
const KEY = "bsrx.sound";
let ctx: AudioContext | null = null;
const listeners = new Set<() => void>();

export const reducedMotion = () => typeof window !== "undefined" && !!window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
export const soundOn = () => !reducedMotion() && localStorage.getItem(KEY) === "1";
export function setSound(on: boolean) {
  localStorage.setItem(KEY, on ? "1" : "0");
  listeners.forEach((l) => l());
}
export const subscribeSound = (l: () => void) => { listeners.add(l); return () => { listeners.delete(l); }; };

function tone(freq: number, start: number, dur: number, type: OscillatorType = "sine", gain = 0.07) {
  if (!ctx) return;
  const o = ctx.createOscillator();
  const g = ctx.createGain();
  o.type = type;
  o.frequency.setValueAtTime(freq, ctx.currentTime + start);
  g.gain.setValueAtTime(0.0001, ctx.currentTime + start);
  g.gain.exponentialRampToValueAtTime(gain, ctx.currentTime + start + 0.02);
  g.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + start + dur);
  o.connect(g).connect(ctx.destination);
  o.start(ctx.currentTime + start);
  o.stop(ctx.currentTime + start + dur + 0.05);
}

export function play(kind: "bell" | "crack" | "chime" | "seal") {
  if (!soundOn()) return;
  ctx ??= new AudioContext();
  void ctx.resume();
  if (kind === "bell") { tone(196, 0, 1.6, "sine", 0.09); tone(392.5, 0, 1.2, "sine", 0.04); }
  if (kind === "crack") { tone(90, 0, 0.25, "sawtooth", 0.08); tone(1400, 0.02, 0.08, "square", 0.04); tone(700, 0.08, 0.1, "square", 0.03); }
  if (kind === "chime") { tone(880, 0, 0.5); tone(1318.5, 0.12, 0.6); }
  if (kind === "seal") { tone(160, 0, 0.12, "triangle", 0.09); }
}
