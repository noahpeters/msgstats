import * as React from 'react';
import * as stylex from '@stylexjs/stylex';
import { useOutletContext } from 'react-router';
import { layout } from '../app/styles';
import { ChartTooltip } from '../components/charts/ChartTooltip';
import { useChartTooltip } from '../components/charts/useChartTooltip';
import {
  ToolbarSelect,
  type ToolbarSelectOption,
} from '../components/ToolbarSelect';
import Histogram from './Histogram';
import type { AppShellOutletContext } from './root';

type ReportRow = {
  periodStart: string;
  total: number;
  productive: number;
  highly_productive: number;
  price_given: number;
  low_response_after_price: number;
  early_lost: number;
  early_lost_pct: number;
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
    'Conversations with customer >=3 and business >=3 messages, excluding highly productive. Shows count and (productive / total).',
  'Highly productive':
    'Conversations with customer >=5 and business >=5 messages. Shows count and (highly productive / total).',
  'Qualified rate': '(productive + highly productive) / total conversations.',
  'Price given':
    "Conversations where any business message includes '$'. Shows count and (price given / total).",
  'Low response after price':
    'Conversations where customer sent <=2 messages after first price message. Shows count and (low response after price / price given).',
  'Early lost':
    'Conversations that first reached LOST before ever reaching PRODUCTIVE/HIGHLY_PRODUCTIVE. Shows count and (early lost / total).',
  Distribution: 'Spark histogram of conversation message-count distribution.',
};

