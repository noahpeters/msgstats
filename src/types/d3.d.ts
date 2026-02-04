declare module 'd3' {
  export type Axis<T> = ((selection: unknown) => void) & {
    ticks: (arg?: unknown) => Axis<T>;
    tickFormat: (format: (value: T) => string) => Axis<T>;
  };

  export type ScaleTime = {
    (value: Date): number;
    domain: (values: [Date, Date]) => ScaleTime;
    range: (values: [number, number]) => ScaleTime;
  };

  export type ScaleLinear = {
    (value: number): number;
    domain: (values: [number, number]) => ScaleLinear;
    range: (values: [number, number]) => ScaleLinear;
    nice: () => ScaleLinear;
  };

  export type ScaleLog = {
    (value: number): number;
    domain: (values: [number, number]) => ScaleLog;
    range: (values: [number, number]) => ScaleLog;
    nice: () => ScaleLog;
  };

  export function extent<T, R>(
    values: T[],
    accessor: (value: T) => R,
  ): [R | undefined, R | undefined];

  export function scaleTime(): ScaleTime;
  export function scaleLinear(): ScaleLinear;
  export function scaleLog(): ScaleLog;

  export function axisBottom<T>(scale: (value: T) => number): Axis<T>;
  export function axisLeft(scale: (value: number) => number): Axis<number>;

  export const timeHour: {
    every: (step: number) => unknown;
  };

  export const timeDay: {
    every: (step: number) => unknown;
  };

  export function timeFormat(specifier: string): (value: Date) => string;

  export function format(specifier: string): (value: number) => string;

  export function select(node: Element | null): {
    call: (axis: Axis<unknown>) => void;
  };
}
