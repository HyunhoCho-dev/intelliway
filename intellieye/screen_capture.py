"""
screen_capture.py — IntelliEye Screen Capture Module
Made by Hyunho Cho

Captures the current screen and converts it to a format
suitable for Gemma 4 model input.
"""

import io
import base64
from PIL import Image

try:
    import mss
    _MSS_AVAILABLE = True
except ImportError:
    _MSS_AVAILABLE = False

try:
    from PIL import ImageGrab
    _IMAGEGRAB_AVAILABLE = True
except ImportError:
    _IMAGEGRAB_AVAILABLE = False


def capture_screen() -> Image.Image:
    """Capture the current screen and return a PIL Image."""
    if _MSS_AVAILABLE:
        with mss.mss() as sct:
            monitor = sct.monitors[0]
            screenshot = sct.grab(monitor)
            img = Image.frombytes(
                "RGB",
                (screenshot.width, screenshot.height),
                screenshot.rgb,
            )
            return img
    elif _IMAGEGRAB_AVAILABLE:
        return ImageGrab.grab()
    else:
        raise RuntimeError(
            "No screen capture backend available. "
            "Install 'mss' or 'Pillow' (ImageGrab)."
        )


def capture_screen_base64(max_width: int = 1280) -> str:
    """Capture the screen and return a base64-encoded PNG string.

    The image is optionally downscaled so that the model receives
    a reasonably sized input without exceeding memory limits.
    """
    img = capture_screen()

    # Downscale if the image is wider than max_width
    if img.width > max_width:
        ratio = max_width / img.width
        new_size = (max_width, int(img.height * ratio))
        img = img.resize(new_size, Image.LANCZOS)

    buffer = io.BytesIO()
    img.save(buffer, format="PNG")
    return base64.b64encode(buffer.getvalue()).decode("utf-8")


def capture_screen_bytes(max_width: int = 1280) -> bytes:
    """Capture the screen and return raw PNG bytes."""
    img = capture_screen()

    if img.width > max_width:
        ratio = max_width / img.width
        new_size = (max_width, int(img.height * ratio))
        img = img.resize(new_size, Image.LANCZOS)

    buffer = io.BytesIO()
    img.save(buffer, format="PNG")
    return buffer.getvalue()
