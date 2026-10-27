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

/* ── Response parsing ─────────────────────────────────────────────── */
interface MG400Response {
  errorId: number;
  values: string[];
  raw: string;
}

function parseResponse(raw: string): MG400Response {
  const cleaned = raw.replace(/;\s*$/, "").trim();
  const braceStart = cleaned.indexOf("{");
  const braceEnd = cleaned.indexOf("},");

  let errorId = 0;
  let values: string[] = [];

  if (braceEnd !== -1) {
    errorId = parseInt(cleaned.substring(0, braceStart - 1)) || 0;
    const rest = cleaned.substring(braceEnd + 2).trim();
    values = rest.length > 0 ? rest.split(",").map((v) => v.trim()) : [];
  } else {
    errorId = parseInt(cleaned.split(",")[0]) || 0;
  }

  return { errorId, values, raw };
}

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
class MG400Client {
  private socket: net.Socket | null = null;
  private _connected = false;
  private responseBuffer = "";
  private pendingResolvers: Array<(r: MG400Response) => void> = [];
  private pendingRejectors: Array<(e: Error) => void> = [];

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

      sock.once("connect", () => {
        this.socket = sock;
        this._connected = true;
        logger.info({ ip, port }, "MG400 TCP connected");
        resolve();
      });

      sock.on("data", (chunk: Buffer) => {
        this.responseBuffer += chunk.toString();
        while (this.responseBuffer.includes(";")) {
          const idx = this.responseBuffer.indexOf(";");
          const frame = this.responseBuffer.substring(0, idx + 1);
          this.responseBuffer = this.responseBuffer.substring(idx + 1);
          const resolver = this.pendingResolvers.shift();
          this.pendingRejectors.shift();
          if (resolver) resolver(parseResponse(frame));
        }
      });

      sock.on("error", (err) => {
        this._connected = false;
        logger.error({ err: err.message }, "MG400 socket error");
        const rej = this.pendingRejectors.shift();
        this.pendingResolvers.shift();
        if (rej) rej(err);
        reject(err);
      });

      sock.on("close", () => {
        this._connected = false;
        this.socket = null;
        this.responseBuffer = "";
        logger.info("MG400 socket closed");
      });

      sock.once("timeout", () => {
        sock.destroy();
        reject(new Error("MG400 connection timeout"));
      });

      sock.connect(port, ip);
    });
  }

  /* ── Disconnect ─────────────────────────────────────────────────── */
  async disconnect(): Promise<void> {
    this.socket?.destroy();
    this.socket = null;
    this._connected = false;
    this.responseBuffer = "";
    this.pendingResolvers = [];
    this.pendingRejectors = [];
  }

  /* ── Raw command send ───────────────────────────────────────────── */
  async send(command: string, timeoutMs = 3000): Promise<MG400Response> {
    if (!this.socket || !this._connected) {
      throw new Error("Not connected to MG400");
    }

    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        const i = this.pendingRejectors.indexOf(reject);
        if (i !== -1) {
          this.pendingResolvers.splice(i, 1);
          this.pendingRejectors.splice(i, 1);
        }
        reject(new Error(`MG400 command timeout: ${command}`));
      }, timeoutMs);

      this.pendingResolvers.push((r) => {
        clearTimeout(timer);
        resolve(r);
      });
      this.pendingRejectors.push((e) => {
        clearTimeout(timer);
        reject(e);
      });

      this.socket!.write(command + "\n");
      logger.debug({ command }, "→ MG400");
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
    return parseInt(res.values[0] ?? "0") || 0;
  }

  /**
   * GetAngle() → { j1, j2, j3, j4 } in degrees
   */
  async getAngle(): Promise<{ j1: number; j2: number; j3: number; j4: number }> {
    const res = await this.send("GetAngle()");
    const [j1, j2, j3, j4] = res.values.map(Number);
    return { j1: j1 ?? 0, j2: j2 ?? 0, j3: j3 ?? 0, j4: j4 ?? 0 };
  }

  /**
   * GetPose() → { x, y, z, rx, ry, rz } in mm / degrees
   */
  async getPose(): Promise<{ x: number; y: number; z: number; rx: number; ry: number; rz: number }> {
    const res = await this.send("GetPose()");
    const [x, y, z, rx, ry, rz] = res.values.map(Number);
    return { x: x ?? 0, y: y ?? 0, z: z ?? 0, rx: rx ?? 0, ry: ry ?? 0, rz: rz ?? 0 };
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
