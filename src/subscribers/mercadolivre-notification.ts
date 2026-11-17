import type { SubscriberArgs, SubscriberConfig } from '@medusajs/framework'

import { NOTIFICATION_EVENT, processEvent } from '../lib/events'

/** Handles a notification the webhook stored and acknowledged. */
export default async function mercadoLivreNotification({
  event,
  container,
}: SubscriberArgs<{ id: string }>) {
  await processEvent(container, event.data.id)
}

export const config: SubscriberConfig = {
  event: NOTIFICATION_EVENT,
  context: { subscriberId: 'mercadolivre-notification' },
}
