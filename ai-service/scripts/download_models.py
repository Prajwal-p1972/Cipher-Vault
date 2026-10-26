"""One-time online model weight download and pre-caching utility.

This script executes the online initialization step to download:
1. EasyOCR English recognition and detection models into ~/.EasyOCR/model.
2. sentence-transformers/all-MiniLM-L6-v2 embedding weights into Hugging Face hub cache.

After running this script once, the Cipher Vault AI microservice operates in
strictly air-gapped, offline mode with HF_HUB_OFFLINE=1 and TRANSFORMERS_OFFLINE=1.
"""

import os
import sys
from pathlib import Path

# Ensure Windows terminal handles UTF-8 block characters in download progress bars
if sys.platform == "win32":
    if hasattr(sys.stdout, "reconfigure"):
        sys.stdout.reconfigure(encoding="utf-8")
    if hasattr(sys.stderr, "reconfigure"):
        sys.stderr.reconfigure(encoding="utf-8")


def download_all_models() -> None:
    """Download required weights and verify local offline readiness."""
    print("=== Cipher Vault AI Service: One-Time Model Download ===")

    # 1. EasyOCR English Models
    print("\n[1/2] Downloading EasyOCR models (English detection + recognition)...")
    try:
        import easyocr
        easyocr_cache = Path.home() / ".EasyOCR" / "model"
        reader = easyocr.Reader(["en"], gpu=False, download_enabled=True, verbose=False)
        print(f"✓ EasyOCR models successfully downloaded to: {easyocr_cache}")
    except Exception as exc:
        print(f"✗ Failed to download EasyOCR models: {exc}", file=sys.stderr)
        raise

    # 2. SentenceTransformer Embedding Model
    model_name = "sentence-transformers/all-MiniLM-L6-v2"
    print(f"\n[2/2] Downloading SentenceTransformer weights ({model_name})...")
    try:
        from sentence_transformers import SentenceTransformer
        hf_cache = os.environ.get("HF_HOME", str(Path.home() / ".cache" / "huggingface"))
        model = SentenceTransformer(model_name)
        # Verify model inference
        test_vector = model.encode("Cipher Vault secure offline verification.")
        print(f"✓ Embedding model verified ({len(test_vector)} dimensions).")
        print(f"✓ Model weights stored under: {hf_cache}")
    except Exception as exc:
        print(f"✗ Failed to download embedding model: {exc}", file=sys.stderr)
        raise

    print("\n=== Model Pre-caching Complete ===")
    print("The AI microservice can now run completely offline.")


if __name__ == "__main__":
    download_all_models()
