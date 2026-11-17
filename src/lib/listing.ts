/*
 * From a Medusa product to the body Mercado Livre's items API takes, and
 * from a pair (wanted, last sent) to the smallest stock/price update. Pure
 * functions: what is read from Medusa and sent over HTTP lives in
 * lib/listings.ts.
 */

export interface MlAttribute {
  id?: string
  name?: string
  value_id?: string
  value_name?: string
}

export interface ListingSettings {
  /** Item attributes the category asks for (BRAND, MODEL, GENDER…). */
  attributes?: MlAttribute[]
  /** Product option title → Mercado Livre attribute id, when the names differ from the usual ones. */
  option_map?: Record<string, string>
  /** Size chart (fashion categories require one). */
  size_grid_id?: string
  /** Size value ("M") → SIZE_GRID_ROW_ID, read from the chart when publishing. */
  size_rows?: Record<string, string>
  /** Days to make the piece before posting (made to order). */
  manufacturing_days?: number
  warranty?: { type?: string; time?: string }
  shipping?: { mode?: string; free_shipping?: boolean; local_pick_up?: boolean }
  condition?: 'new' | 'used'
  /** Overrides of the product's own title and description. */
  title?: string
  description?: string
}

export interface SourceVariant {
  id: string
  title: string
  sku: string | null
  barcode: string | null
  /** Option title → value, e.g. `{ Cor: 'Preto', Tamanho: 'M' }`. */
  options: Record<string, string>
  /** Store price in the site's currency; null = the variant has none. */
  price: number | null
  /** Units Medusa can sell; null = inventory is not managed. */
  available: number | null
}

export interface SourceProduct {
  id: string
  title: string
  description: string | null
  images: string[]
  variants: SourceVariant[]
}

export interface ListingContext {
  category_id: string
  listing_type_id: string
  currency: string
  settings: ListingSettings
  priceAdjustmentPercent: number
  stockBuffer: number
  unmanagedStock: number
  /** One item per variant, named by `family_name`. */
  userProducts: boolean
  defaultAttributes: MlAttribute[]
}

export interface VariantLink {
  variant_id: string
  variation_id: string | null
  sku: string | null
}

export const TITLE_MAX = 60
const PICTURES_MAX = 10
const QUANTITY_MAX = 99999

const plain = (value: string) => value.normalize('NFD').replace(/[̀-ͯ]/g, '').trim().toLowerCase()

/** Option names stores use, in Portuguese, Spanish and English, for the attributes Mercado Livre varies items by. */
const OPTION_ATTRIBUTES: Record<string, string> = {
  cor: 'COLOR',
  color: 'COLOR',
  colour: 'COLOR',
  tamanho: 'SIZE',
  size: 'SIZE',
  talla: 'SIZE',
  talle: 'SIZE',
  voltagem: 'VOLTAGE',
  voltage: 'VOLTAGE',
  voltaje: 'VOLTAGE',
  sabor: 'FLAVOR',
  flavor: 'FLAVOR',
}

export function attributeIdOf(optionTitle: string, settings: ListingSettings): string | null {
  const mapped = Object.entries(settings.option_map ?? {}).find(
    ([title]) => plain(title) === plain(optionTitle)
  )
  return mapped?.[1] ?? OPTION_ATTRIBUTES[plain(optionTitle)] ?? null
}

export function listingPrice(base: number, percent: number): number {
  return Math.round(base * (1 + percent / 100) * 100) / 100
}

export function listingQuantity(
  available: number | null,
  context: Pick<ListingContext, 'stockBuffer' | 'unmanagedStock'>
): number {
  const quantity =
    available === null ? context.unmanagedStock : Math.floor(available) - context.stockBuffer
  return Math.min(QUANTITY_MAX, Math.max(0, quantity))
}

/** Mercado Livre cuts nothing itself: a longer title is refused. Cut at a word. */
export function fitTitle(title: string, max = TITLE_MAX): string {
  const clean = title.replace(/\s+/g, ' ').trim()
  if (clean.length <= max) return clean
  const cut = clean.slice(0, max + 1)
  const space = cut.lastIndexOf(' ')
  return (space > max * 0.6 ? cut.slice(0, space) : clean.slice(0, max)).trim()
}

