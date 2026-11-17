/**
 * Plugin options, as written under `plugins[].options` in medusa-config.
 * Everything a store must decide is here; nothing is read from the
 * environment, so the host application chooses its own variable names.
 */
export interface MercadoLivreOptions {
  /** App ID and secret key of the application at developers.mercadolivre.com.br. */
  clientId?: string
  clientSecret?: string
  /**
   * The redirect URI registered in the application, which must be this
   * backend's `/mercadolivre/oauth/callback` over https.
   */
  redirectUri?: string
  /** Site the seller account belongs to. Default MLB (Brazil). */
  site?: string
  /** Secret the stored tokens are encrypted with and the OAuth state is signed with. */
  encryptionKey?: string
  /** Where the browser lands after connecting. Default `/app/mercadolivre`. */
  adminReturnUrl?: string
  /**
   * true = "publish" only asks Mercado Livre to validate the listing and
   * nothing goes live. Use it until the listings are right.
   */
  dryRun?: boolean
  /** Sales channel imported orders are created in. Created by name when no id is given. */
  salesChannelId?: string
  salesChannelName?: string
  /** Region of imported orders. Default: the first region with the site's currency. */
  regionId?: string
  /** Percentage added to the store price on every listing (commission), unless the listing sets its own. */
  priceAdjustmentPercent?: number
  /** Units kept back from Mercado Livre on every variant. */
  stockBuffer?: number
  /** Quantity advertised for variants whose inventory Medusa does not manage (made to order). */
  unmanagedStock?: number
  /** Item attributes sent on every listing, e.g. `[{ id: 'BRAND', value_name: 'Acme' }]`. */
  defaultAttributes?: { id: string; value_name?: string; value_id?: string }[]
  /** Import paid orders as Medusa orders. Default true. */
  importOrders?: boolean
  /** Emit `order.placed` for an imported order, so the store's own automations run. Default true. */
  emitOrderPlaced?: boolean
  /**
   * Shipping address metadata key that receives the buyer's document (CPF/CNPJ)
   * digits. Default `document`.
   */
  documentMetadataKey?: string
  /**
   * true = `address_1` is the street alone and the number goes to
   * `metadata.number`; false (default) = `address_1` is "street, number".
   */
  splitStreetNumber?: boolean
  /** Base URL of the API, for tests. */
  apiBaseUrl?: string
}

export interface ResolvedOptions extends MercadoLivreOptions {
  site: string
  adminReturnUrl: string
  salesChannelName: string
  dryRun: boolean
  priceAdjustmentPercent: number
  stockBuffer: number
  unmanagedStock: number
  importOrders: boolean
  emitOrderPlaced: boolean
  documentMetadataKey: string
  splitStreetNumber: boolean
  apiBaseUrl: string
}

const bool = (value: unknown, fallback: boolean) =>
  value === undefined || value === null || value === ''
    ? fallback
    : value === true || value === 'true'

const num = (value: unknown, fallback: number) => {
  const n = typeof value === 'string' && value.trim() ? Number(value) : value
  return typeof n === 'number' && Number.isFinite(n) ? n : fallback
}

const clean = (value: unknown) =>
  typeof value === 'string' && value.trim() ? value.trim() : undefined

/** Options with their defaults; env strings ("true", "12") are accepted where a store passes them through. */
export function resolveOptions(options: MercadoLivreOptions | undefined): ResolvedOptions {
  const o = options ?? {}
  return {
    clientId: clean(o.clientId),
    clientSecret: clean(o.clientSecret),
    redirectUri: clean(o.redirectUri),
    encryptionKey: clean(o.encryptionKey),
    salesChannelId: clean(o.salesChannelId),
    regionId: clean(o.regionId),
    defaultAttributes: Array.isArray(o.defaultAttributes) ? o.defaultAttributes : [],
    site: (clean(o.site) ?? 'MLB').toUpperCase(),
    adminReturnUrl: clean(o.adminReturnUrl) ?? '/app/mercadolivre',
    salesChannelName: clean(o.salesChannelName) ?? 'Mercado Livre',
    dryRun: bool(o.dryRun, false),
    priceAdjustmentPercent: num(o.priceAdjustmentPercent, 0),
    stockBuffer: Math.max(0, Math.floor(num(o.stockBuffer, 0))),
    unmanagedStock: Math.max(0, Math.floor(num(o.unmanagedStock, 20))),
    importOrders: bool(o.importOrders, true),
    emitOrderPlaced: bool(o.emitOrderPlaced, true),
    documentMetadataKey: clean(o.documentMetadataKey) ?? 'document',
    splitStreetNumber: bool(o.splitStreetNumber, false),
    apiBaseUrl: (clean(o.apiBaseUrl) ?? 'https://api.mercadolibre.com').replace(/\/+$/, ''),
  }
}

/** What is missing before an account can be connected; empty = ready. */
export function missingCredentials(options: ResolvedOptions): string[] {
  const missing: string[] = []
  if (!options.clientId) missing.push('clientId')
  if (!options.clientSecret) missing.push('clientSecret')
  if (!options.redirectUri) missing.push('redirectUri')
  if (!options.encryptionKey) missing.push('encryptionKey')
  return missing
}
