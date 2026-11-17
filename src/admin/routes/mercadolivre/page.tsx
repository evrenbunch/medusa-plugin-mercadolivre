import { defineRouteConfig } from '@medusajs/admin-sdk'
import { ShoppingBag } from '@medusajs/icons'
import { Badge, Button, Container, Heading, Table, Text, toast, usePrompt } from '@medusajs/ui'
import { useCallback, useEffect, useState } from 'react'
import { Link } from 'react-router-dom'

import {
  api,
  apiUrl,
  type Listing,
  LISTING_STATUS,
  money,
  type Sale,
  SALE_STATUS,
  SHIPPING_STATUS,
  type Status,
  tr,
} from '../../lib/api'

const RETURN_ERRORS: Record<string, string> = {
  denied: tr(
    'The authorization was refused at Mercado Livre.',
    'A autorização foi recusada no Mercado Livre.'
  ),
  invalid_state: tr(
    'The connection attempt expired. Try again.',
    'A tentativa de conexão expirou. Tente de novo.'
  ),
  wrong_site: tr('That account belongs to another country.', 'Essa conta é de outro país.'),
  exchange_failed: tr(
    'Mercado Livre did not accept the authorization. Check the app ID, secret and redirect URI.',
    'O Mercado Livre não aceitou a autorização. Confira o App ID, a chave secreta e a URI de redirecionamento.'
  ),
  not_configured: tr('The plugin is not configured.', 'O plugin não está configurado.'),
}

/**
 * Mercado Livre at a glance: the connected account, every listing with what
 * is holding it, and the sales with their Medusa orders. Listings are created
 * on each product's page.
 */
