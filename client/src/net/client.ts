import type { ClientMsg, ServerMsg } from "@f1web/shared";
import { parseMsg } from "@f1web/shared";

type Handler<T extends ServerMsg["t"]> = (
  msg: Extract<ServerMsg, { t: T }>,
) => void;

/** thin typed wrapper around a WebSocket connection to the room server */
export class NetClient {
  private ws: WebSocket | null = null;
  private handlers = new Map<string, ((msg: never) => void)[]>();
  onDisconnect: (() => void) | null = null;
  connected = false;

  connect(url: string, timeoutMs = 6000): Promise<void> {
    return new Promise((resolve, reject) => {
      let settled = false;
      let ws: WebSocket;
      try {
        ws = new WebSocket(url);
      } catch (e) {
        reject(new Error("Invalid server address"));
        return;
      }
      const timer = setTimeout(() => {
        if (!settled) {
          settled = true;
          ws.close();
          reject(new Error("Connection timed out"));
        }
      }, timeoutMs);

      ws.onopen = () => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        this.ws = ws;
        this.connected = true;
        resolve();
      };
      ws.onerror = () => {
        if (!settled) {
          settled = true;
          clearTimeout(timer);
          reject(new Error("Could not reach the server"));
        }
      };
      ws.onclose = () => {
        if (!settled) {
          settled = true;
          clearTimeout(timer);
          reject(new Error("Connection closed"));
          return;
        }
        if (this.connected) {
          this.connected = false;
          this.onDisconnect?.();
        }
      };
      ws.onmessage = (ev) => {
        const msg = parseMsg<ServerMsg>(ev.data);
        if (!msg) return;
        const list = this.handlers.get(msg.t);
        if (list) for (const fn of list) (fn as (m: ServerMsg) => void)(msg);
      };
    });
  }

  on<T extends ServerMsg["t"]>(t: T, fn: Handler<T>) {
    const list = this.handlers.get(t) ?? [];
    list.push(fn as (msg: never) => void);
    this.handlers.set(t, list);
  }

  send(msg: ClientMsg) {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(msg));
    }
  }

  close() {
    this.connected = false;
    this.onDisconnect = null;
    this.ws?.close();
    this.ws = null;
    this.handlers.clear();
  }
}
