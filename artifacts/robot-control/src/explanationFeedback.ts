/** Local, bounded math checks. No model call, eval, or keyword-only correctness score. */
export type ReasoningSpec =
  | { kind: "difference"; start: number; target: number; key: string }
  | { kind: "distance"; delta: number[]; key: string }
  | {
      kind: "projection";
      length: number;
      angle: number;
      horizontal: string;
      vertical: string;
    };
export type CriterionState =
  | "confirmed"
  | "error"
  | "missing"
  | "review"
  | "context";
export type ExplanationCriterion = {
  key: string;
  label: string;
  state: CriterionState;
  message: string;
  evidence: string[];
};
export type ExplanationAssessment = {
  version: "math-explanation-v1" | "math-explanation-v2";
  provider: "rule-based";
  verdict: "confirmed" | "revise" | "elaborate" | "review";
  scope: "task-math" | "arithmetic-only";
  criteria: ExplanationCriterion[];
  feedback?: { message: string; question?: string };
};
type Field = { key: string; label: string; unit?: string; tolerance?: number };
export type ExplanationContext = {
  condition: unknown;
  purpose?: "prediction" | "reflection";
  fields: Field[];
  answers: Record<string, string>;
  expected: Record<string, number | string>;
};
type Node = {
  value: number | null;
  op?: string;
  args?: Node[];
  symbol?: string;
  literal?: boolean;
};
type Equation = {
  text: string;
  nodes: Node[];
  approximate: boolean;
  historical: boolean;
  parseable: boolean;
};
const close = (a: number, b: number, tolerance = 0.1) =>
  Math.abs(a - b) <= tolerance + 1e-9;
const normalize = (text: string) =>
  text
    .replace(/²/g, "^2")
    .replace(/³/g, "^3")
    .normalize("NFKC")
    .replace(/[−–—]/g, "-")
    .replace(/[×·]/g, "*")
    .replace(/÷/g, "/")
    .replace(/π/g, "pi")
    .replace(/√/g, "sqrt")
    .replace(/델타\s*Z/gi, "ΔZ");
const numberText = (n: number) => String(Number(n.toFixed(3)));
const known = (n: Node | undefined): n is Node & { value: number } =>
  !!n && n.value !== null && Number.isFinite(n.value);

/** Restricted recursive descent; trig arguments are degrees throughout this course. */
export function mathExpression(
  input: string,
  symbols: Record<string, number> = {},
): Node | null {
  const source = normalize(input)
    .replace(/\s+/g, "")
    .replace(/mm\b/gi, "")
    .replace(/°/g, "")
    .replace(/毫米$/i, "");
  if (!source || source.length > 300) return null;
  const tokens = source.match(
    /\d+(?:\.\d+)?|sqrt|sin|cos|abs|[a-zA-Z_Δθ][a-zA-Z_0-9Δθ]*|[가-힣]+|[()+\-*/^]/g,
  );
  if (!tokens || tokens.join("") !== source || tokens.length > 120) return null;
  let i = 0,
    depth = 0;
  const values = Object.fromEntries(
    Object.entries(symbols).map(([k, v]) => [k.toLowerCase(), v]),
  );
  const binary = (op: string, a: Node, b: Node): Node => {
    let value: number | null = null;
    if (known(a) && known(b))
      value =
        op === "+"
          ? a.value + b.value
          : op === "-"
            ? a.value - b.value
            : op === "*"
              ? a.value * b.value
              : op === "/"
                ? a.value / b.value
                : a.value ** b.value;
    if (value !== null && !Number.isFinite(value)) throw Error("nonfinite");
    return { op, args: [a, b], value };
  };
  function atom(): Node {
    if (++depth > 24) throw Error("depth");
    const token = tokens![i++];
    let result: Node;
    if (token === "(") {
      result = sum();
      if (tokens![i++] !== ")") throw Error("parenthesis");
    } else if (/^\d/.test(token ?? ""))
      result = { value: Number(token), literal: true };
    else if (["sqrt", "sin", "cos", "abs"].includes(token?.toLowerCase())) {
      const name = token.toLowerCase(),
        arg = unary();
      const v = arg.value;
      const value =
        v === null
          ? null
          : name === "sqrt"
            ? Math.sqrt(v)
            : name === "abs"
              ? Math.abs(v)
              : name === "sin"
                ? Math.sin((v * Math.PI) / 180)
                : Math.cos((v * Math.PI) / 180);
      if (value !== null && !Number.isFinite(value)) throw Error("domain");
      result = { value, op: name, args: [arg] };
    } else if (token && /^[a-zA-Z_Δθ가-힣]/.test(token))
      result = {
        value: Object.hasOwn(values, token.toLowerCase())
          ? values[token.toLowerCase()]
          : null,
        symbol: token.toLowerCase(),
      };
    else throw Error("token");
    depth--;
    return result;
  }
  function power(): Node {
    const a = atom();
    return tokens![i] === "^" ? (i++, binary("^", a, unary())) : a;
  }
  function unary(): Node {
    const t = tokens![i];
    if (t === "+" || t === "-") {
      i++;
      const a = unary();
      return t === "+"
        ? a
        : {
            op: "negate",
            args: [a],
            value: a.value === null ? null : -a.value,
          };
    }
    return power();
  }
  function product(): Node {
    let a = unary();
    while (["*", "/"].includes(tokens![i])) {
      const op = tokens![i++];
      a = binary(op, a, unary());
    }
    return a;
  }
  function sum(): Node {
    let a = product();
    while (["+", "-"].includes(tokens![i])) {
      const op = tokens![i++];
      a = binary(op, a, product());
    }
    return a;
  }
  try {
    const node = sum();
    return i === tokens.length ? node : null;
  } catch {
    return null;
  }
}
const walk = (node: Node): Node[] => [node, ...(node.args ?? []).flatMap(walk)];
const equalValue = (node: Node | undefined, value: number) =>
  known(node) && close(node.value, value, 0.00001);
