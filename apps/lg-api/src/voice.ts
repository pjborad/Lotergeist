import { execFile } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";

const run = promisify(execFile);

export interface Speech { mime: string; bytes: Buffer; voice: string }

/**
 * Text-to-speech for the pharmacist voicemail (plan section 9): clear synthetic speech, never a clone of a real
 * person. Providers are tried in order: ElevenLabs, OpenAI, the best neural voice installed on this Mac, and
 * finally "browser", where the web app reads the script with the device's own voice.
 */
export interface VoiceProvider {
  readonly name: string;
  readonly voice: string;
  synthesize(text: string): Promise<Speech | null>;
}

class ElevenLabs implements VoiceProvider {
  readonly name = "elevenlabs";
  constructor(private key: string, readonly voice: string, private model: string) {}
  async synthesize(text: string): Promise<Speech | null> {
    const res = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${encodeURIComponent(this.voice)}`, {
      method: "POST",
      headers: { "xi-api-key": this.key, "content-type": "application/json", accept: "audio/mpeg" },
      body: JSON.stringify({ text, model_id: this.model, voice_settings: { stability: 0.55, similarity_boost: 0.7, style: 0.15 } }),
      signal: AbortSignal.timeout(30_000)
    });
    if (!res.ok) throw new Error(`elevenlabs ${res.status}`);
    return { mime: "audio/mpeg", bytes: Buffer.from(await res.arrayBuffer()), voice: `elevenlabs:${this.voice}` };
  }
}

class OpenAiVoice implements VoiceProvider {
  readonly name = "openai";
  constructor(private key: string, readonly voice: string, private model: string) {}
  async synthesize(text: string): Promise<Speech | null> {
    const res = await fetch("https://api.openai.com/v1/audio/speech", {
      method: "POST",
      headers: { authorization: `Bearer ${this.key}`, "content-type": "application/json" },
      body: JSON.stringify({
        model: this.model, voice: this.voice, input: text, response_format: "mp3",
        instructions: "Speak as a calm, warm pharmacist leaving a voicemail. Natural pace, clear diction, no hype."
      }),
      signal: AbortSignal.timeout(30_000)
    });
    if (!res.ok) throw new Error(`openai tts ${res.status}`);
    return { mime: "audio/mpeg", bytes: Buffer.from(await res.arrayBuffer()), voice: `openai:${this.voice}` };
  }
}

/** Neural voices that ship with macOS, best first. "Premium" and "Enhanced" are the downloaded high-quality sets. */
const MAC_PREFERENCE = [/Ava \(Premium\)/, /Zoe \(Premium\)/, /Evan \(Premium\)/, /Allison \(Enhanced\)/, /Ava \(Enhanced\)/, /Zoe \(Enhanced\)/, /Samantha \(Enhanced\)/, /\(Premium\)/, /\(Enhanced\)/, /^Samantha/, /^Ava\b/];

/** Joke and character voices that would make a pharmacy voicemail sound like spam. */
const NOVELTY = /^(Albert|Bad News|Bahh|Bells|Boing|Bubbles|Cellos|Wobble|Fred|Good News|Jester|Junior|Kathy|Organ|Superstar|Trinoids|Whisper|Zarvox|Ralph|Grandma|Grandpa|Rocko|Shelley|Sandy|Eddy|Flo|Reed)\b/;

class MacSay implements VoiceProvider {
  readonly name = "macos-say";
  constructor(readonly voice: string) {}
  async synthesize(text: string): Promise<Speech | null> {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "lg-voice-"));
    try {
      const txt = path.join(dir, "in.txt"), aiff = path.join(dir, "out.aiff"), m4a = path.join(dir, "out.m4a");
      fs.writeFileSync(txt, text);
      await run("say", ["-v", this.voice, "-r", "165", "-f", txt, "-o", aiff], { timeout: 60_000 });
      await run("afconvert", ["-f", "m4af", "-d", "aac", "-b", "64000", aiff, m4a], { timeout: 60_000 });
      return { mime: "audio/mp4", bytes: fs.readFileSync(m4a), voice: `macos:${this.voice}` };
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  }
}

/** Reads the script in the browser. The server returns no audio; the web app uses speechSynthesis. */
class BrowserVoice implements VoiceProvider {
  readonly name = "browser";
  readonly voice = "device voice";
  async synthesize(): Promise<Speech | null> { return null; }
}

export async function bestMacVoice(): Promise<string | null> {
  if (process.platform !== "darwin") return null;
  try {
    const { stdout } = await run("say", ["-v", "?"]);
    // "Samantha (English (US)) en_US    # Hello!" or "Albert              en_US    # Hello!"
    const english = stdout.split("\n").map((l) => /^(.+?)\s+(en_(?:US|GB))\s+#/.exec(l)).filter((m): m is RegExpExecArray => !!m)
      .map((m) => m[1]!.trim()).filter((n) => !NOVELTY.test(n));
    for (const re of MAC_PREFERENCE) { const hit = english.find((n) => re.test(n)); if (hit) return hit; }
    return english.find((n) => /^(Daniel|Karen|Moira|Tessa|Alex)\b/.test(n)) ?? null;
  } catch { return null; }
}

export async function createVoice(env: Record<string, string | undefined> = process.env): Promise<VoiceProvider> {
  const want = (env.VOICE_PROVIDER ?? "auto").toLowerCase();
  if ((want === "auto" || want === "elevenlabs") && env.ELEVENLABS_API_KEY) return new ElevenLabs(env.ELEVENLABS_API_KEY, env.ELEVENLABS_VOICE_ID ?? "EXAVITQu4vr4xnSDxMaL", env.ELEVENLABS_MODEL ?? "eleven_turbo_v2_5");
  if ((want === "auto" || want === "openai") && env.OPENAI_API_KEY) return new OpenAiVoice(env.OPENAI_API_KEY, env.OPENAI_TTS_VOICE ?? "coral", env.OPENAI_TTS_MODEL ?? "gpt-4o-mini-tts");
  if (want === "auto" || want === "mac" || want === "say") {
    const v = env.MAC_VOICE ?? (await bestMacVoice());
    if (v) return new MacSay(v);
  }
  return new BrowserVoice();
}
