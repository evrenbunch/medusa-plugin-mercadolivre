# medusa-plugin-mercadolivre

Sell your [Medusa v2](https://medusajs.com) catalog on **Mercado Livre / Mercado Libre**.

> 🇧🇷 Plugin para Medusa v2 que publica seus produtos no Mercado Livre, mantém estoque e preço em
> dia e traz as vendas pagas para dentro da loja como pedidos. A tela do admin fica em português
> quando o admin ou o navegador está em português.

- **Connect** a seller account with OAuth (authorization code + PKCE). Tokens are stored encrypted
  and refreshed by themselves.
- **Listings** from your products: category suggestion, the attributes the category requires,
  variations (colour, size…), size charts, made-to-order time. Both listing models are supported:
  classic items with variations, and "user products" (one item per variant).
- **Stock and price sync**, every 15 minutes and right after a store order; only differences are sent.
- **Orders**: a paid Mercado Livre sale (a whole pack as one) becomes a Medusa order in its own
  sales channel, paid, with the buyer's address and document, and stock reserved. Cancellations
  cancel it.
- **Notifications** (webhooks) for orders, shipments and items, with a periodic pull as a safety net.
- **Admin**: a Mercado Livre page (account, listings, sales, shipping labels) and a widget on the
  product page.

It talks to the official API only and has no runtime dependencies besides Medusa.

## Install

```bash
npm install @plexgg/medusa-plugin-mercadolivre
```

```ts
// medusa-config.ts
module.exports = defineConfig({
  // ...
  plugins: [
    {
      resolve: '@plexgg/medusa-plugin-mercadolivre',
      options: {
        clientId: process.env.MERCADOLIVRE_CLIENT_ID,
        clientSecret: process.env.MERCADOLIVRE_CLIENT_SECRET,
        redirectUri: 'https://your-backend.example/mercadolivre/oauth/callback',
        encryptionKey: process.env.MERCADOLIVRE_ENCRYPTION_KEY,
        dryRun: true, // start here: "publish" only validates
      },
    },
  ],
})
```

```bash
npx medusa db:migrate
```

The plugin needs the Redis event bus and locking modules in production, like any Medusa
deployment that splits server and worker.

## The Mercado Livre application

Create an application at <https://developers.mercadolivre.com.br/devcenter> (or your country's
DevCenter) with:

| Setting                    | Value                                                                           |
| -------------------------- | ------------------------------------------------------------------------------- |
| Redirect URI               | `https://your-backend.example/mercadolivre/oauth/callback` (https, exact match) |
| PKCE                       | enabled                                                                         |
| Scopes                     | read, write, offline access                                                     |
| Notifications callback URL | `https://your-backend.example/hooks/mercadolivre`                               |
| Topics                     | `orders_v2`, `shipments`, `items`                                               |

Then open **Mercado Livre** in the Medusa admin and press **Connect**.

## Options

| Option                                | Default                               |                                                                                                                     |
| ------------------------------------- | ------------------------------------- | ------------------------------------------------------------------------------------------------------------------- |
| `clientId`, `clientSecret`            | required                              | App ID and secret key of the application.                                                                           |
| `redirectUri`                         | required                              | Must match the application's redirect URI.                                                                          |
| `encryptionKey`                       | required                              | Secret that encrypts the stored tokens and signs the OAuth state. Changing it means connecting again.               |
| `site`                                | `MLB`                                 | `MLB` Brazil, `MLA` Argentina, `MLM` Mexico, `MLC` Chile, `MCO` Colombia, `MLU` Uruguay, `MPE` Peru, `MEC` Ecuador. |
| `dryRun`                              | `false`                               | `true`: publishing only asks Mercado Livre to validate the listing.                                                 |
| `priceAdjustmentPercent`              | `0`                                   | Added to the store price on every listing; each listing can override it.                                            |
| `stockBuffer`                         | `0`                                   | Units kept back from Mercado Livre per variant.                                                                     |
| `unmanagedStock`                      | `20`                                  | Quantity advertised for variants whose inventory Medusa does not manage.                                            |
| `defaultAttributes`                   | `[]`                                  | Item attributes for every listing, e.g. `[{ id: 'BRAND', value_name: 'Acme' }]`.                                    |
| `salesChannelId` / `salesChannelName` | `"Mercado Livre"`                     | Channel of imported orders. Created by name, and linked to the existing stock locations, when no id is given.       |
| `regionId`                            | first region with the site's currency | Region of imported orders.                                                                                          |
| `importOrders`                        | `true`                                | Create Medusa orders from paid sales.                                                                               |
| `emitOrderPlaced`                     | `true`                                | Emit `order.placed` for imported orders so your own subscribers run.                                                |
| `documentMetadataKey`                 | `document`                            | Shipping-address metadata key for the buyer's CPF/CNPJ digits.                                                      |
| `splitStreetNumber`                   | `false`                               | `true`: `address_1` is the street and the number goes to `metadata.number`.                                         |
| `adminReturnUrl`                      | `/app/mercadolivre`                   | Where the browser lands after connecting.                                                                           |

## How it behaves

**Listings.** A listing starts as a draft on the product page. _Validate_ sends it to
`POST /items/validate`, which creates nothing; _Publish_ creates the item. Prices are the variant's
plain price in the site's currency (no price list, no rule) plus the adjustment. A classic item has
one price, so its variations all take the highest variant price. Product options named Cor/Color,
Tamanho/Size/Talla, Voltagem, Sabor map to Mercado Livre's attributes; set `settings.option_map` on
a listing for other names. Product images must be public URLs.

**Orders.** Mercado Livre does not share the buyer's e-mail, so imported orders have none. The order
carries `metadata.mercadolivre` (order ids, pack, shipment, shipping mode, sale fee) and each line
`metadata.mercadolivre_item_id`. The payment is recorded with Medusa's system provider, because
Mercado Livre holds the money. With Mercado Envios (`me2`) the postage is Mercado Livre's, so the
shipping method is recorded at zero and the buyer's cost kept in the metadata. The event
`mercadolivre.order.imported` (`{ id, mercadolivre_order_id }`) is emitted after each import.

**Shipping.** For Mercado Envios the parcel travels with Mercado Livre's label, downloadable from
the admin; status and tracking are mirrored, and Medusa fulfillments are marked delivered when the
shipment is. For sales you ship yourself, creating a shipment in Medusa reports it to Mercado Livre.

**Notifications** carry no signature, only the path of what changed; the plugin checks the seller
and application ids and then reads the resource from the API with the seller's token.

## Testing without real listings

Mercado Livre has no sandbox. Use `dryRun: true` to validate listings, and **Create test user** in
the admin for test accounts (they trade among themselves, invisible to everyone else): connect one
as the seller, buy with another.

## Not covered yet

Questions and post-sale messages, claims and returns, catalog (buy box) listings, Mercado Envios
Full stock, package dimensions, and invoices (NF-e). Reporting tracking for self-shipped sales
follows the documentation but has not been exercised against a live account.

## Development

```bash
npm install
npm test            # unit tests
npm run build       # medusa plugin:build
npm run db:generate # after changing a model (needs DB_* variables, see Medusa's plugin docs)
```

## License

MIT
