import type { AuthenticatedMedusaRequest, MedusaResponse } from '@medusajs/framework/http'

import { syncListings } from '../../../../lib/listings'

/** Sends stock and price of every published listing now, whether or not they changed. */
export async function POST(req: AuthenticatedMedusaRequest, res: MedusaResponse) {
  res.json(await syncListings(req.scope, { force: true }))
}
