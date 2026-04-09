"""
controller.py — IntelliEye Mouse & Keyboard Control Module
Made by Hyunho Cho

Executes actions decided by the Gemma 4 model using pyautogui.
Failsafe is always enabled: moving the mouse to the top-left corner
of the screen will immediately raise an exception and halt the agent.
"""

import time
import pyautogui

# Safety: raise pyautogui.FailSafeException when the mouse reaches (0, 0).
pyautogui.FAILSAFE = True
pyautogui.PAUSE = 0.3  # Short pause between pyautogui calls


def execute_action(action: dict) -> str:
    """Execute a single action dict returned by the model.

    Supported action types:
        click       — left-click at (x, y), optional double-click
        right_click — right-click at (x, y)
        move        — move mouse to (x, y) without clicking
        type        — type a string of text
        hotkey      — press a keyboard shortcut (list of keys)
        key         — press a single key
        scroll      — scroll up or down by a given amount
        screenshot  — no-op (used by the model to request a fresh frame)
        done        — signals that the goal has been achieved
        wait        — pause for a number of seconds

    Returns a short human-readable log message.
    """
    action_type = action.get("action", "").lower()

    try:
        if action_type == "click":
            x, y = int(action["x"]), int(action["y"])
            double = action.get("double", False)
            if double:
                pyautogui.doubleClick(x, y)
            else:
                pyautogui.click(x, y)
            label = "더블클릭" if double else "클릭"
            return f"[제어] {label}: ({x}, {y}) — {action.get('description', '')}"

        elif action_type == "right_click":
            x, y = int(action["x"]), int(action["y"])
            pyautogui.rightClick(x, y)
            return f"[제어] 우클릭: ({x}, {y}) — {action.get('description', '')}"

        elif action_type == "move":
            x, y = int(action["x"]), int(action["y"])
            pyautogui.moveTo(x, y, duration=0.3)
            return f"[제어] 마우스 이동: ({x}, {y}) — {action.get('description', '')}"

        elif action_type == "type":
            text = action.get("text", "")
            # Use typewrite for ASCII; write for Unicode
            pyautogui.write(text, interval=0.04)
            return f"[제어] 입력: '{text}' — {action.get('description', '')}"

        elif action_type == "hotkey":
            keys = action.get("keys", [])
            if keys:
                pyautogui.hotkey(*keys)
            return f"[제어] 단축키: {'+'.join(keys)} — {action.get('description', '')}"

        elif action_type == "key":
            key = action.get("key", "")
            if key:
                pyautogui.press(key)
            return f"[제어] 키 입력: {key} — {action.get('description', '')}"

        elif action_type == "scroll":
            direction = action.get("direction", "down").lower()
            amount = int(action.get("amount", 3))
            clicks = -amount if direction == "down" else amount
            pyautogui.scroll(clicks)
            return f"[제어] 스크롤 {direction} {amount}칸 — {action.get('description', '')}"

        elif action_type == "screenshot":
            # Model is requesting a fresh screen capture; handled by caller
            return "[제어] 화면 캡처 요청"

        elif action_type == "done":
            return f"[완료] {action.get('description', '목표 달성')}"

        elif action_type == "wait":
            seconds = float(action.get("seconds", 1.0))
            time.sleep(seconds)
            return f"[제어] {seconds}초 대기"

        else:
            return f"[경고] 알 수 없는 액션 타입: '{action_type}'"

    except pyautogui.FailSafeException:
        raise  # Re-raise so the agent loop can catch and stop cleanly
    except Exception as exc:
        return f"[오류] 액션 실행 실패 ({action_type}): {exc}"
