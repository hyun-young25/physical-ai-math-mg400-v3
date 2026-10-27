---
name: OIDC 소유자 신원 검증
description: 프로토콜 검증과 JWT 서명 검증을 구별하는 openid-client 기본 동작 및 소유자 신뢰 기준.
---

openid-client v6의 기본 토큰 교환은 직접 HTTPS 통신을 신뢰하므로 JWT의 JWS 서명 검증을 자동으로 활성화하지 않는다. 소유자 권한에 사용하는 토큰은 명시적인 non-repudiation 검증으로 서명까지 확인해야 한다.

**Why:** 이 프로젝트는 검증된 단일 소유자 신원만 전체 학습 로그를 읽을 수 있다는 요구가 있다. 인증 안내 템플릿의 “서명 검증” 설명만 믿고 기본 설정으로 바꾸면 이 추가 검증이 사라질 수 있다.

**How to apply:** OIDC 설정이나 토큰 교환·갱신을 리팩터링할 때 PKCE·state·nonce·issuer·audience·expiry뿐 아니라 명시적인 JWS 검증도 유지한다. 갱신된 subject가 기존 세션 subject와 달라지면 차단한다.
