import type { MedusaContainer } from '@medusajs/framework/types'
import { ContainerRegistrationKeys, Modules } from '@medusajs/framework/utils'
import {
  cancelOrderWorkflow,
  createOrderPaymentCollectionWorkflow,
  createOrderWorkflow,
  markOrderFulfillmentAsDeliveredWorkflow,
  markPaymentCollectionAsPaid,
} from '@medusajs/medusa/core-flows'

import { ensureSalesChannel, regionFor } from './channel'
import type { ListingRow } from './listings'
import {
  documentOf,
  type MlOrderData,
  type MlShipmentData,
  normalizeShipment,
  orderInput,
  saleKey,
  saleStatus,
  type Shipment,
  variantOf,
} from './sale'
import { locked, problemOf, type Session, sessionOf, sessionOrNull } from './session'

export interface SaleRow {
  id: string
  external_key: string
  pack_id: string | null
  order_ids: string[]
  shipment_id: string | null
  order_id: string | null
  status: string
  shipping_status: string | null
  shipping_substatus: string | null
  shipping_mode: string | null
  logistic_type: string | null
  tracking_number: string | null
  buyer_nickname: string | null
  total: number | null
  currency_code: string | null
  problem: string | null
  sold_at: Date | null
}

export const ORDER_IMPORTED_EVENT = 'mercadolivre.order.imported'

async function saleOrders(session: Session, order: MlOrderData): Promise<MlOrderData[]> {
  if (!order.pack_id) return [order]
  const pack = await session.client.get<{ orders?: { id: number | string }[] }>(
    `/packs/${order.pack_id}`
  )
  const ids = (pack.orders ?? []).map((entry) => String(entry.id))
  if (ids.length <= 1) return [order]
  return Promise.all(
    ids.map((id) =>
      id === String(order.id) ? order : session.client.get<MlOrderData>(`/orders/${id}`)
    )
  )
}

async function shipmentOf(session: Session, id: string | number): Promise<Shipment> {
  return normalizeShipment(await session.client.get<MlShipmentData>(`/shipments/${id}`))
}

async function rowOf(session: Session, filter: Record<string, unknown>): Promise<SaleRow | null> {
  const [row] = await session.service.listMlOrders(filter, { take: 1 })
  return (row as unknown as SaleRow) ?? null
}

/** Sold variants keep their stock out of other channels until the parcel leaves. */
async function reserveStock(container: MedusaContainer, orderId: string, salesChannelId: string) {
  const query = container.resolve(ContainerRegistrationKeys.QUERY)
  const { data } = await query.graph({
    entity: 'order',
    fields: [
      'items.id',
      'items.quantity',
      'items.variant.manage_inventory',
      'items.variant.inventory_items.inventory_item_id',
      'items.variant.inventory_items.required_quantity',
    ],
    filters: { id: orderId },
  })
  const { data: channels } = await query.graph({
    entity: 'sales_channel',
    fields: ['stock_locations.id'],
    filters: { id: salesChannelId },
  })
  const locations = ((channels[0] as { stock_locations?: { id: string }[] } | undefined)
    ?.stock_locations ?? []) as { id: string }[]
  if (!locations.length) return
  const inventory = container.resolve(Modules.INVENTORY)
  type Line = {
    id: string
    quantity: number
    variant?: {
      manage_inventory?: boolean
      inventory_items?: { inventory_item_id: string; required_quantity?: number }[]
    }
  }
  for (const line of ((data[0] as { items?: Line[] } | undefined)?.items ?? []) as Line[]) {
    if (!line.variant?.manage_inventory) continue
    for (const item of line.variant.inventory_items ?? []) {
      const quantity = Number(line.quantity) * (item.required_quantity ?? 1)
      const levels = await inventory.listInventoryLevels({
        inventory_item_id: item.inventory_item_id,
        location_id: locations.map((location) => location.id),
      })
      const level =
        levels.find(
          (candidate) =>
            Number(candidate.stocked_quantity) - Number(candidate.reserved_quantity) >= quantity
        ) ?? levels[0]
      if (!level) continue
      await inventory.createReservationItems([
        {
          line_item_id: line.id,
          inventory_item_id: item.inventory_item_id,
          location_id: level.location_id,
          quantity,
          allow_backorder: true,
          description: 'Mercado Livre',
        },
      ])
    }
  }
}

