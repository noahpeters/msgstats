import * as React from 'react';
import * as stylex from '@stylexjs/stylex';
import { useOutletContext } from 'react-router';
import { layout } from '../app/styles';
import { ChartTooltip } from '../components/charts/ChartTooltip';
import { useChartTooltip } from '../components/charts/useChartTooltip';
import Histogram from './Histogram';
import type { AppShellOutletContext } from './root';

type ReportRow = {
  periodStart: string;
  total: number;
  productive: number;
  highly_productive: number;
  price_given: number;
  low_response_after_price: number;
  qualified_rate: number;
  histogram: Record<number, number>;
};

type PageAsset = {
  id: string;
  name: string;
};

const COLUMN_DEFINITIONS: Record<string, string> = {
  Period: 'Reporting bucket start date.',
  Total: 'Total conversations in the period.',
  Productive:
    'Conversations with customer >=3 and business >=3 messages, excluding highly productive.',
  'Highly productive':
    'Conversations with customer >=5 and business >=5 messages.',
  'Price given': "Conversations where any business message includes '$'.",
  'Low response after price':
    'Conversations where customer sent <=2 messages after first price message.',
  'Qualified rate': '(productive + highly productive) / total conversations.',
  Distribution: 'Spark histogram of conversation message-count distribution.',
};

async function fetchReport(
  endpoint: string,
  pageId?: string,
  platform?: string,
  bucket?: 'started' | 'last',
): Promise<ReportRow[]> {
  const params = new URLSearchParams();
  if (pageId) {
    params.set('pageId', pageId);
  }
  if (platform) {
    params.set('platform', platform);
  }
  if (bucket) {
    params.set('bucket', bucket);
  }
  const response = await fetch(
    params.toString() ? `${endpoint}?${params.toString()}` : endpoint,
  );
  if (!response.ok) {
    return [];
  }
  const payload = (await response.json()) as { data: ReportRow[] };
  return payload.data ?? [];
}

function computeMaxY(rows: ReportRow[]): number {
  let maxY = 0;
  for (const row of rows) {
    for (const count of Object.values(row.histogram)) {
      if (count > maxY) {
        maxY = count;
      }
    }
  }
  return maxY;
}

const reportStyles = stylex.create({
  page: {
    display: 'grid',
    gap: '18px',
  },
  intro: {
    margin: 0,
    fontFamily: '"IBM Plex Sans", "Helvetica", sans-serif',
    fontSize: '13px',
    color: '#284b63',
  },
  error: {
    margin: 0,
    color: '#7f1d1d',
    backgroundColor: '#fef2f2',
    border: '1px solid #fca5a5',
    padding: '8px 10px',
    fontSize: '13px',
    fontFamily: '"IBM Plex Sans", "Helvetica", sans-serif',
  },
  section: {
    display: 'grid',
    gap: '10px',
  },
  sectionSplit: {
    paddingTop: '16px',
    borderTop: '1px solid rgba(12, 27, 26, 0.14)',
  },
  sectionTitle: {
    margin: 0,
    fontSize: '19px',
    color: '#0c1b1a',
  },
  sectionNote: {
    margin: 0,
    fontFamily: '"IBM Plex Sans", "Helvetica", sans-serif',
    fontSize: '13px',
    color: '#284b63',
  },
  tableWrap: {
    overflowX: 'auto',
    width: '100%',
  },
  table: {
    width: '100%',
    minWidth: '980px',
    borderCollapse: 'collapse',
    tableLayout: 'fixed',
    fontFamily: '"IBM Plex Sans", "Helvetica", sans-serif',
    fontSize: '13px',
  },
  tableHead: {
    textAlign: 'left',
    borderBottom: '1px solid rgba(12, 27, 26, 0.14)',
    padding: '8px 8px 10px 0',
    color: '#284b63',
    whiteSpace: 'normal',
    lineHeight: 1.2,
    fontWeight: 600,
    verticalAlign: 'top',
  },
  tableHeadLabel: {
    display: 'flex',
    alignItems: 'flex-start',
    gap: '6px',
    minWidth: 0,
  },
  tableHeadText: {
    minWidth: 0,
    overflowWrap: 'anywhere',
    wordBreak: 'break-word',
    flex: 1,
  },
  infoTrigger: {
    flexShrink: 0,
    width: '16px',
    height: '16px',
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    cursor: 'help',
    outline: 'none',
  },
  tableRow: {
    borderBottom: '1px solid rgba(12, 27, 26, 0.08)',
  },
  tableCell: {
    padding: '10px 8px 10px 0',
    color: '#0c1b1a',
    whiteSpace: 'nowrap',
    verticalAlign: 'middle',
  },
  distributionCell: {
    paddingRight: 0,
    minWidth: '220px',
    width: '100%',
  },
  toolbar: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: '10px',
    flexWrap: 'wrap',
    width: '100%',
  },
  toolbarGroup: {
    display: 'inline-flex',
    alignItems: 'center',
    gap: '8px',
    flexWrap: 'wrap',
  },
  toolbarLabel: {
    fontFamily: '"IBM Plex Sans", "Helvetica", sans-serif',
    fontSize: '12px',
    color: '#284b63',
    display: 'inline-flex',
    alignItems: 'center',
    gap: '6px',
    whiteSpace: 'nowrap',
  },
  toolbarSelect: {
    padding: '6px 10px',
    borderRadius: '8px',
    border: '1px solid rgba(12, 27, 26, 0.14)',
    backgroundColor: '#ffffff',
    fontFamily: '"IBM Plex Sans", "Helvetica", sans-serif',
    fontSize: '13px',
  },
});

