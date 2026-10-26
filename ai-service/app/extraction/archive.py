"""In-memory ZIP archive extraction with strict decompression bomb and path traversal defenses."""

import io
import os
import zipfile

from app.config import get_settings
from app.extraction.image import extract_image
from app.extraction.pdf import extract_pdf
from app.schemas import (
    ExtractionError,
    ExtractionLimitError,
    ExtractionResult,
    PageText,
)

ARCHIVE_EXTENSIONS = {".zip", ".tar", ".gz", ".bz2", ".7z", ".rar", ".xz"}
SUPPORTED_EXTENSIONS = {".pdf", ".jpg", ".jpeg", ".txt"}


def extract_zip(data: bytes) -> ExtractionResult:
    """Extract supported documents from an in-memory ZIP archive under strict security bounds."""
    settings = get_settings()

    try:
        zf = zipfile.ZipFile(io.BytesIO(data))
    except Exception as exc:
        raise ExtractionError("Corrupted or invalid ZIP archive.") from exc

    with zf:
        infolist = zf.infolist()
        if len(infolist) > settings.zip_max_entries:
            raise ExtractionLimitError(
                f"ZIP entry count ({len(infolist)}) exceeds limit of {settings.zip_max_entries}."
            )

        # 1. Inspect declared attributes before reading any compressed streams
        total_declared_uncompressed = 0
        for info in infolist:
            if info.is_dir():
                continue

            # Reject encrypted entries
            if bool(info.flag_bits & 0x1):
                raise ExtractionError("Encrypted ZIP archive entries are not permitted.")

            # Per-entry declared size check
            if info.file_size > settings.zip_max_entry_bytes:
                raise ExtractionLimitError(
                    f"ZIP entry declared size ({info.file_size} bytes) exceeds maximum "
                    f"entry limit of {settings.zip_max_entry_bytes} bytes."
                )

            total_declared_uncompressed += info.file_size

            # Compression ratio check (zip bomb defense)
            if info.compress_size > 0:
                ratio = info.file_size / info.compress_size
                if ratio > settings.zip_max_ratio:
                    raise ExtractionLimitError(
                        f"ZIP entry compression ratio ({ratio:.1f}) exceeds maximum ratio of {settings.zip_max_ratio}."
                    )

        if total_declared_uncompressed > settings.zip_max_total_bytes:
            raise ExtractionLimitError(
                f"Total declared uncompressed size ({total_declared_uncompressed} bytes) "
                f"exceeds limit of {settings.zip_max_total_bytes} bytes."
            )

        # 2. Extract allowed entries strictly in memory with real-time stream length counting
        all_pages: list[PageText] = []
        warnings: list[str] = []
        total_ocr_pages = 0
        total_actual_bytes_read = 0

        for info in infolist:
            raw_filename = info.filename

            if info.is_dir() or raw_filename.endswith("/"):
                continue

            # Path traversal and format sanitization
            if (
                ".." in raw_filename
                or raw_filename.startswith("/")
                or raw_filename.startswith("\\")
                or "\\" in raw_filename
            ):
                warnings.append(f"Skipped suspicious or malformed entry path in archive: {os.path.basename(raw_filename)}")
                continue

            basename = os.path.basename(raw_filename)
            _, ext = os.path.splitext(basename.lower())

            # Nested archive rejection
            if ext in ARCHIVE_EXTENSIONS:
                warnings.append(f"Nested archive skipped: {basename}")
                continue

            # Whitelist supported extensions
            if ext not in SUPPORTED_EXTENSIONS:
                warnings.append(f"Unsupported file type skipped in archive: {basename}")
                continue

            # Stream read with hard chunk limits to defend against deceptive declared sizes
            entry_bytes_io = io.BytesIO()
            with zf.open(info) as entry_file:
                entry_read = 0
                while True:
                    chunk = entry_file.read(65536)
                    if not chunk:
                        break
                    entry_read += len(chunk)
                    total_actual_bytes_read += len(chunk)

                    if entry_read > settings.zip_max_entry_bytes:
                        raise ExtractionLimitError(
                            f"Entry exceeded maximum uncompressed size of {settings.zip_max_entry_bytes} bytes."
                        )
                    if total_actual_bytes_read > settings.zip_max_total_bytes:
                        raise ExtractionLimitError(
                            f"Archive exceeded total uncompressed size of {settings.zip_max_total_bytes} bytes."
                        )

                    entry_bytes_io.write(chunk)

            entry_data = entry_bytes_io.getvalue()

            # Process supported file content
            if ext == ".pdf":
                res = extract_pdf(entry_data, source=basename)
                all_pages.extend(res.pages)
                warnings.extend(res.warnings)
                total_ocr_pages += res.ocr_pages
            elif ext in {".jpg", ".jpeg"}:
                res = extract_image(entry_data, source=basename)
                all_pages.extend(res.pages)
                warnings.extend(res.warnings)
                total_ocr_pages += res.ocr_pages
            elif ext == ".txt":
                text = entry_data.decode("utf-8", errors="replace").strip()
                all_pages.append(
                    PageText(
                        page=1,
                        text=text,
                        source=basename,
                        ocr=False
                    )
                )

        return ExtractionResult(
            pages=all_pages,
            warnings=warnings,
            page_count=len(all_pages),
            ocr_pages=total_ocr_pages
        )
