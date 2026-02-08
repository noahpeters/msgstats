import * as React from 'react';
import * as stylex from '@stylexjs/stylex';
import { Link } from 'react-router';

const footerStyles = stylex.create({
  content: {
    width: '100%',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: '12px',
    flexWrap: 'wrap',
    fontFamily: '"IBM Plex Sans", "Helvetica", sans-serif',
    fontSize: '12px',
    color: '#284b63',
  },
  left: {
    display: 'inline-flex',
    alignItems: 'center',
    gap: '8px',
  },
  right: {
    display: 'inline-flex',
    alignItems: 'center',
    gap: '10px',
    flexWrap: 'wrap',
  },
  link: {
    textDecoration: 'none',
    color: '#0f766e',
    fontWeight: 600,
  },
  kofiButton: {
    display: 'inline-flex',
    alignItems: 'center',
    padding: '6px 10px',
    borderRadius: '999px',
    border: '1px solid rgba(15, 118, 110, 0.35)',
    textDecoration: 'none',
    color: '#0f766e',
    fontWeight: 600,
    backgroundColor: '#ffffff',
  },
});

export function AppFooter(): React.ReactElement {
  return (
    <div {...stylex.props(footerStyles.content)}>
      <span {...stylex.props(footerStyles.left)}>msgstats</span>
      <div {...stylex.props(footerStyles.right)}>
        <a
          href="https://ko-fi.com/fromtrees"
          target="_blank"
          rel="noreferrer"
          {...stylex.props(footerStyles.kofiButton)}
        >
          Support on Ko-fi
        </a>
        <Link to="/terms" {...stylex.props(footerStyles.link)}>
          Terms of Service
        </Link>
        <Link to="/privacy" {...stylex.props(footerStyles.link)}>
          Privacy Policy
        </Link>
      </div>
    </div>
  );
}
