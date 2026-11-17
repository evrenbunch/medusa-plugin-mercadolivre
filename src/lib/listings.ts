import type { MedusaContainer } from '@medusajs/framework/types'
import {
  ContainerRegistrationKeys,
  getVariantAvailability,
  MedusaError,
} from '@medusajs/framework/utils'

import { ensureSalesChannel } from './channel'
import { MercadoLivreError } from './client'
import {
  buildItems,
  linkVariations,
  type ListingContext,
  listingPrice,
  listingQuantity,
  type ListingSettings,
  listingStatusOf,
  plainDescription,
  type Pushed,
  sizeRowsOf,
  type SourceProduct,
  stockPriceUpdate,
  type VariantLink,
} from './listing'
import { problemOf, type Session, sessionOf, sessionOrNull } from './session'
import { siteOf } from './sites'

export interface ListingRow {
  id: string
  product_id: string
  variants: VariantLink[]
  item_id: string | null
  permalink: string | null
  status: string
  external_status: string | null
  category_id: string
  category_name: string | null
  listing_type_id: string
  price_adjustment_percent: number | null
  settings: ListingSettings | null
  sync_stock: boolean
  sync_price: boolean
  pushed: Pushed | null
  problem: string | null
  synced_at: Date | null
}

interface MlItem {
  id: string
  permalink?: string
  status?: string
  sub_status?: string[]
  variations?: {
    id: number
    attribute_combinations?: { id?: string; name?: string; value_name?: string }[]
  }[]
}

type ProductGraph = {
  id: string
  title: string
  description: string | null
  thumbnail: string | null
  images?: { url: string }[]
  variants?: {
    id: string
    title: string
    sku: string | null
    barcode: string | null
    ean: string | null
    manage_inventory: boolean
    options?: { value: string; option?: { title: string } }[]
    prices?: {
      amount: number
      currency_code: string
      min_quantity: number | null
      price_list_id?: string | null
      price_rules?: unknown[]
    }[]
  }[]
}

/** The store's own price in a currency: no price list, no rule, no quantity tier. */
function basePrice(
  prices: NonNullable<ProductGraph['variants']>[number]['prices'],
  currency: string
) {
  const plain = (prices ?? []).filter(
    (price) =>
      price.currency_code?.toLowerCase() === currency.toLowerCase() &&
      !price.price_list_id &&
      !(price.price_rules ?? []).length &&
      (price.min_quantity ?? 0) <= 1
  )
  return plain.length ? Number(plain[0]!.amount) : null
}

/** A product as the listing builder wants it, restricted to some variants when asked. */
export async function loadProduct(
  container: MedusaContainer,
  session: Session,
  productId: string,
  variantIds?: string[]
): Promise<SourceProduct> {
  const query = container.resolve(ContainerRegistrationKeys.QUERY)
  const { data } = await query.graph({
    entity: 'product',
    fields: [
      'id',
      'title',
      'description',
      'thumbnail',
      'images.url',
      'variants.id',
      'variants.title',
      'variants.sku',
      'variants.barcode',
      'variants.ean',
      'variants.manage_inventory',
      'variants.variant_rank',
      'variants.options.value',
      'variants.options.option.title',
      'variants.prices.amount',
      'variants.prices.currency_code',
      'variants.prices.min_quantity',
      'variants.prices.price_list_id',
      'variants.prices.price_rules.id',
    ],
    filters: { id: productId },
  })
  const product = data[0] as unknown as ProductGraph | undefined
  if (!product) throw new MedusaError(MedusaError.Types.NOT_FOUND, `Product ${productId} not found`)
  const variants = (product.variants ?? []).filter(
    (variant) => !variantIds || variantIds.includes(variant.id)
  )
  const managed = variants
    .filter((variant) => variant.manage_inventory)
    .map((variant) => variant.id)
  const availability = managed.length
    ? await getVariantAvailability(query, {
        variant_ids: managed,
        sales_channel_id: await ensureSalesChannel(container, session.options),
      })
    : {}
  const currency = siteOf(session.account.site_id).currency
  const images = [product.thumbnail, ...(product.images ?? []).map((image) => image.url)].filter(
    (url, index, all): url is string => !!url && all.indexOf(url) === index
  )
  return {
    id: product.id,
    title: product.title,
    description: product.description,
    images,
    variants: variants.map((variant) => ({
      id: variant.id,
      title: variant.title,
      sku: variant.sku,
      barcode: variant.barcode ?? variant.ean,
      options: Object.fromEntries(
        (variant.options ?? [])
          .filter((option) => option.option?.title)
          .map((option) => [option.option!.title, option.value])
      ),
      price: basePrice(variant.prices, currency),
      available: variant.manage_inventory ? (availability[variant.id]?.availability ?? 0) : null,
    })),
  }
}

