# Cipher Vault

Cipher Vault is a zero-knowledge, context-gated document distribution and offline AI analysis platform. Documents are encrypted client-side using AES-256-GCM before transport; the backend never stores or accesses document decryption keys or plaintext contents. Access is gated by step-up TOTP multi-factor authentication, cryptographic QR verification, optional browser geofencing, and one-time viewing enforcement. Documents can then be analyzed entirely offline through a local, loopback-bound AI microservice running OCR, sentence embeddings, in-memory vector retrieval, and local LLM inference via Ollama.

---

## Architecture Overview

```mermaid
flowchart TD
    subgraph ClientBrowser [Browser Client (React SPA)]
        Sender[Sender Session]
        Receiver[Receiver Session]
        RAMDecrypt[In-Memory RAM Decryption Blob URL]
        LocalAIChatUI[Plain-Text Local AI Q&A Panel]
    end

    subgraph BackendInfrastructure [Cipher Vault Backend (Node.js / Express)]
        API[REST API & Auth Gates]
        SocketServer[Socket.io Real-Time Hub]
        HMACChain[(Append-Only HMAC-SHA256 Audit Chain)]
        MongoDB[(MongoDB: Metadata & Identity Only)]
        StorageDriver[Storage Driver: Disk / Memory / S3]
    end

    subgraph OfflineAIService [Local AI Service (FastAPI / 127.0.0.1:8000)]
        Ingest[Extractor: PyMuPDF / EasyOCR]
        Embeddings[SentenceTransformers: all-MiniLM-L6-v2]
        Chroma[Ephemeral In-Memory ChromaDB Collection]
        PromptSanitizer[Prompt Fence & Injection Filter]
        Ollama[Local Ollama: llama3 via 127.0.0.1:11434]
    end

    Sender -->|1. Multipart Upload & AES-256-GCM Seal| API
    API -->|Store Ciphertext Only| StorageDriver
    API -->|Persist Policy & Hash Chain| MongoDB
    API -->|2. Real-Time Push Notification| SocketServer
    SocketServer -->|Notify Incoming Sealed Doc| Receiver
    Sender -.->|3. Out-of-Band Key Exchange: QR Code| Receiver

    Receiver -->|4. Unlock Request: Key + TOTP + Geocoords| API
    API -->|Validate MFA, Geofence & One-Time Status| API
    API -->|5. Stream Raw Ciphertext| Receiver
    Receiver -->|6. Client-side Decrypt to RAM| RAMDecrypt

    RAMDecrypt -->|7. Send Raw Bytes over Loopback (Bearer Session)| Ingest
    Ingest --> Embeddings --> Chroma
    LocalAIChatUI -->|8. SSE Streaming Q&A over Loopback| PromptSanitizer
    PromptSanitizer --> Ollama
```

---

## End-to-End Data Flow

1. **Client-Side Seal**:
   - The sender uploads a PDF, PNG, or JPEG.
   - The backend validates MIME type and file structure, generates an envelope key, encrypts the document with AES-256-GCM, and persists the raw ciphertext to the configured storage driver (`disk`, `memory`, or `s3`).
   - The document decryption key is returned once to the sender and is never saved in the database or server logs.
2. **Real-Time Notification**:
   - A `document:sealed` real-time event is emitted across isolated Socket.io rooms to the recipient's authenticated session.
3. **Out-of-Band QR Key Transfer**:
   - The sender exports an air-gapped QR code containing the document ID and AES decryption key to share with the recipient over a trusted, out-of-band channel.
4. **Context-Gated Unlock (MFA + Geofence)**:
   - The recipient scans or uploads the QR code and requests document unlock.
   - The recipient must supply an active TOTP step-up code (with replay prevention across time windows).
   - If configured, high-accuracy GPS coordinates are validated against a circular bounding geofence.
5. **In-RAM Decryption & Blob Rendering**:
   - The server streams the raw ciphertext blob with `Cache-Control: no-store`.
   - The browser decrypts the payload in memory using Web Crypto APIs and mounts a local `blob:` URL inside an isolated document viewer.
   - If designated as `oneTimeView`, the server deletes the ciphertext from storage immediately upon first access.
