import * as React from 'react';
import * as d3 from 'd3';
import { ChartTooltip } from '../components/charts/ChartTooltip';
import { useChartTooltip } from '../components/charts/useChartTooltip';

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
  const { tooltip, show, move, hide } = useChartTooltip();
  const yScale = d3.scaleLinear().domain([0, safeMaxY]).range([0, height]);

  return (
    <>
      <svg width={WIDTH} height={height} role="img">
        {Array.from({ length: NUM_BARS }, (_, index) => {
          const xValue = index + 1;
          const count = histogram[xValue] ?? 0;
          const barHeight = maxY > 0 ? yScale(count) : 0;
          const x = index * (BAR_WIDTH + GAP);
          const y = height - barHeight;
          const label = xValue === NUM_BARS ? '≥30' : String(xValue);
          return (
            <rect
              key={xValue}
              x={x}
              y={y}
              width={BAR_WIDTH}
              height={barHeight}
              fill="#888"
              aria-label={`${label} messages: ${count} conversations`}
              onMouseEnter={(event) =>
                show(event, {
                  title: label,
                  lines: [`${label} messages: ${count} conversations`],
                })
              }
              onMouseMove={move}
              onMouseLeave={hide}
            />
          );
        })}
      </svg>
      <ChartTooltip tooltip={tooltip} />
    </>
  );
}
