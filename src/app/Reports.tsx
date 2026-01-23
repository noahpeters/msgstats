import * as React from 'react';
import * as stylex from '@stylexjs/stylex';
import { layout } from './styles';

type ReportRow = {
  period: string;
  total: number;
  productive: number;
  highlyProductive: number;
  priceGiven: number;
  qualifiedRate: number;
};

type PageAsset = {
  id: string;
  name: string;
};

type BucketBy = 'start' | 'updated';

async function fetchReport(
  endpoint: string,
  pageId?: string,
  bucketBy?: BucketBy,
): Promise<ReportRow[]> {
  const params = new URLSearchParams();
  if (pageId) {
    params.set('pageId', pageId);
  }
  if (bucketBy) {
    params.set('bucketBy', bucketBy);
  }
  const response = await fetch(
    params.toString() ? `${endpoint}?${params.toString()}` : endpoint,
  );
  if (!response.ok) {
    return [];
  }
  return response.json();
}

function ReportTable({
  title,
  rows,
  bucketBy,
}: {
  title: string;
  rows: ReportRow[];
  bucketBy: BucketBy;
}) {
  return (
    <section {...stylex.props(layout.card)}>
      <h2>{title}</h2>
      <p {...stylex.props(layout.note)}>
        Productive: customer ≥3 and business ≥3. Highly productive: customer ≥5
        and business ≥5. Price given: any business message includes "$".
        Qualified rate: (productive + highly productive) / total. Buckets are
        based on the conversation{' '}
        {bucketBy === 'start' ? 'start' : 'last update'} date.
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
            <tr key={row.period} {...stylex.props(layout.tableRow)}>
              <td {...stylex.props(layout.tableCell)}>{row.period}</td>
              <td {...stylex.props(layout.tableCell)}>{row.total}</td>
              <td {...stylex.props(layout.tableCell)}>{row.productive}</td>
              <td {...stylex.props(layout.tableCell)}>
                {row.highlyProductive}
              </td>
              <td {...stylex.props(layout.tableCell)}>{row.priceGiven}</td>
              <td {...stylex.props(layout.tableCell)}>
                {(row.qualifiedRate * 100).toFixed(1)}%
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  );
}

export default function Reports(): React.ReactElement {
  const [weekly, setWeekly] = React.useState<ReportRow[]>([]);
  const [monthly, setMonthly] = React.useState<ReportRow[]>([]);
  const [recomputing, setRecomputing] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [pages, setPages] = React.useState<PageAsset[]>([]);
  const [pageId, setPageId] = React.useState<string>('');
  const [bucketBy, setBucketBy] = React.useState<BucketBy>('start');

  const loadReports = React.useCallback(async () => {
    const [weeklyData, monthlyData] = await Promise.all([
      fetchReport('/api/reports/weekly', pageId || undefined, bucketBy),
      fetchReport('/api/reports/monthly', pageId || undefined, bucketBy),
    ]);
    setWeekly(weeklyData);
    setMonthly(monthlyData);
  }, [pageId, bucketBy]);

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
    setRecomputing(true);
    setError(null);
    try {
      const response = await fetch('/api/recompute', { method: 'POST' });
      if (!response.ok) {
        throw new Error('Recompute failed.');
      }
      await loadReports();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Recompute failed.');
    } finally {
      setRecomputing(false);
    }
  };

  return (
    <div style={{ display: 'grid', gap: '18px' }}>
      <section {...stylex.props(layout.card)}>
        <div style={{ display: 'flex', gap: '12px', alignItems: 'center' }}>
          <button
            {...stylex.props(layout.button)}
            onClick={handleRecompute}
            disabled={recomputing}
          >
            {recomputing ? 'Recomputing…' : 'Recompute Stats'}
          </button>
          <label {...stylex.props(layout.note)}>
            <span style={{ marginRight: '8px' }}>Page filter</span>
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
            <span style={{ marginRight: '8px' }}>Bucket by</span>
            <select
              value={bucketBy}
              onChange={(event) => setBucketBy(event.target.value as BucketBy)}
            >
              <option value="start">Conversation start</option>
              <option value="updated">Conversation updated</option>
            </select>
          </label>
          {error ? <span>{error}</span> : null}
        </div>
        <p {...stylex.props(layout.note)}>
          Recompute message counts from stored messages without syncing again.
        </p>
      </section>
      <ReportTable title="Weekly report" rows={weekly} bucketBy={bucketBy} />
      <ReportTable title="Monthly report" rows={monthly} bucketBy={bucketBy} />
    </div>
  );
}
