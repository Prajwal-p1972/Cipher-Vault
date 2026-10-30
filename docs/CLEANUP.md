# Implementation Consolidation & Architecture Cleanup

This document details the consolidation of overlapping and duplicate implementations in **Cipher Vault** into a single, hardened, zero-trust codebase path.

---

## 1. Executive Summary

Two parallel development paths previously coexisted in the repository:
1. An unhardened, streaming AWS S3 / socket path that bypassed cryptographic key-wrapping, audit logging, and concurrency control.
2. The designed, hardened zero-cloud cryptographic pipeline featuring AES-256-GCM, ECDH P-256 public-key wrapping, multi-factor authentication (TOTP), HMAC tamper-evident hash chaining, room-isolated WebSockets with expiry timers, and unified fetch client single-flight token rotation.

This cleanup consolidates all frontend and backend interactions onto **ONE secure code path**, eliminating all dead code, redundant wrappers, and duplicate interceptors.

---

## 2. Inventory of Removed Files

| File | Category | Rationale |
|---|---|---|
| `backend/app.js` | Legacy Root | Duplicate, unmounted root-level Express application superseded by `backend/src/app.js`. |
| `backend/server.js` | Legacy Root | Duplicate root-level server entry point superseded by `backend/src/server.js`. |
| `backend/src/routes/documentRoutes.js` | Backend Route Wrapper | Thin wrapper that exposed `POST /upload` (bypassing envelope key-wrapping, Zod validation, and audit chaining) while forwarding other routes to `documents.js`. Removed in favor of mounting `src/routes/documents.js` directly at `/api/documents`. |
| `backend/src/services/storageService.js` | Storage Service | Old direct streaming S3 upload/download service that bypassed the pluggable storage drivers (`memory`, `disk`, `s3`) in `src/services/storage/`. |
| `backend/src/utils/cryptoStream.js` | Crypto Utility | Streaming cipher/decipher used exclusively by `storageService.js`. Replaced by zero-memory-leak cryptographic primitives in `src/services/crypto/cryptoEngine.js`. |
| `backend/src/config/aws.js` | AWS Client | Obsolete AWS S3 client wrapper for old streaming upload. The hardened S3 driver is implemented in `src/services/storage/s3Storage.js`. |
| `backend/src/config/socket.js` | Socket Server | Unhardened Socket.io initialization with single-socket mapping per user (disconnecting multi-tab sessions), lacking user room isolation, ping rate limiting, origin verification, and token expiry teardown. Replaced by `src/realtime/socketServer.js`. |
| `backend/src/routes/authRoutes.js` | Backend Route | Duplicate auth router with out-of-date schema validators and unmaintained controller exports (`getMe`). Active routes reside in `src/routes/auth.js`. |
| `backend/src/routes/auditRoutes.js` | Backend Route | Duplicate audit router not mounted in the application. Active audit routes reside in `src/routes/audit.js`. |
| `backend/src/middleware/validate.js` | Middleware | Unused request body validation middleware used only by `authRoutes.js`. Active controllers validate payloads directly using Zod. |
| `backend/src/middleware/rateLimiter.js` | Middleware | Redundant rate limiter used only by `authRoutes.js`. Active limiter resides in `src/middleware/rateLimit.js`. |
| `backend/src/middleware/role.js` | Middleware | Redundant role check middleware imported only by `auditRoutes.js`. Active implementation resides in `src/middleware/auth.js` (`requireRole`). |
| `backend/src/middleware/errorHandler.js` | Middleware | Legacy error handling middleware imported only by root `backend/app.js`. Active centralized error handler is in `src/middleware/error.js`. |
| `backend/test/configSocket.test.js` | Test Suite | 4 unit tests for deleted `config/socket.js`. The live Socket.io server is exhaustively tested in `test/socket.test.js` and `test/e2e/phase3.e2e.js`. |
| `backend/test/storage.test.js` | Test Suite | 10 unit tests for deleted `cryptoStream.js`, `storageService.js`, and `config/aws.js`. Cryptographic operations and storage drivers are tested in `test/cryptoEngine.test.js` and `test/storageDrivers.test.js`. |
| `frontend/src/api/axios.js` | API Client | Secondary HTTP client with separate Axios 401 interceptor. Replaced by unified `src/api/http.js`. |
| `frontend/src/context/AuthContext.jsx` | React Context | Unused duplicate context that relied on `axios.js`. Active auth context resides in `src/auth/AuthContext.jsx`. |
| `frontend/src/context/SocketContext.jsx` | React Context | Unused duplicate context that relied on `axios.js`. Active socket context resides in `src/realtime/SocketContext.jsx`. |