const percentFormatter = new Intl.NumberFormat('en-US', {
  style: 'percent',
  minimumFractionDigits: 0,
  maximumFractionDigits: 1,
});

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
  metricValue: {
    display: 'inline-flex',
    alignItems: 'baseline',
    gap: '6px',
  },
  metricPct: {
    fontSize: '11px',
    color: '#5b7287',
  },
  distributionCell: {
    paddingRight: 0,
    minWidth: '220px',
    width: '100%',
  },
  toolbar: {
    display: 'flex',
    alignItems: 'stretch',
    gap: '10px',
    flexWrap: 'nowrap',
    overflowX: 'auto',
    overflowY: 'hidden',
    width: '100%',
    minHeight: '54px',
  },
  toolbarGroup: {
    display: 'flex',
    alignItems: 'stretch',
    gap: '8px',
    flexWrap: 'nowrap',
  },
  toolbarSelectWrap: {
    position: 'relative',
    minWidth: '240px',
    flexShrink: 0,
    borderWidth: '1px',
    borderStyle: 'solid',
    borderColor: '#9aa9b5',
    borderRadius: '8px',
    backgroundColor: '#ffffff',
    boxShadow: '0 0 0 1px #c8d2da',
    ':focus-within': {
      outline: '2px solid #0f766e',
      outlineOffset: '2px',
    },
  },
  toolbarSelectButton: {
    width: '100%',
    minHeight: '54px',
    border: 'none',
    borderRadius: '8px',
    backgroundColor: '#ffffff',
    textAlign: 'left',
    padding: '8px 10px',
    display: 'grid',
    gridTemplateColumns: 'minmax(0, 1fr) auto',
    alignItems: 'center',
    gap: '8px',
    cursor: 'pointer',
    ':focus-visible': {
      outline: 'none',
    },
  },
  toolbarSelectText: {
    display: 'grid',
    gap: '2px',
    minWidth: 0,
  },
  toolbarSelectTitle: {
    fontSize: '13px',
    fontWeight: 700,
    color: '#0c1b1a',
    lineHeight: '1.2',
    whiteSpace: 'nowrap',
    overflow: 'hidden',
    textOverflow: 'ellipsis',
  },
  toolbarSelectDescription: {
    fontSize: '11px',
    color: '#5b7287',
    lineHeight: '1.2',
    whiteSpace: 'nowrap',
    overflow: 'hidden',
    textOverflow: 'ellipsis',
  },
  toolbarSelectCaret: {
    color: '#5b7287',
    fontSize: '14px',
    lineHeight: '1',
    fontWeight: 700,
  },
  toolbarMenu: {
    position: 'fixed',
    zIndex: 60,
    border: '1px solid rgba(12, 27, 26, 0.14)',
    backgroundColor: '#ffffff',
    borderRadius: '10px',
    boxShadow: '0 8px 24px rgba(12, 27, 26, 0.16)',
    padding: '6px',
    display: 'grid',
    gap: '4px',
    fontFamily: '"IBM Plex Sans", "Helvetica", sans-serif',
  },
  toolbarMenuItem: {
    border: 'none',
    borderRadius: '8px',
    backgroundColor: '#ffffff',
    textAlign: 'left',
    padding: '8px',
    display: 'grid',
    gap: '2px',
    cursor: 'pointer',
    ':hover': {
      backgroundColor: '#f3f7f9',
    },
    ':focus-visible': {
      outline: '2px solid #0f766e',
      outlineOffset: '1px',
    },
  },
  toolbarMenuItemSelected: {
    backgroundColor: '#e7f7f2',
  },
  toolbarMenuItemTitle: {
    fontFamily: '"IBM Plex Sans", "Helvetica", sans-serif',
    fontSize: '13px',
    fontWeight: 700,
    color: '#0c1b1a',
    lineHeight: '1.2',
  },
  toolbarMenuItemDescription: {
    fontFamily: '"IBM Plex Sans", "Helvetica", sans-serif',
    fontSize: '11px',
    color: '#5b7287',
    lineHeight: '1.2',
  },
  toolbarActionButton: {
    minHeight: '54px',
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0,
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
            <col style={{ width: '140px' }} />
            <col style={{ width: '150px' }} />
            <col style={{ width: '110px' }} />
            <col style={{ width: '140px' }} />
            <col style={{ width: '210px' }} />
            <col style={{ width: '140px' }} />
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
                {renderHead('Qualified rate')}
              </th>
              <th {...stylex.props(reportStyles.tableHead)}>
                {renderHead('Price given')}
              </th>
              <th {...stylex.props(reportStyles.tableHead)}>
                {renderHead('Low response after price')}
              </th>
              <th {...stylex.props(reportStyles.tableHead)}>
                {renderHead('Early lost')}
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
                  <span {...stylex.props(reportStyles.metricValue)}>
                    <span>{row.productive}</span>
                    <span {...stylex.props(reportStyles.metricPct)}>
                      (
                      {percentFormatter.format(
                        row.total ? row.productive / row.total : 0,
                      )}
                      )
                    </span>
                  </span>
                </td>
                <td {...stylex.props(reportStyles.tableCell)}>
                  <span {...stylex.props(reportStyles.metricValue)}>
                    <span>{row.highly_productive}</span>
                    <span {...stylex.props(reportStyles.metricPct)}>
                      (
                      {percentFormatter.format(
                        row.total ? row.highly_productive / row.total : 0,
                      )}
                      )
                    </span>
                  </span>
                </td>
                <td {...stylex.props(reportStyles.tableCell)}>
                  {percentFormatter.format(row.qualified_rate)}
                </td>
                <td {...stylex.props(reportStyles.tableCell)}>
                  <span {...stylex.props(reportStyles.metricValue)}>
                    <span>{row.price_given}</span>
                    <span {...stylex.props(reportStyles.metricPct)}>
                      (
                      {percentFormatter.format(
                        row.total ? row.price_given / row.total : 0,
                      )}
                      )
                    </span>
                  </span>
                </td>
                <td {...stylex.props(reportStyles.tableCell)}>
                  <span {...stylex.props(reportStyles.metricValue)}>
                    <span>{row.low_response_after_price}</span>
                    <span {...stylex.props(reportStyles.metricPct)}>
                      (
                      {percentFormatter.format(
                        row.price_given
                          ? row.low_response_after_price / row.price_given
                          : 0,
                      )}
                      )
                    </span>
                  </span>
                </td>
                <td {...stylex.props(reportStyles.tableCell)}>
                  <span {...stylex.props(reportStyles.metricValue)}>
                    <span>{row.early_lost}</span>
                    <span {...stylex.props(reportStyles.metricPct)}>
                      (
                      {percentFormatter.format(
                        row.total ? row.early_lost / row.total : 0,
                      )}
                      )
                    </span>
                  </span>
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

  const assetOptions = React.useMemo<ToolbarSelectOption[]>(
    () => [
      {
        value: '',
        title: 'All assets',
        description: 'All connected pages in this workspace.',
      },
      ...pages.map((page) => ({
        value: page.id,
        title: page.name || `Page ${page.id}`,
        description: 'Facebook Page',
      })),
    ],
    [pages],
  );
  const platformOptions = React.useMemo<ToolbarSelectOption[]>(
    () => [
      {
        value: '',
        title: 'All platforms',
        description: 'Messenger and Instagram conversations.',
      },
      {
        value: 'messenger',
        title: 'Messenger',
        description: 'Facebook Messenger only.',
      },
      {
        value: 'instagram',
        title: 'Instagram',
        description: 'Instagram DM only.',
      },
    ],
    [],
  );
  const bucketOptions = React.useMemo<ToolbarSelectOption[]>(
    () => [
      {
        value: 'started',
        title: 'First message date',
        description: 'Bucket by conversation start date.',
      },
      {
        value: 'last',
        title: 'Last message date',
        description: 'Bucket by most recent message date.',
      },
    ],
    [],
  );

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
          <ToolbarSelect
            ariaLabel="Report asset filter"
            value={pageId}
            options={assetOptions}
            onChange={setPageId}
            minWidth="240px"
          />
          <ToolbarSelect
            ariaLabel="Report platform filter"
            value={platform}
            options={platformOptions}
            onChange={setPlatform}
            minWidth="240px"
          />
          <ToolbarSelect
            ariaLabel="Report bucket filter"
            value={bucket}
            options={bucketOptions}
            onChange={(value) => setBucket(value as 'started' | 'last')}
            minWidth="240px"
          />
        </div>
        <div {...stylex.props(reportStyles.toolbarGroup)}>
          <button
            {...stylex.props(
              layout.ghostButton,
              reportStyles.toolbarActionButton,
            )}
            onClick={handleRecompute}
            disabled={recomputeRunning}
          >
            {recomputeRunning ? 'Recomputing…' : 'Recompute stats'}
          </button>
        </div>
      </div>
    ),
    [
      assetOptions,
      bucket,
      bucketOptions,
      handleRecompute,
      pageId,
      platform,
      platformOptions,
      recomputeRunning,
    ],
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
