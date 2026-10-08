import React, { useState } from 'react';
import Arweave from 'arweave';
import { CryptoService } from '../utils/crypto';
import { ARWEAVE_CONFIG } from '../utils/config';
import { downloadKeyfile } from '../utils/account';
import { createData, ArweaveSigner } from 'arbundles';

export default function RotateCredentials({
  currentWalletKey,
  currentAddress,
  userEmail,
  onBack,
  onMigrationComplete
}) {
  const [email, setEmail] = useState(userEmail || '');
  const [newPassword, setNewPassword] = useState('');
  const [confirmNewPassword, setConfirmNewPassword] = useState('');
  const [isProcessing, setIsProcessing] = useState(false);
  const [statusMessage, setStatusMessage] = useState('');
  const [error, setError] = useState('');
  const [successData, setSuccessData] = useState(null);

  const handleRotate = async (e) => {
    e.preventDefault();
    setError('');

    const trimmedEmail = email.trim();
    if (!trimmedEmail || !newPassword || !confirmNewPassword) {
      setError('Please fill in all fields.');
      return;
    }
    if (newPassword !== confirmNewPassword) {
      setError('New passwords do not match.');
      return;
    }

    const validation = CryptoService.validatePassword(newPassword);
    if (!validation.valid) {
      setError(validation.message);
      return;
    }

    setIsProcessing(true);
    console.log('--- STARTING ACCOUNT KEY ROTATION & MIGRATION ---');

    try {
      const arweave = Arweave.init(ARWEAVE_CONFIG.gateway);

      // 1. Generate fresh new Arweave Keypair
      setStatusMessage('1/4 Generating fresh Arweave wallet identity...');
      const newWalletKey = await arweave.wallets.generate();
      const newAddress = await arweave.wallets.jwkToAddress(newWalletKey);
      console.log('-> Generated New Wallet Address:', newAddress);

      // 2. Check and sweep old balance if any exists
      setStatusMessage('2/4 Checking balance & migrating assets...');
      let balanceSwept = '0';
      if (currentWalletKey && currentAddress) {
        try {
          const balanceWinston = await arweave.wallets.getBalance(currentAddress);
          if (BigInt(balanceWinston) > 0n) {
            const price = await arweave.transactions.getPrice(0, newAddress);
            const winstonToSend = BigInt(balanceWinston) - BigInt(price);
            if (winstonToSend > 0n) {
              const sweepTx = await arweave.createTransaction({
                target: newAddress,
                quantity: winstonToSend.toString()
              }, currentWalletKey);
              await arweave.transactions.sign(sweepTx, currentWalletKey);
              await arweave.transactions.post(sweepTx);
              balanceSwept = arweave.ar.winstonToAr(winstonToSend.toString());
              console.log(`-> Swept ${balanceSwept} AR from ${currentAddress} to ${newAddress}`);
            }
          }
        } catch (sweepErr) {
          console.warn('Balance check/sweep note:', sweepErr);
        }
      }

      // 3. Encrypt new key with Argon2id + derive new Account-ID
      setStatusMessage('3/4 Encrypting new key with Argon2id & deriving tags...');
      const encryptedWallet = await CryptoService.encrypt(newWalletKey, newPassword);
      const newAccountId = await CryptoService.deriveAccountId(trimmedEmail, newPassword);
      console.log('-> Derived New Account-ID:', newAccountId);

      // 4. Sign and dispatch using disposable ephemeral envelope signer
      setStatusMessage('4/4 Dispatching migration to Arweave permaweb...');
      const ephemeralEnvelopeKey = await arweave.wallets.generate();
      const signer = new ArweaveSigner(ephemeralEnvelopeKey);

      const dataItem = createData(JSON.stringify(encryptedWallet), signer, {
        tags: [
          { name: 'App-Name', value: 'Arweave-Login' },
          { name: 'Account-ID', value: newAccountId },
          { name: 'Content-Type', value: 'application/json' },
          { name: 'Account-Version', value: '0.2' },
          { name: 'KDF', value: 'Argon2id' },
          { name: 'Rotation-Prior-Address', value: currentAddress || 'unknown' }
        ]
      });
      await dataItem.sign(signer);

      const response = await fetch('https://up.arweave.net/tx', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/octet-stream',
          'Accept': 'application/json'
        },
        body: dataItem.getRaw()
      });

      if (response.status >= 200 && response.status < 300) {
        console.log('✅ KEY ROTATION SUCCESSFUL!');

        // Update browser password manager
        if (typeof window !== 'undefined' && window.PasswordCredential && navigator.credentials) {
          try {
            const credential = new window.PasswordCredential({
              id: trimmedEmail,
              password: newPassword,
              name: trimmedEmail
            });
            await navigator.credentials.store(credential);
          } catch {
            // Ignore optional browser credential storage errors
          }
        }

        setSuccessData({
          oldAddress: currentAddress,
          newAddress,
          newWalletKey,
          email: trimmedEmail,
          balanceSwept
        });
      } else {
        throw new Error(`Upload failed with status ${response.status}`);
      }
    } catch (err) {
      console.error('❌ Rotation failed:', err);
      setError(err.message || 'Key rotation failed. Please try again.');
    } finally {
      setIsProcessing(false);
      setStatusMessage('');
    }
  };

  const handleDownloadNewKey = () => {
    if (!successData?.newWalletKey) return;
    downloadKeyfile(successData.newWalletKey, successData.newAddress);
  };

  // Render: Success Screen with Migration Receipt
  if (successData) {
    return (
      <div className="glass-card text-center">
        <div className="mb-6">
          <i className="icon-check-circle" style={{ fontSize: '3rem', color: '#10b981', display: 'inline-block' }}></i>
        </div>
        <h2>Rotation & Migration Complete!</h2>
        <p className="mb-4">Your account credentials and permaweb key have been safely rotated.</p>

        <div style={{
          background: 'rgba(255, 255, 255, 0.03)',
          border: '1px solid var(--surface-border)',
          borderRadius: '16px',
          padding: '1rem',
          textAlign: 'left',
          marginBottom: '1.5rem',
          fontSize: '0.85rem'
        }}>
          <div style={{ marginBottom: '0.75rem' }}>
            <span style={{ color: 'var(--text-secondary)' }}>Previous Address (Decommissioned):</span>
            <div style={{ fontFamily: 'monospace', color: '#94a3b8', wordBreak: 'break-all', marginTop: '0.2rem' }}>
              {successData.oldAddress || 'N/A'}
            </div>
          </div>
          <div style={{ borderTop: '1px solid var(--surface-border)', paddingTop: '0.75rem', marginBottom: '0.5rem' }}>
            <span style={{ color: '#10b981', fontWeight: 600 }}>New Active Identity:</span>
            <div style={{ fontFamily: 'monospace', color: 'var(--text-primary)', wordBreak: 'break-all', marginTop: '0.2rem' }}>
              {successData.newAddress}
            </div>
          </div>
          {parseFloat(successData.balanceSwept) > 0 && (
            <div style={{ marginTop: '0.5rem', color: '#38bdf8' }}>
              ⚡ Swept {successData.balanceSwept} AR to new address.
            </div>
          )}
        </div>

        <div className="flex flex-col gap-3">
          <button className="btn-secondary" onClick={handleDownloadNewKey}>
            <i className="icon-download"></i> Download New Keyfile Backup
          </button>
          <button
            className="btn-primary"
            onClick={() => onMigrationComplete(successData.newWalletKey, successData.newAddress, successData.email)}
          >
            Continue to Dashboard
          </button>
        </div>
      </div>
    );
  }

  // Render: Form Screen
  return (
    <div className="glass-card">
      <button className="btn-ghost mb-4" onClick={onBack} disabled={isProcessing}>
        <i className="icon-arrow-left2"></i> Back
      </button>

      <h2>Rotate Password & Key</h2>
      
      {/* Security Advisory Box */}
      <div style={{
        background: 'rgba(59, 130, 246, 0.08)',
        border: '1px solid rgba(59, 130, 246, 0.25)',
        borderRadius: '14px',
        padding: '0.85rem 1rem',
        marginBottom: '1.25rem',
        fontSize: '0.85rem',
        lineHeight: '1.5'
      }}>
        <div style={{ fontWeight: 600, color: 'var(--accent)', marginBottom: '0.25rem' }}>
          🛡️ Permaweb Security Rule
        </div>
        <div style={{ color: 'var(--text-secondary)' }}>
          Because Arweave is immutable, older encrypted snapshots persist forever.
          Changing your password generates a <strong>fresh on-chain identity</strong> to ensure total isolation from past passwords.
        </div>
      </div>

      <form onSubmit={handleRotate} className="flex flex-col gap-4">
        {error && (
          <div style={{
            color: '#ef4444',
            fontSize: '0.85rem',
            textAlign: 'center',
            background: 'rgba(239, 68, 68, 0.1)',
            padding: '0.6rem 0.8rem',
            borderRadius: '10px',
            border: '1px solid rgba(239, 68, 68, 0.2)'
          }}>
            {error}
          </div>
        )}

        <div className="flex flex-col">
          <label className="input-label" htmlFor="rotate-email">Account Email</label>
          <input
            id="rotate-email"
            type="email"
            className="input-field"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            disabled={isProcessing}
            required
          />
        </div>

        <div className="flex flex-col">
          <label className="input-label" htmlFor="rotate-password">New Password</label>
          <input
            id="rotate-password"
            type="password"
            autoComplete="new-password"
            className="input-field"
            value={newPassword}
            onChange={(e) => setNewPassword(e.target.value)}
            placeholder="Minimum 10 characters"
            disabled={isProcessing}
            required
          />
        </div>

        <div className="flex flex-col">
          <label className="input-label" htmlFor="rotate-confirm-password">Confirm New Password</label>
          <input
            id="rotate-confirm-password"
            type="password"
            autoComplete="new-password"
            className="input-field"
            value={confirmNewPassword}
            onChange={(e) => setConfirmNewPassword(e.target.value)}
            placeholder="••••••••"
            disabled={isProcessing}
            required
          />
        </div>

        <button
          type="submit"
          className="btn-primary mt-2"
          disabled={isProcessing || !newPassword || !confirmNewPassword}
        >
          {isProcessing ? (
            <><i className="icon-spinner-double animate-spin"></i> {statusMessage || 'Rotating...'}</>
          ) : (
            <><i className="icon-shield"></i> Rotate & Migrate Key</>
          )}
        </button>
      </form>
    </div>
  );
}
