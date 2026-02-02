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
  if (!tooltip.visible) {
    return null;
  }
  return (
    <div
      style={{
        position: 'fixed',
        left: tooltip.x,
        top: tooltip.y,
        transform: 'translate(12px, 12px)',
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
