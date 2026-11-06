/**
 * Browser OCR with tesseract.js. Everything loads from /ocr (worker, wasm core, English model), so it works offline
 * and no image leaves the machine. The recognised text is only a suggestion: the server parses it, a person checks it.
 */
let workerP: Promise<import("tesseract.js").Worker> | null = null;

export function ocrWorker() {
  workerP ??= (async () => {
    const { createWorker } = await import("tesseract.js");
    return createWorker("eng", 1, {
      workerPath: "/ocr/worker.min.js",
      corePath: "/ocr",
      langPath: "/ocr",
      gzip: false
    });
  })();
  return workerP;
}

export async function readText(image: HTMLCanvasElement | HTMLImageElement | Blob | string): Promise<{ text: string; confidence: number }> {
  const w = await ocrWorker();
  const r = await w.recognize(image as never);
  return { text: r.data.text, confidence: r.data.confidence };
}

/** Grab the current video frame (full frame: label text is usually bigger than a DataMatrix). */
export function frameOf(video: HTMLVideoElement): HTMLCanvasElement {
  const c = document.createElement("canvas");
  c.width = video.videoWidth; c.height = video.videoHeight;
  c.getContext("2d")!.drawImage(video, 0, 0);
  return c;
}
