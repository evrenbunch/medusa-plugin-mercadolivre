import type { AuthenticatedMedusaRequest, MedusaResponse } from '@medusajs/framework/http'
import { ContainerRegistrationKeys } from '@medusajs/framework/utils'

import { createDrafts } from '../../../../lib/listings'
import { moduleOf } from '../../../../lib/session'
import type { CreateListing } from '../validators'

/** Listings, newest first; `product_id` narrows to one product. Each carries its product's title. */
export async function GET(req: AuthenticatedMedusaRequest, res: MedusaResponse) {
  const service = moduleOf(req.scope)
  const productId = typeof req.query.product_id === 'string' ? req.query.product_id : undefined
  const limit = Math.min(Number(req.query.limit) || 50, 200)
  const offset = Number(req.query.offset) || 0
  const [listings, count] = await service.listAndCountMlListings(
    productId ? { product_id: productId } : {},
    {
      take: limit,
      skip: offset,
      order: { created_at: 'DESC' },
    }
  )
  const query = req.scope.resolve(ContainerRegistrationKeys.QUERY)
  const ids = [...new Set(listings.map((listing) => listing.product_id))]
  const { data: products } = ids.length
    ? await query.graph({
        entity: 'product',
        fields: ['id', 'title', 'thumbnail', 'variants.id', 'variants.title'],
        filters: { id: ids },
      })
    : { data: [] }
  const byId = new Map(products.map((product) => [product.id, product]))
  res.json({
    listings: listings.map((listing) => {
      const product = byId.get(listing.product_id) as
        | { title?: string; thumbnail?: string | null; variants?: { id: string; title: string }[] }
        | undefined
      return {
        ...listing,
        product_title: product?.title ?? null,
        product_thumbnail: product?.thumbnail ?? null,
        variant_titles: ((listing.variants ?? []) as unknown as { variant_id: string }[]).map(
          (link) =>
            product?.variants?.find((variant) => variant.id === link.variant_id)?.title ?? null
        ),
      }
    }),
    count,
    limit,
    offset,
  })
}

/** Prepares drafts for a product. Nothing is sent to Mercado Livre yet. */
export async function POST(req: AuthenticatedMedusaRequest<CreateListing>, res: MedusaResponse) {
  const listings = await createDrafts(req.scope, req.validatedBody)
  res.status(201).json({ listings })
}
