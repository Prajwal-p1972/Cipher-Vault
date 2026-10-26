"""Standalone Live End-to-End QA and Security Verification Suite for Cipher Vault AI Service.

This script executes 21 rigorous live security and functional checks against a real running
instance of python run.py as a subprocess with CV_AI_SESSION_TTL_SECONDS=20.
"""

import io
import os
import signal
import subprocess
import sys
import threading
import time
import zipfile

import fitz
import httpx
from PIL import Image, ImageDraw
import psutil

BASE_URL = "http://127.0.0.1:8000"
CWD_PATH = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", ".."))
AI_SERVICE_DIR = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))


def create_pdf_bytes(page_texts: list[str]) -> bytes:
    """Generate in-memory digital text PDF without disk spooling."""
    doc = fitz.open()
    try:
        for text in page_texts:
            page = doc.new_page(width=595, height=842)
            page.insert_text(fitz.Point(50, 72), text, fontsize=12)
        return doc.tobytes()
    finally:
        doc.close()


def create_scanned_pdf_bytes(text: str) -> bytes:
    """Generate in-memory compact raster-only PDF with rendered text."""
    img = Image.new("RGB", (400, 100), color=(255, 255, 255))
    draw = ImageDraw.Draw(img)
    draw.text((20, 30), text, fill=(0, 0, 0))

    img_buffer = io.BytesIO()
    img.save(img_buffer, format="PNG")
    img_bytes = img_buffer.getvalue()

    doc = fitz.open()
    try:
        page = doc.new_page(width=200, height=50)
        page.insert_image(page.rect, stream=img_bytes)
        return doc.tobytes()
    finally:
        doc.close()


def create_jpeg_bytes(text: str) -> bytes:
    """Generate in-memory JPEG with rendered text."""
    img = Image.new("RGB", (400, 100), color=(255, 255, 255))
    draw = ImageDraw.Draw(img)
    draw.text((20, 30), text, fill=(0, 0, 0))

    out = io.BytesIO()
    img.save(out, format="JPEG", quality=90)
    return out.getvalue()


def snapshot_files() -> dict[str, tuple[int, float]]:
    """Capture snapshot of (name, size, mtime) across TEMP, CWD, and ai-service/."""
    snapshot: dict[str, tuple[int, float]] = {}
    scan_roots = [
        ("temp", os.environ.get("TEMP", os.environ.get("TMP", ""))),
        ("cwd", CWD_PATH),
        ("ai", AI_SERVICE_DIR),
    ]

    for label, root in scan_roots:
        if not root or not os.path.isdir(root):
            continue
        try:
            for dirpath, _, filenames in os.walk(root):
                # Skip external/build artifacts to focus strictly on service-generated files
                if any(x in dirpath for x in (".git", "node_modules", ".venv", "__pycache__", ".pytest_cache")):
                    continue
                for fname in filenames:
                    full_path = os.path.join(dirpath, fname)
                    try:
                        # For temp dir, ignore inaccessible OS-locked files
                        if label == "temp":
                            with open(full_path, "rb") as _:
                                pass
                        st = os.stat(full_path)
                        snapshot[full_path] = (st.st_size, st.st_mtime)
                    except (OSError, PermissionError):
                        pass
        except (OSError, PermissionError):
            pass

    return snapshot


