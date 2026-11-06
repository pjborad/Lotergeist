import fs from "node:fs";
import path from "node:path";
import { CryptStore } from "@bsrx/tracker";
import { writeFaxPdfs } from "./fax";
import { generateWorld } from "./world";

const root = path.resolve(import.meta.dirname, "../../..");
const dataDir = path.resolve(root, process.env.DATA_DIR ?? "data");
fs.mkdirSync(dataDir, { recursive: true });
const dbPath = path.join(dataDir, "crypt.duckdb");
for (const f of [dbPath, `${dbPath}.wal`]) if (fs.existsSync(f)) fs.unlinkSync(f);

const t0 = Date.now();
const world = generateWorld();
const store = await CryptStore.open(dbPath);
await store.replaceParties(world.parties);
const n = await store.insertEvents(world.events());
await store.close();
const pdfs = await writeFaxPdfs(world, path.join(root, "fixtures/fax"));
console.log(`crypt: ${world.serialCount} packages, ${n} EPCIS events -> ${dbPath}`);
console.log(`rxterm98 fills: ${world.fills.filter((f) => f.system === "rxterm").length}, fax PDFs: ${pdfs.length}`);
console.log(`done in ${((Date.now() - t0) / 1000).toFixed(1)}s`);
