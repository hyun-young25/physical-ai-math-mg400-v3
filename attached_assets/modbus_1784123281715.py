"""MG400 Modbus TCP 서버 컨트롤러.

MG400 의 Lua 스크립트가 이 브리지 PC 에 Modbus TCP 클라이언트로 접속한다.
브리지는 Modbus TCP 서버 역할을 하며 Holding Register / Coil 을 제공한다.

흐름 (단방향: 웹→로봇):
  1. MG400 Lua: ModbusCreate("브리지_IP", 502, 1)  ← 브리지 서버에 연결
  2. MG400 Lua: while true → GetCoils(0,1) 폴링
  3. 웹에서 명령 → 브리지: HR 0 에 명령 코드, HR 1~4 에 좌표 씀 + Coil 0 = 1
  4. MG400 Lua: Coil 0 == 1 감지 → HR 0 읽어 명령 분기 (MovJ/Home/Enable/…)
  5. MG400 Lua: SetCoils(0, 1, {0})  ← 완료 신호
  6. 브리지: Coil 0 == 0 확인 → moving = False

레지스터 맵 (웹→로봇 단방향):
  Coil 0         : 실행 트리거  (브리지→1 세팅, MG400 Lua→0 초기화)
  HR 0  (U16)    : 명령 코드 (0=대기, 1=MovJ, 2=Home, 3=Enable, 4=Disable, 5=SuctionOn, 6=SuctionOff)
  HR 1  (U16)    : X 목표 (×10, 음수는 65536 보수)  단위: 0.1 mm
  HR 2  (U16)    : Y 목표 (×10, 음수는 65536 보수)  단위: 0.1 mm
  HR 3  (U16)    : Z 목표 (×10, 음수는 65536 보수)  단위: 0.1 mm
  HR 4  (U16)    : R 목표 (×10, 음수는 65536 보수)  단위: 0.1 °

인코딩:
  encode(v) = round(v * 10) & 0xFFFF   (음수는 2의 보수 U16)
  decode(u) = (u - 65536)/10 if u > 32767 else u/10

⚠️ 학교 현장 주의:
  - 브리지 PC 방화벽에서 TCP 502 포트를 허용해야 합니다.
  - MG400 Lua 스크립트의 ModbusCreate 첫 번째 인자를 브리지 PC 의 LAN IP 로 변경하세요.
"""

from __future__ import annotations

import logging
import socket
import struct
import threading
import time
from typing import Optional

from .controller import Controller, SafetyError
from . import kinematics as kin
from .kinematics import Joints, Pose
from .protocol import RobotState

logger = logging.getLogger("mg400.modbus")

MODBUS_SERVER_PORT = 502
UNIT_ID = 1

# ── 명령 코드 ──────────────────────────────────────────────────
CMD_IDLE       = 0
CMD_MOVJ       = 1
CMD_HOME       = 2
CMD_ENABLE     = 3
CMD_DISABLE    = 4
CMD_SUCTION_ON = 5
CMD_SUCTION_OFF= 6

# ── 레지스터 주소 ──────────────────────────────────────────────
COIL_TRIGGER = 0      # Coil 0: 실행 트리거 (1=실행, 0=대기/완료)

HR_CMD = 0            # HR 0: 명령 코드
HR_X   = 1            # HR 1: X 목표 (×10, U16)
HR_Y   = 2            # HR 2: Y 목표 (×10, U16)
HR_Z   = 3            # HR 3: Z 목표 (×10, U16)
HR_R   = 4            # HR 4: R 목표 (×10, U16)

NUM_COILS = 32
NUM_REGS  = 32        # HR 0~4 사용, Dobot 측 여유 읽기까지 안전하게 처리

POLL_PERIOD = 0.05    # 50ms 폴링 (Lua 의 Sleep(50)에 맞춤)


def encode_coord(val: float) -> int:
    """float 좌표 → U16 Modbus 값 (×10, 음수는 2의 보수)."""
    iv = round(val * 10)
    return iv & 0xFFFF


def decode_coord(u16: int) -> float:
    """U16 Modbus 값 → float 좌표."""
    if u16 > 32767:
        return (u16 - 65536) / 10.0
    return u16 / 10.0


