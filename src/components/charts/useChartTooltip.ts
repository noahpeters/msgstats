import * as React from 'react';

import type { ChartTooltipData } from './ChartTooltip';

export function useChartTooltip() {
  const [tooltip, setTooltip] = React.useState<ChartTooltipData>({
    visible: false,
    x: 0,
    y: 0,
    title: '',
    lines: [],
  });

  const show = React.useCallback(
    (
      event: { clientX: number; clientY: number },
      data: { title: string; lines: string[] },
    ) => {
      setTooltip({
        visible: true,
        x: event.clientX,
        y: event.clientY,
        title: data.title,
        lines: data.lines,
      });
    },
    [],
  );

  const move = React.useCallback((event: React.MouseEvent) => {
    setTooltip((current) =>
      current.visible
        ? {
            ...current,
            x: event.clientX,
            y: event.clientY,
          }
        : current,
    );
  }, []);

  const hide = React.useCallback(() => {
    setTooltip((current) =>
      current.visible ? { ...current, visible: false } : current,
    );
  }, []);

  return { tooltip, show, move, hide };
}
