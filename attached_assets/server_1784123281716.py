"""WebSocket 서버 — 웹 ↔ 컨트롤러/비전 연결.

토폴로지: 브라우저 ──ws://localhost:8765──▶ 이 서버 ──▶ Controller / Vision.

연결당 동작:
  1) 클라이언트가 {type:"connect"} 전송 → hello + state + markers 발행, 텔레메트리 루프 시작.
  2) 명령 수신 → ack 발행 → 컨트롤러/비전 호출 → 상태 변화 시 state 발행.
  3) pick 은 비동기 시퀀스(approach→…→done)로 pickProgress/pickResult 발행.

프로토콜은 `protocol.py` (= 웹 `bridge.ts`) 와 정확히 일치한다.
"""

from __future__ import annotations

import asyncio
import json
import logging

import websockets

from . import kinematics as kin
from . import protocol as P
from .controller import Controller, SafetyError
from .kinematics import Joints, Pose
from .vision import Vision

log = logging.getLogger("mg400.server")

TELEMETRY_HZ = 16.0       # 텔레메트리 발행 주기 (~60ms, 웹과 동일)
PICK_STEP_SECONDS = 0.85  # pick 단계 간 대기 (웹 MockBridge 와 동일 체감)


class Session:
    """단일 브라우저 연결 세션."""

    def __init__(self, ws, controller: Controller, vision: Vision, cfg: dict):
        self.ws = ws
        self.ctrl = controller
        self.vision = vision
        self.cfg = cfg
        self._last_state: dict | None = None
        self._telemetry_task: asyncio.Task | None = None
        self._marker_task: asyncio.Task | None = None
        self._pick_task: asyncio.Task | None = None
        self._closed = False

    async def send(self, event: dict) -> None:
        try:
            await self.ws.send(json.dumps(event, ensure_ascii=False))
        except websockets.ConnectionClosed:
            self._closed = True

    async def emit_state(self, force: bool = False) -> None:
        snap = self.ctrl.state().to_dict()
        if force or snap != self._last_state:
            self._last_state = dict(snap)
            await self.send(P.state_event(self.ctrl.state()))

    async def run(self) -> None:
        try:
            async for raw in self.ws:
                await self._handle_raw(raw)
        except websockets.ConnectionClosed:
            pass
        finally:
            await self._teardown()

    async def _handle_raw(self, raw) -> None:
        try:
            cmd = json.loads(raw)
        except (ValueError, TypeError):
            return
        ctype = cmd.get("type")
        if not ctype:
            return
        await self.send(P.ack(ctype))
        try:
            await self._dispatch(ctype, cmd)
        except SafetyError as e:
            await self.send(P.error("SAFETY", str(e)))
        except Exception as e:  # 컨트롤러/네트워크 예외를 프로토콜 오류로 변환
            log.exception("명령 처리 실패: %s", ctype)
            await self.send(P.error("BRIDGE_ERROR", str(e)))

    async def _dispatch(self, ctype: str, cmd: dict) -> None:
        if ctype == "connect":
            await self._on_connect()
        elif ctype == "enable":
            self.ctrl.enable()
            await self.emit_state(force=True)
        elif ctype == "disable":
            self.ctrl.disable()
            await self.emit_state(force=True)
        elif ctype == "home":
            self.ctrl.home()
            await self.emit_state(force=True)
        elif ctype == "jog":
            self.ctrl.jog(cmd["joint"], float(cmd["delta"]))
        elif ctype == "moveJoints":
            self.ctrl.move_joints(Joints.from_dict(cmd["target"]), cmd.get("speed"))
        elif ctype == "moveCartesian":
            self.ctrl.move_cartesian(Pose.from_dict(cmd["target"]), cmd.get("speed"))
        elif ctype == "suction":
            self.ctrl.suction(bool(cmd["on"]))
            await self.emit_state(force=True)
        elif ctype == "pick":
            await self._start_pick(cmd)
        elif ctype == "estop":
            self.ctrl.estop()
            self._cancel_pick()
            await self.emit_state(force=True)
        elif ctype == "reset":
            self.ctrl.reset()
            await self.emit_state(force=True)
        elif ctype == "requestMarkers":
            await self._emit_markers()

    async def _on_connect(self) -> None:
        await self.send(P.hello(
            model=self.ctrl.model(),
            capabilities=self.ctrl.capabilities,
            firmware=self.ctrl.firmware(),
        ))
        await self.emit_state(force=True)
        await self._emit_markers()
        if self._telemetry_task is None:
            self._telemetry_task = asyncio.create_task(self._telemetry_loop())
        if self._marker_task is None:
            self._marker_task = asyncio.create_task(self._marker_loop())

    async def _telemetry_loop(self) -> None:
        dt = 1.0 / TELEMETRY_HZ
        try:
            while not self._closed:
                self.ctrl.tick(dt)
                await self.send(P.telemetry(self.ctrl.read_joints(), self.ctrl.read_pose()))
                await self.emit_state()
                await asyncio.sleep(dt)
        except websockets.ConnectionClosed:
            pass

    async def _marker_loop(self) -> None:
        hz = float(self.cfg.get("camera", {}).get("detect_hz", 5.0)) or 5.0
        period = 1.0 / hz
        try:
            while not self._closed:
                await asyncio.sleep(period)
                await self._emit_markers()
        except websockets.ConnectionClosed:
            pass

    async def _emit_markers(self) -> None:
        try:
            items, frame = await asyncio.to_thread(self.vision.detect)
        except Exception as e:
            log.warning("마커 검출 실패: %s", e)
            return
        await self.send(P.markers_event(items, frame))

    # ── pick 시퀀스 ──
    async def _start_pick(self, cmd: dict) -> None:
        self._cancel_pick()
        marker = cmd["marker"]
        place = cmd.get("place")
        self._pick_task = asyncio.create_task(self._run_pick(marker, place))

    def _cancel_pick(self) -> None:
        if self._pick_task and not self._pick_task.done():
            self._pick_task.cancel()
        self._pick_task = None

    async def _run_pick(self, marker: dict, place: dict | None) -> None:
        st = self.ctrl.state()
        mid = int(marker["id"])
        if st.estop or not st.enabled:
            await self.send(P.pick_result(
                False, mid, "비상정지 상태" if st.estop else "로봇이 비활성화됨"))
            return

        mx, my, mz, mr = marker["x"], marker["y"], marker["z"], marker.get("r", 0.0)
        hover = Pose(mx, my, mz + 80, mr)
        grip = Pose(mx, my, mz, mr)
        if place:
            drop = Pose(place["x"], place["y"], place["z"] + 80, place.get("r", mr))
        else:
            drop = Pose(mx - 40, my, mz + 60, mr)

        ok, reason = kin.check_motion_safety(hover)
        if not ok:
            await self.send(P.pick_result(False, mid, reason or "도달 불가"))
            return

        steps = [
            ("approach", hover, None),
            ("descend", grip, None),
            ("grip", grip, True),
            ("lift", hover, None),
            ("retreat", drop, None),
        ]
        try:
            total = len(steps) + 1
            for idx, (phase, pose, suction_on) in enumerate(steps):
                if self.ctrl.state().estop:
                    return
                self.ctrl.move_cartesian(pose, self.cfg.get("robot", {}).get("speed_pct"))
                if suction_on:
                    self.ctrl.suction(True)
                    await self.emit_state(force=True)
                await self.send(P.pick_progress(phase, (idx + 1) / total, mid))
                await asyncio.sleep(PICK_STEP_SECONDS)

            if self.ctrl.state().estop:
                return
            await self.send(P.pick_progress("done", 1.0, mid))
            await self.send(P.pick_result(True, mid, f"마커 #{mid} 집기 완료"))
        except asyncio.CancelledError:
            raise
        except SafetyError as e:
            await self.send(P.pick_result(False, mid, str(e)))

    async def _teardown(self) -> None:
        self._closed = True
        self._cancel_pick()
        for t in (self._telemetry_task, self._marker_task):
            if t and not t.done():
                t.cancel()


class BridgeServer:
    def __init__(self, controller: Controller, vision: Vision, cfg: dict):
        self.ctrl = controller
        self.vision = vision
        self.cfg = cfg

    async def _handler(self, ws) -> None:
        log.info("브라우저 연결됨: %s", getattr(ws, "remote_address", "?"))
        session = Session(ws, self.ctrl, self.vision, self.cfg)
        await session.run()
        log.info("브라우저 연결 종료")

    async def serve_forever(self) -> None:
        host = self.cfg["ws"]["host"]
        port = int(self.cfg["ws"]["port"])
        self.ctrl.connect()
        self.vision.start()
        log.info("MG400 브리지 시작 — ws://%s:%d", host, port)
        async with websockets.serve(self._handler, host, port):
            await asyncio.Future()  # 영구 실행

    def close(self) -> None:
        try:
            self.vision.stop()
        finally:
            self.ctrl.disconnect()
