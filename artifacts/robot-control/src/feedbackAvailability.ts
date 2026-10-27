import type { LearningFeedback } from "@workspace/api-client-react";
type Reason=NonNullable<LearningFeedback["failureReason"]>;
export const feedbackFailures:Record<Reason,{label:string;action:string}>={
  provider_quota:{label:"제공자 한도·잔액 확인 필요",action:"OpenAI API 프로젝트의 사용 가능 크레딧, 결제 상태, 프로젝트·조직 한도와 이 키의 소속 프로젝트를 확인하세요. ChatGPT 구독과 API 결제는 별개입니다. 앱은 한도나 지출 상한을 올리지 않습니다."},
  provider_rate_limit:{label:"제공자 일시 요청 제한",action:"OpenAI 요청·토큰 속도 제한을 확인하고 잠시 후 재시도하세요. 한도를 임의로 올리지 않습니다."},
  invalid_credentials:{label:"API 인증 실패",action:"서버 Secrets의 OPENAI_API_KEY가 유효하고 폐기되지 않았는지 확인하세요. 필요한 교체는 Secrets에서만 하며 키를 채팅이나 화면에 붙여 넣지 마세요."},
  not_configured:{label:"OpenAI 미설정",action:"서버 Secrets에 운영자 API 자격 증명을 설정하세요. 개발과 공개 실행 환경에 적용되는지도 확인하세요. 키를 클라이언트 코드에 넣지 마세요."},
  provider_permission:{label:"프로젝트·모델 권한 오류",action:"키의 프로젝트와 gpt-5-mini 모델 접근 권한을 확인하세요."},
  model_unavailable:{label:"모델 사용 불가",action:"설정된 gpt-5-mini 모델이 해당 API 프로젝트에 허용되는지 확인하세요."},
  invalid_request:{label:"API 요청 설정 오류",action:"모델과 요청 형식이 호환되는지 서버 구현을 확인하세요. 학생의 답안을 바꾸어 해결할 문제가 아닙니다."},
  network_error:{label:"연결 오류",action:"앱 서버와 제공자 사이의 네트워크·DNS·TLS 및 서비스 응답을 확인하세요. 이 상태만으로 잔액 부족이라고 판단하지 않습니다."},
  timeout:{label:"응답 시간 초과",action:"서버와 제공자의 응답 상태를 확인한 뒤 명시적으로 재시도하세요. 자동 반복 요청은 하지 않습니다."},
  invalid_response:{label:"유효한 답변 없음",action:"제공자의 응답 형식·빈 응답·출력 길이를 확인하세요. 이를 GPT 성공 응답으로 표시하지 않습니다."},
  provider_error:{label:"제공자 오류",action:"OpenAI 서비스 상태와 서버의 분류된 오류 상태를 확인하세요. 원본 오류 본문이나 자격 증명을 로그에 기록하지 마세요."},
  app_ip_limit:{label:"앱 네트워크별 요청 제한",action:"동일 IP에서 분당 30회 제한입니다. 교실의 공유 네트워크일 수 있으므로 잠시 후 다시 이용하세요."},
  app_visit_limit:{label:"앱 방문별 시간당 제한",action:"학습 방문당 시간당 120회 제한입니다. 대기 후 이용하세요. 앱이 이 상한을 자동으로 늘리지 않습니다."},
  app_global_limit:{label:"앱 일일 안전 한도",action:"앱 전체 하루 2,000회 안전 상한입니다. 한도 회복 후 이용하세요. 임의 증액하지 않습니다."},
  app_concurrency:{label:"앱 동시 요청 제한",action:"동시 GPT 요청 4개 상한입니다. 진행 중인 요청이 끝나면 다시 이용하세요."},
};
