/*
 * From a Mercado Livre sale (its orders, shipment and billing data) to the
 * input of Medusa's create-order workflow. Pure functions; lib/orders.ts
 * fetches and stores.
 */
import type { VariantLink } from './listing'

export interface MlOrderItem {
  item: {
    id: string
    title: string
    variation_id?: number | string | null
    seller_sku?: string | null
    seller_custom_field?: string | null
  }
  quantity: number
  unit_price: number
  sale_fee?: number | null
}

export interface MlOrderData {
  id: number | string
  status: string
  date_created?: string
  total_amount?: number
  paid_amount?: number
  currency_id?: string
  pack_id?: number | string | null
  order_items: MlOrderItem[]
  buyer?: { id?: number; nickname?: string; first_name?: string; last_name?: string }
  shipping?: { id?: number | string | null }
  tags?: string[]
}

interface MlAddress {
  address_line?: string | null
  street_name?: string | null
  street_number?: string | null
  comment?: string | null
  zip_code?: string | null
  city?: { name?: string | null } | null
  state?: { id?: string | null; name?: string | null } | null
  country?: { id?: string | null } | null
  neighborhood?: { name?: string | null } | null
  receiver_name?: string | null
  receiver_phone?: string | null
}

/** GET /shipments/:id, in either of the two shapes the API answers with. */
export interface MlShipmentData {
  id: number | string
  status?: string
  substatus?: string | null
  mode?: string
  logistic_type?: string
  tracking_number?: string | null
  tracking_method?: string | null
  receiver_address?: MlAddress
  shipping_option?: { cost?: number; name?: string }
  // x-format-new
  logistic?: { mode?: string; type?: string }
  destination?: { receiver_name?: string; receiver_phone?: string; shipping_address?: MlAddress }
  lead_time?: { cost?: number; shipping_method?: { name?: string } }
}

export interface Shipment {
  id: string
  status: string | null
  substatus: string | null
  mode: string | null
  logistic_type: string | null
  tracking_number: string | null
  carrier: string | null
  cost: number
  method: string | null
  address: (MlAddress & { receiver_name?: string | null; receiver_phone?: string | null }) | null
}

export function normalizeShipment(raw: MlShipmentData): Shipment {
  const address = raw.destination?.shipping_address ?? raw.receiver_address ?? null
  return {
    id: String(raw.id),
    status: raw.status ?? null,
    substatus: raw.substatus ?? null,
    mode: raw.logistic?.mode ?? raw.mode ?? null,
    logistic_type: raw.logistic?.type ?? raw.logistic_type ?? null,
    tracking_number: raw.tracking_number ?? null,
    carrier: raw.tracking_method ?? null,
    cost: raw.lead_time?.cost ?? raw.shipping_option?.cost ?? 0,
    method: raw.lead_time?.shipping_method?.name ?? raw.shipping_option?.name ?? null,
    address: address && {
      ...address,
      receiver_name: raw.destination?.receiver_name ?? address.receiver_name,
      receiver_phone: raw.destination?.receiver_phone ?? address.receiver_phone,
    },
  }
}

export interface BuyerDocument {
  type: string | null
  number: string | null
  name: string | null
}

/** GET /orders/:id/billing_info, old shape or `x-version: 2`. */
export function documentOf(billing: unknown): BuyerDocument {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- two undocumented-in-types shapes
  const root = (billing ?? {}) as Record<string, any>
  const v2 = root.buyer?.billing_info
  if (v2?.identification) {
    return {
      type: v2.identification.type ?? null,
      number: String(v2.identification.number ?? '').replace(/\D/g, '') || null,
      name: [v2.name, v2.last_name].filter(Boolean).join(' ') || null,
    }
  }
  const v1 = root.billing_info ?? {}
  const extra = (type: string) =>
    (v1.additional_info as { type: string; value: string }[] | undefined)?.find(
      (entry) => entry.type === type
    )?.value
  return {
    type: v1.doc_type ?? null,
    number: String(v1.doc_number ?? '').replace(/\D/g, '') || null,
    name:
      [extra('FIRST_NAME'), extra('LAST_NAME')].filter(Boolean).join(' ') ||
      extra('BUSINESS_NAME') ||
      null,
  }
}

function splitName(name: string): { first_name: string; last_name: string } {
  const parts = name.replace(/\s+/g, ' ').trim().split(' ')
  return { first_name: parts[0] ?? '', last_name: parts.slice(1).join(' ') }
}

export interface AddressOptions {
  documentMetadataKey: string
  splitStreetNumber: boolean
}

