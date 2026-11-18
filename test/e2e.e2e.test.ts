import { execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import * as vscode from "vscode";
import { activate } from "../src/extension";
import { State } from "../src/ui/state";
import { createTrees } from "../src/ui/trees";
import { host, Uri } from "./fake-vscode";

const API = process.env.SYNQONIX_API ?? "http://localhost:4000";
const git = (cwd: string, ...a: string[]) => execFileSync("git", a, { cwd, encoding: "utf8" }).trim();

async function http<T>(path: string, init: { method?: string; token?: string; body?: unknown } = {}): Promise<T> {
  const r = await fetch(`${API}/api/v1${path}`, {
    method: init.method ?? (init.body ? "POST" : "GET"),
    headers: { "content-type": "application/json", ...(init.token ? { authorization: `Bearer ${init.token}` } : {}) },
    body: init.body ? JSON.stringify(init.body) : undefined,
  });
  if (!r.ok) throw new Error(`${path} → ${r.status} ${await r.text()}`);
  return r.status === 204 ? (undefined as T) : ((await r.json()) as T);
}

const memento = () => {
  const m = new Map<string, unknown>();
  return { get: <T>(k: string) => m.get(k) as T | undefined, update: async (k: string, v: unknown) => void (v === undefined ? m.delete(k) : m.set(k, v)), keys: () => [...m.keys()] };
};

const MAIL_URL = process.env.SYNQONIX_MAIL_URL ?? "http://localhost:6245";

/** Token from the newest `path` link emailed to `to` (read from Dev-Remail's Resend-compatible API). */
async function emailedToken(to: string, path: string): Promise<string> {
  const get = async <T>(p: string) => (await (await fetch(`${MAIL_URL}${p}`, { headers: { authorization: "Bearer re_dev" } })).json()) as T;
  for (let i = 0; i < 50; i++) {
    const { data } = await get<{ data: { id: string; to: string[]; created_at: string }[] }>("/emails?limit=100");
    const mine = data.filter((e) => e.to.includes(to)).sort((a, b) => b.created_at.localeCompare(a.created_at));
    for (const e of mine) {
      const token = new RegExp(`${path}\\?token=([^\\s"<]+)`).exec((await get<{ text: string }>(`/emails/${e.id}`)).text)?.[1];
      if (token) return decodeURIComponent(token);
    }
    await new Promise((r) => setTimeout(r, 200));
  }
  throw new Error(`No ${path} link emailed to ${to} (is Dev-Remail running at ${MAIL_URL}?)`);
}

describe("extension against the real API", () => {
  let repo: string;
  let apiToken: string;
  let wsId: string;
  let session: string;
  let keys: string[];
  let ctx: vscode.ExtensionContext;
  const run = (id: string, ...a: unknown[]) => vscode.commands.executeCommand(id, ...a);
  const freshState = async () => { const s = new State(ctx); await s.init(); return s; };
  const signIn = async (token = apiToken) => {
    await run("synqonix.signIn");
    const state = new URL(host.opened.at(-1)!).searchParams.get("state")!;
    await host.uriHandler!.handleUri(Uri.parse(`vscode://synqonix.synqonix/auth?token=${token}&state=${state}`));
  };

  beforeAll(async () => {
    const stamp = Date.now();
    const email = `vsc${stamp}@example.com`;
    await http("/auth/register", { body: { email, name: "Vee Esc", password: "correct horse battery 9" } });
    // Sign-up finishes through the emailed link (caught by Dev-Remail in development).
    const reg = await http<{ accessToken: string }>("/auth/verify-email", { body: { token: await emailedToken(email, "/verify-email"), password: "correct horse battery 9" } });
    session = reg.accessToken;
    apiToken = (await http<{ token: string }>("/api-tokens", { token: session, body: { name: "e2e" } })).token;
    wsId = (await http<{ id: string }>("/workspaces", { token: session, body: { name: `E2E ${stamp}` } })).id;
    const project = await http<{ id: string }>(`/workspaces/${wsId}/projects`, { token: session, body: { name: "Editor", key: "EDT", template: "SCRUM" } });
    keys = [];
    for (const title of ["Fix the login redirect", "Write release notes"]) {
      keys.push((await http<{ key: string }>(`/workspaces/${wsId}/projects/${project.id}/tasks`, { token: session, body: { title, type: "TASK" } })).key);
    }

    repo = mkdtempSync(join(tmpdir(), "sqx-e2e-"));
    git(repo, "init", "-q", "-b", "main");
    git(repo, "config", "user.email", "t@example.com");
    git(repo, "config", "user.name", "T");
    writeFileSync(join(repo, "a.txt"), "a");
    git(repo, "add", ".");
    git(repo, "commit", "-qm", "init");

    host.reset();
    host.folders = [repo];
    host.config = { apiUrl: API, webUrl: "http://localhost:3000" };
    const ws = memento();
    const g = memento();
    ctx = {
      subscriptions: [],
      globalState: g,
      workspaceState: ws,
      secrets: { get: async (k: string) => host.secrets.get(k), store: async (k: string, v: string) => void host.secrets.set(k, v), delete: async (k: string) => void host.secrets.delete(k) },
    } as unknown as vscode.ExtensionContext;
    await activate(ctx);
  });

  afterAll(() => {
    for (const d of ctx.subscriptions) d.dispose();
    rmSync(repo, { recursive: true, force: true });
  });

  it("ignores a sign-in response that does not match the request", async () => {
    await run("synqonix.signIn");
    expect(host.opened.at(-1)).toMatch(/^http:\/\/localhost:3000\/connect\/vscode\?state=[a-f0-9]{32}$/);
    await host.uriHandler!.handleUri(Uri.parse(`vscode://synqonix.synqonix/auth?token=${apiToken}&state=${"0".repeat(32)}`));
    expect(host.secrets.size).toBe(0);
    expect(host.messages.some((m) => m.level === "warn" && /did not match/.test(m.text))).toBe(true);
  });

  it("signs in through the browser handshake and picks the only workspace", async () => {
    await signIn();
    expect(host.secrets.get("synqonix.token")).toBe(apiToken);
    expect(host.messages.some((m) => /Signed in to Synqonix as Vee Esc/.test(m.text))).toBe(true);
    expect((ctx.globalState.get("synqonix.workspace") as { id: string }).id).toBe(wsId);
  });

  it("starts a task: creates the branch, assigns, moves to in progress, sets current task", async () => {
    await run("synqonix.startTask", keys[0]);
    expect(git(repo, "branch", "--show-current")).toBe(`${keys[0].toLowerCase()}-fix-the-login-redirect`);
    const t = await http<{ status: { category: string }; assignees: { name: string }[] }>(`/workspaces/${wsId}/tasks/${keys[0]}`, { token: session });
    expect(t.status.category).toBe("IN_PROGRESS");
    expect(t.assignees.map((a) => a.name)).toContain("Vee Esc");
    expect(ctx.workspaceState.get("synqonix.currentTask")).toBe(keys[0]);
    expect(host.statusBars.some((s) => s.visible && s.text.includes(keys[0]))).toBe(true);
  });

  it("starting again switches to the existing branch instead of failing", async () => {
    git(repo, "checkout", "-q", "main");
    await run("synqonix.startTask", keys[0]);
    expect(git(repo, "branch", "--show-current")).toContain(keys[0].toLowerCase());
  });

  it("shows my tasks in the tree, grouped by status", async () => {
    const tree = createTrees(await freshState())["synqonix.myTasks"];
    const groups = await tree.getChildren();
    expect(groups.map((g) => g.label)).toEqual(["In progress", "To do"]);
    const items = await tree.getChildren(groups[0]);
    expect(items[0].label).toContain(keys[0]);
  });

  it("moves a task, comments, and renders the task panel", async () => {
    host.answers = ["Done"];
    await run("synqonix.transitionTask", keys[0]);
    expect((await http<{ status: { category: string } }>(`/workspaces/${wsId}/tasks/${keys[0]}`, { token: session })).status.category).toBe("DONE");

    host.answers = ["Shipped from the editor"];
    await run("synqonix.commentOnTask", keys[0]);
    await run("synqonix.openTask", keys[0]);
    const html = host.panels.at(-1)!.webview.html;
    expect(html).toContain("Shipped from the editor");
    expect(html).toContain("Content-Security-Policy");
  });

  it("panel messages change the task", async () => {
    const panel = host.panels.at(-1)!;
    await panel.webview.handler!({ type: "priority", value: "URGENT" });
    await new Promise((r) => setTimeout(r, 200));
    expect((await http<{ priority: string }>(`/workspaces/${wsId}/tasks/${keys[0]}`, { token: session })).priority).toBe("URGENT");
  });

  it("creates a task from the editor", async () => {
    // No project chosen yet, so the command asks for one first.
    host.answers = [(items: { label: string }[]) => items.find((i) => i.label.startsWith("EDT")), "Created from VS Code", "BUG"];
    await run("synqonix.createTask");
    const list = await http<{ items: { title: string; type: string }[] }>(`/workspaces/${wsId}/tasks?limit=50`, { token: session });
    expect(list.items.find((t) => t.title === "Created from VS Code")?.type).toBe("BUG");
  });

  it("times work: start, status bar ticks, stop", async () => {
    await run("synqonix.toggleTimer", keys[1]);
    expect((await http<{ entry: { taskKey: string } | null }>(`/workspaces/${wsId}/time/timer`, { token: session })).entry?.taskKey).toBe(keys[1]);
    expect(host.statusBars.some((s) => s.visible && s.text.startsWith("$(clock)"))).toBe(true);
    await run("synqonix.stopTimer");
    expect((await http<{ entry: unknown }>(`/workspaces/${wsId}/time/timer`, { token: session })).entry).toBeNull();
    expect(host.statusBars.some((s) => s.visible && s.text.startsWith("$(clock)"))).toBe(false);
  });

  it("reads the inbox with the personal token", async () => {
    const items = await (await freshState()).service.unreadNotifications().catch((e) => { throw e; });
    expect(Array.isArray(items)).toBe(true);
  });

  it("keeps showing cached tasks when the server is unreachable", async () => {
    const online = createTrees(await freshState())["synqonix.myTasks"];
    await online.getChildren(); // fill the cache while online
    // A server that cannot be reached, with the token issued for that address (a token is never sent elsewhere).
    const real = host.secrets.get("synqonix.tokenOrigin");
    try {
      host.config = { apiUrl: "http://127.0.0.1:9", webUrl: "http://localhost:3000" };
      host.secrets.set("synqonix.tokenOrigin", "http://127.0.0.1:9");
      const nodes = await createTrees(await freshState())["synqonix.myTasks"].getChildren();
      expect(String(nodes[0].label)).toMatch(/^Offline — showing data from/);
      expect(nodes.length).toBeGreaterThan(1);
    } finally {
      host.config = { apiUrl: API, webUrl: "http://localhost:3000" };
      if (real) host.secrets.set("synqonix.tokenOrigin", real);
    }
  });

  it("reads the backlog, recent tasks and search results in the shape the extension expects", async () => {
    const { service } = await freshState();
    const [project] = await service.projects(wsId);
    // Its own task, so what earlier tests did to the others does not matter.
    const probe = (await http<{ key: string }>(`/workspaces/${wsId}/projects/${project.id}/tasks`, { token: session, body: { title: "Zebra crossing probe", type: "TASK" } })).key;
    const backlog = await service.backlog(wsId, project.id);
    expect(Array.isArray(backlog.sprints)).toBe(true);
    expect([...backlog.backlog.tasks, ...backlog.sprints.flatMap((x) => x.tasks)].map((t) => t.key)).toContain(probe);
    await http(`/workspaces/${wsId}/tasks/${probe}/viewed`, { method: "POST", token: session }); // the web app records views
    expect((await service.recent(wsId)).map((t) => t.key)).toContain(probe);
    expect((await service.search(wsId, "zebra")).map((h) => h.key)).toContain(probe);
    expect(await service.search(wsId, "   ")).toEqual([]);
  });

  it("does not send the token to another address than the one it was issued for", async () => {
    const other = await freshState();
    host.config = { apiUrl: "http://127.0.0.1:9", webUrl: "http://localhost:3000" };
    try {
      expect(other.apiToken).toBeUndefined();
      expect(other.signedIn).toBe(false);
    } finally {
      host.config = { apiUrl: API, webUrl: "http://localhost:3000" };
    }
  });

  it("a revoked token signs the user out with a prompt", async () => {
    const id = (await http<{ id: string; prefix: string }[]>("/api-tokens", { token: session })).find((t) => apiToken.startsWith(t.prefix))!.id;
    await http(`/api-tokens/${id}`, { method: "DELETE", token: session });
    host.buttons = [];
    await run("synqonix.refresh");
    await run("synqonix.createTask").catch(() => undefined);
    expect(host.secrets.has("synqonix.token")).toBe(false);
    expect(host.messages.some((m) => /no longer valid/.test(m.text))).toBe(true);
  });

  it("hears task changes live over the API token", async () => {
    const { io } = await import("socket.io-client");
    const { LiveConnection } = await import("../src/core/live");
    const project = (await http<{ id: string }[]>(`/workspaces/${wsId}/projects`, { token: session }))[0];
    const heard: string[] = [];
    let connected!: () => void;
    const ready = new Promise<void>((r) => (connected = r));
    const live = new LiveConnection((url, token) => io(url, { auth: { token }, transports: ["websocket"], reconnection: false }), {
      onNotification: () => undefined,
      onTask: (e) => heard.push(`${e.type} ${e.taskKey}`),
      onStatus: (c) => c && connected(),
    });
    const token = (await http<{ token: string }>("/api-tokens", { token: session, body: { name: "live" } })).token; // the shared one was revoked above
    live.watchProject(project.id);
    live.connect(API, token);
    await ready;
    await new Promise((r) => setTimeout(r, 200)); // let the subscription land
    const task = await http<{ key: string }>(`/workspaces/${wsId}/projects/${project.id}/tasks`, { token: session, body: { title: "Live one", type: "TASK" } });
    for (let i = 0; i < 50 && !heard.includes(`created ${task.key}`); i++) await new Promise((r) => setTimeout(r, 100));
    live.disconnect();
    expect(heard).toContain(`created ${task.key}`);
  });
});
