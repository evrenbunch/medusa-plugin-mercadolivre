import type { MedusaContainer } from '@medusajs/framework/types'
import { ContainerRegistrationKeys, MedusaError, Modules } from '@medusajs/framework/utils'

import type { ResolvedOptions } from './options'
import { siteOf } from './sites'

let cachedChannel: string | undefined

/**
 * The sales channel Mercado Livre orders are created in and whose stock is
 * advertised. Created the first time, and linked to the stock locations that
 * exist then, so managed inventory is sellable without another step.
 */
export async function ensureSalesChannel(
  container: MedusaContainer,
  options: ResolvedOptions
): Promise<string> {
  if (options.salesChannelId) return options.salesChannelId
  if (cachedChannel) return cachedChannel
  const channels = container.resolve(Modules.SALES_CHANNEL)
  const [existing] = await channels.listSalesChannels({ name: options.salesChannelName })
  if (existing) return (cachedChannel = existing.id)
  const created = await channels.createSalesChannels({
    name: options.salesChannelName,
    description: 'Orders imported from Mercado Livre',
  })
  const query = container.resolve(ContainerRegistrationKeys.QUERY)
  const { data: locations } = await query.graph({ entity: 'stock_location', fields: ['id'] })
  if (locations.length) {
    const link = container.resolve(ContainerRegistrationKeys.LINK)
    await link.create(
      locations.map((location) => ({
        [Modules.SALES_CHANNEL]: { sales_channel_id: created.id },
        [Modules.STOCK_LOCATION]: { stock_location_id: location.id },
      }))
    )
  }
  return (cachedChannel = created.id)
}

/** The region imported orders belong to: the configured one, or the first that uses the site's currency. */
export async function regionFor(
  container: MedusaContainer,
  options: ResolvedOptions,
  siteId: string
): Promise<{ id: string; currency_code: string }> {
  const regions = container.resolve(Modules.REGION)
  if (options.regionId) {
    const region = await regions.retrieveRegion(options.regionId)
    return { id: region.id, currency_code: region.currency_code }
  }
  const currency = siteOf(siteId).currency.toLowerCase()
  const [region] = await regions.listRegions({ currency_code: currency }, { take: 1 })
  if (!region) {
    throw new MedusaError(
      MedusaError.Types.NOT_FOUND,
      `No region uses ${currency.toUpperCase()}; create one or set the regionId option`
    )
  }
  return { id: region.id, currency_code: region.currency_code }
}