export function addressOf(
  shipment: Shipment | null,
  buyer: MlOrderData['buyer'],
  document: BuyerDocument,
  options: AddressOptions
) {
  const address = shipment?.address
  if (!address) return undefined
  const name =
    address.receiver_name ||
    document.name ||
    [buyer?.first_name, buyer?.last_name].filter(Boolean).join(' ') ||
    buyer?.nickname ||
    ''
  const street = address.street_name?.trim() || address.address_line?.trim() || ''
  const number = address.street_number?.trim() || ''
  // "BR-SP" → "SP"
  const province = address.state?.id?.includes('-')
    ? address.state.id.split('-').pop()!
    : (address.state?.name ?? '')
  const metadata: Record<string, unknown> = {}
  if (number) metadata.number = number
  if (address.neighborhood?.name) metadata.neighborhood = address.neighborhood.name
  if (document.number) {
    metadata[options.documentMetadataKey] = document.number
    if (document.type) metadata.document_type = document.type
  }
  return {
    ...splitName(name),
    address_1:
      options.splitStreetNumber || !number || !address.street_name
        ? street
        : `${street}, ${number}`,
    address_2: address.comment?.trim() || undefined,
    city: address.city?.name ?? '',
    province,
    postal_code: (address.zip_code ?? '').replace(/\D/g, ''),
    country_code: (address.country?.id ?? '').toLowerCase() || undefined,
    phone: address.receiver_phone?.replace(/[^\d+]/g, '') || undefined,
    metadata,
  }
}

export interface ListingLinks {
  item_id: string | null
  variants: VariantLink[]
}

/** The Medusa variant a sold item is: by the listing it was sold from, then by SKU. */
export function variantOf(
  line: MlOrderItem,
  listings: ListingLinks[],
  variantBySku: Record<string, string>
): string | null {
  const listing = listings.find((candidate) => candidate.item_id === line.item.id)
  if (listing) {
    const variationId = line.item.variation_id ? String(line.item.variation_id) : null
    const link =
      listing.variants.find((variant) => variant.variation_id === variationId) ??
      (listing.variants.length === 1 ? listing.variants[0] : undefined)
    if (link) return link.variant_id
  }
  const sku = line.item.seller_sku ?? line.item.seller_custom_field
  return (sku && variantBySku[sku]) || null
}

/** paid when every order of the sale is; cancelled when any is; otherwise what the unpaid one says. */
export function saleStatus(orders: MlOrderData[]): string {
  if (orders.some((order) => order.status === 'cancelled')) return 'cancelled'
  if (orders.length && orders.every((order) => order.status === 'paid')) return 'paid'
  return orders.find((order) => order.status !== 'paid')?.status ?? 'unknown'
}

export function saleKey(order: MlOrderData): string {
  return order.pack_id ? String(order.pack_id) : String(order.id)
}

export function orderInput(input: {
  orders: MlOrderData[]
  shipment: Shipment | null
  document: BuyerDocument
  listings: ListingLinks[]
  variantBySku: Record<string, string>
  region_id: string
  sales_channel_id: string
  currency_code: string
  options: AddressOptions
}) {
  const { orders, shipment } = input
  const first = orders[0]
  if (!first) throw new Error('A sale needs at least one order')
  const address = addressOf(shipment, first.buyer, input.document, input.options)
  const lines = orders.flatMap((order) => order.order_items)
  // Mercado Envios postage is collected and paid out by Mercado Livre, never by the seller.
  const sellerShips = shipment ? shipment.mode !== 'me2' : false
  return {
    region_id: input.region_id,
    sales_channel_id: input.sales_channel_id,
    currency_code: input.currency_code.toLowerCase(),
    status: 'pending' as const,
    shipping_address: address,
    billing_address: address,
    items: lines.map((line) => {
      const variantId = variantOf(line, input.listings, input.variantBySku)
      return {
        ...(variantId ? { variant_id: variantId } : {}),
        title: line.item.title,
        quantity: line.quantity,
        unit_price: line.unit_price,
        metadata: {
          mercadolivre_item_id: line.item.id,
          ...(line.item.variation_id
            ? { mercadolivre_variation_id: String(line.item.variation_id) }
            : {}),
        },
      }
    }),
    shipping_methods: shipment
      ? [
          {
            name: shipment.method ?? (shipment.mode === 'me2' ? 'Mercado Envios' : 'Envio'),
            amount: sellerShips ? shipment.cost : 0,
          },
        ]
      : [],
    metadata: {
      mercadolivre: {
        order_ids: orders.map((order) => String(order.id)),
        pack_id: first.pack_id ? String(first.pack_id) : null,
        shipment_id: shipment?.id ?? null,
        shipping_mode: shipment?.mode ?? null,
        logistic_type: shipment?.logistic_type ?? null,
        buyer_nickname: first.buyer?.nickname ?? null,
        buyer_shipping_cost: shipment?.cost ?? 0,
        sale_fee: lines.reduce((sum, line) => sum + (line.sale_fee ?? 0) * line.quantity, 0),
      },
    },
  }
}
