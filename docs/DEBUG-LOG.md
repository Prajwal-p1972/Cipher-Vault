# Cipher Vault Debugging Log & Findings

This document tracks all findings, root causes, fixes, and verification proofs identified during the comprehensive full-system audit of Cipher Vault (`backend/`, `frontend/`, and `ai-service/`).

---

## Findings Table

| ID | Symptom | Evidence (Raw) | Root Cause (File:Line) | Fix | Proof |
|---|---|---|---|---|---|
| **F-01** | Live E2E script `scripts/e2e-live.mjs` failed during Check 8 envelope unwrapping with `DOMException [OperationError]: The operation failed for an operation-specific reason at AESCipherJob.onDone`. | `DOMException [OperationError]: The operation failed for an operation-specific reason at AESCipherJob.onDone { [cause]: [Error: Cipher job failed] }` | `scripts/e2e-live.mjs:86`. User registration endpoint `POST /api/auth/register` returns `{ user: { id, email, displayName, role } }`. The script accessed `regData.id` instead of `regData.user.id`, leaving `userB.id` as `undefined`. Consequently, the HKDF AAD string was constructed as `cipher-vault/keywrap/v1|...|undefined|...` instead of the actual receiver user ID string, causing an AAD mismatch that failed AES-GCM tag verification. | Updated line 86 to `u.id = regData.user?.id || regData.id;`. | Check 8 passed: `CHECK 8: PASS - Unwrapped key via WebCrypto; outside radius returns 403; inside radius returns 200 with identical bytes`. |
| **F-02** | Live E2E script `scripts/e2e-live.mjs` failed during Check 9 one-time document envelope unwrapping with `OperationError` at AESCipherJob. | `DOMException [OperationError]: The operation failed for an operation-specific reason at AESCipherJob.onDone` | `scripts/e2e-live.mjs:422`. In Check 9, the script reused the HKDF Initial Keying Material (`ikm`) derived from Check 8's document envelope rather than computing a new shared secret with the one-time document envelope's fresh ephemeral public key (`otEnvData.envelope.epk`). Because each wrapped envelope generates a fresh ephemeral ECDH key pair, reusing an old `ikm` produced an incorrect KEK. | Extracted standalone `unwrapKey(envelope, docId, receiverId, privateKey)` helper in `scripts/e2e-live.mjs` that imports each envelope's `epk`, computes a fresh shared secret via ECDH, derives the HKDF KEK, and decrypts the document key. Applied to both Check 8 and Check 9. | Check 9 passed: `CHECK 9: PASS - One-time document opened once (200), subsequent open returns 410 consumed`. |
| **F-03** | Test database isolation between backend daemon and test harness. | Backend initially connected to `mongodb://127.0.0.1:27017/cipher_vault`, while the test script required `mongodb://127.0.0.1:27017/cipher_vault_debug`. | `backend/.env` default `MONGO_URI` pointed to production/dev database `cipher_vault`. Testing against a running server with a separate database would cause direct DB mutations (e.g. promoting user A to admin) to miss the server's database. | Started the backend daemon with environment variable `MONGO_URI=mongodb://127.0.0.1:27017/cipher_vault_debug` so both the server and test suite operate on the isolated throw-away database. | Check 13 passed: `CHECK 13: PASS - Analytics overview (200) and admin audit chain verified (valid: true, checked: 35 entries)`, followed by clean teardown dropping `cipher_vault_debug`. |
| **F-04** | Ollama local inference service was not listening on loopback port 11434. | `Port 11434 : NOT IN USE` and `ollama --version` reported `could not connect to a running Ollama instance`. | Ollama background server (`ollama serve`) was not running prior to stack initialization. | Launched `ollama serve` daemon process. Verified `GET http://127.0.0.1:11434/api/tags` returned `llama3:latest`. | Port 11434 listening; all AI chat and live summary tests passed. |
| **F-05** | Dead code in frontend utils: `frontend/src/utils/cryptoBrowser.js`. | Grep across entire codebase showed zero imports of `cryptoBrowser.js`. | File was an obsolete pre-Phase 7 utility superseded by `frontend/src/crypto/vaultKeys.js`. | Removed `frontend/src/utils/cryptoBrowser.js`. Verified frontend tests (129/129) and production build succeed cleanly. | Zero references remaining; bundle size unaffected. |
| **F-06** | When receiver attempts to open a newly sent document, `UnlockModal.jsx` incorrectly fell back to the QR Scanner UI instead of triggering automated WebCrypto envelope unwrapping. | Receiver dashboard opened QR scanner for wrapped documents; `doc.delivery` was `undefined` in modal props. | 1. `frontend/src/hooks/useDocuments.js:16-32`: `normalizeDoc(item)` stripped `delivery: item.delivery || 'qr'`, causing all documents in `useDocuments()` to have `delivery: undefined`.<br>2. `frontend/src/components/UploadForm.jsx:118`: `handleEmailBlur` exited early if `delivery !== 'wrapped'`, failing to detect receiver vault keys if user was in QR mode, and `handleSubmit` didn't strictly enforce `delivery: 'wrapped'` when a receiver key was registered.<br>3. `frontend/src/components/UnlockModal.jsx`: Initialization and state machine did not robustly detect wrapped documents or provide legacy QR fallback hint. | 1. Added `delivery: item.delivery || 'qr'`, `hasGeofence`, and `keyEnvelope` to `useDocuments.js:normalizeDoc`.<br>2. Updated `UploadForm.jsx` to check receiver key on blur, auto-switch to and strictly enforce `delivery: 'wrapped'` in FormData upload payload when a receiver vault key is detected.<br>3. Hardened `UnlockModal.jsx` state machine: `isWrapped` evaluates `delivery`, `deliveryMode`, and envelope; wrapped docs strictly bypass QR scan directly to automated envelope unwrapping / TOTP prompt; added graceful fallback UI hint text to QR scanner screen: *"Note: This document was sealed using legacy QR mode before Vault Keys were established."* when user has a Vault Key. | Vitest frontend suite: **132 / 132 PASS** (23 files); production build passes in 16.45s with zero errors. |

---

## Verification Test Results

### 1. Backend Test Suites
- Unit & Service Tests (`npm test`): **121 / 121 PASS** (19 suites)
- Phase 1 E2E (`npm run test:e2e`): **18 / 18 PASS**
- Phase 2 E2E (`npm run test:e2e:p2`): **12 / 12 PASS**
- Phase 3 E2E (`npm run test:e2e:p3`): **4 / 4 PASS**
- Phase 4 E2E (`npm run test:e2e:p4`): **13 / 13 PASS**
- Phase 6 E2E (`npm run test:e2e:p6`): **21 / 21 PASS**
- Phase 7 E2E (`npm run test:e2e:p7`): **9 / 9 PASS**
- Disk Storage E2E (`npm run test:e2e:disk`): **1 / 1 PASS**

### 2. Frontend Test Suites
- Vitest Component & Unit Tests (`npm test`): **132 / 132 PASS** (23 files)
- Production Build (`npm run build`): **PASS** (Zero errors, Vite build completed in 16.45s)

### 3. AI Microservice Test Suites
- Fast Pytest (`pytest -q -m "not ocr and not slow and not llm"`): **169 PASS**, 3 deselected
- Heavy / Slow & Live Pytest (`pytest -q -m "llm or slow"`): **2 PASS**, 170 deselected
- Live Ollama Pytest (`pytest -q tests/test_llm_live.py`): **6 PASS**

### 4. Real HTTP End-to-End Test Suite (`scripts/e2e-live.mjs`)
- All 13 Live Checks: **13 / 
13 PASS**

