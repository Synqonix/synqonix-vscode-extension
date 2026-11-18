import { describe, expect, it } from "vitest";
import { DEFAULT_API_URL, isSafeApiUrl, normalizeApiUrl, originOf, safeApiUrl } from "./config";

describe("normalizeApiUrl", () => {
  it("falls back to the default", () => {
    expect(normalizeApiUrl(undefined)).toBe(DEFAULT_API_URL);
    expect(normalizeApiUrl("  ")).toBe(DEFAULT_API_URL);
  });

  it("strips trailing slashes", () => {
    expect(normalizeApiUrl("https://api.example.com//")).toBe("https://api.example.com");
  });
});

describe("api url safety", () => {
  it("allows https and loopback http only", () => {
    expect(isSafeApiUrl("https://api.example.com")).toBe(true);
    expect(isSafeApiUrl("http://localhost:4000")).toBe(true);
    expect(isSafeApiUrl("http://127.0.0.1:4000")).toBe(true);
    expect(isSafeApiUrl("http://evil.example.com")).toBe(false);
    expect(isSafeApiUrl("ftp://localhost")).toBe(false);
    expect(isSafeApiUrl("not a url")).toBe(false);
  });

  it("falls back to the default for unsafe urls", () => {
    expect(safeApiUrl("http://evil.example.com")).toBe(DEFAULT_API_URL);
    expect(safeApiUrl("https://api.example.com/")).toBe("https://api.example.com");
  });

  it("normalises origins", () => {
    expect(originOf("https://API.example.com:443/x")).toBe("https://api.example.com");
    expect(originOf("garbage")).toBeUndefined();
  });
});
