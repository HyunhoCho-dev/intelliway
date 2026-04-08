# Intelliway — LLM 기반 자율 AI 에이전트 회사 시스템

**Intelliway**는 LLM만으로 운영되는 AI 회사 시스템입니다. 사람 없이 AI 에이전트 3명이 각자 역할을 맡아 24시간 운영되며, 오너(사용자)가 지시를 내리면 그 에이전트 회사가 실제로 일을 처리합니다.

---

## 아키텍처

```
오너 (사용자)
    ↓  (HTTP POST /task 또는 POST /chat)
[manager 에이전트] ← Cloudflare Worker (24/7)
    ↓                      ↓
[researcher]          [developer]
    ↓                      ↓
Kaggle API          GitHub Copilot API
(컴퓨팅 자원)        (LLM 코드생성/분석)
```

### 에이전트

| 에이전트 | 역할 |
|----------|------|
| **manager** | 오너 지시 수신 → 태스크 분배 → 결과 보고 |
| **researcher** | AI 논문 조사, 기술 트렌드 분석, Kaggle 실험 설계 |
| **developer** | 코드 작성, 모델 구현, 시스템 개발 |

### 기술 스택

| 구성 요소 | 기술 |
|-----------|------|
| 런타임/호스팅 | Cloudflare Workers |
| LLM 백엔드 | GitHub Copilot API (Device Login OAuth) |
| 영속성 | Cloudflare KV (태스크 큐 · 메모리 · 메시지 버스) |
| 컴퓨팅 자원 (선택) | Kaggle Kernels API |
| 언어 | TypeScript (strict) |

---

## 프로젝트 구조

```
intelliway/
├── src/
│   ├── agents/
│   │   ├── manager.ts       # 매니저 에이전트
│   │   ├── researcher.ts    # 연구원 에이전트
│   │   └── developer.ts     # 개발자 에이전트
│   ├── integrations/
│   │   ├── copilot.ts       # GitHub Copilot API 연동
│   │   └── kaggle.ts        # Kaggle API 연동
│   ├── core/
│   │   ├── task-queue.ts    # 태스크 큐 (Cloudflare KV)
│   │   ├── message-bus.ts   # 에이전트 간 메시지 버스
│   │   └── memory.ts        # 에이전트 메모리 (Cloudflare KV)
│   ├── api/
│   │   └── owner.ts         # 오너 API 엔드포인트
│   └── index.ts             # Cloudflare Worker 진입점
├── wrangler.toml            # Cloudflare Workers 설정
├── package.json
├── tsconfig.json
└── README.md
```

---

## 설치 및 배포

### 1. 의존성 설치

```bash
npm install
```

### 2. Cloudflare KV 네임스페이스 생성

```bash
# 각 네임스페이스를 생성하고 ID를 wrangler.toml에 입력하세요
npx wrangler kv:namespace create TASK_QUEUE
npx wrangler kv:namespace create AGENT_MEMORY
npx wrangler kv:namespace create MESSAGE_BUS
```

생성된 ID를 `wrangler.toml`의 해당 `id` 필드에 입력하세요.

### 3. GitHub Copilot 인증 (Device Login Flow)

Worker를 배포한 뒤:

```bash
# 1단계: 인증 시작
curl https://<your-worker>.workers.dev/auth/start

# 응답 예시:
# { "code": "XXXX-XXXX", "url": "https://github.com/login/device", "instructions": "..." }

# 2단계: 브라우저에서 https://github.com/login/device 접속 후 코드 입력

# 3단계: 인증 완료 여부 확인 (브라우저에서 코드 입력 후 호출)
curl https://<your-worker>.workers.dev/auth/status
# { "authenticated": true, "message": "GitHub Copilot authenticated successfully." }
```

### 4. 환경 변수 설정 (Secrets)

```bash
npx wrangler secret put OWNER_API_SECRET    # 오너 API 인증 키 (임의 문자열)
npx wrangler secret put KAGGLE_USERNAME     # Kaggle 계정명 (선택)
npx wrangler secret put KAGGLE_KEY          # Kaggle API 키 (선택)
```

### 5. 배포

```bash
npm run deploy
```

---

모든 요청에 `X-Owner-Secret` 헤더가 필요합니다 (`OWNER_API_SECRET` 미설정 시 개발 모드로 인증 불필요).

### `POST /task` — 작업 지시

```bash
curl -X POST https://<worker>.workers.dev/task \
  -H "Content-Type: application/json" \
  -H "X-Owner-Secret: <your-secret>" \
  -d '{"command": "최신 트랜스포머 아키텍처 연구하고 Python 구현 예제 만들어줘"}'
```

### `GET /status` — 작업 현황 조회

```bash
curl https://<worker>.workers.dev/status \
  -H "X-Owner-Secret: <your-secret>"
```

### `GET /report` — 에이전트 보고서

```bash
curl https://<worker>.workers.dev/report \
  -H "X-Owner-Secret: <your-secret>"
```

### `POST /chat` — 매니저와 대화

```bash
curl -X POST https://<worker>.workers.dev/chat \
  -H "Content-Type: application/json" \
  -H "X-Owner-Secret: <your-secret>" \
  -d '{"message": "현재 진행 중인 프로젝트가 뭐야?"}'
```

---

## Kaggle 연동

`KAGGLE_USERNAME`과 `KAGGLE_KEY`를 설정하면 researcher 에이전트가 자동으로:
- 관련 데이터셋을 검색하여 리서치 컨텍스트에 포함
- Python 실험 코드를 Kaggle 커널로 제출하여 실행 결과 수신

Kaggle API 키는 [Kaggle Account Settings](https://www.kaggle.com/settings/account) → **API** → **Create New Token**에서 발급받을 수 있습니다.

---

## 스케줄러 (Cron Trigger)

`wrangler.toml`의 Cron Trigger 설정(`*/5 * * * *` — 5분마다)에 의해:
1. **manager** — 에이전트 인박스에서 결과 수집
2. **researcher** — 할당된 태스크 처리
3. **developer** — 할당된 태스크 처리

3개 에이전트 루프는 `Promise.all`로 병렬 실행됩니다.

---

## 로컬 개발

```bash
npm run dev        # wrangler dev으로 로컬 실행
npm run type-check # TypeScript 타입 검사
```

> **참고:** 로컬 `wrangler dev` 환경에서는 KV가 인메모리로 동작합니다.
