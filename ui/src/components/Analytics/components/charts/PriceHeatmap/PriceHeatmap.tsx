import ChartCard from '../../ChartCard/ChartCard';
import type { PriceHeatmapProps } from './properties';

function getColor(avg: number, maxAvg: number): string {
  const ratio = avg / maxAvg;
  if (ratio < 0.25) return '#1a1c2e';
  if (ratio < 0.45) return '#7c5cfc';
  if (ratio < 0.65) return '#38bdf8';
  if (ratio < 0.85) return '#fbbf24';
  return '#f472b6';
}

export default function PriceHeatmap({ data, onDrillDown }: PriceHeatmapProps) {
  const types = [...new Set(data.map((d) => d.type))];
  const beds = [...new Set(data.map((d) => d.beds))];
  const maxAvg = Math.max(...data.map((d) => d.avg));

  const lookup = new Map(data.map((d) => [`${d.beds}|${d.type}`, d]));

  return (
    <ChartCard title="Avg Price Heatmap: Bedrooms x Property Type" wide>
      <div className="heatmap-grid">
        <table>
          <thead>
            <tr>
              <th />
              {types.map((t) => (
                <th key={t}>{t}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {beds.map((b) => (
              <tr key={b}>
                <td>{b}</td>
                {types.map((t) => {
                  const cell = lookup.get(`${b}|${t}`);
                  return (
                    <td
                      key={t}
                      className="heatmap-cell"
                      style={{ background: cell ? getColor(cell.avg, maxAvg) : '#111', cursor: cell ? 'pointer' : undefined }}
                      title={
                        cell
                          ? `£${cell.avg.toLocaleString()} avg (${cell.count} listings)`
                          : 'No data'
                      }
                      onClick={() => {
                        if (cell && onDrillDown) {
                          const bedsMatch = cell.beds.match(/(\d+)/)
                          const bedsNum = bedsMatch ? bedsMatch[1] : ''
                          onDrillDown({ bedrooms: bedsNum, propertyType: cell.type })
                        }
                      }}
                    />
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </ChartCard>
  );
}
