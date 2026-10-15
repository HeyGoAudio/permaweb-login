import React, { useState, useEffect, useRef, useCallback } from 'react';
import './ToastNotification.css';

/**
 * ToastNotification component
 * Can be used globally via useToast() or standalone as:
 * <ToastNotification message="..." type="warning" duration={5000} onClose={...} />
 */
export default function ToastNotification({
  message,
  type = 'info', // 'warning' | 'info' | 'error' | 'success'
  duration = 5000,
  onClose,
  dim = false, // When used standalone, optionally renders its own backdrop
}) {
  const [isExiting, setIsExiting] = useState(false);
  const timerRef = useRef(null);

  const handleDismiss = useCallback(() => {
    if (isExiting) return;
    setIsExiting(true);
    setTimeout(() => {
      if (onClose) onClose();
    }, 250); // Matches exit animation duration
  }, [isExiting, onClose]);

  useEffect(() => {
    if (!duration || duration <= 0) return undefined;

    timerRef.current = setTimeout(handleDismiss, duration);
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, [duration, handleDismiss]);

  // Icon mapping matching the project's icon font
  const getIconClass = () => {
    switch (type) {
      case 'warning':
        return 'icon-triangle-exclamation';
      case 'success':
        return 'icon-check-circle';
      case 'error':
        return 'icon-circle-info-solid';
      case 'info':
      default:
        return 'icon-circle-info-solid';
    }
  };

  const toastCard = (
    <div
      className={`toast-card toast-${type} ${isExiting ? 'toast-exiting' : ''}`}
      role="alert"
    >
      <div className="toast-icon" aria-hidden="true">
        <i className={getIconClass()} />
      </div>

      <div className="toast-body">
        {message}
      </div>

      <button
        type="button"
        className="toast-close-btn"
        onClick={handleDismiss}
        aria-label="Close notification"
        title="Dismiss"
      >
        ✕
      </button>

      {duration > 0 && (
        <div
          className="toast-progress-track"
          aria-hidden="true"
        >
          <div
            className="toast-progress-bar"
            style={{ animationDuration: `${duration}ms` }}
          />
        </div>
      )}
    </div>
  );

  if (dim) {
    return (
      <>
        <div
          className={`toast-dim-overlay ${isExiting ? 'dim-exiting' : ''}`}
          onClick={handleDismiss}
          aria-hidden="true"
        />
        <div className="toast-standalone-wrapper">
          {toastCard}
        </div>
      </>
    );
  }

  return toastCard;
}
