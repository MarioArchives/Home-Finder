import { formatDistance } from '../../shared/utils/utils'
import type { NearbyBadgesProps } from './properties'
import './NearbyBadges.css'

function formatDuration(seconds: number): string {
  const mins = Math.round(seconds / 60)
  if (mins < 60) return `${mins}min`
  const h = Math.floor(mins / 60)
  const m = mins % 60
  return m > 0 ? `${h}h${m}m` : `${h}h`
}

export default function NearbyBadges({ nearby, commuteDistance, commuteDuration }: NearbyBadgesProps) {
  if (!nearby) return <div className="nearby-row loading">Loading nearby places...</div>
  const climbing = nearby.closest_climbing ?? nearby.closest_amenities?.climbing
  const cinema = nearby.closest_amenities?.cinema
  const gym = nearby.closest_amenities?.gym
  const parks = nearby.closest_amenities?.parks
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
      {cinema && (
        <span className="nearby-badge" title={`Nearest cinema: ${cinema.name}`}>
          <span className="nearby-icon">&#127916;</span> {formatDistance(cinema.distance_m)}
        </span>
      )}
      {gym && (
        <span className="nearby-badge" title={`Nearest gym: ${gym.name}`}>
          <span className="nearby-icon">&#127947;</span> {formatDistance(gym.distance_m)}
        </span>
      )}
      {parks && (
        <span className="nearby-badge" title={`Nearest park: ${parks.name}`}>
          <span className="nearby-icon">&#127795;</span> {formatDistance(parks.distance_m)}
        </span>
      )}
      {commuteDistance != null && (
        <span className="nearby-badge commute-badge" title={`Commute to work: ${formatDistance(commuteDistance)}${commuteDuration != null ? ` (~${formatDuration(commuteDuration)} drive)` : ''}`}>
          <span className="nearby-icon">&#128188;</span> {formatDistance(commuteDistance)}{commuteDuration != null && <span className="commute-time"> ~{formatDuration(commuteDuration)}</span>}
        </span>
      )}
    </div>
  )
}
