import { describe, expect, it } from "vitest";
import { any, array, object, withArray } from "../api/guards";
import { createApi, INCOMPATIBLE, SynqonixError } from "./api";

type Call = { url: string; init: RequestInit };
const respond = (status: number, body?: unknown, raw?: string) =>
  (calls: Call[]) => async (url: string | URL | Request, init?: RequestInit) => {
    calls.push({ url: String(url), init: init ?? {} });
    return new Response(raw ?? (body === undefined ? null : JSON.stringify(body)), { status });
  };
const make = (reply: ReturnType<typeof respond>, token: string | undefined = "sqx_abc", baseUrl = "https://api.example.com") => {
  const calls: Call[] = [];
  const api = createApi(() => ({ baseUrl, token }), reply(calls) as typeof fetch);
  return { api, calls };
};
const fail = (p: Promise<unknown>) => p.then(() => { throw new Error("expected a failure"); }, (e: unknown) => e as SynqonixError);
const kindOf = async (p: Promise<unknown>) => p.then(() => "ok", (e: SynqonixError) => e.kind);

describe("api client", () => {
  it("sends the token, query and body, and returns the parsed answer", async () => {
    const { api, calls } = make(respond(200, { items: [{ id: "1" }] }));
    const out = await api.post<{ items: { id: string }[] }>("/api/v1/x", withArray("items", object("id")), { query: { a: 1, skip: undefined, b: true }, body: { hello: "world" } });
    expect(out.items[0].id).toBe("1");
    expect(calls[0].url).toBe("https://api.example.com/api/v1/x?a=1&b=true");
    const headers = calls[0].init.headers as Record<string, string>;
    expect(headers.Authorization).toBe("Bearer sqx_abc");
    expect(headers["Content-Type"]).toBe("application/json");
    expect(calls[0].init.body).toBe('{"hello":"world"}');
  });

  it("sends no Authorization header without a token and reads the base URL per request", async () => {
    const calls: Call[] = [];
    let baseUrl = "https://a.example.com";
    const api = createApi(() => ({ baseUrl, token: undefined }), respond(200, [])(calls) as typeof fetch);
    await api.get("/p", array());
    baseUrl = "https://b.example.com";
    await api.get("/p", array());
    expect(calls.map((c) => c.url)).toEqual(["https://a.example.com/p", "https://b.example.com/p"]);
    expect((calls[0].init.headers as Record<string, string>).Authorization).toBeUndefined();
  });

  it("maps failures to error kinds, using the server's message", async () => {
    const cases: [number, string][] = [[401, "unauthorized"], [403, "forbidden"], [404, "not-found"], [400, "invalid"], [500, "server"]];
    for (const [status, kind] of cases) {
      const { api } = make(respond(status, { message: "nope" }));
      const err = await fail(api.get("/x", any));
      expect(err).toBeInstanceOf(SynqonixError);
      expect([err.kind, err.message, err.status]).toEqual([kind, "nope", status]);
    }
    const { api } = make(respond(400, { message: ["a", "b"] }));
    expect((await fail(api.get("/x", any))).message).toBe("a, b");
  });

  it("reports an unreachable server as offline", async () => {
    const api = createApi(() => ({ baseUrl: "https://x.test", token: undefined }), (async () => { throw new Error("ECONNREFUSED"); }) as typeof fetch);
    expect(await kindOf(api.get("/x", any))).toBe("offline");
  });

  it("reports an answer of the wrong shape as an extension/API mismatch", async () => {
    const { api } = make(respond(200, { unexpected: true }));
    const err = await fail(api.get("/x", withArray("items")));
    expect([err.kind, err.message]).toEqual(["incompatible", INCOMPATIBLE]);
    expect(INCOMPATIBLE).toBe("Extension mismatch with API, contact your admin");
    expect(await kindOf(make(respond(200, undefined, "<html>proxy</html>")).api.get("/x", any))).toBe("incompatible");
  });

  it("does not call a proxy's HTML error page a mismatch", async () => {
    expect(await kindOf(make(respond(502, undefined, "<html>bad gateway</html>")).api.get("/x", any))).toBe("server");
  });
});
