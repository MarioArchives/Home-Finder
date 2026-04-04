import { formatDistance } from '../../shared/utils/utils'
import type { NearbyBadgesProps } from './properties'
import './NearbyBadges.css'

export default function NearbyBadges({ nearby }: NearbyBadgesProps) {
  if (!nearby) return <div className="nearby-row loading">Loading nearby places...</div>
  const climbing = nearby.closest_climbing
  return (
    <div className="nearby-row">
      <span className="nearby-badge" title="Bars & pubs within 1km">
        <span className="nearby-icon">&#127866;</span> {nearby.bars} bar{nearby.bars !== 1 ? 's' : ''}
      </span>
      <span className="nearby-badge" title="Cafes within 1km">
        <span className="nearby-icon">&#9749;</span> {nearby.cafes} cafe{nearby.cafes !== 1 ? 's' : ''}
      </span>
      <span className="nearby-badge" title="Supermarkets & big shops within 1km">
        <span className="nearby-icon">&#128722;</span> {nearby.shops} shop{nearby.shops !== 1 ? 's' : ''}
      </span>
      {climbing && (
        <span className="nearby-badge" title={`Nearest climbing gym: ${climbing.name}`}>
          <span className="nearby-icon">&#129495;</span> {formatDistance(climbing.distance_m)}
        </span>
      )}
    </div>
  )
}
