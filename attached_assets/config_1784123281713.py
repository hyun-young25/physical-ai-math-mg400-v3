"""브리지 설정 로딩.

기본값 + 사용자 JSON 파일 + 보정(calibration) 결과를 병합한다.
보정 스크립트(`calibrate/`)는 이 파일의 `camera` / `hand_eye` 항목을 갱신한다.
"""

from __future__ import annotations

import copy
import json
import os
from typing import Any

DEFAULT_CONFIG: dict[str, Any] = {
    "ws": {
        "host": "127.0.0.1",
        "port": 8765,
    },
    "robot": {
        # 학교 LAN의 MG400 IP. 드라이런(dry-run)에서는 무시된다.
        "ip": "192.168.1.6",
        "dashboard_port": 29999,
        "move_port": 30003,
        "feedback_port": 30004,
        # 실기기 보고각 → 트윈 관절각 보정 오프셋(도). 학교에서 미세조정.
        "joint_offsets": {"j1": 0.0, "j2": 0.0, "j3": 0.0, "j4": 0.0},
        "joint_signs": {"j1": 1.0, "j2": 1.0, "j3": 1.0, "j4": 1.0},
        # 흡착 그리퍼 디지털 출력 인덱스
        "suction_do_index": 1,
        # 기본 이동 속도(%) — 소프트 상한(MAX_SPEED_PCT) 내에서 클램프
        "speed_pct": 40.0,
        # 동작 정착(settle) 대기 시간(초)
        "settle_seconds": 0.9,
    },
    "camera": {
        "enabled": True,
        "index": 0,
        "width": 1280,
        "height": 720,
        "fps": 30,
        # ArUco 사전 및 마커 한 변 실측 길이(mm)
        "aruco_dict": "DICT_4X4_50",
        "marker_length_mm": 40.0,
        # 마커가 부착된 큐브의 한 변 길이(mm)
        "cube_size_mm": 40.0,
        # 카메라 프레임을 브라우저로 함께 보낼지(JPEG dataURL). 대역폭 주의.
        "stream_frame": True,
        "frame_jpeg_quality": 60,
        "detect_hz": 5.0,
    },
    # 카메라 내부 파라미터(intrinsic). camera_intrinsic.py 가 채운다.
    "intrinsics": {
        "camera_matrix": None,   # 3x3
        "dist_coeffs": None,     # 1xN
    },
    # 핸드-아이 보정: 카메라 → 로봇 베이스 4x4 동차변환. hand_eye.py 가 채운다.
    "hand_eye": {
        "T_cam2base": None,      # 4x4. None 이면 평면 근사 사용.
    },
    # 테이블 평면 높이(mm, 베이스 프레임). 큐브 윗면 = table_z + cube_size.
    "table_z": -40.0,
    # 마커 표시용 색상 팔레트(웹과 동일 톤)
    "marker_colors": ["#e0564f", "#2f8f5b", "#3a6ea5", "#d99a2b", "#7c5cbf"],
}


def _deep_merge(base: dict, override: dict) -> dict:
    out = copy.deepcopy(base)
    for k, v in override.items():
        if isinstance(v, dict) and isinstance(out.get(k), dict):
            out[k] = _deep_merge(out[k], v)
        else:
            out[k] = v
    return out


def load_config(path: str | None) -> dict:
    cfg = copy.deepcopy(DEFAULT_CONFIG)
    if path and os.path.exists(path):
        with open(path, "r", encoding="utf-8") as f:
            user = json.load(f)
        cfg = _deep_merge(cfg, user)
    return cfg


def save_config(path: str, cfg: dict) -> None:
    with open(path, "w", encoding="utf-8") as f:
        json.dump(cfg, f, ensure_ascii=False, indent=2)
