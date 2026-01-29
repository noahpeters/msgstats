import * as React from 'react';
import { Link, Outlet, useLocation } from 'react-router';
import * as stylex from '@stylexjs/stylex';
import { layout } from '../app/styles';

const activeLink = stylex.create({
  active: {
    color: '#0c1b1a',
    borderBottom: '2px solid #0f766e',
    paddingBottom: '4px',
  },
});

const footerStyles = stylex.create({
  footer: {
    marginTop: '32px',
    paddingTop: '16px',
    borderTop: '1px solid rgba(12, 27, 26, 0.08)',
    display: 'flex',
    gap: '16px',
    flexWrap: 'wrap',
    fontFamily: '"IBM Plex Sans", "Helvetica", sans-serif',
    fontSize: '14px',
    color: '#284b63',
  },
  footerLink: {
    textDecoration: 'none',
    color: '#0f766e',
    fontWeight: 600,
  },
});

export default function RootRoute(): React.ReactElement {
  const location = useLocation();

  return (
    <div {...stylex.props(layout.page)}>
      <div {...stylex.props(layout.shell)}>
        <div {...stylex.props(layout.badge)}>Messaging insights</div>
        <h1 {...stylex.props(layout.title)}>msgstats</h1>
        <p {...stylex.props(layout.subtitle)}>
          Track conversation quality across Messenger and Instagram.
        </p>
        <nav {...stylex.props(layout.nav)}>
          <Link
            to="/"
            {...stylex.props(
              layout.navLink,
              location.pathname === '/' && activeLink.active,
            )}
          >
            Dashboard
          </Link>
          <Link
            to="/reports"
            {...stylex.props(
              layout.navLink,
              location.pathname.startsWith('/reports') && activeLink.active,
            )}
          >
            Reports
          </Link>
        </nav>
        <Outlet />
        <footer {...stylex.props(footerStyles.footer)}>
          <Link to="/terms" {...stylex.props(footerStyles.footerLink)}>
            Terms of Service
          </Link>
          <Link to="/privacy" {...stylex.props(footerStyles.footerLink)}>
            Privacy Policy
          </Link>
        </footer>
      </div>
    </div>
  );
}