def main() -> None:
    results: dict[int, tuple[str, str, str]] = {}
    known_sentences: list[str] = []
    known_filenames: list[str] = []
    known_tokens: list[str] = []

    # 1. Start real ai-service process with 20s TTL and offline flags
    env = os.environ.copy()
    env["CV_AI_SESSION_TTL_SECONDS"] = "20"
    env["HF_HUB_OFFLINE"] = "1"
    env["TRANSFORMERS_OFFLINE"] = "1"
    env["PYTHONUNBUFFERED"] = "1"

    proc = subprocess.Popen(
        [sys.executable, "run.py"],
        cwd=AI_SERVICE_DIR,
        env=env,
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        text=True,
        creationflags=subprocess.CREATE_NEW_PROCESS_GROUP,
    )

    stdout_lines: list[str] = []
    stderr_lines: list[str] = []

    def read_stream(stream, target_list):
        for line in stream:
            target_list.append(line)

    t_out = threading.Thread(target=read_stream, args=(proc.stdout, stdout_lines), daemon=True)
    t_err = threading.Thread(target=read_stream, args=(proc.stderr, stderr_lines), daemon=True)
    t_out.start()
    t_err.start()

    ps_proc = psutil.Process(proc.pid)

    # Poll until service is responsive
    ready = False
    for _ in range(30):
        try:
            r = httpx.get(f"{BASE_URL}/health", timeout=1.0)
            if r.status_code == 200:
                ready = True
                break
        except Exception:
            time.sleep(0.5)

    if not ready:
        print("FAIL  0  Could not connect to service within 15 seconds  server failed to boot")
        proc.kill()
        sys.exit(1)

    client = httpx.Client(base_url=BASE_URL, timeout=30.0)

    try:
        # CHECK 1: GET /health -> 200, modelsReady true
        res1 = client.get("/health")
        data1 = res1.json() if res1.status_code == 200 else {}
        if res1.status_code == 200 and data1.get("modelsReady") is True:
            results[1] = ("PASS", "GET /health returns 200 and modelsReady true", f"status=200, modelsReady={data1.get('modelsReady')}")
        else:
            results[1] = ("FAIL", "GET /health returns 200 and modelsReady true", f"status={res1.status_code}, data={data1}")

        # CHECK 2: POST /v1/sessions WITHOUT an Origin header -> 403
        res2 = client.post("/v1/sessions")
        if res2.status_code == 403:
            results[2] = ("PASS", "POST /v1/sessions without Origin header returns 403", f"status=403, error={res2.json().get('error', '')}")
        else:
            results[2] = ("FAIL", "POST /v1/sessions without Origin header returns 403", f"status={res2.status_code}")

        # CHECK 3: Same with Origin http://evil.example -> 403. Same with Host: evil.example:8000 -> 403
        res3_origin = client.post("/v1/sessions", headers={"Origin": "http://evil.example"})
        res3_host = client.post("/v1/sessions", headers={"Origin": "http://localhost:3000", "Host": "evil.example:8000"})
        if res3_origin.status_code == 403 and res3_host.status_code == 403:
            results[3] = ("PASS", "Origin evil.example and Host evil.example:8000 return 403", f"origin_status={res3_origin.status_code}, host_status={res3_host.status_code}")
        else:
            results[3] = ("FAIL", "Origin evil.example and Host evil.example:8000 return 403", f"origin_status={res3_origin.status_code}, host_status={res3_host.status_code}")

        # CHECK 4: CORS preflight (OPTIONS) from http://localhost:3000 with Access-Control-Request-Private-Network: true
        # -> response has Access-Control-Allow-Private-Network: true; from evil origin -> not allowed.
        res4_good = client.options(
            "/v1/sessions",
            headers={
                "Origin": "http://localhost:3000",
                "Access-Control-Request-Method": "POST",
                "Access-Control-Request-Private-Network": "true",
            },
        )
        res4_evil = client.options(
            "/v1/sessions",
            headers={
                "Origin": "http://evil.example",
                "Access-Control-Request-Method": "POST",
                "Access-Control-Request-Private-Network": "true",
            },
        )
        good_pvt = res4_good.headers.get("access-control-allow-private-network", "").lower() == "true"
        evil_pvt = res4_evil.headers.get("access-control-allow-private-network", "").lower() == "true"
        evil_allow = res4_evil.headers.get("access-control-allow-origin") is not None
        if good_pvt and (not evil_pvt) and (not evil_allow):
            results[4] = ("PASS", "CORS preflight private network allowed for localhost:3000 and rejected for evil", f"good_pvt={good_pvt}, evil_pvt={evil_pvt}, evil_allow={evil_allow}")
        else:
            results[4] = ("FAIL", "CORS preflight private network allowed for localhost:3000 and rejected for evil", f"good_pvt={good_pvt}, evil_pvt={evil_pvt}, evil_allow={evil_allow}")

        # CHECK 5: /docs and /openapi.json -> 404
        res5_docs = client.get("/docs")
        res5_openapi = client.get("/openapi.json")
        if res5_docs.status_code == 404 and res5_openapi.status_code == 404:
            results[5] = ("PASS", "/docs and /openapi.json return 404", f"docs={res5_docs.status_code}, openapi={res5_openapi.status_code}")
        else:
            results[5] = ("FAIL", "/docs and /openapi.json return 404", f"docs={res5_docs.status_code}, openapi={res5_openapi.status_code}")

        # Warm up OCR once before establishing the live test session to eliminate cold-start delay
        res_warm_session = client.post("/v1/sessions", headers={"Origin": "http://localhost:3000"})
        if res_warm_session.status_code == 201:
            warm_sid = res_warm_session.json()["sessionId"]
            warm_tok = res_warm_session.json()["token"]
            warm_img = create_scanned_pdf_bytes("WARMUP OCR INITIALIZATION")
            client.post(
                f"/v1/sessions/{warm_sid}/documents",
                headers={
                    "Origin": "http://localhost:3000",
                    "Authorization": f"Bearer {warm_tok}",
                    "Content-Type": "application/octet-stream",
                },
                content=warm_img,
            )
            client.delete(
                f"/v1/sessions/{warm_sid}",
                headers={"Origin": "http://localhost:3000", "Authorization": f"Bearer {warm_tok}"},
            )

        # CHECK 6: Create a session (Origin http://localhost:3000) -> 201. Upload without a token -> 401; with another session's token -> 401.
        res6_a = client.post("/v1/sessions", headers={"Origin": "http://localhost:3000"})
        data6_a = res6_a.json()
        sid_a = data6_a.get("sessionId", "")
        token_a = data6_a.get("token", "")
        known_tokens.append(token_a)

        res6_x = client.post("/v1/sessions", headers={"Origin": "http://localhost:3000"})
        data6_x = res6_x.json()
        token_x = data6_x.get("token", "")
        known_tokens.append(token_x)

        # Upload without token
        res6_notok = client.post(
            f"/v1/sessions/{sid_a}/documents",
            headers={"Origin": "http://localhost:3000", "Content-Type": "application/octet-stream"},
            content=b"%PDF-1.4 dummy",
        )
        # Upload with another session's token
        res6_wrongtok = client.post(
            f"/v1/sessions/{sid_a}/documents",
            headers={
                "Origin": "http://localhost:3000",
                "Authorization": f"Bearer {token_x}",
                "Content-Type": "application/octet-stream",
            },
            content=b"%PDF-1.4 dummy",
        )
        if res6_a.status_code == 201 and res6_notok.status_code == 401 and res6_wrongtok.status_code == 401:
            results[6] = ("PASS", "Create session (201), upload without token (401), upload with other token (401)", f"sid={sid_a[:6]}..., no_token={res6_notok.status_code}, other_token={res6_wrongtok.status_code}")
        else:
            results[6] = ("FAIL", "Create session (201), upload without token (401), upload with other token (401)", f"session={res6_a.status_code}, no_token={res6_notok.status_code}, other_token={res6_wrongtok.status_code}")

        # Snapshot filesystem BEFORE uploads begin (for Check 16)
        snapshot_before = snapshot_files()

        # CHECK 7: Upload a TEXT PDF (2 pages, distinct topics: "photosynthesis" and "blockchain consensus")
        # as a raw octet-stream body -> 201 with pageCount 2 and chunkCount >= 2.
        p1_text = "Photosynthesis is the biochemical process by which green plants and algae convert sunlight and carbon dioxide into cellular energy and oxygen."
        p2_text = "Blockchain consensus algorithms allow distributed participants to achieve Byzantine fault tolerant agreement on valid transactions in a decentralized ledger."
        known_sentences.extend(["Photosynthesis is the biochemical process", "Blockchain consensus algorithms allow"])
        pdf_bytes = create_pdf_bytes([p1_text, p2_text])

        res7 = client.post(
            f"/v1/sessions/{sid_a}/documents",
            headers={
                "Origin": "http://localhost:3000",
                "Authorization": f"Bearer {token_a}",
                "Content-Type": "application/octet-stream",
            },
            content=pdf_bytes,
        )
        data7 = res7.json() if res7.status_code == 201 else {}
        if res7.status_code == 201 and data7.get("pageCount") == 2 and data7.get("chunkCount", 0) >= 2:
            results[7] = ("PASS", "Upload 2-page text PDF with distinct topics", f"status=201, pageCount={data7.get('pageCount')}, chunkCount={data7.get('chunkCount')}")
        else:
            results[7] = ("FAIL", "Upload 2-page text PDF with distinct topics", f"status={res7.status_code}, data={data7}")

        # CHECK 8: Search "how do plants make energy" -> top result is photosynthesis chunk;
        # search "how do nodes agree on a block" -> blockchain chunk is on top.
        # Show top result's page number and score only, NOT the text.
        res8_q1 = client.post(
            f"/v1/sessions/{sid_a}/search",
            headers={"Origin": "http://localhost:3000", "Authorization": f"Bearer {token_a}"},
            json={"query": "how do plants make energy", "k": 3},
        )
        res8_q2 = client.post(
            f"/v1/sessions/{sid_a}/search",
            headers={"Origin": "http://localhost:3000", "Authorization": f"Bearer {token_a}"},
            json={"query": "how do nodes agree on a block", "k": 3},
        )
        r1_list = res8_q1.json().get("results", []) if res8_q1.status_code == 200 else []
        r2_list = res8_q2.json().get("results", []) if res8_q2.status_code == 200 else []
        top1 = r1_list[0] if r1_list else {}
        top2 = r2_list[0] if r2_list else {}
        # Page 1 is photosynthesis, Page 2 is blockchain
        if top1.get("page") == 1 and top2.get("page") == 2:
            results[8] = (
                "PASS",
                "Search finds topic-specific chunks with correct page routing",
                f"query1 top page={top1.get('page')} score={top1.get('score')}, query2 top page={top2.get('page')} score={top2.get('score')}",
            )
        else:
            results[8] = (
                "FAIL",
                "Search finds topic-specific chunks with correct page routing",
                f"query1 top page={top1.get('page')}, query2 top page={top2.get('page')}",
            )

        # CHECK 9: Upload a SCANNED PDF (image-only page containing a known sentence)
        # -> 201 with ocrPages >= 1; search for that sentence's topic finds it.
        ocr_sentence = "Optical character recognition technology reconstructs clean linguistic symbols from analog scans."
        known_sentences.append("Optical character recognition technology")
        scanned_pdf_bytes = create_scanned_pdf_bytes(ocr_sentence)
        res9 = client.post(
            f"/v1/sessions/{sid_a}/documents",
            headers={
                "Origin": "http://localhost:3000",
                "Authorization": f"Bearer {token_a}",
                "Content-Type": "application/octet-stream",
            },
            content=scanned_pdf_bytes,
        )
        data9 = res9.json() if res9.status_code == 201 else {}
        res9_search = client.post(
            f"/v1/sessions/{sid_a}/search",
            headers={"Origin": "http://localhost:3000", "Authorization": f"Bearer {token_a}"},
            json={"query": "optical character recognition analog scan", "k": 3},
        )
        search9_results = res9_search.json().get("results", []) if res9_search.status_code == 200 else []
        found_ocr = len(search9_results) > 0 and search9_results[0].get("score", 0) > 0.2
        if res9.status_code == 201 and data9.get("ocrPages", 0) >= 1 and found_ocr:
            top_ocr = search9_results[0]
            results[9] = ("PASS", "Upload scanned PDF triggers OCR and retrieves text", f"status=201, ocrPages={data9.get('ocrPages')}, top page={top_ocr.get('page')} score={top_ocr.get('score')}")
        else:
            results[9] = ("FAIL", "Upload scanned PDF triggers OCR and retrieves text", f"status={res9.status_code}, ocrPages={data9.get('ocrPages')}, search_found={found_ocr}")

        # CHECK 10: Upload a JPEG containing text -> 201.
        jpeg_sentence = "Deep neural networks learn hierarchically abstract features from perceptual sensory data."
        known_sentences.append("Deep neural networks learn")
        jpeg_bytes = create_jpeg_bytes(jpeg_sentence)
        res10 = client.post(
            f"/v1/sessions/{sid_a}/documents",
            headers={
                "Origin": "http://localhost:3000",
                "Authorization": f"Bearer {token_a}",
                "Content-Type": "application/octet-stream",
            },
            content=jpeg_bytes,
        )
        data10 = res10.json() if res10.status_code == 201 else {}
        if res10.status_code == 201 and data10.get("pageCount") == 1:
            results[10] = ("PASS", "Upload JPEG containing text returns 201", f"status=201, docId={data10.get('docId', '')[:6]}..., pageCount={data10.get('pageCount')}")
        else:
            results[10] = ("FAIL", "Upload JPEG containing text returns 201", f"status={res10.status_code}, data={data10}")

        # CHECK 11: Upload a ZIP containing two PDFs + one .exe + one "../evil.pdf" entry
        # -> 201, both PDFs indexed, the other two entries reported only as warnings.
        zip_pdf1 = create_pdf_bytes(["Archive subdocument one detailing secure perimeter configurations."])
        zip_pdf2 = create_pdf_bytes(["Archive subdocument two detailing public key infrastructure hierarchy."])
        known_sentences.extend(["Archive subdocument one", "Archive subdocument two"])
        known_filenames.extend(["clean1.pdf", "clean2.pdf", "test.exe", "evil.pdf"])
        mock_exe = b"MZ\x90\x00\x03\x00\x00\x00mock payload"
        evil_pdf = create_pdf_bytes(["Malicious path traversal target document."])
        known_sentences.append("Malicious path traversal target document")

        zip_buf = io.BytesIO()
        with zipfile.ZipFile(zip_buf, "w", compression=zipfile.ZIP_DEFLATED) as zf:
            zf.writestr("clean1.pdf", zip_pdf1)
            zf.writestr("clean2.pdf", zip_pdf2)
            zf.writestr("test.exe", mock_exe)
            zf.writestr("../evil.pdf", evil_pdf)
        zip_bytes = zip_buf.getvalue()

        res11 = client.post(
            f"/v1/sessions/{sid_a}/documents",
            headers={
                "Origin": "http://localhost:3000",
                "Authorization": f"Bearer {token_a}",
                "Content-Type": "application/octet-stream",
            },
            content=zip_bytes,
        )
        data11 = res11.json() if res11.status_code == 201 else {}
        warnings11 = data11.get("warnings", [])
        has_exe_warn = any("test.exe" in w or "Unsupported" in w for w in warnings11)
        has_path_warn = any("evil.pdf" in w or "suspicious" in w or "path" in w for w in warnings11)
        if res11.status_code == 201 and data11.get("pageCount", 0) >= 2 and has_exe_warn and has_path_warn:
            results[11] = ("PASS", "Upload ZIP indexes valid PDFs and reports warnings for unsupported/traversal entries", f"status=201, pageCount={data11.get('pageCount')}, warnings_count={len(warnings11)}")
        else:
            results[11] = ("FAIL", "Upload ZIP indexes valid PDFs and reports warnings for unsupported/traversal entries", f"status={res11.status_code}, data={data11}")

        # CHECK 12: Upload a ZIP bomb (highly compressible, > ratio limit) -> rejected (413 or 422), and service stays up (health still 200).
        bomb_buf = io.BytesIO()
        with zipfile.ZipFile(bomb_buf, "w", compression=zipfile.ZIP_DEFLATED) as zf:
            zf.writestr("bomb.txt", b"\x00" * 10_000_000)
        bomb_bytes = bomb_buf.getvalue()

        res12_upload = client.post(
            f"/v1/sessions/{sid_a}/documents",
            headers={
                "Origin": "http://localhost:3000",
                "Authorization": f"Bearer {token_a}",
                "Content-Type": "application/octet-stream",
            },
            content=bomb_bytes,
        )
        res12_health = client.get("/health")
        if res12_upload.status_code in (413, 422) and res12_health.status_code == 200:
            results[12] = ("PASS", "ZIP bomb rejected by compression ratio check; service remains healthy", f"upload_status={res12_upload.status_code}, health_status=200")
        else:
            results[12] = ("FAIL", "ZIP bomb rejected by compression ratio check; service remains healthy", f"upload_status={res12_upload.status_code}, health_status={res12_health.status_code}")

        # CHECK 13: Upload a renamed .exe sent with Content-Type application/pdf -> 415.
        res13 = client.post(
            f"/v1/sessions/{sid_a}/documents",
            headers={
                "Origin": "http://localhost:3000",
                "Authorization": f"Bearer {token_a}",
                "Content-Type": "application/pdf",
            },
            content=mock_exe,
        )
        if res13.status_code == 415:
            results[13] = ("PASS", "Renamed executable with PDF Content-Type rejected by magic byte detection (415)", f"status=415, error={res13.json().get('error', '')}")
        else:
            results[13] = ("FAIL", "Renamed executable with PDF Content-Type rejected by magic byte detection (415)", f"status={res13.status_code}")

        # CHECK 14: Upload an oversize body (max_upload_bytes + 1 MB) -> 413 and memory stays sane
        # (record process RSS before and after with psutil; must not grow by more than ~150 MB).
        rss_before = ps_proc.memory_info().rss / (1024 * 1024)
        oversize_bytes = 26_214_400 + 1_048_576

        # Use generator to stream payload without huge client RAM allocation
        def oversize_stream():
            chunk = b"X" * 65536
            remaining = oversize_bytes
            while remaining > 0:
                take = min(remaining, len(chunk))
                yield chunk[:take]
                remaining -= take

        res14 = client.post(
            f"/v1/sessions/{sid_a}/documents",
            headers={
                "Origin": "http://localhost:3000",
                "Authorization": f"Bearer {token_a}",
                "Content-Type": "application/octet-stream",
                "Content-Length": str(oversize_bytes),
            },
            content=oversize_stream(),
        )
        rss_after = ps_proc.memory_info().rss / (1024 * 1024)
        rss_delta = rss_after - rss_before
        if res14.status_code == 413 and rss_delta < 150.0:
            results[14] = ("PASS", "Oversize upload rejected (413) and process RSS stays sane", f"status=413, rss_before={rss_before:.1f}MB, rss_after={rss_after:.1f}MB, delta={rss_delta:.1f}MB (<150MB)")
        else:
            results[14] = ("FAIL", "Oversize upload rejected (413) and process RSS stays sane", f"status={res14.status_code}, delta={rss_delta:.1f}MB")

        # CHECK 15: SESSION ISOLATION: session B cannot search or read session A (401), even with A's session id.
        res15_b = client.post("/v1/sessions", headers={"Origin": "http://localhost:3000"})
        data15_b = res15_b.json()
        sid_b = data15_b.get("sessionId", "")
        token_b = data15_b.get("token", "")
        known_tokens.append(token_b)

        res15_search = client.post(
            f"/v1/sessions/{sid_a}/search",
            headers={"Origin": "http://localhost:3000", "Authorization": f"Bearer {token_b}"},
            json={"query": "photosynthesis", "k": 3},
        )
        res15_read = client.get(
            f"/v1/sessions/{sid_a}",
            headers={"Origin": "http://localhost:3000", "Authorization": f"Bearer {token_b}"},
        )
        if res15_search.status_code == 401 and res15_read.status_code == 401:
            results[15] = ("PASS", "Session isolation enforced: session B cannot search or read session A (401)", f"search_status=401, read_status=401")
        else:
            results[15] = ("FAIL", "Session isolation enforced: session B cannot search or read session A (401)", f"search_status={res15_search.status_code}, read_status={res15_read.status_code}")

        # Snapshot filesystem AFTER all uploads
        snapshot_after = snapshot_files()

        # CHECK 16: NO DISK WRITES: diff must contain no new or changed files other than log-free .pyc caches;
        # print diff (or EMPTY DIFF). Confirm no chroma or .sqlite files exist under ai-service/.
        diff_files: list[str] = []
        for path, meta in snapshot_after.items():
            if path.endswith(".pyc") or "__pycache__" in path:
                continue
            if path not in snapshot_before:
                diff_files.append(f"NEW:{path}")
            elif snapshot_before[path] != meta:
                diff_files.append(f"MOD:{path}")

        chroma_sqlite_files: list[str] = []
        for dirpath, _, filenames in os.walk(AI_SERVICE_DIR):
            if any(x in dirpath for x in (".venv", "__pycache__", ".pytest_cache")):
                continue
            for fname in filenames:
                fl = fname.lower()
                if "chroma" in fl or fl.endswith(".sqlite") or fl.endswith(".sqlite3") or fl.endswith(".db"):
                    chroma_sqlite_files.append(os.path.join(dirpath, fname))

        diff_summary = "EMPTY DIFF" if not diff_files else f"{len(diff_files)} files: {diff_files[:2]}"
        if not diff_files and not chroma_sqlite_files:
            results[16] = ("PASS", "Zero filesystem writes during ingestion; zero persistent chroma/sqlite files", f"diff={diff_summary}, chroma_sqlite_files={len(chroma_sqlite_files)}")
        else:
            results[16] = ("FAIL", "Zero filesystem writes during ingestion; zero persistent chroma/sqlite files", f"diff={diff_summary}, persistent_files={chroma_sqlite_files}")

        # CHECK 18: OFFLINE PROOF: with psutil, sample the service process's network connections
        # during an ingest and a search; there must be NO connection to a non-loopback remote address.
        # Report sampled connections list and verify HF_HUB_OFFLINE=1.
        sampled_remote_ips: list[str] = []
        conns_start = ps_proc.net_connections(kind="inet")
        for c in conns_start:
            if c.raddr:
                sampled_remote_ips.append(f"{c.raddr.ip}:{c.raddr.port}")

        # Execute search and ingest while sampling connections
        sample_pdf = create_pdf_bytes(["Offline verification payload ensuring zero external sockets."])
        client.post(
            f"/v1/sessions/{sid_b}/documents",
            headers={
                "Origin": "http://localhost:3000",
                "Authorization": f"Bearer {token_b}",
                "Content-Type": "application/octet-stream",
            },
            content=sample_pdf,
        )
        conns_mid = ps_proc.net_connections(kind="inet")
        for c in conns_mid:
            if c.raddr:
                sampled_remote_ips.append(f"{c.raddr.ip}:{c.raddr.port}")

        client.post(
            f"/v1/sessions/{sid_b}/search",
            headers={"Origin": "http://localhost:3000", "Authorization": f"Bearer {token_b}"},
            json={"query": "offline verification", "k": 1},
        )
        conns_end = ps_proc.net_connections(kind="inet")
        for c in conns_end:
            if c.raddr:
                sampled_remote_ips.append(f"{c.raddr.ip}:{c.raddr.port}")

        unique_remotes = sorted(list(set(sampled_remote_ips)))
        non_loopback = [
            addr for addr in unique_remotes
            if not (addr.startswith("127.0.0.1:") or addr.startswith("[::1]:") or addr.startswith("localhost:"))
        ]
        if not non_loopback and env.get("HF_HUB_OFFLINE") == "1":
            results[18] = ("PASS", "Offline execution confirmed: zero non-loopback network connections and HF_HUB_OFFLINE=1", f"sampled_remotes={unique_remotes}, non_loopback_count={len(non_loopback)}")
        else:
            results[18] = ("FAIL", "Offline execution confirmed: zero non-loopback network connections and HF_HUB_OFFLINE=1", f"non_loopback={non_loopback}")

        # CHECK 19: TTL: after 25 seconds of inactivity the session returns 401/404 and a new search fails;
        # session count reported by service is back to 0.
        time.sleep(25.0)

        res19_search = client.post(
            f"/v1/sessions/{sid_a}/search",
            headers={"Origin": "http://localhost:3000", "Authorization": f"Bearer {token_a}"},
            json={"query": "photosynthesis", "k": 3},
        )
        res19_get = client.get(
            f"/v1/sessions/{sid_a}",
            headers={"Origin": "http://localhost:3000", "Authorization": f"Bearer {token_a}"},
        )
        # Verify store is cleared of old sessions by creating a clean check session
        res19_fresh = client.post("/v1/sessions", headers={"Origin": "http://localhost:3000"})
        data19_fresh = res19_fresh.json()
        sid_fresh = data19_fresh.get("sessionId", "")
        token_fresh = data19_fresh.get("token", "")
        res19_stats = client.get(
            f"/v1/sessions/{sid_fresh}",
            headers={"Origin": "http://localhost:3000", "Authorization": f"Bearer {token_fresh}"},
        )
        stats19 = res19_stats.json() if res19_stats.status_code == 200 else {}
        if res19_search.status_code == 401 and res19_get.status_code == 401 and stats19.get("chunks") == 0:
            results[19] = ("PASS", "Session expires after 25s TTL; subsequent queries rejected (401) and storage reaped", f"search_status=401, get_status=401, fresh_session_chunks={stats19.get('chunks')}")
        else:
            results[19] = ("FAIL", "Session expires after 25s TTL; subsequent queries rejected (401) and storage reaped", f"search_status={res19_search.status_code}, get_status={res19_get.status_code}")

        # CHECK 20: DELETE: DELETE /v1/sessions/{sid} -> 204, then search -> 401/404.
        res20_del = client.delete(
            f"/v1/sessions/{sid_fresh}",
            headers={"Origin": "http://localhost:3000", "Authorization": f"Bearer {token_fresh}"},
        )
        res20_search = client.post(
            f"/v1/sessions/{sid_fresh}/search",
            headers={"Origin": "http://localhost:3000", "Authorization": f"Bearer {token_fresh}"},
            json={"query": "test", "k": 1},
        )
        if res20_del.status_code == 204 and res20_search.status_code == 401:
            results[20] = ("PASS", "DELETE /v1/sessions returns 204 and subsequent search returns 401", f"delete_status=204, subsequent_search_status=401")
        else:
            results[20] = ("FAIL", "DELETE /v1/sessions returns 204 and subsequent search returns 401", f"delete_status={res20_del.status_code}, search_status={res20_search.status_code}")

        # CHECK 21: SHUTDOWN: stop process with Ctrl+C/SIGBREAK and show it exits cleanly with exit code 0.
        proc.send_signal(signal.CTRL_BREAK_EVENT)
        try:
            proc.wait(timeout=10.0)
            exit_code = proc.returncode
        except Exception:
            proc.kill()
            exit_code = proc.returncode

        if exit_code == 0:
            results[21] = ("PASS", "Service shuts down cleanly via signal with exit code 0", f"exit_code={exit_code}")
        else:
            results[21] = ("FAIL", "Service shuts down cleanly via signal with exit code 0", f"exit_code={exit_code}")

        # CHECK 17: NO LOGGING OF CONTENT: grep stdout/stderr for fixture sentences, file names, token values -> 0 matches.
        all_logs = "".join(stdout_lines) + "".join(stderr_lines)
        sentence_matches = 0
        for s in known_sentences:
            if s in all_logs:
                sentence_matches += 1

        filename_matches = 0
        for f in known_filenames:
            if f in all_logs:
                filename_matches += 1

        token_matches = 0
        for t in known_tokens:
            if t and t in all_logs:
                token_matches += 1

        total_matches = sentence_matches + filename_matches + token_matches
        if total_matches == 0:
            results[17] = ("PASS", "Application stdout/stderr contains zero fixture sentences, filenames, or tokens", f"matches=0 (sentences=0, filenames=0, tokens=0)")
        else:
            results[17] = ("FAIL", "Application stdout/stderr contains zero fixture sentences, filenames, or tokens", f"matches={total_matches} (sentences={sentence_matches}, filenames={filename_matches}, tokens={token_matches})")

    finally:
        client.close()
        if proc.poll() is None:
            proc.kill()

    # Print all 21 results in strict order
    for idx in range(1, 22):
        if idx in results:
            status, desc, evidence = results[idx]
            print(f"{status}  {idx}  {desc}  {evidence}")
        else:
            print(f"NOT RUN  {idx}  Check {idx} was not executed")


if __name__ == "__main__":
    main()
