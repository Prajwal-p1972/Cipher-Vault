# Cipher Vault: Complete Setup Guide (Windows)

This document provides step-by-step instructions for installing, configuring, running, and testing Cipher Vault across all three subprojects: `backend/`, `frontend/`, and `ai-service/`.

---

## 1. Prerequisites

Before setting up Cipher Vault, verify the following tools are installed on your Windows host:

1. **Node.js 20+ & npm 10+**:
   - Download from [nodejs.org](https://nodejs.org/).
   - Confirm via terminal: `node -v` and `npm -v`.
2. **Python 3.10 - 3.12**:
   - Download from [python.org](https://python.org/).
   - Ensure "Add Python to PATH" was selected during installation.
   - Confirm via: `python --version`.
3. **MongoDB**:
   - Either run locally on Windows (service or manual `mongod.exe` listening on `127.0.0.1:27017`), or via Docker:
     ```powershell
     docker run -d --name cipher-mongo -p 27017:27017 mongo:7
     ```
4. **Ollama**:
   - Install via winget:
     ```powershell
     winget install Ollama.Ollama --accept-source-agreements --accept-package-agreements
     ```
   - Start Ollama server:
     ```powershell
     ollama serve
     ```
   - Pull the required LLaMA 3 model:
     ```powershell
     ollama pull llama3
     ```
   - Verify model presence:
     ```powershell
     ollama list
     ```

---

## 2. Environment Configuration

### A. Backend (`backend/.env`)

Create `backend/.env` based on `backend/.env.example`:

| Variable | Description | Default / Example Value |
| :--- | :--- | :--- |
| `NODE_ENV` | Application environment (`development`, `production`, `test`) | `development` |
| `PORT` | Local port for Express API server | `5000` |
| `MONGO_URI` | MongoDB connection connection string | `mongodb://127.0.0.1:27017/cipher_vault` |
| `CLIENT_ORIGIN` | Allowed client origin for CORS & Socket.io | `http://localhost:3000` |
| `JWT_ACCESS_SECRET` | Secret key used to sign access JWTs (minimum 32 chars) | Random 32+ character string |
| `JWT_REFRESH_SECRET` | Dedicated secret key for refresh tokens (minimum 32 chars) | Random 32+ character string |
| `MFA_ENC_KEY` | AES-256 key for encrypted TOTP secrets in DB (exact 64 hex chars) | 64-char hex string (32 bytes) |
| `AUDIT_HMAC_KEY` | HMAC-SHA256 key for append-only audit chain (minimum 32 chars) | Random 32+ character string |
| `RATE_LIMIT_MAX` | Global rate limit window cap per IP | `30` |
| `MAX_UPLOAD_BYTES` | Maximum allowed multipart upload payload size | `26214400` (25 MB) |
| `MAX_DECOMPRESSED_BYTES`| Maximum allowed decompressed payload size | `104857600` (100 MB) |
| `STORAGE_DRIVER` | Active blob storage driver: `memory`, `disk`, or `s3` | `disk` |
| `STORAGE_DIR` | Root directory for disk storage driver (git-ignored) | `./data/blobs` |
| `S3_BUCKET` | AWS / MinIO S3 bucket name (required if `STORAGE_DRIVER=s3`) | `cipher-vault-blobs` |
| `S3_REGION` | S3 region (required if `STORAGE_DRIVER=s3`) | `us-east-1` |
| `S3_ENDPOINT` | Custom S3 endpoint URL for local MinIO / LocalStack | `http://127.0.0.1:9000` |
| `GEO_MAX_ACCURACY_METERS`| Maximum GPS accuracy radius acceptable for geofenced unlock | `500` |
| `UNLOCK_MAX_PER_15MIN`| Maximum failed unlock attempts allowed per user per 15 minutes | `10` |

### B. Frontend (`frontend/.env.development`)

Create `frontend/.env.development`:

| Variable | Description | Value |
| :--- | :--- | :--- |
| `VITE_API_URL` | Base URL of the backend REST and Socket.io server | `http://localhost:5000` |
| `VITE_AI_URL` | Base URL of the local offline AI microservice | `http://127.0.0.1:8000` |

### C. AI Service (`ai-service/.env`)

The AI service defaults to secure loopback values without requiring manual `.env` changes. If customized, variables use the `CV_AI_` prefix:

| Variable | Description | Default |
| :--- | :--- | :--- |
| `CV_AI_HOST` | Loopback binding address (must be loopback) | `127.0.0.1` |
| `CV_AI_PORT` | Port for FastAPI service | `8000` |
| `CV_AI_ALLOWED_ORIGINS` | JSON array of permitted web client origins | `["http://localhost:3000"]` |
| `CV_AI_OLLAMA_URL` | Local loopback Ollama server endpoint | `http://127.0.0.1:11434` |
| `CV_AI_LLM_MODEL` | Ollama model name | `llama3` |
| `CV_AI_SESSION_TTL_SECONDS` | Inactivity lifetime of in-memory collection before reaping | `1800` (30 mins) |
| `CV_AI_MAX_CONTEXT_CHARS` | Character ceiling for document excerpt prompt fencing | `6000` |
| `CV_AI_MAX_CHATS_PER_MINUTE` | Rate limit for chat stream requests per session | `12` |

---

## 3. Storage Driver Selection

Configure `STORAGE_DRIVER` in `backend/.env`:

1. **`STORAGE_DRIVER=disk` (Recommended for Persistent Local Deployment)**:
   - Stores encrypted ciphertext blobs atomically in `STORAGE_DIR` (default `./data/blobs`).
   - Blobs are named `docs/<uuid>.bin` and protected with strict path traversal checks.
   - Survives server restarts and process restarts.
2. **`STORAGE_DRIVER=memory` (Recommended for Fast Ephemeral Testing)**:
   - Ciphertext buffers are held in memory with strict defensive copy-isolation.
   - All ciphertext is purged upon process exit.
3. **`STORAGE_DRIVER=s3` (Enterprise / S3-Compatible Storage)**:
   - Encrypted blobs are uploaded directly to an AWS S3 bucket or self-hosted MinIO instance.
   - Requires `S3_BUCKET` and `S3_REGION`.

---

## 4. Installation & Offline Model Caching

### Step 1: Install Backend Dependencies
```powershell
cd backend
npm install
```

### Step 2: Install Frontend Dependencies
```powershell
cd frontend
npm install
```

### Step 3: Install AI Service Dependencies & Pre-Fetch Models
```powershell
cd ai-service
python -m venv .venv
.\.venv\Scripts\pip install -r requirements.txt

# Run the model download helper to prime local cache:
cd ..
.\ai-service\.venv\Scripts\python.exe scripts\download_models.py
```

---

## 5. Starting All Services

To run the complete system, launch services in dedicated PowerShell windows:

### Window 1: MongoDB
```powershell
mongod --dbpath C:\data\db
# or: docker start cipher-mongo
```

### Window 2: Ollama LLM
```powershell
ollama serve
```

### Window 3: Backend API Server
```powershell
cd backend
npm run dev
# Server will listen on http://127.0.0.1:5000
```

### Window 4: Local AI Microservice
```powershell
cd ai-service
.\.venv\Scripts\python.exe run.py
# Uvicorn will listen on http://127.0.0.1:8000 in restricted mode (access_log=False)
```

### Window 5: Frontend SPA
```powershell
cd frontend
npm run dev
# Vite will serve UI on http://localhost:3000
```

*(Alternatively, use `scripts/start-all.ps1` to launch all windows automatically).*

---

## 6. Creating the First Administrator

Cipher Vault restricts system analytics and audit chain verification routes (`/api/analytics/system/*`) to users with the `admin` role.

1. Register a user in the UI at `http://localhost:3000/register` (e.g. `admin@vault.test`).
2. Complete initial login and MFA setup with Google Authenticator or an equivalent TOTP client.
3. Open `mongosh` in terminal:
   ```powershell
   mongosh mongodb://127.0.0.1:27017/cipher_vault
   ```
4. Promote the registered account to the `admin` role:
   ```javascript
   use cipher_vault;
   db.users.updateOne(
     { email: "admin@vault.test" },
     { $set: { role: "admin" } }
   );
   ```
5. Log out and log back in. The `/analytics/admin` page and Admin navigation link will now be active.

---

## 7. Verification & Running Test Suites

Execute all test suites from their respective project folders:

### Backend Tests
```powershell
cd backend
# Unit and security hardening tests:
npm test

# Phase E2E suites:
npm run test:e2e       # Phase 1: Auth, MFA, TOTP & Audit Hash Chain
npm run test:e2e:p2    # Phase 2: Crypto Engine, Multipart Upload & Storage
npm run test:e2e:p3    # Phase 3: Real-Time Socket.io Notifications
npm run test:e2e:p4    # Phase 4: Context-Gated Opening (MFA + Geofence + One-Time)
npm run test:e2e:p6    # Phase 6: Analytics & Chain Health
node --test test/e2e/diskStorage.e2e.js # Phase 6: Disk Storage Persistence
```

### Frontend Tests & Production Build
```powershell
cd frontend
npm test -- --run
npm run build
```

### AI Service Tests
```powershell
cd ai-service
.\.venv\Scripts\python.exe -m pytest -q
```
