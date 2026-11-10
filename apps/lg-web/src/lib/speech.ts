/**
 * Fallback when the server has no voice provider: read the script with the best voice this device has.
 * Neural voices (Edge "Natural", Chrome "Google", macOS "Premium/Enhanced") sound far less robotic than defaults.
 */
const PREF = [/Natural/i, /Premium/i, /Enhanced/i, /^Google US English$/i, /^Samantha$/i, /^Ava\b/i, /^Allison$/i, /Aria|Jenny|Guy/i];

export function bestVoice(): SpeechSynthesisVoice | null {
  if (typeof speechSynthesis === "undefined") return null;
  const en = speechSynthesis.getVoices().filter((v) => /^en[-_](US|GB)/i.test(v.lang));
  for (const re of PREF) { const v = en.find((x) => re.test(x.name)); if (v) return v; }
  return en[0] ?? null;
}

export function speak(text: string, onEnd?: () => void): () => void {
  if (typeof speechSynthesis === "undefined") { onEnd?.(); return () => undefined; }
  speechSynthesis.cancel();
  const u = new SpeechSynthesisUtterance(text);
  const v = bestVoice();
  if (v) u.voice = v;
  u.rate = 0.95; u.pitch = 1;
  u.onend = () => onEnd?.();
  speechSynthesis.speak(u);
  return () => speechSynthesis.cancel();
}

export const deviceVoiceName = () => bestVoice()?.name ?? "device voice";
