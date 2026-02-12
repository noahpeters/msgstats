import * as React from 'react';

export function FromTreesIcon({
  size = 36,
}: {
  size?: number;
}): React.ReactElement {
  return (
    <img
      src="/from-trees-msgstats-primary.PNG"
      alt="from trees msgstats"
      width={size}
      height={size}
      style={{
        display: 'block',
        objectFit: 'contain',
      }}
    />
  );
}
