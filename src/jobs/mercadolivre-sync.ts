import type { MedusaContainer } from '@medusajs/framework/types'

import { syncListings } from '../lib/listings'

/**
 * Every 15 minutes: stock and prices that changed in Medusa reach the
 * published listings. Only differences are sent.
 */
export default async function mercadoLivreSyncJob(container: MedusaContainer) {
  await syncListings(container)
}

export const config = { name: 'mercadolivre-sync', schedule: '*/15 * * * *' }