# ── 공유 Modbus 데이터 모델 ───────────────────────────────────
class _ModbusDataModel:
    """Coil / Holding Register 을 스레드 안전하게 보관."""

    def __init__(self):
        self._lock = threading.Lock()
        self._coils = [False] * NUM_COILS
        self._regs  = [0] * NUM_REGS

    # Coil
    def read_coils(self, addr: int, count: int) -> list[bool]:
        """요청 개수만큼 반환한다. 범위 밖 주소는 False로 패딩한다.

        일부 Modbus 클라이언트는 실제 사용량보다 넉넉하게 읽을 수 있으므로
        슬라이스 길이가 count보다 짧아져 응답 패킹이 깨지지 않게 한다.
        """
        with self._lock:
            return [
                self._coils[addr + i] if 0 <= addr + i < len(self._coils) else False
                for i in range(count)
            ]

    def write_coil(self, addr: int, value: bool) -> None:
        with self._lock:
            self._coils[addr] = value

    def write_coils(self, addr: int, values: list[bool]) -> None:
        with self._lock:
            for i, v in enumerate(values):
                if addr + i < NUM_COILS:
                    self._coils[addr + i] = v

    # Holding Register
    def read_regs(self, addr: int, count: int) -> list[int]:
        """요청 개수만큼 반환한다. 범위 밖 주소는 0으로 패딩한다.

        Dobot Lua/Modbus 클라이언트가 HR 0~9처럼 10개를 읽어도
        내부 레지스터가 부족해서 `pack expected ... got ...` 오류가 나지 않도록 한다.
        """
        with self._lock:
            return [
                self._regs[addr + i] if 0 <= addr + i < len(self._regs) else 0
                for i in range(count)
            ]

    def write_reg(self, addr: int, value: int) -> None:
        with self._lock:
            self._regs[addr] = value & 0xFFFF

    def write_regs(self, addr: int, values: list[int]) -> None:
        with self._lock:
            for i, v in enumerate(values):
                if addr + i < NUM_REGS:
                    self._regs[addr + i] = v & 0xFFFF