/** Mercado Livre holds the money: the order is recorded as paid with Medusa's system provider. */
async function ensurePaid(container: MedusaContainer, orderId: string) {
  const query = container.resolve(ContainerRegistrationKeys.QUERY)
  const { data } = await query.graph({
    entity: 'order',
    fields: ['id', 'total', 'payment_collections.id', 'payment_collections.status'],
    filters: { id: orderId },
  })
  const order = data[0] as unknown as {
    total: number
    payment_collections?: { id: string; status: string }[]
  }
  let collection = order.payment_collections?.[0]
  if (!collection) {
    const { result } = await createOrderPaymentCollectionWorkflow(container).run({
      input: { order_id: orderId, amount: Number(order.total) },
    })
    collection = (result as unknown as { id: string; status: string }[])[0]
  }
  if (!collection || collection.status !== 'not_paid') return
  await markPaymentCollectionAsPaid(container).run({
    input: { order_id: orderId, payment_collection_id: collection.id },
  })
}

async function variantsBySku(container: MedusaContainer, skus: string[]) {
  if (!skus.length) return {}
  const query = container.resolve(ContainerRegistrationKeys.QUERY)
  const { data } = await query.graph({
    entity: 'product_variant',
    fields: ['id', 'sku'],
    filters: { sku: skus },
  })
  return Object.fromEntries(
    (data as { id: string; sku: string | null }[])
      .filter((variant) => variant.sku)
      .map((variant) => [variant.sku!, variant.id])
  )
}

async function createMedusaOrder(
  container: MedusaContainer,
  session: Session,
  row: SaleRow,
  orders: MlOrderData[],
  shipment: Shipment | null
) {
  const { options, account, client, service } = session
  const first = orders[0]!
  const billing = await client
    .get(`/orders/${first.id}/billing_info`, { headers: { 'x-version': '2' } })
    .catch(() => null)
  const lines = orders.flatMap((order) => order.order_items)
  const listings = (await service.listMlListings({
    item_id: [...new Set(lines.map((line) => line.item.id))],
  })) as unknown as ListingRow[]
  const unmatched = lines
    .filter((line) => !variantOf(line, listings, {}))
    .map((line) => line.item.seller_sku ?? line.item.seller_custom_field)
    .filter((sku): sku is string => !!sku)
  const region = await regionFor(container, options, account.site_id)
  const salesChannelId = await ensureSalesChannel(container, options)
  const input = orderInput({
    orders,
    shipment,
    document: documentOf(billing),
    listings,
    variantBySku: await variantsBySku(container, unmatched),
    region_id: region.id,
    sales_channel_id: salesChannelId,
    currency_code: first.currency_id ?? region.currency_code,
    options,
  })
  const { result } = await createOrderWorkflow(container).run({ input: input as never })
  const orderId = (result as { id: string }).id
  // Kept at once: whatever fails next, this sale never becomes a second order.
  await service.updateMlOrders({ id: row.id, order_id: orderId })
  await reserveStock(container, orderId, salesChannelId)
  await ensurePaid(container, orderId)
  const events = container.resolve(Modules.EVENT_BUS)
  await events.emit([
    ...(options.emitOrderPlaced ? [{ name: 'order.placed', data: { id: orderId } }] : []),
    { name: ORDER_IMPORTED_EVENT, data: { id: orderId, mercadolivre_order_id: row.id } },
  ])
  return orderId
}

/**
 * Brings one Mercado Livre order (and the rest of its pack) up to date: the
 * sale row always, the Medusa order once the sale is paid, a cancellation
 * when Mercado Livre cancels. Safe to call any number of times.
 */
