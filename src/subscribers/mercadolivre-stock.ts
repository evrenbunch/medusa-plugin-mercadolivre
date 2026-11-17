import type { SubscriberArgs, SubscriberConfig } from '@medusajs/framework'
import { ContainerRegistrationKeys } from '@medusajs/framework/utils'

import { syncListings } from '../lib/listings'
import { moduleOf } from '../lib/session'

/**
 * A sale in the store takes stock the listings still advertise: the listings
 * of what was bought are synced at once instead of at the next job run.
 * A product edited in the admin gets the same treatment.
 */
export default async function mercadoLivreStock({
  event,
  container,
}: SubscriberArgs<{ id: string }>) {
  const [any] = await moduleOf(container).listMlListings(
    { status: ['active', 'paused'] },
    { take: 1, select: ['id'] }
  )
  if (!any) return
  if (event.name === 'product.updated') {
    await syncListings(container, { productIds: [event.data.id] })
    return
  }
  const query = container.resolve(ContainerRegistrationKeys.QUERY)
  const { data } = await query.graph({
    entity: 'order',
    fields: ['items.variant_id'],
    filters: { id: event.data.id },
  })
  const variantIds = (
    (data[0] as { items?: { variant_id?: string | null }[] } | undefined)?.items ?? []
  )
    .map((item) => item?.variant_id)
    .filter((id): id is string => !!id)
  if (variantIds.length) await syncListings(container, { variantIds })
}

export const config: SubscriberConfig = {
  event: ['order.placed', 'order.canceled', 'product.updated'],
  context: { subscriberId: 'mercadolivre-stock' },
}
