import type { MedusaContainer } from '@medusajs/framework/types'

import { processPendingEvents } from '../lib/events'
import { pullRecentOrders } from '../lib/orders'

/**
 * Every 10 minutes: notifications that failed are handled again, and recent
 * sales are read from the API in case a notification never arrived.
 */
export default async function mercadoLivreOrdersJob(container: MedusaContainer) {
  await processPendingEvents(container)
  await pullRecentOrders(container)
}

export const config = { name: 'mercadolivre-orders', schedule: '*/10 * * * *' }
