/**
 * Webcam GS1 DataMatrix scanner (SOUL-1 to SOUL-3, SOUL-12).
 *
 * Rear camera at 1280x720, about 10 decodes a second on a square crop, the browser's native BarcodeDetector when it
 * can read data_matrix, otherwise @zxing/browser. A code is accepted only when the same string is read in 2
 * consecutive frames. The stream stops when `stop()` is called (the screens do that when you leave).
 */
export interface ScannerOptions {
  video: HTMLVideoElement;
  onCode: (text: string) => void;
  fps?: number;
  /** consecutive identical reads needed to accept a code (SOUL-3) */
  consecutive?: number;
}

export interface ScannerHandle {
  backend: "barcode-detector" | "zxing";
  /** keep the camera open but stop reading (used while a result is on screen) */
  pause: () => void;
  resume: () => void;
  stop: () => void;
}

type Decoder = (canvas: HTMLCanvasElement) => Promise<string | null>;

async function makeDecoder(): Promise<{ backend: ScannerHandle["backend"]; decode: Decoder }> {
  const BD = (window as unknown as { BarcodeDetector?: { new (o: { formats: string[] }): { detect: (s: CanvasImageSource) => Promise<{ rawValue: string }[]> }; getSupportedFormats?: () => Promise<string[]> } }).BarcodeDetector;
  if (BD) {
    try {
      const formats = (await BD.getSupportedFormats?.()) ?? [];
      if (formats.includes("data_matrix")) {
        const det = new BD({ formats: ["data_matrix"] });
        return { backend: "barcode-detector", decode: async (c) => (await det.detect(c))[0]?.rawValue ?? null };
      }
    } catch { /* fall through to zxing */ }
  }
  const { BrowserMultiFormatReader } = await import("@zxing/browser");
  const { DecodeHintType, BarcodeFormat } = await import("@zxing/library");
  const hints = new Map<number, unknown>([[DecodeHintType.POSSIBLE_FORMATS, [BarcodeFormat.DATA_MATRIX]], [DecodeHintType.TRY_HARDER, true]]);
  const reader = new BrowserMultiFormatReader(hints as never);
  return {
    backend: "zxing",
    decode: async (c) => {
      try { return reader.decodeFromCanvas(c).getText(); } catch { return null; } // NotFoundException = nothing in this frame
    }
  };
}

export async function startScanner(opts: ScannerOptions): Promise<ScannerHandle> {
  // SOUL-12: getUserMedia only exists on HTTPS or localhost
  if (!window.isSecureContext || !navigator.mediaDevices?.getUserMedia) {
    throw new Error("The camera needs HTTPS or localhost. Use a USB scanner or type the code.");
  }
  const stream = await navigator.mediaDevices.getUserMedia({
    video: { facingMode: "environment", width: { ideal: 1280 }, height: { ideal: 720 } },
    audio: false
  });
  const { video } = opts;
  video.srcObject = stream;
  video.muted = true;
  video.setAttribute("playsinline", "true");
  await video.play();

  const { backend, decode } = await makeDecoder();
  const canvas = document.createElement("canvas");
  const ctx2d = canvas.getContext("2d", { willReadFrequently: true })!;
  const need = opts.consecutive ?? 2;
  let last = "";
  let streak = 0;
  let paused = false;
  let busy = false;

  const tick = async () => {
    if (paused || busy || video.readyState < 2 || !video.videoWidth) return;
    busy = true;
    try {
      // crop to the centre square: the aiming frame
      const side = Math.floor(Math.min(video.videoWidth, video.videoHeight) * 0.7);
      const sx = Math.floor((video.videoWidth - side) / 2);
      const sy = Math.floor((video.videoHeight - side) / 2);
      canvas.width = canvas.height = Math.min(side, 640);
      ctx2d.drawImage(video, sx, sy, side, side, 0, 0, canvas.width, canvas.height);
      const text = await decode(canvas);
      if (text && text === last) streak++;
      else { last = text ?? ""; streak = text ? 1 : 0; }
      if (text && streak >= need) {
        paused = true;
        last = "";
        streak = 0;
        opts.onCode(text);
      }
    } finally {
      busy = false;
    }
  };
  const timer = window.setInterval(() => { void tick(); }, Math.round(1000 / (opts.fps ?? 10)));

  return {
    backend,
    pause: () => { paused = true; },
    resume: () => { last = ""; streak = 0; paused = false; },
    stop: () => {
      window.clearInterval(timer);
      stream.getTracks().forEach((t) => t.stop());
      video.srcObject = null;
    }
  };
}