const criterion = (
  key: string,
  label: string,
  state: CriterionState,
  message: string,
  evidence: string[] = [],
): ExplanationCriterion => ({ key, label, state, message, evidence });
function specOf(condition: unknown): ReasoningSpec | undefined {
  const s = (condition as { reasoning?: ReasoningSpec } | null)?.reasoning;
  if (!s || !["difference", "distance", "projection"].includes(s.kind)) return;
  if (s.kind === "difference" && [s.start, s.target].every(Number.isFinite))
    return s;
  if (
    s.kind === "distance" &&
    Array.isArray(s.delta) &&
    s.delta.length > 0 &&
    s.delta.every(Number.isFinite)
  )
    return s;
  if (s.kind === "projection" && [s.length, s.angle].every(Number.isFinite))
    return s;
  return undefined;
}
function symbolsFor(spec: ReasoningSpec | undefined): Record<string, number> {
  if (!spec) return {};
  if (spec.kind === "difference")
    return {
      start: spec.start,
      Z0: spec.start,
      출발: spec.start,
      출발높이: spec.start,
      현재: spec.start,
      현재높이: spec.start,
      시작: spec.start,
      target: spec.target,
      Z1: spec.target,
      목표: spec.target,
      목표높이: spec.target,
      도착: spec.target,
      도착높이: spec.target,
      ΔZ: spec.target - spec.start,
      dZ: spec.target - spec.start,
      상승량: spec.target - spec.start,
      변화량: spec.target - spec.start,
    };
  if (spec.kind === "distance")
    return {
      ΔX: spec.delta[0],
      ΔY: spec.delta[1],
      ΔZ: spec.delta[2] ?? 0,
      거리: Math.hypot(...spec.delta),
      d: Math.hypot(...spec.delta),
    };
  return {
    L: spec.length,
    길이: spec.length,
    θ: spec.angle,
    theta: spec.angle,
    수평: spec.length * Math.cos((spec.angle * Math.PI) / 180),
    높이: spec.length * Math.sin((spec.angle * Math.PI) / 180),
  };
}
function equationsIn(
  text: string,
  symbols: Record<string, number>,
): Equation[] {
  const result: Equation[] = [];
  // Only known mathematical symbols are included. Unknown prose is not silently treated as math.
  const names = ["sqrt", "sin", "cos", "abs", ...Object.keys(symbols)]
    .sort((a, b) => b.length - a.length)
    .join("|");
  const token = new RegExp(
    `(?:[0-9]+(?:\\.[0-9]+)?|mm|cm|${names}|[=≈()+*/^°-])`,
    "iyu",
  );
  // Scan once instead of applying nested quantifiers to arbitrary student text.
  const spans = (clause: string) => {
    const output: string[] = [];
    let buffer = "";
    const flush = () => {
      if (/[=≈]/.test(buffer) && buffer.length <= 900)
        output.push(buffer.trim());
      buffer = "";
    };
    for (let i = 0; i < clause.length; ) {
      if (/\s/.test(clause[i])) {
        if (buffer) buffer += " ";
        i++;
        continue;
      }
      if (!buffer && i > 0 && /[\p{L}\p{N}_]/u.test(clause[i - 1])) {
        i++;
        continue;
      }
      token.lastIndex = i;
      const match = token.exec(clause);
      if (match) {
        buffer += match[0];
        i = token.lastIndex;
      } else {
        flush();
        i++;
      }
    }
    flush();
    return output;
  };
  for (const original of text.split(/\n|[;!?。]|(?<!\d)\.(?!\d)/)) {
    const clause = normalize(original);
    const historical =
      /처음|이전|잘못|틀렸|틀린|아니|않|오류|정정|수정|생각했|꺾인|경유|맨해튼/.test(
        original,
      );
    for (const expression of spans(clause)) {
      const parts = expression.split(/[=≈]/),
        nodes = parts.map((p) => mathExpression(p, symbols));
      result.push({
        text: original.trim(),
        nodes: nodes.filter((n): n is Node => n !== null),
        approximate: expression.includes("≈"),
        historical,
        parseable:
          nodes.every((n) => n !== null) &&
          !/(?<![a-z])(?:cm|m)(?![a-z])/i.test(expression),
      });
      if (result.length >= 20) return result;
    }
    // Common Korean subtraction phrasing, including 「60에서 45를 빼면 15 mm」.
    const spoken =
      /(-?\d+(?:\.\d+)?)\s*(?:mm)?에서\s*(-?\d+(?:\.\d+)?)\s*(?:mm)?(?:을|를)?\s*빼(?:면|서|니|어|니까)\s*(-?\d+(?:\.\d+)?)/g;
    for (const m of clause.matchAll(spoken))
      result.push({
        text: original.trim(),
        nodes: [mathExpression(`${m[1]}-(${m[2]})`)!, mathExpression(m[3])!],
        approximate: false,
        historical,
        parseable: true,
      });
  }
  // A standalone expression is meaningful evidence too; the answer lives in its own field.
  if (!result.length) {
    const expression = mathExpression(text, symbols);
    if (expression?.op && known(expression))
      result.push({
        text: text.trim(),
        nodes: [expression],
        approximate: false,
        historical: false,
        parseable: true,
      });
  }
  return result.slice(0, 20);
}
function referenceCheck(
  text: string,
  equations: Equation[],
  spec: ReasoningSpec,
): ExplanationCriterion {
  const active = equations.filter((e) => !e.historical && e.parseable);
  const nodes = active.flatMap((e) => e.nodes.flatMap(walk));
  if (spec.kind === "difference") {
    const start = new RegExp(
      `(?:출발|시작|현재|지금)(?:\\s*높이)?(?:는|은|이|가|:|=)?\\s*(?:Z\\s*=\\s*)?(-?\\d+(?:\\.\\d+)?)`,
      "gi",
    );
    const target = new RegExp(
      `(?:목표|도착)(?:\\s*높이)?(?:는|은|이|가|:|=)?\\s*(?:Z\\s*=\\s*)?(-?\\d+(?:\\.\\d+)?)`,
      "gi",
    );
    const wrong =
      !/처음|이전|잘못|아니|않|수정/.test(text) &&
      ([...text.matchAll(start)].some(
        (m) => !close(Number(m[1]), spec.start),
      ) ||
        [...text.matchAll(target)].some(
          (m) => !close(Number(m[1]), spec.target),
        ));
    if (wrong)
      return criterion(
        "reference",
        "출발·목표 기준",
        "error",
        `문제의 출발은 ${spec.start} mm, 목표는 ${spec.target} mm입니다. 설명에 적은 기준값을 확인하세요.`,
        [text],
      );
    const both =
      nodes.some((n) => equalValue(n, spec.start)) &&
      nodes.some((n) => equalValue(n, spec.target));
    return criterion(
      "reference",
      "출발·목표 기준",
      both ? "confirmed" : "missing",
      both
        ? "출발값과 목표값이 식에 포함되어 있습니다. 둘의 역할은 아래 뺄셈 순서와 함께 확인합니다."
        : "문제의 출발 높이와 목표 높이를 적고 각각 어느 값인지 구분하세요.",
      active
        .filter((e) =>
          e.nodes.some((n) =>
            walk(n).some(
              (v) => equalValue(v, spec.start) || equalValue(v, spec.target),
            ),
          ),
        )
        .map((e) => e.text),
    );
  }
  if (spec.kind === "distance") {
    const matches = spec.delta
      .filter((v) => v !== 0)
      .every((v) =>
        nodes.some((n) => equalValue(n, v) || equalValue(n, Math.abs(v))),
      );
    return criterion(
      "reference",
      "좌표 변화량 기준",
      matches ? "confirmed" : "missing",
      matches
        ? "주어진 각 축 변화량의 크기가 식에 포함되어 있습니다."
        : "각 축의 변화량을 식에 넣고, 길이와 부호가 있는 변위를 구분하세요.",
      matches ? active.map((e) => e.text) : [],
    );
  }
  const matches =
    nodes.some((n) => equalValue(n, spec.length)) &&
    (nodes.some((n) => equalValue(n, spec.angle)) || /0\.866|0\.5/.test(text));
  return criterion(
    "reference",
    "길이·각도 기준",
    matches ? "confirmed" : "missing",
    matches
      ? "링크 길이와 각도 또는 제시된 삼각비가 포함되어 있습니다."
      : "링크 길이와 수평에서 잰 각도를 식에 연결하세요.",
    matches ? active.map((e) => e.text) : [],
  );
}
function relationCheck(
  text: string,
  equations: Equation[],
  spec: ReasoningSpec,
): ExplanationCriterion {
  const current = equations.filter((e) => !e.historical && e.parseable);
  const nodes = current.flatMap((e) => e.nodes.flatMap(walk));
  const evidence = current.map((e) => e.text);
  if (spec.kind === "difference") {
    const inverse = current.some(
      (e) =>
        e.nodes.some(
          (n) =>
            n.op === "+" &&
            n.args?.some((a) => equalValue(a, spec.start)) &&
            n.args?.some((a) => equalValue(a, spec.target - spec.start)),
        ) && e.nodes.some((n) => equalValue(n, spec.target)),
    );
    const correct =
      inverse ||
      nodes.some(
        (n) =>
          n.op === "-" &&
          equalValue(n.args?.[0], spec.target) &&
          equalValue(n.args?.[1], spec.start),
      );
    const wrong = nodes.some(
      (n) =>
        ["+", "-"].includes(n.op ?? "") &&
        ((equalValue(n.args?.[0], spec.start) &&
          equalValue(n.args?.[1], spec.target)) ||
          (n.op === "+" &&
            equalValue(n.args?.[0], spec.target) &&
            equalValue(n.args?.[1], spec.start))),
    );
    if (wrong)
      return criterion(
        "relation",
        "관계식",
        "error",
        "상승량은 목표−출발입니다. 두 높이를 더하거나 뺄셈 순서를 뒤집은 식이 설명에 있습니다. 다른 경로를 비교한 식이라면 그 뜻을 구분해 적으세요.",
        evidence,
      );
    if (correct)
      return criterion(
        "relation",
        "관계식",
        "confirmed",
        "출발 높이와 목표 높이 사이의 변화량을 구하는 관계를 확인했습니다.",
        evidence,
      );
    if (
      /목표(?:\s*높이)?에서\s*출발(?:\s*높이)?(?:를|을)?\s*빼/.test(text) &&
      !/아니|않|처음|이전/.test(text)
    )
      return criterion(
        "relation",
        "관계식",
        "confirmed",
        "문장에서 목표−출발 관계를 확인했습니다.",
        [text],
      );
    return criterion(
      "relation",
      "관계식",
      "missing",
      "‘목표−출발’의 뺄셈 식이나 같은 뜻의 문장을 적으세요.",
    );
  }
  if (spec.kind === "distance") {
    const needed = spec.delta
      .filter((v) => v !== 0)
      .map(Math.abs)
      .sort((a, b) => a - b);
    const valid = nodes.some((n) => {
      if (n.op !== "sqrt") return false;
      const terms = (node: Node): Node[] =>
        node.op === "+" ? node.args!.flatMap(terms) : [node];
      const squares = terms(n.args![0]);
      const bases = squares
        .filter(
          (q) =>
            q.op === "^" && equalValue(q.args?.[1], 2) && known(q.args?.[0]),
        )
        .map((q) => Math.abs(q.args![0].value!))
        .filter((v) => v !== 0)
        .sort((a, b) => a - b);
      return (
        bases.length === needed.length &&
        bases.every((v, i) => close(v, needed[i], 0.00001))
      );
    });
    if (valid)
      return criterion(
        "relation",
        "직선거리 관계",
        "confirmed",
        "각 성분의 제곱합에 제곱근을 취하는 관계를 확인했습니다.",
        evidence,
      );
    const wrong = current.some((e) =>
      e.nodes.some(
        (n) =>
          n.op === "+" &&
          known(n) &&
          !close(n.value, Math.hypot(...spec.delta)),
      ),
    );
    return criterion(
      "relation",
      "직선거리 관계",
      wrong ? "error" : "missing",
      wrong
        ? "성분을 더한 값은 꺾인 이동거리일 수 있습니다. 직선거리는 제곱합의 제곱근으로 구하세요. 비교용 식이면 구분해서 적으세요."
        : "직각삼각형의 두 성분을 제곱해 더한 뒤 제곱근을 취하는 식을 보여 주세요.",
      wrong ? evidence : [],
    );
  }
  const binding = (equation: Equation, words: string[]) =>
    words.includes(equation.nodes[0]?.symbol ?? "") ||
    (words.some((w) => equation.text.includes(w)) &&
      !(words.includes("수평") ? /높이|수직|세로/ : /수평|가로/).test(
        equation.text,
      ));
  const trig = (e: Equation, name: string) =>
    e.nodes
      .flatMap(walk)
      .some(
        (n) =>
          n.op === "*" &&
          n.args!.some((a) => equalValue(a, spec.length)) &&
          n.args!.some(
            (a) => a.op === name && equalValue(a.args?.[0], spec.angle),
          ),
      );
  const h = current.filter((e) => binding(e, ["수평", "가로"])),
    v = current.filter((e) => binding(e, ["높이", "수직", "세로"]));
  const correct =
    h.some((e) => trig(e, "cos")) && v.some((e) => trig(e, "sin"));
  const wrong = h.some((e) => trig(e, "sin")) || v.some((e) => trig(e, "cos"));
  return criterion(
    "relation",
    "성분과 삼각비",
    wrong ? "error" : correct ? "confirmed" : "missing",
    wrong
      ? "수평에서 잰 각도에서는 수평=Lcosθ, 높이=Lsinθ입니다. 두 성분의 삼각비가 뒤바뀌었는지 확인하세요."
      : correct
        ? "수평에 Lcosθ, 높이에 Lsinθ를 연결한 식을 확인했습니다."
        : "수평과 높이를 구분하여 각각 Lcosθ와 Lsinθ의 식을 적으세요. 숫자만 곱했다면 사용한 삼각비도 덧붙이세요.",
    [...h, ...v].map((e) => e.text),
  );
}

