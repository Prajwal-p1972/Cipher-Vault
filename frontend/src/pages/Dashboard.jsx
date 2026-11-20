import React, { useState, useEffect, useCallback, useContext } from 'react';
import { SocketContext } from '../realtime/SocketContext.jsx';
import { useDocuments } from '../hooks/useDocuments.js';
import { Layout } from '../components/Layout.jsx';
import { DocumentTable } from '../components/DocumentTable.jsx';
import { UploadForm } from '../components/UploadForm.jsx';
import { KeyRevealModal } from '../components/KeyRevealModal.jsx';
import { UnlockModal } from '../components/UnlockModal.jsx';
import { DocumentViewer } from '../components/DocumentViewer.jsx';
import { AuditDashboard } from '../components/AuditDashboard.jsx';
import { useVaultKey } from '../hooks/useVaultKey.js';
import { VaultKeySetup } from '../components/VaultKeySetup.jsx';
import CyberVaultCanvas3D from '../components/ui3d/CyberVaultCanvas3D.jsx';
import TiltCard3D from '../components/ui3d/TiltCard3D.jsx';
import VaultDoorTransition3D from '../components/ui3d/VaultDoorTransition3D.jsx';

/**
 * Main application dashboard featuring Received / Sent / New Upload views,
 * live socket notifications, unread badges, one-time key revelation modal,
 * unlock modal flow, and in-browser document viewer.
 */