export function contextOf(listing: ListingRow, session: Session): ListingContext {
  const { options, account } = session
  return {
    category_id: listing.category_id,
    listing_type_id: listing.listing_type_id,
    currency: siteOf(account.site_id).currency,
    settings: listing.settings ?? {},
    priceAdjustmentPercent: listing.price_adjustment_percent ?? options.priceAdjustmentPercent,
    stockBuffer: options.stockBuffer,
    unmanagedStock: options.unmanagedStock,
    userProducts: account.user_products,
    defaultAttributes: options.defaultAttributes ?? [],
  }
}

async function listingOf(session: Session, id: string): Promise<ListingRow> {
  return (await session.service.retrieveMlListing(id)) as unknown as ListingRow
}

export interface DraftInput {
  product_id: string
  category_id: string
  category_name?: string | null
  listing_type_id?: string
  price_adjustment_percent?: number | null
  settings?: ListingSettings
}

/**
 * Prepares a product for Mercado Livre without publishing anything: one
 * draft with every variant, or one per variant on the user-products model.
 * Variants already in a listing are left where they are.
 */
export async function createDrafts(container: MedusaContainer, input: DraftInput) {
  const session = await sessionOf(container)
  const product = await loadProduct(container, session, input.product_id)
  const existing = (await session.service.listMlListings({
    product_id: input.product_id,
  })) as unknown as ListingRow[]
  const taken = new Set(
    existing
      .filter((listing) => listing.status !== 'closed')
      .flatMap((listing) => listing.variants.map((variant) => variant.variant_id))
  )
  const free = product.variants.filter((variant) => !taken.has(variant.id))
  if (!free.length) {
    throw new MedusaError(
      MedusaError.Types.INVALID_DATA,
      'Every variant of this product already has a listing'
    )
  }
  const link = (variant: (typeof free)[number]): VariantLink => ({
    variant_id: variant.id,
    variation_id: null,
    sku: variant.sku,
  })
  const groups = session.account.user_products ? free.map((variant) => [variant]) : [free]
  return session.service.createMlListings(
    groups.map((group) => ({
      product_id: input.product_id,
      variants: group.map(link) as unknown as Record<string, unknown>,
      category_id: input.category_id,
      category_name: input.category_name ?? null,
      listing_type_id: input.listing_type_id ?? 'gold_special',
      price_adjustment_percent: input.price_adjustment_percent ?? null,
      settings: (input.settings ?? {}) as Record<string, unknown>,
    }))
  )
}

/** The body the listing would be published with, reading the size chart's rows when one is set. */
async function bodyOf(container: MedusaContainer, session: Session, listing: ListingRow) {
  const settings = { ...(listing.settings ?? {}) }
  if (settings.size_grid_id && !Object.keys(settings.size_rows ?? {}).length) {
    const chart = await session.client.get<Parameters<typeof sizeRowsOf>[0]>(
      `/catalog/charts/${settings.size_grid_id}`
    )
    settings.size_rows = sizeRowsOf(chart)
    await session.service.updateMlListings({
      id: listing.id,
      settings: settings as Record<string, unknown>,
    })
  }
  const product = await loadProduct(
    container,
    session,
    listing.product_id,
    listing.variants.map((variant) => variant.variant_id)
  )
  const [built] = buildItems(product, {
    ...contextOf({ ...listing, settings }, session),
    // The row already holds the right variants for either model.
    userProducts: session.account.user_products && listing.variants.length === 1,
  })
  if (!built) throw new Error('Nothing to publish')
  return { built, product, settings }
}

