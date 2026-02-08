import * as React from 'react';
import * as d3 from 'd3';
import { ChartTooltip } from '../components/charts/ChartTooltip';
import { useChartTooltip } from '../components/charts/useChartTooltip';

type HistogramProps = {
  histogram: Record<number, number>;
  maxY: number;
  height?: number;
  width?: number | string;
};

const NUM_BARS = 30;
const BAR_WIDTH = 2;
const GAP = 1;
const WIDTH = BAR_WIDTH * NUM_BARS + GAP * (NUM_BARS - 1);

export default function Histogram({
  histogram,
  maxY,
  height = 24,
  width = WIDTH,
}: HistogramProps): React.ReactElement {
  const safeMaxY = Math.max(1, maxY);
  const { tooltip, show, move, hide } = useChartTooltip();
  const yScale = d3.scaleLinear().domain([0, safeMaxY]).range([0, height]);

  return (
    <>
      <svg
        width={width}
        height={height}
        role="img"
        viewBox={`0 0 ${WIDTH} ${height}`}
        preserveAspectRatio="none"
      >
        {Array.from({ length: NUM_BARS }, (_, index) => {
          const xValue = index + 1;
          const count = histogram[xValue] ?? 0;
          const barHeight = maxY > 0 ? yScale(count) : 0;
          const slotWidth =
            index === NUM_BARS - 1 ? BAR_WIDTH : BAR_WIDTH + GAP;
          const x = index * (BAR_WIDTH + GAP);
          const y = height - barHeight;
          const label = xValue === NUM_BARS ? '≥30' : String(xValue);
          return (
            <g key={xValue}>
              <rect
                x={x}
                y={0}
                width={slotWidth}
                height={height}
                fill="transparent"
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
              <rect
                x={x}
                y={y}
                width={BAR_WIDTH}
                height={barHeight}
                fill="#888"
                pointerEvents="none"
              />
            </g>
          );
        })}
      </svg>
      <ChartTooltip tooltip={tooltip} />
    </>
  );
}
