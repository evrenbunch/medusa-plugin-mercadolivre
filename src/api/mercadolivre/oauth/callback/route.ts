import type { MedusaRequest, MedusaResponse } from '@medusajs/framework/http'

import { exchangeCode, MercadoLivreClient } from '../../../../lib/client'
import { readState, verifierOf } from '../../../../lib/oauth'
import { missingCredentials } from '../../../../lib/options'
import { moduleOf, sealTokens } from '../../../../lib/session'

/**
 * Where Mercado Livre sends the seller back after they authorize the
 * application. The route is public (the browser arrives without the admin's
 * credentials), so the signed, short-lived `state` an admin obtained from
 * POST /admin/mercadolivre/connect is what authorizes it.
 */
export async function GET(req: MedusaRequest, res: MedusaResponse) {
  const service = moduleOf(req.scope)
  const options = service.options
  const back = (result: string) => {
    const separator = options.adminReturnUrl.includes('?') ? '&' : '?'
    res.redirect(`${options.adminReturnUrl}${separator}${result}`)
  }
  if (missingCredentials(options).length) return back('error=not_configured')
  const { code, state, error } = req.query as Record<string, string | undefined>
  if (error) return back('error=denied')
  const parsed = state ? readState(state, options.encryptionKey!) : null
  if (!code || !parsed) return back('error=invalid_state')
  try {
    const tokens = await exchangeCode({
      baseUrl: options.apiBaseUrl,
      clientId: options.clientId!,
      clientSecret: options.clientSecret!,
      redirectUri: options.redirectUri!,
      code,
      verifier: verifierOf(parsed.nonce, options.encryptionKey!),
    })
    const client = new MercadoLivreClient(options.apiBaseUrl, async () => tokens.access_token)
    const me = await client.get<{
      id: number
      nickname?: string
      site_id?: string
      tags?: string[]
    }>('/users/me')
    if (me.site_id && me.site_id !== options.site) return back('error=wrong_site')
    const account = {
      seller_id: String(me.id),
      nickname: me.nickname ?? null,
      site_id: me.site_id ?? options.site,
      user_products: (me.tags ?? []).includes('user_product_seller'),
      connected_by: parsed.userId,
      problem: null,
      ...sealTokens(tokens, options.encryptionKey!),
    }
    const existing = await service.listMlAccounts({})
    const same = existing.find((row) => row.seller_id === account.seller_id)
    // One account at a time: connecting another replaces the previous one.
    const others = existing.filter((row) => row.id !== same?.id).map((row) => row.id)
    if (others.length) await service.deleteMlAccounts(others)
    if (same) await service.updateMlAccounts({ id: same.id, ...account })
    else await service.createMlAccounts(account)
    back('connected=1')
  } catch {
    back('error=exchange_failed')
  }
}
