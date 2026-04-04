import {
  ScatterChart,
  Scatter,
  XAxis,
  YAxis,
  ZAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ResponsiveContainer,
} from 'recharts';
import ChartCard from '../../ChartCard/ChartCard';
import { COLORS } from '../../../constants';
import type { PriceScatterProps } from './properties';

export default function PriceScatter({ scatterBySource, onSelectListing, onDrillDown }: PriceScatterProps) {
  return (
    <ChartCard title="Price vs Bedrooms (all listings)" wide>
      <ResponsiveContainer width="100%" height={350}>
        <ScatterChart>
          <CartesianGrid strokeDasharray="3 3" stroke="#2d2f3e" />
          <XAxis
            type="number"
            dataKey="beds"
            name="Bedrooms"
            tick={{ fill: '#8b8fa3', fontSize: 11 }}
            label={{ value: 'Bedrooms', position: 'insideBottom', offset: -5, fill: '#8b8fa3' }}
          />
          <YAxis
            type="number"
            dataKey="price"
            name="Price"
            tick={{ fill: '#8b8fa3', fontSize: 11 }}
            label={{ value: 'Price', angle: -90, position: 'insideLeft', fill: '#8b8fa3' }}
          />
          <ZAxis type="number" dataKey="baths" range={[30, 200]} name="Bathrooms" />
          <Tooltip
            content={({ payload }) => {
              if (!payload || !payload.length) return null;
              const d = payload[0].payload;
              return (
                <div className="analytics-tooltip">
                  <div>£{d.price.toLocaleString()} pcm</div>
                  <div>{d.beds} bed, {d.baths} bath</div>
                  <div className="analytics-tooltip-secondary">{d.address}</div>
                </div>
              );
            }}
          />
          {scatterBySource.map((group, i) => (
            <Scatter
              key={group.name}
              name={group.name}
              data={group.data}
              fill={COLORS[i % COLORS.length]}
              opacity={0.7}
              cursor="pointer"
              onClick={(data: any) => {
                onSelectListing(data.listing)
                if (onDrillDown) onDrillDown({ bedrooms: String(data.beds), minPrice: String(data.price - 50), maxPrice: String(data.price + 50) })
              }}
            />
          ))}
          <Legend />
        </ScatterChart>
      </ResponsiveContainer>
    </ChartCard>
  );
}