function pushedOf(product: SourceProduct, context: ListingContext): Pushed {
  const pushed: Pushed = {}
  for (const variant of product.variants) {
    if (variant.price === null) continue
    pushed[variant.id] = {
      price: listingPrice(variant.price, context.priceAdjustmentPercent),
      quantity: listingQuantity(variant.available, context),
    }
  }
  return pushed
}

export interface PublishResult {
  listing_id: string
  ok: boolean
  /** true = Mercado Livre only validated the listing (dry run); nothing is live. */
  dry_run: boolean
  problem: string | null
}

/**
 * Asks Mercado Livre whether it would accept the listing (POST /items/validate).
 * Nothing is created.
 */
export async function validateListing(
  container: MedusaContainer,
  id: string
): Promise<PublishResult> {
  const session = await sessionOf(container)
  const listing = await listingOf(session, id)
  try {
    const { built } = await bodyOf(container, session, listing)
    await session.client.post('/items/validate', built.body)
    await session.service.updateMlListings({ id, problem: null })
    return { listing_id: id, ok: true, dry_run: true, problem: null }
  } catch (error) {
    const problem = problemOf(error)
    await session.service.updateMlListings({ id, problem })
    return { listing_id: id, ok: false, dry_run: true, problem }
  }
}

/** Publishes a draft. With the `dryRun` option it stops at validation. */
export async function publishListing(
  container: MedusaContainer,
  id: string
): Promise<PublishResult> {
  const session = await sessionOf(container)
  if (session.options.dryRun) return validateListing(container, id)
  const listing = await listingOf(session, id)
  if (listing.item_id) {
    throw new MedusaError(MedusaError.Types.NOT_ALLOWED, 'This listing is already published')
  }
  try {
    const { built, product, settings } = await bodyOf(container, session, listing)
    const item = await session.client.post<MlItem>('/items', built.body)
    const context = contextOf({ ...listing, settings }, session)
    await session.service.updateMlListings({
      id,
      item_id: item.id,
      permalink: item.permalink ?? null,
      status: listingStatusOf(item.status),
      external_status:
        [item.status, ...(item.sub_status ?? [])].filter(Boolean).join(' · ') || null,
      variants: linkVariations(built, product.variants, item.variations) as unknown as Record<
        string,
        unknown
      >,
      pushed: pushedOf(product, context) as unknown as Record<string, unknown>,
      problem: null,
      synced_at: new Date(),
    })
    const description = plainDescription(settings.description ?? product.description)
    if (description) {
      // The item is live either way; a refused description is reported, not fatal.
      await session.client
        .post(`/items/${item.id}/description`, { plain_text: description })
        .catch(async (error) => {
          await session.service.updateMlListings({
            id,
            problem: `Description: ${problemOf(error)}`,
          })
        })
    }
    return { listing_id: id, ok: true, dry_run: false, problem: null }
  } catch (error) {
    const problem = problemOf(error)
    await session.service.updateMlListings({ id, problem, status: 'error' })
    return { listing_id: id, ok: false, dry_run: false, problem }
  }
}

/** Reads the item's status from Mercado Livre (it pauses, reviews and closes items on its own). */
export async function refreshListing(container: MedusaContainer, id: string) {
  const session = await sessionOf(container)
  const listing = await listingOf(session, id)
  if (!listing.item_id) return listing
  const item = await session.client.get<MlItem>(`/items/${listing.item_id}`)
  await session.service.updateMlListings({
    id,
    status: listingStatusOf(item.status),
    external_status: [item.status, ...(item.sub_status ?? [])].filter(Boolean).join(' · ') || null,
    permalink: item.permalink ?? listing.permalink,
  })
  return listingOf(session, id)
}