export async function importSale(container: MedusaContainer, mlOrderId: string): Promise<SaleRow> {
  const session = await sessionOf(container)
  const order = await session.client.get<MlOrderData>(`/orders/${mlOrderId}`)
  const key = saleKey(order)
  return locked(container, `sale:${key}`, async () => {
    const { service, options } = session
    const orders = await saleOrders(session, order)
    const status = saleStatus(orders)
    const shipmentId = orders.find((entry) => entry.shipping?.id)?.shipping?.id
    const snapshot = {
      pack_id: order.pack_id ? String(order.pack_id) : null,
      order_ids: orders.map((entry) => String(entry.id)) as unknown as Record<string, unknown>,
      shipment_id: shipmentId ? String(shipmentId) : null,
      status,
      buyer_nickname: order.buyer?.nickname ?? null,
      total: orders.reduce((sum, entry) => sum + (entry.total_amount ?? 0), 0),
      currency_code: order.currency_id ?? null,
      sold_at: order.date_created ? new Date(order.date_created) : null,
      synced_at: new Date(),
    }
    let row = await rowOf(session, { external_key: key })
    if (row) await service.updateMlOrders({ id: row.id, ...snapshot })
    else await service.createMlOrders({ external_key: key, ...snapshot })
    row = (await rowOf(session, { external_key: key }))!

    let shipment: Shipment | null = null
    let problem: string | null = null
    try {
      if (shipmentId) {
        shipment = await shipmentOf(session, shipmentId)
        await service.updateMlOrders({ id: row.id, ...shipmentFields(shipment) })
      }
      if (status === 'paid' && options.importOrders) {
        if (!row.order_id) await createMedusaOrder(container, session, row, orders, shipment)
        else await ensurePaid(container, row.order_id)
      }
      if (status === 'cancelled' && row.order_id) {
        await cancelIfOpen(container, row.order_id)
      }
    } catch (error) {
      problem = problemOf(error)
    }
    await service.updateMlOrders({ id: row.id, problem })
    return (await rowOf(session, { id: row.id }))!
  })
}

const shipmentFields = (shipment: Shipment) => ({
  shipping_status: shipment.status,
  shipping_substatus: shipment.substatus,
  shipping_mode: shipment.mode,
  logistic_type: shipment.logistic_type,
  tracking_number: shipment.tracking_number,
})

async function cancelIfOpen(container: MedusaContainer, orderId: string) {
  const query = container.resolve(ContainerRegistrationKeys.QUERY)
  const { data } = await query.graph({
    entity: 'order',
    fields: ['id', 'status'],
    filters: { id: orderId },
  })
  if ((data[0] as { status?: string } | undefined)?.status === 'canceled') return
  await cancelOrderWorkflow(container).run({ input: { order_id: orderId } })
}

/** Mirrors a shipment's status and tracking, and marks the Medusa fulfillments delivered when it arrives. */
export async function syncShipment(container: MedusaContainer, shipmentId: string) {
  const session = await sessionOf(container)
  const raw = await session.client.get<MlShipmentData & { order_id?: number | string }>(
    `/shipments/${shipmentId}`
  )
  const shipment = normalizeShipment(raw)
  let row = await rowOf(session, { shipment_id: shipment.id })
  if (!row && raw.order_id) row = await importSale(container, String(raw.order_id))
  if (!row) return null
  await session.service.updateMlOrders({
    id: row.id,
    shipment_id: shipment.id,
    ...shipmentFields(shipment),
    synced_at: new Date(),
  })
  if (shipment.status === 'delivered' && row.order_id) {
    const query = container.resolve(ContainerRegistrationKeys.QUERY)
    const { data } = await query.graph({
      entity: 'order',
      fields: [
        'fulfillments.id',
        'fulfillments.shipped_at',
        'fulfillments.delivered_at',
        'fulfillments.canceled_at',
      ],
      filters: { id: row.order_id },
    })
    type Fulfillment = {
      id: string
      shipped_at?: string
      delivered_at?: string
      canceled_at?: string
    }
    const open = (
      ((data[0] as { fulfillments?: Fulfillment[] } | undefined)?.fulfillments ??
        []) as Fulfillment[]
    ).filter(
      (fulfillment) =>
        fulfillment.shipped_at && !fulfillment.delivered_at && !fulfillment.canceled_at
    )
    for (const fulfillment of open) {
      await markOrderFulfillmentAsDeliveredWorkflow(container)
        .run({ input: { orderId: row.order_id, fulfillmentId: fulfillment.id } })
        .catch(() => undefined)
    }
  }
  return row
}

