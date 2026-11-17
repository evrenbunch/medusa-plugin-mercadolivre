import type { SubscriberArgs, SubscriberConfig } from '@medusajs/framework'

import { pushTracking } from '../lib/orders'

/** A shipment created in Medusa for a sale the seller posts themselves is reported to Mercado Livre. */
export default async function mercadoLivreTracking({
  event,
  container,
}: SubscriberArgs<{ id: string }>) {
  await pushTracking(container, event.data.id)
}

export const config: SubscriberConfig = {
  event: 'shipment.created',
  context: { subscriberId: 'mercadolivre-tracking' },
}
