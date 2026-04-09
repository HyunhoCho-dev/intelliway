"""
intellieye.py — IntelliEye Main Agent Entry Point
Made by Hyunho Cho

Run from Windows PowerShell:
    python intellieye.py

Provides an interactive dialogue loop where the user gives natural-language
goals and the Gemma 4 model watches the screen and controls the computer.
"""

import sys
import time

import pyautogui

from screen_capture import capture_screen
from model import GemmaAgent
from controller import execute_action

# ---------------------------------------------------------------------------
# Constants
# ---------------------------------------------------------------------------
BANNER = """
========================================
  IntelliEye - AI Screen Control Agent
  Made by Hyunho Cho
========================================
"""

MODEL_MENU = """\
모델을 선택하세요:
  [1] Gemma 4 E4B (4.5B) - 권장: 노트북/PC
  [2] Gemma 4 E2B (2.3B) - 경량: 저사양/빠른 속도

선택 (1 또는 2): """

MAX_STEPS = 30  # Safety: stop after this many steps per goal


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def ie_print(msg: str) -> None:
    """Print an IntelliEye-prefixed message."""
    print(f"[IntelliEye] {msg}")


def select_model() -> GemmaAgent:
    """Display model selection menu and return a GemmaAgent."""
    while True:
        choice = input(MODEL_MENU).strip()
        if choice == "1":
            agent = GemmaAgent("e4b")
            ie_print("Gemma 4 E4B 모델을 선택했습니다.")
            break
        elif choice == "2":
            agent = GemmaAgent("e2b")
            ie_print("Gemma 4 E2B 모델을 선택했습니다.")
            break
        else:
            ie_print("1 또는 2를 입력하세요.")

    ie_print("모델을 로드하는 중... (처음 실행 시 수 분이 걸릴 수 있습니다)")
    agent.load()
    ie_print(f"모델 로드 완료! 현재 모델: Gemma 4 {agent.model_key.upper()}")
    return agent


def run_goal(agent: GemmaAgent, goal: str) -> None:
    """Run the agentic loop for a single user goal."""
    ie_print("현재 화면 분석 중...")

    steps = 0
    while steps < MAX_STEPS:
        steps += 1

        screen = capture_screen()

        try:
            action = agent.decide_action(screen, goal)
        except Exception as exc:
            ie_print(f"모델 추론 오류: {exc}")
            break

        description = action.get("description", "")
        action_type = action.get("action", "").lower()

        if description:
            ie_print(f"행동: {description}")

        if action_type == "done":
            ie_print(f"완료! {description}")
            break

        try:
            log = execute_action(action)
            if log:
                print(f"  {log}")
        except pyautogui.FailSafeException:
            ie_print("긴급 정지! 마우스가 화면 모서리에 도달했습니다.")
            break

        # Brief pause so the screen can update before the next capture
        time.sleep(0.8)
    else:
        ie_print(f"최대 단계({MAX_STEPS})에 도달했습니다. 목표 달성 여부를 확인해주세요.")


def run_status(agent: GemmaAgent) -> None:
    """Capture the current screen and ask the model to describe it."""
    ie_print("현재 화면을 분석 중...")
    screen = capture_screen()
    description = agent.describe_screen(screen)
    ie_print(f"현재 화면:\n  {description}")


# ---------------------------------------------------------------------------
# Main loop
# ---------------------------------------------------------------------------

def main() -> None:
    print(BANNER)

    agent = select_model()

    ie_print("안녕하세요! 화면을 보면서 무엇이든 도와드릴게요.")
    ie_print("도움말: '상태' — 화면 분석  |  '모델변경' — 모델 교체  |  '종료' / 'exit' — 종료")
    print()

    while True:
        try:
            user_input = input("사용자 > ").strip()
        except (EOFError, KeyboardInterrupt):
            print()
            ie_print("안녕히 가세요!")
            break

        if not user_input:
            continue

        lower = user_input.lower()

        if lower in ("종료", "exit", "quit"):
            ie_print("안녕히 가세요!")
            break

        elif lower == "상태":
            run_status(agent)

        elif lower == "모델변경":
            agent = select_model()
            ie_print(f"모델이 변경되었습니다. 현재 모델: Gemma 4 {agent.model_key.upper()}")

        else:
            # Treat any other input as a natural-language goal
            run_goal(agent, user_input)

        print()


if __name__ == "__main__":
    main()
