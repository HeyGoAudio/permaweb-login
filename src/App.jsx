import React, { useState, useEffect } from 'react'
import LandingScreen from './components/LandingScreen'
import Login from './components/Login'
import CreateAccount from './components/CreateAccount'
import RotateCredentials from './components/RotateCredentials'
import ProfileManager from './components/ProfileManager'
import UserPanel from './components/UserPanel'
import { fetchProfile } from './utils/profile'

export default function App() {
  const [currentView, setCurrentView] = useState('landing')
  const [previousView, setPreviousView] = useState('landing')
  const [loginStage, setLoginStage] = useState('credentials')
  const [walletAddress, setWalletAddress] = useState(null)
  const [walletKey, setWalletKey] = useState(null)
  const [userEmail, setUserEmail] = useState('')
  const [walletBalance, setWalletBalance] = useState('0.0000')
  const [currentAccount, setCurrentAccount] = useState(null)
  const [isUserPanelOpen, setIsUserPanelOpen] = useState(false)

  // Load the profile on login so the UserPanel shows avatar/handle without opening ProfileManager
  useEffect(() => {
    if (!walletAddress) return;
    let cancelled = false;
    fetchProfile(walletAddress)
      .then((acc) => { if (!cancelled) setCurrentAccount(acc); })
      .catch((err) => console.warn('Could not preload profile:', err));
    return () => { cancelled = true; };
  }, [walletAddress]);

  const handleLogout = () => {
    setWalletAddress(null);
    setWalletKey(null);
    setUserEmail('');
    setWalletBalance('0.0000');
    setCurrentAccount(null);
    setLoginStage('credentials');
    setPreviousView('landing');
    setIsUserPanelOpen(false);
    setCurrentView('landing');
  };

  const navigateToView = (view, stage = 'credentials') => {
    setPreviousView(currentView);
    setLoginStage(stage);
    setCurrentView(view);
  };

  const renderView = () => {
    // Logged in: ProfileManager is only shown when explicitly opened from the UserPanel
    if (walletAddress && currentView === 'profile') {
      return (
        <ProfileManager
          walletAddress={walletAddress}
          walletKey={walletKey}
          userEmail={userEmail}
          onNavigate={(view) => navigateToView(view)}
          onProfileUpdated={setCurrentAccount}
          onClose={() => setCurrentView('landing')}
        />
      );
    }

    // Logged in on the home/landing view: nothing but the UserPanel
    if (walletAddress && currentView === 'landing') {
      return null;
    }

    switch (currentView) {
      case 'login':
        return (
          <Login
            key={loginStage}
            initialStage={loginStage}
            walletAddress={walletAddress}
            onBack={() => {
              const dest = previousView === 'create' ? 'create' : 'landing';
              setLoginStage('credentials');
              setCurrentView(dest);
            }}
            onLoginSuccess={(key, address, email) => {
              setWalletKey(key);
              setWalletAddress(address);
              setUserEmail(email || '');
              setLoginStage('credentials');
              setPreviousView('landing');
              setCurrentView('landing');
            }}
          />
        );

      case 'create':
        return (
          <CreateAccount
            onBack={() => setCurrentView('landing')}
            onConnectWallet={() => {
              setPreviousView('create');
              setLoginStage('connect');
              setCurrentView('login');
            }}
            onWalletGenerated={(key, address) => {
              setWalletKey(key);
              setWalletAddress(address);
            }}
          />
        );

      case 'rotate':
        return (
          <RotateCredentials
            currentWalletKey={walletKey}
            currentAddress={walletAddress}
            userEmail={userEmail}
            onBack={() => setCurrentView('profile')}
            onMigrationComplete={(newKey, newAddress, newEmail) => {
              setWalletKey(newKey);
              setWalletAddress(newAddress);
              setUserEmail(newEmail);
              setCurrentView('profile');
            }}
          />
        );

      case 'landing':
      default:
        return (
          <LandingScreen
            onNavigate={(view) => navigateToView(view)}
            walletAddress={walletAddress}
          />
        );
    }
  }

  return (
    <div className="app-container">
      {walletAddress && (
        <UserPanel
          walletAddress={walletAddress}
          walletKey={walletKey}
          currentAccount={currentAccount}
          onNavigate={(view) => navigateToView(view)}
          onLogout={handleLogout}
          onBalanceChange={setWalletBalance}
          isOpen={isUserPanelOpen}
          setIsOpen={setIsUserPanelOpen}
        />
      )}
      {renderView()}
    </div>
  )
}
