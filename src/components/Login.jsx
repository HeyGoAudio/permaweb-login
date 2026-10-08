import React, { useState, useRef } from 'react';
import { findAndUnlockAccount, getAddressFromJwk } from '../utils/account';

export default function Login({ onBack, onLoginSuccess, walletAddress, initialStage = 'credentials' }) {
  const [stage, setStage] = useState(initialStage); // 'credentials', 'connect'
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [isAuthenticating, setIsAuthenticating] = useState(false);
  const [isReadingFile, setIsReadingFile] = useState(false);
  const [error, setError] = useState('');
  const fileInputRef = useRef(null);

  if (walletAddress) {
    return null;
  }

  const handleBackFromConnect = () => {
    setError('');
    if (initialStage === 'connect') {
      onBack();
    } else {
      setStage('credentials');
    }
  };

  // Handle keyfile upload
  const handleKeyFileUpload = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setError('');
    setIsReadingFile(true);

    try {
      const text = await file.text();
      let jwk;
      try {
        jwk = JSON.parse(text);
      } catch {
        throw new Error('Selected file is not valid JSON. Please provide a valid Arweave keyfile.');
      }

      const address = await getAddressFromJwk(jwk);
      console.log('✅ Keyfile loaded successfully! Address:', address);

      if (onLoginSuccess) {
        onLoginSuccess(jwk, address, '');
      }
    } catch (err) {
      console.error('Failed to load keyfile:', err);
      setError(err.message || 'Failed to read key file.');
    } finally {
      setIsReadingFile(false);
      if (fileInputRef.current) {
        fileInputRef.current.value = '';
      }
    }
  };

  // Handle combined email + password login
  const handleLogin = async (e) => {
    e.preventDefault();
    setError('');

    const trimmedEmail = email.trim();
    if (!trimmedEmail) {
      setError('Please enter your email address.');
      return;
    }
    if (!password) {
      setError('Please enter your password.');
      return;
    }

    setIsAuthenticating(true);
    console.log('--- ATTEMPTING LOGIN WITH CREDENTIALS ---');

    try {
      const result = await findAndUnlockAccount(trimmedEmail, password);

      console.log('✅ Authentication successful! Address:', result.address);

      // Prompt browser to save credentials
      if (typeof window !== 'undefined' && window.PasswordCredential && navigator.credentials) {
        try {
          const credential = new window.PasswordCredential({
            id: trimmedEmail,
            password: password,
            name: trimmedEmail
          });
          await navigator.credentials.store(credential);
          console.log('-> Browser credential store requested on login.');
        } catch (credErr) {
          console.warn('Browser credential store skipped or unsupported on login:', credErr);
        }
      }

      if (onLoginSuccess) {
        onLoginSuccess(result.walletKey, result.address);
      }
    } catch (err) {
      console.error('❌ Login failed:', err);
      setError(err.message || 'Incorrect password or account not found.');
    } finally {
      setIsAuthenticating(false);
    }
  };

  // Connect Wander Extension
  const handleConnectWallet = async () => {
    setError('');
    if (typeof window !== 'undefined' && window.arweaveWallet) {
      try {
        await window.arweaveWallet.connect(['ACCESS_ADDRESS', 'SIGN_TRANSACTION']);
        const address = await window.arweaveWallet.getActiveAddress();
        if (onLoginSuccess) {
          onLoginSuccess(null, address);
        }
      } catch {
        setError('Connection to Wander was cancelled or failed.');
      }
    } else {
      setError('Wander extension not detected. Please install Wander or login with email.');
    }
  };

  // Render: Connect Browser Wallet
  if (stage === 'connect') {
    return (
      <div className="glass-card text-center">
        <div className="flex mb-6">
          <button className="btn-ghost" onClick={handleBackFromConnect}>
            <i className="icon-arrow-left2"></i> Back
          </button>
        </div>
        <div className="mb-6">
          <i className="icon-wander1" style={{ fontSize: '3rem', color: 'var(--accent)', display: 'inline-block' }}></i>
        </div>
        <h2>Connect Wallet</h2>
        <p className="mb-6">Connect with Wander extension or upload your Arweave key file.</p>

        {error && (
          <div style={{
            color: '#ef4444',
            fontSize: '0.9rem',
            textAlign: 'center',
            background: 'rgba(239, 68, 68, 0.1)',
            padding: '0.6rem 0.8rem',
            borderRadius: '10px',
            border: '1px solid rgba(239, 68, 68, 0.2)',
            marginBottom: '1rem'
          }}>
            {error}
          </div>
        )}

        <div className="flex flex-col gap-3">
          <button
            type="button"
            className="btn-primary"
            onClick={handleConnectWallet}
            disabled={isReadingFile}
          >
            <i className="icon-wander1"></i> Connect Wander
          </button>

          <input
            type="file"
            ref={fileInputRef}
            style={{ display: 'none' }}
            accept=".json,application/json"
            onChange={handleKeyFileUpload}
          />

          <button
            type="button"
            className="btn-secondary"
            onClick={() => fileInputRef.current?.click()}
            disabled={isReadingFile}
          >
            {isReadingFile ? (
              <><i className="icon-spinner-double animate-spin"></i> Reading Key File...</>
            ) : (
              <><i className="icon-file-upload"></i> Upload Key File</>
            )}
          </button>
        </div>

        <div className="flex flex-col gap-2 mt-6" style={{ borderTop: '1px solid var(--surface-border)', paddingTop: '1.25rem' }}>
          <button
            type="button"
            className="btn-ghost"
            style={{ justifyContent: 'center' }}
            onClick={() => { setError(''); setStage('credentials'); }}
          >
            <i className="icon-enter"></i> Login with email and password instead
          </button>
        </div>
      </div>
    );
  }

  // Render: Default Credentials Login (Email + Password together)
  return (
    <div className="glass-card">
      <button className="btn-ghost mb-6" onClick={onBack}>
        <i className="icon-arrow-left2"></i> Back
      </button>
      <h2>Login to Your Account</h2>
      <p className="mb-6">Enter your registered email and password to securely unlock your wallet.</p>

      <form onSubmit={handleLogin} className="flex flex-col gap-4">
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
          <label className="input-label" htmlFor="login-email">Email Address</label>
          <input
            id="login-email"
            name="username"
            type="email"
            autoComplete="username"
            className="input-field"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="your@email.com"
            disabled={isAuthenticating}
            required
          />
        </div>

        <div className="flex flex-col">
          <label className="input-label" htmlFor="login-password">Password</label>
          <input
            id="login-password"
            name="password"
            type="password"
            autoComplete="current-password"
            className="input-field"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="••••••••"
            disabled={isAuthenticating}
            required
          />
        </div>

        <button
          type="submit"
          className="btn-primary mt-2"
          disabled={isAuthenticating || !email.trim() || !password}
        >
          {isAuthenticating ? (
            <><i className="icon-spinner-double animate-spin"></i> Authenticating & Unlocking...</>
          ) : (
            <><i className="icon-lock"></i> Unlock & Login</>
          )}
        </button>
      </form>

      <div className="flex flex-col gap-2 mt-6" style={{ borderTop: '1px solid var(--surface-border)', paddingTop: '1.25rem' }}>
        <button
          type="button"
          className="btn-ghost"
          style={{ justifyContent: 'center' }}
          onClick={() => { setError(''); setStage('connect'); }}
        >
          <i className="icon-wander1"></i> Connect with browser wallet instead
        </button>
      </div>
    </div>
  );
}
