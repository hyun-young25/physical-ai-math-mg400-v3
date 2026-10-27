"""비전 모듈 — 오버헤드 카메라 + ArUco 마커 검출 → 로봇 베이스 좌표 변환.

두 구현:
  - `SimVision`     : 카메라 없이 합성 마커 (웹 makeMockMarkers 미러)
  - `ArucoVision`   : 실제 카메라 + OpenCV ArUco (cv2/numpy 는 지연 임포트)

좌표 변환:
  마커 → solvePnP(카메라 내부파라미터, 마커 실측크기) → 카메라 프레임 3D 좌표
       → 핸드-아이 4x4 변환(T_cam2base) → 로봇 베이스 좌표.
  T_cam2base 미보정 시, 테이블 평면 호모그래피 근사로 폴백한다(README 참고).

cv2/numpy 는 드라이런에 불필요하므로 ArucoVision 안에서만 임포트한다.
"""

from __future__ import annotations

import math
import random
from abc import ABC, abstractmethod

from .kinematics import TABLE_Z
from .protocol import MarkerDetection

MOCK_COLORS = ["#e0564f", "#2f8f5b", "#3a6ea5", "#d99a2b", "#7c5cbf"]


class Vision(ABC):
    @abstractmethod
    def start(self) -> None: ...

    @abstractmethod
    def stop(self) -> None: ...

    @abstractmethod
    def detect(self) -> tuple[list[MarkerDetection], dict | None]:
        """(markers, frame_meta) 반환. frame_meta 는 {width,height,dataUrl?} 또는 None."""

    @property
    def available(self) -> bool:
        return True


class SimVision(Vision):
    """합성 마커 — 색상 팔레트는 웹과 동일, 위치는 트윈 기구학상 집기 가능 영역."""

    def __init__(self, colors: list[str] | None = None, table_z: float = TABLE_Z):
        self.colors = colors or MOCK_COLORS
        self.table_z = table_z
        # 합성 마커는 트윈 기구학으로 "실제 집을 수 있는" 책상 평면 위치에 둔다.
        # 보정된 j2/j3 한계 덕에 책상 높이(z = table_z + 25)에서 hover→grip→drop
        # 전체 시퀀스가 성립한다(반경 ≈ 320~415mm). 웹 makeMockMarkers 와 동일 좌표.
        z = table_z + 25.0
        self._specs = [
            {"id": 0, "x": 300.0, "y": -110.0, "z": z, "r": 0.0},
            {"id": 1, "x": 340.0, "y": 70.0, "z": z, "r": 25.0},
            {"id": 2, "x": 280.0, "y": 160.0, "z": z, "r": -15.0},
            {"id": 3, "x": 380.0, "y": -30.0, "z": z, "r": 40.0},
        ]

    def start(self) -> None:
        pass

    def stop(self) -> None:
        pass

    def detect(self) -> tuple[list[MarkerDetection], dict | None]:
        markers = [
            MarkerDetection(
                id=s["id"],
                x=s["x"],
                y=s["y"],
                z=s["z"],
                r=s["r"],
                size=40.0,
                confidence=round(0.9 + random.random() * 0.09, 3),
                color=self.colors[i % len(self.colors)],
            )
            for i, s in enumerate(self._specs)
        ]
        return markers, None


