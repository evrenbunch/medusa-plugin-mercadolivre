import { model } from '@medusajs/framework/utils'

export const LISTING_STATUSES = [
  'draft',
  'active',
  'paused',
  'closed',
  'under_review',
  'inactive',
  'error',
] as const
export type ListingStatus = (typeof LISTING_STATUSES)[number]

/**
 * One Mercado Livre item and the Medusa variants it sells. A classic item
 * holds every variant of the product as a variation; on the user-products
 * model each variant is its own item, so a product has several rows.
 */
export const MlListing = model
  .define('ml_listing', {
    id: model.id({ prefix: 'mllist' }).primaryKey(),
    product_id: model.text(),
    /** `{ variant_id, variation_id, sku }[]`; variation_id is null for an item without variations. */
    variants: model.json(),
    /** MLB123…; null until published. */
    item_id: model.text().nullable(),
    permalink: model.text().nullable(),
    status: model.enum([...LISTING_STATUSES]).default('draft'),
    /** Mercado Livre's own status and sub-status words, for the admin. */
    external_status: model.text().nullable(),
    category_id: model.text(),
    category_name: model.text().nullable(),
    /** gold_special (Clássico), gold_pro (Premium), free… */
    listing_type_id: model.text().default('gold_special'),
    /** Percentage over the store price; null = the plugin's default. */
    price_adjustment_percent: model.float().nullable(),
    /** ListingSettings (lib/listing.ts): attributes, option mapping, size chart, shipping. */
    settings: model.json().nullable(),
    sync_stock: model.boolean().default(true),
    sync_price: model.boolean().default(true),
    /** `{ [variant_id]: { price, quantity } }` as last sent, so a sync only sends changes. */
    pushed: model.json().nullable(),
    /** Why the last publish or sync failed, as Mercado Livre said it. */
    problem: model.text().nullable(),
    synced_at: model.dateTime().nullable(),
  })
  .indexes([
    { on: ['product_id'] },
    { on: ['item_id'], unique: true, where: 'item_id IS NOT NULL' },
    { on: ['status'] },
  ])
