export class ApiError extends Error {
  constructor(message: string, public status: number, public code?: string) { super(message); }
}

/* eslint-disable @typescript-eslint/no-explicit-any */
export async function api<T = any>(method: "GET" | "POST", url: string, body?: unknown): Promise<T> {
  const res = await fetch(url, {
    method, credentials: "include",
    headers: body !== undefined ? { "Content-Type": "application/json" } : undefined,
    body: body !== undefined ? JSON.stringify(body) : undefined
  });
  const text = await res.text();
  const data = text ? JSON.parse(text) : {};
  if (!res.ok) {
    if (res.status === 401 && url !== "/api/me") window.dispatchEvent(new Event("lg:unauthenticated"));
    throw new ApiError(data.error ?? `Request failed (${res.status})`, res.status, data.code);
  }
  return data as T;
}
export const get = <T = any>(url: string) => api<T>("GET", url);
export const post = <T = any>(url: string, body: unknown = {}) => api<T>("POST", url, body);

export type Role = "technician" | "pharmacist" | "cashier" | "admin";
export interface User { id: string; name: string; role: Role; initials: string; title: string; tint: string; storeId: string; email: string }
export interface Check { id: string; label: string; state: "pass" | "fail" | "warn"; detail?: string }
export interface ScanInput { raw?: string; fields?: { ndc?: string; lot?: string; expiry?: string; serial?: string }; source?: "datamatrix" | "ocr" | "typed" }

export const msg = (e: unknown) => (e instanceof Error ? e.message : String(e));
export const dateLabel = (iso: string) => {
  if (!iso) return "—";
  const d = new Date(iso.length === 7 ? `${iso}-01T00:00:00Z` : `${iso}T00:00:00Z`);
  return Number.isNaN(+d) ? iso : d.toLocaleDateString("en-US", { month: "short", day: iso.length === 7 ? undefined : "numeric", year: "numeric", timeZone: "UTC" });
};
