import { useEffect, useRef, useState } from "react";

/** Short spoken guide per step (browser TTS, ko-KR) — each step explains only itself. */
export const PAPER_V6_SCENE_SCRIPTS: string[][] = [
  [
    "이번 활동은 종이 좌표계와 로봇 좌표계 사이의 변환식을 세우고, 로봇 동작으로 검증하는 것입니다.",
    "첫 단계에서는 로봇으로 종이의 기준점 O, X, Y 세 점을 측정합니다.",
    "O는 종이 좌표계의 원점, X는 종이 x축 위 10 센티미터 지점, Y는 종이 y축 위 10 센티미터 지점입니다.",
    "버튼을 눌러 세 점의 로봇 좌표를 차례로 측정하십시오.",
  ],
  [
    "측정한 O와 X로 종이의 원점과 회전각 세타를 구합니다.",
    "세타는 O에서 X까지의 변화량, 델타 X와 델타 Y에 탄젠트 역함수를 적용해 계산합니다.",
    "구한 원점과 세타를 회전 변환식에 넣어, 종이 위 목표점 P1부터 P4까지의 로봇 좌표를 예측하십시오.",
    "저장한 예측은 고정되며, 이후 실행 결과와 비교하는 기준이 됩니다.",
  ],
  [
    "저장한 예측 좌표로 로봇이 실제로 이동해 점을 찍습니다.",
    "실행 버튼을 누르고, 로봇이 찍는 위치가 예측과 일치하는지 관찰하십시오.",
    "MG400이 연결되어 있으면 같은 버튼으로 실제 로봇이 동작합니다.",
  ],
  [
    "예측 좌표와 로봇이 실제로 찍은 위치를 비교합니다.",
    "차이가 허용범위 플러스 마이너스 2 밀리미터를 넘으면, AI는 원인을 직접 알려 주지 않고 질문을 제시합니다.",
    "질문을 읽고, 차이가 생긴 원인에 대한 가설을 한 줄로 작성하십시오.",
  ],
  [
    "가설과 추가 확인 결과를 근거로 모델을 수정할지 유지할지 결정합니다.",
    "결정한 모델은 모델을 만들 때 쓰지 않은 독립점 V에서 다시 검증합니다.",
    "V에서도 오차가 허용범위 안에 들어오면, 모델이 다른 위치에서도 성립한다는 근거가 됩니다.",
  ],
];

/** Kept for compatibility: the first step's guide. */
export const PAPER_V6_INTRO_SCRIPT = PAPER_V6_SCENE_SCRIPTS[0];

/** Spoken form of a millimetre value: "마이너스 60.0". */
export const spokenMm = (value: number) =>
  `${value < 0 ? "마이너스 " : ""}${Math.abs(value).toFixed(1)}`;

/** What each reference point means on the sheet, for the card and the voice. */
export const PAPER_V6_REFERENCE_MEANING = {
  O: { paper: "종이 (0, 0) cm", role: "종이 좌표계의 원점" },
  X: { paper: "종이 (10, 0) cm", role: "종이 x축 위 10 cm 지점 · 종이 x축의 방향" },
  Y: { paper: "종이 (0, 10) cm", role: "종이 y축 위 10 cm 지점 · y축 방향과 축척 확인" },
} as const;

/** One spoken line announcing a measured reference point and what it means. */
export function referenceAnnouncement(
  point: "O" | "X" | "Y",
  pose: { x: number; y: number },
  origin?: { x: number; y: number },
): string {
  const head = `${point} 측정 완료. 로봇 좌표 X ${spokenMm(pose.x)}, Y ${spokenMm(pose.y)} 밀리미터.`;
  if (point === "O") return `${head} 이 값이 종이 원점의 로봇 좌표입니다.`;
  if (point === "X") {
    const delta = origin
      ? ` O에서 X까지 변화량은 델타 X ${spokenMm(pose.x - origin.x)}, 델타 Y ${spokenMm(pose.y - origin.y)} 밀리미터입니다.`
      : "";
    return `${head} 종이 x축 위 10 센티미터 지점입니다.${delta}`;
  }
  return `${head} 종이 y축 위 10 센티미터 지점으로, y축의 방향과 축척을 확인하는 데 씁니다.`;
}

