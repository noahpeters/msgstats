import * as React from 'react';
import * as stylex from '@stylexjs/stylex';

export type ToolbarSelectOption = {
  value: string;
  title: string;
  description?: string;
};

export function ToolbarSelect({
  value,
  options,
  onChange,
  ariaLabel,
  minWidth = '240px',
}: {
  value: string;
  options: ToolbarSelectOption[];
  onChange: (value: string) => void;
  ariaLabel: string;
  minWidth?: string;
}): React.ReactElement {
  const [open, setOpen] = React.useState(false);
  const wrapRef = React.useRef<HTMLDivElement | null>(null);

  const selected =
    options.find((option) => option.value === value) ?? options[0] ?? null;

  React.useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: PointerEvent) => {
      const target = event.target as Node | null;
      if (!target) return;
      if (wrapRef.current?.contains(target)) return;
      setOpen(false);
    };
    window.addEventListener('pointerdown', onPointerDown);
    return () => window.removeEventListener('pointerdown', onPointerDown);
  }, [open]);

  const menuStyle = React.useMemo(() => {
    if (!open || typeof window === 'undefined' || !wrapRef.current) {
      return undefined;
    }
    const rect = wrapRef.current.getBoundingClientRect();
    const desiredWidth = Math.max(220, Math.floor(rect.width));
    const maxWidth = Math.max(220, window.innerWidth - 24);
    const width = Math.min(desiredWidth, maxWidth);
    const left = Math.max(
      12,
      Math.min(rect.left, window.innerWidth - width - 12),
    );
    const top = rect.bottom + 6;
    const maxHeight = Math.max(160, window.innerHeight - top - 12);
    return {
      top: `${top}px`,
      left: `${left}px`,
      width: `${width}px`,
      maxHeight: `${maxHeight}px`,
      overflowY: 'auto' as const,
    };
  }, [open]);

  return (
    <div
      ref={wrapRef}
      {...stylex.props(toolbarSelectStyles.wrap)}
      style={{ minWidth }}
    >
      <button
        type="button"
        aria-label={ariaLabel}
        aria-haspopup="listbox"
        aria-expanded={open}
        {...stylex.props(toolbarSelectStyles.button)}
        onClick={() => setOpen((prev) => !prev)}
      >
        <span {...stylex.props(toolbarSelectStyles.text)}>
          <span {...stylex.props(toolbarSelectStyles.title)}>
            {selected?.title ?? ''}
          </span>
          <span {...stylex.props(toolbarSelectStyles.description)}>
            {selected?.description ?? ''}
          </span>
        </span>
        <span aria-hidden="true" {...stylex.props(toolbarSelectStyles.caret)}>
          ▾
        </span>
      </button>
      {open ? (
        <div
          role="listbox"
          {...stylex.props(toolbarSelectStyles.menu)}
          style={menuStyle}
        >
          {options.map((option) => (
            <button
              key={`${ariaLabel}-${option.value || 'all'}`}
              type="button"
              {...stylex.props(
                toolbarSelectStyles.menuItem,
                option.value === value && toolbarSelectStyles.menuItemSelected,
              )}
              onClick={() => {
                onChange(option.value);
                setOpen(false);
              }}
            >
              <span {...stylex.props(toolbarSelectStyles.menuItemTitle)}>
                {option.title}
              </span>
              <span {...stylex.props(toolbarSelectStyles.menuItemDescription)}>
                {option.description ?? ''}
              </span>
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}

const toolbarSelectStyles = stylex.create({
  wrap: {
    position: 'relative',
    flexShrink: 0,
    borderWidth: '1px',
    borderStyle: 'solid',
    borderColor: '#9aa9b5',
    borderRadius: '8px',
    backgroundColor: '#ffffff',
    boxShadow: '0 0 0 1px #c8d2da',
    ':focus-within': {
      outline: '2px solid #0f766e',
      outlineOffset: '2px',
    },
  },
  button: {
    width: '100%',
    minHeight: '54px',
    border: 'none',
    borderRadius: '8px',
    backgroundColor: '#ffffff',
    textAlign: 'left',
    padding: '8px 10px',
    display: 'grid',
    gridTemplateColumns: 'minmax(0, 1fr) auto',
    alignItems: 'center',
    gap: '8px',
    cursor: 'pointer',
    ':focus-visible': {
      outline: 'none',
    },
  },
  text: {
    display: 'grid',
    gap: '2px',
    minWidth: 0,
  },
  title: {
    fontFamily: '"IBM Plex Sans", "Helvetica", sans-serif',
    fontSize: '13px',
    fontWeight: 700,
    color: '#0c1b1a',
    lineHeight: '1.2',
    whiteSpace: 'nowrap',
    overflow: 'hidden',
    textOverflow: 'ellipsis',
  },
  description: {
    fontFamily: '"IBM Plex Sans", "Helvetica", sans-serif',
    fontSize: '11px',
    color: '#5b7287',
    lineHeight: '1.2',
    whiteSpace: 'nowrap',
    overflow: 'hidden',
    textOverflow: 'ellipsis',
  },
  caret: {
    color: '#5b7287',
    fontSize: '14px',
    lineHeight: '1',
    fontWeight: 700,
  },
  menu: {
    position: 'fixed',
    zIndex: 60,
    border: '1px solid rgba(12, 27, 26, 0.14)',
    backgroundColor: '#ffffff',
    borderRadius: '10px',
    boxShadow: '0 8px 24px rgba(12, 27, 26, 0.16)',
    padding: '6px',
    display: 'grid',
    gap: '4px',
    fontFamily: '"IBM Plex Sans", "Helvetica", sans-serif',
  },
  menuItem: {
    border: 'none',
    borderRadius: '8px',
    backgroundColor: '#ffffff',
    textAlign: 'left',
    padding: '8px',
    display: 'grid',
    gap: '2px',
    cursor: 'pointer',
    ':hover': {
      backgroundColor: '#f3f7f9',
    },
    ':focus-visible': {
      outline: '2px solid #0f766e',
      outlineOffset: '1px',
    },
  },
  menuItemSelected: {
    backgroundColor: '#e7f7f2',
  },
  menuItemTitle: {
    fontSize: '13px',
    fontWeight: 700,
    color: '#0c1b1a',
    lineHeight: '1.2',
  },
  menuItemDescription: {
    fontSize: '11px',
    color: '#5b7287',
    lineHeight: '1.2',
  },
});
