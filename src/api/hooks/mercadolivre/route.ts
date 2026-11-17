import type { MedusaRequest, MedusaResponse } from '@medusajs/framework/http'
import { Modules } from '@medusajs/framework/utils'

import { NOTIFICATION_EVENT } from '../../../lib/events'
import { accountOf, moduleOf } from '../../../lib/session'

interface Notification {
  _id?: string
  resource?: string
  user_id?: number | string
  topic?: string
  application_id?: number | string
}

const RESOURCE = /^\/[a-z_]+\/[A-Za-z0-9_-]+(\?.*)?$/

/**
 * Mercado Livre's notifications (the "Notifications callback URL" of the
 * application). They carry no signature and no data, only the path of what
 * changed, which is then read from the API with the seller's token, so a
 * forged one can at most make us re-read an order. It must be acknowledged
 * within 500 ms: the notification is stored and handled by a subscriber.
 */
export async function POST(req: MedusaRequest, res: MedusaResponse) {
  const body = (req.body ?? {}) as Notification
  const service = moduleOf(req.scope)
  const account = await accountOf(service)
  const ours =
    account &&
    typeof body._id === 'string' &&
    typeof body.topic === 'string' &&
    typeof body.resource === 'string' &&
    RESOURCE.test(body.resource) &&
    String(body.user_id) === account.seller_id &&
    String(body.application_id) === service.options.clientId
  if (ours) {
    const id = await service.recordEvent({
      notification_id: body._id!,
      topic: body.topic!,
      resource: body.resource!,
      seller_id: String(body.user_id),
    })
    if (id) {
      await req.scope.resolve(Modules.EVENT_BUS).emit({ name: NOTIFICATION_EVENT, data: { id } })
    }
  }
  res.status(200).json({ received: true })
}
