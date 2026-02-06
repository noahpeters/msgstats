import * as React from 'react';
import { Link } from 'react-router';
import * as stylex from '@stylexjs/stylex';
import { layout } from '../app/styles';

const styles = stylex.create({
  card: {
    display: 'grid',
    gap: '12px',
    padding: '16px',
    borderRadius: '16px',
    backgroundColor: '#ffffff',
    border: '1px solid rgba(12, 27, 26, 0.1)',
  },
});

export default function InboxFollowupRedirect(): React.ReactElement {
  return (
    <div style={{ display: 'grid', gap: '16px' }}>
      <section {...stylex.props(layout.card, styles.card)}>
        <h2>Follow-Up Inbox Moved</h2>
        <p {...stylex.props(layout.note)}>
          The follow-up inbox now lives at /inbox with the Conversation
          Inspector.
        </p>
        <Link to="/inbox" {...stylex.props(layout.ghostButton)}>
          Go to Inbox
        </Link>
      </section>
    </div>
  );
}
