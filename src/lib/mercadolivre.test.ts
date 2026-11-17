import { describe, expect, it, vi } from 'vitest'

import { exchangeCode, MercadoLivreClient, MercadoLivreError } from './client'
import { open, seal } from './crypto'
import {
  buildItems,
  fitTitle,
  linkVariations,
  type ListingContext,
  listingQuantity,
  plainDescription,
  sizeRowsOf,
  type SourceProduct,
  stockPriceUpdate,
} from './listing'
import { authorizationUrl, challengeOf, createState, readState, verifierOf } from './oauth'
import { missingCredentials, resolveOptions } from './options'
import {
  documentOf,
  type MlOrderData,
  normalizeShipment,
  orderInput,
  saleKey,
  saleStatus,
} from './sale'

/* eslint-disable-next-line @typescript-eslint/no-explicit-any */
type Body = Record<string, any>

const context: ListingContext = {
  category_id: 'MLB31447',
  listing_type_id: 'gold_special',
  currency: 'BRL',
  settings: {},
  priceAdjustmentPercent: 0,
  stockBuffer: 0,
  unmanagedStock: 20,
  userProducts: false,
  defaultAttributes: [{ id: 'BRAND', value_name: 'Acme' }],
}

const shirt: SourceProduct = {
  id: 'prod_1',
  title: 'Camiseta Respawn',
  description: '<p>Algodão penteado.</p><p>Estampa DTF.</p>',
  images: ['https://cdn.example/a.png', 'https://cdn.example/b.png'],
  variants: [
    {
      id: 'v_pm',
      title: 'Preto / M',
      sku: 'RSP-P-M',
      barcode: null,
      options: { Cor: 'Preto', Tamanho: 'M' },
      price: 89.9,
      available: null,
    },
    {
      id: 'v_pg',
      title: 'Preto / G',
      sku: 'RSP-P-G',
      barcode: null,
      options: { Cor: 'Preto', Tamanho: 'G' },
      price: 99.9,
      available: 3,
    },
  ],
}

describe('crypto', () => {
  it('opens what it sealed and nothing else', () => {
    const sealed = seal('APP_USR-token', 'key')
    expect(sealed).not.toContain('APP_USR')
    expect(open(sealed, 'key')).toBe('APP_USR-token')
    expect(open(sealed, 'other')).toBeNull()
    expect(open(sealed.slice(0, -2) + 'xx', 'key')).toBeNull()
  })
})

describe('oauth', () => {
  it('signs a state that expires and cannot be forged', () => {
    const state = createState('user_1', 'key', 1_000)
    expect(readState(state, 'key', 2_000)?.userId).toBe('user_1')
    expect(readState(state, 'other', 2_000)).toBeNull()
    expect(readState(state, 'key', 1_000 + 11 * 60_000)).toBeNull()
    expect(readState(`${state}x`, 'key', 2_000)).toBeNull()
  })

  it('sends the seller to their site with a PKCE challenge only this backend can answer', () => {
    const state = createState('user_1', 'key')
    const url = new URL(
      authorizationUrl({
        site: 'MLB',
        clientId: '123',
        redirectUri: 'https://shop.example/mercadolivre/oauth/callback',
        state,
        secret: 'key',
      })
    )
    expect(url.host).toBe('auth.mercadolivre.com.br')
    expect(url.searchParams.get('client_id')).toBe('123')
    expect(url.searchParams.get('code_challenge')).toBe(
      challengeOf(verifierOf(readState(state, 'key')!.nonce, 'key'))
    )
  })
})

describe('options', () => {
  it('accepts env strings and reports what is missing', () => {
    const options = resolveOptions({
      dryRun: 'true' as never,
      priceAdjustmentPercent: '15' as never,
    })
    expect(options.dryRun).toBe(true)
    expect(options.priceAdjustmentPercent).toBe(15)
    expect(options.site).toBe('MLB')
    expect(missingCredentials(options)).toEqual([
      'clientId',
      'clientSecret',
      'redirectUri',
      'encryptionKey',
    ])
  })
})

