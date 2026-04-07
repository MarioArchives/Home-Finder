import type { NearbyData } from '../../types/listing'

export interface PinDistance {
  label: string
  emoji: string
  distance_m: number
}

export interface NearbyBadgesProps {
  nearby?: NearbyData
  commuteDistance?: number | null
  commuteDuration?: number | null
  pinDistances?: PinDistance[]
}