function ReportTable({
  title,
  rows,
  subtitle,
  separated,
}: {
  title: string;
  rows: ReportRow[];
  subtitle: string;
  separated?: boolean;
}) {
  const maxY = React.useMemo(() => computeMaxY(rows), [rows]);
  const { tooltip, show, move, hide } = useChartTooltip();

  React.useEffect(() => {
    if (!tooltip.visible) {
      return;
    }
    const handleMouseMove = (event: MouseEvent) => {
      const target = event.target;
      if (target instanceof Element) {
        if (target.closest('[data-report-info-trigger="true"]')) {
          return;
        }
      }
      hide();
    };
    window.addEventListener('mousemove', handleMouseMove, { passive: true });
    return () => {
      window.removeEventListener('mousemove', handleMouseMove);
    };
  }, [hide, tooltip.visible]);

  const InfoIcon = ({ label }: { label: string }) => (
    <svg
      width="16"
      height="16"
      viewBox="0 0 16 16"
      role="img"
      aria-label={label}
    >
      <circle cx="8" cy="8" r="8" fill="#7b8794" />
      <text
        x="8"
        y="11"
        textAnchor="middle"
        fill="#ffffff"
        fontSize="10"
        fontWeight="700"
        fontFamily='"IBM Plex Sans", "Helvetica", sans-serif'
      >
        i
      </text>
    </svg>
  );
  const showDefinitionFromFocus = (
    event: React.FocusEvent<HTMLSpanElement>,
    label: keyof typeof COLUMN_DEFINITIONS,
  ) => {
    const rect = event.currentTarget.getBoundingClientRect();
    show(
      {
        clientX: rect.left + rect.width / 2,
        clientY: rect.top + rect.height / 2,
      },
      {
        title: label,
        lines: [COLUMN_DEFINITIONS[label]!],
      },
    );
  };
  const renderHead = (label: keyof typeof COLUMN_DEFINITIONS) => (
    <span {...stylex.props(reportStyles.tableHeadLabel)}>
      <span {...stylex.props(reportStyles.tableHeadText)}>{label}</span>
      <span
        tabIndex={0}
        role="img"
        aria-label={`${label} definition`}
        data-report-info-trigger="true"
        {...stylex.props(reportStyles.infoTrigger)}
        onMouseDown={(event) => {
          event.preventDefault();
        }}
        onMouseEnter={(event) =>
          show(event, {
            title: label,
            lines: [COLUMN_DEFINITIONS[label]!],
          })
        }
        onMouseMove={move}
        onMouseLeave={hide}
        onFocus={(event) => showDefinitionFromFocus(event, label)}
        onBlur={hide}
      >
        <InfoIcon label={`${label} definition`} />
      </span>
    </span>
  );

  return (
    <section
      {...stylex.props(
        reportStyles.section,
        separated && reportStyles.sectionSplit,
      )}
    >
      <h2 {...stylex.props(reportStyles.sectionTitle)}>{title}</h2>
      {subtitle ? (
        <p {...stylex.props(reportStyles.sectionNote)}>{subtitle}</p>
      ) : null}
      <div {...stylex.props(reportStyles.tableWrap)}>
        <table {...stylex.props(reportStyles.table)}>
          <colgroup>
            <col style={{ width: '130px' }} />
            <col style={{ width: '70px' }} />
            <col style={{ width: '90px' }} />
            <col style={{ width: '130px' }} />
            <col style={{ width: '90px' }} />
            <col style={{ width: '190px' }} />
            <col style={{ width: '110px' }} />
            <col style={{ width: 'auto' }} />
          </colgroup>
          <thead>
            <tr {...stylex.props(reportStyles.tableRow)}>
              <th {...stylex.props(reportStyles.tableHead)}>
                {renderHead('Period')}
              </th>
              <th {...stylex.props(reportStyles.tableHead)}>
                {renderHead('Total')}
              </th>
              <th {...stylex.props(reportStyles.tableHead)}>
                {renderHead('Productive')}
              </th>
              <th {...stylex.props(reportStyles.tableHead)}>
                {renderHead('Highly productive')}
              </th>
              <th {...stylex.props(reportStyles.tableHead)}>
                {renderHead('Price given')}
              </th>
              <th {...stylex.props(reportStyles.tableHead)}>
                {renderHead('Low response after price')}
              </th>
              <th {...stylex.props(reportStyles.tableHead)}>
                {renderHead('Qualified rate')}
              </th>
              <th {...stylex.props(reportStyles.tableHead)}>
                {renderHead('Distribution')}
              </th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr
                key={row.periodStart}
                {...stylex.props(reportStyles.tableRow)}
              >
                <td {...stylex.props(reportStyles.tableCell)}>
                  {row.periodStart}
                </td>
                <td {...stylex.props(reportStyles.tableCell)}>{row.total}</td>
                <td {...stylex.props(reportStyles.tableCell)}>
                  {row.productive}
                </td>
                <td {...stylex.props(reportStyles.tableCell)}>
                  {row.highly_productive}
                </td>
                <td {...stylex.props(reportStyles.tableCell)}>
                  {row.price_given}
                </td>
                <td {...stylex.props(reportStyles.tableCell)}>
                  {row.low_response_after_price}
                </td>
                <td {...stylex.props(reportStyles.tableCell)}>
                  {(row.qualified_rate * 100).toFixed(1)}%
                </td>
                <td
                  {...stylex.props(
                    reportStyles.tableCell,
                    reportStyles.distributionCell,
                  )}
                >
                  <Histogram
                    histogram={row.histogram}
                    maxY={maxY}
                    height={24}
                    width="100%"
                  />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <ChartTooltip tooltip={tooltip} />
    </section>
  );
}

