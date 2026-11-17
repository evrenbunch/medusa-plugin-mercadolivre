import { MedusaService } from '@medusajs/framework/utils'

import { type MercadoLivreOptions, type ResolvedOptions, resolveOptions } from '../../lib/options'

import { MlAccount } from './models/account'
import { MlEvent } from './models/event'
import { MlListing } from './models/listing'
import { MlOrder } from './models/order'

export default class MercadoLivreModuleService extends MedusaService({
  MlAccount,
  MlListing,
  MlOrder,
  MlEvent,
}) {
  /** The plugin's options with defaults; routes, jobs and subscribers read them from here. */
  readonly options: ResolvedOptions

  constructor(container: Record<string, unknown>, options?: MercadoLivreOptions) {
    // eslint-disable-next-line prefer-rest-params
    super(...(arguments as unknown as [Record<string, unknown>]))
    this.options = resolveOptions(options)
  }

  /**
   * Stores a notification and tells whether it is new. Mercado Livre repeats
   * deliveries until one is acknowledged.
   */
  async recordEvent(input: {
    notification_id: string
    topic: string
    resource: string
    seller_id?: string | null
  }): Promise<string | null> {
    const [seen] = await this.listMlEvents(
      { notification_id: input.notification_id },
      { select: ['id'] }
    )
    if (seen) return null
    try {
      const created = await this.createMlEvents(input)
      return created.id
    } catch {
      // Two deliveries raced; the unique index let one through.
      return null
    }
  }
}