/** Nothing here treats a fluent sentence or a matched number as proof of understanding. */
function assessExplicitMath(
  text: string,
  context: ExplanationContext,
): ExplanationAssessment {
  const spec = specOf(context.condition),
    criteria: ExplanationCriterion[] = [];
  if (text.length > 4000)
    return {
      version: "math-explanation-v1",
      provider: "rule-based",
      verdict: "review",
      scope: spec ? "task-math" : "arithmetic-only",
      criteria: [
        criterion(
          "length",
          "답안 범위",
          "review",
          "자동 확인은 4,000자까지 지원합니다. 핵심 식과 근거를 요약하거나 교사 검토용으로 남기세요.",
        ),
      ],
    };
  const equations = equationsIn(text, symbolsFor(spec));
  const active = equations.filter((e) => !e.historical && e.parseable);
  const bad = active.filter((e) =>
    e.nodes.some(
      (n, i) =>
        i > 0 &&
        known(n) &&
        known(e.nodes[i - 1]) &&
        !close(n.value, e.nodes[i - 1].value!, e.approximate ? 0.15 : 0.1),
    ),
  );
  const unsupported = equations.some((e) => !e.historical && !e.parseable);
  const checked = active.filter(
    (e) => e.nodes.length > 1 && e.nodes.every(known),
  );
  if (spec) {
    criteria.push(referenceCheck(text, equations, spec));
    criteria.push(relationCheck(text, equations, spec));
  }
  criteria.push(
    criterion(
      "calculation",
      "식의 계산",
      bad.length
        ? "error"
        : unsupported
          ? "review"
          : checked.length
            ? "confirmed"
            : equations.length
              ? "review"
              : "missing",
      bad.length
        ? "인용한 등식의 양쪽 값이 다릅니다. 계산이나 등호로 연결한 값을 다시 확인하세요."
        : unsupported
          ? "지원하는 형태로 해석하지 못한 식이 있습니다. 확인한 식만으로 전체 계산을 맞았다고 처리하지 않습니다. 식을 나누어 적거나 교사 검토용으로 남기세요."
          : checked.length
            ? "지원하는 식의 등호 양쪽 계산값이 일치합니다."
            : equations.length
              ? "이전 생각·부정 표현 또는 지원하지 않는 식이 포함되어 계산을 단정하지 않았습니다. 현재 판단을 별도 문장으로 적으세요."
              : "확인할 수 있는 계산식이 없습니다. 예: ‘목표−출발=변화량’에 실제 수치를 대입해 주세요.",
      (bad.length ? bad : checked).map((e) => e.text),
    ),
  );
  const unitWrong =
    /(?<![a-z])(?:cm|m)(?![a-z])|(?:센티미터|미터)(?![가-힣])/i.test(text) &&
    !/밀리미터/.test(text);
  const hasUnit = /(?:mm(?![a-z])|밀리미터)/i.test(text);
  const unitExpected = context.fields.some((f) => f.unit === "mm");
  criteria.push(
    criterion(
      "unit",
      "단위",
      unitExpected && unitWrong ? "review" : hasUnit ? "confirmed" : "missing",
      unitExpected && unitWrong
        ? "이 문제의 입력 단위는 mm입니다. cm·m로 설명했다면 변환 관계를 명시하세요. 다른 단위라는 이유만으로 오답 처리하지 않습니다."
        : hasUnit
          ? "설명에 mm 단위가 있습니다. 수치와 단위의 대응도 함께 검토하세요."
          : "설명에 계산 결과의 단위를 적으세요.",
      hasUnit || unitWrong ? [text] : [],
    ),
  );
  // Bind only explicit task output symbols, never any incidental number in a paragraph.
  const names: Record<string, string[]> =
    spec?.kind === "difference"
      ? { delta: ["ΔZ", "dZ", "상승량", "변화량"] }
      : spec?.kind === "distance"
        ? { distance: ["거리", "d"] }
        : spec?.kind === "projection"
          ? { horizontal: ["수평"], vertical: ["높이"] }
          : {};
  const keyOf = (k: string) =>
    !spec
      ? k
      : spec.kind === "projection"
        ? k === "horizontal"
          ? spec.horizontal
          : spec.vertical
        : spec.key;
  const claims: { key: string; value: number; text: string }[] = [];
  for (const [k, aliases] of Object.entries(names))
    for (const e of active) {
      if (
        e.nodes[0]?.symbol &&
        aliases.some((a) => a.toLowerCase() === e.nodes[0].symbol) &&
        known(e.nodes.at(-1))
      )
        claims.push({
          key: keyOf(k),
          value: e.nodes.at(-1)!.value!,
          text: e.text,
        });
    }
  if (spec && spec.kind !== "projection" && claims.length === 0) {
    for (const e of active) {
      const n = e.nodes.at(-1);
      const relation = relationCheck(e.text, [e], spec);
      const inverse =
        spec.kind === "difference" &&
        e.nodes.some(
          (node) =>
            node.op === "+" &&
            node.args?.some((a) => equalValue(a, spec.start)),
        );
      if (
        known(n) &&
        !inverse &&
        ["confirmed", "error"].includes(relation.state)
      )
        claims.push({ key: spec.key, value: n.value, text: e.text });
    }
  }
  const contradictions = claims.filter((c) => {
    const entered = context.answers[c.key];
    return (
      entered?.trim() &&
      Number.isFinite(Number(entered)) &&
      !close(c.value, Number(entered), 0.15)
    );
  });
  const wrongConclusions = claims.filter(
    (c) =>
      typeof context.expected[c.key] === "number" &&
      !close(c.value, Number(context.expected[c.key]), 0.15),
  );
  criteria.push(
    criterion(
      "consistency",
      "입력 답·설명 연결",
      contradictions.length || wrongConclusions.length
        ? "error"
        : claims.length
          ? "confirmed"
          : "review",
      contradictions.length
        ? "숫자 입력란의 답과 설명에서 얻은 값이 다릅니다. 어느 값이 현재 판단인지 확인하고 답 또는 설명을 고치세요."
        : wrongConclusions.length
          ? "설명에서 얻은 값이 문제의 확인값과 다릅니다. 기준값과 관계식을 다시 확인하세요."
          : claims.length
            ? "확인할 수 있는 결론값이 숫자 답·문제의 확인값과 일치합니다."
            : "설명의 결론을 숫자 답과 연결해 확정할 수 없습니다. ‘상승량=…’처럼 무엇의 값인지 명시하세요.",
      (contradictions.length
        ? contradictions
        : wrongConclusions.length
          ? wrongConclusions
          : claims
      ).map((c) => c.text),
    ),
  );
  if (!spec)
    criteria.push(
      criterion(
        "meaning",
        "설명의 의미·근거",
        "review",
        "이 활동의 자유로운 논증 전체는 자동으로 채점하지 않습니다. 확인한 식과 관찰값을 근거로 쓴 설명은 교사 검토 대상으로 보존합니다.",
      ),
    );
  const verdict = criteria.some((c) => c.state === "error")
    ? "revise"
    : criteria.every((c) => c.state === "confirmed")
      ? "confirmed"
      : criteria.some((c) => c.state === "missing")
        ? "elaborate"
        : "review";
  return {
    version: "math-explanation-v1",
    provider: "rule-based",
    verdict,
    scope: spec ? "task-math" : "arithmetic-only",
    criteria,
  };
}

