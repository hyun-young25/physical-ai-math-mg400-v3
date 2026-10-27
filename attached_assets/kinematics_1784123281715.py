"""MG400 4축 기구학 — 웹 디지털 트윈(`mg400.ts`)과 동일한 모델.

좌표계(로봇 베이스 프레임, mm):
  X 전방 · Y 좌측 · Z 위.
  j1 베이스 yaw · j2 후방암(수평 기준) · j3 전완(후방암 상대각) · j4 툴 yaw.

평면 2링크 모델(수직 R–Z 평면):
  r = baseOffset + L1·cos(a) + L2·cos(a+b)
  z = shoulderHeight + L1·sin(a) + L2·sin(a+b)
역기구학은 코사인 법칙으로 elbow 각을 구한다.

이 파일은 브리지가 웹 계약과 동일한 수치를 쓰도록 보장한다. 값을 바꾸면
반드시 `artifacts/math-learning/src/lib/mg400.ts` 와 함께 동기화할 것.
"""

from __future__ import annotations

import math
from dataclasses import dataclass

JOINT_KEYS = ("j1", "j2", "j3", "j4")


@dataclass
class Joints:
    j1: float = 0.0
    j2: float = 0.0
    j3: float = 0.0
    j4: float = 0.0

    def to_dict(self) -> dict:
        return {"j1": self.j1, "j2": self.j2, "j3": self.j3, "j4": self.j4}

    @staticmethod
    def from_dict(d: dict) -> "Joints":
        return Joints(
            float(d.get("j1", 0.0)),
            float(d.get("j2", 0.0)),
            float(d.get("j3", 0.0)),
            float(d.get("j4", 0.0)),
        )

    def copy(self) -> "Joints":
        return Joints(self.j1, self.j2, self.j3, self.j4)


@dataclass
class Pose:
    x: float = 0.0
    y: float = 0.0
    z: float = 0.0
    r: float = 0.0

    def to_dict(self) -> dict:
        return {"x": self.x, "y": self.y, "z": self.z, "r": self.r}

    @staticmethod
    def from_dict(d: dict) -> "Pose":
        return Pose(
            float(d.get("x", 0.0)),
            float(d.get("y", 0.0)),
            float(d.get("z", 0.0)),
            float(d.get("r", 0.0)),
        )


# ── 모델 상수 (mg400.ts MG400 와 동일) ──
L1 = 220.0
L2 = 220.0
SHOULDER_HEIGHT = 90.0
BASE_OFFSET = 30.0

# 주의: 데이터시트의 j2/j3 한계는 실제 MG400의 다른 영점을 기준으로 한 값이라
# "수평 기준 j2 / 후방암 상대 j3" 규약을 쓰는 이 모델에 그대로 넣으면 책상을
# 집을 수 없다. 본 모델 프레임에서 실제 도달 영역을 재현하도록 j2 하한을 완화하고
# j3 상한을 넓혔다. (mg400.ts MG400.limits 와 동일하게 유지할 것.)
LIMITS = {
    "j1": (-160.0, 160.0),
    "j2": (-70.0, 85.0),
    "j3": (-25.0, 110.0),
    "j4": (-355.0, 355.0),
}

REACH = (120.0, 440.0)        # 수평 도달 반경(min, max)
Z_RANGE = (-150.0, 250.0)     # 작업 높이 범위
TABLE_Z = -40.0               # 작업대 높이

HOME_JOINTS = Joints(j1=0.0, j2=20.0, j3=60.0, j4=0.0)

# ── 소프트웨어 안전 한계 (mg400.ts WORKSPACE / MAX_SPEED_PCT 와 동일) ──
WORKSPACE = {"r_min": 150.0, "r_max": 420.0, "z_min": -110.0, "z_max": 230.0}
MAX_SPEED_PCT = 60.0


def clamp(v: float, lo: float, hi: float) -> float:
    return max(lo, min(hi, v))


def clamp_joints(j: Joints) -> Joints:
    return Joints(
        clamp(j.j1, *LIMITS["j1"]),
        clamp(j.j2, *LIMITS["j2"]),
        clamp(j.j3, *LIMITS["j3"]),
        clamp(j.j4, *LIMITS["j4"]),
    )


def within_limits(j: Joints) -> bool:
    for k in JOINT_KEYS:
        lo, hi = LIMITS[k]
        if not (lo - 1e-6 <= getattr(j, k) <= hi + 1e-6):
            return False
    return True


def forward_kinematics(j: Joints) -> Pose:
    a = math.radians(j.j2)
    b = math.radians(j.j3)
    planar_r = BASE_OFFSET + L1 * math.cos(a) + L2 * math.cos(a + b)
    z = SHOULDER_HEIGHT + L1 * math.sin(a) + L2 * math.sin(a + b)
    yaw = math.radians(j.j1)
    return Pose(x=planar_r * math.cos(yaw), y=planar_r * math.sin(yaw), z=z, r=j.j4)


