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

    const unsubscribe = socketCtx.on('document:sealed', (payload) => {
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

    return () => {
      unsubscribe();
    };
  }, [socketCtx, addReceived, dismissToast]);

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
      <div style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>
        {/* Navigation Tabs */}
        <div
          role="tablist"
          aria-label="Dashboard views"
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: '0.5rem',
            borderBottom: '2px solid #e2e8f0',
            paddingBottom: '0.25rem'
          }}
        >
          <button
            type="button"
            role="tab"
            aria-selected={activeTab === 'received'}
            onClick={() => setActiveTab('received')}
            className={`tab-btn ${activeTab === 'received' ? 'tab-active' : ''}`}
            style={{
              padding: '0.65rem 1.25rem',
              fontWeight: 600,
              fontSize: '0.92rem',
              cursor: 'pointer',
              border: 'none',
              background: 'transparent',
              color: activeTab === 'received' ? '#2563eb' : '#64748b',
              borderBottom: activeTab === 'received' ? '2px solid #2563eb' : '2px solid transparent',
              marginBottom: '-2px',
              display: 'flex',
              alignItems: 'center',
              gap: '0.5rem'
            }}
          >
            <span>Received Documents</span>
            <span
              style={{
                fontSize: '0.75rem',
                backgroundColor: activeTab === 'received' ? '#dbeafe' : '#f1f5f9',
                color: activeTab === 'received' ? '#1e40af' : '#475569',
                padding: '0.1rem 0.5rem',
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
            className={`tab-btn ${activeTab === 'sent' ? 'tab-active' : ''}`}
            style={{
              padding: '0.65rem 1.25rem',
              fontWeight: 600,
              fontSize: '0.92rem',
              cursor: 'pointer',
              border: 'none',
              background: 'transparent',
              color: activeTab === 'sent' ? '#2563eb' : '#64748b',
              borderBottom: activeTab === 'sent' ? '2px solid #2563eb' : '2px solid transparent',
              marginBottom: '-2px',
              display: 'flex',
              alignItems: 'center',
              gap: '0.5rem'
            }}
          >
            <span>Sent Documents</span>
            <span
              style={{
                fontSize: '0.75rem',
                backgroundColor: activeTab === 'sent' ? '#dbeafe' : '#f1f5f9',
                color: activeTab === 'sent' ? '#1e40af' : '#475569',
                padding: '0.1rem 0.5rem',
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
            className={`tab-btn ${activeTab === 'upload' ? 'tab-active' : ''}`}
            style={{
              padding: '0.65rem 1.25rem',
              fontWeight: 600,
              fontSize: '0.92rem',
              cursor: 'pointer',
              border: 'none',
              background: 'transparent',
              color: activeTab === 'upload' ? '#2563eb' : '#64748b',
              borderBottom: activeTab === 'upload' ? '2px solid #2563eb' : '2px solid transparent',
              marginBottom: '-2px'
            }}
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
              backgroundColor: vaultStatus === 'mismatch' ? '#fff1f2' : '#eff6ff',
              border: `1px solid ${vaultStatus === 'mismatch' ? '#fecdd3' : '#bfdbfe'}`,
              borderRadius: '8px',
              padding: '0.85rem 1.25rem',
              marginBottom: '1.5rem',
              gap: '1rem',
              boxShadow: '0 1px 2px 0 rgba(0, 0, 0, 0.05)'
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
              <span style={{ fontSize: '1.25rem' }}>
                {vaultStatus === 'mismatch' ? '⚠️' : '🔑'}
              </span>
              <div style={{ fontSize: '0.875rem', color: vaultStatus === 'mismatch' ? '#9f1239' : '#1e40af' }}>
                {vaultStatus === 'mismatch' ? (
                  <>
                    <strong>Vault Key Mismatch:</strong> This browser does not hold the private key for your registered vault key. Documents sent to that key cannot be opened on this device.
                  </>
                ) : (
                  <>
                    <strong>Enable Secure Delivery:</strong> Set up a browser vault key so senders can deliver documents directly without sharing a QR code.
                  </>
                )}
              </div>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', flexShrink: 0 }}>
              <button
                type="button"
                onClick={() => setShowVaultKeyModal(true)}
                className={`btn ${vaultStatus === 'mismatch' ? 'btn-secondary' : 'btn-primary'}`}
                style={{
                  padding: '0.35rem 0.85rem',
                  fontSize: '0.8rem',
                  width: 'auto',
                  borderColor: vaultStatus === 'mismatch' ? '#f43f5e' : undefined,
                  color: vaultStatus === 'mismatch' ? '#be123c' : undefined
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
                  color: '#64748b',
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
                  <h2 style={{ fontSize: '1.15rem', fontWeight: 700, margin: 0, color: '#0f172a' }}>
                    Received Cryptographic Documents
                  </h2>
                  <button
                    type="button"
                    onClick={refresh}
                    className="btn btn-secondary"
                    style={{ padding: '0.35rem 0.75rem', fontSize: '0.8rem', width: 'auto' }}
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
                  <h2 style={{ fontSize: '1.15rem', fontWeight: 700, margin: 0, color: '#0f172a' }}>
                    Sent Sealed Documents
                  </h2>
                  <button
                    type="button"
                    onClick={refresh}
                    className="btn btn-secondary"
                    style={{ padding: '0.35rem 0.75rem', fontSize: '0.8rem', width: 'auto' }}
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
              <div
                style={{
                  maxWidth: '680px',
                  margin: '0 auto',
                  backgroundColor: '#ffffff',
                  border: '1px solid #e2e8f0',
                  borderRadius: '12px',
                  padding: '2rem',
                  boxShadow: '0 4px 6px -1px rgba(0, 0, 0, 0.05)'
                }}
              >
                <div style={{ marginBottom: '1.5rem' }}>
                  <h2 style={{ fontSize: '1.25rem', fontWeight: 700, margin: '0 0 0.4rem 0', color: '#0f172a' }}>
                    Seal &amp; Send Document
                  </h2>
                  <p style={{ margin: 0, fontSize: '0.875rem', color: '#64748b' }}>
                    Documents are encrypted with AES-256-GCM. The encryption key is displayed only once to you and is never stored on the server.
                  </p>
                </div>
                <UploadForm onSuccess={handleUploadSuccess} />
              </div>
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
