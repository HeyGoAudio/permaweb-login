import React, { createContext, useContext, useState, useCallback, useRef } from 'react';
import ToastNotification from '../components/ToastNotification';
import '../components/ToastNotification.css';

const ToastContext = createContext(null);

export function ToastProvider({ children }) {
  const [toasts, setToasts] = useState([]);
  const idCounter = useRef(0);

  const hideToast = useCallback((id) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  }, []);

  const clearAllToasts = useCallback(() => {
    setToasts([]);
  }, []);

  /**
   * Show a toast notification.
   * @param {object} options
   * @param {string|React.ReactNode} options.message - Text or JSX to display
   * @param {'warning'|'info'|'error'|'success'} [options.type='info'] - Toast variant
   * @param {number} [options.duration=5000] - Duration in ms (0 for persistent)
   * @param {boolean} [options.dim=false] - Whether to dim the rest of the page behind the toast
   * @param {Function} [options.onClose] - Callback fired when toast is closed
   * @returns {number} Toast ID
   */
  const showToast = useCallback(({
    message,
    type = 'info',
    duration = 5000,
    dim = true,
    onClose = null,
  }) => {
    idCounter.current += 1;
    const id = idCounter.current;

    const newToast = {
      id,
      message,
      type,
      duration,
      dim,
      onClose,
    };

    setToasts((prev) => [...prev, newToast]);
    return id;
  }, []);

  // Check if any active toast requested dimming the screen
  const hasDim = toasts.some((t) => t.dim);

  return (
    <ToastContext.Provider value={{ showToast, hideToast, clearAllToasts }}>
      {children}

      {/* Dimmed backdrop overlay when at least one active toast has dim=true */}
      {hasDim && (
        <div
          className="toast-dim-overlay"
          onClick={() => {
            // Dismiss the most recent dimming toast when clicking the backdrop
            const dimToast = [...toasts].reverse().find((t) => t.dim);
            if (dimToast) {
              if (dimToast.onClose) dimToast.onClose();
              hideToast(dimToast.id);
            }
          }}
          aria-hidden="true"
        />
      )}

      {/* Toast container floating on top */}
      {toasts.length > 0 && (
        <div className="toast-container" role="region" aria-label="Notifications">
          {toasts.map((toast) => (
            <ToastNotification
              key={toast.id}
              type={toast.type}
              message={toast.message}
              duration={toast.duration}
              onClose={() => {
                if (toast.onClose) toast.onClose();
                hideToast(toast.id);
              }}
            />
          ))}
        </div>
      )}
    </ToastContext.Provider>
  );
}

/**
 * Hook to trigger toasts anywhere in the application.
 * const { showToast, hideToast, clearAllToasts } = useToast();
 */
export function useToast() {
  const context = useContext(ToastContext);
  if (!context) {
    throw new Error('useToast must be used within a ToastProvider');
  }
  return context;
}
