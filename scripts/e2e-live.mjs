/**
 * Cipher Vault Live End-to-End Verification Script (scripts/e2e-live.mjs)
 * Executes against live, running microservices with zero mocks.
 * Uses real HTTP fetch, speakeasy TOTP, WebCrypto ECDH unwrapping, and Socket.io client.
 */

import crypto from 'node:crypto';
import mongoose from '../backend/node_modules/mongoose/index.js';
import speakeasy from '../backend/node_modules/speakeasy/index.js';
import { io } from '../backend/node_modules/socket.io-client/build/esm/index.js';

const BACKEND_URL = process.env.BACKEND_URL || 'http://localhost:5000';
const AI_URL = process.env.AI_URL || 'http://127.0.0.1:8000';
const BROWSER_ORIGIN = 'http://localhost:3000';
const MONGO_URI = process.env.MONGO_URI || 'mongodb://127.0.0.1:27017/cipher_vault_debug';

// Helper: base64url encode/decode
function b64urlEncode(buf) {
  return Buffer.from(buf).toString('base64url');
}
function b64urlDecode(str) {
  return Buffer.from(str, 'base64url');
}

// Helper: unwrap ECDH P-256 key envelope via WebCrypto
async function unwrapKey(envelope, docId, receiverId, privateKey) {
  const epkBytes = b64urlDecode(envelope.epk);
  const saltBytes = b64urlDecode(envelope.salt);
  const ivBytes = b64urlDecode(envelope.iv);
  const ctBytes = b64urlDecode(envelope.ct);

  const epkKey = await crypto.subtle.importKey(
    'raw',
    epkBytes,
    { name: 'ECDH', namedCurve: 'P-256' },
    false,
    []
  );
  const sharedBits = await crypto.subtle.deriveBits(
    { name: 'ECDH', public: epkKey },
    privateKey,
    256
  );
  const ikm = await crypto.subtle.importKey(
    'raw',
    sharedBits,
    'HKDF',
    false,
    ['deriveKey']
  );
  const infoStr = `cipher-vault/keywrap/v1|${docId}|${receiverId}|${envelope.recipientKeyId}`;
  const infoBytes = new TextEncoder().encode(infoStr);

  const kek = await crypto.subtle.deriveKey(
    {
      name: 'HKDF',
      hash: 'SHA-256',
      salt: saltBytes,
      info: infoBytes
    },
    ikm,
    { name: 'AES-GCM', length: 256 },
    false,
    ['decrypt']
  );

  const decryptedKeyBytes = await crypto.subtle.decrypt(
    { name: 'AES-GCM', iv: ivBytes, additionalData: infoBytes },
    kek,
    ctBytes
  );
  return b64urlEncode(decryptedKeyBytes);
}

// Helper: track last used TOTP step per user to ensure each code is from a strictly newer step
const userLastStep = new Map();

async function getFreshTotpCode(userKey, secretBase32) {
  const stepSeconds = 30;
  const lastStep = userLastStep.get(userKey) || 0;
  while (true) {
    const now = Math.floor(Date.now() / 1000);
    const currentStep = Math.floor(now / stepSeconds);
    if (currentStep > lastStep) {
      userLastStep.set(userKey, currentStep);
      return speakeasy.totp({ secret: secretBase32, encoding: 'base32', time: now });
    }
    const remaining = stepSeconds - (now % stepSeconds);
    console.log(`[TOTP] Waiting ${remaining + 1}s for next 30s window for ${userKey}...`);
    await new Promise((resolve) => setTimeout(resolve, (remaining + 1) * 1000));
  }
}

// Small valid test PDF with known content
const SAMPLE_PDF = Buffer.from(
  '%PDF-1.4\n1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n' +
  '2 0 obj\n<< /Type /Pages /Kids [3 0 R] /Count 1 >>\nendobj\n' +
  '3 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>\nendobj\n' +
  '4 0 obj\n<< /Length 135 >>\nstream\n' +
  'BT\n/F1 20 Tf\n80 720 Td\n(Cipher Vault Live Test Document) Tj\n0 -35 Td\n/F1 14 Tf\n(Project Apollo is scheduled for launch on December 15.) Tj\nET\nendstream\nendobj\n' +
  '5 0 obj\n<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>\nendobj\nxref\n0 6\n0000000000 65535 f \n' +
  '0000000009 00000 n \n0000000058 00000 n \n0000000115 00000 n \n0000000244 00000 n \n0000000432 00000 n \n' +
  'trailer\n<< /Size 6 /Root 1 0 R >>\nstartxref\n510\n%%EOF'
);