@dataclass
class IKResult:
    ok: bool
    joints: Joints | None = None
    reason: str | None = None
    D: float = 0.0
    cos_elbow: float = 0.0


def inverse_kinematics(target: Pose) -> IKResult:
    yaw = math.atan2(target.y, target.x)
    planar_full = math.hypot(target.x, target.y)
    planar_r = planar_full - BASE_OFFSET
    dz = target.z - SHOULDER_HEIGHT
    d = math.hypot(planar_r, dz)

    cos_elbow = (d * d - L1 * L1 - L2 * L2) / (2 * L1 * L2)

    if cos_elbow < -1 or cos_elbow > 1:
        reason = "도달 거리 초과 (팔이 닿지 않음)" if d > L1 + L2 else "내부 사각지대 (너무 가까움)"
        return IKResult(ok=False, reason=reason, D=d, cos_elbow=cos_elbow)

    elbow = math.acos(clamp(cos_elbow, -1, 1))
    for b in (elbow, -elbow):
        a = math.atan2(dz, planar_r) - math.atan2(L2 * math.sin(b), L1 + L2 * math.cos(b))
        joints = Joints(
            j1=math.degrees(yaw),
            j2=math.degrees(a),
            j3=math.degrees(b),
            j4=target.r,
        )
        if within_limits(joints):
            return IKResult(ok=True, joints=joints, D=d, cos_elbow=cos_elbow)

    return IKResult(ok=False, reason="관절 한계 초과 (자세 불가)", D=d, cos_elbow=cos_elbow)


def lerp_joints(a: Joints, b: Joints, t: float) -> Joints:
    return Joints(
        a.j1 + (b.j1 - a.j1) * t,
        a.j2 + (b.j2 - a.j2) * t,
        a.j3 + (b.j3 - a.j3) * t,
        a.j4 + (b.j4 - a.j4) * t,
    )


def within_workspace(p: Pose) -> tuple[bool, str | None]:
    """목표 자세가 소프트웨어 작업영역 내인지 검사."""
    planar_r = math.hypot(p.x, p.y)
    if planar_r > WORKSPACE["r_max"]:
        return False, f"작업영역 초과 (반경 {planar_r:.0f} > {WORKSPACE['r_max']:.0f}mm)"
    if planar_r < WORKSPACE["r_min"]:
        return False, f"작업영역 미만 (반경 {planar_r:.0f} < {WORKSPACE['r_min']:.0f}mm)"
    if p.z > WORKSPACE["z_max"]:
        return False, f"높이 초과 (Z {p.z:.0f} > {WORKSPACE['z_max']:.0f}mm)"
    if p.z < WORKSPACE["z_min"]:
        return False, f"테이블 침범 위험 (Z {p.z:.0f} < {WORKSPACE['z_min']:.0f}mm)"
    return True, None


def within_motion_envelope(p: Pose) -> tuple[bool, str | None]:
    """관절공간 모션용 안전 검사 — 수평 도달 한계 + 테이블 침범(하한)만 검사.

    상한(z_max)은 의도적으로 검사하지 않는다: 팔을 세운 홈/대기 자세는
    FK 상 z≈382mm 로 작업영역 천장(z_max=230)보다 높지만, 위로 뻗은 자세는
    충돌 위험이 없는 안전 파킹 자세이며 트윈 HOME_JOINTS 와 일치한다.
    위험 방향은 (a) 테이블로 내리꽂힘(z<z_min) (b) 과신장(r>r_max) 이므로
    실기기 관절 명령은 이 두 가지만 차단한다. (Cartesian 명령은 check_motion_safety
    로 전체 작업영역 박스를 강제한다.)
    """
    planar_r = math.hypot(p.x, p.y)
    if planar_r > WORKSPACE["r_max"]:
        return False, f"작업영역 초과 (반경 {planar_r:.0f} > {WORKSPACE['r_max']:.0f}mm)"
    if planar_r < WORKSPACE["r_min"]:
        return False, f"작업영역 미만 (반경 {planar_r:.0f} < {WORKSPACE['r_min']:.0f}mm)"
    if p.z < WORKSPACE["z_min"]:
        return False, f"테이블 침범 위험 (Z {p.z:.0f} < {WORKSPACE['z_min']:.0f}mm)"
    return True, None


def clamp_speed(speed: float | None) -> float:
    if speed is None:
        return MAX_SPEED_PCT
    return clamp(speed, 1.0, MAX_SPEED_PCT)


def check_motion_safety(target: Pose) -> tuple[bool, str | None]:
    """명령 경로 통합 안전 검사: 작업영역 + 관절 한계(IK 도달성)."""
    ok, reason = within_workspace(target)
    if not ok:
        return False, reason
    ik = inverse_kinematics(target)
    if not ik.ok:
        return False, ik.reason or "도달 불가"
    return True, None
