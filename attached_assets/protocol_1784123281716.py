"""웹 ↔ 브리지 JSON 프로토콜.

이 모듈은 웹 태스크가 정의한 계약(`artifacts/math-learning/src/lib/bridge.ts`)을
파이썬 쪽에서 1:1로 구현한다. 명령(web→bridge)과 이벤트(bridge→web)의 형태가
바뀌면 양쪽을 함께 수정해야 한다.

명령(commands):
  connect | enable | disable | home |
  jog{joint,delta} | moveJoints{target,speed?} | moveCartesian{target,speed?} |
  suction{on} | pick{marker,place?} | estop | reset | requestMarkers

이벤트(events):
  hello{model,firmware?,capabilities{cartesian,suction,camera}} |
  state{state:RobotState} | telemetry{joints,pose,ts} |
  markers{items,frame?{width,height,dataUrl?}} |
  pickProgress{phase,progress,markerId} | pickResult{ok,markerId,message} |
  error{code,message} | ack{of}
"""

from __future__ import annotations

import time
from dataclasses import dataclass, field

from .kinematics import Joints, Pose

PICK_PHASES = ("approach", "descend", "grip", "lift", "retreat", "done")


@dataclass
class RobotState:
    enabled: bool = False
    homed: bool = False
    moving: bool = False
    estop: bool = False
    suction: bool = False
    error: str | None = None

    def to_dict(self) -> dict:
        return {
            "enabled": self.enabled,
            "homed": self.homed,
            "moving": self.moving,
            "estop": self.estop,
            "suction": self.suction,
            "error": self.error,
        }


@dataclass
class MarkerDetection:
    id: int
    x: float
    y: float
    z: float
    r: float
    size: float
    confidence: float
    color: str

    def to_dict(self) -> dict:
        return {
            "id": self.id,
            "x": self.x,
            "y": self.y,
            "z": self.z,
            "r": self.r,
            "size": self.size,
            "confidence": self.confidence,
            "color": self.color,
        }


# ── 이벤트 빌더 (bridge → web) ──

def hello(model: str, capabilities: dict, firmware: str | None = None) -> dict:
    e = {"type": "hello", "model": model, "capabilities": capabilities}
    if firmware is not None:
        e["firmware"] = firmware
    return e


def state_event(state: RobotState) -> dict:
    return {"type": "state", "state": state.to_dict()}


def telemetry(joints: Joints, pose: Pose) -> dict:
    return {
        "type": "telemetry",
        "joints": joints.to_dict(),
        "pose": pose.to_dict(),
        "ts": int(time.time() * 1000),
    }


def markers_event(items: list[MarkerDetection], frame: dict | None = None) -> dict:
    e = {"type": "markers", "items": [m.to_dict() for m in items]}
    if frame is not None:
        e["frame"] = frame
    return e


def pick_progress(phase: str, progress: float, marker_id: int) -> dict:
    return {"type": "pickProgress", "phase": phase, "progress": progress, "markerId": marker_id}


def pick_result(ok: bool, marker_id: int, message: str) -> dict:
    return {"type": "pickResult", "ok": ok, "markerId": marker_id, "message": message}


def error(code: str, message: str) -> dict:
    return {"type": "error", "code": code, "message": message}


def ack(of: str) -> dict:
    return {"type": "ack", "of": of}