/** Written form of a spoken line (symbols instead of read-aloud words). */
const display = (line: string) =>
  line
    .replace("회전각 세타", "회전각 θ")
    .replace("플러스 마이너스 2 밀리미터", "±2 mm")
    .replace("P1부터 P4까지의", "P1~P4의")
    .replace("세타", "θ")
    .replace(/델타 ([XY])/g, "Δ$1")
    .replace(/10 센티미터/g, "10 cm")
    .replace(/마이너스 (\d)/g, "−$1")
    .replace(/ 밀리미터/g, " mm");

/** Speak one line now, interrupting any guide that is playing. */
export function speakNow(line: string) {
  if (typeof window === "undefined" || !("speechSynthesis" in window)) return;
  window.speechSynthesis.cancel();
  const utterance = new SpeechSynthesisUtterance(line);
  utterance.lang = "ko-KR";
  const voice = koreanVoice();
  if (voice) utterance.voice = voice;
  window.speechSynthesis.speak(utterance);
}

export const writtenForm = (line: string) => display(line);

function koreanVoice(): SpeechSynthesisVoice | null {
  const voices = window.speechSynthesis.getVoices();
  return (
    voices.find((v) => v.lang === "ko-KR" && /natural|online|neural/i.test(v.name)) ??
    voices.find((v) => v.lang === "ko-KR") ??
    voices.find((v) => v.lang.toLowerCase().startsWith("ko")) ??
    null
  );
}

export function PaperV6Narration({ script = PAPER_V6_INTRO_SCRIPT, label = "이번 단계 안내 듣기" }: { script?: string[]; label?: string }) {
  const supported = typeof window !== "undefined" && "speechSynthesis" in window;
  const [current, setCurrent] = useState<number | null>(null);
  const runRef = useRef(0);

  useEffect(() => {
    // Voices load asynchronously in Chrome/Edge; touching the list starts the load early.
    if (supported) window.speechSynthesis.getVoices();
  }, [supported]);

  useEffect(() => () => {
    runRef.current += 1;
    if (supported) window.speechSynthesis.cancel();
  }, [supported]);

  const stop = () => {
    runRef.current += 1;
    if (supported) window.speechSynthesis.cancel();
    setCurrent(null);
  };

  const play = () => {
    if (!supported) return;
    stop();
    const run = runRef.current;
    const speakFrom = (index: number) => {
      if (run !== runRef.current) return;
      if (index >= script.length) {
        setCurrent(null);
        return;
      }
      setCurrent(index);
      const utterance = new SpeechSynthesisUtterance(script[index]);
      utterance.lang = "ko-KR";
      const voice = koreanVoice();
      if (voice) utterance.voice = voice;
      utterance.rate = 1;
      utterance.onend = () => speakFrom(index + 1);
      utterance.onerror = () => {
        if (run === runRef.current) setCurrent(null);
      };
      window.speechSynthesis.speak(utterance);
    };
    speakFrom(0);
  };

  const playing = current !== null;
  return (
    <section className="paper-v6-narration" aria-label="활동 안내" data-testid="paper-v6-narration">
      <div className="paper-v6-narration__bar">
        {supported ? (
          <button
            type="button"
            className="paper-v6-narration__play"
            aria-pressed={playing}
            onClick={playing ? stop : play}
            data-testid="paper-v6-narration-play"
          >
            {playing ? "■ 안내 정지" : `▶ ${label}`}
          </button>
        ) : (
          <span className="paper-v6-narration__note">이 브라우저는 음성 안내를 지원하지 않습니다.</span>
        )}
        <span className="paper-v6-narration__meta">약 {Math.max(10, Math.round(script.join("").length / 7 / 5) * 5)}초</span>
      </div>
      {playing ? (
        <p className="paper-v6-narration__caption" aria-live="polite" data-testid="paper-v6-narration-caption">
          <b>{current! + 1}/{script.length}</b> {display(script[current!])}
        </p>
      ) : (
        <details className="paper-v6-narration__script">
          <summary>안내 문장 보기</summary>
          <ol>
            {script.map((line) => (
              <li key={line}>{display(line)}</li>
            ))}
          </ol>
        </details>
      )}
    </section>
  );
}