describe('client', () => {
  it('retries a rate limit and surfaces the causes of a refusal', async () => {
    const fetcher = vi
      .fn()
      .mockResolvedValueOnce(new Response('{}', { status: 429 }))
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            message: 'Validation error',
            error: 'validation_error',
            cause: [
              { type: 'error', message: 'The attribute BRAND is required' },
              { type: 'warning', message: 'ignored' },
            ],
          }),
          { status: 400 }
        )
      )
    const client = new MercadoLivreClient('https://api.test', async () => 'tok', fetcher as never)
    const error = await client.post('/items', {}).catch((caught) => caught)
    expect(fetcher).toHaveBeenCalledTimes(2)
    expect(error).toBeInstanceOf(MercadoLivreError)
    expect((error as MercadoLivreError).detail).toBe('The attribute BRAND is required')
    expect(fetcher.mock.calls[0]![1].headers.Authorization).toBe('Bearer tok')
  })

  it('exchanges the code as a form post', async () => {
    const fetcher = vi
      .fn()
      .mockResolvedValue(
        new Response(
          JSON.stringify({ access_token: 'a', refresh_token: 'r', expires_in: 21600, user_id: 1 })
        )
      )
    await exchangeCode(
      {
        baseUrl: 'https://api.test',
        clientId: '1',
        clientSecret: 's',
        redirectUri: 'https://x/cb',
        code: 'c',
        verifier: 'v',
      },
      fetcher as never
    )
    const body = new URLSearchParams(fetcher.mock.calls[0]![1].body)
    expect(body.get('grant_type')).toBe('authorization_code')
    expect(body.get('code_verifier')).toBe('v')
  })
})

describe('listing', () => {
  it('builds one classic item with a variation per variant and a single price', () => {
    const [item, ...rest] = buildItems(shirt, context)
    expect(rest).toHaveLength(0)
    const body = item!.body as Body
    expect(body.title).toBe('Camiseta Respawn')
    expect(body.price).toBe(99.9)
    expect(body.attributes).toEqual([{ id: 'BRAND', value_name: 'Acme' }])
    expect(body.variations).toHaveLength(2)
    expect(body.variations[0]).toMatchObject({
      price: 99.9,
      available_quantity: 20,
      attribute_combinations: [
        { id: 'COLOR', value_name: 'Preto' },
        { id: 'SIZE', value_name: 'M' },
      ],
      attributes: [{ id: 'SELLER_SKU', value_name: 'RSP-P-M' }],
    })
    expect(body.variations[1].available_quantity).toBe(3)
    expect(body.shipping.mode).toBe('me2')
  })

  it('builds one item per variant on the user-products model', () => {
    const items = buildItems(shirt, {
      ...context,
      userProducts: true,
      priceAdjustmentPercent: 10,
      settings: { size_grid_id: '777', size_rows: { M: '777:1' }, manufacturing_days: 5 },
    })
    expect(items.map((item) => item.variant_ids)).toEqual([['v_pm'], ['v_pg']])
    const body = items[0]!.body as Body
    expect(body.family_name).toBe('Camiseta Respawn')
    expect(body.title).toBeUndefined()
    expect(body.variations).toBeUndefined()
    expect(body.price).toBe(98.89)
    expect(body.attributes).toEqual(
      expect.arrayContaining([
        { id: 'COLOR', value_name: 'Preto' },
        { id: 'SIZE', value_name: 'M' },
        { id: 'SIZE_GRID_ID', value_name: '777' },
        { id: 'SIZE_GRID_ROW_ID', value_name: '777:1' },
      ])
    )
    expect(body.sale_terms).toEqual([{ id: 'MANUFACTURING_TIME', value_name: '5 dias' }])
  })

  it('refuses a product that cannot be sold', () => {
    expect(() => buildItems({ ...shirt, images: [] }, context)).toThrow(/images/)
    expect(() =>
      buildItems({ ...shirt, variants: [{ ...shirt.variants[0]!, price: null }] }, context)
    ).toThrow(/no price/)
  })

  it('links variations by their attributes, whatever the order of the answer', () => {
    const [item] = buildItems(shirt, context)
    const links = linkVariations(item!, shirt.variants, [
      {
        id: 2,
        attribute_combinations: [
          { id: 'SIZE', value_name: 'G' },
          { id: 'COLOR', value_name: 'Preto' },
        ],
      },
      {
        id: 1,
        attribute_combinations: [
          { id: 'COLOR', value_name: 'Preto' },
          { id: 'SIZE', value_name: 'M' },
        ],
      },
    ])
    expect(links).toEqual([
      { variant_id: 'v_pm', variation_id: '1', sku: 'RSP-P-M' },
      { variant_id: 'v_pg', variation_id: '2', sku: 'RSP-P-G' },
    ])
  })

  it('sends stock and price only when they changed, and always every variation', () => {
    const links = [
      { variant_id: 'a', variation_id: '1', sku: null },
      { variant_id: 'b', variation_id: '2', sku: null },
    ]
    const pushed = { a: { price: 10, quantity: 5 }, b: { price: 10, quantity: 5 } }
    expect(
      stockPriceUpdate({ links, wanted: pushed, pushed, syncStock: true, syncPrice: true })
    ).toBeNull()
    const update = stockPriceUpdate({
      links,
      wanted: { ...pushed, b: { price: 10, quantity: 4 } },
      pushed,
      syncStock: true,
      syncPrice: false,
    })
    expect(update!.body).toEqual({
      variations: [
        { id: 1, available_quantity: 5 },
        { id: 2, available_quantity: 4 },
      ],
    })
    const single = stockPriceUpdate({
      links: [{ variant_id: 'a', variation_id: null, sku: null }],
      wanted: { a: { price: 12, quantity: 0 } },
      pushed: null,
      syncStock: true,
      syncPrice: true,
    })
    expect(single!.body).toEqual({ price: 12, available_quantity: 0 })
  })

  it('keeps titles within the limit, descriptions plain and quantities sane', () => {
    expect(fitTitle('a'.repeat(30) + ' ' + 'b'.repeat(40)).length).toBeLessThanOrEqual(60)
    expect(plainDescription(shirt.description)).toBe('Algodão penteado.\nEstampa DTF.')
    expect(listingQuantity(2, { stockBuffer: 5, unmanagedStock: 20 })).toBe(0)
    expect(
      sizeRowsOf({ rows: [{ id: '9:1', attributes: [{ id: 'SIZE', values: [{ name: 'M' }] }] }] })
    ).toEqual({ M: '9:1' })
  })
})

