import type { MedusaContainer } from '@medusajs/framework/types'

import { refreshListing } from './listings'
import { importSale, syncShipment } from './orders'
import { moduleOf, problemOf, sessionOrNull } from './session'

export const NOTIFICATION_EVENT = 'mercadolivre.notification'
const MAX_TRIES = 5

interface EventRow {
  id: string
  topic: string
  resource: string
  seller_id: string | null
  tries: number
}

/** "/orders/2000001" → "2000001" */
const idOf = (resource: string) => resource.split('?')[0]!.split('/').filter(Boolean).pop() ?? ''

async function handle(container: MedusaContainer, event: EventRow) {
  const id = idOf(event.resource)
  if (!id) return
  switch (event.topic) {
    case 'orders_v2':
    case 'orders':
      await importSale(container, id)
      return
    case 'shipments':
      await syncShipment(container, id)
      return
    case 'items': {
      const [listing] = await moduleOf(container).listMlListings({ item_id: id }, { take: 1 })
      if (listing) await refreshListing(container, listing.id)
      return
    }
    default:
    // Questions, messages, claims…: acknowledged, not handled.
  }
}

/** Handles one stored notification; a failure is kept for the retry job. */
export async function processEvent(container: MedusaContainer, eventId: string) {
  const service = moduleOf(container)
  const event = (await service.retrieveMlEvent(eventId)) as unknown as EventRow & {
    processed_at: Date | null
  }
  if (event.processed_at) return
  const session = await sessionOrNull(container)
  // A notification for another account (an old connection) has nothing to act on.
  if (!session || (event.seller_id && event.seller_id !== session.account.seller_id)) {
    await service.updateMlEvents({ id: event.id, processed_at: new Date() })
    return
  }
  try {
    await handle(container, event)
    await service.updateMlEvents({ id: event.id, processed_at: new Date(), problem: null })
  } catch (error) {
    const tries = event.tries + 1
    await service.updateMlEvents({
      id: event.id,
      tries,
      problem: problemOf(error),
      // Given up on: the periodic order pull is the safety net.
      ...(tries >= MAX_TRIES ? { processed_at: new Date() } : {}),
    })
  }
}

export async function processPendingEvents(container: MedusaContainer) {
  const service = moduleOf(container)
  const pending = await service.listMlEvents(
    { processed_at: null },
    { take: 100, order: { created_at: 'ASC' }, select: ['id'] }
  )
  for (const event of pending) await processEvent(container, event.id)
  return pending.length
}
