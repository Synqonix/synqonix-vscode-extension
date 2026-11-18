import * as vscode from "vscode";
import { createApi } from "../core/api";
import { OfflineCache } from "../core/cache";
import { Git } from "../core/git";
import { originOf, safeApiUrl } from "../config";
import { TaskService, type Project, type Workspace } from "../core/service";

const TOKEN_KEY = "synqonix.token";
/** The API origin the stored token was issued for; the token is never sent anywhere else. */
const TOKEN_ORIGIN_KEY = "synqonix.tokenOrigin";

/** Everything the UI shares: settings, the token, the chosen workspace/project and the current task. */
export class State {
  readonly changed = new vscode.EventEmitter<void>();
  readonly git = new Git();
  readonly cache: OfflineCache;
  readonly service: TaskService;
  private token: string | undefined;
  /** Set when the last request could not reach the server. */
  offline = false;
  timerRunning = false;

  constructor(readonly context: vscode.ExtensionContext) {
    this.cache = new OfflineCache(context.globalState);
    const api = createApi(() => ({ baseUrl: this.apiUrl, token: this.apiToken }));
    this.service = new TaskService(api, this.git);
  }

  async init() {
    this.token = await this.context.secrets.get(TOKEN_KEY);
    if (this.token) {
      const bound = await this.context.secrets.get(TOKEN_ORIGIN_KEY);
      // Tokens saved before origin binding adopt the current (machine-scoped) origin.
      if (!bound) await this.context.secrets.store(TOKEN_ORIGIN_KEY, this.origin ?? "");
    }
    await this.enforceOrigin();
    await vscode.commands.executeCommand("setContext", "synqonix.signedIn", !!this.apiToken);
  }

  private cfg() { return vscode.workspace.getConfiguration("synqonix"); }
  setting<T>(key: string, fallback: T): T { return this.cfg().get<T>(key) ?? fallback; }
  get apiUrl() { return safeApiUrl(this.cfg().get<string>("apiUrl")); }
  private get origin() { return originOf(this.apiUrl); }
  get webUrl() { return (this.cfg().get<string>("webUrl") || "http://localhost:3000").replace(/\/+$/, ""); }
  get signedIn() { return !!this.apiToken; }
  /**
   * The API token, only while the configured API origin is the one it was issued for.
   * If the endpoint changes, the token is withheld (and dropped on the next check) so it cannot be
   * sent to a different server.
   */
  get apiToken() { return this.token && this.tokenOrigin === this.origin ? this.token : undefined; }
  private tokenOrigin: string | undefined;

  /** Drops the stored token when the API origin no longer matches the one it was issued for. */
  async enforceOrigin() {
    if (!this.token) return;
    const bound = await this.context.secrets.get(TOKEN_ORIGIN_KEY);
    this.tokenOrigin = bound || undefined;
    if (bound !== this.origin) await this.setToken(undefined);
  }

  async setToken(token: string | undefined) {
    this.token = token;
    this.tokenOrigin = token ? this.origin : undefined;
    if (token) {
      await this.context.secrets.store(TOKEN_KEY, token);
      await this.context.secrets.store(TOKEN_ORIGIN_KEY, this.origin ?? "");
    } else {
      await this.context.secrets.delete(TOKEN_KEY);
      await this.context.secrets.delete(TOKEN_ORIGIN_KEY);
      await this.cache.clear();
      await this.context.globalState.update("synqonix.workspace", undefined);
      await this.context.globalState.update("synqonix.project", undefined);
      await this.context.workspaceState.update("synqonix.currentTask", undefined);
    }
    await vscode.commands.executeCommand("setContext", "synqonix.signedIn", !!this.apiToken);
    this.changed.fire();
  }

  get workspace(): { id: string; name: string } | undefined { return this.context.globalState.get("synqonix.workspace"); }
  get project(): { id: string; name: string; key: string } | undefined { return this.context.globalState.get("synqonix.project"); }
  get currentTask(): string | undefined { return this.context.workspaceState.get("synqonix.currentTask"); }

  async setWorkspace(w: Workspace) {
    await this.context.globalState.update("synqonix.workspace", { id: w.id, name: w.name });
    await this.context.globalState.update("synqonix.project", undefined);
    this.changed.fire();
  }
  async setProject(p: Project) {
    await this.context.globalState.update("synqonix.project", { id: p.id, name: p.name, key: p.key });
    this.changed.fire();
  }
  async setCurrentTask(key: string | undefined) {
    if (key === this.currentTask) return;
    await this.context.workspaceState.update("synqonix.currentTask", key);
    this.changed.fire();
  }

  get lastSeen(): string | undefined { return this.context.globalState.get("synqonix.lastSeenNotification"); }
  setLastSeen(v: string) { return this.context.globalState.update("synqonix.lastSeenNotification", v); }
}