describe('sale', () => {
  const order: MlOrderData = {
    id: 2000001,
    status: 'paid',
    currency_id: 'BRL',
    total_amount: 199.8,
    pack_id: null,
    buyer: { id: 9, nickname: 'TESTBUYER', first_name: 'Ana', last_name: 'Souza' },
    shipping: { id: 44 },
    order_items: [
      {
        item: { id: 'MLB1', title: 'Camiseta', variation_id: 2, seller_sku: 'RSP-P-G' },
        quantity: 2,
        unit_price: 99.9,
        sale_fee: 12,
      },
    ],
  }
  const shipment = normalizeShipment({
    id: 44,
    status: 'ready_to_ship',
    mode: 'me2',
    logistic_type: 'drop_off',
    shipping_option: { cost: 21.5, name: 'Normal' },
    receiver_address: {
      street_name: 'Rua das Flores',
      street_number: '120',
      comment: 'Apto 4',
      zip_code: '01310-100',
      city: { name: 'São Paulo' },
      state: { id: 'BR-SP', name: 'São Paulo' },
      country: { id: 'BR' },
      neighborhood: { name: 'Bela Vista' },
      receiver_name: 'Ana Souza',
      receiver_phone: '(11) 99999-0000',
    },
  })
  const base = {
    orders: [order],
    shipment,
    listings: [
      { item_id: 'MLB1', variants: [{ variant_id: 'v_pg', variation_id: '2', sku: null }] },
    ],
    variantBySku: {},
    region_id: 'reg_1',
    sales_channel_id: 'sc_1',
    currency_code: 'BRL',
  }

  it('maps a sale to a Medusa order', () => {
    const input = orderInput({
      ...base,
      document: documentOf({ billing_info: { doc_type: 'CPF', doc_number: '123.456.789-09' } }),
      options: { documentMetadataKey: 'cpf', splitStreetNumber: true },
    })
    expect(input.items).toEqual([
      expect.objectContaining({ variant_id: 'v_pg', quantity: 2, unit_price: 99.9 }),
    ])
    expect(input.shipping_address).toMatchObject({
      first_name: 'Ana',
      last_name: 'Souza',
      address_1: 'Rua das Flores',
      address_2: 'Apto 4',
      province: 'SP',
      postal_code: '01310100',
      country_code: 'br',
      metadata: {
        number: '120',
        neighborhood: 'Bela Vista',
        cpf: '12345678909',
        document_type: 'CPF',
      },
    })
    // Mercado Envios postage is not the seller's money.
    expect(input.shipping_methods).toEqual([{ name: 'Normal', amount: 0 }])
    expect(input.metadata.mercadolivre).toMatchObject({ order_ids: ['2000001'], sale_fee: 24 })
  })

  it('reads the newer billing shape, joins street and number, and falls back to the SKU', () => {
    const input = orderInput({
      ...base,
      listings: [],
      variantBySku: { 'RSP-P-G': 'v_sku' },
      document: documentOf({
        buyer: {
          billing_info: {
            name: 'Ana',
            last_name: 'Souza',
            identification: { type: 'CPF', number: '12345678909' },
          },
        },
      }),
      options: { documentMetadataKey: 'document', splitStreetNumber: false },
    })
    expect(input.items[0]!.variant_id).toBe('v_sku')
    expect(input.shipping_address!.address_1).toBe('Rua das Flores, 120')
    expect(input.shipping_address!.metadata.document).toBe('12345678909')
  })

  it('treats a pack as one sale', () => {
    const second = { ...order, id: 2000002, pack_id: 77, status: 'payment_required' }
    expect(saleKey(second)).toBe('77')
    expect(saleKey(order)).toBe('2000001')
    expect(saleStatus([{ ...order, pack_id: 77 }, second])).toBe('payment_required')
    expect(saleStatus([order, { ...second, status: 'cancelled' }])).toBe('cancelled')
    expect(saleStatus([order])).toBe('paid')
  })
})