const MercadoLivrePage = () => {
  const prompt = usePrompt()
  const [status, setStatus] = useState<Status | null>(null)
  const [listings, setListings] = useState<Listing[]>([])
  const [sales, setSales] = useState<Sale[]>([])
  const [busy, setBusy] = useState<string | null>(null)
  const [testUser, setTestUser] = useState<{ nickname: string; password: string } | null>(null)

  const load = useCallback(async () => {
    try {
      setStatus(await api<Status>(''))
      setListings((await api<{ listings: Listing[] }>('/listings?limit=100')).listings)
      setSales((await api<{ orders: Sale[] }>('/orders?limit=100')).orders)
    } catch (error) {
      toast.error((error as Error).message)
    }
  }, [])

  useEffect(() => {
    const params = new URLSearchParams(window.location.search)
    const error = params.get('error')
    if (params.get('connected')) toast.success(tr('Account connected', 'Conta conectada'))
    if (error) toast.error(RETURN_ERRORS[error] ?? error)
    void load()
  }, [load])

  async function run(key: string, job: () => Promise<string | void>) {
    setBusy(key)
    try {
      const message = await job()
      if (message) toast.success(message)
      await load()
    } catch (error) {
      toast.error((error as Error).message)
    } finally {
      setBusy(null)
    }
  }

  const connect = () =>
    run('connect', async () => {
      const { url } = await api<{ url: string }>('/connect', { method: 'POST' })
      window.location.assign(url)
    })

  const disconnect = async () => {
    const yes = await prompt({
      title: tr('Disconnect the account?', 'Desconectar a conta?'),
      description: tr(
        'Listings stay live at Mercado Livre but stop being synced, and new sales stop arriving.',
        'Os anúncios continuam no ar no Mercado Livre, mas param de sincronizar, e as vendas novas param de chegar.'
      ),
      confirmText: tr('Disconnect', 'Desconectar'),
      cancelText: tr('Cancel', 'Cancelar'),
    })
    if (yes) await run('disconnect', async () => void (await api('', { method: 'DELETE' })))
  }

  const account = status?.account
  const origin = window.location.origin

  return (
    <div className="grid gap-4">
      <Container className="divide-y p-0">
        <div className="flex items-center justify-between gap-4 px-6 py-4">
          <div>
            <Heading level="h1">Mercado Livre</Heading>
            <Text size="small" className="text-ui-fg-subtle">
              {tr(
                'Listings are created on each product page',
                'Os anúncios são criados na página de cada produto'
              )}
            </Text>
          </div>
          <div className="flex items-center gap-2">
            {status?.dry_run && (
              <Badge color="orange" size="2xsmall">
                {tr('Dry run: nothing is published', 'Modo de teste: nada é publicado')}
              </Badge>
            )}
            {account ? (
              <Badge color={account.problem ? 'red' : 'green'} size="2xsmall">
                {account.nickname ?? account.seller_id}
              </Badge>
            ) : (
              <Badge color="grey" size="2xsmall">
                {tr('Not connected', 'Não conectada')}
              </Badge>
            )}
          </div>
        </div>
        <div className="grid gap-3 px-6 py-4">
          {status && status.missing.length > 0 && (
            <Text size="small" className="text-ui-fg-error">
              {tr('Missing plugin options: ', 'Faltam opções do plugin: ')}
              {status.missing.join(', ')}
            </Text>
          )}
          {account?.problem && (
            <Text size="small" className="text-ui-fg-error">
              {account.problem}
            </Text>
          )}
          {status && (
            <Text size="small" className="text-ui-fg-subtle">
              {tr(
                'In your Mercado Livre application, the redirect URI is ',
                'Na sua aplicação do Mercado Livre, a URI de redirecionamento é '
              )}
              <code>{status.redirect_uri ?? `${origin}/mercadolivre/oauth/callback`}</code>
              {tr(' and the notifications URL is ', ' e a URL de notificações é ')}
              <code>{`${(status.redirect_uri ?? origin).replace(/\/mercadolivre\/oauth\/callback$/, '')}/hooks/mercadolivre`}</code>
              {tr(
                ' (topics orders_v2, shipments, items).',
                ' (tópicos orders_v2, shipments, items).'
              )}
            </Text>
          )}
          <div className="flex flex-wrap gap-2">
            {account ? (
              <>
                <Button
                  size="small"
                  variant="secondary"
                  isLoading={busy === 'sync'}
                  onClick={() =>
                    run('sync', async () => {
                      const result = await api<{ checked: number; updated: number }>('/sync', {
                        method: 'POST',
                      })
                      return tr(
                        `${result.updated} of ${result.checked} listings updated`,
                        `${result.updated} de ${result.checked} anúncios atualizados`
                      )
                    })
                  }
                >
                  {tr('Sync stock and prices', 'Sincronizar estoque e preços')}
                </Button>
                <Button
                  size="small"
                  variant="secondary"
                  isLoading={busy === 'pull'}
                  onClick={() =>
                    run('pull', async () => {
                      await api('/orders', { method: 'POST', body: { action: 'pull' } })
                      return tr('Sales read from Mercado Livre', 'Vendas lidas do Mercado Livre')
                    })
                  }
                >
                  {tr('Fetch sales', 'Buscar vendas')}
                </Button>
                <Button
                  size="small"
                  variant="secondary"
                  isLoading={busy === 'test-user'}
                  onClick={() =>
                    run('test-user', async () => {
                      const result = await api<{
                        test_user: { nickname: string; password: string }
                      }>('/test-user', { method: 'POST' })
                      setTestUser(result.test_user)
                    })
                  }
                >
                  {tr('Create test user', 'Criar usuário de teste')}
                </Button>
                <Button
                  size="small"
                  variant="secondary"
                  isLoading={busy === 'connect'}
                  onClick={connect}
                >
                  {tr('Reconnect', 'Reconectar')}
                </Button>
                <Button size="small" variant="danger" onClick={disconnect}>
                  {tr('Disconnect', 'Desconectar')}
                </Button>
              </>
            ) : (
              <Button
                size="small"
                isLoading={busy === 'connect'}
                disabled={!status || status.missing.length > 0}
                onClick={connect}
              >
                {tr('Connect Mercado Livre account', 'Conectar conta do Mercado Livre')}
              </Button>
            )}
          </div>
          {testUser && (
            <Text size="small">
              {tr(
                'Test user (the password is shown only now): ',
                'Usuário de teste (a senha só aparece agora): '
              )}
              <code>{testUser.nickname}</code> / <code>{testUser.password}</code>
            </Text>
          )}
        </div>
      </Container>

      <Container className="divide-y p-0">
        <div className="px-6 py-4">
          <Heading level="h2">{tr('Listings', 'Anúncios')}</Heading>
        </div>
        {listings.length === 0 ? (
          <Text size="small" className="text-ui-fg-subtle px-6 py-4">
            {tr('No listings yet.', 'Nenhum anúncio ainda.')}
          </Text>
        ) : (
          <Table>
            <Table.Header>
              <Table.Row>
                <Table.HeaderCell>{tr('Product', 'Produto')}</Table.HeaderCell>
                <Table.HeaderCell>{tr('Variants', 'Variantes')}</Table.HeaderCell>
                <Table.HeaderCell>Status</Table.HeaderCell>
                <Table.HeaderCell>{tr('Listing', 'Anúncio')}</Table.HeaderCell>
                <Table.HeaderCell>{tr('Pending issue', 'Pendência')}</Table.HeaderCell>
              </Table.Row>
            </Table.Header>
            <Table.Body>
              {listings.map((listing) => {
                const state = LISTING_STATUS[listing.status] ?? LISTING_STATUS.error!
                return (
                  <Table.Row key={listing.id}>
                    <Table.Cell>
                      <Link
                        to={`/products/${listing.product_id}`}
                        className="text-ui-fg-interactive"
                      >
                        {listing.product_title ?? listing.product_id}
                      </Link>
                    </Table.Cell>
                    <Table.Cell>
                      {listing.variant_titles.length > 3
                        ? `${listing.variant_titles.length}`
                        : listing.variant_titles.filter(Boolean).join(', ')}
                    </Table.Cell>
                    <Table.Cell>
                      <Badge color={state.color} size="2xsmall">
                        {state.label}
                      </Badge>
                    </Table.Cell>
                    <Table.Cell>
                      {listing.permalink ? (
                        <a
                          href={listing.permalink}
                          target="_blank"
                          rel="noreferrer"
                          className="text-ui-fg-interactive"
                        >
                          {listing.item_id}
                        </a>
                      ) : (
                        (listing.item_id ?? '—')
                      )}
                    </Table.Cell>
                    <Table.Cell className="text-ui-fg-error max-w-[320px] truncate">
                      {listing.problem ?? ''}
                    </Table.Cell>
                  </Table.Row>
                )
              })}
            </Table.Body>
          </Table>
        )}
      </Container>

      <Container className="divide-y p-0">
        <div className="px-6 py-4">
          <Heading level="h2">{tr('Sales', 'Vendas')}</Heading>
          {status && status.counts.orders_not_imported > 0 && (
            <Text size="small" className="text-ui-fg-error">
              {tr(
                `${status.counts.orders_not_imported} paid sales are not in the store yet`,
                `${status.counts.orders_not_imported} vendas pagas ainda não entraram na loja`
              )}
            </Text>
          )}
        </div>
        {sales.length === 0 ? (
          <Text size="small" className="text-ui-fg-subtle px-6 py-4">
            {tr('No sales yet.', 'Nenhuma venda ainda.')}
          </Text>
        ) : (
          <Table>
            <Table.Header>
              <Table.Row>
                <Table.HeaderCell>{tr('Sale', 'Venda')}</Table.HeaderCell>
                <Table.HeaderCell>{tr('Buyer', 'Comprador')}</Table.HeaderCell>
                <Table.HeaderCell>Total</Table.HeaderCell>
                <Table.HeaderCell>Status</Table.HeaderCell>
                <Table.HeaderCell>{tr('Shipping', 'Envio')}</Table.HeaderCell>
                <Table.HeaderCell>{tr('Store order', 'Pedido na loja')}</Table.HeaderCell>
                <Table.HeaderCell />
              </Table.Row>
            </Table.Header>
            <Table.Body>
              {sales.map((sale) => {
                const state = SALE_STATUS[sale.status] ?? {
                  label: sale.status,
                  color: 'grey' as const,
                }
                return (
                  <Table.Row key={sale.id}>
                    <Table.Cell>{sale.external_key}</Table.Cell>
                    <Table.Cell>{sale.buyer_nickname ?? '—'}</Table.Cell>
                    <Table.Cell>{money(sale.total, sale.currency_code)}</Table.Cell>
                    <Table.Cell>
                      <Badge color={state.color} size="2xsmall">
                        {state.label}
                      </Badge>
                    </Table.Cell>
                    <Table.Cell>
                      {sale.shipping_status
                        ? (SHIPPING_STATUS[sale.shipping_status] ?? sale.shipping_status)
                        : '—'}
                      {sale.tracking_number ? ` · ${sale.tracking_number}` : ''}
                    </Table.Cell>
                    <Table.Cell>
                      {sale.order_id ? (
                        <Link to={`/orders/${sale.order_id}`} className="text-ui-fg-interactive">
                          #{sale.order_display_id ?? sale.order_id}
                        </Link>
                      ) : (
                        <span className="text-ui-fg-error">{sale.problem ?? '—'}</span>
                      )}
                    </Table.Cell>
                    <Table.Cell>
                      <div className="flex justify-end gap-2">
                        {sale.shipment_id && sale.shipping_mode === 'me2' && (
                          <a
                            href={apiUrl(`/orders/${sale.id}/label`)}
                            target="_blank"
                            rel="noreferrer"
                          >
                            <Button size="small" variant="secondary">
                              {tr('Label', 'Etiqueta')}
                            </Button>
                          </a>
                        )}
                        <Button
                          size="small"
                          variant="secondary"
                          isLoading={busy === sale.id}
                          onClick={() =>
                            run(
                              sale.id,
                              async () => void (await api(`/orders/${sale.id}`, { method: 'POST' }))
                            )
                          }
                        >
                          {tr('Refresh', 'Atualizar')}
                        </Button>
                      </div>
                    </Table.Cell>
                  </Table.Row>
                )
              })}
            </Table.Body>
          </Table>
        )}
      </Container>
    </div>
  )
}

export const config = defineRouteConfig({ label: 'Mercado Livre', icon: ShoppingBag })

export default MercadoLivrePage
