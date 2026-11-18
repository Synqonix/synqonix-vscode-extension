/**
 * Live updates from the API over Socket.IO, so notifications and task changes show up at once
 * instead of at the next poll. VS Code-independent; polling stays as the fallback.
 */

/** The parts of a socket.io-client socket this uses (lets tests pass a fake). */
export interface LiveSocket {
  on(event: string, listener: (...args: unknown[]) => void): unknown;
  emit(event: string, body: unknown, ack?: (res: unknown) => void): unknown;
  disconnect(): unknown;
  readonly connected: boolean;
}

export type SocketFactory = (url: string, token: string) => LiveSocket;

export interface TaskEvent { type: string; taskKey: string; projectId: string; actorId: string }

export interface LiveHandlers {
  /** The user's inbox changed (the event carries no content: fetch it). */
  onNotification(): void;
  /** A task changed in the subscribed project. */
  onTask(e: TaskEvent): void;
  onStatus?(connected: boolean): void;
}

export class LiveConnection {
  private socket: LiveSocket | undefined;
  private projectId: string | undefined;

  constructor(private readonly factory: SocketFactory, private readonly handlers: LiveHandlers) {}

  get connected() { return this.socket?.connected ?? false; }

  /** (Re)connects with these credentials; the socket reconnects by itself after network drops. */
  connect(apiUrl: string, token: string) {
    this.disconnect();
    const s = this.factory(apiUrl, token);
    this.socket = s;
    s.on("connect", () => {
      this.handlers.onStatus?.(true);
      // Rooms do not survive a reconnect: subscribe again.
      if (this.projectId) s.emit("subscribe", { projectId: this.projectId });
    });
    s.on("disconnect", () => this.handlers.onStatus?.(false));
    s.on("notification", () => this.handlers.onNotification());
    s.on("task", (e) => this.handlers.onTask(e as TaskEvent));
  }

  /** Follows task changes in one project (the one shown in the trees), or none. */
  watchProject(projectId: string | undefined) {
    if (projectId === this.projectId) return;
    if (this.projectId && this.socket?.connected) this.socket.emit("unsubscribe", { projectId: this.projectId });
    this.projectId = projectId;
    if (projectId && this.socket?.connected) this.socket.emit("subscribe", { projectId });
  }

  disconnect() {
    this.socket?.disconnect();
    this.socket = undefined;
  }
}

/** Calls `fn` once after calls stop for `ms` (bursts of events cause one refresh). */
export function debounce(fn: () => void, ms: number, timers = { set: setTimeout, clear: clearTimeout }) {
  let handle: ReturnType<typeof setTimeout> | undefined;
  return () => {
    if (handle !== undefined) timers.clear(handle);
    handle = timers.set(() => { handle = undefined; fn(); }, ms);
  };
}
