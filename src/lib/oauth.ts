import { createHash, randomBytes } from 'node:crypto'

import { hmac, safeEqual } from './crypto'
import { siteOf } from './sites'

/*
 * The authorization-code flow with PKCE. Nothing is stored between the two
 * legs: the `state` is signed, expires, and names the admin user who started
 * it; the PKCE verifier is derived from the state's nonce, so only this
 * backend can redeem the code.
 */

const STATE_TTL_MS = 10 * 60 * 1000

export interface OAuthState {
  nonce: string
  userId: string
  issuedAt: number
}

export function createState(userId: string, secret: string, now = Date.now()): string {
  const payload = Buffer.from(
    JSON.stringify({ n: randomBytes(16).toString('base64url'), u: userId, t: now })
  ).toString('base64url')
  return `${payload}.${hmac(`state:${payload}`, secret)}`
}

export function readState(state: string, secret: string, now = Date.now()): OAuthState | null {
  const [payload, signature] = state.split('.')
  if (!payload || !signature || !safeEqual(signature, hmac(`state:${payload}`, secret))) return null
  try {
    const { n, u, t } = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')) as {
      n: string
      u: string
      t: number
    }
    if (typeof t !== 'number' || now - t > STATE_TTL_MS || now < t) return null
    return { nonce: n, userId: u, issuedAt: t }
  } catch {
    return null
  }
}

export const verifierOf = (nonce: string, secret: string) => hmac(`pkce:${nonce}`, secret)
export const challengeOf = (verifier: string) =>
  createHash('sha256').update(verifier).digest('base64url')

export function authorizationUrl(input: {
  site: string
  clientId: string
  redirectUri: string
  state: string
  secret: string
}): string {
  const parsed = readState(input.state, input.secret)
  if (!parsed) throw new Error('Invalid state')
  const url = new URL(`https://${siteOf(input.site).authHost}/authorization`)
  url.searchParams.set('response_type', 'code')
  url.searchParams.set('client_id', input.clientId)
  url.searchParams.set('redirect_uri', input.redirectUri)
  url.searchParams.set('state', input.state)
  url.searchParams.set('code_challenge', challengeOf(verifierOf(parsed.nonce, input.secret)))
  url.searchParams.set('code_challenge_method', 'S256')
  return url.toString()
}
