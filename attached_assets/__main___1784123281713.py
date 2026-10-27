"""브리지 실행 진입점.

사용:
  python -m mg400_bridge --sim                 # 드라이런 (하드웨어 없음)
  python -m mg400_bridge --config config.json  # 실기기 (Dobot TCP-IP)
  python -m mg400_bridge --modbus              # 실기기 (Modbus TCP, 포트 502)
  python -m mg400_bridge --probe-feedback      # 피드백 구조체 오프셋 점검(실기기)
  python -m mg400_bridge --probe-modbus        # Modbus 레지스터 점검(실기기)
"""

from __future__ import annotations

import argparse
import asyncio
import logging
import sys

from .config import load_config
from .controller import SimController
from .server import BridgeServer
from .vision import make_vision


def build_parser() -> argparse.ArgumentParser:
    p = argparse.ArgumentParser(prog="mg400_bridge", description="MG400 로컬 브리지")
    p.add_argument("--config", default=None, help="JSON 설정 파일 경로")
    p.add_argument("--sim", action="store_true", help="드라이런(시뮬레이션) 모드")
    p.add_argument("--modbus", action="store_true",
                   help="Modbus TCP 모드 (포트 502) — Dobot TCP-IP 대신 사용")
    p.add_argument("--host", default=None, help="WS 바인드 호스트 (config 덮어쓰기)")
    p.add_argument("--port", type=int, default=None, help="WS 포트 (config 덮어쓰기)")
    p.add_argument("--probe-feedback", action="store_true",
                   help="실기기 피드백 구조체 오프셋 점검 후 종료")
    p.add_argument("--probe-modbus", action="store_true",
                   help="Modbus TCP 레지스터 값 점검 후 종료")
    p.add_argument("-v", "--verbose", action="store_true", help="디버그 로그")
    return p


def make_controller(cfg: dict, sim: bool, modbus: bool = False):
    if sim:
        return SimController()
    if modbus:
        from .modbus import ModbusServerController  # 지연 임포트
        return ModbusServerController(cfg["robot"])
    from .dobot import MG400Controller  # 지연 임포트
    return MG400Controller(cfg["robot"])


def probe_feedback(cfg: dict) -> int:
    """실기기 피드백 포트에서 한 프레임을 읽어 파싱 결과를 출력(현장 검증용)."""
    from .dobot import MG400Controller
    ctrl = MG400Controller(cfg["robot"])
    ctrl.feedback.start()
    import time
    for _ in range(50):
        if ctrl.feedback.connected and ctrl.feedback.last_ts:
            break
        time.sleep(0.1)
    if not ctrl.feedback.connected:
        print("피드백 포트 연결 실패 — IP/포트/네트워크 확인", file=sys.stderr)
        return 1
    q, tv, mode = ctrl.feedback.snapshot()
    print(f"RobotMode = {mode}")
    print(f"q_actual(관절 실측각, 도) = {[round(x, 2) for x in q]}")
    print(f"tool_vector(TCP 포즈) = {[round(x, 2) for x in tv]}")
    print("\n값이 비현실적이면 dobot.py 의 OFF_* 오프셋을 펌웨어 문서와 대조하세요.")
    ctrl.feedback.stop()
    return 0


def probe_modbus(cfg: dict) -> int:
    """Modbus 서버가 실행 중인지 직접 확인 (localhost 접속 후 HR 0~4 덤프)."""
    import socket, struct
    host = cfg["robot"].get("modbus_server_host", "127.0.0.1")
    if host == "0.0.0.0":
        host = "127.0.0.1"
    port = int(cfg["robot"].get("modbus_port", 502))

    print(f"Modbus 서버 점검: {host}:{port}")
    print("(--modbus 로 브리지를 먼저 실행한 뒤 이 명령을 사용하세요)")

    try:
        sock = socket.create_connection((host, port), timeout=3)
    except Exception as e:
        print(f"연결 실패: {e}\n  방화벽 또는 브리지 미실행 여부 확인", file=sys.stderr)
        return 1

    # Read Holding Registers FC=0x03, addr=0, count=5 (HR 0~4)
    pdu = struct.pack(">HH", 0, 5)  # addr=0, count=5
    request = struct.pack(">HHHBB", 1, 0, 6, 1, 0x03) + pdu

    try:
        sock.sendall(request)
        resp = sock.recv(256)
    except Exception as e:
        print(f"HR 읽기 실패: {e}", file=sys.stderr)
        sock.close()
        return 1
    sock.close()

    if len(resp) < 9 or resp[7] != 0x03:
        print("응답 파싱 실패 — 서버가 Modbus TC P 응답을 반환하지 않음")
        return 1

    count = resp[8]
    regs = list(struct.unpack_from(f">{count // 2}H", resp, 9))

    def dec(u: int) -> float:
        return (u - 65536) / 10.0 if u > 32767 else u / 10.0

    cmd_names = {0: "대기", 1: "MovJ", 2: "Home", 3: "Enable", 4: "Disable",
                 5: "SuctionOn", 6: "SuctionOff"}
    print(f"\n현재 레지스터 상태 (HR 0~4):")
    print(f"  HR 0 (명령코드) = {regs[0]}  ({cmd_names.get(regs[0], '?')})")
    if len(regs) >= 5:
        print(f"  HR 1 (X 목표)  = {dec(regs[1]):.1f} mm")
        print(f"  HR 2 (Y 목표)  = {dec(regs[2]):.1f} mm")
        print(f"  HR 3 (Z 목표)  = {dec(regs[3]):.1f} mm")
        print(f"  HR 4 (R 목표)  = {dec(regs[4]):.1f} °")
    print("\n서버 정상 응답 확인 완료.")
    return 0


async def _serve(server: BridgeServer) -> None:
    try:
        await server.serve_forever()
    finally:
        server.close()


def main(argv: list[str] | None = None) -> int:
    args = build_parser().parse_args(argv)
    logging.basicConfig(
        level=logging.DEBUG if args.verbose else logging.INFO,
        format="%(asctime)s %(levelname)s %(name)s: %(message)s",
    )

    cfg = load_config(args.config)
    if args.host:
        cfg["ws"]["host"] = args.host
    if args.port:
        cfg["ws"]["port"] = args.port

    if args.probe_feedback:
        return probe_feedback(cfg)

    if args.probe_modbus:
        return probe_modbus(cfg)

    controller = make_controller(cfg, args.sim, getattr(args, "modbus", False))
    vision = make_vision(cfg, args.sim)
    server = BridgeServer(controller, vision, cfg)

    if args.sim:
        mode = "드라이런(시뮬레이션)"
    elif getattr(args, "modbus", False):
        mode = (
            "실기기 — Modbus TCP (단방향 명령 전송)\n"
            "  Coil 0  : 트리거  HR 0: 명령코드  HR 1~4: X/Y/Z/R\n"
            "  명령코드: 1=MovJ 2=Home 3=Enable 4=Disable 5=SuctionOn 6=SuctionOff"
        )
    else:
        mode = "실기기 — Dobot TCP-IP"
    logging.getLogger("mg400").info("모드: %s", mode)

    try:
        asyncio.run(_serve(server))
    except KeyboardInterrupt:
        logging.getLogger("mg400").info("종료 요청 수신")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
