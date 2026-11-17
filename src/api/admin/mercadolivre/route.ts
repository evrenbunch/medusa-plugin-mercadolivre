import type { AuthenticatedMedusaRequest, MedusaResponse } from '@medusajs/framework/http'

import { missingCredentials } from '../../../lib/options'
import { accountOf, moduleOf } from '../../../lib/session'

/** What the admin screen opens with: is it configured, who is connected, how much is there. */
export async function GET(req: AuthenticatedMedusaRequest, res: MedusaResponse) {
  const service = moduleOf(req.scope)
  const { options } = service
  const account = await accountOf(service)
  const [, listings] = await service.listAndCountMlListings({}, { take: 1 })
  const [, orders] = await service.listAndCountMlOrders({}, { take: 1 })
  const [, stuck] = await service.listAndCountMlOrders(
    { status: 'paid', order_id: null },
    { take: 1 }
  )
  res.json({
    missing: missingCredentials(options),
    site: options.site,
    dry_run: options.dryRun,
    import_orders: options.importOrders,
    redirect_uri: options.redirectUri ?? null,
    account: account && {
      seller_id: account.seller_id,
      nickname: account.nickname,
      site_id: account.site_id,
      user_products: account.user_products,
      problem: account.problem,
    },
    counts: { listings, orders, orders_not_imported: stuck },
  })
}

/** Disconnects the account. Listings and orders stay, so connecting the same account again resumes. */
export async function DELETE(req: AuthenticatedMedusaRequest, res: MedusaResponse) {
  const service = moduleOf(req.scope)
  const accounts = await service.listMlAccounts({})
  if (accounts.length) await service.deleteMlAccounts(accounts.map((account) => account.id))
  res.json({ disconnected: true })
}
