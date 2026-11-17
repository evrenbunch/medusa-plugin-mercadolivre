import type { AuthenticatedMedusaRequest, MedusaResponse } from '@medusajs/framework/http'
import { MedusaError } from '@medusajs/framework/utils'

import { authorizationUrl, createState } from '../../../../lib/oauth'
import { missingCredentials } from '../../../../lib/options'
import { moduleOf } from '../../../../lib/session'

/** The Mercado Livre page where the seller authorizes the application. */
export async function POST(req: AuthenticatedMedusaRequest, res: MedusaResponse) {
  const { options } = moduleOf(req.scope)
  const missing = missingCredentials(options)
  if (missing.length) {
    throw new MedusaError(
      MedusaError.Types.NOT_ALLOWED,
      `Mercado Livre is not configured (missing ${missing.join(', ')})`
    )
  }
  const secret = options.encryptionKey!
  const state = createState(req.auth_context.actor_id, secret)
  res.json({
    url: authorizationUrl({
      site: options.site,
      clientId: options.clientId!,
      redirectUri: options.redirectUri!,
      state,
      secret,
    }),
  })
}
