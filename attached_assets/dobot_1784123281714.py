"""실제 MG400 컨트롤러 — Dobot TCP-IP 제어 프로토콜 (V4).

포트 구성:
  - Dashboard  29999 : 설정/상태 명령 (EnableRobot, DisableRobot, ClearError, DO ...)
  - Move       30003 : 모션 명령 (MovJ, MovL, JointMovJ ...)
  - Feedback   30004 : 8ms 주기 1440바이트 실시간 피드백(관절각, TCP 포즈, 로봇모드)

⚠️ 학교 현장 확인 필요:
  - 피드백 구조체의 필드 오프셋은 Dobot 공식 "TCP-IP Control Mode" 문서(V4) 기준이다.
    펌웨어 버전에 따라 다를 수 있으니 첫 브링업 때 `--probe-feedback` 로 검증할 것.
  - 실기기 보고 관절각/좌표 부호·원점이 트윈과 다르면 config 의 joint_offsets/joint_signs
    로 보정한다. (디지털 트윈과 실제 팔의 자세가 일치하도록)
  - 흡착 그리퍼는 디지털 출력(DO) 핀에 연결되어 있다고 가정한다(config.robot.suction_do_index).
"""

from __future__ import annotations

import logging
import math
import socket
import struct
import threading
import time

from . import kinematics as kin
from .controller import Controller, SafetyError
from .kinematics import Joints, Pose
from .protocol import RobotState

logger = logging.getLogger("mg400.dobot")

# Dobot V4 실시간 피드백 구조체 내 필드 바이트 오프셋 (1440 바이트).
# 출처: Dobot TCP-IP Protocol (V4) RealTime feedback layout.
FB_LEN = 1440
OFF_ROBOT_MODE = 24       # uint64
OFF_Q_ACTUAL = 432        # double[6] 관절 실측각(도)
OFF_TOOL_VECTOR = 624     # double[6] TCP 포즈 x,y,z,rx,ry,rz (mm / 도)

ROBOT_MODE_ENABLE = 5     # 활성(idle) 이상이면 enable 된 것으로 간주
ROBOT_MODE_RUNNING = 7    # 프로그램/모션 실행 중
ROBOT_MODE_ERROR = 9

# 피드백 무결성 한계.
FEEDBACK_STALE_S = 0.5    # 최신 프레임이 이보다 오래되면 끊김으로 간주(8ms 주기)
JOINT_PLAUSIBLE_DEG = 400.0  # 어떤 관절 한계(j4=±355)보다 넓음 → 초과 시 프레임 정렬 깨짐


class DobotConnError(Exception):
    pass


class _CmdChannel:
    """Dashboard/Move 공통 명령 채널 (요청→응답 텍스트)."""

    def __init__(self, host: str, port: int, timeout: float = 5.0):
        self.host = host
        self.port = port
        self.timeout = timeout
        self.sock: socket.socket | None = None
        self._lock = threading.Lock()

    def connect(self) -> None:
        s = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
        s.settimeout(self.timeout)
        s.connect((self.host, self.port))
        self.sock = s

    def close(self) -> None:
        if self.sock:
            try:
                self.sock.close()
            finally:
                self.sock = None

    def send(self, command: str) -> str:
        if not self.sock:
            raise DobotConnError(f"{self.host}:{self.port} 미연결")
        with self._lock:
            self.sock.sendall((command + "\n").encode("ascii"))
            try:
                data = self.sock.recv(1024)
            except socket.timeout:
                return ""
        return data.decode("ascii", errors="replace").strip()


