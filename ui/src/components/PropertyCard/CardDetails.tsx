import type { Listing } from '../../types/listing'

const BedIcon = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M2 4v16" /><path d="M2 8h18a2 2 0 0 1 2 2v10" /><path d="M2 17h20" /><path d="M6 8v-2a2 2 0 0 1 2-2h8a2 2 0 0 1 2 2v2" />
  </svg>
)

const BathIcon = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M4 12h16a1 1 0 0 1 1 1v3a4 4 0 0 1-4 4H7a4 4 0 0 1-4-4v-3a1 1 0 0 1 1-1z" /><path d="M6 12V5a2 2 0 0 1 2-2h3v2.25" /><path d="M4 21l1-1.5" /><path d="M20 21l-1-1.5" />
  </svg>
)

const SqftIcon = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <rect x="3" y="3" width="18" height="18" rx="2" /><path d="M3 12h18" /><path d="M12 3v18" />
  </svg>
)

export default function CardDetails({ listing }: { listing: Listing }) {
  const hasAny = listing.bedrooms != null || listing.bathrooms != null || listing.size_sq_ft
  if (!hasAny) return null

  return (
    <div className="card-details">
      {listing.bedrooms != null && (
        <span className="card-detail"><BedIcon /> {listing.bedrooms} bed{listing.bedrooms !== 1 ? 's' : ''}</span>
      )}
      {listing.bathrooms != null && (
        <span className="card-detail"><BathIcon /> {listing.bathrooms} bath{listing.bathrooms !== 1 ? 's' : ''}</span>
      )}
      {listing.size_sq_ft && (
        <span className="card-detail"><SqftIcon /> {listing.size_sq_ft}</span>
      )}
    </div>
  )
}