/** Mercado Livre descriptions are plain text. */
export function plainDescription(html: string | null | undefined): string {
  if (!html) return ''
  return html
    .replace(/<\s*br\s*\/?>/gi, '\n')
    .replace(/<\/\s*(p|div|li|h[1-6])\s*>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

function saleTerms(settings: ListingSettings): MlAttribute[] {
  const terms: MlAttribute[] = []
  if (settings.warranty?.type)
    terms.push({ id: 'WARRANTY_TYPE', value_name: settings.warranty.type })
  if (settings.warranty?.time)
    terms.push({ id: 'WARRANTY_TIME', value_name: settings.warranty.time })
  if (settings.manufacturing_days && settings.manufacturing_days > 0) {
    terms.push({ id: 'MANUFACTURING_TIME', value_name: `${settings.manufacturing_days} dias` })
  }
  return terms
}

/** What identifies one variant inside an item: its SKU, barcode and size-chart row. */
function variantAttributes(variant: SourceVariant, settings: ListingSettings): MlAttribute[] {
  const attributes: MlAttribute[] = []
  if (variant.sku) attributes.push({ id: 'SELLER_SKU', value_name: variant.sku })
  if (variant.barcode) attributes.push({ id: 'GTIN', value_name: variant.barcode })
  const size = Object.entries(variant.options).find(
    ([title]) => attributeIdOf(title, settings) === 'SIZE'
  )?.[1]
  const row = size ? settings.size_rows?.[size] : undefined
  if (row) attributes.push({ id: 'SIZE_GRID_ROW_ID', value_name: row })
  return attributes
}

function combinations(variant: SourceVariant, settings: ListingSettings): MlAttribute[] {
  return Object.entries(variant.options).map(([title, value]) => {
    const id = attributeIdOf(title, settings)
    return id ? { id, value_name: value } : { name: title, value_name: value }
  })
}

function mergeAttributes(...lists: MlAttribute[][]): MlAttribute[] {
  const byKey = new Map<string, MlAttribute>()
  for (const attribute of lists.flat()) {
    const key = attribute.id ?? attribute.name
    if (key && (attribute.value_name || attribute.value_id)) byKey.set(key, attribute)
  }
  return [...byKey.values()]
}

export interface BuiltItem {
  /** The Medusa variants this item sells, in the order of `body.variations` when it has them. */
  variant_ids: string[]
  body: Record<string, unknown>
}

function priceOf(variant: SourceVariant, context: ListingContext): number {
  if (variant.price === null) {
    throw new Error(`Variant "${variant.title}" has no price in ${context.currency}`)
  }
  return listingPrice(variant.price, context.priceAdjustmentPercent)
}

/**
 * The item bodies for a product: one with every variant as a variation, or,
 * on the user-products model, one per variant. Throws when a variant cannot
 * be sold (no price, no pictures).
 */
export function buildItems(product: SourceProduct, context: ListingContext): BuiltItem[] {
  const { settings } = context
  if (!product.variants.length) throw new Error('The product has no variants')
  const pictures = product.images.slice(0, PICTURES_MAX)
  if (!pictures.length) throw new Error('The product has no images')
  const title = fitTitle(settings.title ?? product.title)
  const base: Record<string, unknown> = {
    category_id: context.category_id,
    currency_id: context.currency,
    buying_mode: 'buy_it_now',
    condition: settings.condition ?? 'new',
    listing_type_id: context.listing_type_id,
    pictures: pictures.map((source) => ({ source })),
    shipping: {
      mode: settings.shipping?.mode ?? 'me2',
      local_pick_up: settings.shipping?.local_pick_up ?? false,
      free_shipping: settings.shipping?.free_shipping ?? false,
    },
  }
  const terms = saleTerms(settings)
  if (terms.length) base.sale_terms = terms
  const itemAttributes = mergeAttributes(
    context.defaultAttributes,
    settings.attributes ?? [],
    settings.size_grid_id ? [{ id: 'SIZE_GRID_ID', value_name: settings.size_grid_id }] : []
  )
  /** A variant sold as an item of its own carries its option values as item attributes. */
  const single = (variant: SourceVariant): Record<string, unknown> => ({
    ...base,
    price: priceOf(variant, context),
    available_quantity: listingQuantity(variant.available, context),
    attributes: mergeAttributes(
      itemAttributes,
      combinations(variant, settings).filter((attribute) => attribute.id),
      variantAttributes(variant, settings)
    ),
  })

  if (context.userProducts) {
    return product.variants.map((variant) => ({
      variant_ids: [variant.id],
      body: { ...single(variant), family_name: title },
    }))
  }
  if (product.variants.length === 1 && !Object.keys(product.variants[0]!.options).length) {
    const variant = product.variants[0]!
    return [{ variant_ids: [variant.id], body: { ...single(variant), title } }]
  }
  // A classic item has one price: Mercado Livre refuses variations priced apart.
  const price = Math.max(...product.variants.map((variant) => priceOf(variant, context)))
  return [
    {
      variant_ids: product.variants.map((variant) => variant.id),
      body: {
        ...base,
        title,
        price,
        available_quantity: product.variants.reduce(
          (sum, variant) => sum + listingQuantity(variant.available, context),
          0
        ),
        attributes: itemAttributes,
        variations: product.variants.map((variant) => ({
          price,
          available_quantity: listingQuantity(variant.available, context),
          attribute_combinations: combinations(variant, settings),
          attributes: variantAttributes(variant, settings),
          picture_ids: pictures,
        })),
      },
    },
  ]
}

interface ReturnedVariation {
  id: number | string
  attribute_combinations?: MlAttribute[]
}

const combinationKey = (attributes: MlAttribute[] | undefined) =>
  (attributes ?? [])
    .map(
      (attribute) =>
        `${attribute.id ?? plain(attribute.name ?? '')}=${plain(attribute.value_name ?? '')}`
    )
    .sort()
    .join('|')

/**
 * Which variation Mercado Livre created for each variant. Matched by the
 * attribute combination, since the answer's order is not promised; position
 * is the fallback.
 */
export function linkVariations(
  built: BuiltItem,
  variants: SourceVariant[],
  returned: ReturnedVariation[] | undefined
): VariantLink[] {
  const sent =
    (built.body.variations as { attribute_combinations: MlAttribute[] }[] | undefined) ?? []
  return built.variant_ids.map((variantId, index) => {
    const variant = variants.find((candidate) => candidate.id === variantId)
    const key = combinationKey(sent[index]?.attribute_combinations)
    const match =
      returned?.find((variation) => combinationKey(variation.attribute_combinations) === key) ??
      returned?.[index]
    return {
      variant_id: variantId,
      variation_id: sent.length && match ? String(match.id) : null,
      sku: variant?.sku ?? null,
    }
  })
}

export type Pushed = Record<string, { price: number; quantity: number }>

/**
 * The PUT /items body that brings stock and price up to date, or null when
 * nothing changed. An item with variations always lists all of them:
 * Mercado Livre deletes the variations a body leaves out.
 */
export function stockPriceUpdate(input: {
  links: VariantLink[]
  wanted: Pushed
  pushed: Pushed | null
  syncStock: boolean
  syncPrice: boolean
}): { body: Record<string, unknown>; pushed: Pushed } | null {
  const { links, wanted, syncStock, syncPrice } = input
  const pushed = input.pushed ?? {}
  if (!syncStock && !syncPrice) return null
  const next: Pushed = {}
  let changed = false
  for (const link of links) {
    const want = wanted[link.variant_id]
    const last = pushed[link.variant_id]
    if (!want) {
      if (last) next[link.variant_id] = last
      continue
    }
    const value = {
      price: syncPrice ? want.price : (last?.price ?? want.price),
      quantity: syncStock ? want.quantity : (last?.quantity ?? want.quantity),
    }
    next[link.variant_id] = value
    if (!last || last.price !== value.price || last.quantity !== value.quantity) changed = true
  }
  if (!changed) return null
  const fields = (variantId: string) => {
    const value = next[variantId]
    if (!value) return {}
    return {
      ...(syncPrice ? { price: value.price } : {}),
      ...(syncStock ? { available_quantity: value.quantity } : {}),
    }
  }
  const withVariations = links.filter((link) => link.variation_id)
  if (!withVariations.length) {
    const only = links[0]
    return only ? { body: fields(only.variant_id), pushed: next } : null
  }
  // One price per classic item (see buildItems).
  const price = Math.max(...withVariations.map((link) => next[link.variant_id]?.price ?? 0))
  return {
    body: {
      variations: withVariations.map((link) => ({
        id: Number(link.variation_id),
        ...fields(link.variant_id),
        ...(syncPrice ? { price } : {}),
      })),
    },
    pushed: next,
  }
}

/** Mercado Livre's item status in the words the listing row uses. */
export function listingStatusOf(status: string | undefined) {
  switch (status) {
    case 'active':
    case 'paused':
    case 'closed':
    case 'under_review':
    case 'inactive':
      return status
    case 'payment_required':
    case 'not_yet_active':
      return 'inactive' as const
    default:
      return 'error' as const
  }
}

/** Size value → row id of a size chart (GET /catalog/charts/:id). */
export function sizeRowsOf(chart: {
  rows?: { id: string; attributes?: { id: string; values?: { name?: string }[] }[] }[]
}): Record<string, string> {
  const rows: Record<string, string> = {}
  for (const row of chart.rows ?? []) {
    const size = row.attributes?.find((attribute) => attribute.id === 'SIZE')?.values?.[0]?.name
    if (size) rows[size] = row.id
  }
  return rows
}
