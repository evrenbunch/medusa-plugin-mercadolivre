import type { AuthenticatedMedusaRequest, MedusaResponse } from '@medusajs/framework/http'
import { MedusaError } from '@medusajs/framework/utils'

import { importSale, type SaleRow } from '../../../../../lib/orders'
import { moduleOf } from '../../../../../lib/session'

/** Reads the sale from Mercado Livre again and imports it if it is paid and still missing. */
export async function POST(req: AuthenticatedMedusaRequest, res: MedusaResponse) {
  const sale = (await moduleOf(req.scope).retrieveMlOrder(req.params.id!)) as unknown as SaleRow
  const orderId = sale.order_ids[0]
  if (!orderId) throw new MedusaError(MedusaError.Types.INVALID_DATA, 'The sale has no order id')
  res.json({ order: await importSale(req.scope, orderId) })
}