export function Dashboard() {
  const { sent, received, loading, error, refresh, addReceived } = useDocuments();
  const socketCtx = useContext(SocketContext);

  const [activeTab, setActiveTab] = useState('received');
  const [sealedKeyData, setSealedKeyData] = useState(null);
  const [unlockingDoc, setUnlockingDoc] = useState(null);
  const [viewingDocData, setViewingDocData] = useState(null);

  // Vault key status & modal
  const { status: vaultStatus, refresh: refreshVaultKey } = useVaultKey();
  const [showVaultKeyModal, setShowVaultKeyModal] = useState(false);
  const [bannerDismissed, setBannerDismissed] = useState(false);

  // Notification and Toast state
  const [toasts, setToasts] = useState([]);
  const [notifications, setNotifications] = useState([]);
  const [unreadCount, setUnreadCount] = useState(0);

  // Cinematic 3D vault locker opening transition trigger on login
  const [playVaultDoor, setPlayVaultDoor] = useState(() => {
    try {
      return typeof sessionStorage !== 'undefined' && sessionStorage.getItem('cv_play_vault_door') === 'true';
    } catch (_) {
      return false;
    }
  });

  const dismissToast = useCallback((id) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  }, []);

  const markAllAsRead = useCallback(() => {
    setUnreadCount(0);
    setNotifications((prev) => prev.map((n) => ({ ...n, read: true })));
  }, []);

  // Listen for live 'document:sealed' real-time events
  useEffect(() => {
    if (!socketCtx || typeof socketCtx.on !== 'function') return;

    const unsubscribeSealed = socketCtx.on('document:sealed', (payload) => {
      if (!payload) return;

      // 1. Add to received documents list (de-duplicated by useDocuments)
      addReceived(payload);

      const sender = payload.senderName || 'Someone';
      const docName = payload.originalName || 'a document';
      const toastMessage = `${sender} sent you ${docName}`;
      const toastId = `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;

      // 2. Add toast alert
      setToasts((prev) => [...prev, { id: toastId, message: toastMessage }]);
      setTimeout(() => {
        dismissToast(toastId);
      }, 6000);

      // 3. Add to notifications history (strictly capped at 20)
      const notifItem = {
        id: payload.documentId || toastId,
        senderName: sender,
        originalName: docName,
        createdAt: payload.createdAt || new Date().toISOString(),
        read: false
      };
      setNotifications((prev) => [notifItem, ...prev].slice(0, 20));
      setUnreadCount((c) => c + 1);
    });

    const unsubscribeBreach = socketCtx.on('document:breach_alert', (payload) => {
      if (!payload) return;
      const docName = payload.originalName || 'a document';
      const toastMessage = `⚠️ Breach Warning: Unauthorized attempt on "${docName}" (${payload.failedAttempts}/${payload.maxFailedAttempts || 3})`;
      const toastId = `breach-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;

      setToasts((prev) => [...prev, { id: toastId, message: toastMessage, type: 'warning' }]);
      setTimeout(() => {
        dismissToast(toastId);
      }, 8000);

      refresh();
    });

    const unsubscribeDestroyed = socketCtx.on('document:destroyed', (payload) => {
      if (!payload) return;
      const docName = payload.originalName || 'a document';
      const toastMessage = `⚡ INTRUSION DEFENSE: Document "${docName}" was CRYPTO-SHREDDED after exceeding max attempts!`;
      const toastId = `destroy-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;

      setToasts((prev) => [...prev, { id: toastId, message: toastMessage, type: 'danger' }]);
      setTimeout(() => {
        dismissToast(toastId);
      }, 10000);

      refresh();
    });

    return () => {
      if (typeof unsubscribeSealed === 'function') unsubscribeSealed();
      if (typeof unsubscribeBreach === 'function') unsubscribeBreach();
      if (typeof unsubscribeDestroyed === 'function') unsubscribeDestroyed();
    };
  }, [socketCtx, addReceived, dismissToast, refresh]);

  const handleUploadSuccess = ({ document, documentKey }) => {
    refresh();
    if (documentKey) {
      setSealedKeyData({
        key: documentKey,
        name: document?.originalName || 'Document',
        document: document,
        documentId: document?.id || document?._id
      });
    }
    setActiveTab('sent');
  };

  const handleOpenDocument = useCallback((doc) => {
    setUnlockingDoc(doc);
  }, []);

  const handleUnlockSuccess = useCallback((unlockedData) => {
    setUnlockingDoc(null);
    setViewingDocData(unlockedData);
    // Refetch the document list so one-time documents immediately reflect 'consumed' status
    refresh();
  }, [refresh]);

  return (
    <Layout
      toasts={toasts}
      onDismissToast={dismissToast}
      notifications={notifications}
      unreadCount={unreadCount}
      onMarkAllAsRead={markAllAsRead}
    >
      <div style={{ position: 'relative', display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>
        <CyberVaultCanvas3D opacity={0.18} speed={0.5} />
        {playVaultDoor && (
          <VaultDoorTransition3D
            onComplete={() => {
              try {
                sessionStorage.removeItem('cv_play_vault_door');
              } catch (_) {}
              setPlayVaultDoor(false);
            }}
          />
        )}

        {/* Interactive 3D Cryptographic Pipeline Stepper */}
        <div className="pipeline-stepper-3d preserve-3d">
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '0.85rem' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', fontSize: '0.82rem', fontWeight: 700, color: '#00f0ff', letterSpacing: '0.06em' }}>
              <span>&#9670;</span> CIPHER VAULT END-TO-END CRYPTOGRAPHIC PIPELINE
            </div>
            <div style={{ fontSize: '0.72rem', color: '#94a3b8', fontFamily: 'var(--font-mono)' }}>
              Zero-Cloud Isolation Verified
            </div>
          </div>
          <div className="pipeline-steps-track">
            <div className="pipeline-node-box">
              <div className="pipeline-node-badge">1</div>
              <div style={{ fontSize: '0.78rem', fontWeight: 700, color: '#f8fafc' }}>Client Seal</div>
              <div style={{ fontSize: '0.68rem', color: '#94a3b8' }}>AES-256-GCM Stream</div>
            </div>
            <div style={{ height: '2px', flex: 0.5, minWidth: '20px', background: 'linear-gradient(90deg, #00f0ff, #10b981)' }} />
            <div className="pipeline-node-box">
              <div className="pipeline-node-badge" style={{ borderColor: '#10b981', color: '#10b981', boxShadow: '0 0 10px rgba(16, 185, 129, 0.4)' }}>2</div>
              <div style={{ fontSize: '0.78rem', fontWeight: 700, color: '#f8fafc' }}>Untrusted Blob</div>
              <div style={{ fontSize: '0.68rem', color: '#94a3b8' }}>Zero-Knowledge Store</div>
            </div>
            <div style={{ height: '2px', flex: 0.5, minWidth: '20px', background: 'linear-gradient(90deg, #10b981, #f59e0b)' }} />
            <div className="pipeline-node-box">
              <div className="pipeline-node-badge" style={{ borderColor: '#f59e0b', color: '#f59e0b', boxShadow: '0 0 10px rgba(245, 158, 11, 0.4)' }}>3</div>
              <div style={{ fontSize: '0.78rem', fontWeight: 700, color: '#f8fafc' }}>Geofence + MFA</div>
              <div style={{ fontSize: '0.68rem', color: '#94a3b8' }}>GPS Haversine Gate</div>
            </div>
            <div style={{ height: '2px', flex: 0.5, minWidth: '20px', background: 'linear-gradient(90deg, #f59e0b, #00f0ff)' }} />
            <div className="pipeline-node-box">
              <div className="pipeline-node-badge">4</div>
              <div style={{ fontSize: '0.78rem', fontWeight: 700, color: '#f8fafc' }}>RAM Unwrap</div>
              <div style={{ fontSize: '0.68rem', color: '#94a3b8' }}>ECDH P-256 Key</div>
            </div>
            <div style={{ height: '2px', flex: 0.5, minWidth: '20px', background: 'linear-gradient(90deg, #00f0ff, #8b5cf6)' }} />
            <div className="pipeline-node-box">
              <div className="pipeline-node-badge" style={{ borderColor: '#8b5cf6', color: '#8b5cf6', boxShadow: '0 0 10px rgba(139, 92, 246, 0.4)' }}>5</div>
              <div style={{ fontSize: '0.78rem', fontWeight: 700, color: '#f8fafc' }}>Llama 3 RAG</div>
              <div style={{ fontSize: '0.68rem', color: '#94a3b8' }}>127.0.0.1 Offline AI</div>
            </div>
          </div>
        </div>

        {/* Navigation Tabs */}
        <div
          role="tablist"
          aria-label="Dashboard views"
          className="tab-3d-container"
        >
          <button
            type="button"
            role="tab"
            aria-selected={activeTab === 'received'}
            onClick={() => setActiveTab('received')}
            className={`tab-btn tab-3d-btn ${activeTab === 'received' ? 'tab-active' : ''}`}
          >
            <span>Received Documents</span>
            <span
              style={{
                fontSize: '0.75rem',
                backgroundColor: activeTab === 'received' ? 'rgba(0, 240, 255, 0.2)' : 'rgba(30, 41, 59, 0.8)',
                color: activeTab === 'received' ? '#00f0ff' : '#94a3b8',
                border: activeTab === 'received' ? '1px solid rgba(0, 240, 255, 0.4)' : '1px solid rgba(255, 255, 255, 0.1)',
                padding: '0.1rem 0.55rem',
                borderRadius: '9999px',
                fontWeight: 700
              }}
            >
              {received.length}
            </span>
          </button>

          <button
            type="button"
            role="tab"
            aria-selected={activeTab === 'sent'}
            onClick={() => setActiveTab('sent')}
            className={`tab-btn tab-3d-btn ${activeTab === 'sent' ? 'tab-active' : ''}`}
          >
            <span>Sent Documents</span>
            <span
              style={{
                fontSize: '0.75rem',
                backgroundColor: activeTab === 'sent' ? 'rgba(0, 240, 255, 0.2)' : 'rgba(30, 41, 59, 0.8)',
                color: activeTab === 'sent' ? '#00f0ff' : '#94a3b8',
                border: activeTab === 'sent' ? '1px solid rgba(0, 240, 255, 0.4)' : '1px solid rgba(255, 255, 255, 0.1)',
                padding: '0.1rem 0.55rem',
                borderRadius: '9999px',
                fontWeight: 700
              }}
            >
              {sent.length}
            </span>
          </button>

          <button
            type="button"
            role="tab"
            aria-selected={activeTab === 'upload'}
            onClick={() => setActiveTab('upload')}
            className={`tab-btn tab-3d-btn ${activeTab === 'upload' ? 'tab-active' : ''}`}
          >
            + New Upload
          </button>
        </div>

        {/* Dismissible Vault Key Status Banner */}
        {!bannerDismissed && (vaultStatus === 'none' || vaultStatus === 'mismatch') && (
          <div
            data-testid="vault-key-banner"
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              backgroundColor: vaultStatus === 'mismatch' ? 'rgba(69, 10, 10, 0.85)' : 'rgba(15, 23, 42, 0.9)',
              border: `1px solid ${vaultStatus === 'mismatch' ? 'rgba(244, 63, 94, 0.6)' : 'rgba(0, 240, 255, 0.35)'}`,
              borderRadius: '10px',
              padding: '0.85rem 1.25rem',
              marginBottom: '1rem',
              gap: '1rem',
              boxShadow: '0 8px 25px -5px rgba(0, 0, 0, 0.8), inset 0 1px 1px rgba(255, 255, 255, 0.1)'
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
              <span style={{ fontSize: '1.25rem' }}>
                {vaultStatus === 'mismatch' ? '⚠️' : '🔑'}
              </span>
              <div style={{ fontSize: '0.875rem', color: vaultStatus === 'mismatch' ? '#fecdd3' : '#cbd5e1' }}>
                {vaultStatus === 'mismatch' ? (
                  <>
                    <strong style={{ color: '#f43f5e' }}>Vault Key Mismatch:</strong> This browser does not hold the private key for your registered vault key. Documents sent to that key cannot be opened on this device.
                  </>
                ) : (
                  <>
                    <strong style={{ color: '#00f0ff' }}>Enable Secure Delivery:</strong> Set up a browser vault key so senders can deliver documents directly without sharing a QR code.
                  </>
                )}
              </div>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', flexShrink: 0 }}>
              <button
                type="button"
                onClick={() => setShowVaultKeyModal(true)}
                className={`btn ${vaultStatus === 'mismatch' ? 'btn-secondary btn-3d-danger' : 'btn-primary btn-3d-primary'}`}
                style={{
                  padding: '0.35rem 0.85rem',
                  fontSize: '0.8rem',
                  width: 'auto'
                }}
              >
                {vaultStatus === 'mismatch' ? 'Resolve Mismatch' : 'Set Up Vault Key'}
              </button>
              <button
                type="button"
                onClick={() => setBannerDismissed(true)}
                aria-label="Dismiss banner"
                style={{
                  background: 'none',
                  border: 'none',
                  fontSize: '1.25rem',
                  color: '#94a3b8',
                  cursor: 'pointer',
                  padding: '0 0.25rem',
                  lineHeight: 1
                }}
              >
                &times;
              </button>
            </div>
          </div>
        )}

        {/* Global Loading State */}
        {loading && (
          <div
            className="loading-container"
            style={{ padding: '3rem 1.5rem', textAlign: 'center', color: '#64748b' }}
          >
            <div className="spinner" style={{ margin: '0 auto 1rem auto' }} />
            <p style={{ margin: 0, fontSize: '0.9rem', fontWeight: 500 }}>
              Synchronizing secure document index...
            </p>
          </div>
        )}

        {/* Global Error Banner */}
        {!loading && error && (
          <div
            className="alert alert-error"
            role="alert"
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              gap: '1rem'
            }}
          >
            <span>{error}</span>
            <button
              type="button"
              onClick={refresh}
              className="btn btn-secondary"
              style={{ padding: '0.35rem 0.8rem', fontSize: '0.8rem', width: 'auto' }}
            >
              Retry
            </button>
          </div>
        )}

        {/* Tab Views */}
        {!loading && (
          <div>
            {activeTab === 'received' && (
              <div>
                <div style={{ marginBottom: '1rem', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <h2 style={{ fontSize: '1.2rem', fontWeight: 700, margin: 0, color: '#f8fafc', textShadow: '0 0 10px rgba(0, 240, 255, 0.35)' }}>
                    Received Cryptographic Documents
                  </h2>
                  <button
                    type="button"
                    onClick={refresh}
                    className="btn btn-secondary btn-3d-cyber"
                    style={{ padding: '0.4rem 0.9rem', fontSize: '0.8rem', width: 'auto' }}
                  >
                    Refresh
                  </button>
                </div>
                <DocumentTable
                  documents={received}
                  type="received"
                  onOpen={handleOpenDocument}
                  emptyMessage="No documents have been received yet. Any new documents sent to your email will appear here automatically in real time."
                />
              </div>
            )}

            {activeTab === 'sent' && (
              <div>
                <div style={{ marginBottom: '1rem', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <h2 style={{ fontSize: '1.2rem', fontWeight: 700, margin: 0, color: '#f8fafc', textShadow: '0 0 10px rgba(0, 240, 255, 0.35)' }}>
                    Sent Sealed Documents
                  </h2>
                  <button
                    type="button"
                    onClick={refresh}
                    className="btn btn-secondary btn-3d-cyber"
                    style={{ padding: '0.4rem 0.9rem', fontSize: '0.8rem', width: 'auto' }}
                  >
                    Refresh
                  </button>
                </div>
                <DocumentTable
                  documents={sent}
                  type="sent"
                  emptyMessage="You haven't sealed and sent any documents yet. Click '+ New Upload' to get started."
                />
              </div>
            )}

            {activeTab === 'upload' && (
              <TiltCard3D
                variant="cyan"
                maxTilt={0}
                glare={false}
                style={{
                  maxWidth: '680px',
                  margin: '0 auto',
                  padding: '2rem'
                }}
              >
                <div style={{ marginBottom: '1.5rem' }}>
                  <h2 style={{ fontSize: '1.25rem', fontWeight: 700, margin: '0 0 0.4rem 0', color: '#f8fafc', textShadow: '0 0 12px rgba(56, 189, 248, 0.4)' }}>
                    Seal &amp; Send Document
                  </h2>
                  <p style={{ margin: 0, fontSize: '0.875rem', color: '#94a3b8' }}>
                    Documents are encrypted with AES-256-GCM. The encryption key is displayed only once to you and is never stored on the server.
                  </p>
                </div>
                <UploadForm onSuccess={handleUploadSuccess} />
              </TiltCard3D>
            )}
          </div>
        )}

        {/* Security & Audit Analytics Dashboard */}
        <AuditDashboard />
      </div>

      {/* Secret Key Modal shown once after upload */}
      {sealedKeyData && (
        <KeyRevealModal
          documentKey={sealedKeyData.key}
          document={sealedKeyData.document}
          documentId={sealedKeyData.documentId}
          documentName={sealedKeyData.name}
          onClose={() => setSealedKeyData(null)}
        />
      )}

      {/* Context-gated Unlock Modal */}
      {unlockingDoc && (
        <UnlockModal
          document={unlockingDoc}
          hasVaultKey={vaultStatus === 'ready'}
          onSuccess={handleUnlockSuccess}
          onClose={() => setUnlockingDoc(null)}
        />
      )}

      {/* Sandboxed Decrypted Document Viewer */}
      {viewingDocData && (
        <DocumentViewer
          blob={viewingDocData.blob}
          contentType={viewingDocData.contentType}
          originalName={viewingDocData.originalName}
          onClose={() => setViewingDocData(null)}
        />
      )}

      {/* Vault Key Setup Modal */}
      {showVaultKeyModal && (
        <div
          role="dialog"
          aria-modal="true"
          style={{
            position: 'fixed',
            top: 0,
            left: 0,
            right: 0,
            bottom: 0,
            backgroundColor: 'rgba(15, 23, 42, 0.75)',
            backdropFilter: 'blur(4px)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            zIndex: 9999,
            padding: '1.5rem'
          }}
        >
          <div style={{ width: '100%', maxWidth: '560px' }}>
            <VaultKeySetup
              onClose={() => setShowVaultKeyModal(false)}
              onSuccess={() => {
                setShowVaultKeyModal(false);
                refreshVaultKey();
              }}
            />
          </div>
        </div>
      )}
    </Layout>
  );
}

export default Dashboard;
