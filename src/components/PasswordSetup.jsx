import React, { useState } from 'react';
import Arweave from 'arweave';
import { CryptoService } from '../utils/crypto';
import { ARWEAVE_CONFIG } from '../utils/config';
import { createData, ArweaveSigner } from 'arbundles';

export default function PasswordSetup({ walletKey, onBack, onReturnToDashboard, onComplete }) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [isProcessing, setIsProcessing] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState(false);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');

    if (!email || !password || !confirmPassword) {
      setError('Please fill in all fields.');
      return;
    }
    if (password !== confirmPassword) {
      setError('Passwords do not match.');
      return;
    }

    const passwordValidation = CryptoService.validatePassword(password);
    if (!passwordValidation.valid) {
      setError(passwordValidation.message);
      return;
    }

    setIsProcessing(true);
    console.log('--- STARTING ENCRYPTION & UPLOAD WORKFLOW ---');

    try {
      // 1. Encrypt the JWK using Argon2id derived key
      console.log('1. Encrypting wallet JWK using password (Argon2id + AES-GCM)...');
      const encryptedWallet = await CryptoService.encrypt(walletKey, password);
      console.log('-> Encrypted Wallet Payload:', encryptedWallet);

      // 2. Generate Deterministic Account-ID from credentials
      console.log('2. Generating deterministic Account-ID from credentials...');
      const accountId = await CryptoService.deriveAccountId(email, password);
      console.log('-> Generated Account-ID:', accountId);

      // 3. Create Ephemeral Signer (Protects root wallet address from leaking in ANS-104 header)
      console.log('3. Generating ephemeral throwaway keypair for ANS-104 envelope...');
      const arweave = Arweave.init(ARWEAVE_CONFIG.gateway);
      const ephemeralEnvelopeKey = await arweave.wallets.generate();
      const signer = new ArweaveSigner(ephemeralEnvelopeKey);

      // 4. Create and Tag Data Item
      console.log('4. Creating ANS-104 Data Item signed by ephemeral envelope key...');
      const dataItem = createData(JSON.stringify(encryptedWallet), signer, {
        tags: [
          { name: 'App-Name', value: 'Arweave-Login' },
          { name: 'Account-ID', value: accountId },
          { name: 'Content-Type', value: 'application/json' },
          { name: 'Account-Version', value: '0.2' },
          { name: 'KDF', value: 'Argon2id' }
        ]
      });
      console.log('-> Added Transaction Tags:');
      console.table(dataItem.tags.map(t => ({ name: t.name, value: t.value })));

      // 5. Sign the Data Item
      console.log('5. Signing Data Item with ephemeral key...');
      await dataItem.sign(signer);
      console.log('-> Data Item signed. ID:', dataItem.id);

      // 6. Post (Dispatch) the Data Item to up.arweave.net
      console.log('6. Dispatching data item to up.arweave.net/tx...');
      const response = await fetch('https://up.arweave.net/tx', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/octet-stream',
          'Accept': 'application/json'
        },
        body: dataItem.getRaw()
      });
      console.log('-> Upload Response:', response.status, response.statusText);

      if (response.status >= 200 && response.status < 300) {
        console.log('✅ UPLOAD SUCCESSFUL!');

        // Prompt native browser password manager to save credentials
        if (typeof window !== 'undefined' && window.PasswordCredential && navigator.credentials) {
          try {
            const credential = new window.PasswordCredential({
              id: email,
              password: password,
              name: email
            });
            await navigator.credentials.store(credential);
            console.log('-> Browser credential store requested successfully.');
          } catch (credErr) {
            console.warn('Browser credential store skipped or unsupported:', credErr);
          }
        }

        setSuccess(true);
        if (onComplete) {
          onComplete(encryptedWallet, email, dataItem.id);
        }
      } else {
        throw new Error(`Upload failed with status ${response.status}`);
      }

    } catch (err) {
      console.error('❌ WORKFLOW FAILED:', err);
      setError('Encryption or upload failed. Please try again.');
    } finally {
      setIsProcessing(false);
      console.log('--- WORKFLOW COMPLETE ---');
    }
  };

  if (success) {
    const handleReturn = onReturnToDashboard || onBack;
    return (
      <div className="glass-card text-center">
        <div className="flex mb-6">
          <button className="btn-ghost" onClick={handleReturn}>
            <i className="icon-arrow-left2"></i> Back
          </button>
        </div>
        <div className="mb-6">
          <i className="icon-check-circle" style={{ fontSize: '3rem', color: '#10b981' }}></i>
        </div>
        <h2>Saved Securely!</h2>
        <p>Your encrypted wallet has been safely stored on Arweave.</p>
        <button className="btn-primary mt-6" onClick={handleReturn}>
          Return to Dashboard
        </button>
      </div>
    );
  }

  return (
    <div className="glass-card">
      <button className="btn-ghost mb-6" onClick={onBack}>
        <i className="icon-arrow-left2"></i> Back
      </button>
      <h2>Secure Your Account</h2>
      <p className="mb-6">Set a strong password to encrypt your Arweave key file for safe permaweb storage.</p>

      <form onSubmit={handleSubmit} className="flex flex-col gap-4">
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
          <label className="input-label" htmlFor="register-email">Email</label>
          <input
            id="register-email"
            name="username"
            type="email"
            autoComplete="username"
            className="input-field"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="your@email.com"
            required
          />
        </div>

        <div className="flex flex-col">
          <label className="input-label" htmlFor="register-password">Password</label>
          <input
            id="register-password"
            name="password"
            type="password"
            autoComplete="new-password"
            className="input-field"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="Minimum 10 characters"
            required
          />
          <span style={{ fontSize: '0.75rem', color: 'var(--text-secondary)', marginTop: '0.25rem' }}>
            Requires 10+ characters with mixed case, numbers, or symbols.
          </span>
        </div>

        <div className="flex flex-col">
          <label className="input-label" htmlFor="register-confirm-password">Re-enter Password</label>
          <input
            id="register-confirm-password"
            name="confirm-password"
            type="password"
            autoComplete="new-password"
            className="input-field"
            value={confirmPassword}
            onChange={(e) => setConfirmPassword(e.target.value)}
            placeholder="••••••••"
            required
          />
        </div>

        {password && confirmPassword && (
          <button
            type="submit"
            className="btn-primary mt-4"
            disabled={isProcessing}
          >
            {isProcessing ? (
              <><i className="icon-spinner-double animate-spin"></i> Encrypting & Uploading...</>
            ) : (
              <><i className="icon-lock"></i> Encrypt & Save</>
            )}
          </button>
        )}
      </form>
    </div>
  );
}
