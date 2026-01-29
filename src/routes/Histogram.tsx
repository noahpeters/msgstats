import * as React from 'react';

type HistogramProps = {
  histogram: Record<number, number>;
  maxY: number;
  height?: number;
};

const NUM_BARS = 30;
const BAR_WIDTH = 2;
const GAP = 1;
const WIDTH = BAR_WIDTH * NUM_BARS + GAP * (NUM_BARS - 1);

export default function Histogram({
  histogram,
  maxY,
  height = 24,
}: HistogramProps): React.ReactElement {
  const safeMaxY = Math.max(1, maxY);

  return (
    <svg width={WIDTH} height={height} role="img">
      {Array.from({ length: NUM_BARS }, (_, index) => {
        const xValue = index + 1;
        const count = histogram[xValue] ?? 0;
        const barHeight = maxY > 0 ? (count / safeMaxY) * height : 0;
        const x = index * (BAR_WIDTH + GAP);
        const y = height - barHeight;
        return (
          <rect
            key={xValue}
            x={x}
            y={y}
            width={BAR_WIDTH}
            height={barHeight}
            fill="#888"
          >
            <title>
              {xValue === NUM_BARS ? '≥30' : xValue} messages: {count}{' '}
              conversations
            </title>
          </rect>
        );
      })}
    </svg>
  );
}
