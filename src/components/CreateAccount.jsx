import React, { useState } from 'react';
import Arweave from 'arweave';
import PasswordSetup from './PasswordSetup';
import { ARWEAVE_CONFIG } from '../utils/config';
import { downloadKeyfile } from '../utils/account';

export default function CreateAccount({ onBack, onWalletGenerated, onConnectWallet }) {
  const [stage, setStage] = useState('initial'); // 'initial', 'generating', 'generated', 'password_setup'
  const [wallet, setWallet] = useState(null);
  const [showWarningModal, setShowWarningModal] = useState(false);
  const [hasAgreed, setHasAgreed] = useState(false);

  const handleGenerate = async () => {
    setStage('generating');
    console.log('--- STARTING WALLET GENERATION ---');
    try {
      console.log('1. Initializing Arweave connection...');
      const arweave = Arweave.init(ARWEAVE_CONFIG.gateway);

      console.log('2. Generating new JWK...');
      const key = await arweave.wallets.generate();

      console.log('3. Deriving public address from JWK...');
      const address = await arweave.wallets.jwkToAddress(key);

      console.log('-> Wallet generated successfully!');
      console.log('-> Public Address:', address);

      setWallet(key);
      setStage('generated');

      if (onWalletGenerated) {
        onWalletGenerated(key, address);
      }
    } catch (error) {
      console.error('❌ Failed to generate wallet', error);
      setStage('initial');
    }
  };

  const handleDownloadKey = () => {
    if (!wallet) return;
    downloadKeyfile(wallet);
  };

  const handleOpenWarning = () => {
    setHasAgreed(false);
    setShowWarningModal(true);
  };

  const handleConfirmWarning = () => {
    setShowWarningModal(false);
    setStage('password_setup');
  };

  if (stage === 'password_setup') {
    return (
      <PasswordSetup
        walletKey={wallet}
        onBack={() => setStage('generated')}
        onReturnToDashboard={onBack}
        onComplete={(_encryptedWallet, _email) => {
          console.log("Password setup complete. Ready to store in DB!");
        }}
      />
    );
  }

  if (stage === 'generating') {
    return (
      <div className="glass-card text-center">
        <div className="flex mb-6">
          <button className="btn-ghost" onClick={() => setStage('initial')}>
            <i className="icon-arrow-left2"></i> Back
          </button>
        </div>
        <div className="mb-6">
          <i className="icon-spinner-double animate-spin" style={{ fontSize: '3rem', color: 'var(--accent)', display: 'inline-block' }}></i>
        </div>
        <h2>Generating Wallet...</h2>
        <p>Please wait while we create your secure Arweave identity.</p>
      </div>
    );
  }

  if (stage === 'generated') {
    return (
      <>
        <div className="glass-card text-center">
          <div className="flex mb-6">
            <button className="btn-ghost" onClick={() => setStage('initial')}>
              <i className="icon-arrow-left2"></i> Back
            </button>
          </div>
          <div className="mb-6">
            <i className="icon-check-circle" style={{ fontSize: '3rem', color: '#10b981' }}></i>
          </div>
          <h2>Wallet Generated!</h2>
          <p>Your new Arweave wallet has been created successfully.</p>
          <div className="flex flex-col gap-4 mt-6">
            <button className="btn-primary" onClick={handleDownloadKey}>
              Download Key File
            </button>
            <button className="btn-secondary" onClick={handleOpenWarning}>
              Continue with password ⚠️
            </button>
          </div>
        </div>

        {/* Security Warning Modal */}
        {showWarningModal && (
          <div className="modal-backdrop" onClick={() => setShowWarningModal(false)}>
            <div className="modal-container" onClick={(e) => e.stopPropagation()}>
              <div className="modal-header">
                <h3 className="modal-title">
                  <i className="icon-shield" style={{ fontSize: '1.25rem' }}></i>
                  Important Security Notice
                </h3>
                <button
                  type="button"
                  className="modal-close-btn"
                  onClick={() => setShowWarningModal(false)}
                  aria-label="Close"
                >
                  ✕
                </button>
              </div>

              <div className="modal-scroll-body">
                <div className="warning-callout">
                  ⚠️ Please read this notice carefully before storing your wallet on the public Permaweb.
                </div>

                <div className="warning-item">
                  <div className="warning-item-title">
                    🌐 1. Public & Permanent Storage
                  </div>
                  <p className="warning-item-desc">
                    Your wallet key will be encrypted using the password you set, but the resulting encrypted file is uploaded directly to the <strong>Arweave permaweb</strong>. Arweave is a decentralized, public, and permanent blockchain. The encrypted file is visible to anyone in the world forever and cannot be deleted or modified.
                  </p>
                </div>

                <div className="warning-item">
                  <div className="warning-item-title">
                    🚫 2. No "Forgot Password" or Recovery Service
                  </div>
                  <p className="warning-item-desc">
                    This application is fully permissionless and non-custodial. There is <strong>no central server, database, or company</strong> holding your password or key. If you lose or forget your password, <strong>you will permanently lose access to your wallet and all funds inside it</strong>. No one can reset it for you.
                  </p>
                </div>

                <div className="warning-item">
                  <div className="warning-item-title">
                    🔓 3. Risk of Theft from Weak Passwords
                  </div>
                  <p className="warning-item-desc">
                    Because the encrypted data is permanently available on a public ledger, attackers can download it and attempt to crack it offline. If you choose a weak, short, or reused password, an unauthorized party could guess it, decrypt your private key, and <strong>steal all your assets and tokens</strong>.
                  </p>
                </div>

                <div className="warning-item">
                  <div className="warning-item-title">
                    💡 4. What You Should Do
                  </div>
                  <p className="warning-item-desc">
                    • Choose a <strong>long, unique passphrase</strong> with uppercase letters, numbers, and symbols.<br />
                    • Store your password securely in a reliable password manager.<br />
                    • We strongly recommend also clicking <strong>"Download Key File"</strong> to keep an unencrypted local backup on your computer.
                  </p>
                </div>

                <div style={{
                  marginTop: '0.75rem',
                  marginBottom: '1rem',
                  padding: '0.85rem 1rem',
                  background: 'rgba(59, 130, 246, 0.08)',
                  border: '1px solid rgba(59, 130, 246, 0.25)',
                  borderRadius: '12px'
                }}>
                  <div style={{ fontWeight: 600, color: 'var(--accent)', fontSize: '0.85rem', marginBottom: '0.25rem' }}>
                    Prefer to keep full self-custody?
                  </div>
                  <p style={{ fontSize: '0.8rem', color: 'var(--text-secondary)', margin: '0 0 0.6rem 0', lineHeight: 1.5 }}>
                    If you prefer not to store your encrypted key on Arweave, you can download your key file now and manage it directly using a browser extension like Wander or an offline wallet.
                  </p>
                  <button
                    type="button"
                    className="btn-secondary"
                    onClick={handleDownloadKey}
                    style={{ fontSize: '0.85rem', padding: '0.6rem 1rem', width: 'auto' }}
                  >
                    <i className="icon-download"></i> Download Key File Now
                  </button>
                </div>

                <label
                  className="modal-agreement"
                  htmlFor="agree-risk-radio"
                  onClick={() => setHasAgreed(true)}
                >
                  <input
                    type="radio"
                    id="agree-risk-radio"
                    name="security-acknowledgement"
                    checked={hasAgreed}
                    onChange={() => setHasAgreed(true)}
                  />
                  <div className="modal-agreement-text">
                    <strong>I understand</strong> that my encrypted key is stored publicly on the permaweb, that there is no password reset, and that losing my password or using a weak password can result in the permanent loss of my wallet and funds.
                  </div>
                </label>
              </div>

              <div className="modal-footer" style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem', width: 'auto', alignItems: 'center' }}>
                <button
                  type="button"
                  className="btn-secondary"
                  onClick={handleDownloadKey}
                  style={{ width: '100%', fontSize: '0.85rem', padding: '0.65rem 1rem' }}
                  title="Download unencrypted key file"
                >
                  <i className="icon-download"></i> Download Key File
                </button>

                <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem', width: '100%', alignItems: 'center' }}>
                  {hasAgreed && (
                    <button
                      type="button"
                      className="btn-primary"
                      style={{ width: '100%' }}
                      onClick={handleConfirmWarning}
                    >
                      Agree & Continue
                    </button>
                  )}
                  <button
                    type="button"
                    className="btn-ghost"
                    style={{ width: '100%' }}
                    onClick={() => setShowWarningModal(false)}
                  >
                    Cancel
                  </button>
                </div>
              </div>
            </div>
          </div>
        )}
      </>
    );
  }

  return (
    <div className="glass-card">
      <button className="btn-ghost mb-6" onClick={onBack}>
        <i className="icon-arrow-left2"></i> Back
      </button>
      <h2>Create New Account</h2>
      <p>Generate a new secure identity on the Permaweb.</p>

      <button
        type="button"
        className="btn-primary mt-4"
        onClick={onConnectWallet}
      >
        <i className="icon-wander1"></i> Connect Wallet
      </button>

      <button
        type="button"
        className="btn-primary mt-4"
        onClick={handleGenerate}
      >
        Generate New Account (Key File)
      </button>
    </div>
  );
}
