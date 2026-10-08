import React from 'react';

export default function LandingScreen({ onNavigate, walletAddress }) {
  if (walletAddress) {
    return null;
  }

  return (
    <div className="glass-card text-center">
      <div className="mb-6">
        <i className="icon-lock" style={{ fontSize: '3rem', color: 'var(--accent)' }}></i>
      </div>
      <h2>Awesome App</h2>
      <p>Secure, permissionless identity and wallet management on Arweave.</p>

      <div className="flex flex-col gap-4 mt-8">
        <button
          type="button"
          className="btn-primary"
          onClick={() => onNavigate('login')}
        >
          <i className="icon-enter"></i> Login
        </button>
        <button
          type="button"
          className="btn-secondary"
          onClick={() => onNavigate('create')}
        >
          <i className="icon-circle-plus"></i> Create User Account
        </button>
      </div>
    </div>
  );
}