/** A few explicit ways of stating a relationship, not a semantic score for arbitrary prose. */
function verbalRelation(
  text: string,
  spec: ReasoningSpec,
  context: ExplanationContext,
): ExplanationCriterion | undefined {
  const differenceMotions = (clause: string) => {
    if (spec.kind !== "difference") return [] as {
      from: number;
      to: number;
      amount?: number;
      text: string;
    }[];
    const result: {
      from: number;
      to: number;
      amount?: number;
      text: string;
    }[] = [];
    // Treat a natural-language move as a mathematical claim. Keep the
    // optional amount separate so 20→60 is not confused with Δ=40.
    const motion =
      /(-?\d+(?:\.\d+)?)\s*(?:mm\s*)?(?:에서|부터)\s*(?:(?:목표|도착|현재|출발|시작)\s*)?(-?\d+(?:\.\d+)?)\s*(?:mm\s*)?(?:로|으로|까지)([^,;!?。]*)/g;
    for (const match of clause.matchAll(motion)) {
      const tail = match[3] ?? "";
      const amount = tail.match(
        /(-?\d+(?:\.\d+)?)\s*(?:mm\s*)?(?:만큼|(?:씩\s*)?(?:증가|감소|상승|하강))/,
      );
      result.push({
        from: Number(match[1]),
        to: Number(match[2]),
        amount: amount ? Number(amount[1]) : undefined,
        text: match[0].trim(),
      });
    }
    return result;
  };
  const clauses = text
    .split(/\n|[;!?。]|(?<!\d)\.(?!\d)/)
    .filter(
      (s) =>
        !/처음에는|이전에는|생각했|잘못|틀렸|틀린|아니|않|오류|정정|모르|몰라|[?？]/.test(
          s,
        ),
    );
  const target = "(?:목표|도착)(?:\\s*(?:높이|위치|값))?";
  const start = "(?:현재|지금|출발|시작)(?:\\s*(?:높이|위치|값))?";
  let supported: ExplanationCriterion | undefined;
  for (const clause of clauses) {
    let correct = false,
      wrong = false;
    if (spec.kind === "difference") {
      const motions = differenceMotions(clause);
      const expectedAmount = spec.target - spec.start;
      const mismatchedMotion = motions.find(
        (m) =>
          !close(m.from, spec.start) ||
          !close(m.to, spec.target) ||
          (m.amount !== undefined && !close(m.amount, expectedAmount)),
      );
      if (mismatchedMotion) {
        const reference = `${numberText(spec.start)}에서 ${numberText(spec.target)}로`;
        const described = `${numberText(mismatchedMotion.from)}에서 ${numberText(mismatchedMotion.to)}로`;
        const amount =
          mismatchedMotion.amount === undefined
            ? ""
            : ` 변화량은 ${numberText(mismatchedMotion.amount)} mm`;
        return criterion(
          "relation",
          "설명한 수학 관계",
          "error",
          `설명은 ${described}${amount}라고 읽혔습니다. 이 문항의 이동은 ${reference}이고 변화량은 ${numberText(expectedAmount)} mm(목표−출발)입니다. 출발값·목표값·변화량을 서로 맞춰 보세요.`,
          [mismatchedMotion.text],
        );
      }
      const hasCorrectFromToMotion =
        motions.some(
          (m) =>
            close(m.from, spec.start) &&
            close(m.to, spec.target) &&
            (m.amount === undefined || close(m.amount, expectedAmount)),
        ) &&
        context.answers[spec.key] !== undefined &&
        Number.isFinite(Number(context.answers[spec.key])) &&
        close(Number(context.answers[spec.key]), expectedAmount);
      correct =
        new RegExp(
          `${target}에서\\s*${start}(?:을|를)?\\s*(?:빼|뺀|뺐|뺍)`,
        ).test(clause) ||
        new RegExp(
          `${start}(?:을|를)\\s*${target}에서\\s*(?:빼|뺀|뺐|뺍)`,
        ).test(clause) ||
        hasCorrectFromToMotion;
      wrong =
        new RegExp(
          `${start}에서\\s*${target}(?:을|를)?\\s*(?:빼|뺀|뺐|뺍)`,
        ).test(clause) ||
        new RegExp(
          `${target}(?:을|를)\\s*${start}에서\\s*(?:빼|뺀|뺐|뺍)`,
        ).test(clause);
      // Counting on is another valid way to find a positive change.
      if (spec.target >= spec.start)
        correct ||=
          /(?:두\s*높이|목표.*(?:현재|출발).*높이|(?:현재|출발).*목표.*높이).*차이/.test(
            clause,
          );
    } else if (spec.kind === "distance") {
      correct =
        /피타고라스(?:의)?\s*정리.*(?:사용|이용|적용|썼|써서|구했)/.test(
          clause,
        ) ||
        /(?:성분|변화량|두\s*변|각\s*축).*제곱.*(?:더|합).*?(?:제곱근|루트)/.test(
          clause,
        );
    } else {
      correct =
        /(?:수평|가로).{0,30}(?:cos|코사인)/i.test(clause) &&
        /(?:높이|수직|세로).{0,30}(?:sin|(?<!코)사인)/i.test(clause);
      wrong =
        /(?:수평|가로)(?:\s*성분)?(?:은|는|에|에는)?\s*(?:sin|(?<!코)사인)/i.test(
          clause,
        ) ||
        /(?:높이|수직|세로)(?:\s*성분)?(?:은|는|에|에는)?\s*(?:cos|코사인)/i.test(
          clause,
        );
    }
    if (wrong)
      return criterion(
        "relation",
        "설명한 수학 관계",
        "error",
        spec.kind === "difference"
          ? "상승량을 구할 때 어느 높이에서 어느 높이를 빼는지 확인하세요."
          : "수평에서 잰 각도일 때 수평과 높이에 연결한 삼각비를 확인하세요.",
        [clause.trim()],
      );
    if (correct)
      supported = criterion(
        "relation",
        "설명한 수학 관계",
        "confirmed",
        "설명에서 이 문제에 사용할 수 있는 수학 관계를 확인했습니다.",
        [clause.trim()],
      );
  }
  if (supported) return supported;
  // The reflection asks for a comparison or interpretation, not a repeated calculation.
  if (context.purpose !== "reflection") return;
  const id = (context.condition as { id?: string } | null)?.id;
  const prose = clauses.join(" ");
  const matched =
    (id === "height-transfer" &&
      /(?:출발|현재|시작).*높이.*(?:달라|높아|올라)/.test(prose) &&
      /(?:상승량|이동량|남은|덜|조금).*?(?:달라|줄|작|올리|올라|필요)/.test(
        prose,
      )) ||
    (id === "distance-practice" &&
      /(?:꺾|돌아|축.*따라)/.test(prose) &&
      /(?:직선|빗변).*?(?:짧|다르)/.test(prose)) ||
    (id === "distance-transfer" &&
      /(?:음수|부호|방향)/.test(prose) &&
      /제곱.*(?:양수|사라|없어|같)/.test(prose)) ||
    (id === "projection-practice" &&
      /빗변/.test(prose) &&
      /(?:성분|수평|높이|다른.*변).*?(?:작|짧)/.test(prose)) ||
    (id === "projection-transfer" &&
      /(?:수평|가로).*?(?:줄|작|감소)/.test(prose) &&
      /(?:높이|수직|세로).*?(?:늘|커|증가|높아)/.test(prose));
  if (matched)
    return criterion(
      "relation",
      "관계의 해석",
      "confirmed",
      "이 문항에서 묻는 변화나 비교를 설명에 연결했습니다.",
      [prose.trim()],
    );
  return undefined;
}