# ── 최소 Modbus TCP 서버 ──────────────────────────────────────
class _ModbusTcpServer(threading.Thread):
    """표준 라이브러리만으로 구현한 Modbus TCP 서버.

    지원 Function Code:
      FC 01 (0x01): Read Coils
      FC 05 (0x05): Write Single Coil
      FC 15 (0x0F): Write Multiple Coils
      FC 03 (0x03): Read Holding Registers
      FC 06 (0x06): Write Single Register
      FC 16 (0x10): Write Multiple Registers
    """

    def __init__(self, host: str, port: int, model: _ModbusDataModel):
        super().__init__(daemon=True)
        self.host = host
        self.port = port
        self.model = model
        self._stop = threading.Event()
        self._server: Optional[socket.socket] = None
        self.client_count = 0

    def run(self) -> None:
        srv = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
        srv.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
        srv.settimeout(1.0)
        srv.bind((self.host, self.port))
        srv.listen(5)
        self._server = srv
        logger.info("Modbus TCP 서버 시작: %s:%d (MG400 Lua 연결 대기중)", self.host, self.port)
        while not self._stop.is_set():
            try:
                conn, addr = srv.accept()
            except socket.timeout:
                continue
            except OSError:
                break
            self.client_count += 1
            logger.info("MG400 연결됨: %s (총 %d)", addr, self.client_count)
            t = threading.Thread(
                target=self._handle_client, args=(conn, addr), daemon=True)
            t.start()
        srv.close()

    def _handle_client(self, conn: socket.socket, addr) -> None:
        conn.settimeout(5.0)
        buf = b""
        try:
            while not self._stop.is_set():
                try:
                    chunk = conn.recv(256)
                except socket.timeout:
                    continue
                if not chunk:
                    break
                buf += chunk
                while len(buf) >= 8:
                    # MBAP: tid(2) + proto(2) + length(2) + unit(1) = 6 bytes
                    if len(buf) < 6:
                        break
                    tid, proto, length = struct.unpack_from(">HHH", buf)
                    total = 6 + length
                    if len(buf) < total:
                        break
                    frame = buf[:total]
                    buf = buf[total:]
                    response = self._process(frame)
                    if response:
                        conn.sendall(response)
        except (OSError, ConnectionResetError):
            pass
        finally:
            conn.close()
            self.client_count -= 1
            logger.info("MG400 연결 해제: %s", addr)

    def _process(self, frame: bytes) -> Optional[bytes]:
        tid    = struct.unpack_from(">H", frame, 0)[0]
        unit   = frame[6]
        fc     = frame[7]

        def mbap(pdu: bytes) -> bytes:
            return struct.pack(">HHHB", tid, 0, len(pdu) + 1, unit) + pdu

        def exc(code: int) -> bytes:
            return mbap(bytes([fc | 0x80, code]))

        try:
            if fc == 0x01:   # Read Coils
                addr, count = struct.unpack_from(">HH", frame, 8)
                coils = self.model.read_coils(addr, count)
                byte_count = (count + 7) // 8
                data = bytearray(byte_count)
                for i, v in enumerate(coils):
                    if v:
                        data[i // 8] |= (1 << (i % 8))
                return mbap(bytes([fc, byte_count]) + bytes(data))

            elif fc == 0x05:  # Write Single Coil
                addr, value = struct.unpack_from(">HH", frame, 8)
                self.model.write_coil(addr, value == 0xFF00)
                return mbap(struct.pack(">BHH", fc, addr, value))

            elif fc == 0x0F:  # Write Multiple Coils
                addr, count = struct.unpack_from(">HH", frame, 8)
                byte_count = frame[12]
                raw = frame[13:13 + byte_count]
                values = [bool(raw[i // 8] & (1 << (i % 8))) for i in range(count)]
                self.model.write_coils(addr, values)
                return mbap(struct.pack(">BHH", fc, addr, count))

            elif fc == 0x03:  # Read Holding Registers
                addr, count = struct.unpack_from(">HH", frame, 8)
                regs = self.model.read_regs(addr, count)
                data = struct.pack(f">{count}H", *regs)
                return mbap(bytes([fc, count * 2]) + data)

            elif fc == 0x06:  # Write Single Register
                addr, value = struct.unpack_from(">HH", frame, 8)
                self.model.write_reg(addr, value)
                return mbap(struct.pack(">BHH", fc, addr, value))

            elif fc == 0x10:  # Write Multiple Registers
                addr, count = struct.unpack_from(">HH", frame, 8)
                byte_count = frame[12]
                values = list(struct.unpack_from(f">{count}H", frame, 13))
                self.model.write_regs(addr, values)
                return mbap(struct.pack(">BHH", fc, addr, count))

            else:
                logger.warning("지원하지 않는 FC: 0x%02x", fc)
                return exc(0x01)  # Illegal Function

        except Exception as e:
            logger.error("Modbus 처리 오류: %s", e)
            return exc(0x04)  # Server Device Failure

    def stop(self) -> None:
        self._stop.set()
        if self._server:
            try:
                self._server.close()
            except OSError:
                pass


# ── ModbusServerController ────────────────────────────────────
class ModbusServerController(Controller):
    """Modbus TCP 서버로 동작하는 MG400 컨트롤러.

    MG400 Lua 스크립트가 이 서버에 접속해 Coil/HR 을 읽고 쓴다.

    단방향 통신 (웹→로봇):
      - 웹에서 명령(MovJ/Home/Enable/Disable/Suction)이 오면
        HR 0 에 명령 코드, HR 1~4 에 목표 좌표를 쓴 뒤 Coil 0 을 1로 세팅.
      - Lua 가 Coil 0 을 감지하고 HR 0 명령 코드에 따라 분기 실행.
      - 실행 완료 후 Lua 가 Coil 0 을 0으로 초기화 → 브리지가 완료 인식.
      - 로봇 상태(관절각/TCP)는 IK 추정으로 유지 (피드백 없음).
    """

    capabilities = {"cartesian": True, "suction": True, "camera": False}

    def __init__(self, robot_cfg: dict):
        self.cfg = robot_cfg
        host = robot_cfg.get("modbus_server_host", "0.0.0.0")
        port = int(robot_cfg.get("modbus_port", MODBUS_SERVER_PORT))
        self._model = _ModbusDataModel()
        self._server = _ModbusTcpServer(host, port, self._model)
        self.offsets = robot_cfg.get("joint_offsets", {})
        self.signs   = robot_cfg.get("joint_signs", {})
        self._state  = RobotState()
        # 추정 현재 자세 (명령 완료 후 목표 → 현재로 설정)
        self._est_joints = kin.HOME_JOINTS.copy()
        self._target_pose: Optional[Pose] = None
        self._poll_thread: Optional[threading.Thread] = None
        self._stop_poll = threading.Event()

    def model(self) -> str:
        return "Dobot MG400 (Modbus TCP 서버 모드)"

    def firmware(self) -> str | None:
        return None

    # ── 연결 ──────────────────────────────────────────────────
    def connect(self) -> None:
        self._server.start()
        self._stop_poll.clear()
        self._poll_thread = threading.Thread(
            target=self._poll_coil_loop, daemon=True)
        self._poll_thread.start()
        logger.info(
            "Modbus TCP 서버 모드 시작 — MG400 Lua 연결을 기다립니다.\n"
            "  레지스터 맵 (웹→로봇 단방향):\n"
            "    Coil 0   : 트리거 (1=실행, 0=완료)\n"
            "    HR 0     : 명령 코드 (1=MovJ, 2=Home, 3=Enable, 4=Disable, 5=SuctionOn, 6=SuctionOff)\n"
            "    HR 1~4   : X, Y, Z, R 목표 (×10, U16 2의보수, mm/°)"
        )

    def disconnect(self) -> None:
        self._stop_poll.set()
        self._server.stop()

    # ── 명령 헬퍼 ─────────────────────────────────────────────
    def _guard_enabled(self) -> None:
        if self._state.estop:
            raise SafetyError("비상정지 상태 — reset 필요")
        if not self._state.enabled:
            raise SafetyError("로봇이 비활성화됨 — enable 먼저")

    def _send_command(self, cmd: int, pose: Optional[Pose] = None) -> None:
        """명령 코드와 선택적 좌표를 HR 에 쓰고 Coil 0 을 트리거."""
        regs = [cmd, 0, 0, 0, 0]
        if pose is not None:
            regs[1] = encode_coord(pose.x)
            regs[2] = encode_coord(pose.y)
            regs[3] = encode_coord(pose.z)
            regs[4] = encode_coord(pose.r)
        self._model.write_regs(HR_CMD, regs)
        self._model.write_coil(COIL_TRIGGER, True)
        self._state.moving = (cmd == CMD_MOVJ or cmd == CMD_HOME)
        cmd_names = {
            CMD_MOVJ: "MovJ", CMD_HOME: "Home", CMD_ENABLE: "Enable",
            CMD_DISABLE: "Disable", CMD_SUCTION_ON: "SuctionOn", CMD_SUCTION_OFF: "SuctionOff",
        }
        if pose is not None:
            logger.info(
                "Modbus 명령: %s → X=%.1f Y=%.1f Z=%.1f R=%.1f",
                cmd_names.get(cmd, str(cmd)), pose.x, pose.y, pose.z, pose.r,
            )
        else:
            logger.info("Modbus 명령: %s", cmd_names.get(cmd, str(cmd)))

    # ── Coil 폴링 (완료 감지) ─────────────────────────────────
    def _poll_coil_loop(self) -> None:
        """Coil 0 이 0으로 돌아오면(Lua 완료) 이동 완료로 처리."""
        while not self._stop_poll.is_set():
            if self._state.moving:
                coils = self._model.read_coils(COIL_TRIGGER, 1)
                if not coils[0]:
                    self._state.moving = False
                    if self._target_pose is not None:
                        ik = kin.inverse_kinematics(self._target_pose)
                        if ik.ok and ik.joints is not None:
                            self._est_joints = ik.joints
                        self._target_pose = None
                    logger.info("MG400 명령 완료 (Lua Coil→0 확인)")
            time.sleep(POLL_PERIOD)

    # ── Controller 인터페이스 ─────────────────────────────────
    def enable(self) -> None:
        self._state.enabled = True
        self._state.error = None
        self._send_command(CMD_ENABLE)

    def disable(self) -> None:
        self._state.enabled = False
        self._send_command(CMD_DISABLE)

    def home(self) -> None:
        self._guard_enabled()
        self._target_pose = kin.forward_kinematics(kin.HOME_JOINTS)
        self._send_command(CMD_HOME)
        self._est_joints = kin.HOME_JOINTS.copy()
        self._state.homed = True

    def jog(self, joint: str, delta: float) -> None:
        self._guard_enabled()
        cur = self._est_joints
        nxt = Joints(cur.j1, cur.j2, cur.j3, cur.j4)
        setattr(nxt, joint, getattr(cur, joint) + delta)
        self.move_joints(nxt)

    def move_joints(self, target: Joints, speed: float | None = None) -> None:
        self._guard_enabled()
        t = self._guard_joints(target)
        pose = kin.forward_kinematics(t)
        self._target_pose = pose
        self._send_command(CMD_MOVJ, pose)
        self._est_joints = t

    def move_cartesian(self, target: Pose, speed: float | None = None) -> None:
        self._guard_enabled()
        self._guard_cartesian(target)
        self._target_pose = target
        self._send_command(CMD_MOVJ, target)

    def suction(self, on: bool) -> None:
        self._state.suction = on
        cmd = CMD_SUCTION_ON if on else CMD_SUCTION_OFF
        self._send_command(cmd)

    def estop(self) -> None:
        self._model.write_coil(COIL_TRIGGER, False)
        self._model.write_reg(HR_CMD, CMD_IDLE)
        self._state.estop = True
        self._state.moving = False
        logger.warning("E-Stop: Coil 0 강제 해제")

    def reset(self) -> None:
        self._model.write_coil(COIL_TRIGGER, False)
        self._model.write_reg(HR_CMD, CMD_IDLE)
        self._state.estop = False
        self._state.error = None

    def read_joints(self) -> Joints:
        return Joints(
            self._est_joints.j1,
            self._est_joints.j2,
            self._est_joints.j3,
            self._est_joints.j4,
        )

    def read_pose(self) -> Pose:
        return kin.forward_kinematics(self._est_joints)

    def state(self) -> RobotState:
        if self._server.client_count == 0 and self._state.enabled:
            self._state.error = "MG400 Lua 미연결 — Lua 스크립트를 실행하세요"
        elif self._server.client_count > 0:
            self._state.error = None
        return self._state
