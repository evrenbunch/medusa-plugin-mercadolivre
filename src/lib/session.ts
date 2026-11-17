import type { MedusaContainer } from '@medusajs/framework/types'
import { MedusaError, Modules } from '@medusajs/framework/utils'

import { MERCADOLIVRE_MODULE } from '../modules/mercadolivre'
import type MercadoLivreModuleService from '../modules/mercadolivre/service'

import { MercadoLivreClient, MercadoLivreError, refreshTokens, type TokenSet } from './client'
import { open, seal } from './crypto'
import { missingCredentials, type ResolvedOptions } from './options'

export interface AccountRow {
  id: string
  seller_id: string
  nickname: string | null
  site_id: string
  access_token: string
  refresh_token: string
  expires_at: Date | string
  user_products: boolean
  problem: string | null
}

export interface Session {
  client: MercadoLivreClient
  account: AccountRow
  options: ResolvedOptions
  service: MercadoLivreModuleService
}

/** Refresh this long before the access token (6 h) runs out. */
const REFRESH_MARGIN_MS = 10 * 60 * 1000

export const moduleOf = (container: MedusaContainer) =>
  container.resolve<MercadoLivreModuleService>(MERCADOLIVRE_MODULE)

export async function accountOf(service: MercadoLivreModuleService): Promise<AccountRow | null> {
  const [account] = await service.listMlAccounts({}, { take: 1, order: { created_at: 'DESC' } })
  return (account as unknown as AccountRow) ?? null
}

/**
 * Runs `job` while holding a lock shared by the server and worker processes.
 * Refresh tokens are single-use, so two processes refreshing at once would
 * leave one of them with a dead token; the same goes for importing one sale twice.
 */
export async function locked<T>(
  container: MedusaContainer,
  key: string,
  job: () => Promise<T>
): Promise<T> {
  let locking: { execute: <R>(keys: string, job: () => Promise<R>, args?: object) => Promise<R> }
  try {
    locking = container.resolve(Modules.LOCKING)
  } catch {
    return job()
  }
  return locking.execute(`mercadolivre:${key}`, job, { timeout: 30 })
}

export function sealTokens(tokens: TokenSet, secret: string, now = Date.now()) {
  return {
    access_token: seal(tokens.access_token, secret),
    refresh_token: seal(tokens.refresh_token, secret),
    expires_at: new Date(now + tokens.expires_in * 1000),
  }
}

async function freshToken(container: MedusaContainer, options: ResolvedOptions): Promise<string> {
  const service = moduleOf(container)
  const secret = options.encryptionKey!
  const usable = (account: AccountRow | null) => {
    if (!account) throw notConnected()
    if (new Date(account.expires_at).getTime() - Date.now() < REFRESH_MARGIN_MS) return null
    return open(account.access_token, secret)
  }
  const current = usable(await accountOf(service))
  if (current) return current
  return locked(container, 'token', async () => {
    // Another process may have refreshed while this one waited for the lock.
    const account = (await accountOf(service))!
    const again = usable(account)
    if (again) return again
    const refreshToken = open(account.refresh_token, secret)
    if (!refreshToken) {
      throw new MedusaError(
        MedusaError.Types.NOT_ALLOWED,
        'The stored Mercado Livre tokens cannot be read with the current encryptionKey. Connect the account again.'
      )
    }
    try {
      const tokens = await refreshTokens({
        baseUrl: options.apiBaseUrl,
        clientId: options.clientId!,
        clientSecret: options.clientSecret!,
        refreshToken,
      })
      await service.updateMlAccounts({
        id: account.id,
        problem: null,
        ...sealTokens(tokens, secret),
      })
      return tokens.access_token
    } catch (error) {
      if (error instanceof MercadoLivreError && error.status >= 400 && error.status < 500) {
        await service.updateMlAccounts({
          id: account.id,
          problem: 'Mercado Livre refused to renew the access. Connect the account again.',
        })
      }
      throw error
    }
  })
}

const notConnected = () =>
  new MedusaError(MedusaError.Types.NOT_ALLOWED, 'No Mercado Livre account is connected')

/** The connected account and a client that keeps its token fresh. Throws when nothing is connected. */
export async function sessionOf(container: MedusaContainer): Promise<Session> {
  const service = moduleOf(container)
  const options = service.options
  const missing = missingCredentials(options)
  if (missing.length) {
    throw new MedusaError(
      MedusaError.Types.NOT_ALLOWED,
      `Mercado Livre is not configured (missing ${missing.join(', ')})`
    )
  }
  const account = await accountOf(service)
  if (!account) throw notConnected()
  const client = new MercadoLivreClient(options.apiBaseUrl, () => freshToken(container, options))
  return { client, account, options, service }
}

/** sessionOf, or null when there is no account: jobs and subscribers simply have nothing to do. */
export async function sessionOrNull(container: MedusaContainer): Promise<Session | null> {
  const service = moduleOf(container)
  if (missingCredentials(service.options).length) return null
  if (!(await accountOf(service))) return null
  return sessionOf(container)
}

/** What an admin can be told about a failure: Mercado Livre's own words, or the error's. */
export function problemOf(error: unknown): string {
  if (error instanceof MercadoLivreError) return error.detail.slice(0, 500)
  return (error instanceof Error ? error.message : String(error)).slice(0, 500)
}
