import type { AuthenticatedMedusaRequest, MedusaResponse } from '@medusajs/framework/http'
import { MedusaError } from '@medusajs/framework/utils'

import {
  type ListingRow,
  publishListing,
  refreshListing,
  setListingStatus,
  syncListing,
  updateListingContent,
  validateListing,
} from '../../../../../lib/listings'
import { moduleOf, sessionOf } from '../../../../../lib/session'
import type { UpdateListing } from '../../validators'

/** Saves the listing's settings and, with `action`, does something with it at Mercado Livre. */
export async function POST(req: AuthenticatedMedusaRequest<UpdateListing>, res: MedusaResponse) {
  const service = moduleOf(req.scope)
  const id = req.params.id!
  const { action, settings, ...fields } = req.validatedBody
  const current = (await service.retrieveMlListing(id)) as unknown as ListingRow
  if (current.item_id && fields.category_id && fields.category_id !== current.category_id) {
    throw new MedusaError(
      MedusaError.Types.NOT_ALLOWED,
      'The category of a published listing cannot change'
    )
  }
  const changes = Object.fromEntries(
    Object.entries(fields).filter(([, value]) => value !== undefined)
  )
  if (settings || Object.keys(changes).length) {
    await service.updateMlListings({
      id,
      ...changes,
      // The size rows belong to the chart: a new chart is read again when publishing.
      ...(settings ? { settings: settings as Record<string, unknown> } : {}),
    })
  }
  let result: unknown = null
  switch (action) {
    case 'validate':
      result = await validateListing(req.scope, id)
      break
    case 'publish':
      result = await publishListing(req.scope, id)
      break
    case 'sync': {
      const session = await sessionOf(req.scope)
      const listing = (await service.retrieveMlListing(id)) as unknown as ListingRow
      result = { updated: await syncListing(req.scope, session, listing, true) }
      break
    }
    case 'refresh':
      await refreshListing(req.scope, id)
      break
    case 'content':
      await updateListingContent(req.scope, id)
      break
    case 'pause':
      await setListingStatus(req.scope, id, 'paused')
      break
    case 'activate':
      await setListingStatus(req.scope, id, 'active')
      break
    case 'close':
      await setListingStatus(req.scope, id, 'closed')
      break
  }
  res.json({ listing: await service.retrieveMlListing(id), result })
}

/** Forgets a listing that is not live (a draft, a failed publish, or one closed at Mercado Livre). */
export async function DELETE(req: AuthenticatedMedusaRequest, res: MedusaResponse) {
  const service = moduleOf(req.scope)
  const listing = (await service.retrieveMlListing(req.params.id!)) as unknown as ListingRow
  if (listing.item_id && !['closed', 'error'].includes(listing.status)) {
    throw new MedusaError(
      MedusaError.Types.NOT_ALLOWED,
      'Close the listing at Mercado Livre before removing it'
    )
  }
  await service.deleteMlListings(listing.id)
  res.json({ id: listing.id, deleted: true })
}
