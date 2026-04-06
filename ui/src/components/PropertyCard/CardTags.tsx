import type { Listing } from '../../types/listing'

function valueRatingClass(rating: string): string {
  const good = rating.includes('good')
  const strong = rating.startsWith('very')
  return `tag value-rating ${good ? 'value-good' : 'value-bad'} ${strong ? 'value-strong' : ''}`
}

export default function CardTags({ listing, valueRating }: { listing: Listing; valueRating?: string }) {
  return (
    <div className="card-tags">
      <span className="tag">{listing.source}</span>
      {listing.property_type && <span className="tag">{listing.property_type}</span>}
      {listing.furnish_type && <span className="tag green">{listing.furnish_type}</span>}
      {listing.epc_rating && <span className="tag green">EPC {listing.epc_rating}</span>}
      {listing.council_tax && <span className="tag">{listing.council_tax}</span>}
      {valueRating && <span className={valueRatingClass(valueRating)}>{valueRating}</span>}
    </div>
  )
}