6. **Offline AI Document Chat**:
   - Decrypted bytes can be analyzed with the offline AI microservice.
   - The client creates a short-lived ephemeral session on `http://127.0.0.1:8000` and posts the decrypted bytes.
   - Document pages are extracted via PyMuPDF or EasyOCR, chunked, embedded using a local SentenceTransformer model, and indexed in an ephemeral in-memory ChromaDB collection.
   - Q&A turns are streamed over Server-Sent Events (SSE) using a local Ollama instance (`llama3`).
   - The client strictly renders model answers as inert plain text, displaying citation page chips.
   - Upon closing the viewer, the active chat is aborted, the AI session and collection are purged, and the Blob URL is revoked.

---

## Repository Structure

```text
Cipher-2/
├── backend/                  # Node.js Express API & Security Services
│   ├── src/
│   │   ├── config/           # Environment validation (Zod) & DB connection
│   │   ├── controllers/      # Auth, document, and analytics controllers
│   │   ├── middleware/       # Auth, rate limiting, and upload guards
│   │   ├── models/           # Mongoose schemas: User, Document, AuditLog
│   │   ├── realtime/         # Socket.io notification server
│   │   ├── routes/           # REST endpoints
│   │   ├── services/         # Audit chaining, crypto engine, storage adapters
│   │   └── utils/            # JWT, TOTP, and error utilities
│   └── test/                 # Unit, hardening, and Phase 1-6 E2E integration suites
├── frontend/                 # React 18 SPA (Vite)
│   ├── src/
│   │   ├── api/              # Backend HTTP and local AI streaming client
│   │   ├── auth/             # Authentication & MFA context provider
│   │   ├── components/       # DocumentViewer, ChatPanel, QrScanner, ChartCards
│   │   ├── hooks/            # useChat, useLocalAi, useAnalytics, useDocuments
│   │   ├── pages/            # Dashboard, Analytics, AdminAnalytics, Login
│   │   └── utils/            # QR payload decoding & browser geolocation
│   └── dist/                 # Production static bundle
├── ai-service/               # Python FastAPI Offline Microservice
│   ├── app/
│   │   ├── extraction/       # PyMuPDF and EasyOCR pipeline
│   │   ├── llm/              # Ollama client, safety filters, prompt fences
│   │   ├── chunking.py       # Deterministic text chunker
│   │   ├── config.py         # Loopback URL & model validation
│   │   ├── embeddings.py     # SentenceTransformer cache wrapper
│   │   ├── ingest.py         # Dispatcher and ingestion controller
│   │   ├── security.py       # DNS rebinding middleware & origin guards
│   │   ├── sessions.py       # Ephemeral session manager with TTL reaper
│   │   └── vectorstore.py    # Ephemeral in-memory ChromaDB wrapper
│   ├── tests/                # Live LLM, security, safety, and ingestion tests
│   └── run.py                # Restricted loopback launcher (access_log=False)
├── docs/                     # Detailed guides: SETUP.md, DEMO.md, SECURITY.md
├── scripts/                  # Automated orchestration helpers (start-all.ps1)
└── README.md                 # Primary documentation
```

---

## Quick Start (Development)

### 1. Prerequisites
- Node.js 20+
- Python 3.10 - 3.12
- MongoDB running locally on `127.0.0.1:27017`
- Ollama running locally with `llama3` pulled (`ollama serve` & `ollama pull llama3`)

### 2. Backend Setup
```powershell
cd backend
npm install
cp .env.example .env
npm run dev
```

### 3. AI Service Setup
```powershell
cd ai-service
python -m venv .venv
.\.venv\Scripts\pip install -r requirements.txt
python run.py
```

### 4. Frontend Setup
```powershell
cd frontend
npm install
npm run dev
```

Visit `http://localhost:3000` to interact with Cipher Vault.
For production cloud deployment instructions on Render & Vercel with MongoDB Atlas, see [DEPLOYMENT.md](DEPLOYMENT.md).
For detailed configuration steps, testing procedures, and security configurations, consult [SETUP.md](docs/SETUP.md).
