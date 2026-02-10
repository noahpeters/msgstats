import * as React from 'react';
import * as stylex from '@stylexjs/stylex';

export type ToastTone = 'info' | 'success' | 'error';

export function Toast({
  message,
  tone = 'info',
  onClose,
}: {
  message: string;
  tone?: ToastTone;
  onClose: () => void;
}): React.ReactElement {
  return (
    <div
      role={tone === 'error' ? 'alert' : 'status'}
      aria-live={tone === 'error' ? 'assertive' : 'polite'}
      {...stylex.props(
        toastStyles.root,
        tone === 'success' && toastStyles.success,
        tone === 'error' && toastStyles.error,
      )}
    >
      <span {...stylex.props(toastStyles.message)}>{message}</span>
      <button
        type="button"
        aria-label="Dismiss notification"
        {...stylex.props(toastStyles.closeButton)}
        onClick={onClose}
      >
        ×
      </button>
    </div>
  );
}

const toastStyles = stylex.create({
  root: {
    position: 'fixed',
    right: '16px',
    bottom: '16px',
    zIndex: 120,
    minWidth: '260px',
    maxWidth: '420px',
    padding: '10px 12px',
    borderRadius: '10px',
    border: '1px solid rgba(12, 27, 26, 0.16)',
    backgroundColor: '#ffffff',
    color: '#0c1b1a',
    boxShadow: '0 10px 24px rgba(12, 27, 26, 0.18)',
    display: 'grid',
    gridTemplateColumns: 'minmax(0, 1fr) auto',
    alignItems: 'start',
    gap: '8px',
    fontFamily: '"IBM Plex Sans", "Helvetica", sans-serif',
  },
  success: {
    borderColor: 'rgba(15, 118, 110, 0.34)',
    backgroundColor: '#f0fdf4',
  },
  error: {
    borderColor: 'rgba(127, 29, 29, 0.32)',
    backgroundColor: '#fef2f2',
    color: '#7f1d1d',
  },
  message: {
    fontSize: '13px',
    lineHeight: 1.35,
  },
  closeButton: {
    border: 'none',
    backgroundColor: 'transparent',
    color: 'inherit',
    fontSize: '18px',
    lineHeight: 1,
    cursor: 'pointer',
    padding: 0,
    minWidth: '18px',
    minHeight: '18px',
  },
});
