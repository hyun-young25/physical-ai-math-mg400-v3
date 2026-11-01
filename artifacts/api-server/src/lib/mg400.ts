/**
 * MG400 Dashboard TCP client (port 29999).
 *
 * The robot uses a simple text protocol:
 *   → Send:    "CommandName(args)\n"
 *   ← Receive: "ErrorID,{CommandName(args)},ReturnValues;\n"
 *
 * This module exports a singleton `mg400` that the route layer uses.
 * Only one TCP connection is maintained at a time.
 */
import net from "net";
import { logger } from "./logger";
import { parseMG400Response, requireFiniteMG400Values, type MG400Response } from "./mg400Protocol";

/* ── Robot mode constants ─────────────────────────────────────────── */
export const RobotMode = {
  INIT:      1,
  BRAKE:     2,
  DISABLED:  4,
  ENABLED:   5,
  BACKDRIVE: 6,
  RUNNING:   7,
  RECORDING: 8,
  ERROR:     9,
  PAUSE:     10,
  JOG:       11,
} as const;

export type RobotModeValue = (typeof RobotMode)[keyof typeof RobotMode];

/* ── MG400Client ──────────────────────────────────────────────────── */
type PendingCommand = {
  command: string;
  resolve: (response: MG400Response) => void;
  reject: (error: Error) => void;
  timer: ReturnType<typeof setTimeout>;
};

export class MG400Client {
  private socket: net.Socket | null = null;
  private _connected = false;
  private responseBuffer = "";
  private pendingCommands: PendingCommand[] = [];

  /* ── Public state ───────────────────────────────────────────────── */
  isConnected(): boolean {
    return this._connected;
  }

  /* ── Connect ────────────────────────────────────────────────────── */
  async connect(ip: string, port = 29999): Promise<void> {
    if (this._connected) {
      await this.disconnect();
    }

    return new Promise((resolve, reject) => {
      const sock = new net.Socket();
      sock.setTimeout(5000);
      let settled = false;

      sock.once("connect", () => {
        settled = true;
        this.socket = sock;
        this._connected = true;
        logger.info({ ip, port }, "MG400 TCP connected");
        resolve();
      });

      sock.on("data", (chunk: Buffer) => {
        if (this.socket !== sock || !this._connected) return;
        this.responseBuffer += chunk.toString();
        while (this.responseBuffer.includes(";")) {
          const idx = this.responseBuffer.indexOf(";");
          const frame = this.responseBuffer.substring(0, idx + 1);
          this.responseBuffer = this.responseBuffer.substring(idx + 1);
          let response: MG400Response;
          try {
            response = parseMG400Response(frame);
          } catch (error) {
            this.failConnection(error instanceof Error ? error : new Error(String(error)), sock);
            return;
          }
          const pending = this.pendingCommands[0];
          if (!pending) {
            logger.warn({ command: response.command }, "Ignoring unsolicited MG400 response");
            continue;
          }
          if (response.command !== pending.command) {
            this.failConnection(new Error(
              `MG400 응답 명령이 요청과 다릅니다. 요청=${pending.command}, 응답=${response.command}`,
            ), sock);
            return;
          }
          this.pendingCommands.shift();
          clearTimeout(pending.timer);
          pending.resolve(response);
        }
      });

      sock.on("error", (err) => {
        logger.error({ err: err.message }, "MG400 socket error");
        if (!settled) {
          settled = true;
          reject(err);
        }
        this.failConnection(err, sock);
      });

      sock.on("close", () => {
        logger.info("MG400 socket closed");
        const error = new Error("MG400 연결이 닫혔습니다.");
        if (!settled) {
          settled = true;
          reject(error);
        }
        this.failConnection(error, sock, false);
      });

      sock.once("timeout", () => {
        const error = new Error("MG400 연결 시간 초과");
        if (!settled) {
          settled = true;
          reject(error);
        }
        this.failConnection(error, sock);
      });

      sock.connect(port, ip);
    });
  }

  /* ── Disconnect ─────────────────────────────────────────────────── */
  async disconnect(): Promise<void> {
    this.failConnection(new Error("MG400 연결을 종료했습니다."));
  }

  private failConnection(error: Error, expectedSocket?: net.Socket, destroy = true): void {
    if (expectedSocket && this.socket && this.socket !== expectedSocket) return;
    const socket = this.socket ?? expectedSocket ?? null;
    this.socket = null;
    this._connected = false;
    this.responseBuffer = "";
    const pending = this.pendingCommands;
    this.pendingCommands = [];
    for (const command of pending) {
      clearTimeout(command.timer);
      command.reject(error);
    }
    if (destroy && socket && !socket.destroyed) socket.destroy();
  }

  /* ── Raw command send ───────────────────────────────────────────── */
  async send(command: string, timeoutMs = 3000): Promise<MG400Response> {
    if (!this.socket || !this._connected) {
      throw new Error("Not connected to MG400");
    }

    return new Promise((resolve, reject) => {
      const socket = this.socket;
      if (!socket || !this._connected) {
        reject(new Error("Not connected to MG400"));
        return;
      }
      const timer = setTimeout(() => {
        this.failConnection(new Error(`MG400 command timeout: ${command}`), socket);
      }, timeoutMs);

      this.pendingCommands.push({ command, resolve, reject, timer });
      try {
        socket.write(command + "\n");
        logger.debug({ command }, "→ MG400");
      } catch (error) {
        this.failConnection(error instanceof Error ? error : new Error(String(error)), socket);
      }
    });
  }

  /* ── High-level API ─────────────────────────────────────────────── */

  async enable(): Promise<MG400Response> {
    return this.send("EnableRobot()");
  }

  async disable(): Promise<MG400Response> {
    return this.send("DisableRobot()");
  }

  async reset(): Promise<MG400Response> {
    return this.send("ClearError()");
  }

  async setSpeed(ratio: number): Promise<MG400Response> {
    const r = Math.max(1, Math.min(100, Math.round(ratio)));
    return this.send(`SpeedFactor(${r})`);
  }

  async getMode(): Promise<number> {
    const res = await this.send("RobotMode()");
    const [mode] = requireFiniteMG400Values(res, "RobotMode", 1);
    if (!Number.isInteger(mode)) throw new Error("RobotMode 응답이 정수가 아닙니다.");
    return mode;
  }

  /**
   * GetAngle() → { j1, j2, j3, j4 } in degrees
   */
  async getAngle(): Promise<{ j1: number; j2: number; j3: number; j4: number }> {
    const res = await this.send("GetAngle()");
    const [j1, j2, j3, j4] = requireFiniteMG400Values(res, "GetAngle", 4);
    return { j1, j2, j3, j4 };
  }

  /**
   * GetPose() → { x, y, z, rx, ry, rz } in mm / degrees
   */
  async getPose(): Promise<{ x: number; y: number; z: number; rx: number; ry: number; rz: number }> {
    const res = await this.send("GetPose()");
    const [x, y, z, rx, ry, rz] = requireFiniteMG400Values(res, "GetPose", 6);
    return { x, y, z, rx, ry, rz };
  }

  /**
   * MoveJog — starts continuous jog.
   * jog_mode examples: "j1+", "j1-", "x+", "x-", "y+", "y-", "z+", "z-", "rx+"
   */
  async moveJog(jogMode: string): Promise<MG400Response> {
    return this.send(`MoveJog(${jogMode})`);
  }

  /**
   * StopJog — stops any running jog movement.
   */
  async stopJog(): Promise<MG400Response> {
    return this.send("MoveJog()");
  }
}

export const mg400 = new MG400Client();
