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
      </div>
    </div>
  );
}