function focusQuestion(
  spec: ReasoningSpec | undefined,
  context: ExplanationContext,
): string {
  if (context.purpose === "reflection") {
    const id = (context.condition as { id?: string } | null)?.id;
    const questions: Record<string, string> = {
      "height-practice": "목표 높이와 더 올라갈 높이는 어떻게 다른가요?",
      "height-transfer": "출발 높이가 달라지면 남은 상승량은 왜 달라질까요?",
      "distance-practice":
        "직선으로 갈 때와 두 축을 따라 꺾어 갈 때의 거리는 왜 다를까요?",
      "distance-transfer": "방향이 음수여도 거리의 크기는 왜 양수일까요?",
      "projection-practice":
        "기울어진 링크의 길이와 각 성분의 길이는 어떻게 다른가요?",
      "projection-transfer":
        "링크를 더 세우면 수평 성분과 높이는 각각 어떻게 달라지나요?",
    };
    if (id && Object.hasOwn(questions, id)) return questions[id];
  }
  return !spec
    ? "관찰한 결과가 처음 생각한 관계를 어떻게 뒷받침하나요?"
    : spec.kind === "difference"
      ? "목표 높이와 현재 높이로 상승량을 어떻게 구했나요?"
      : spec.kind === "distance"
        ? "각 축의 변화량으로 직선거리를 어떻게 구했나요?"
        : "수평 성분과 높이를 구할 때 각각 어떤 삼각비를 사용했나요?";
}

