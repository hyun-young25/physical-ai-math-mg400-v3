"""로봇 컨트롤러 추상화.

`Controller` 는 서버가 의존하는 공통 인터페이스다. 두 구현이 있다:
  - `SimController`        : 하드웨어 없는 드라이런(웹 MockBridge 와 동일 동작)
  - `MG400Controller`     : 실제 MG400 (Dobot TCP-IP V4) — `dobot.py`

서버는 두 구현을 동일하게 다루므로, 학교에서 `--sim` 플래그만 떼면 실기기로 전환된다.
모든 동작 명령은 컨트롤러 단계에서 소프트웨어 작업영역/관절/속도 한계를 강제한다.
"""

from __future__ import annotations

from abc import ABC, abstractmethod

from . import kinematics as kin
from .kinematics import Joints, Pose
from .protocol import RobotState


class SafetyError(Exception):
    """명령이 소프트웨어 안전 한계를 위반함."""


class Controller(ABC):
    capabilities: dict = {"cartesian": True, "suction": True, "camera": True}

    @abstractmethod
    def model(self) -> str: ...

    def firmware(self) -> str | None:
        return None

    @abstractmethod
    def connect(self) -> None: ...

    @abstractmethod
    def disconnect(self) -> None: ...

    @abstractmethod
    def enable(self) -> None: ...

    @abstractmethod
    def disable(self) -> None: ...

    @abstractmethod
    def home(self) -> None: ...

    @abstractmethod
    def jog(self, joint: str, delta: float) -> None: ...

    @abstractmethod
    def move_joints(self, target: Joints, speed: float | None = None) -> None: ...

    @abstractmethod
    def move_cartesian(self, target: Pose, speed: float | None = None) -> None: ...

    @abstractmethod
    def suction(self, on: bool) -> None: ...

    @abstractmethod
    def estop(self) -> None: ...

    @abstractmethod
    def reset(self) -> None: ...

    @abstractmethod
    def read_joints(self) -> Joints: ...

    @abstractmethod
    def read_pose(self) -> Pose: ...

    @abstractmethod
    def state(self) -> RobotState: ...

    def tick(self, dt: float) -> None:
        """시뮬레이터 시간 진행. 실기기는 피드백 스레드가 갱신하므로 no-op."""

    # 공통 안전 검사 (서브클래스에서 호출)
    def _guard_cartesian(self, target: Pose) -> None:
        ok, reason = kin.check_motion_safety(target)
        if not ok:
            raise SafetyError(reason or "도달 불가")

    def _guard_joints(self, target: Joints) -> Joints:
        """관절 명령 안전 검사: 관절 한계로 클램프 후, 결과 자세가 모션
        엔벨로프(과신장/테이블 침범) 안인지 확인하고 클램프된 목표를 반환."""
        clamped = kin.clamp_joints(target)
        ok, reason = kin.within_motion_envelope(kin.forward_kinematics(clamped))
        if not ok:
            raise SafetyError(reason or "작업영역 초과")
        return clamped


class SimController(Controller):
    """네트워크/하드웨어 없이 텔레메트리·상태를 시뮬레이션 (MockBridge 미러)."""

    def __init__(self) -> None:
        self._current = kin.HOME_JOINTS.copy()
        self._target = kin.HOME_JOINTS.copy()
        self._state = RobotState()

    def model(self) -> str:
        return "MG400 (시뮬레이터)"

    def firmware(self) -> str | None:
        return "sim-1.0"

    def connect(self) -> None:
        pass

    def disconnect(self) -> None:
        pass

    def enable(self) -> None:
        self._state.enabled = True
        self._state.error = None

    def disable(self) -> None:
        self._state.enabled = False

    def home(self) -> None:
        self._set_target(kin.HOME_JOINTS.copy())
        self._state.homed = True

    def jog(self, joint: str, delta: float) -> None:
        nxt = self._target.copy()
        setattr(nxt, joint, getattr(self._target, joint) + delta)
        self._set_target(nxt)

    def move_joints(self, target: Joints, speed: float | None = None) -> None:
        self._set_target(target)

    def move_cartesian(self, target: Pose, speed: float | None = None) -> None:
        self._guard_cartesian(target)
        ik = kin.inverse_kinematics(target)
        if not ik.ok or ik.joints is None:
            raise SafetyError(ik.reason or "도달 불가")
        self._set_target(ik.joints)

    def suction(self, on: bool) -> None:
        self._state.suction = on

    def estop(self) -> None:
        self._state.estop = True
        self._state.moving = False
        self._target = self._current.copy()

    def reset(self) -> None:
        self._state.estop = False
        self._state.error = None

    def _set_target(self, j: Joints) -> None:
        if self._state.estop or not self._state.enabled:
            return
        self._target = kin.clamp_joints(j)

    def tick(self, dt: float) -> None:
        self._current = kin.lerp_joints(self._current, self._target, 0.18)
        moving = (
            abs(self._current.j1 - self._target.j1)
            + abs(self._current.j2 - self._target.j2)
            + abs(self._current.j3 - self._target.j3)
            + abs(self._current.j4 - self._target.j4)
        ) > 0.15
        self._state.moving = moving

    def read_joints(self) -> Joints:
        return self._current.copy()

    def read_pose(self) -> Pose:
        return kin.forward_kinematics(self._current)

    def state(self) -> RobotState:
        return self._state
