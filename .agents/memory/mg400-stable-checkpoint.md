---
name: MG400 stable checkpoint
description: 사용자가 승인한 안정 상태 커밋 — 문제 발생 시 이 커밋으로 되돌아갈 것
---

## 안정 커밋

**Commit:** `fcb050a4d6ff81b7108ca9033a5cd989c5bc36d1`
**날짜:** 2026-07-03
**메시지:** Remove visual interference from duplicate wrist connector

## 이 상태의 특징

- j42Ref clone (l42G 클론, j42Ref에 부착): l32G 오른쪽 구멍 커버 ✓
- _pc_frozen: l3_2R.position 첫 프레임에 j32Ref local로 고정
- _l31_tgtR_frozen: l31G hR 앵커 고정
- j41Ref clone: **없음** (추가하면 link4_2 위치가 틀어짐 — 절대 추가 금지)
- l42MeshRef.visible = false (원본 숨기고 클론으로 대체)

## 주의사항

- j41Ref에 무언가 추가하면 link4_2(j42Ref clone)가 어긋남 → 이 현상 발생 시 이 커밋으로 rollback
- 워크플로 재시작 필요: HMR 캐시로 인해 클론 상태가 꼬일 수 있음
- j42Ref.position은 절대 수정 금지 (mg400-j42ref-hard-lock.md 참고)

## Rollback 방법

Replit 좌측 상단 체크포인트에서 `fcb050a4` 커밋을 찾아 롤백 요청.
또는 에이전트에게 "fcb050a4 커밋으로 돌아가줘"라고 지시.