export default function ReportsRoute(): React.ReactElement {
  const { setToolbarContent } = useOutletContext<AppShellOutletContext>();
  const [weekly, setWeekly] = React.useState<ReportRow[]>([]);
  const [monthly, setMonthly] = React.useState<ReportRow[]>([]);
  const [pages, setPages] = React.useState<PageAsset[]>([]);
  const [pageId, setPageId] = React.useState('');
  const [platform, setPlatform] = React.useState('');
  const [bucket, setBucket] = React.useState<'started' | 'last'>('started');
  const [actionError, setActionError] = React.useState<string | null>(null);
  const [recomputeRunning, setRecomputeRunning] = React.useState(false);

  const loadReports = React.useCallback(async () => {
    const [weeklyData, monthlyData] = await Promise.all([
      fetchReport(
        '/api/reports/weekly',
        pageId || undefined,
        platform || undefined,
        bucket,
      ),
      fetchReport(
        '/api/reports/monthly',
        pageId || undefined,
        platform || undefined,
        bucket,
      ),
    ]);
    setWeekly(weeklyData);
    setMonthly(monthlyData);
  }, [bucket, pageId, platform]);

  React.useEffect(() => {
    void (async () => {
      const assets = await fetch('/api/assets');
      if (assets.ok) {
        const data = (await assets.json()) as { pages: PageAsset[] };
        setPages(data.pages);
      }
      await loadReports();
    })();
  }, [loadReports]);

  const handleRecompute = React.useCallback(async () => {
    setActionError(null);
    setRecomputeRunning(true);
    try {
      const response = await fetch('/api/reports/recompute', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ pageId: pageId || null }),
      });
      if (!response.ok) {
        throw new Error('Failed to recompute stats.');
      }
      await loadReports();
    } catch (error) {
      setActionError(
        error instanceof Error ? error.message : 'Failed to recompute stats.',
      );
    } finally {
      setRecomputeRunning(false);
    }
  }, [loadReports, pageId]);

  const toolbarContent = React.useMemo(
    () => (
      <div {...stylex.props(reportStyles.toolbar)}>
        <div {...stylex.props(reportStyles.toolbarGroup)}>
          <label {...stylex.props(reportStyles.toolbarLabel)}>
            <span>Asset</span>
            <select
              {...stylex.props(reportStyles.toolbarSelect)}
              value={pageId}
              onChange={(event) => setPageId(event.target.value)}
            >
              <option value="">All pages</option>
              {pages.map((page) => (
                <option key={page.id} value={page.id}>
                  {page.name || `Page ${page.id}`}
                </option>
              ))}
            </select>
          </label>
          <label {...stylex.props(reportStyles.toolbarLabel)}>
            <span>Platform</span>
            <select
              {...stylex.props(reportStyles.toolbarSelect)}
              value={platform}
              onChange={(event) => setPlatform(event.target.value)}
            >
              <option value="">All</option>
              <option value="messenger">Messenger</option>
              <option value="instagram">Instagram</option>
            </select>
          </label>
          <label {...stylex.props(reportStyles.toolbarLabel)}>
            <span>Bucket by</span>
            <select
              {...stylex.props(reportStyles.toolbarSelect)}
              value={bucket}
              onChange={(event) =>
                setBucket(event.target.value as 'started' | 'last')
              }
            >
              <option value="started">First message date</option>
              <option value="last">Last message date</option>
            </select>
          </label>
        </div>
        <div {...stylex.props(reportStyles.toolbarGroup)}>
          <button
            {...stylex.props(layout.ghostButton)}
            onClick={handleRecompute}
            disabled={recomputeRunning}
          >
            {recomputeRunning ? 'Recomputing…' : 'Recompute stats'}
          </button>
        </div>
      </div>
    ),
    [bucket, handleRecompute, pageId, pages, platform, recomputeRunning],
  );

  React.useEffect(() => {
    setToolbarContent(toolbarContent);
    return () => {
      setToolbarContent(null);
    };
  }, [setToolbarContent, toolbarContent]);

  return (
    <div {...stylex.props(reportStyles.page)}>
      <p {...stylex.props(reportStyles.intro)}>
        Weekly and monthly conversation quality rollups across selected assets.
      </p>
      {actionError ? (
        <p {...stylex.props(reportStyles.error)}>{actionError}</p>
      ) : null}
      <ReportTable title="Weekly report" subtitle="" rows={weekly} />
      <ReportTable
        title="Monthly report"
        subtitle=""
        rows={monthly}
        separated
      />
    </div>
  );
}
