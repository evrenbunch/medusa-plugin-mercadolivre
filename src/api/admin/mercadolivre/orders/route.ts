import type { AuthenticatedMedusaRequest, MedusaResponse } from '@medusajs/framework/http'
import { ContainerRegistrationKeys } from '@medusajs/framework/utils'

import { pullRecentOrders } from '../../../../lib/orders'
import { moduleOf } from '../../../../lib/session'

/** Sales, newest first, each with the display id of its Medusa order. */
export async function GET(req: AuthenticatedMedusaRequest, res: MedusaResponse) {
  const service = moduleOf(req.scope)
  const limit = Math.min(Number(req.query.limit) || 50, 200)
  const offset = Number(req.query.offset) || 0
  const orderId = typeof req.query.order_id === 'string' ? req.query.order_id : undefined
  const [sales, count] = await service.listAndCountMlOrders(orderId ? { order_id: orderId } : {}, {
    take: limit,
    skip: offset,
    order: { created_at: 'DESC' },
  })
  const ids = sales.map((sale) => sale.order_id).filter((id): id is string => !!id)
  const query = req.scope.resolve(ContainerRegistrationKeys.QUERY)
  const { data: orders } = ids.length
    ? await query.graph({ entity: 'order', fields: ['id', 'display_id'], filters: { id: ids } })
    : { data: [] }
  const displayIds = new Map(orders.map((order) => [order.id, order.display_id]))
  res.json({
    orders: sales.map((sale) => ({
      ...sale,
      order_display_id: sale.order_id ? (displayIds.get(sale.order_id) ?? null) : null,
    })),
    count,
    limit,
    offset,
  })
}

/** `{ action: 'pull' }`: read the last days' sales from Mercado Livre now. */
export async function POST(req: AuthenticatedMedusaRequest, res: MedusaResponse) {
  res.json(await pullRecentOrders(req.scope, 24 * 7))
}
