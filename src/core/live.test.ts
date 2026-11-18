import { describe, expect, it, vi } from "vitest";
import { debounce, LiveConnection, type LiveSocket } from "./live";

function fakeSocket() {
  const listeners = new Map<string, ((...a: unknown[]) => void)[]>();
  const emitted: [string, unknown][] = [];
  const s = {
    connected: false,
    on(event: string, l: (...a: unknown[]) => void) { listeners.set(event, [...(listeners.get(event) ?? []), l]); },
    emit(event: string, body: unknown) { emitted.push([event, body]); },
    disconnect: vi.fn(),
    fire(event: string, ...args: unknown[]) {
      if (event === "connect") s.connected = true;
      if (event === "disconnect") s.connected = false;
      for (const l of listeners.get(event) ?? []) l(...args);
    },
    emitted,
  };
  return s;
}

describe("LiveConnection", () => {
  it("connects with the token and forwards notifications and task events", () => {
    const s = fakeSocket();
    const factory = vi.fn(() => s as unknown as LiveSocket);
    const onNotification = vi.fn();
    const onTask = vi.fn();
    const live = new LiveConnection(factory, { onNotification, onTask });
    live.connect("http://api", "sqx_token");
    expect(factory).toHaveBeenCalledWith("http://api", "sqx_token");
    s.fire("connect");
    s.fire("notification", {});
    s.fire("task", { type: "updated", taskKey: "SYN-1", projectId: "p1", actorId: "u" });
    expect(onNotification).toHaveBeenCalledOnce();
    expect(onTask).toHaveBeenCalledWith(expect.objectContaining({ taskKey: "SYN-1" }));
  });

  it("subscribes to the watched project, again after reconnecting, and switches projects", () => {
    const s = fakeSocket();
    const live = new LiveConnection(() => s as unknown as LiveSocket, { onNotification: vi.fn(), onTask: vi.fn() });
    live.connect("http://api", "t");
    live.watchProject("p1"); // not connected yet: remembered
    expect(s.emitted).toEqual([]);
    s.fire("connect");
    expect(s.emitted).toEqual([["subscribe", { projectId: "p1" }]]);
    live.watchProject("p2");
    expect(s.emitted.slice(1)).toEqual([["unsubscribe", { projectId: "p1" }], ["subscribe", { projectId: "p2" }]]);
    s.fire("disconnect");
    s.fire("connect");
    expect(s.emitted.at(-1)).toEqual(["subscribe", { projectId: "p2" }]);
  });

  it("drops the old socket when reconnecting with new credentials", () => {
    const first = fakeSocket();
    const second = fakeSocket();
    const sockets = [first, second];
    const live = new LiveConnection(() => sockets.shift() as unknown as LiveSocket, { onNotification: vi.fn(), onTask: vi.fn() });
    live.connect("http://api", "a");
    live.connect("http://api", "b");
    expect(first.disconnect).toHaveBeenCalled();
    live.disconnect();
    expect(second.disconnect).toHaveBeenCalled();
  });
});

describe("debounce", () => {
  it("runs once after a burst", () => {
    vi.useFakeTimers();
    const fn = vi.fn();
    const d = debounce(fn, 300);
    d(); d(); d();
    vi.advanceTimersByTime(299);
    expect(fn).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(fn).toHaveBeenCalledOnce();
    vi.useRealTimers();
  });
});