class _FeedbackReader(threading.Thread):
    """피드백 포트를 폴링해 최신 관절각/포즈/로봇모드를 유지하는 백그라운드 스레드."""

    def __init__(self, host: str, port: int):
        super().__init__(daemon=True)
        self.host = host
        self.port = port
        self.sock: socket.socket | None = None
        self._stop = threading.Event()
        self._lock = threading.Lock()
        self.q_actual: list[float] = [0.0] * 6
        self.tool_vector: list[float] = [0.0] * 6
        self.robot_mode: int = 0
        self.connected = False
        self.last_ts = 0.0

    def run(self) -> None:
        try:
            s = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
            s.settimeout(2.0)
            s.connect((self.host, self.port))
            self.sock = s
            self.connected = True
        except OSError:
            self.connected = False
            return

        buf = b""
        while not self._stop.is_set():
            try:
                chunk = self.sock.recv(4096)
            except socket.timeout:
                continue
            except OSError:
                break
            if not chunk:
                break
            buf += chunk
            while len(buf) >= FB_LEN:
                frame = buf[:FB_LEN]
                buf = buf[FB_LEN:]
                self._parse(frame)
        self.connected = False

    def _parse(self, frame: bytes) -> None:
        try:
            mode = struct.unpack_from("<Q", frame, OFF_ROBOT_MODE)[0]
            q = list(struct.unpack_from("<6d", frame, OFF_Q_ACTUAL))
            tv = list(struct.unpack_from("<6d", frame, OFF_TOOL_VECTOR))
        except struct.error:
            return
        # 정렬 깨짐/잘못된 오프셋 감지: 관절각이 물리적으로 불가능하면 폐기.
        # (학교 브링업 때 --probe-feedback 로 오프셋 검증 전 안전장치)
        if any(not math.isfinite(v) or abs(v) > JOINT_PLAUSIBLE_DEG for v in q[:4]):
            logger.warning("피드백 프레임 폐기 — 비정상 관절각 %s (오프셋 확인 필요)", q[:4])
            return
        with self._lock:
            self.robot_mode = mode
            self.q_actual = q
            self.tool_vector = tv
            self.last_ts = time.time()

    def snapshot(self) -> tuple[list[float], list[float], int]:
        with self._lock:
            return list(self.q_actual), list(self.tool_vector), self.robot_mode

    def stop(self) -> None:
        self._stop.set()
        if self.sock:
            try:
                self.sock.close()
            except OSError:
                pass


