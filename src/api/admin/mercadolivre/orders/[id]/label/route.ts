import type { AuthenticatedMedusaRequest, MedusaResponse } from '@medusajs/framework/http'

import { shippingLabel } from '../../../../../../lib/orders'

/** The Mercado Envios label of a sale, as Mercado Livre issues it (PDF). */
export async function GET(req: AuthenticatedMedusaRequest, res: MedusaResponse) {
  const label = await shippingLabel(req.scope, req.params.id!)
  res.setHeader('Content-Type', label.headers.get('content-type') ?? 'application/pdf')
  res.setHeader('Content-Disposition', `inline; filename="mercadolivre-${req.params.id}.pdf"`)
  res.send(Buffer.from(await label.arrayBuffer()))
}
