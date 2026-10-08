import React, { useState, useEffect, useCallback, useRef } from 'react';
import { getWalletBalance, downloadKeyfile } from '../utils/account';

export default function UserPanel({
  walletAddress,
  walletKey,
  onLogout,
  onBalanceChange,
  isOpen,
  setIsOpen
}) {
  const [internalOpen, setInternalOpen] = useState(false);
  const isExpanded = isOpen !== undefined ? isOpen : internalOpen;

  const toggleOpen = () => {
    if (setIsOpen) {
      setIsOpen(!isExpanded);
    } else {
      setInternalOpen(!isExpanded);
    }
  };

  const closePanel = () => {
    if (setIsOpen) {
      setIsOpen(false);
    } else {
      setInternalOpen(false);
    }
  };

  const [balance, setBalance] = useState({ formatted: '0.0000', ar: '0', winston: '0' });
  const [isLoadingBalance, setIsLoadingBalance] = useState(false);
  const [copied, setCopied] = useState(false);
  const panelRef = useRef(null);

  const fetchBalance = useCallback(async () => {
    if (!walletAddress) return;
    setIsLoadingBalance(true);
    try {
      const res = await getWalletBalance(walletAddress);
      setBalance(res);
      if (onBalanceChange) {
        onBalanceChange(res.formatted);
      }
    } catch (err) {
      console.warn('Error fetching balance:', err);
    } finally {
      setIsLoadingBalance(false);
    }
  }, [walletAddress, onBalanceChange]);

  useEffect(() => {
    let isMounted = true;
    if (!walletAddress) return;

    getWalletBalance(walletAddress)
      .then((res) => {
        if (isMounted) {
          setBalance(res);
          if (onBalanceChange) {
            onBalanceChange(res.formatted);
          }
        }
      })
      .catch((err) => {
        console.warn('Error loading initial balance:', err);
      });

    return () => {
      isMounted = false;
    };
  }, [walletAddress, onBalanceChange]);

  // When panel expands, refresh balance
  useEffect(() => {
    if (isExpanded && walletAddress) {
      fetchBalance();
    }
  }, [isExpanded, walletAddress, fetchBalance]);

  // Escape key closes modal
  useEffect(() => {
    const handleKeyDown = (e) => {
      if (e.key === 'Escape' && isExpanded) {
        closePanel();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isExpanded]);

  const handleCopyAddress = async () => {
    if (!walletAddress) return;
    try {
      await navigator.clipboard.writeText(walletAddress);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      setCopied(false);
    }
  };

  const handleDisconnect = () => {
    closePanel();
    if (onLogout) {
      onLogout();
    }
  };

  if (!walletAddress) return null;

  const abbreviated = `${walletAddress.slice(0, 5)}...${walletAddress.slice(-4)}`;

  return (
    <>
      {/* Backdrop overlay when expanded */}
      {isExpanded && (
        <div 
          className="user-panel-backdrop" 
          onClick={closePanel}
          aria-hidden="true"
        />
      )}

      <div className="user-panel-wrapper" ref={panelRef}>
        {/* Default Trigger Button: user icon and abbreviated address */}
        <button
          type="button"
          className={`user-panel ${isExpanded ? 'is-open' : ''}`}
          onClick={toggleOpen}
          aria-expanded={isExpanded}
          aria-haspopup="dialog"
          title={isExpanded ? "Collapse account details" : "Expand account details"}
        >
          <i className="icon-user" style={{ fontSize: '1.15rem' }}></i>
          <span className="user-panel-address">{abbreviated}</span>
          <i 
            className={`icon-arrow-down2 user-panel-caret ${isExpanded ? 'open' : ''}`} 
            style={{ fontSize: '0.7rem' }}
          ></i>
        </button>

        {/* Expandable Modal */}
        {isExpanded && (
          <div 
            className="user-panel-modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="user-panel-title"
          >
            {/* Modal Header */}
            <div className="user-panel-modal-header">
              <div className="user-panel-title-wrap">
                <i 
                  className="icon-check-circle" 
                  style={{ fontSize: '1.35rem', color: '#10b981', display: 'inline-block' }}
                ></i>
                <h3 id="user-panel-title" style={{ margin: 0, fontSize: '1.15rem' }}>
                  Welcome Back!
                </h3>
              </div>
              <button
                type="button"
                className="modal-close-btn"
                onClick={closePanel}
                aria-label="Close"
              >
                ✕
              </button>
            </div>

            <p className="user-panel-subtitle">
              Your Arweave identity is unlocked and active.
            </p>

            {/* Dedicated AR Balance Panel */}
            <div className="balance-panel">
              <div className="balance-header">
                <span className="balance-label">
                  <i className="icon-coin-dollar" style={{ fontSize: '1rem', color: '#38bdf8' }}></i>
                  AR Balance
                </span>
                <span className="network-pill">
                  Arweave Mainnet
                </span>
              </div>

              <div className="balance-display">
                <span className="balance-value">
                  {isLoadingBalance ? '...' : balance.formatted}
                </span>
                <span className="balance-ticker">AR</span>
              </div>

              <div className="balance-footer">
                <span>Gateway: arweave.net</span>
                <button
                  type="button"
                  className="refresh-btn"
                  onClick={fetchBalance}
                  disabled={isLoadingBalance}
                  title="Refresh balance"
                >
                  <i className={`icon-loop2 ${isLoadingBalance ? 'animate-spin' : ''}`}></i>
                  {isLoadingBalance ? 'Updating...' : 'Refresh'}
                </button>
              </div>
            </div>

            {/* Connected Wallet Pill with Copy Action */}
            <div className="user-panel-address-card">
              <div style={{
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
                marginBottom: '0.35rem'
              }}>
                <span style={{ fontSize: '0.75rem', textTransform: 'uppercase', letterSpacing: '0.05em', color: 'var(--text-secondary)' }}>
                  Connected Address
                </span>
                <button
                  type="button"
                  onClick={handleCopyAddress}
                  style={{
                    background: 'transparent',
                    border: 'none',
                    color: copied ? '#10b981' : 'var(--text-secondary)',
                    fontSize: '0.75rem',
                    cursor: 'pointer',
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: '0.3rem',
                    padding: '0.15rem 0.4rem',
                    borderRadius: '6px',
                    transition: 'color 0.2s'
                  }}
                  title="Copy full address"
                >
                  <i className={copied ? 'icon-checkmark' : 'icon-copy'}></i>
                  {copied ? 'Copied!' : 'Copy'}
                </button>
              </div>
              <div style={{ fontFamily: 'monospace', fontSize: '0.82rem', color: 'var(--text-primary)', wordBreak: 'break-all', textAlign: 'left' }}>
                {walletAddress}
              </div>
            </div>

            {/* Action Buttons */}
            <div className="flex flex-col gap-3 mt-5">
              {walletKey && (
                <button
                  type="button"
                  className="btn-primary"
                  onClick={() => downloadKeyfile(walletKey, walletAddress)}
                  title="Download unencrypted Arweave JWK keyfile"
                >
                  <i className="icon-download"></i> Download Keyfile (JSON)
                </button>
              )}

              <button
                type="button"
                className="btn-secondary"
                onClick={handleDisconnect}
              >
                <i className="icon-exit"></i> Disconnect / Logout
              </button>
            </div>
          </div>
        )}
      </div>
    </>
  );
}
