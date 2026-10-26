"""In-memory optical character recognition using EasyOCR."""

import io
from typing import Any
import numpy as np
from PIL import Image
import easyocr

from app.config import get_settings
from app.schemas import ExtractionError, ExtractionLimitError

_reader_singleton: Any = None


def get_ocr_reader() -> easyocr.Reader:
    """Return initialized EasyOCR Reader singleton without runtime downloads."""
    global _reader_singleton
    if _reader_singleton is not None:
        return _reader_singleton

    settings = get_settings()
    try:
        _reader_singleton = easyocr.Reader(
            lang_list=settings.ocr_languages,
            gpu=settings.ocr_gpu,
            download_enabled=False
        )
        return _reader_singleton
    except Exception as exc:
        raise ExtractionError(
            "EasyOCR models are not available offline. "
            "Please run 'python scripts/download_models.py' to download model weights."
        ) from exc


def ocr_image_bytes(png_or_jpeg: bytes) -> str:
    """Run in-memory OCR on raw PNG or JPEG image bytes."""
    settings = get_settings()
    Image.MAX_IMAGE_PIXELS = settings.max_image_pixels

    try:
        with Image.open(io.BytesIO(png_or_jpeg)) as img:
            total_pixels = img.width * img.height
            if total_pixels > settings.max_image_pixels:
                raise ExtractionLimitError(
                    f"Image dimension ({img.width}x{img.height}) exceeds max_image_pixels limit."
                )
            rgb_img = img.convert("RGB")
            np_img = np.array(rgb_img)
    except ExtractionLimitError:
        raise
    except Exception as exc:
        raise ExtractionError("Failed to decode image bytes for OCR.") from exc

    reader = get_ocr_reader()
    try:
        text_lines = reader.readtext(np_img, detail=0)
        return " ".join(text_lines).strip()
    except Exception as exc:
        raise ExtractionError("OCR text extraction failed.") from exc