/** Pauses, reactivates or closes the item. Closing cannot be undone at Mercado Livre. */
export async function setListingStatus(
  container: MedusaContainer,
  id: string,
  status: 'active' | 'paused' | 'closed'
) {
  const session = await sessionOf(container)
  const listing = await listingOf(session, id)
  if (!listing.item_id) {
    throw new MedusaError(MedusaError.Types.NOT_ALLOWED, 'This listing is not published')
  }
  const item = await session.client.put<MlItem>(`/items/${listing.item_id}`, { status })
  await session.service.updateMlListings({
    id,
    status: listingStatusOf(item.status ?? status),
    external_status: [item.status, ...(item.sub_status ?? [])].filter(Boolean).join(' · ') || null,
    problem: null,
  })
}

/** Sends pictures, attributes and description again (the title too while the item has no sales). */
export async function updateListingContent(container: MedusaContainer, id: string) {
  const session = await sessionOf(container)
  const listing = await listingOf(session, id)
  if (!listing.item_id) {
    throw new MedusaError(MedusaError.Types.NOT_ALLOWED, 'This listing is not published')
  }
  const { built, product, settings } = await bodyOf(container, session, listing)
  const current = await session.client.get<{ sold_quantity?: number }>(`/items/${listing.item_id}`)
  const body: Record<string, unknown> = {
    pictures: built.body.pictures,
    attributes: built.body.attributes,
  }
  if (!current.sold_quantity && built.body.title) body.title = built.body.title
  try {
    await session.client.put(`/items/${listing.item_id}`, body)
    const description = plainDescription(settings.description ?? product.description)
    if (description) {
      await session.client.put(
        `/items/${listing.item_id}/description`,
        { plain_text: description },
        { query: { api_version: 2 } }
      )
    }
    await session.service.updateMlListings({ id, problem: null, synced_at: new Date() })
  } catch (error) {
    await session.service.updateMlListings({ id, problem: problemOf(error) })
    throw error
  }
}

/** Brings one published listing's stock and price up to date. Returns whether anything was sent. */
export async function syncListing(
  container: MedusaContainer,
  session: Session,
  listing: ListingRow,
  force = false
): Promise<boolean> {
  if (!listing.item_id || !['active', 'paused'].includes(listing.status)) return false
  try {
    const product = await loadProduct(
      container,
      session,
      listing.product_id,
      listing.variants.map((variant) => variant.variant_id)
    )
    const update = stockPriceUpdate({
      links: listing.variants,
      wanted: pushedOf(product, contextOf(listing, session)),
      pushed: force ? null : listing.pushed,
      syncStock: listing.sync_stock,
      syncPrice: listing.sync_price,
    })
    if (!update) return false
    const item = await session.client.put<MlItem>(`/items/${listing.item_id}`, update.body)
    await session.service.updateMlListings({
      id: listing.id,
      pushed: update.pushed as unknown as Record<string, unknown>,
      status: listingStatusOf(item.status ?? listing.status),
      external_status:
        [item.status, ...(item.sub_status ?? [])].filter(Boolean).join(' · ') || null,
      problem: null,
      synced_at: new Date(),
    })
    return true
  } catch (error) {
    // A closed or deleted item answers 4xx forever: say so once and stop retrying it.
    const gone = error instanceof MercadoLivreError && [403, 404].includes(error.status)
    await session.service.updateMlListings({
      id: listing.id,
      problem: problemOf(error),
      ...(gone ? { status: 'error' as const } : {}),
    })
    return false
  }
}

/** Syncs every published listing, or only those selling the given variants. */
export async function syncListings(
  container: MedusaContainer,
  filter: { variantIds?: string[]; productIds?: string[]; force?: boolean } = {}
): Promise<{ checked: number; updated: number }> {
  const session = await sessionOrNull(container)
  if (!session) return { checked: 0, updated: 0 }
  const listings = (await session.service.listMlListings(
    {
      status: ['active', 'paused'],
      ...(filter.productIds ? { product_id: filter.productIds } : {}),
    },
    { take: 2000 }
  )) as unknown as ListingRow[]
  const wanted = listings.filter(
    (listing) =>
      !filter.variantIds ||
      listing.variants.some((variant) => filter.variantIds!.includes(variant.variant_id))
  )
  let updated = 0
  for (const listing of wanted) {
    if (await syncListing(container, session, listing, filter.force)) updated++
  }
  return { checked: wanted.length, updated }
}
