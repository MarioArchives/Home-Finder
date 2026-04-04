import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
} from 'recharts';
import ChartCard from '../../ChartCard/ChartCard';
import type { PriceByCouncilTaxProps } from './properties';

export default function PriceByCouncilTax({ data, onDrillDown }: PriceByCouncilTaxProps) {
  return (
    <ChartCard title="Avg Price by Council Tax Band">
      <ResponsiveContainer width="100%" height={300}>
        <BarChart data={data}>
          <CartesianGrid strokeDasharray="3 3" stroke="#2d2f3e" />
          <XAxis dataKey="band" tick={{ fill: '#8b8fa3', fontSize: 11 }} />
          <YAxis tick={{ fill: '#8b8fa3', fontSize: 11 }} />
          <Tooltip
            content={({ payload }) => {
              if (!payload || !payload.length) return null;
              const d = payload[0].payload;
              return (
                <div className="analytics-tooltip">
                  <div>Band {d.band}</div>
                  <div>Avg: £{d.avg.toLocaleString()}</div>
                  <div className="analytics-tooltip-secondary">{d.count} listings</div>
                </div>
              );
            }}
          />
          <Bar
            dataKey="avg"
            fill="#34d399"
            cursor="pointer"
            onClick={(data: any) => {
              if (onDrillDown) {
                const match = data.band.match(/([A-H])/i)
                if (match) onDrillDown({ councilTax: match[1].toUpperCase() })
              }
            }}
          />
        </BarChart>
      </ResponsiveContainer>
    </ChartCard>
  );
}