---

## 3. Inventory of Modified Files

| File | Key Changes Made |
|---|---|
| `backend/src/app.js` | Mounted `routes/documents.js` directly at `/api/documents`. Removed import and mount of wrapper `documentRoutes.js`. |
| `backend/src/server.js` | Switched from `config/socket.js` (`initSocket`, `closeSocket`) to `realtime/socketServer.js` (`initSocketServer`, `closeSocketServer`). Connected sockets now use hardened room isolation and expiry timers. |
| `backend/src/controllers/documentController.js` | Removed `uploadDocument` export and associated unused imports (`busboy`, `createEncryptionStream`, `uploadEncryptedStream`, `audit`, `notifyUser`). Retained `createDocument` with Phase 7 key wrapping, `getKeyEnvelope`, `listSent`, `listReceived`, `getMeta`, and `openDocument`. |
| `backend/src/config/env.js` | Made obsolete streaming AWS variables (`AWS_REGION`, `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY`, `AWS_S3_BUCKET_NAME`) optional. Verified that storage driver configuration reads `STORAGE_DRIVER`, `STORAGE_DIR`, `S3_BUCKET`, `S3_REGION`, and `S3_ENDPOINT`. |
| `backend/.env.example` | Documented that legacy `AWS_S3_BUCKET_NAME` is obsolete and NOT used. Specified the correct variables: `STORAGE_DRIVER`, `STORAGE_DIR`, `S3_BUCKET`, `S3_REGION`, and `S3_ENDPOINT`. |
| `frontend/src/components/AuditDashboard.jsx` | Migrated from `api/axios.js` to `api/http.js` (`request('/api/audit/me')`). Eliminated Axios errors on token expiry and integrated with universal single-flight refresh. |
| `frontend/src/api/http.js` | Removed `setAxiosToken` / `getAxiosToken` sync calls and simplified `getAccessToken()`, `setAccessToken()`, and `clearAccessToken()` to pure in-memory state. |
| `frontend/src/api/http.test.js` | Added integration test proving five concurrent 401 responses (including from `AuditDashboard` `/api/audit/me`) result in exactly one `/api/auth/refresh` request and five successful retries. |
| `frontend/package.json` | Removed unused `"axios"` dependency. |

---

## 4. Test Verification & Counts

### Backend Tests
- **Unit & Integration (`npm test`)**: 121 / 121 passing (19 test suites).
  - *Count delta*: 135 -> 121 (-14 tests). Exactly 14 tests were deleted because they tested removed duplicate code: 10 tests in `test/storage.test.js` and 4 tests in `test/configSocket.test.js`.
- **Phase 1 E2E (`npm run test:e2e`)**: 18 / 18 passing.
- **Phase 2 E2E (`npm run test:e2e:p2`)**: 12 / 12 passing.
- **Phase 3 E2E (`npm run test:e2e:p3`)**: 4 / 4 passing.
- **Phase 4 E2E (`npm run test:e2e:p4`)**: 13 / 13 passing.
- **Phase 6 E2E (`npm run test:e2e:p6`)**: 21 / 21 passing.
- **Phase 7 E2E (`npm run test:e2e:p7`)**: 9 / 9 passing.
- **Disk Storage E2E (`npm run test:e2e:disk`)**: 1 / 1 passing.

### Frontend Tests
- **Vitest (`npm test`)**: 109 / 109 passing (21 test files).
  - *Count delta*: 108 -> 109 (+1 test). Added concurrent 401 refresh verification for `AuditDashboard`.
- **Production Build (`npm run build`)**: Vite production build succeeded cleanly with zero errors.

### AI Service Tests
- **Pytest (`.\venv\Scripts\python -m pytest -q -m "not ocr and not slow and not llm"`)**: 169 passed, 3 deselected.
