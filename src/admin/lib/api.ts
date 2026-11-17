/* What the Mercado Livre admin screens share: the API's shapes, a fetch helper and the two languages. */

declare const __BACKEND_URL__: string | undefined

const backend = (
  typeof __BACKEND_URL__ === 'string' && __BACKEND_URL__ !== '/' ? __BACKEND_URL__ : ''
).replace(/\/+$/, '')

export const apiUrl = (path: string) => `${backend}/admin/mercadolivre${path}`

/** The response body, or an Error carrying the API's message. */
export async function api<T>(path: string, init?: { method?: string; body?: unknown }): Promise<T> {
  const response = await fetch(apiUrl(path), {
    method: init?.method ?? 'GET',
    credentials: 'include',
    headers: init?.body === undefined ? undefined : { 'Content-Type': 'application/json' },
    body: init?.body === undefined ? undefined : JSON.stringify(init.body),
  })
  const body = (await response.json().catch(() => ({}))) as T & { message?: string }
  if (!response.ok) throw new Error(body.message || `HTTP ${response.status}`)
  return body
}

/**
 * Portuguese when the admin's language (i18next keeps it in localStorage) or,
 * while that is still the default English, the browser's is Portuguese.
 */
function isPortuguese(): boolean {
  const browser = typeof navigator === 'undefined' ? '' : navigator.language
  let chosen = ''
  try {
    chosen = localStorage.getItem('lng') ?? ''
  } catch {
    // Storage blocked: the browser's language decides.
  }
  const pt = (value: string) => value.toLowerCase().startsWith('pt')
  return pt(chosen) || ((!chosen || chosen.startsWith('en')) && pt(browser))
}

const portuguese = isPortuguese()

/** English for everyone, Portuguese for an admin or browser set to it. */
export const tr = (en: string, pt: string) => (portuguese ? pt : en)

export type Status = {
  missing: string[]
  site: string
  dry_run: boolean
  import_orders: boolean
  redirect_uri: string | null
  account: {
    seller_id: string
    nickname: string | null
    site_id: string
    user_products: boolean
    problem: string | null
  } | null
  counts: { listings: number; orders: number; orders_not_imported: number }
}

export type Listing = {
  id: string
  product_id: string
  product_title: string | null
  variant_titles: (string | null)[]
  item_id: string | null
  permalink: string | null
  status: string
  external_status: string | null
  category_id: string
  category_name: string | null
  listing_type_id: string
  price_adjustment_percent: number | null
  settings: {
    attributes?: { id?: string; value_name?: string; value_id?: string }[]
    size_grid_id?: string
    manufacturing_days?: number
  } | null
  sync_stock: boolean
  sync_price: boolean
  problem: string | null
  synced_at: string | null
}

export type Sale = {
  id: string
  external_key: string
  order_ids: string[]
  order_id: string | null
  order_display_id: number | null
  shipment_id: string | null
  status: string
  shipping_status: string | null
  shipping_mode: string | null
  tracking_number: string | null
  buyer_nickname: string | null
  total: number | null
  currency_code: string | null
  problem: string | null
  sold_at: string | null
}

type Color = 'green' | 'orange' | 'grey' | 'red' | 'blue' | 'purple'

export const LISTING_STATUS: Record<string, { label: string; color: Color }> = {
  draft: { label: tr('Draft', 'Rascunho'), color: 'grey' },
  active: { label: tr('Active', 'Ativo'), color: 'green' },
  paused: { label: tr('Paused', 'Pausado'), color: 'orange' },
  closed: { label: tr('Closed', 'Finalizado'), color: 'grey' },
  under_review: { label: tr('Under review', 'Em revisão'), color: 'purple' },
  inactive: { label: tr('Inactive', 'Inativo'), color: 'orange' },
  error: { label: tr('Needs attention', 'Precisa de atenção'), color: 'red' },
}

export const SALE_STATUS: Record<string, { label: string; color: Color }> = {
  paid: { label: tr('Paid', 'Pago'), color: 'green' },
  payment_required: { label: tr('Awaiting payment', 'Aguardando pagamento'), color: 'orange' },
  payment_in_process: { label: tr('Payment in process', 'Pagamento em análise'), color: 'orange' },
  confirmed: { label: tr('Confirmed', 'Confirmado'), color: 'blue' },
  cancelled: { label: tr('Cancelled', 'Cancelado'), color: 'grey' },
}

export const SHIPPING_STATUS: Record<string, string> = {
  pending: tr('Pending', 'Pendente'),
  handling: tr('Preparing', 'Em preparação'),
  ready_to_ship: tr('Ready to ship', 'Pronto para enviar'),
  shipped: tr('Shipped', 'Enviado'),
  delivered: tr('Delivered', 'Entregue'),
  not_delivered: tr('Not delivered', 'Não entregue'),
  cancelled: tr('Cancelled', 'Cancelado'),
}

export const money = (amount: number | null, currency: string | null) =>
  amount === null
    ? '—'
    : amount.toLocaleString(portuguese ? 'pt-BR' : undefined, {
        style: 'currency',
        currency: currency ?? 'BRL',
      })