/**
 * Catches up on sales whose notification never arrived, and retries paid
 * sales that could not be imported.
 */
export async function pullRecentOrders(container: MedusaContainer, sinceHours = 48) {
  const session = await sessionOrNull(container)
  if (!session) return { seen: 0 }
  const since = new Date(Date.now() - sinceHours * 3600 * 1000).toISOString()
  const search = await session.client.get<{ results?: MlOrderData[] }>('/orders/search', {
    query: {
      seller: session.account.seller_id,
      sort: 'date_desc',
      limit: 50,
      'order.date_last_updated.from': since,
    },
  })
  const pending = (await session.service.listMlOrders(
    { status: 'paid', order_id: null },
    { take: 50 }
  )) as unknown as SaleRow[]
  const known = (await session.service.listMlOrders(
    { external_key: (search.results ?? []).map(saleKey) },
    { take: 200 }
  )) as unknown as SaleRow[]
  const byKey = new Map(known.map((row) => [row.external_key, row]))
  const ids = new Map<string, string>()
  for (const order of search.results ?? []) {
    const row = byKey.get(saleKey(order))
    // Nothing new to learn about a sale already in the same state.
    if (row && row.status === order.status && (row.order_id || order.status !== 'paid')) continue
    ids.set(saleKey(order), String(order.id))
  }
  for (const row of pending) {
    if (row.order_ids[0]) ids.set(row.external_key, row.order_ids[0])
  }
  for (const id of ids.values()) {
    await importSale(container, id).catch(() => undefined)
  }
  return { seen: ids.size }
}

/**
 * Tells Mercado Livre a parcel was posted, for sales the seller ships on their
 * own (not Mercado Envios, where Mercado Livre's label already tracks it).
 */
export async function pushTracking(container: MedusaContainer, fulfillmentId: string) {
  const session = await sessionOrNull(container)
  if (!session) return
  const query = container.resolve(ContainerRegistrationKeys.QUERY)
  const { data } = await query.graph({
    entity: 'fulfillment',
    fields: ['id', 'order.id', 'labels.tracking_number'],
    filters: { id: fulfillmentId },
  })
  const fulfillment = data[0] as unknown as
    { order?: { id?: string }; labels?: { tracking_number?: string }[] } | undefined
  const orderId = fulfillment?.order?.id
  if (!orderId) return
  const row = await rowOf(session, { order_id: orderId })
  if (!row?.shipment_id || row.shipping_mode === 'me2') return
  const tracking = fulfillment?.labels?.find((label) => label.tracking_number)?.tracking_number
  try {
    await session.client.put(`/shipments/${row.shipment_id}`, {
      status: 'shipped',
      ...(tracking ? { tracking_number: tracking } : {}),
    })
    await session.service.updateMlOrders({
      id: row.id,
      shipping_status: 'shipped',
      tracking_number: tracking ?? row.tracking_number,
      problem: null,
    })
  } catch (error) {
    await session.service.updateMlOrders({ id: row.id, problem: `Tracking: ${problemOf(error)}` })
  }
}

/** The shipping label Mercado Livre issues for a Mercado Envios sale, as a PDF response. */
export async function shippingLabel(container: MedusaContainer, saleId: string): Promise<Response> {
  const session = await sessionOf(container)
  const row = (await session.service.retrieveMlOrder(saleId)) as unknown as SaleRow
  if (!row.shipment_id) throw new Error('This sale has no shipment')
  return session.client.get<Response>('/shipment_labels', {
    query: { shipment_ids: row.shipment_id, response_type: 'pdf' },
    headers: { Accept: 'application/pdf' },
    raw: true,
  })
}
