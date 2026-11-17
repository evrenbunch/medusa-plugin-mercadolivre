import { defineWidgetConfig } from '@medusajs/admin-sdk'
import type { AdminProduct, DetailWidgetProps } from '@medusajs/framework/types'
import {
  Badge,
  Button,
  Container,
  Heading,
  Input,
  Label,
  Select,
  Text,
  toast,
  usePrompt,
} from '@medusajs/ui'
import { useCallback, useEffect, useState } from 'react'

import { api, type Listing, LISTING_STATUS, type Status, tr } from '../lib/api'

type Category = { id: string; name: string; domain_name: string | null }
type ListingType = { id: string; name: string }
type Attribute = {
  id: string
  name: string
  required: boolean
  varies: boolean
  hint: string | null
  values: { id: string; name: string }[]
}
type Result = { ok: boolean; dry_run: boolean; problem: string | null } | null

/** Attributes the product's variants or the plugin fill by themselves. */
const AUTOMATIC = new Set([
  'SELLER_SKU',
  'GTIN',
  'SIZE_GRID_ID',
  'SIZE_GRID_ROW_ID',
  'COLOR',
  'SIZE',
])
const FREE_TEXT = '__other__'

/**
 * A product's Mercado Livre listings: prepare one (category, listing type,
 * the attributes the category requires), ask Mercado Livre to validate it,
 * publish, pause and close.
 */
