import type { AuthenticatedMedusaRequest, MedusaResponse } from '@medusajs/framework/http'

import { sessionOf } from '../../../../lib/session'

/**
 * Creates a Mercado Livre test user (there is no sandbox: test users trade
 * among themselves on the real site, invisible to everyone else). The
 * password is shown once and never stored. An application may hold ten.
 */
export async function POST(req: AuthenticatedMedusaRequest, res: MedusaResponse) {
  const session = await sessionOf(req.scope)
  const user = await session.client.post<{
    id: number
    nickname: string
    password: string
    site_status?: string
  }>('/users/test_user', { site_id: session.account.site_id })
  res.json({ test_user: { id: user.id, nickname: user.nickname, password: user.password } })
}
