import * as React from 'react';
import * as stylex from '@stylexjs/stylex';
import { layout } from './styles';

type ReportRow = {
  period: string;
  total: number;
  productive: number;
  highlyProductive: number;
  qualifiedRate: number;
};

async function fetchReport(endpoint: string): Promise<ReportRow[]> {
  const response = await fetch(endpoint);
  if (!response.ok) {
    return [];
  }
  return response.json();
}

function ReportTable({ title, rows }: { title: string; rows: ReportRow[] }) {
  return (
    <section {...stylex.props(layout.card)}>
      <h2>{title}</h2>
      <table {...stylex.props(layout.table)}>
        <thead>
          <tr {...stylex.props(layout.tableRow)}>
            <th {...stylex.props(layout.tableHead)}>Period</th>
            <th {...stylex.props(layout.tableHead)}>Total</th>
            <th {...stylex.props(layout.tableHead)}>Productive</th>
            <th {...stylex.props(layout.tableHead)}>Highly productive</th>
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

  React.useEffect(() => {
    let mounted = true;
    void (async () => {
      const [weeklyData, monthlyData] = await Promise.all([
        fetchReport('/api/reports/weekly'),
        fetchReport('/api/reports/monthly'),
      ]);
      if (mounted) {
        setWeekly(weeklyData);
        setMonthly(monthlyData);
      }
    })();
    return () => {
      mounted = false;
    };
  }, []);

  return (
    <div style={{ display: 'grid', gap: '18px' }}>
      <ReportTable title="Weekly report" rows={weekly} />
      <ReportTable title="Monthly report" rows={monthly} />
    </div>
  );
}