const ProductMercadoLivreWidget = ({ data: product }: DetailWidgetProps<AdminProduct>) => {
  const prompt = usePrompt()
  const [status, setStatus] = useState<Status | null>(null)
  const [listings, setListings] = useState<Listing[]>([])
  const [busy, setBusy] = useState<string | null>(null)
  const [open, setOpen] = useState(false)
  const [search, setSearch] = useState(product.title ?? '')
  const [categories, setCategories] = useState<Category[]>([])
  const [types, setTypes] = useState<ListingType[]>([])
  const [category, setCategory] = useState<Category | null>(null)
  const [attributes, setAttributes] = useState<Attribute[]>([])
  const [values, setValues] = useState<Record<string, string>>({})
  const [custom, setCustom] = useState<Record<string, boolean>>({})
  const [type, setType] = useState('gold_special')
  const [adjustment, setAdjustment] = useState('')
  const [days, setDays] = useState('')
  const [sizeChart, setSizeChart] = useState('')

  const load = useCallback(async () => {
    try {
      const current = await api<Status>('')
      setStatus(current)
      if (current.account) {
        const result = await api<{ listings: Listing[] }>(
          `/listings?product_id=${encodeURIComponent(product.id)}`
        )
        setListings(result.listings)
      }
    } catch {
      setStatus(null)
    }
  }, [product.id])

  useEffect(() => void load(), [load])

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

  const findCategories = () =>
    run('categories', async () => {
      const result = await api<{ categories: Category[]; listing_types: ListingType[] }>(
        `/categories?q=${encodeURIComponent(search)}`
      )
      setCategories(result.categories)
      setTypes(result.listing_types)
      if (!result.categories.length) {
        toast.info(
          tr('No category found for that title', 'Nenhuma categoria encontrada para esse título')
        )
      }
    })

  const pickCategory = (id: string) =>
    run('attributes', async () => {
      const picked = categories.find((candidate) => candidate.id === id) ?? null
      setCategory(picked)
      if (!picked) return
      const result = await api<{ attributes: Attribute[] }>(`/categories/${id}`)
      setAttributes(
        result.attributes.filter((attribute) => attribute.required && !AUTOMATIC.has(attribute.id))
      )
      setValues({})
      setCustom({})
    })

  const act = (listing: Listing, action: string, done?: string) =>
    run(`${listing.id}:${action}`, async () => {
      const { result } = await api<{ result: Result }>(`/listings/${listing.id}`, {
        method: 'POST',
        body: { action },
      })
      if (result && 'ok' in result) {
        if (!result.ok) throw new Error(result.problem ?? tr('Refused', 'Recusado'))
        return result.dry_run
          ? tr('Mercado Livre accepts this listing', 'O Mercado Livre aceita este anúncio')
          : tr('Published', 'Publicado')
      }
      return done
    })

  const create = () =>
    run('create', async () => {
      if (!category) return
      await api('/listings', {
        method: 'POST',
        body: {
          product_id: product.id,
          category_id: category.id,
          category_name: category.name,
          listing_type_id: type,
          price_adjustment_percent: adjustment.trim() ? Number(adjustment.replace(',', '.')) : null,
          settings: {
            attributes: Object.entries(values)
              .filter(([, value]) => value.trim())
              .map(([id, value]) => ({ id, value_name: value.trim() })),
            ...(sizeChart.trim() ? { size_grid_id: sizeChart.trim() } : {}),
            ...(days.trim() ? { manufacturing_days: Number(days) } : {}),
          },
        },
      })
      setOpen(false)
      return tr(
        'Draft created. Validate it before publishing.',
        'Rascunho criado. Valide antes de publicar.'
      )
    })

  const close = async (listing: Listing) => {
    const yes = await prompt({
      title: tr('Close this listing?', 'Finalizar este anúncio?'),
      description: tr(
        'A closed listing cannot be reopened at Mercado Livre; its sales history stays there.',
        'Um anúncio finalizado não pode ser reaberto no Mercado Livre; o histórico de vendas fica lá.'
      ),
      confirmText: tr('Close', 'Finalizar'),
      cancelText: tr('Cancel', 'Cancelar'),
    })
    if (yes) await act(listing, 'close', tr('Closed', 'Finalizado'))
  }

  if (!status?.account) {
    return (
      <Container className="px-6 py-4">
        <Heading level="h2">Mercado Livre</Heading>
        <Text size="small" className="text-ui-fg-subtle">
          {tr(
            'Connect an account on the Mercado Livre page to list this product.',
            'Conecte uma conta na página Mercado Livre para anunciar este produto.'
          )}
        </Text>
      </Container>
    )
  }

  return (
    <Container className="divide-y p-0">
      <div className="flex items-center justify-between px-6 py-4">
        <div>
          <Heading level="h2">Mercado Livre</Heading>
          {status.dry_run && (
            <Text size="small" className="text-ui-fg-subtle">
              {tr(
                'Dry run: "Publish" only validates, nothing goes live.',
                'Modo de teste: "Publicar" só valida, nada vai ao ar.'
              )}
            </Text>
          )}
        </div>
        {!open && (
          <Button size="small" variant="secondary" onClick={() => setOpen(true)}>
            {tr('Prepare listing', 'Preparar anúncio')}
          </Button>
        )}
      </div>

      {listings.map((listing) => {
        const state = LISTING_STATUS[listing.status] ?? LISTING_STATUS.error!
        const key = (action: string) => `${listing.id}:${action}`
        return (
          <div key={listing.id} className="grid gap-2 px-6 py-4">
            <div className="flex flex-wrap items-center gap-2">
              <Badge color={state.color} size="2xsmall">
                {state.label}
              </Badge>
              <Text size="small" weight="plus">
                {listing.variant_titles.filter(Boolean).join(', ')}
              </Text>
              <Text size="small" className="text-ui-fg-subtle">
                {listing.category_name ?? listing.category_id}
              </Text>
              {listing.permalink && (
                <a
                  href={listing.permalink}
                  target="_blank"
                  rel="noreferrer"
                  className="text-ui-fg-interactive text-sm"
                >
                  {listing.item_id}
                </a>
              )}
            </div>
            {listing.problem && (
              <Text size="small" className="text-ui-fg-error">
                {listing.problem}
              </Text>
            )}
            <div className="flex flex-wrap gap-2">
              {!listing.item_id && (
                <>
                  <Button
                    size="small"
                    variant="secondary"
                    isLoading={busy === key('validate')}
                    onClick={() => act(listing, 'validate')}
                  >
                    {tr('Validate', 'Validar')}
                  </Button>
                  <Button
                    size="small"
                    isLoading={busy === key('publish')}
                    onClick={() => act(listing, 'publish')}
                  >
                    {tr('Publish', 'Publicar')}
                  </Button>
                </>
              )}
              {listing.item_id && listing.status !== 'closed' && (
                <>
                  <Button
                    size="small"
                    variant="secondary"
                    isLoading={busy === key('sync')}
                    onClick={() =>
                      act(listing, 'sync', tr('Stock and price sent', 'Estoque e preço enviados'))
                    }
                  >
                    {tr('Sync', 'Sincronizar')}
                  </Button>
                  <Button
                    size="small"
                    variant="secondary"
                    isLoading={busy === key('content')}
                    onClick={() =>
                      act(listing, 'content', tr('Photos and text sent', 'Fotos e texto enviados'))
                    }
                  >
                    {tr('Update photos and text', 'Atualizar fotos e texto')}
                  </Button>
                  {listing.status === 'paused' ? (
                    <Button
                      size="small"
                      variant="secondary"
                      isLoading={busy === key('activate')}
                      onClick={() => act(listing, 'activate', tr('Reactivated', 'Reativado'))}
                    >
                      {tr('Reactivate', 'Reativar')}
                    </Button>
                  ) : (
                    <Button
                      size="small"
                      variant="secondary"
                      isLoading={busy === key('pause')}
                      onClick={() => act(listing, 'pause', tr('Paused', 'Pausado'))}
                    >
                      {tr('Pause', 'Pausar')}
                    </Button>
                  )}
                  <Button size="small" variant="danger" onClick={() => close(listing)}>
                    {tr('Close', 'Finalizar')}
                  </Button>
                </>
              )}
              {(!listing.item_id || ['closed', 'error'].includes(listing.status)) && (
                <Button
                  size="small"
                  variant="transparent"
                  isLoading={busy === key('delete')}
                  onClick={() =>
                    run(
                      key('delete'),
                      async () => void (await api(`/listings/${listing.id}`, { method: 'DELETE' }))
                    )
                  }
                >
                  {tr('Remove', 'Remover')}
                </Button>
              )}
            </div>
          </div>
        )
      })}

      {listings.length === 0 && !open && (
        <Text size="small" className="text-ui-fg-subtle px-6 py-4">
          {tr('This product is not on Mercado Livre.', 'Este produto não está no Mercado Livre.')}
        </Text>
      )}

      {open && (
        <div className="grid gap-4 px-6 py-4">
          <div className="grid gap-2">
            <Label size="small">
              {tr('Find the category by title', 'Buscar a categoria pelo título')}
            </Label>
            <div className="flex gap-2">
              <Input
                size="small"
                value={search}
                onChange={(event) => setSearch(event.target.value)}
              />
              <Button
                size="small"
                variant="secondary"
                isLoading={busy === 'categories'}
                onClick={findCategories}
              >
                {tr('Search', 'Buscar')}
              </Button>
            </div>
          </div>
          {categories.length > 0 && (
            <div className="grid gap-4 md:grid-cols-2">
              <div className="grid gap-2">
                <Label size="small">{tr('Category', 'Categoria')}</Label>
                <Select size="small" value={category?.id ?? ''} onValueChange={pickCategory}>
                  <Select.Trigger>
                    <Select.Value placeholder={tr('Choose', 'Escolha')} />
                  </Select.Trigger>
                  <Select.Content>
                    {categories.map((candidate) => (
                      <Select.Item key={candidate.id} value={candidate.id}>
                        {candidate.name}
                      </Select.Item>
                    ))}
                  </Select.Content>
                </Select>
              </div>
              <div className="grid gap-2">
                <Label size="small">{tr('Listing type', 'Tipo de anúncio')}</Label>
                <Select size="small" value={type} onValueChange={setType}>
                  <Select.Trigger>
                    <Select.Value />
                  </Select.Trigger>
                  <Select.Content>
                    {types.map((candidate) => (
                      <Select.Item key={candidate.id} value={candidate.id}>
                        {candidate.name}
                      </Select.Item>
                    ))}
                  </Select.Content>
                </Select>
              </div>
            </div>
          )}
          {category && (
            <>
              {attributes.length > 0 && (
                <div className="grid gap-4 md:grid-cols-2">
                  {attributes.map((attribute) => (
                    <div key={attribute.id} className="grid gap-2">
                      <Label size="small">{attribute.name}</Label>
                      {attribute.values.length > 0 && !custom[attribute.id] ? (
                        <Select
                          size="small"
                          value={values[attribute.id] ?? ''}
                          onValueChange={(value) =>
                            value === FREE_TEXT
                              ? setCustom((current) => ({ ...current, [attribute.id]: true }))
                              : setValues((current) => ({ ...current, [attribute.id]: value }))
                          }
                        >
                          <Select.Trigger>
                            <Select.Value placeholder={tr('Choose', 'Escolha')} />
                          </Select.Trigger>
                          <Select.Content>
                            {attribute.values.map((value) => (
                              <Select.Item key={value.id} value={value.name}>
                                {value.name}
                              </Select.Item>
                            ))}
                            <Select.Item value={FREE_TEXT}>{tr('Other…', 'Outro…')}</Select.Item>
                          </Select.Content>
                        </Select>
                      ) : (
                        <Input
                          size="small"
                          placeholder={attribute.hint ?? ''}
                          value={values[attribute.id] ?? ''}
                          onChange={(event) =>
                            setValues((current) => ({
                              ...current,
                              [attribute.id]: event.target.value,
                            }))
                          }
                        />
                      )}
                    </div>
                  ))}
                </div>
              )}
              <div className="grid gap-4 md:grid-cols-3">
                <div className="grid gap-2">
                  <Label size="small">{tr('Price adjustment (%)', 'Ajuste de preço (%)')}</Label>
                  <Input
                    size="small"
                    inputMode="decimal"
                    placeholder={tr('store default', 'padrão da loja')}
                    value={adjustment}
                    onChange={(event) => setAdjustment(event.target.value)}
                  />
                </div>
                <div className="grid gap-2">
                  <Label size="small">{tr('Days to make it', 'Dias para produzir')}</Label>
                  <Input
                    size="small"
                    inputMode="numeric"
                    placeholder={tr('none (in stock)', 'nenhum (pronta entrega)')}
                    value={days}
                    onChange={(event) => setDays(event.target.value.replace(/\D/g, ''))}
                  />
                </div>
                <div className="grid gap-2">
                  <Label size="small">{tr('Size chart ID', 'ID da tabela de medidas')}</Label>
                  <Input
                    size="small"
                    placeholder={tr('clothing only', 'só para roupas')}
                    value={sizeChart}
                    onChange={(event) => setSizeChart(event.target.value)}
                  />
                </div>
              </div>
            </>
          )}
          <div className="flex justify-end gap-2">
            <Button size="small" variant="secondary" onClick={() => setOpen(false)}>
              {tr('Cancel', 'Cancelar')}
            </Button>
            <Button
              size="small"
              disabled={!category}
              isLoading={busy === 'create'}
              onClick={create}
            >
              {tr('Create draft', 'Criar rascunho')}
            </Button>
          </div>
        </div>
      )}
    </Container>
  )
}

export const config = defineWidgetConfig({ zone: 'product.details.after' })

export default ProductMercadoLivreWidget
