# Cipher Vault: Security Architecture & Threat Model

Cipher Vault is designed around zero-knowledge document confidentiality and context-gated authorization. This document outlines the assets protected, threat actors considered, mitigations implemented, and an honest account of current operational and technical limitations.

---

## 1. Assets Protected

1. **Document Plaintext & Ciphertext**:
   - Confidential documents (PDFs, images) transported across untrusted networks and stored on persistent disk or object storage.
2. **Document Decryption Keys**:
   - 256-bit AES-GCM encryption keys that grant access to document plaintext.
3. **User Authentication & Authorization Tokens**:
   - Scoped JWTs (access, refresh, challenge, setup) and encrypted TOTP secrets.
4. **Audit Log Trail**:
   - Cryptographic record of all administrative, authentication, and document access events.
5. **Private Q&A Queries & Inferences**:
   - User queries and AI model answers based on document contents.

---

## 2. Threat Actors & Mitigations

| Threat Actor | Capabilities | Mitigations Implemented |
| :--- | :--- | :--- |
| **Malicious / Compromised Database Administrator** | Full read/write access to MongoDB database collections. | Decryption keys and document plaintext are never written to MongoDB. Only encrypted metadata and envelope hashes are stored. Audit records are sealed using an external `AUDIT_HMAC_KEY` in an append-only chain; database modifications break chain verification. |
| **Network Eavesdropper / MitM** | Intercepts HTTP/WebSocket traffic between client and server. | Strict TLS transport, scoped JWT tokens, HTTP-only refresh cookies, and client-side payload encryption prior to network transmission. |
| **Unauthorized Recipient / Impersonator** | Possession of leaked account credentials. | Mandatory step-up TOTP verification with replay prevention (`lastUsedStep`) before ciphertext download. Account lockout after 5 consecutive failures. |
| **Untrusted / Remote Client (DNS Rebinding)** | Attempts to trick user's browser into querying local AI service. | AI microservice enforces loopback binding (`127.0.0.1`), validates Host headers against loopback, and rejects missing or foreign Origin headers. |
| **Prompt Injection / Hostile Document Author** | Embeds adversarial prompt commands inside document text to escape context fences or hijack LLM answers. | Prompt fencing with delimiter neutralization (`<<<EXCERPT>>>`), input validation blocking known injection triggers, lack of tool access, and plain-text DOM rendering. |

---

## 3. Honest Limitations & Operational Realities

Security engineering requires complete transparency regarding architectural boundaries and trade-offs. Cipher Vault operates with the following documented limitations:

1. **Browser Geolocation is Policy Control, Not Proof**:
   - Geofencing relies on the HTML5 Geolocation API (`navigator.geolocation`). Browser sensor values and GPS coordinates can be spoofed using browser developer tools, virtual location extensions, or modified browser builds. Geofencing acts as an environmental access policy, not a cryptographic boundary.
2. **Client-Side Display Capture (Screenshots / Photography)**:
   - Once a document is decrypted and rendered in the viewer, a recipient can take screenshots, record the screen, or photograph the physical monitor. Digital DRM cannot prevent analog hole attacks.
3. **Decrypted Plaintext in Memory**:
   - Plaintext resides in client browser RAM while the document viewer is open, and within the AI microservice's process memory during active Q&A sessions. While Python and JavaScript wipe references and purge ephemeral collections upon session close, garbage collection engines and OS paging cannot mathematically guarantee immediate zeroization of every allocated memory page.
4. **QR Key Transfer Depends on a Trusted Channel**:
   - The QR code contains the document decryption key. If a sender shares the QR code over an unencrypted or compromised communication channel (e.g., unencrypted email, public messaging), any unauthorized party who also satisfies the recipient's MFA could compromise document confidentiality.
5. **LLM Hallucinations and Document Influence**:
   - The local LLM (`llama3`) is generative and can produce inaccurate, incomplete, or biased statements. While Cipher Vault fences excerpts, provides citation page chips, disables tool use, and renders answers as inert plain text, users must verify critical facts against the cited source pages.
6. **Audit Tail Truncation**:
   - The HMAC-SHA256 audit chain guarantees that altered or inserted records are detected. However, if a malicious database administrator deletes records strictly from the tail of the chain (the most recent entries), detection is not possible without external anchoring (such as periodic external timestamping or ledger notarization).
7. **No Self-Service MFA Recovery Flow**:
   - If a user loses access to their TOTP authenticator device, there is currently no automated self-service recovery key mechanism. Resetting MFA requires administrative intervention directly at the database level.
8. **Single-Instance In-Memory Audit Queue**:
   - The sequential audit logger executes in-process to guarantee serial sequence numbering and chaining. Horizontally scaling the backend across multiple Node.js instances requires a distributed lock or centralized sequence worker.
9. **Zero-Cloud Guarantee Context**:
   - The claim of a "zero-cloud" architecture holds strictly when `STORAGE_DRIVER` is set to `disk` or a self-hosted S3-compatible service (e.g. MinIO), and when the local AI service is utilized. Configuring AWS S3 for storage routes ciphertext blobs to cloud infrastructure.
10. **Storage Mode Testing Scope**:
    - The memory and disk storage drivers (`STORAGE_DRIVER=memory` and `STORAGE_DRIVER=disk`) have been verified with complete unit and end-to-end integration test suites. The `s3` storage driver adapter was verified via unit mocking but has not undergone live cloud load testing against AWS infrastructure.
11. **No Third-Party Penetration Test**:
    - Cipher Vault has undergone rigorous internal security reviews, automated unit testing, E2E regression testing, and dependency audits. However, it has not yet been subjected to an independent third-party penetration test or formal cryptographic audit.
