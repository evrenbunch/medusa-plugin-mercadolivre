/*
 * A thin client for api.mercadolibre.com: one request function with the
 * bearer token, the API's error shape, and a short retry for rate limits and
 * outages. Endpoints are spelled out where they are used.
 */

export interface TokenSet {
  access_token: string
  refresh_token: string
  expires_in: number
  user_id: number
  scope?: string
}

/** A refusal from the API. `message` is safe to show to an admin; it never carries a token. */
export class MercadoLivreError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    /** Per-field causes Mercado Livre lists for a rejected item. */
    readonly causes: { code?: string; message?: string; type?: string }[] = []
  ) {
    super(message)
    this.name = 'MercadoLivreError'
  }

  /** The causes that block (type error), or the message. */
  get detail(): string {
    const blocking = this.causes.filter((cause) => cause.type !== 'warning' && cause.message)
    return blocking.length ? blocking.map((cause) => cause.message).join(' · ') : this.message
  }
}

type Fetch = typeof fetch
type Query = Record<string, string | number | boolean | undefined | null>

export interface RequestOptions {
  query?: Query
  body?: unknown
  headers?: Record<string, string>
  /** Return the raw response (labels are PDFs). */
  raw?: boolean
}

const RETRY_STATUS = new Set([429, 500, 502, 503, 504])
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

async function errorOf(response: Response): Promise<MercadoLivreError> {
  let body: Record<string, unknown> = {}
  try {
    body = (await response.json()) as Record<string, unknown>
  } catch {
    // Not JSON: the status alone tells the story.
  }
  const causes = Array.isArray(body.cause) ? (body.cause as MercadoLivreError['causes']) : []
  const message =
    (typeof body.message === 'string' && body.message) ||
    (typeof body.error_description === 'string' && body.error_description) ||
    `Mercado Livre answered ${response.status}`
  const code = typeof body.error === 'string' ? body.error : String(response.status)
  return new MercadoLivreError(response.status, code, message, causes)
}

export class MercadoLivreClient {
  constructor(
    private readonly baseUrl: string,
    /** Called before every request, so a token refreshed elsewhere is picked up. */
    private readonly token: () => Promise<string>,
    private readonly fetcher: Fetch = fetch,
    private readonly retries = 2
  ) {}

  async request<T = unknown>(
    method: string,
    path: string,
    options: RequestOptions = {}
  ): Promise<T> {
    const url = new URL(this.baseUrl + path)
    for (const [key, value] of Object.entries(options.query ?? {})) {
      if (value !== undefined && value !== null) url.searchParams.set(key, String(value))
    }
    for (let attempt = 0; ; attempt++) {
      const response = await this.fetcher(url, {
        method,
        headers: {
          Authorization: `Bearer ${await this.token()}`,
          Accept: 'application/json',
          ...(options.body === undefined ? {} : { 'Content-Type': 'application/json' }),
          ...options.headers,
        },
        body: options.body === undefined ? undefined : JSON.stringify(options.body),
      })
      if (response.ok) {
        if (options.raw) return response as unknown as T
        if (response.status === 204) return undefined as T
        const text = await response.text()
        return (text ? JSON.parse(text) : undefined) as T
      }
      if (attempt < this.retries && RETRY_STATUS.has(response.status)) {
        await sleep(400 * 2 ** attempt)
        continue
      }
      throw await errorOf(response)
    }
  }

  get<T = unknown>(path: string, options?: RequestOptions) {
    return this.request<T>('GET', path, options)
  }
  post<T = unknown>(path: string, body?: unknown, options?: RequestOptions) {
    return this.request<T>('POST', path, { ...options, body })
  }
  put<T = unknown>(path: string, body?: unknown, options?: RequestOptions) {
    return this.request<T>('PUT', path, { ...options, body })
  }
}

async function tokenRequest(
  baseUrl: string,
  params: Record<string, string>,
  fetcher: Fetch
): Promise<TokenSet> {
  const response = await fetcher(`${baseUrl}/oauth/token`, {
    method: 'POST',
    headers: { Accept: 'application/json', 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams(params).toString(),
  })
  if (!response.ok) throw await errorOf(response)
  return (await response.json()) as TokenSet
}

export function exchangeCode(
  input: {
    baseUrl: string
    clientId: string
    clientSecret: string
    redirectUri: string
    code: string
    verifier: string
  },
  fetcher: Fetch = fetch
) {
  return tokenRequest(
    input.baseUrl,
    {
      grant_type: 'authorization_code',
      client_id: input.clientId,
      client_secret: input.clientSecret,
      code: input.code,
      redirect_uri: input.redirectUri,
      code_verifier: input.verifier,
    },
    fetcher
  )
}

/** Refresh tokens are single-use: the answer carries the next one, which must be stored. */
export function refreshTokens(
  input: { baseUrl: string; clientId: string; clientSecret: string; refreshToken: string },
  fetcher: Fetch = fetch
) {
  return tokenRequest(
    input.baseUrl,
    {
      grant_type: 'refresh_token',
      client_id: input.clientId,
      client_secret: input.clientSecret,
      refresh_token: input.refreshToken,
    },
    fetcher
  )
}
