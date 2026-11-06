import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Server } from "node:http";
import { generateWorld } from "@bsrx/crypt-seed";
import { createApp } from "../src/app";

let server: Server;
let base = "";
const world = generateWorld();

beforeAll(async () => {
  server = createApp({ world, latencyMs: 0 }).listen(0);
  await new Promise((r) => server.once("listening", r));
  base = `http://localhost:${(server.address() as { port: number }).port}`;
});
afterAll(() => { server.close(); });

async function login(user = "RIV02", pass = "GRAVE98") {
  const r = await fetch(`${base}/login`, { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" }, body: `user=${user}&pass=${pass}`, redirect: "manual" });
  return { status: r.status, cookie: (r.headers.get("set-cookie") ?? "").split(";")[0]! , location: r.headers.get("location") };
}

describe("RxTerm 98", () => {
  it("rejects a bad password and redirects anonymous users to sign-on", async () => {
    expect((await login("RIV02", "nope")).location).toBe("/?err=1");
    const r = await fetch(`${base}/history`, { redirect: "manual" });
    expect(r.headers.get("location")).toBe("/");
  });

  it("pages the demo lot at Riverside: 7 rows in pages of 5", async () => {
    const { cookie } = await login();
    const get = async (p: number) => (await (await fetch(`${base}/history?ndc=70004-0417-05&lot=PRORX050925-1&page=${p}`, { headers: { cookie } })).text());
    const p1 = await get(1);
    expect(p1).toContain("0071834 S-0417  10/09/25   1  PRORX050925-1");
    expect(p1).toContain("** 5 OF 7 **");
    expect(p1).toContain('data-key="F8"');
    const p2 = await get(2);
    expect(p2).toContain("0072044");
    expect(p2).toContain("** 7 OF 7 **");
  });

  it("accepts the 10-digit hyphenated NDC too and only shows this store's rows", async () => {
    const { cookie } = await login("NHP03");
    const html = await (await fetch(`${base}/history?ndc=70004-417-05&lot=PRORX050925-1`, { headers: { cookie } })).text();
    expect(html).toContain("** 4 OF 4 **");
    expect(html).not.toContain("0071834");
  });

  it("fax-only Branch 7 has no terminal login", async () => {
    expect((await login("BR07")).location).toBe("/?err=1");
  });
});
