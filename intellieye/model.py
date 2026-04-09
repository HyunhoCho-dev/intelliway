"""
model.py — IntelliEye Gemma 4 Model Module
Made by Hyunho Cho

Loads a Gemma 4 E4B or E2B model from Hugging Face and provides an
inference function that takes a screen image + user goal and returns
a structured action dict (Function Calling style).
"""

import json
import re
from typing import Optional

from PIL import Image

# ---------------------------------------------------------------------------
# Model IDs on Hugging Face Hub
# ---------------------------------------------------------------------------
MODEL_IDS = {
    "e4b": "google/gemma-4-e4b-it",
    "e2b": "google/gemma-4-e2b-it",
}

# ---------------------------------------------------------------------------
# System prompt for the computer-control agent
# ---------------------------------------------------------------------------
SYSTEM_PROMPT = """\
당신은 노트북 화면을 실시간으로 보면서 사용자의 목표를 달성하는 AI 에이전트입니다.
화면 이미지를 분석하고, 다음에 취해야 할 **단 하나의** 행동을 반드시 아래 JSON 형식으로 반환하세요.
절대로 JSON 이외의 내용을 응답에 포함하지 마세요.

사용 가능한 액션:
{"action": "click", "x": <int>, "y": <int>, "double": <bool>, "description": "<설명>"}
{"action": "right_click", "x": <int>, "y": <int>, "description": "<설명>"}
{"action": "type", "text": "<입력할 텍스트>", "description": "<설명>"}
{"action": "hotkey", "keys": ["<key1>", "<key2>"], "description": "<설명>"}
{"action": "key", "key": "<key>", "description": "<설명>"}
{"action": "scroll", "direction": "down|up", "amount": <int>, "description": "<설명>"}
{"action": "move", "x": <int>, "y": <int>, "description": "<설명>"}
{"action": "wait", "seconds": <float>, "description": "<설명>"}
{"action": "screenshot", "description": "화면을 다시 확인"}
{"action": "done", "description": "<목표 달성 요약>"}

규칙:
- 좌표는 실제 화면 픽셀 기준입니다.
- 목표가 완료되었다면 반드시 {"action": "done", ...} 을 반환하세요.
- 판단이 서지 않거나 화면을 다시 확인해야 할 때는 {"action": "screenshot", ...} 을 반환하세요.
"""


class GemmaAgent:
    """Wraps a Gemma 4 model for computer-control inference."""

    def __init__(self, model_key: str = "e4b"):
        self.model_key = model_key
        self.model_id = MODEL_IDS[model_key]
        self.model = None
        self.processor = None
        self._loaded = False

    # ------------------------------------------------------------------
    # Loading
    # ------------------------------------------------------------------

    def load(self) -> None:
        """Download and load the model (may take several minutes on first run)."""
        import torch
        from transformers import AutoProcessor, AutoModelForImageTextToText

        print(f"[IntelliEye] 모델 로딩 중: {self.model_id}")
        print("[IntelliEye] 처음 실행 시 HuggingFace에서 모델을 다운로드합니다 (수 GB, 시간이 걸릴 수 있습니다)...")

        self.processor = AutoProcessor.from_pretrained(self.model_id)

        # Use bfloat16 + 4-bit quantization when available to reduce VRAM usage
        try:
            from transformers import BitsAndBytesConfig

            bnb_config = BitsAndBytesConfig(
                load_in_4bit=True,
                bnb_4bit_use_double_quant=True,
                bnb_4bit_quant_type="nf4",
                bnb_4bit_compute_dtype=torch.bfloat16,
            )
            self.model = AutoModelForImageTextToText.from_pretrained(
                self.model_id,
                quantization_config=bnb_config,
                device_map="auto",
            )
            print("[IntelliEye] 4-bit 양자화로 모델 로드 완료")
        except Exception:
            # Fall back to standard float16 loading
            self.model = AutoModelForImageTextToText.from_pretrained(
                self.model_id,
                torch_dtype=torch.bfloat16,
                device_map="auto",
            )
            print("[IntelliEye] bfloat16으로 모델 로드 완료")

        self._loaded = True

    # ------------------------------------------------------------------
    # Inference
    # ------------------------------------------------------------------

    def decide_action(
        self,
        screen_image: Image.Image,
        goal: str,
        conversation_history: Optional[list] = None,
    ) -> dict:
        """Given a screen image and a goal, return the next action dict.

        Args:
            screen_image: Current screen as a PIL Image.
            goal: Natural-language description of the overall task.
            conversation_history: Optional list of previous (role, content) turns
                                  for multi-step context.

        Returns:
            A dict such as {"action": "click", "x": 100, "y": 200, "description": "..."}
        """
        if not self._loaded:
            raise RuntimeError("모델이 로드되지 않았습니다. load()를 먼저 호출하세요.")

        messages = [
            {
                "role": "system",
                "content": [{"type": "text", "text": SYSTEM_PROMPT}],
            }
        ]

        if conversation_history:
            messages.extend(conversation_history)

        messages.append(
            {
                "role": "user",
                "content": [
                    {"type": "image", "image": screen_image},
                    {
                        "type": "text",
                        "text": f"현재 목표: {goal}\n\n위 화면을 보고 다음 행동을 JSON으로 알려주세요.",
                    },
                ],
            }
        )

        inputs = self.processor.apply_chat_template(
            messages,
            add_generation_prompt=True,
            tokenize=True,
            return_dict=True,
            return_tensors="pt",
        ).to(self.model.device)

        import torch

        with torch.inference_mode():
            output_ids = self.model.generate(
                **inputs,
                max_new_tokens=256,
                do_sample=False,
            )

        input_len = inputs["input_ids"].shape[-1]
        generated_ids = output_ids[0][input_len:]
        raw_text = self.processor.decode(generated_ids, skip_special_tokens=True).strip()

        return self._parse_action(raw_text)

    def describe_screen(self, screen_image: Image.Image) -> str:
        """Ask the model to describe the current screen in natural language."""
        if not self._loaded:
            raise RuntimeError("모델이 로드되지 않았습니다. load()를 먼저 호출하세요.")

        messages = [
            {
                "role": "user",
                "content": [
                    {"type": "image", "image": screen_image},
                    {
                        "type": "text",
                        "text": "현재 화면에 무엇이 보이는지 간단히 한국어로 설명해주세요.",
                    },
                ],
            }
        ]

        inputs = self.processor.apply_chat_template(
            messages,
            add_generation_prompt=True,
            tokenize=True,
            return_dict=True,
            return_tensors="pt",
        ).to(self.model.device)

        import torch

        with torch.inference_mode():
            output_ids = self.model.generate(
                **inputs,
                max_new_tokens=256,
                do_sample=False,
            )

        input_len = inputs["input_ids"].shape[-1]
        generated_ids = output_ids[0][input_len:]
        return self.processor.decode(generated_ids, skip_special_tokens=True).strip()

    # ------------------------------------------------------------------
    # Helpers
    # ------------------------------------------------------------------

    @staticmethod
    def _parse_action(raw_text: str) -> dict:
        """Extract and parse a JSON action from the model's raw output."""
        # Try to find a JSON object in the response
        match = re.search(r"\{.*\}", raw_text, re.DOTALL)
        if match:
            try:
                return json.loads(match.group(0))
            except json.JSONDecodeError:
                pass

        # Fallback: ask for a fresh screenshot so the loop can retry
        return {
            "action": "screenshot",
            "description": f"JSON 파싱 실패, 화면 재확인 (원문: {raw_text[:120]})",
        }
