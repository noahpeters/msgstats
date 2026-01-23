import * as stylex from '@stylexjs/stylex';

export const colors = {
  ink: '#0c1b1a',
  mint: '#9ae6b4',
  sea: '#0f766e',
  sunrise: '#ffb347',
  sand: '#f8f5f2',
  slate: '#284b63',
  cloud: '#f2f4f8',
  coral: '#f97068',
};

export const layout = stylex.create({
  page: {
    minHeight: '100vh',
    background: `linear-gradient(135deg, ${colors.sand} 0%, ${colors.cloud} 60%, #ffffff 100%)`,
    color: colors.ink,
    fontFamily: '"DM Serif Display", "Georgia", serif',
  },
  shell: {
    maxWidth: '1100px',
    margin: '0 auto',
    padding: '32px 24px 64px',
  },
  title: {
    fontSize: '42px',
    letterSpacing: '-0.02em',
    marginBottom: '8px',
  },
  subtitle: {
    fontFamily: '"IBM Plex Sans", "Helvetica", sans-serif',
    fontSize: '16px',
    color: colors.slate,
    marginBottom: '24px',
  },
  card: {
    backgroundColor: '#ffffff',
    borderRadius: '20px',
    padding: '20px 24px',
    boxShadow: '0 18px 60px rgba(15, 118, 110, 0.08)',
    border: `1px solid rgba(15, 118, 110, 0.12)`,
  },
  grid: {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))',
    gap: '16px',
  },
  nav: {
    display: 'flex',
    gap: '16px',
    marginBottom: '24px',
    fontFamily: '"IBM Plex Sans", "Helvetica", sans-serif',
  },
  navLink: {
    textDecoration: 'none',
    color: colors.sea,
    fontWeight: 600,
  },
  button: {
    padding: '10px 18px',
    borderRadius: '999px',
    border: 'none',
    backgroundColor: colors.sea,
    color: '#ffffff',
    fontFamily: '"IBM Plex Sans", "Helvetica", sans-serif',
    cursor: 'pointer',
  },
  ghostButton: {
    padding: '10px 18px',
    borderRadius: '999px',
    border: `1px solid ${colors.sea}`,
    backgroundColor: 'transparent',
    color: colors.sea,
    fontFamily: '"IBM Plex Sans", "Helvetica", sans-serif',
    cursor: 'pointer',
  },
  badge: {
    display: 'inline-flex',
    alignItems: 'center',
    gap: '6px',
    padding: '4px 10px',
    borderRadius: '999px',
    backgroundColor: colors.mint,
    color: colors.ink,
    fontFamily: '"IBM Plex Sans", "Helvetica", sans-serif',
    fontSize: '12px',
    fontWeight: 600,
  },
  table: {
    width: '100%',
    borderCollapse: 'collapse',
    fontFamily: '"IBM Plex Sans", "Helvetica", sans-serif',
  },
  tableHead: {
    textAlign: 'left',
    borderBottom: `1px solid rgba(12, 27, 26, 0.12)`,
    paddingBottom: '8px',
  },
  tableRow: {
    borderBottom: `1px solid rgba(12, 27, 26, 0.08)`,
  },
  tableCell: {
    padding: '12px 0',
  },
  note: {
    fontFamily: '"IBM Plex Sans", "Helvetica", sans-serif',
    fontSize: '14px',
    color: colors.slate,
  },
});