async function run() {
  console.log('===============================================================');
  console.log('   CIPHER VAULT: LIVE REAL-HTTP END-TO-END VERIFICATION');
  console.log('===============================================================\n');

  let dbConnection = null;
  const runId = Date.now();

  try {
    dbConnection = await mongoose.connect(MONGO_URI);
    console.log(`[Setup] Connected to database: ${MONGO_URI}`);

    // State holders
    const userA = { email: `sender_a_${runId}@example.com`, name: 'Sender Alice', password: 'CorrectHorseBattery99!' };
    const userB = { email: `receiver_b_${runId}@example.com`, name: 'Receiver Bob', password: 'CorrectHorseBattery99!' };
    const userC = { email: `third_c_${runId}@example.com`, name: 'Third Party Charlie', password: 'CorrectHorseBattery99!' };

    // -------------------------------------------------------------
    // CHECK 1: Register users A (sender), B (receiver), and C
    // -------------------------------------------------------------
    for (const u of [userA, userB, userC]) {
      const regRes = await fetch(`${BACKEND_URL}/api/auth/register`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: u.email, displayName: u.name, password: u.password })
      });
      const regData = await regRes.json();
      if (regRes.status !== 201) {
        throw new Error(`Registration failed for ${u.email}: HTTP ${regRes.status} ${JSON.stringify(regData)}`);
      }
      u.id = regData.user?.id || regData.id;
    }
    console.log('CHECK 1: PASS - Registered users A, B, and C (HTTP 201 for all)');

    // -------------------------------------------------------------
    // CHECK 2: Login -> setup token
    // -------------------------------------------------------------
    for (const u of [userA, userB, userC]) {
      const logRes = await fetch(`${BACKEND_URL}/api/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: u.email, password: u.password })
      });
      const logData = await logRes.json();
      if (logRes.status !== 200 || logData.status !== 'MFA_SETUP_REQUIRED' || !logData.setupToken) {
        throw new Error(`Login failed for ${u.email}: HTTP ${logRes.status} ${JSON.stringify(logData)}`);
      }
      u.setupToken = logData.setupToken;
    }
    console.log('CHECK 2: PASS - Login returns status MFA_SETUP_REQUIRED with setupToken');

    // -------------------------------------------------------------
    // CHECK 3: MFA enrol and confirm for both (wait for fresh TOTP step)
    // -------------------------------------------------------------
    for (const u of [userA, userB, userC]) {
      const setupRes = await fetch(`${BACKEND_URL}/api/auth/mfa/setup`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${u.setupToken}` }
      });
      const setupData = await setupRes.json();
      if (setupRes.status !== 200 || !setupData.manualEntryKey) {
        throw new Error(`MFA setup failed for ${u.email}: HTTP ${setupRes.status}`);
      }
      u.totpSecret = setupData.manualEntryKey;

      const code = await getFreshTotpCode(u.email, u.totpSecret);
      const enableRes = await fetch(`${BACKEND_URL}/api/auth/mfa/enable`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${u.setupToken}`
        },
        body: JSON.stringify({ code })
      });
      const enableData = await enableRes.json();
      if (enableRes.status !== 200 || !enableData.accessToken) {
        throw new Error(`MFA enable failed for ${u.email}: HTTP ${enableRes.status} ${JSON.stringify(enableData)}`);
      }
      u.accessToken = enableData.accessToken;
      // Wait at least 1s between users so TOTP step does not clash if tested concurrently
      await new Promise((r) => setTimeout(r, 1000));
    }
    console.log('CHECK 3: PASS - MFA enrolled and confirmed for users with fresh TOTP steps');

    // -------------------------------------------------------------
    // CHECK 4: B registers a vault key (PUT /api/keys/me with fresh code)
    // -------------------------------------------------------------
    // Generate ECDH P-256 key pair in WebCrypto
    const bKeyPair = await crypto.subtle.generateKey(
      { name: 'ECDH', namedCurve: 'P-256' },
      true, // extractable for testing/unwrapping
      ['deriveKey', 'deriveBits']
    );
    const bRawPublic = await crypto.subtle.exportKey('raw', bKeyPair.publicKey);
    const bPublicKeyB64 = b64urlEncode(bRawPublic);

    // Compute expected keyId & fingerprint
    const keyIdHash = crypto.createHash('sha256').update(Buffer.from(bRawPublic)).digest('hex');
    const expectedFingerprint = keyIdHash.slice(0, 32).match(/.{1,4}/g).join(' ');

    // Wait for fresh TOTP step before calling PUT /api/keys/me
    const bTotp1 = await getFreshTotpCode(userB.email, userB.totpSecret);
    const keyRegRes = await fetch(`${BACKEND_URL}/api/keys/me`, {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${userB.accessToken}`
      },
      body: JSON.stringify({ publicKey: bPublicKeyB64, code: bTotp1 })
    });
    const keyRegData = await keyRegRes.json();
    if (keyRegRes.status !== 200 || !keyRegData.keyId || keyRegData.fingerprint !== expectedFingerprint) {
      throw new Error(`Key registration failed: HTTP ${keyRegRes.status} ${JSON.stringify(keyRegData)}`);
    }
    userB.keyId = keyRegData.keyId;
    userB.fingerprint = keyRegData.fingerprint;
    console.log(`CHECK 4: PASS - B registered vault key with fingerprint: ${userB.fingerprint}`);

    // -------------------------------------------------------------
    // CHECK 5: A looks up B's fingerprint
    // -------------------------------------------------------------
    const lookupRes = await fetch(`${BACKEND_URL}/api/keys/receiver?email=${encodeURIComponent(userB.email)}`, {
      headers: { Authorization: `Bearer ${userA.accessToken}` }
    });
    const lookupData = await lookupRes.json();
    if (lookupRes.status !== 200 || !lookupData.registered || lookupData.fingerprint !== userB.fingerprint) {
      throw new Error(`Fingerprint lookup failed: HTTP ${lookupRes.status} ${JSON.stringify(lookupData)}`);
    }
    console.log(`CHECK 5: PASS - A verified B's registered fingerprint: ${lookupData.fingerprint}`);

    // -------------------------------------------------------------
    // CHECK 6: A uploads a small generated PDF in secure (wrapped) mode with geofence
    // -------------------------------------------------------------
    const formDataWrapped = new FormData();
    formDataWrapped.append('file', new Blob([SAMPLE_PDF], { type: 'application/pdf' }), 'apollo_report.pdf');
    formDataWrapped.append('receiverEmail', userB.email);
    formDataWrapped.append('delivery', 'wrapped');
    formDataWrapped.append('geoLat', '37.7749');
    formDataWrapped.append('geoLng', '-122.4194');
    formDataWrapped.append('geoRadiusMeters', '500');
    formDataWrapped.append('oneTimeUse', 'false');

    const upRes = await fetch(`${BACKEND_URL}/api/documents`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${userA.accessToken}` },
      body: formDataWrapped
    });
    const upData = await upRes.json();
    if (upRes.status !== 201 || !upData.document || upData.documentKey !== undefined) {
      throw new Error(`Secure upload failed: HTTP ${upRes.status} docKey=${upData.documentKey}`);
    }
    const wrappedDocId = upData.document.id;
    console.log(`CHECK 6: PASS - A uploaded geofenced document (ID: ${wrappedDocId}) in wrapped mode with 201 and NO documentKey`);

    // -------------------------------------------------------------
    // CHECK 7: B receives it in list & gets key envelope; A and C get 404
    // -------------------------------------------------------------
    const bListRes = await fetch(`${BACKEND_URL}/api/documents/received`, {
      headers: { Authorization: `Bearer ${userB.accessToken}` }
    });
    const bListData = await bListRes.json();
    const foundInList = bListData.documents?.some((d) => d.id === wrappedDocId);
    if (!foundInList) {
      throw new Error(`Wrapped document ${wrappedDocId} not found in B's received list`);
    }

    const bEnvRes = await fetch(`${BACKEND_URL}/api/documents/${wrappedDocId}/key-envelope`, {
      headers: { Authorization: `Bearer ${userB.accessToken}` }
    });
    const bEnvData = await bEnvRes.json();
    if (bEnvRes.status !== 200 || !bEnvData.envelope) {
      throw new Error(`B failed to fetch key envelope: HTTP ${bEnvRes.status} ${JSON.stringify(bEnvData)}`);
    }

    // A (sender) must get 404
    const aEnvRes = await fetch(`${BACKEND_URL}/api/documents/${wrappedDocId}/key-envelope`, {
      headers: { Authorization: `Bearer ${userA.accessToken}` }
    });
    if (aEnvRes.status !== 404) {
      throw new Error(`Sender A expected 404 on envelope, got HTTP ${aEnvRes.status}`);
    }

    // C (third party) must get 404
    const cEnvRes = await fetch(`${BACKEND_URL}/api/documents/${wrappedDocId}/key-envelope`, {
      headers: { Authorization: `Bearer ${userC.accessToken}` }
    });
    if (cEnvRes.status !== 404) {
      throw new Error(`Third party C expected 404 on envelope, got HTTP ${cEnvRes.status}`);
    }
    console.log('CHECK 7: PASS - B received envelope; sender A (404) and third-party C (404) access denied');

    // -------------------------------------------------------------
    // CHECK 8: B unwraps with webcrypto & opens; outside radius -> 403, inside -> 200
    // -------------------------------------------------------------
    const unwrappedDocumentKey = await unwrapKey(bEnvData.envelope, wrappedDocId, userB.id, bKeyPair.privateKey);

    // 8a: Call /open with location OUTSIDE radius (lat: 38.0, lng: -122.0)
    const bTotpOutside = await getFreshTotpCode(userB.email, userB.totpSecret);
    const outsideRes = await fetch(`${BACKEND_URL}/api/documents/${wrappedDocId}/open`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${userB.accessToken}`
      },
      body: JSON.stringify({
        documentKey: unwrappedDocumentKey,
        code: bTotpOutside,
        lat: 38.0000,
        lng: -122.0000,
        accuracyMeters: 10
      })
    });
    const outsideData = await outsideRes.json();
    if (outsideRes.status !== 403 || outsideData.code !== 'outside_area') {
      throw new Error(`Expected 403 outside_area, got HTTP ${outsideRes.status} ${JSON.stringify(outsideData)}`);
    }

    // 8b: Call /open with location INSIDE radius (lat: 37.7749, lng: -122.4194)
    const bTotpInside = await getFreshTotpCode(userB.email, userB.totpSecret);
    const insideRes = await fetch(`${BACKEND_URL}/api/documents/${wrappedDocId}/open`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${userB.accessToken}`
      },
      body: JSON.stringify({
        documentKey: unwrappedDocumentKey,
        code: bTotpInside,
        lat: 37.7749,
        lng: -122.4194,
        accuracyMeters: 10
      })
    });
    if (insideRes.status !== 200) {
      const errText = await insideRes.text();
      throw new Error(`Inside radius open failed: HTTP ${insideRes.status} ${errText}`);
    }
    const openedBytes = Buffer.from(await insideRes.arrayBuffer());
    if (openedBytes.length !== SAMPLE_PDF.length || !openedBytes.equals(SAMPLE_PDF)) {
      throw new Error(`Decrypted document bytes mismatch (expected ${SAMPLE_PDF.length}, got ${openedBytes.length})`);
    }
    console.log('CHECK 8: PASS - Unwrapped key via WebCrypto; outside radius returns 403; inside radius returns 200 with identical bytes');

    // -------------------------------------------------------------
    // CHECK 9: One-time document opens once, then returns 410
    // -------------------------------------------------------------
    const formDataOneTime = new FormData();
    formDataOneTime.append('file', new Blob([SAMPLE_PDF], { type: 'application/pdf' }), 'one_time.pdf');
    formDataOneTime.append('receiverEmail', userB.email);
    formDataOneTime.append('delivery', 'wrapped');
    formDataOneTime.append('oneTimeUse', 'true');

    const otUpRes = await fetch(`${BACKEND_URL}/api/documents`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${userA.accessToken}` },
      body: formDataOneTime
    });
    const otUpData = await otUpRes.json();
    const otDocId = otUpData.document.id;

    // Get envelope for one-time doc
    const otEnvRes = await fetch(`${BACKEND_URL}/api/documents/${otDocId}/key-envelope`, {
      headers: { Authorization: `Bearer ${userB.accessToken}` }
    });
    const otEnvData = await otEnvRes.json();
    const otDocKey = await unwrapKey(otEnvData.envelope, otDocId, userB.id, bKeyPair.privateKey);

    // Open first time -> 200
    const otTotp1 = await getFreshTotpCode(userB.email, userB.totpSecret);
    const otOpen1Res = await fetch(`${BACKEND_URL}/api/documents/${otDocId}/open`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${userB.accessToken}`
      },
      body: JSON.stringify({ documentKey: otDocKey, code: otTotp1 })
    });
    if (otOpen1Res.status !== 200) {
      throw new Error(`One-time first open failed: HTTP ${otOpen1Res.status}`);
    }

    // Open second time -> 410
    const otTotp2 = await getFreshTotpCode(userB.email, userB.totpSecret);
    const otOpen2Res = await fetch(`${BACKEND_URL}/api/documents/${otDocId}/open`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${userB.accessToken}`
      },
      body: JSON.stringify({ documentKey: otDocKey, code: otTotp2 })
    });
    const otOpen2Data = await otOpen2Res.json();
    if (otOpen2Res.status !== 410 || otOpen2Data.code !== 'consumed') {
      throw new Error(`Expected 410 consumed on second open, got HTTP ${otOpen2Res.status} ${JSON.stringify(otOpen2Data)}`);
    }
    console.log('CHECK 9: PASS - One-time document opened once (200), subsequent open returns 410 consumed');

    // -------------------------------------------------------------
    // CHECK 10: QR-mode upload still works end-to-end
    // -------------------------------------------------------------
    const formDataQr = new FormData();
    formDataQr.append('file', new Blob([SAMPLE_PDF], { type: 'application/pdf' }), 'qr_doc.pdf');
    formDataQr.append('receiverEmail', userB.email);
    formDataQr.append('delivery', 'qr');

    const qrUpRes = await fetch(`${BACKEND_URL}/api/documents`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${userA.accessToken}` },
      body: formDataQr
    });
    const qrUpData = await qrUpRes.json();
    if (qrUpRes.status !== 201 || !qrUpData.documentKey) {
      throw new Error(`QR upload failed: HTTP ${qrUpRes.status} no documentKey`);
    }
    const qrDocId = qrUpData.document.id;
    const qrDocKey = qrUpData.documentKey;

    // key-envelope returns 404 for QR docs
    const qrEnvRes = await fetch(`${BACKEND_URL}/api/documents/${qrDocId}/key-envelope`, {
      headers: { Authorization: `Bearer ${userB.accessToken}` }
    });
    if (qrEnvRes.status !== 404) {
      throw new Error(`Expected 404 for QR doc key-envelope, got HTTP ${qrEnvRes.status}`);
    }

    // Open QR doc with documentKey
    const qrTotp = await getFreshTotpCode(userB.email, userB.totpSecret);
    const qrOpenRes = await fetch(`${BACKEND_URL}/api/documents/${qrDocId}/open`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${userB.accessToken}`
      },
      body: JSON.stringify({ documentKey: qrDocKey, code: qrTotp })
    });
    if (qrOpenRes.status !== 200) {
      throw new Error(`QR doc open failed: HTTP ${qrOpenRes.status}`);
    }
    console.log('CHECK 10: PASS - QR mode returns documentKey, envelope returns 404, document opens with 200');

    // -------------------------------------------------------------
    // CHECK 11: socket.io client for B receives 'document:sealed' event
    // -------------------------------------------------------------
    const socket = io(BACKEND_URL, {
      auth: { token: userB.accessToken },
      transports: ['websocket', 'polling']
    });

    const receivedEventPromise = new Promise((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error('Timed out waiting for socket document:sealed event')), 6000);
      socket.on('document:sealed', (data) => {
        clearTimeout(timeout);
        resolve(data);
      });
      socket.on('connect_error', (err) => {
        clearTimeout(timeout);
        reject(err);
      });
    });

    await new Promise((resolve) => {
      if (socket.connected) resolve();
      else socket.on('connect', resolve);
    });

    // Upload another document from A to B to trigger the event
    const formDataSocket = new FormData();
    formDataSocket.append('file', new Blob([SAMPLE_PDF], { type: 'application/pdf' }), 'socket_test.pdf');
    formDataSocket.append('receiverEmail', userB.email);
    formDataSocket.append('delivery', 'wrapped');

    await fetch(`${BACKEND_URL}/api/documents`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${userA.accessToken}` },
      body: formDataSocket
    });

    const socketEventData = await receivedEventPromise;
    socket.disconnect();
    if (!socketEventData || socketEventData.originalName !== 'socket_test.pdf') {
      throw new Error(`Invalid socket event payload: ${JSON.stringify(socketEventData)}`);
    }
    console.log(`CHECK 11: PASS - Socket.io client received 'document:sealed' event for '${socketEventData.originalName}'`);

    // -------------------------------------------------------------
    // CHECK 12: B posts opened bytes to AI service
    // -------------------------------------------------------------
    // 12a: Create session
    const aiSessRes = await fetch(`${AI_URL}/v1/sessions`, {
      method: 'POST',
      headers: {
        Origin: BROWSER_ORIGIN,
        'Content-Type': 'application/json'
      }
    });
    const aiSessData = await aiSessRes.json();
    if (aiSessRes.status !== 201 || !aiSessData.sessionId || !aiSessData.token) {
      throw new Error(`AI session creation failed: HTTP ${aiSessRes.status} ${JSON.stringify(aiSessData)}`);
    }
    const { sessionId: aiSessionId, token: aiToken } = aiSessData;

    // 12b: Raw-body ingest
    const ingestRes = await fetch(`${AI_URL}/v1/sessions/${aiSessionId}/documents`, {
      method: 'POST',
      headers: {
        Origin: BROWSER_ORIGIN,
        Authorization: `Bearer ${aiToken}`,
        'Content-Type': 'application/pdf',
        'X-Document-Name': 'apollo.pdf'
      },
      body: openedBytes
    });
    const ingestData = await ingestRes.json();
    if (ingestRes.status !== 201 || !ingestData.docId) {
      throw new Error(`AI document ingest failed: HTTP ${ingestRes.status} ${JSON.stringify(ingestData)}`);
    }

    // 12c: Check stats
    const statsRes = await fetch(`${AI_URL}/v1/sessions/${aiSessionId}`, {
      headers: {
        Origin: BROWSER_ORIGIN,
        Authorization: `Bearer ${aiToken}`
      }
    });
    const statsData = await statsRes.json();
    if (statsRes.status !== 200 || statsData.documents !== 1 || statsData.chunks < 1) {
      throw new Error(`AI stats check failed: HTTP ${statsRes.status} ${JSON.stringify(statsData)}`);
    }

    // Helper to read SSE stream until 'done'
    async function askAi(question, mode = 'auto') {
      const chatRes = await fetch(`${AI_URL}/v1/sessions/${aiSessionId}/chat`, {
        method: 'POST',
        headers: {
          Origin: BROWSER_ORIGIN,
          Authorization: `Bearer ${aiToken}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ question, mode })
      });
      if (chatRes.status !== 200) {
        throw new Error(`AI chat failed: HTTP ${chatRes.status}`);
      }

      const reader = chatRes.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';
      let finalText = '';
      let sources = [];

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n\n');
        buffer = lines.pop(); // keep remainder

        for (const block of lines) {
          const eventMatch = block.match(/event:\s*(\w+)/);
          const dataMatch = block.match(/data:\s*(.+)/s);
          if (eventMatch && dataMatch) {
            const eventName = eventMatch[1];
            try {
              const data = JSON.parse(dataMatch[1]);
              if (eventName === 'sources') sources = data;
              if (eventName === 'done') finalText = data.finalText || '';
            } catch (_) {}
          }
        }
      }
      return { finalText, sources };
    }

    // 12d: Factual question
    const factual = await askAi('When is Project Apollo scheduled for launch?');
    const citesPage = factual.finalText.includes('[p.1]') || factual.sources.some((s) => s.page === 1);
    const hasDate = factual.finalText.toLowerCase().includes('december 15');
    if (!citesPage || !hasDate) {
      throw new Error(`Factual answer failed: text='${factual.finalText}' citesPage=${citesPage}`);
    }

    // 12e: Summary question
    const summary = await askAi('give me a short overview', 'summary');
    if (!summary.finalText || summary.finalText.length < 10) {
      throw new Error(`Summary answer failed: text='${summary.finalText}'`);
    }

    // 12f: Question not in document
    const notFound = await askAi('What is the recipe for chocolate chip cookies?');
    const exactReply = 'I could not find information about that in the provided documents.';
    if (!notFound.finalText.includes(exactReply)) {
      throw new Error(`Expected exact not-found reply, got: '${notFound.finalText}'`);
    }

    // 12g: Delete session
    const delRes = await fetch(`${AI_URL}/v1/sessions/${aiSessionId}`, {
      method: 'DELETE',
      headers: {
        Origin: BROWSER_ORIGIN,
        Authorization: `Bearer ${aiToken}`
      }
    });
    if (delRes.status !== 204) {
      throw new Error(`AI session delete failed: HTTP ${delRes.status}`);
    }
    console.log('CHECK 12: PASS - AI service ingest, factual QA ([p.1]), overview summary, exact not-found reply, and session purge verified');

    // -------------------------------------------------------------
    // CHECK 13: /api/analytics/me/overview & /api/audit/verify (admin)
    // -------------------------------------------------------------
    const analyticsRes = await fetch(`${BACKEND_URL}/api/analytics/me/overview`, {
      headers: { Authorization: `Bearer ${userA.accessToken}` }
    });
    const analyticsData = await analyticsRes.json();
    if (analyticsRes.status !== 200 || !analyticsData.totals) {
      throw new Error(`Analytics overview failed: HTTP ${analyticsRes.status} ${JSON.stringify(analyticsData)}`);
    }

    // Promote User A to admin directly in MongoDB
    await dbConnection.connection.collection('users').updateOne(
      { _id: new mongoose.Types.ObjectId(userA.id) },
      { $set: { role: 'admin' } }
    );

    const auditRes = await fetch(`${BACKEND_URL}/api/audit/verify`, {
      headers: { Authorization: `Bearer ${userA.accessToken}` }
    });
    const auditData = await auditRes.json();
    if (auditRes.status !== 200 || auditData.valid !== true || auditData.checked <= 0) {
      throw new Error(`Audit chain verification failed: HTTP ${auditRes.status} ${JSON.stringify(auditData)}`);
    }
    console.log(`CHECK 13: PASS - Analytics overview (200) and admin audit chain verified (valid: true, checked: ${auditData.checked} entries)`);

    console.log('\n===============================================================');
    console.log('   ALL 13 LIVE E2E CHECKS PASSED SUCCESSFULLY!');
    console.log('===============================================================\n');
  } finally {
    if (dbConnection) {
      console.log(`[Teardown] Dropping throw-away test database: cipher_vault_debug...`);
      try {
        await dbConnection.connection.db.dropDatabase();
        console.log('[Teardown] Database cipher_vault_debug successfully dropped.');
      } catch (err) {
        console.error('[Teardown] Error dropping database:', err.message);
      }
      await mongoose.disconnect();
    }
  }
}

run().catch((err) => {
  console.error('\nE2E LIVE EXECUTION FAILED:');
  console.error(err);
  process.exit(1);
});
