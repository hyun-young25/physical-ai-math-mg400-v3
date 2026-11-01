export type MG400Response = {
  errorId: number;
  command: string;
  values: string[];
  raw: string;
};

export function parseMG400Response(raw: string): MG400Response {
  if (typeof raw !== "string" || !raw.trim().endsWith(";")) {
    throw new Error("MG400 응답 프레임이 완전하지 않습니다.");
  }
  const cleaned = raw.trim().slice(0, -1).trim();
  const firstComma = cleaned.indexOf(",");
  if (firstComma < 1) throw new Error("MG400 응답에 오류 코드가 없습니다.");

  const errorText = cleaned.slice(0, firstComma).trim();
  if (!/^-?\d+$/.test(errorText)) throw new Error("MG400 오류 코드 형식이 잘못되었습니다.");
  const errorId = Number(errorText);
  if (!Number.isSafeInteger(errorId)) throw new Error("MG400 오류 코드가 유효한 정수가 아닙니다.");

  const remainder = cleaned.slice(firstComma + 1).trimStart();
  if (!remainder.startsWith("{")) throw new Error("MG400 응답에 명령 식별자가 없습니다.");
  const closeBrace = remainder.indexOf("}");
  if (closeBrace < 2) throw new Error("MG400 응답의 명령 식별자가 잘못되었습니다.");
  const command = remainder.slice(1, closeBrace).trim();
  if (!command) throw new Error("MG400 응답의 명령 식별자가 비어 있습니다.");

  const tail = remainder.slice(closeBrace + 1);
  let values: string[] = [];
  if (tail.length) {
    if (!tail.startsWith(",")) throw new Error("MG400 응답 값의 구분자가 잘못되었습니다.");
    values = tail.slice(1).split(",").map(value => value.trim());
    if (values.some(value => value.length === 0)) throw new Error("MG400 응답에 빈 측정값이 있습니다.");
  }

  return { errorId, command, values, raw };
}

export function requireMG400Success(response: MG400Response, operation: string): MG400Response {
  if (response.errorId !== 0) {
    throw new Error(`${operation} 실패: 제어기 ErrorID ${response.errorId}`);
  }
  return response;
}

export function requireFiniteMG400Values(
  response: MG400Response,
  operation: string,
  count: number,
): number[] {
  requireMG400Success(response, operation);
  if (response.values.length !== count) {
    throw new Error(`${operation} 응답 측정값이 ${count}개가 아닙니다.`);
  }
  const values = response.values.map(value => Number(value));
  if (values.some(value => !Number.isFinite(value))) {
    throw new Error(`${operation} 응답에 유효하지 않은 측정값이 있습니다.`);
  }
  return values;
}
