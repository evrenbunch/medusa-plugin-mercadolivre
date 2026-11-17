import type { AuthenticatedMedusaRequest, MedusaResponse } from '@medusajs/framework/http'

import { sessionOf } from '../../../../lib/session'

interface Prediction {
  domain_id?: string
  domain_name?: string
  category_id: string
  category_name: string
}

/** Categories Mercado Livre suggests for a title (`q`), and the listing types the seller may use. */
export async function GET(req: AuthenticatedMedusaRequest, res: MedusaResponse) {
  const session = await sessionOf(req.scope)
  const q = String(req.query.q ?? '').trim()
  const site = session.account.site_id
  const [categories, types] = await Promise.all([
    q
      ? session.client.get<Prediction[]>(`/sites/${site}/domain_discovery/search`, {
          query: { q, limit: 6 },
        })
      : Promise.resolve([]),
    session.client.get<{ id: string; name: string }[]>(`/sites/${site}/listing_types`),
  ])
  res.json({
    categories: categories.map((category) => ({
      id: category.category_id,
      name: category.category_name,
      domain_id: category.domain_id ?? null,
      domain_name: category.domain_name ?? null,
    })),
    listing_types: types,
  })
}
