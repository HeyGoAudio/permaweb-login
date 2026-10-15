import React, { useState, useEffect, useCallback, useRef } from 'react';
import {
  fetchProfile,
  publishProfile,
  uploadProfileMedia,
  resolveArweaveUri,
  DEFAULT_AVATAR,
  DEFAULT_BANNER
} from '../utils/profile';
import Data from '../../vendor/arweave-account/src/data';
import ImageCropper from './ImageCropper';

export default function ProfileManager({
  walletAddress,
  walletKey,
  userEmail = '',
  onNavigate,
  onProfileUpdated,
  onClose
}) {
  const [activeTab, setActiveTab] = useState('view'); // 'view' | 'edit' | 'json'
  const [isLoading, setIsLoading] = useState(true);
  const [accountData, setAccountData] = useState(null);

  // Form fields
  const [formData, setFormData] = useState({
    handleName: '',
    name: '',
    bio: '',
    avatar: DEFAULT_AVATAR,
    banner: DEFAULT_BANNER,
    email: userEmail || '',
    links: {
      twitter: '',
      github: '',
      instagram: '',
      discord: '',
      linkedin: '',
      facebook: '',
      youtube: '',
      twitch: '',
    },
    wallets: {
      eth: '',
    },
  });

  // Action states
  const [isPublishing, setIsPublishing] = useState(false);
  const [publishStep, setPublishStep] = useState('');
  const [publishSuccess, setPublishSuccess] = useState(null);
  const [errorMessage, setErrorMessage] = useState('');
  const [uploadingTarget, setUploadingTarget] = useState(null); // 'avatar' | 'banner' | null
  const [mediaUploadStatus, setMediaUploadStatus] = useState('');
  const [cropRequest, setCropRequest] = useState(null); // { file: File, target: 'avatar' | 'banner' } | null

  // Copy status
  const [copiedHandle, setCopiedHandle] = useState(false);
  const [copiedTx, setCopiedTx] = useState(false);
  const [copiedJson, setCopiedJson] = useState(false);

  const avatarInputRef = useRef(null);
  const bannerInputRef = useRef(null);

  // Load profile from Arweave network
  const loadProfile = useCallback(async () => {
    if (!walletAddress) return;
    setIsLoading(true);
    setErrorMessage('');
    try {
      console.log('Fetching arweave-account profile for:', walletAddress);
      const acc = await fetchProfile(walletAddress);
      console.log('Fetched profile response:', acc);
      setAccountData(acc);
      if (onProfileUpdated) {
        onProfileUpdated(acc);
      }

      if (acc && acc.profile) {
        setFormData({
          handleName: acc.profile.handleName || '',
          name: acc.profile.name || '',
          bio: acc.profile.bio || '',
          avatar: acc.profile.avatar || DEFAULT_AVATAR,
          banner: acc.profile.banner || DEFAULT_BANNER,
          email: acc.profile.email || userEmail || '',
          links: {
            twitter: acc.profile.links?.twitter || '',
            github: acc.profile.links?.github || '',
            instagram: acc.profile.links?.instagram || '',
            discord: acc.profile.links?.discord || '',
            linkedin: acc.profile.links?.linkedin || '',
            facebook: acc.profile.links?.facebook || '',
            youtube: acc.profile.links?.youtube || '',
            twitch: acc.profile.links?.twitch || '',
          },
          wallets: {
            eth: acc.profile.wallets?.eth || '',
          },
        });
      }
    } catch (err) {
      console.warn('Could not load profile:', err);
      setErrorMessage('Failed to fetch profile from Arweave. Defaults loaded.');
    } finally {
      setIsLoading(false);
    }
  }, [walletAddress, userEmail, onProfileUpdated]);

  useEffect(() => {
    loadProfile();
  }, [loadProfile]);

  // Step 1: file picked -> open the crop/zoom editor
  const handleMediaSelect = (e, target) => {
    const file = e.target.files?.[0];
    if (e.target) e.target.value = ''; // allow re-selecting the same file
    if (!file) return;

    if (!file.type.startsWith('image/')) {
      setErrorMessage('Please select an image file.');
      return;
    }

    setErrorMessage('');
    setCropRequest({ file, target });
  };

  // Step 2: cropper returns a compressed WebP blob -> upload to Arweave
  const handleCropConfirm = async (compressed) => {
    const target = cropRequest?.target;
    setCropRequest(null);
    if (!target) return;

    setUploadingTarget(target);
    setMediaUploadStatus(!walletKey ? 'Awaiting signature in Wander...' : 'Preparing upload...');
    setErrorMessage('');

    try {
      console.log(
        `Uploading ${target} to Arweave permaweb (${compressed.bytes} bytes, ${compressed.mimeType}` +
        `${compressed.original ? ', original/uncompressed' : ''})`,
      );
      const result = await uploadProfileMedia(compressed.blob, walletKey, {
        allowOversize: Boolean(compressed.original),
        onStatus: (status) => setMediaUploadStatus(status),
      });
      console.log(`✅ ${target} uploaded successfully:`, result);

      setFormData((prev) => ({
        ...prev,
        [target]: result.uri,
      }));
    } catch (err) {
      console.error(`Media upload error (${target}):`, err);
      setErrorMessage(err.message || `Failed to upload ${target} image.`);
    } finally {
      setUploadingTarget(null);
      setMediaUploadStatus('');
    }
  };

  // Derive unique handle for preview
  const liveUniqueHandle = formData.handleName
    ? `@${formData.handleName}#${walletAddress.slice(0, 3)}${walletAddress.slice(-3)}`
    : `${walletAddress.slice(0, 5)}...${walletAddress.slice(-5)}`;

  // Derive encoded JSON payload per protocol
  const encodedPayload = Data.encodeForStorage({
    handleName: formData.handleName,
    name: formData.name,
    bio: formData.bio,
    avatar: formData.avatar,
    banner: formData.banner,
    email: formData.email,
    links: formData.links,
    wallets: formData.wallets,
    avatarURL: resolveArweaveUri(formData.avatar),
    bannerURL: resolveArweaveUri(formData.banner),
  });

  // Handle Publishing
  const handlePublish = async (e) => {
    if (e) e.preventDefault();
    setErrorMessage('');
    setPublishSuccess(null);

    const handle = formData.handleName.trim();
    if (!handle) {
      setErrorMessage('Please specify a Handle Name (e.g. satoshi) to publish your profile.');
      setActiveTab('edit');
      return;
    }

    if (!/^[a-zA-Z0-9_-]+$/.test(handle)) {
      setErrorMessage('Handle can only contain letters, numbers, underscores, and dashes.');
      setActiveTab('edit');
      return;
    }

    setIsPublishing(true);
    setPublishStep(
      !walletKey
        ? 'Awaiting signature in Wander...'
        : 'Preparing Arweave-Account Protocol transaction...'
    );

    try {
      const res = await publishProfile(formData, walletKey, walletAddress, {
        onStatus: (step) => setPublishStep(step),
      });

      setPublishStep('Hydrating cache...');
      setPublishSuccess(res);
      setAccountData(res.account);

      if (onProfileUpdated) {
        onProfileUpdated(res.account);
      }

      console.log('✅ Publication workflow finished. Tx ID:', res.txId);
    } catch (err) {
      console.error('Publication failed:', err);
      setErrorMessage(err.message || 'Failed to publish profile to Arweave.');
    } finally {
      setIsPublishing(false);
      setPublishStep('');
    }
  };

  const handleCopyHandle = async () => {
    const handleToCopy = accountData?.handle || liveUniqueHandle;
    try {
      await navigator.clipboard.writeText(handleToCopy);
      setCopiedHandle(true);
      setTimeout(() => setCopiedHandle(false), 2000);
    } catch {
      setCopiedHandle(false);
    }
  };

  const handleCopyTx = async (txId) => {
    if (!txId) return;
    try {
      await navigator.clipboard.writeText(txId);
      setCopiedTx(true);
      setTimeout(() => setCopiedTx(false), 2000);
    } catch {
      setCopiedTx(false);
    }
  };

  const handleCopyJson = async () => {
    try {
      await navigator.clipboard.writeText(JSON.stringify(encodedPayload, null, 2));
      setCopiedJson(true);
      setTimeout(() => setCopiedJson(false), 2000);
    } catch {
      setCopiedJson(false);
    }
  };

  const handleDownloadJson = () => {
    const fileName = `arweave-account-${formData.handleName || 'profile'}.json`;
    const blob = new Blob([JSON.stringify(encodedPayload, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = fileName;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  const bannerDisplayUrl = resolveArweaveUri(formData.banner) || 'https://arweave.net/a0ieiziq2JkYhWamlrUCHxrGYnHWUAMcONxRmfkWt-k';
  const avatarDisplayUrl = resolveArweaveUri(formData.avatar) || 'https://arweave.net/OrG-ZG2WN3wdcwvpjz1ihPe4MI24QBJUpsJGIdL85wA';

  const hasOnChainProfile = Boolean(accountData && accountData.txid);

  if (isLoading) {
    return (
      <div className="glass-card text-center" style={{ maxWidth: '620px', margin: '2rem auto' }}>
        <div className="mb-6">
          <i className="icon-spinner-double animate-spin" style={{ fontSize: '3rem', color: 'var(--accent)', display: 'inline-block' }}></i>
        </div>
        <h2>Loading Permaweb Profile...</h2>
        <p>Querying Arweave gateways for your on-chain account protocol data.</p>
      </div>
    );
  }

  return (
    <div className="profile-manager-container">
      {/* Top Protocol Header */}
      <div className="profile-nav-bar">


        {/* Tab Switcher */}
        <div className="profile-tabs" role="tablist">
          <button
            type="button"
            role="tab"
            aria-selected={activeTab === 'view'}
            className={`profile-tab-btn ${activeTab === 'view' ? 'active' : ''}`}
            onClick={() => setActiveTab('view')}
          >
            <i className="icon-user" style={{ fontSize: '1.4rem' }}></i>
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={activeTab === 'edit'}
            className={`profile-tab-btn ${activeTab === 'edit' ? 'active' : ''}`}
            onClick={() => setActiveTab('edit')}
          >
            <i className="icon-pencil-edit" style={{ fontSize: '1.4rem' }}></i>
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={activeTab === 'json'}
            className={`profile-tab-btn ${activeTab === 'json' ? 'active' : ''}`}
            onClick={() => setActiveTab('json')}
          >
            <i className="icon-bullet-list" style={{ fontSize: '1.4rem' }}></i>
          </button>
        </div>

        {onClose && (
          <button
            type="button"
            className="modal-close-btn"
            onClick={onClose}
            aria-label="Close profile"
            title="Close"
          >
            ✕
          </button>
        )}
      </div>

      {/* Uploading / Awaiting Wander Signature Banner */}
      {uploadingTarget && (
        <div className="profile-alert profile-alert-info" style={{ background: 'rgba(56, 189, 248, 0.1)', borderColor: 'rgba(56, 189, 248, 0.3)', color: '#38bdf8' }}>
          <i className="icon-spinner-double animate-spin"></i>
          <span>
            {mediaUploadStatus || `Processing ${uploadingTarget} upload...`}
          </span>
        </div>
      )}

      {/* Publishing with Wander / Awaiting Signature Banner */}
      {isPublishing && !walletKey && (
        <div className="profile-alert profile-alert-info" style={{ background: 'rgba(56, 189, 248, 0.1)', borderColor: 'rgba(56, 189, 248, 0.3)', color: '#38bdf8' }}>
          <i className="icon-spinner-double animate-spin"></i>
          <span>
            {publishStep || 'Awaiting signature in Wander...'}
          </span>
        </div>
      )}

      {/* Global Notification Banner */}
      {errorMessage && (
        <div className="profile-alert profile-alert-error">
          <i className="icon-circle-info-solid"></i>
          <span>{errorMessage}</span>
          <button type="button" className="alert-close" onClick={() => setErrorMessage('')}>✕</button>
        </div>
      )}

      {publishSuccess && (
        <div className="profile-alert profile-alert-success">

          <div style={{ flex: 1, flexDirection: "column", overflow: 'hidden', paddingRight: '0.5rem' }}>
            <i className="icon-check-circle" style={{ color: '#10b981', fontSize: '1.2rem', marginRight: '0.4rem' }}></i>
            <strong>Profile Published to the Permaweb!</strong>
            <div style={{ fontSize: '0.8rem', marginTop: '0.2rem', wordBreak: 'keep-all', overflowWrap: 'none', textOverflow: 'ellipsis', overflow: 'hidden', whiteSpace: 'nowrap', maxWidth: '300px' }}>
              Transaction ID: <span style={{ fontFamily: 'monospace' }}>{publishSuccess.txId}</span>


            </div>
          </div>
          <div style={{ display: 'flex', gap: '0.5rem' }}>

          </div>
        </div>
      )}

      {/* TAB 1: PREVIEW / CARD VIEW */}
      {activeTab === 'view' && (
        <div className="profile-card-view">
          {/* Cover Banner */}
          <div className="profile-banner-hero" style={{ backgroundImage: `url(${bannerDisplayUrl})` }}>
            <div className="profile-banner-overlay"></div>
            {hasOnChainProfile ? (
              <span className="profile-status-pill on-chain">
                <i className="icon-check-circle"></i> Active
              </span>
            ) : (
              <span className="profile-status-pill draft">
                <i className="icon-bolt"></i> Ready to Publish
              </span>
            )}
          </div>

          {/* Profile Identity Bar */}
          <div className="profile-hero-content">
            <div className="profile-avatar-container">
              <img
                src={avatarDisplayUrl}
                alt={formData.name || 'User Avatar'}
                className="profile-avatar-img"
                onError={(e) => {
                  e.target.onerror = null;
                  e.target.src = 'https://arweave.net/OrG-ZG2WN3wdcwvpjz1ihPe4MI24QBJUpsJGIdL85wA';
                }}
              />
              <span className="profile-online-badge"></span>
            </div>

            <div className="profile-hero-info">
              <div className="profile-name-row">
                <h2 className="profile-display-name">
                  {formData.name || formData.handleName || 'Anonymous Permaweb User'}
                </h2>
              </div>

              {/* Unique Handle badge */}
              <div className="profile-handle-badge-wrap">
                <button
                  type="button"
                  className="profile-handle-pill"
                  onClick={handleCopyHandle}
                  title="Click to copy unique handle"
                >
                  <span className="handle-text">
                    {accountData?.handle || liveUniqueHandle}
                  </span>
                  <i className={copiedHandle ? 'icon-checkmark' : 'icon-copy'}></i>
                  {copiedHandle && <span className="copied-tag">Copied!</span>}
                </button>
              </div>

              {/* Bio */}
              <p className="profile-bio-text">
                {formData.bio || 'No biography set yet. Click "Edit Profile" to share your story on the permaweb.'}
              </p>
            </div>
          </div>

          {/* Social Links Row */}
          <div className="profile-social-section">
            <h4 className="section-title">Social Links</h4>
            <div className="social-pills-row">
              {formData.links?.twitter && (
                <a
                  href={`https://twitter.com/${formData.links.twitter.replace(/^@/, '')}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="social-pill"
                >
                  <i className="icon-xitter"></i> @{formData.links.twitter.replace(/^@/, '')}
                </a>
              )}
              {formData.links?.github && (
                <a
                  href={`https://github.com/${formData.links.github}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="social-pill"
                >
                  <i className="icon-github"></i> {formData.links.github}
                </a>
              )}
              {formData.links?.discord && (
                <span className="social-pill">
                  <i className="icon-discord"></i> {formData.links.discord}
                </span>
              )}
              {formData.links?.instagram && (
                <a
                  href={`https://instagram.com/${formData.links.instagram.replace(/^@/, '')}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="social-pill"
                >
                  <i className="icon-instagram"></i> {formData.links.instagram}
                </a>
              )}
              {formData.links?.linkedin && (
                <a
                  href={formData.links.linkedin.startsWith('http') ? formData.links.linkedin : `https://linkedin.com/in/${formData.links.linkedin}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="social-pill"
                >
                  <i className="icon-linkedin"></i> LinkedIn
                </a>
              )}
              {formData.links?.youtube && (
                <a
                  href={formData.links.youtube.startsWith('http') ? formData.links.youtube : `https://youtube.com/@${formData.links.youtube}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="social-pill"
                >
                  <i className="icon-youtube"></i> YouTube
                </a>
              )}
              {formData.links?.twitch && (
                <a
                  href={`https://twitch.tv/${formData.links.twitch}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="social-pill"
                >
                  <i className="icon-twitch"></i> {formData.links.twitch}
                </a>
              )}
              {formData.links?.facebook && (
                <span className="social-pill">
                  <i className="icon-facebook"></i> Facebook
                </span>
              )}

              {!Object.values(formData.links || {}).some(Boolean) && (
                <span className="text-muted" style={{ fontSize: '0.85rem' }}>
                  No social profiles linked yet. Add Twitter, GitHub, or Discord in Edit mode!
                </span>
              )}
            </div>
          </div>

          {/* Details & Metadata Grid */}
          <div className="profile-details-grid">
            {/* Wallet Address card */}
            <div className="profile-detail-card">
              <div className="detail-card-label">
                <i className="icon-arweave-logo-light"></i> Arweave Address
              </div>
              <div className="detail-card-value font-mono" style={{ wordBreak: 'break-all', textOverflow: "ellipsis", whiteSpace: "nowrap", overflow: "hidden" }}>
                {walletAddress}
              </div>
            </div>

            {/* Transaction ID if published */}
            {accountData?.txid && (
              <div className="profile-detail-card">
                <div className="detail-card-label">
                  <i className="icon-cloud-done"></i> Profile Transaction
                </div>
                <div className="detail-card-value font-mono">
                  <a
                    href={`https://arweave.net/${accountData.txid}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="font-mono text-accent"
                  >
                    {accountData.txid.slice(0, 8)}...{accountData.txid.slice(-8)}
                  </a>
                  <button
                    type="button"
                    className="copy-btn-mini"
                    onClick={() => handleCopyTx(accountData.txid)}
                    title="Copy Tx ID"
                  >
                    <i className={copiedTx ? 'icon-checkmark' : 'icon-copy'}></i>
                  </button>
                </div>
              </div>
            )}

            {/* Ethereum wallet if set */}
            {formData.wallets?.eth && (
              <div className="profile-detail-card">
                <div className="detail-card-label">
                  <i className="icon-bolt-circle"></i> Ethereum Wallet
                </div>
                <div className="detail-card-value font-mono">
                  {formData.wallets.eth}
                </div>
              </div>
            )}
          </div>

          {/* Actions Footer */}
          <div className="profile-actions-bar">

            <button
              type="button"
              className="btn-secondary"
              onClick={() => setActiveTab('edit')}
            >
              <i className="icon-pencil-edit"></i> Edit
            </button>

            <button
              type="button"
              className="btn-primary"
              onClick={handlePublish}
              disabled={isPublishing || !formData.handleName}
            >
              {isPublishing ? (
                <>
                  <i className="icon-spinner-double animate-spin"></i>
                  {publishStep || 'Publishing...'}
                </>
              ) : (
                <>
                  <i className="icon-cloud-upload"></i>
                  {hasOnChainProfile ? 'Save' : 'Publish Profile'}
                </>
              )}
            </button>
          </div>
        </div>
      )}

      {/* TAB 2: EDIT PROFILE FORM */}
      {activeTab === 'edit' && (
        <form onSubmit={handlePublish} className="profile-edit-form">
          <div className="form-section-card">
            <h3 className="form-section-title">
              <i className="icon-user"></i> Core Identity
            </h3>

            {/* Handle Name */}
            <div className="input-group">
              <label htmlFor="input-handleName" className="input-label">
                Handle Name <span className="required-star">*</span>
              </label>
              <div className="input-prefix-wrap">
                <span className="input-prefix">@</span>
                <input
                  id="input-handleName"
                  type="text"
                  className="input-field prefixed"
                  placeholder="e.g. satoshi"
                  value={formData.handleName}
                  onChange={(e) => setFormData({ ...formData, handleName: e.target.value.replace(/[^a-zA-Z0-9_-]/g, '') })}
                  required
                />
              </div>
              <div className="input-hint" style={{ fontSize: '0.8rem', marginBottom: '0.8rem' }}>
                Unique Handle: <strong className="text-primary">{liveUniqueHandle}</strong>

              </div>
            </div>

            {/* Display Name */}
            <div className="input-group">
              <label htmlFor="input-displayName" className="input-label">
                Display Name
              </label>
              <input
                id="input-displayName"
                type="text"
                className="input-field"
                placeholder="e.g. Satoshi Nakamoto"
                value={formData.name}
                onChange={(e) => setFormData({ ...formData, name: e.target.value })}
              />
            </div>

            {/* Biography */}
            <div className="input-group">
              <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                <label htmlFor="input-bio" className="input-label">Bio</label>
                <span className="char-count">{formData.bio.length}/280</span>
              </div>
              <textarea
                id="input-bio"
                className="input-textarea"
                rows="3"
                maxLength="280"
                placeholder="Tell the permaweb community about yourself..."
                value={formData.bio}
                onChange={(e) => setFormData({ ...formData, bio: e.target.value })}
              ></textarea>
            </div>
          </div>

          {/* Visual Assets Section */}
          <div className="form-section-card">
            <h3 className="form-section-title">
              <i className="icon-image"></i> Visual Identity
            </h3>

            {/* Avatar Input & Uploader */}
            <div className="input-group">
              <label htmlFor="input-avatar" className="input-label">Avatar Image URI</label>
              <div style={{ display: 'flex', gap: '0.75rem', alignItems: 'center', marginBottom: '0.8rem' }}>
                <img
                  src={avatarDisplayUrl}
                  alt="Avatar Preview"
                  className="mini-preview-avatar"
                  onError={(e) => {
                    e.target.onerror = null;
                    e.target.src = 'https://arweave.net/OrG-ZG2WN3wdcwvpjz1ihPe4MI24QBJUpsJGIdL85wA';
                  }}
                />
                <input
                  id="input-avatar"
                  type="text"
                  className="input-field"
                  placeholder="ar://... or https://..."
                  value={formData.avatar}
                  onChange={(e) => setFormData({ ...formData, avatar: e.target.value })}
                />
                <input
                  type="file"
                  ref={avatarInputRef}
                  style={{ display: 'none' }}
                  accept="image/png,image/jpeg,image/svg+xml,image/webp,image/gif"
                  onChange={(e) => handleMediaSelect(e, 'avatar')}
                />
                <button
                  type="button"
                  className="btn-secondary"
                  style={{ whiteSpace: 'nowrap', padding: '0.75rem 1rem' }}
                  onClick={() => avatarInputRef.current?.click()}
                  disabled={uploadingTarget === 'avatar'}
                  title="Upload image directly to Arweave permaweb"
                >
                  {uploadingTarget === 'avatar' ? (
                    <><i className="icon-spinner-double animate-spin"></i> Uploading...</>
                  ) : (
                    <><i className="icon-cloud-upload"></i> Upload</>
                  )}
                </button>
              </div>
            </div>

            {/* Banner Input & Uploader */}
            <div className="input-group">
              <label htmlFor="input-banner" className="input-label">Banner Image URI</label>
              <div style={{ display: 'flex', gap: '0.75rem', alignItems: 'center' }}>
                <div
                  className="mini-preview-banner"
                  style={{ backgroundImage: `url(${bannerDisplayUrl})` }}
                ></div>
                <input
                  id="input-banner"
                  type="text"
                  className="input-field"
                  placeholder="ar://... or https://..."
                  value={formData.banner}
                  onChange={(e) => setFormData({ ...formData, banner: e.target.value })}
                />
                <input
                  type="file"
                  ref={bannerInputRef}
                  style={{ display: 'none' }}
                  accept="image/png,image/jpeg,image/svg+xml,image/webp,image/gif"
                  onChange={(e) => handleMediaSelect(e, 'banner')}
                />
                <button
                  type="button"
                  className="btn-secondary"
                  style={{ whiteSpace: 'nowrap', padding: '0.75rem 1rem' }}
                  onClick={() => bannerInputRef.current?.click()}
                  disabled={uploadingTarget === 'banner'}
                  title="Upload banner directly to Arweave permaweb"
                >
                  {uploadingTarget === 'banner' ? (
                    <><i className="icon-spinner-double animate-spin"></i> Uploading...</>
                  ) : (
                    <><i className="icon-cloud-upload"></i> Upload</>
                  )}
                </button>
              </div>
            </div>
            <span className="input-hint" style={{ fontSize: '0.8rem', color: 'var(--text-secondary)' }}>
              Accepts <code className="font-mono">ar://[txId]</code> or <code className="font-mono">https://...</code>. Uploads are cropped and compressed to WebP (under 100 KB) before saving to Arweave.
            </span>
          </div>

          {/* Social Profiles Section */}
          <div className="form-section-card">
            <h3 className="form-section-title">
              <i className="icon-link"></i> Social Profiles
            </h3>

            <div className="form-grid-2">
              <div className="input-group">
                <label htmlFor="input-twitter" className="input-label">
                  <i className="icon-xitter"></i> X / Twitter
                </label>
                <input
                  id="input-twitter"
                  type="text"
                  className="input-field"
                  placeholder="username (without @)"
                  value={formData.links.twitter}
                  onChange={(e) => setFormData({
                    ...formData,
                    links: { ...formData.links, twitter: e.target.value }
                  })}
                />
              </div>

              <div className="input-group">
                <label htmlFor="input-github" className="input-label">
                  <i className="icon-github"></i> GitHub
                </label>
                <input
                  id="input-github"
                  type="text"
                  className="input-field"
                  placeholder="github username"
                  value={formData.links.github}
                  onChange={(e) => setFormData({
                    ...formData,
                    links: { ...formData.links, github: e.target.value }
                  })}
                />
              </div>

              <div className="input-group">
                <label htmlFor="input-discord" className="input-label">
                  <i className="icon-discord"></i> Discord
                </label>
                <input
                  id="input-discord"
                  type="text"
                  className="input-field"
                  placeholder="username#0000"
                  value={formData.links.discord}
                  onChange={(e) => setFormData({
                    ...formData,
                    links: { ...formData.links, discord: e.target.value }
                  })}
                />
              </div>

              <div className="input-group">
                <label htmlFor="input-instagram" className="input-label">
                  <i className="icon-instagram"></i> Instagram
                </label>
                <input
                  id="input-instagram"
                  type="text"
                  className="input-field"
                  placeholder="username"
                  value={formData.links.instagram}
                  onChange={(e) => setFormData({
                    ...formData,
                    links: { ...formData.links, instagram: e.target.value }
                  })}
                />
              </div>

              <div className="input-group">
                <label htmlFor="input-linkedin" className="input-label">
                  <i className="icon-linkedin"></i> LinkedIn
                </label>
                <input
                  id="input-linkedin"
                  type="text"
                  className="input-field"
                  placeholder="username or profile URL"
                  value={formData.links.linkedin}
                  onChange={(e) => setFormData({
                    ...formData,
                    links: { ...formData.links, linkedin: e.target.value }
                  })}
                />
              </div>

              <div className="input-group">
                <label htmlFor="input-youtube" className="input-label">
                  <i className="icon-youtube"></i> YouTube
                </label>
                <input
                  id="input-youtube"
                  type="text"
                  className="input-field"
                  placeholder="handle or channel"
                  value={formData.links.youtube}
                  onChange={(e) => setFormData({
                    ...formData,
                    links: { ...formData.links, youtube: e.target.value }
                  })}
                />
              </div>
            </div>
          </div>

          {/* Crosschain Wallets */}
          <div className="form-section-card">
            <h3 className="form-section-title">
              <i className="icon-bolt-circle"></i> Cross-Chain Identities
            </h3>
            <div className="input-group">
              <label htmlFor="input-eth" className="input-label">Ethereum Address</label>
              <input
                id="input-eth"
                type="text"
                className="input-field font-mono"
                placeholder="0x..."
                value={formData.wallets.eth}
                onChange={(e) => setFormData({
                  ...formData,
                  wallets: { ...formData.wallets, eth: e.target.value }
                })}
              />
            </div>
          </div>

          {/* Action Footer */}
          <div className="profile-actions-bar">
            <button
              type="button"
              className="btn-secondary"
              onClick={() => setActiveTab('view')}
            >
              Cancel
            </button>

            <button
              type="submit"
              className="btn-primary"
              disabled={isPublishing || !formData.handleName}
            >
              {isPublishing ? (
                <>
                  <i className="icon-spinner-double animate-spin"></i>
                  {publishStep || 'Publishing...'}
                </>
              ) : (
                <>
                  <i className="icon-cloud-upload"></i>
                  Save
                </>
              )}
            </button>
          </div>
        </form>
      )}

      {/* TAB 3: RAW JSON PROTOCOL VIEW */}
      {activeTab === 'json' && (
        <div className="profile-json-view">
          <div className="json-header-bar">
            <div>
              <span className="font-semibold">arweave-account Protocol Payload</span>
              <p style={{ margin: '0.2rem 0 0', fontSize: '0.8rem', color: 'var(--text-secondary)' }}>
                This is the exact JSON structure written permanently to the Arweave blockchain with tag <code className="font-mono text-accent">Protocol-Name: Account-0.3</code>.
              </p>
            </div>

            <div style={{ display: 'flex', gap: '0.5rem' }}>
              <button
                type="button"
                className="btn-secondary"
                style={{ padding: '0.5rem 0.85rem', fontSize: '0.85rem' }}
                onClick={handleCopyJson}
                title="Copy JSON to Clipbord"
              >
                <i className={copiedJson ? 'icon-checkmark' : 'icon-copy'}></i>
                {copiedJson ? ' Copied!' : ' Copy'}
              </button>

              <button
                type="button"
                className="btn-secondary"
                style={{ padding: '0.5rem 0.85rem', fontSize: '0.85rem' }}
                onClick={handleDownloadJson}
                title="Download JSON file"
              >
                <i className="icon-download"></i> Download
              </button>
            </div>
          </div>

          <pre className="profile-code-block font-mono">
            {JSON.stringify(encodedPayload, null, 2)}
          </pre>

          <div className="profile-actions-bar mt-4">
            <button
              type="button"
              className="btn-secondary"
              onClick={() => setActiveTab('view')}
            >
              <i className="icon-user"></i>View
            </button>

            <button
              type="button"
              className="btn-primary"
              onClick={handlePublish}
              disabled={isPublishing || !formData.handleName}
            >
              {isPublishing ? (
                <>
                  <i className="icon-spinner-double animate-spin"></i>
                  {publishStep || 'Publishing...'}
                </>
              ) : (
                <>
                  <i className="icon-cloud-upload"></i> Save
                </>
              )}
            </button>
          </div>
        </div>
      )}

      {cropRequest && (
        <ImageCropper
          key={`${cropRequest.target}-${cropRequest.file.name}-${cropRequest.file.lastModified}`}
          file={cropRequest.file}
          preset={cropRequest.target}
          onConfirm={handleCropConfirm}
          onCancel={() => setCropRequest(null)}
        />
      )}
    </div>
  );
}