/** Use the problem and numeric fields as context; absent repeated notation is not an error. */
export function assessExplanation(
  text: string,
  context: ExplanationContext,
): ExplanationAssessment {
  const original = assessExplicitMath(text, context),
    spec = specOf(context.condition);
  if (text.length > 4000)
    return {
      ...original,
      version: "math-explanation-v2",
      feedback: {
        message:
          "긴 설명을 그대로 저장했습니다. 자동 확인 범위를 넘어 정오 판정을 보류합니다.",
      },
    };
  const equations = equationsIn(text, symbolsFor(spec));
  const standalone =
    equations.length === 1 &&
    equations[0].parseable &&
    !equations[0].historical &&
    equations[0].nodes.length === 1 &&
    known(equations[0].nodes[0]);
  const verbal = spec ? verbalRelation(text, spec, context) : undefined;
  const answered = context.fields.filter(
    (f) => typeof context.expected[f.key] === "number",
  );
  const numericMatches =
    answered.length > 0 &&
    answered.every(
      (f) =>
        context.answers[f.key]?.trim() &&
        Number.isFinite(Number(context.answers[f.key])) &&
        close(
          Number(context.answers[f.key]),
          Number(context.expected[f.key]),
          f.tolerance ?? 0.1,
        ),
    );
  const criteria = original.criteria.map((c) => {
    if (
      c.key === "relation" &&
      verbal &&
      (c.state !== "error" || verbal.state === "error")
    )
      return verbal;
    if (c.state === "error") return c;
    if (c.key === "calculation" && standalone)
      return {
        ...c,
        state: "confirmed" as const,
        message: "적은 식의 값을 계산해 숫자 답과 함께 확인했습니다.",
        evidence: [text.trim()],
      };
    if (c.key === "reference" && c.state === "missing")
      return {
        ...c,
        state: "context" as const,
        message:
          "기준값은 문항에서 가져옵니다. 설명에 주어진 숫자를 반복할 필요는 없습니다.",
      };
    if (c.key === "unit" && c.state === "missing")
      return {
        ...c,
        state: "context" as const,
        message:
          "단위는 숫자 입력란의 표시를 따릅니다. 다른 단위를 쓴 경우에만 변환을 확인합니다.",
      };
    if (c.key === "calculation" && c.state === "missing")
      return {
        ...c,
        state: "context" as const,
        message:
          "숫자 답은 확인값과 따로 비교합니다. 근거는 계산식 없이 문장으로 설명해도 됩니다.",
      };
    if (c.key === "consistency" && c.state === "review")
      return {
        ...c,
        state: "context" as const,
        message:
          "설명은 이 문항의 숫자 답에 대한 근거로 읽습니다. 답을 문장에 다시 쓰지 않아도 됩니다.",
      };
    if (c.key === "relation" && c.state === "missing")
      return {
        ...c,
        state: "review" as const,
        message:
          "작성한 표현의 의미를 자동으로 확정하지 못했습니다. 오답으로 처리하지 않습니다.",
      };
    if (c.state === "review" && c.key === "calculation")
      return {
        ...c,
        message:
          "인용·부정 표현 또는 지원하지 않는 식이 있어 계산 판정을 보류했습니다. 표현을 고쳐 쓰도록 요구하지 않습니다.",
      };
    if (c.state === "review" && c.key === "unit")
      return {
        ...c,
        message:
          "입력란과 다른 단위가 있어 변환에 대한 판단을 보류했습니다. 다른 단위를 사용했다는 이유로 오답 처리하지 않습니다.",
      };
    return c;
  });
  // Check only explicit output claims in prose, not every number mentioned in an explanation.
  if (spec) {
    const aliases =
      spec.kind === "difference"
        ? [[spec.key, "상승량|변화량|ΔZ|결과|답"]]
        : spec.kind === "distance"
          ? [[spec.key, "직선거리|거리|결과|답"]]
          : [
              [spec.horizontal, "수평|가로"],
              [spec.vertical, "높이|수직"],
            ];
    const claims: { key: string; value: number; evidence: string }[] = [];
    for (const clause of text.split(/\n|[;!?。]|(?<!\d)\.(?!\d)/)) {
      if (/처음|이전|틀렸|아니|않|수정|꺾인|경유/.test(clause)) continue;
      for (const [key, names] of aliases) {
        const re = new RegExp(
          `(?:${names})(?:\\s*성분)?(?:은|는|이|가|:)?\\s*(-?\\d+(?:\\.\\d+)?)(?:\\s*mm)?(?=\\s|[이가입이었나정]|$)`,
          "gi",
        );
        for (const m of clause.matchAll(re))
          claims.push({ key, value: Number(m[1]), evidence: clause.trim() });
      }
      if (spec.kind !== "projection" && verbal?.state === "confirmed") {
        for (const m of clause.matchAll(
          /(-?\d+(?:\.\d+)?)\s*(?:mm)?(?:가|이)?\s*(?:나오|나옵|나와|나왔|남아|남았)/g,
        ))
          claims.push({
            key: spec.key,
            value: Number(m[1]),
            evidence: clause.trim(),
          });
      }
    }
    const mismatch = claims.filter(
      (c) =>
        (context.answers[c.key]?.trim() &&
          Number.isFinite(Number(context.answers[c.key])) &&
          !close(c.value, Number(context.answers[c.key]), 0.15)) ||
        (typeof context.expected[c.key] === "number" &&
          !close(c.value, Number(context.expected[c.key]), 0.15)),
    );
    const consistency = criteria.find((c) => c.key === "consistency")!;
    if (
      mismatch.length &&
      !/(?<![a-z])(?:cm|m)(?![a-z])|센티미터/i.test(text)
    ) {
      consistency.state = "error";
      consistency.message =
        "숫자 답과 설명에서 말한 결과가 다릅니다. 현재 판단한 값을 확인하세요.";
      consistency.evidence = mismatch.map((c) => c.evidence);
    }
  }
  const error = criteria.find((c) => c.state === "error");
  const uncertain =
    /[?？]/.test(text) ||
    criteria.some(
      (c) =>
        c.state === "review" && c.key !== "relation" && c.key !== "meaning",
    );
  const relation = criteria.find((c) => c.key === "relation");
  const minimal =
    !text.trim() ||
    /^(?:그냥(?:\s*찍었(?:다|어요))?|찍었(?:다|어요)|모르(?:겠)?(?:다|어요|습니다)|몰라요|[-+\d.\s]+(?:mm)?)[.!\s]*$/i.test(
      text.trim(),
    );
  const verdict: ExplanationAssessment["verdict"] = error
    ? "revise"
    : relation?.state === "confirmed" && numericMatches && !uncertain
      ? "confirmed"
      : minimal
        ? "elaborate"
        : "review";
  const question = focusQuestion(spec, context);
  return {
    version: "math-explanation-v2",
    provider: "rule-based",
    scope: original.scope,
    criteria,
    verdict,
    feedback: error
      ? { message: error.message }
      : verdict === "confirmed"
        ? {
            message:
              "숫자 답과 설명에서 확인한 수학 관계가 일치합니다. 같은 값이나 계산식을 다시 쓰지 않아도 됩니다.",
          }
        : {
            message:
              verdict === "elaborate"
                ? "어떤 생각으로 구했는지 한 가지 더 짚어 볼까요?"
                : "이 표현은 자동으로 정오를 확정하기 어렵습니다. 오답으로 처리하지 않으며, 설명은 그대로 기록됩니다.",
            question,
          },
  };
}
