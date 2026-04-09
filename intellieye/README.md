# IntelliEye — AI Computer Control Agent

> **Made by Hyunho Cho**

IntelliEye는 **Gemma 4** 모델이 노트북 화면을 실시간으로 보면서 스스로 판단하고 노트북을 제어하는 AI 에이전트입니다.  
Windows PowerShell 대화형 인터페이스로 자연어 목표를 입력하면, AI가 화면을 분석하고 마우스/키보드를 직접 제어하여 목표를 달성합니다.

---

## ⚡ 원클릭 설치

PowerShell(관리자 권장)에서 아래 명령어 한 줄만 실행하세요:

```powershell
iex (iwr -useb https://raw.githubusercontent.com/HyunhoCho-dev/intellieye/main/install.ps1).Content
```

설치 스크립트가 자동으로:
1. Python 3.10+ 설치 여부 확인
2. 소스 파일 다운로드 (`~/intellieye/` 폴더)
3. 필요한 Python 패키지 설치
4. `intellieye` 명령어를 PATH에 등록

---

## 🚀 실행 방법

설치 후 새 PowerShell 창에서:

```powershell
intellieye
```

또는 직접:

```powershell
python ~/intellieye/intellieye.py
```

---

## 🤖 사용 예시

```
========================================
  IntelliEye - AI Screen Control Agent
  Made by Hyunho Cho
========================================

모델을 선택하세요:
  [1] Gemma 4 E4B (4.5B) - 권장: 노트북/PC
  [2] Gemma 4 E2B (2.3B) - 경량: 저사양/빠른 속도

선택 (1 또는 2): 1

[IntelliEye] 안녕하세요! 화면을 보면서 무엇이든 도와드릴게요.
[IntelliEye] 현재 모델: Gemma 4 E4B

사용자 > 크롬 열고 유튜브에서 AI 영상 검색해줘

[IntelliEye] 현재 화면 분석 중...
[IntelliEye] 행동: 크롬 아이콘 더블클릭
[IntelliEye] 행동: 주소창에 youtube.com 입력
[IntelliEye] 행동: YouTube 검색창에 'AI 영상' 입력 후 Enter
[IntelliEye] 완료! AI 영상 검색 결과가 표시되었습니다.

사용자 > 종료

[IntelliEye] 안녕히 가세요!
```

---

## 💬 지원 명령어

| 명령어 | 설명 |
|--------|------|
| 자연어 목표 | 목표를 입력하면 AI가 자율 실행 |
| `상태` | 현재 화면 분석 결과 출력 |
| `모델변경` | 모델 재선택 (E4B ↔ E2B) |
| `종료` / `exit` | 프로그램 종료 |

---

## 🧠 모델 선택 안내

| 모델 | 파라미터 | 권장 환경 | VRAM | 속도 |
|------|---------|---------|------|------|
| **Gemma 4 E4B** | ~4.5B | 노트북 / PC (권장) | 4GB+ | 중간 |
| **Gemma 4 E2B** | ~2.3B | 저사양 / 빠른 속도 | 2GB+ | 빠름 |

- 처음 실행 시 HuggingFace에서 모델을 다운로드합니다 (E4B ~4GB / E2B ~2GB).
- 4-bit 양자화(`bitsandbytes`)가 자동으로 적용되어 VRAM 사용량을 줄입니다.

---

## 🖥️ 시스템 요구사항

| 항목 | 요구사항 |
|------|---------|
| OS | Windows 10 / 11 |
| Python | 3.10 이상 |
| VRAM | 4GB+ (E4B 권장), 2GB+ (E2B) |
| 인터넷 | 모델 최초 다운로드 시 필요 |

---

## 📁 프로젝트 구조

```
intellieye/
├── install.ps1          # 원클릭 설치 스크립트
├── intellieye.py        # 메인 진입점 (PowerShell 대화 UI)
├── screen_capture.py    # 화면 캡처 모듈 (mss / PIL)
├── model.py             # Gemma 4 모델 로드 및 추론
├── controller.py        # 마우스/키보드 제어 (pyautogui)
├── requirements.txt     # Python 패키지 목록
└── README.md            # 이 파일
```

---

## ⚠️ 주의사항

- **긴급 정지**: 마우스를 화면 왼쪽 상단 모서리로 이동하면 즉시 에이전트가 정지합니다 (`pyautogui.FAILSAFE = True`).
- 민감한 정보(비밀번호 등)가 화면에 표시된 상태로 에이전트를 실행하지 마세요.
- 현재 **Windows 전용**으로 개발되었습니다.
