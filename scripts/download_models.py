"""One-time offline model pre-fetcher for Cipher Vault AI Service.

Downloads and caches HuggingFace SentenceTransformer and EasyOCR weights
so that the ai-service can run strictly with HF_HUB_OFFLINE=1 and
TRANSFORMERS_OFFLINE=1 in air-gapped / offline deployments.
"""

import sys
import os

def main():
    print("[1/2] Pre-fetching SentenceTransformer model: all-MiniLM-L6-v2...")
    try:
        from sentence_transformers import SentenceTransformer
        model_name = "sentence-transformers/all-MiniLM-L6-v2"
        model = SentenceTransformer(model_name)
        print(f"      Successfully cached {model_name}.")
    except Exception as e:
        print(f"      Error caching SentenceTransformer: {e}", file=sys.stderr)
        sys.exit(1)

    print("[2/2] Pre-fetching EasyOCR language models (en)...")
    try:
        import easyocr
        reader = easyocr.Reader(["en"], gpu=False)
        print("      Successfully cached EasyOCR English model.")
    except Exception as e:
        print(f"      Error caching EasyOCR models: {e}", file=sys.stderr)
        sys.exit(1)

    print("\nModel pre-fetch complete. The AI microservice can now run in offline mode.")

if __name__ == "__main__":
    main()
