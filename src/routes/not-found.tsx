import * as React from 'react';
import * as stylex from '@stylexjs/stylex';
import { layout } from '../app/styles';

export default function NotFound(): React.ReactElement {
  return (
    <section {...stylex.props(layout.card)}>
      <h2>Not found</h2>
      <p {...stylex.props(layout.note)}>
        The page you requested could not be found.
      </p>
    </section>
  );
}
