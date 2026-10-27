/**
 * MG400 Python 브리지 WebSocket 클라이언트.
 *
 * 브라우저에서 ws://IP:PORT (기본 127.0.0.1:8765) 에 직접 연결한다.
 * Python 브리지(server.py / protocol.py)의 JSON 프로토콜을 그대로 따른다.
 *
 * 명령 (브라우저 → 브리지):
 *   connect | enable | disable | home |
 *   jog{joint,delta} | moveJoints{target} | moveCartesian{target} |
 *   suction{on} | pick{marker,place?} | estop | reset | requestMarkers
 *
 * 이벤트 (브리지 → 브라우저):
 *   hello | state | telemetry | markers | pickProgress | pickResult | ack | error
 */

export interface BridgeJoints {
  j1: number; j2: number; j3: number; j4: number;
}

export interface BridgePose {
  x: number; y: number; z: number; r: number;
}

export interface BridgeState {
  enabled: boolean;
  homed: boolean;
  moving: boolean;
  estop: boolean;
  suction: boolean;
  error: string | null;
}

export interface BridgeHello {
  model: string;
  firmware?: string;
  capabilities: { cartesian: boolean; suction: boolean; camera: boolean };
}

export interface BridgeMarker extends BridgePose {
  id: number;
  size: number;
  confidence: number;
  color: string;
}

export interface BridgeFrame {
  width: number;
  height: number;
  dataUrl?: string;
}

export type PickPhase = "approach" | "descend" | "grip" | "lift" | "retreat" | "done";

export type BridgeEvent =
  | { type: "hello"; model: string; firmware?: string; capabilities: BridgeHello["capabilities"] }
  | { type: "state"; state: BridgeState }
  | { type: "telemetry"; joints: BridgeJoints; pose: BridgePose; ts: number }
  | { type: "markers"; items: BridgeMarker[]; frame?: BridgeFrame }
  | { type: "pickProgress"; phase: PickPhase; progress: number; markerId: number }
  | { type: "pickResult"; ok: boolean; markerId: number; message: string }
  | { type: "ack"; of: string }
  | { type: "error"; code: string; message: string };

export type BridgeEventHandler = (evt: BridgeEvent) => void;
export type BridgeStatusHandler = (
  status: "connecting" | "connected" | "disconnected" | "error",
  reason?: string,
) => void;

export class RobotBridge {
  private ws: WebSocket | null = null;
  private _open = false;
  private onEvent: BridgeEventHandler;
  private onStatus: BridgeStatusHandler;

  constructor(onEvent: BridgeEventHandler, onStatus: BridgeStatusHandler) {
    this.onEvent = onEvent;
    this.onStatus = onStatus;
  }

  get isOpen() { return this._open; }

  connect(ip: string, port: number): Promise<void> {
    return new Promise((resolve, reject) => {
      this.close();
      const url = `ws://${ip}:${port}`;
      this.onStatus("connecting");

      const ws = new WebSocket(url);
      this.ws = ws;

      const timeout = setTimeout(() => {
        ws.close();
        reject(new Error("연결 시간 초과 (6초)"));
      }, 6000);

      ws.onopen = () => {
        clearTimeout(timeout);
        this._open = true;
        this.onStatus("connected");
        /* connect 명령 → 브리지가 hello + state + telemetry 루프 시작 */
        this.send({ type: "connect" });
        resolve();
      };

      ws.onmessage = (ev) => {
        try {
          const msg = JSON.parse(ev.data as string) as BridgeEvent;
          this.onEvent(msg);
        } catch {
          this.onEvent({
            type: "error",
            code: "INVALID_MESSAGE",
            message: "브리지에서 해석할 수 없는 응답을 받았습니다.",
          });
        }
      };

      ws.onerror = () => {
        clearTimeout(timeout);
        this._open = false;
        this.onStatus("error", "WebSocket 오류 — IP/포트를 확인하세요");
        reject(new Error("WebSocket 연결 실패"));
      };

      ws.onclose = () => {
        clearTimeout(timeout);
        const wasOpen = this._open;
        this._open = false;
        if (wasOpen) this.onStatus("disconnected");
      };
    });
  }

  close() {
    if (this.ws) {
      this.ws.onclose = null;
      this.ws.onerror = null;
      this.ws.onmessage = null;
      this.ws.close();
      this.ws = null;
    }
    this._open = false;
  }

  private send(cmd: object): boolean {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(cmd));
      return true;
    }
    this.onEvent({
      type: "error",
      code: "NOT_CONNECTED",
      message: "MG400 브리지에 연결되어 있지 않아 명령을 전송하지 못했습니다.",
    });
    return false;
  }

  enable()  { this.send({ type: "enable" }); }
  disable() { this.send({ type: "disable" }); }
  home()    { this.send({ type: "home" }); }
  estop()   { this.send({ type: "estop" }); }
  reset()   { this.send({ type: "reset" }); }

  suction(on: boolean) { this.send({ type: "suction", on }); }

  /**
   * 관절 jog.
   * jointId = "j1+", "j2-" 등 (부호 포함) 또는 "j1", "j2" 등 (부호 없이 delta로 방향 결정)
   */
  jog(jointId: string, delta: number) {
    const joint = jointId.replace(/[+-]$/, "");
    this.send({ type: "jog", joint, delta });
  }

  moveCartesian(target: BridgePose, speed?: number) {
    this.send({
      type: "moveCartesian",
      target,
      ...(speed !== undefined ? { speed } : {}),
    });
  }

  moveJoints(target: BridgeJoints, speed?: number) {
    this.send({
      type: "moveJoints",
      target,
      ...(speed !== undefined ? { speed } : {}),
    });
  }

  requestMarkers() { return this.send({ type: "requestMarkers" }); }

  pick(marker: BridgeMarker, place?: BridgePose) {
    return this.send({
      type: "pick",
      marker,
      ...(place ? { place } : {}),
    });
  }
}
