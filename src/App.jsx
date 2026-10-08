import React, { useState } from 'react'
import LandingScreen from './components/LandingScreen'
import Login from './components/Login'
import CreateAccount from './components/CreateAccount'
import RotateCredentials from './components/RotateCredentials'
import UserPanel from './components/UserPanel'

export default function App() {
  const [currentView, setCurrentView] = useState('landing')
  const [previousView, setPreviousView] = useState('landing')
  const [loginStage, setLoginStage] = useState('credentials')
  const [walletAddress, setWalletAddress] = useState(null)
  const [walletKey, setWalletKey] = useState(null)
  const [userEmail, setUserEmail] = useState('')
  const [walletBalance, setWalletBalance] = useState('0.0000')
  const [isUserPanelOpen, setIsUserPanelOpen] = useState(false)

  const handleLogout = () => {
    setWalletAddress(null);
    setWalletKey(null);
    setUserEmail('');
    setWalletBalance('0.0000');
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
    // If user is already logged in, never display Login screen
    if (walletAddress && currentView === 'login') {
      return (
        <LandingScreen 
          onNavigate={(view) => navigateToView(view)} 
          walletAddress={walletAddress}
        />
      );
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
            onBack={() => setCurrentView('landing')}
            onMigrationComplete={(newKey, newAddress, newEmail) => {
              setWalletKey(newKey);
              setWalletAddress(newAddress);
              setUserEmail(newEmail);
              setCurrentView('landing');
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
