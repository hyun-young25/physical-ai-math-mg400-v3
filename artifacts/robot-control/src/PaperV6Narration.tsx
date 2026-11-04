import { useEffect, useRef, useState } from "react";

/** Spoken overview of 2-4 심화2 for college students (browser TTS, ko-KR). */
export const PAPER_V6_INTRO_SCRIPT = [
  "이번 활동의 목표는 종이 좌표계와 로봇 좌표계 사이의 변환식을 세우고, 실제 로봇 동작으로 검증하는 것입니다.",
  "먼저 로봇으로 종이의 기준점 O, X, Y를 찍어 로봇 좌표를 측정합니다.",
  "측정값으로 원점과 회전각 세타를 구하고, 회전 변환식으로 목표점 P1부터 P4까지의 로봇 좌표를 예측합니다.",
  "로봇이 그 좌표로 실제 이동해 점을 찍으면, 예측값과 실제값의 차이를 비교합니다.",
  "오차가 허용범위 플러스 마이너스 2 밀리미터를 넘으면, AI는 원인을 바로 알려 주지 않고 질문을 던집니다. 그 질문을 근거로 모델을 수정할지 유지할지 판단하십시오.",
  "마지막으로 모델을 만들 때 쓰지 않은 독립점 V에서 다시 검증합니다.",
  "수학 모델로 예측하고, 로봇이 실행하고, 측정 결과로 모델을 고치는 순환. 이것이 이번 수업에서 다루는 피지컬 AI입니다.",
];

/** Written form of a spoken line (symbols instead of read-aloud words). */
const display = (line: string) =>
  line
    .replace("회전각 세타", "회전각 θ")
    .replace("플러스 마이너스 2 밀리미터", "±2 mm")
    .replace("P1부터 P4까지의", "P1~P4의");

function koreanVoice(): SpeechSynthesisVoice | null {
  const voices = window.speechSynthesis.getVoices();
  return (
    voices.find((v) => v.lang === "ko-KR" && /natural|online|neural/i.test(v.name)) ??
    voices.find((v) => v.lang === "ko-KR") ??
    voices.find((v) => v.lang.toLowerCase().startsWith("ko")) ??
    null
  );
}

export function PaperV6Narration({ script = PAPER_V6_INTRO_SCRIPT }: { script?: string[] }) {
  const supported = typeof window !== "undefined" && "speechSynthesis" in window;
  const [current, setCurrent] = useState<number | null>(null);
  const runRef = useRef(0);

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
    const voice = koreanVoice();
    const speakFrom = (index: number) => {
      if (run !== runRef.current) return;
      if (index >= script.length) {
        setCurrent(null);
        return;
      }
      setCurrent(index);
      const utterance = new SpeechSynthesisUtterance(script[index]);
      utterance.lang = "ko-KR";
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
            {playing ? "■ 안내 정지" : "▶ 활동 안내 듣기"}
          </button>
        ) : (
          <span className="paper-v6-narration__note">이 브라우저는 음성 안내를 지원하지 않습니다.</span>
        )}
        <span className="paper-v6-narration__meta">약 40초 · 이번 활동의 목표와 절차</span>
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
