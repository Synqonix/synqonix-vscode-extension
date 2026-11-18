import { io } from "socket.io-client";
import * as vscode from "vscode";
import { SynqonixError } from "./core/api";
import { debounce, LiveConnection } from "./core/live";
import { DEFAULT_TOAST_TYPES, NotificationPoller } from "./core/notifications";
import { registerCommands } from "./ui/commands";
import { syncCurrentTaskFromBranch, watchBranch } from "./ui/git-watch";
import { State } from "./ui/state";
import { StatusBar } from "./ui/statusbar";
import { TaskPanels } from "./ui/task-panel";
import { createTrees } from "./ui/trees";

export async function activate(context: vscode.ExtensionContext) {
  const output = vscode.window.createOutputChannel("Synqonix");
  const state = new State(context);
  await state.init();

  const statusBar = new StatusBar(state);
  const run = async (fn: () => Promise<unknown>) => {
    try { await fn(); } catch (e) { void vscode.window.showErrorMessage(`Synqonix: ${(e as Error).message}`); }
  };
  const panels = new TaskPanels(state, run);
  const trees = createTrees(state);

  const poller = new NotificationPoller({
    fetch: async () => (state.signedIn && state.setting("notifications.enabled", true) ? state.service.unreadNotifications() : []),
    getLastSeen: () => state.lastSeen,
    setLastSeen: async (v) => { await state.setLastSeen(v); },
    intervalMs: Math.max(30, state.setting("notifications.intervalSeconds", 60)) * 1000,
    onError: (e) => {
      output.appendLine(`[notifications] ${(e as Error).message}`);
      if (e instanceof SynqonixError && e.kind === "unauthorized") void vscode.commands.executeCommand("synqonix.handleUnauthorized");
    },
    onNew: (fresh) => {
      for (const n of fresh.filter((x) => DEFAULT_TOAST_TYPES.includes(x.type)).slice(0, 3)) {
        const key = n.taskKey;
        void vscode.window.showInformationMessage(n.title, ...(key ? ["Open"] : [])).then((p) => p && key && vscode.commands.executeCommand("synqonix.openTask", key));
      }
    },
  });

  // Live updates: notifications and task changes arrive at once; polling stays as the fallback.
  const live = new LiveConnection(
    (url, token) => io(url, { auth: { token }, transports: ["websocket"], reconnectionDelayMax: 30_000 }),
    {
      onNotification: debounce(() => void poller.pollOnce(), 500),
      onTask: debounce(() => Object.values(trees).forEach((t) => t.refresh()), 1000),
      onStatus: (connected) => output.appendLine(`[live] ${connected ? "connected" : "disconnected"}`),
    },
  );
  let liveKey: string | undefined;
  const syncLive = () => {
    const token = state.apiToken;
    const key = state.signedIn && token ? `${state.apiUrl}|${token}` : undefined;
    if (key !== liveKey) {
      liveKey = key;
      if (key && token) live.connect(state.apiUrl, token);
      else live.disconnect();
    }
    live.watchProject(key ? state.project?.id : undefined);
  };

  context.subscriptions.push(
    output,
    statusBar,
    ...Object.entries(trees).map(([id, provider]) => vscode.window.createTreeView(id, { treeDataProvider: provider })),
    ...registerCommands({ state, panels, statusBar, trees, output, pollNotifications: () => poller.pollOnce() }),
    watchBranch(state),
    { dispose: () => poller.stop() },
    { dispose: () => live.disconnect() },
    vscode.workspace.onDidChangeConfiguration((e) => e.affectsConfiguration("synqonix.apiUrl") && void state.enforceOrigin().then(syncLive)),
  );

  if (state.signedIn) {
    void syncCurrentTaskFromBranch(state);
    void vscode.commands.executeCommand("synqonix.refresh");
    poller.start();
  }
  syncLive();
  state.changed.event(() => {
    if (state.signedIn) poller.start();
    else poller.stop();
    syncLive();
  });
}

export function deactivate() {}
