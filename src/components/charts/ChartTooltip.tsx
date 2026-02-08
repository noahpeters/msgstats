import * as React from 'react';

export type ChartTooltipData = {
  visible: boolean;
  x: number;
  y: number;
  title: string;
  lines: string[];
};

type Props = {
  tooltip: ChartTooltipData;
};

export function ChartTooltip({ tooltip }: Props): React.ReactElement | null {
  const tooltipRef = React.useRef<HTMLDivElement | null>(null);
  const [tooltipSize, setTooltipSize] = React.useState({ width: 0, height: 0 });

  React.useLayoutEffect(() => {
    if (!tooltip.visible) {
      return;
    }
    if (!tooltipRef.current) {
      return;
    }
    const next = tooltipRef.current.getBoundingClientRect();
    setTooltipSize((current) => {
      const width = Math.round(next.width);
      const height = Math.round(next.height);
      if (current.width === width && current.height === height) {
        return current;
      }
      return { width, height };
    });
  }, [tooltip.lines, tooltip.title, tooltip.visible]);

  if (!tooltip.visible) {
    return null;
  }

  const viewportWidth =
    typeof window === 'undefined'
      ? Number.POSITIVE_INFINITY
      : window.innerWidth;
  const viewportHeight =
    typeof window === 'undefined'
      ? Number.POSITIVE_INFINITY
      : window.innerHeight;

  const viewportPadding = 8;
  const cursorOffset = 12;
  const maxLeft = Math.max(
    viewportPadding,
    viewportWidth - tooltipSize.width - viewportPadding,
  );
  const maxTop = Math.max(
    viewportPadding,
    viewportHeight - tooltipSize.height - viewportPadding,
  );

  let left = tooltip.x + cursorOffset;
  if (left + tooltipSize.width + viewportPadding > viewportWidth) {
    left = tooltip.x - cursorOffset - tooltipSize.width;
  }
  left = Math.min(Math.max(viewportPadding, left), maxLeft);

  let top = tooltip.y + cursorOffset;
  if (top + tooltipSize.height + viewportPadding > window.innerHeight) {
    top = tooltip.y - cursorOffset - tooltipSize.height;
  }
  top = Math.min(Math.max(viewportPadding, top), maxTop);

  return (
    <div
      ref={tooltipRef}
      style={{
        position: 'fixed',
        left,
        top,
        background: '#ffffff',
        border: '1px solid rgba(12, 27, 26, 0.15)',
        boxShadow: '0 10px 24px rgba(12, 27, 26, 0.12)',
        borderRadius: '10px',
        padding: '8px 10px',
        fontFamily:
          '"IBM Plex Sans", system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
        fontSize: '12px',
        color: '#0c1b1a',
        pointerEvents: 'none',
        zIndex: 1000,
        minWidth: '140px',
        maxWidth: 'min(320px, calc(100vw - 16px))',
      }}
    >
      <div style={{ fontWeight: 600, marginBottom: '4px' }}>
        {tooltip.title}
      </div>
      {tooltip.lines.map((line, index) => (
        <div key={`${line}-${index}`} style={{ color: '#284b63' }}>
          {line}
        </div>
      ))}
    </div>
  );
}
