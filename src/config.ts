export const DEFAULT_API_URL = "http://localhost:4000";

/** Normalises a user-provided API base URL (trims whitespace and trailing slashes). */
export function normalizeApiUrl(raw: string | undefined): string {
  const value = (raw ?? "").trim().replace(/\/+$/, "");
  return value || DEFAULT_API_URL;
}

const LOOPBACK = new Set(["localhost", "127.0.0.1", "[::1]", "::1"]);

/** The origin (scheme + host + port) of a URL, or undefined when it is not a valid http(s) URL. */
export function originOf(raw: string): string | undefined {
  try {
    const u = new URL(raw);
    return u.protocol === "http:" || u.protocol === "https:" ? u.origin : undefined;
  } catch {
    return undefined;
  }
}

/** Credentials may only be sent over HTTPS, or plain HTTP to the local machine. */
export function isSafeApiUrl(raw: string): boolean {
  try {
    const u = new URL(raw);
    if (u.protocol === "https:") return true;
    return u.protocol === "http:" && LOOPBACK.has(u.hostname);
  } catch {
    return false;
  }
}

/** Like {@link normalizeApiUrl}, but falls back to the default when the URL is unsafe to send a token to. */
export function safeApiUrl(raw: string | undefined): string {
  const url = normalizeApiUrl(raw);
  return isSafeApiUrl(url) ? url : DEFAULT_API_URL;
}
