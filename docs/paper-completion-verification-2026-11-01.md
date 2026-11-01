# 종이 좌표 학습 검증 및 시연 — 2026-11-01

학생의 관계식·풀이·수정 이유를 유지하면서 개인정보를 제거하고, 앞서 표시한 피드백과 수정 전후 시도를 다음 분석에 연결하는 흐름을 검증했다. 로봇 모델의 형상·관절·기구학과 실행 제어 코드는 변경하지 않았다.

검증 대상 앱 소스는 `a6d0ad2e47700a2559e667ea6c95039ec6891d1f`다. 이 문서와 함께 추가한 것은 재현 가능한 UI 검증, 녹화·편집 도구와 시연 파일이다. 공개 서비스 재배포는 수행하지 않았다.

## 검증 결과

| 항목 | 결과 | 범위 |
| --- | --- | --- |
| Node 자동 테스트 | 646개 통과, 실패 0 | 프런트엔드 학습 로직과 API 라이브러리·라우트 테스트 |
| TypeScript 검사 | 통과 | 공유 패키지, API, 프런트엔드, 스크립트 |
| 프런트엔드 production build | 통과 | 기존 번들 크기 경고는 남음 |
| 재시도 회귀 검증 | 통과 | advanced1 및 advanced2, DT 실행 기준 |
| 푸른 고스트 검증 | 통과, 정상 종료 | 각각 23/20개 중간 자세, 원래 로봇 고정·원래 색 유지, 전체 반투명 푸른 재질·윤곽, 모드 종료 복원 |
| 실제 학생 화면 전체 흐름 | 통과 | 빌드한 앱의 WebGL 및 SVG 화면, 두 시도, 두 모의 분석 요청 |
| 개인정보 제거 | 통과 | 학번 등 식별정보 제거, 관계식·수치·수정 설명 유지 |
| 이전 피드백 연결 | 통과 | 첫 시도에서 실제 표시·저장된 피드백이 다음 분석 자료에 포함 |
| 첫 시도 보존 | 통과 | 새 시도 수정·재실행 뒤 부모 시도의 직렬화 결과 불변 |
| CSV·초기화 | 통과 | 재시도별 행 분리, 26열, 초기화·화면 선택 회귀 검사 |

고스트 전용 검증과 최종 녹화 시나리오는 모두 정상 종료했다. MP4는 1920×1080, 25 fps, H.264, 157.96초이며 전체 디코딩 오류가 없고 한글 자막·각 장면·수정 전후 비교를 시각적으로 확인했다. 원본 영상 내부의 앱 화면은 그대로 유지했다.

완성 영상과 다운로드 페이지는 `artifacts/robot-control/public/demos/`에 있다. 개발 미리보기의 `/demos/index.html`에서 재생·다운로드할 수 있다. 이 정적 페이지 추가는 기존 학습 화면이나 로봇 실행 흐름을 바꾸지 않는다.

## 시연에서 확인하는 학습 순환

1. 학생이 `X=180+10x`, `Y=-60+10y`와 설명을 입력한다.
2. P3 `(11, 15)`의 X를 처음에는 `310 mm`로 예측한다. 목표 X는 `290 mm`다.
3. 전체 푸른 고스트가 학생의 계획을 DT로 실행한다. 원래 로봇은 고정되어 있다.
4. 목표 `290 mm`와 첫 예측·DT 실행 `310 mm`의 차이 `20 mm`를 확인한다.
5. 앱이 실제 생성하는 **기본 체험 규칙 피드백**을 읽는다.
6. 학생이 `180+10×11=290`이라는 수정 이유를 기록한다.
7. 새 시도에서 P3의 X를 `290 mm`로 바꾸고 다시 DT로 실행한다.
8. 같은 목표점에서 수정 전후 실행을 비교한다. 새 시도의 진단은 `match`다.
9. 이전에 표시된 피드백과 수정 이유가 다음 분석 자료에 연결되는 것을 확인한다.

## 검증 환경과 한계

앱 화면·학습 로직·로봇 자산은 실제 production build를 사용했다. 학생 진입과 저장 확인은 시연용 응답으로 대체했으며, 실제 학생 DB의 저장 성공을 입증하는 검사가 아니다. 네트워크 로봇 연결은 차단했다. 실제 MG400을 움직이거나 유료 GPT를 호출하지 않았다.

`verify-paper-completion.cjs`는 요청의 개인정보 제거·이력 전달을 검증하기 위해 분석 응답을 모의로 제공한다. 최종 시연을 녹화하는 `record-paper-demo.cjs`는 앱의 실제 `trial` 규칙 응답을 사용하며, 외부 AI 요청이 0건인지 단언한다. 둘을 실제 GPT 검증으로 해석해서는 안 된다.

## 재현

저장소의 pnpm 10 환경에서 의존성을 설치하고 프런트엔드 production build를 먼저 만든다. Playwright Chromium, 동영상 녹화용 FFmpeg 및 한글 글꼴을 준비한다. 커스텀 Chromium 경로는 `PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH`, 선택적인 글꼴 CSS는 `PAPER_FONT_CSS`로 지정한다.

```sh
node --test artifacts/robot-control/src/*.test.cjs artifacts/api-server/src/lib/*.test.cjs artifacts/api-server/src/routes/*.test.cjs
pnpm run typecheck
pnpm --filter @workspace/robot-control build
node scripts/verify-paper-retry.cjs
node scripts/verify-paper-robot-preview.cjs
node scripts/verify-paper-completion.cjs
node scripts/record-paper-demo.cjs
```

전체 화면 검증은 `PAPER_STUDENT_FLOW_EVIDENCE_DIR`, 녹화는 `PAPER_DEMO_DIR`로 새 출력 폴더를 지정할 수 있다. `PAPER_RENDERING=svg`는 WebGL 없는 환경의 별도 UI 검증 옵션이다. 녹화 도중에는 동일 페이지에서 스크린샷 작업을 병행하지 않는다.

녹화의 `recording.json`이 성공 단언과 장면 시각을 보존한다. `package-paper-demo.py`는 이 결과가 성공한 경우에만 실제 WebM 장면을 잘라 한글 자막을 붙인 H.264 MP4를 만든다. 앱 화면 내부 픽셀이나 움직임을 합성하지 않는다.

```sh
python3 scripts/package-paper-demo.py <녹화폴더> <출력.mp4> --font <NotoSansCJKkr-Regular.otf>
```

사용한 한글 자막 글꼴은 [Noto Sans CJK KR](https://github.com/notofonts/noto-cjk)이며 SIL Open Font License를 따른다. 글꼴 파일 자체는 이 저장소에 추가하지 않았다.
