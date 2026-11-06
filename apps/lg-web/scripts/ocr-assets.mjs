/**
 * Puts everything tesseract.js needs under public/ocr so OCR works offline (no CDN):
 * the worker, the WASM core and the English language data (tessdata_fast, Apache-2.0).
 */
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const out = path.resolve(import.meta.dirname, "../public/ocr");
fs.mkdirSync(out, { recursive: true });

const tjs = path.dirname(require.resolve("tesseract.js/package.json"));
const core = path.dirname(require.resolve("tesseract.js-core/package.json", { paths: [tjs] }));
fs.copyFileSync(path.join(tjs, "dist/worker.min.js"), path.join(out, "worker.min.js"));
for (const f of fs.readdirSync(core)) if (/^tesseract-core.*lstm\.wasm\.js$/.test(f)) fs.copyFileSync(path.join(core, f), path.join(out, f));

const lang = path.join(out, "eng.traineddata");
if (!fs.existsSync(lang)) {
  const res = await fetch("https://github.com/tesseract-ocr/tessdata_fast/raw/main/eng.traineddata");
  if (!res.ok) throw new Error(`could not download eng.traineddata: HTTP ${res.status}`);
  fs.writeFileSync(lang, Buffer.from(await res.arrayBuffer()));
}
console.log("OCR assets in", out, fs.readdirSync(out).join(", "));
