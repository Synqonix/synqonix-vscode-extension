import type { Check } from "../api/guards";

export interface ApiConfig {
  baseUrl: string;
  token: string | undefined;
}

export type ErrorKind = "offline" | "unauthorized" | "forbidden" | "not-found" | "invalid" | "server" | "incompatible";

/** What went wrong, in a form the UI can react to (re-login, offline banner, plain message). */
export class SynqonixError extends Error {
  constructor(readonly kind: ErrorKind, message: string, readonly status?: number) {
    super(message);
    this.name = "SynqonixError";
  }
}

/** Human-readable message from an API error body (arrays of validation errors are joined). */
export function messageOf(body: unknown, fallback: string): string {
  if (body && typeof body === "object" && "message" in body) {
    const m = (body as { message: unknown }).message;
    if (Array.isArray(m)) return m.join(", ");
    if (typeof m === "string") return m;
  }
  return fallback;
}

function kindOf(status: number): ErrorKind {
  if (status === 401) return "unauthorized";
  if (status === 403) return "forbidden";
  if (status === 404) return "not-found";
  if (status >= 400 && status < 500) return "invalid";
  return "server";
}

export const INCOMPATIBLE = "Extension mismatch with API, contact your admin";

export interface RequestOptions {
  query?: Record<string, string | number | boolean | undefined>;
  body?: unknown;
}

/**
 * Client for the Synqonix API. The token and base URL are read for every request, so signing in
 * or out, or changing the endpoint, takes effect immediately. Network failures become
 * `SynqonixError("offline")`; an answer that does not look like what the extension expects becomes
 * `SynqonixError("incompatible")`.
 */
export function createApi(config: () => ApiConfig, fetchImpl: typeof fetch = (...a) => globalThis.fetch(...a)) {
  async function request<T>(method: "GET" | "POST" | "PATCH", path: string, opts: RequestOptions, check: Check): Promise<T> {
    const { baseUrl, token } = config();
    const url = new URL(`${baseUrl}${path}`);
    for (const [k, v] of Object.entries(opts.query ?? {})) if (v !== undefined) url.searchParams.set(k, String(v));
    const headers: Record<string, string> = { Accept: "application/json", "User-Agent": "synqonix-vscode" };
    if (token) headers.Authorization = `Bearer ${token}`;
    if (opts.body !== undefined) headers["Content-Type"] = "application/json";

    let res: Response;
    try {
      res = await fetchImpl(url, { method, headers, ...(opts.body !== undefined ? { body: JSON.stringify(opts.body) } : {}) });
    } catch (e) {
      throw new SynqonixError("offline", `Cannot reach Synqonix (${(e as Error).message})`);
    }

    const text = await res.text().catch(() => "");
    let data: unknown;
    try {
      data = text ? JSON.parse(text) : undefined;
    } catch {
      // An error page from a proxy is a failure like any other; a success that is not JSON is a mismatch.
      if (!res.ok) throw new SynqonixError(kindOf(res.status), `Request failed (${res.status})`, res.status);
      throw new SynqonixError("incompatible", INCOMPATIBLE, res.status);
    }
    if (!res.ok) throw new SynqonixError(kindOf(res.status), messageOf(data, `Request failed (${res.status})`), res.status);
    if (!check(data)) throw new SynqonixError("incompatible", INCOMPATIBLE, res.status);
    return data as T;
  }

  return {
    get: <T>(path: string, check: Check, opts: RequestOptions = {}) => request<T>("GET", path, opts, check),
    post: <T>(path: string, check: Check, opts: RequestOptions = {}) => request<T>("POST", path, opts, check),
    patch: <T>(path: string, check: Check, opts: RequestOptions = {}) => request<T>("PATCH", path, opts, check),
  };
}

export type Api = ReturnType<typeof createApi>;