class ArucoVision(Vision):
    """실제 카메라 + OpenCV ArUco 검출."""

    def __init__(self, camera_cfg: dict, intrinsics: dict, hand_eye: dict,
                 table_z: float, colors: list[str] | None = None):
        self.cfg = camera_cfg
        self.intrinsics = intrinsics
        self.hand_eye = hand_eye
        self.table_z = table_z
        self.colors = colors or MOCK_COLORS
        self._cap = None
        self._cv2 = None
        self._np = None
        self._detector = None
        self._cam_mtx = None
        self._dist = None
        self._T = None
        self._available = True

    @property
    def available(self) -> bool:
        return self._available

    def start(self) -> None:
        try:
            import cv2  # 지연 임포트: 드라이런엔 불필요
            import numpy as np
        except ImportError as e:
            self._available = False
            raise RuntimeError(
                "OpenCV/numpy 가 필요합니다. `pip install -r requirements.txt`"
            ) from e
        self._cv2 = cv2
        self._np = np

        self._cap = cv2.VideoCapture(int(self.cfg.get("index", 0)))
        self._cap.set(cv2.CAP_PROP_FRAME_WIDTH, int(self.cfg.get("width", 1280)))
        self._cap.set(cv2.CAP_PROP_FRAME_HEIGHT, int(self.cfg.get("height", 720)))
        self._cap.set(cv2.CAP_PROP_FPS, int(self.cfg.get("fps", 30)))
        if not self._cap.isOpened():
            self._available = False
            raise RuntimeError(f"카메라 {self.cfg.get('index', 0)} 를 열 수 없습니다")

        dict_name = self.cfg.get("aruco_dict", "DICT_4X4_50")
        aruco = cv2.aruco
        aruco_dict = aruco.getPredefinedDictionary(getattr(aruco, dict_name))
        params = aruco.DetectorParameters()
        self._detector = aruco.ArucoDetector(aruco_dict, params)

        cm = self.intrinsics.get("camera_matrix")
        dc = self.intrinsics.get("dist_coeffs")
        if cm is not None:
            self._cam_mtx = np.array(cm, dtype=np.float64)
        if dc is not None:
            self._dist = np.array(dc, dtype=np.float64)
        T = self.hand_eye.get("T_cam2base")
        if T is not None:
            self._T = np.array(T, dtype=np.float64)

    def stop(self) -> None:
        if self._cap is not None:
            self._cap.release()
            self._cap = None

    def _detect_raw(self):
        """프레임 캡처 + ArUco 검출 + solvePnP.

        반환: (raw, frame_meta) — raw 는 [(id, rvec, tvec)] (카메라 프레임 원시 포즈),
        frame_meta 는 {width,height[,dataUrl]}. 좌표 변환은 호출측에서 수행한다.
        detect()(베이스 좌표)와 detect_camera_frame()(보정용 카메라 좌표)이 공유.
        """
        cv2, np = self._cv2, self._np
        if self._cap is None:
            return [], None
        ok, frame = self._cap.read()
        if not ok:
            return [], None

        h, w = frame.shape[:2]
        corners, ids, _ = self._detector.detectMarkers(frame)
        raw: list[tuple] = []
        if ids is not None and self._cam_mtx is not None:
            marker_len = float(self.cfg.get("marker_length_mm", 40.0))
            dist = self._dist if self._dist is not None else np.zeros((1, 5))
            # 마커 평면 4점(마커 중심 기준, mm)
            half = marker_len / 2.0
            obj = np.array([
                [-half, half, 0], [half, half, 0],
                [half, -half, 0], [-half, -half, 0],
            ], dtype=np.float64)
            for i, mid in enumerate(ids.flatten()):
                c = corners[i].reshape(4, 2).astype(np.float64)
                ok_pnp, rvec, tvec = cv2.solvePnP(obj, c, self._cam_mtx, dist)
                if not ok_pnp:
                    continue
                raw.append((int(mid), rvec, tvec))

        frame_meta = {"width": int(w), "height": int(h)}
        if self.cfg.get("stream_frame", False):
            q = int(self.cfg.get("frame_jpeg_quality", 60))
            small = cv2.resize(frame, (min(w, 640), int(h * min(w, 640) / w)))
            ok_enc, buf = cv2.imencode(".jpg", small, [cv2.IMWRITE_JPEG_QUALITY, q])
            if ok_enc:
                import base64
                b64 = base64.b64encode(buf.tobytes()).decode("ascii")
                frame_meta["dataUrl"] = f"data:image/jpeg;base64,{b64}"
        return raw, frame_meta

    def detect(self) -> tuple[list[MarkerDetection], dict | None]:
        raw, frame_meta = self._detect_raw()
        cube = float(self.cfg.get("cube_size_mm", 40.0))
        markers: list[MarkerDetection] = []
        for mid, rvec, tvec in raw:
            base_xyz, yaw = self._to_base(rvec, tvec)
            markers.append(MarkerDetection(
                id=mid,
                x=round(float(base_xyz[0]), 1),
                y=round(float(base_xyz[1]), 1),
                z=round(float(base_xyz[2]), 1),
                r=round(float(yaw), 1),
                size=cube,
                confidence=0.95,
                color=self.colors[mid % len(self.colors)],
            ))
        return markers, frame_meta

    def detect_camera_frame(self) -> list[MarkerDetection]:
        """보정용 — _to_base 변환 없이 카메라 프레임의 마커 3D(깊이 포함)를 반환.

        핸드-아이 보정(hand_eye.py)은 카메라가 본 실제 3D 점(tvec, Z 포함)이
        필요하다. detect()의 미보정 폴백은 Z를 테이블 높이로 고정하므로 보정
        샘플이 동일 평면(degenerate)이 되어 강체정합이 무너진다. 따라서 보정은
        이 메서드로 원시 카메라 좌표를 사용해야 한다.
        """
        raw, _ = self._detect_raw()
        cv2 = self._cv2
        cube = float(self.cfg.get("cube_size_mm", 40.0))
        out: list[MarkerDetection] = []
        for mid, rvec, tvec in raw:
            cam_pt = tvec.reshape(3)
            R, _ = cv2.Rodrigues(rvec)
            yaw_cam = math.degrees(math.atan2(R[1, 0], R[0, 0]))
            out.append(MarkerDetection(
                id=mid,
                x=float(cam_pt[0]),
                y=float(cam_pt[1]),
                z=float(cam_pt[2]),
                r=round(yaw_cam, 1),
                size=cube,
                confidence=0.95,
                color=self.colors[mid % len(self.colors)],
            ))
        return out

    def _to_base(self, rvec, tvec):
        """카메라 프레임 포즈 → 로봇 베이스 좌표 + yaw(도)."""
        cv2, np = self._cv2, self._np
        cam_pt = tvec.reshape(3)
        R, _ = cv2.Rodrigues(rvec)
        # 마커 z축의 카메라 평면 투영으로 yaw 추정
        yaw_cam = math.degrees(math.atan2(R[1, 0], R[0, 0]))

        if self._T is not None:
            p = np.array([cam_pt[0], cam_pt[1], cam_pt[2], 1.0])
            base = self._T @ p
            base_xyz = base[:3]
            R_be = self._T[:3, :3] @ R
            yaw = math.degrees(math.atan2(R_be[1, 0], R_be[0, 0]))
            return base_xyz, yaw
        # 핸드-아이 미보정 폴백: 카메라 좌표를 그대로 쓰되 테이블 높이 고정.
        # (정확하지 않음 — README 의 hand_eye.py 보정 필요)
        return np.array([cam_pt[0], cam_pt[1], self.table_z + 25.0]), yaw_cam


def make_vision(cfg: dict, sim: bool) -> Vision:
    camera_cfg = cfg.get("camera", {})
    if sim or not camera_cfg.get("enabled", True):
        return SimVision(colors=cfg.get("marker_colors"), table_z=cfg.get("table_z", TABLE_Z))
    return ArucoVision(
        camera_cfg=camera_cfg,
        intrinsics=cfg["intrinsics"],
        hand_eye=cfg["hand_eye"],
        table_z=cfg.get("table_z", TABLE_Z),
        colors=cfg.get("marker_colors"),
    )