class MG400Controller(Controller):
    capabilities = {"cartesian": True, "suction": True, "camera": True}

    def __init__(self, robot_cfg: dict):
        self.cfg = robot_cfg
        self.ip = robot_cfg["ip"]
        self.dashboard = _CmdChannel(self.ip, robot_cfg["dashboard_port"])
        self.move = _CmdChannel(self.ip, robot_cfg["move_port"])
        self.feedback = _FeedbackReader(self.ip, robot_cfg["feedback_port"])
        self.offsets = robot_cfg.get("joint_offsets", {})
        self.signs = robot_cfg.get("joint_signs", {})
        self.suction_do = int(robot_cfg.get("suction_do_index", 1))
        self.speed_pct = float(robot_cfg.get("speed_pct", 40.0))
        self.settle_seconds = float(robot_cfg.get("settle_seconds", 0.9))
        self._state = RobotState()
        self._suction_cache = False

    def model(self) -> str:
        return "Dobot MG400"

    def firmware(self) -> str | None:
        if self.dashboard.sock:
            resp = self.dashboard.send("RobotMode()")
            return resp or None
        return None

    def connect(self) -> None:
        self.dashboard.connect()
        self.move.connect()
        self.feedback.start()
        time.sleep(0.2)
        self._apply_speed(self.speed_pct)

    def disconnect(self) -> None:
        self.feedback.stop()
        self.dashboard.close()
        self.move.close()

    def _apply_speed(self, pct: float) -> None:
        pct = kin.clamp_speed(pct)
        self.dashboard.send(f"SpeedFactor({int(pct)})")

    def enable(self) -> None:
        self.dashboard.send("ClearError()")
        self.dashboard.send("EnableRobot()")
        self._state.enabled = True
        self._state.error = None

    def disable(self) -> None:
        self.dashboard.send("DisableRobot()")
        self._state.enabled = False

    def home(self) -> None:
        self._guard_enabled()
        h = self._guard_joints(kin.HOME_JOINTS)
        self.move.send(f"JointMovJ({self._tx(h.j1,'j1')},{self._tx(h.j2,'j2')},"
                       f"{self._tx(h.j3,'j3')},{self._tx(h.j4,'j4')})")
        self._state.homed = True

    def jog(self, joint: str, delta: float) -> None:
        self._guard_enabled()
        cur = self.read_joints()
        nxt = cur.copy()
        setattr(nxt, joint, getattr(cur, joint) + delta)
        self.move_joints(nxt)

    def move_joints(self, target: Joints, speed: float | None = None) -> None:
        self._guard_enabled()
        t = self._guard_joints(target)
        if speed is not None:
            self._apply_speed(speed)
        self.move.send(f"JointMovJ({self._tx(t.j1,'j1')},{self._tx(t.j2,'j2')},"
                       f"{self._tx(t.j3,'j3')},{self._tx(t.j4,'j4')})")

    def move_cartesian(self, target: Pose, speed: float | None = None) -> None:
        self._guard_enabled()
        self._guard_cartesian(target)
        if speed is not None:
            self._apply_speed(speed)
        self.move.send(f"MovL({target.x:.3f},{target.y:.3f},{target.z:.3f},{target.r:.3f})")

    def suction(self, on: bool) -> None:
        self.dashboard.send(f"DO({self.suction_do},{1 if on else 0})")
        self._suction_cache = on
        self._state.suction = on

    def estop(self) -> None:
        # 즉시 정지: 큐 비우고 정지. 안전을 위해 비상정지는 즉시 처리.
        self.dashboard.send("ResetRobot()")
        self.dashboard.send("EmergencyStop()")
        self._state.estop = True
        self._state.moving = False

    def reset(self) -> None:
        self.dashboard.send("ClearError()")
        self.dashboard.send("ResetRobot()")
        self._state.estop = False
        self._state.error = None

    def sync(self, timeout: float | None = None) -> None:
        """현재 모션 큐가 비워질 때까지 대기 (MG400 Sync)."""
        self.move.send("Sync()")

    # ── 실기기 ↔ 트윈 좌표 보정 ──
    def _tx(self, val: float, key: str) -> float:
        """트윈 각 → 실기기 각 (부호/오프셋 적용)."""
        sign = float(self.signs.get(key, 1.0))
        off = float(self.offsets.get(key, 0.0))
        return val * sign + off

    def _rx(self, val: float, key: str) -> float:
        """실기기 각 → 트윈 각 (역보정)."""
        sign = float(self.signs.get(key, 1.0))
        off = float(self.offsets.get(key, 0.0))
        return (val - off) / sign if sign != 0 else val

    def _guard_enabled(self) -> None:
        if self._state.estop:
            raise SafetyError("비상정지 상태 — reset 필요")
        if not self._state.enabled:
            raise SafetyError("로봇이 비활성화됨")

    def read_joints(self) -> Joints:
        q, _, _ = self.feedback.snapshot()
        return Joints(
            self._rx(q[0], "j1"),
            self._rx(q[1], "j2"),
            self._rx(q[2], "j3"),
            self._rx(q[3], "j4"),
        )

    def read_pose(self) -> Pose:
        _, tv, _ = self.feedback.snapshot()
        # tool_vector: x,y,z,rx,ry,rz — 4축 MG400 은 rz(=r) 만 의미 있음
        return Pose(x=tv[0], y=tv[1], z=tv[2], r=tv[5])

    def state(self) -> RobotState:
        _, _, mode = self.feedback.snapshot()
        if mode == ROBOT_MODE_ERROR:
            self._state.error = self._state.error or "로봇 오류 (RobotMode=9)"
        # 피드백 끊김/지연 감지 — 모션 중 실시간 좌표가 멈추면 안전상 알린다.
        if self._state.enabled:
            age = time.time() - self.feedback.last_ts
            if not self.feedback.connected:
                self._state.error = self._state.error or "피드백 연결 끊김 (포트 30004)"
            elif self.feedback.last_ts and age > FEEDBACK_STALE_S:
                self._state.error = self._state.error or f"피드백 지연 {age*1000:.0f}ms"
        self._state.moving = mode == ROBOT_MODE_RUNNING
        self._state.suction = self._suction_cache
        return self._state
