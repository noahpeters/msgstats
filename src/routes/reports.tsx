import * as React from 'react';
import * as stylex from '@stylexjs/stylex';
import { layout } from '../app/styles';

type ReportRow = {
  periodStart: string;
  total: number;
  productive: number;
  highly_productive: number;
  price_given: number;
  qualified_rate: number;
};

type PageAsset = {
  id: string;
  name: string;
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

function ReportTable({ title, rows }: { title: string; rows: ReportRow[] }) {
  return (
    <section {...stylex.props(layout.card)}>
      <h2>{title}</h2>
      <p {...stylex.props(layout.note)}>
        Productive: customer ≥3 and business ≥3. Highly productive: customer ≥5
        and business ≥5. Price given: any business message includes
        &quot;$&quot;. Qualified rate: (productive + highly productive) / total.
      </p>
      <table {...stylex.props(layout.table)}>
        <thead>
          <tr {...stylex.props(layout.tableRow)}>
            <th {...stylex.props(layout.tableHead)}>Period</th>
            <th {...stylex.props(layout.tableHead)}>Total</th>
            <th {...stylex.props(layout.tableHead)}>Productive</th>
            <th {...stylex.props(layout.tableHead)}>Highly productive</th>
            <th {...stylex.props(layout.tableHead)}>Price given</th>
            <th {...stylex.props(layout.tableHead)}>Qualified rate</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.periodStart} {...stylex.props(layout.tableRow)}>
              <td {...stylex.props(layout.tableCell)}>{row.periodStart}</td>
              <td {...stylex.props(layout.tableCell)}>{row.total}</td>
              <td {...stylex.props(layout.tableCell)}>{row.productive}</td>
              <td {...stylex.props(layout.tableCell)}>
                {row.highly_productive}
              </td>
              <td {...stylex.props(layout.tableCell)}>{row.price_given}</td>
              <td {...stylex.props(layout.tableCell)}>
                {(row.qualified_rate * 100).toFixed(1)}%
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  );
}

export default function ReportsRoute(): React.ReactElement {
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

  const handleRecompute = async () => {
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
  };

  return (
    <div style={{ display: 'grid', gap: '18px' }}>
      <section {...stylex.props(layout.card)}>
        <div
          style={{
            display: 'flex',
            gap: '12px',
            alignItems: 'center',
            flexWrap: 'wrap',
          }}
        >
          <label {...stylex.props(layout.note)}>
            <span style={{ marginRight: '8px' }}>Asset</span>
            <select
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
          <label {...stylex.props(layout.note)}>
            <span style={{ marginRight: '8px' }}>Platform</span>
            <select
              value={platform}
              onChange={(event) => setPlatform(event.target.value)}
            >
              <option value="">All</option>
              <option value="messenger">Messenger</option>
              <option value="instagram">Instagram</option>
            </select>
          </label>
          <label {...stylex.props(layout.note)}>
            <span style={{ marginRight: '8px' }}>Bucket by</span>
            <select
              value={bucket}
              onChange={(event) =>
                setBucket(event.target.value as 'started' | 'last')
              }
            >
              <option value="started">First message date</option>
              <option value="last">Last message date</option>
            </select>
          </label>
          <button
            {...stylex.props(layout.ghostButton)}
            onClick={handleRecompute}
            disabled={recomputeRunning}
          >
            {recomputeRunning ? 'Recomputing…' : 'Recompute stats'}
          </button>
        </div>
        {actionError ? (
          <p style={{ marginTop: '8px', color: '#cc4a4a' }}>{actionError}</p>
        ) : null}
      </section>
      <ReportTable title="Weekly report" rows={weekly} />
      <ReportTable title="Monthly report" rows={monthly} />
    </div>
  );
}
