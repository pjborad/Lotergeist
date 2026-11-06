/** RPA-5: the bot may only navigate to hosts on the allowlist. */
export function hostAllowed(url: string, allowedHosts: string[]): boolean {
  let u: URL;
  try { u = new URL(url); } catch { return false; }
  if (u.protocol === "data:" || u.protocol === "about:" || u.protocol === "blob:") return true;
  if (u.protocol !== "http:" && u.protocol !== "https:") return false;
  return allowedHosts.some((h) => h.toLowerCase() === u.host.toLowerCase() || h.toLowerCase() === u.hostname.toLowerCase());
}

export function assertAllowed(url: string, allowedHosts: string[]) {
  if (!hostAllowed(url, allowedHosts)) throw new Error(`RPA-5: ${url} is not on the allowlist (${allowedHosts.join(", ")})`);
}
