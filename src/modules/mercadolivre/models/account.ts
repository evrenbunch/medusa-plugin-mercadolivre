import { model } from '@medusajs/framework/utils'

/**
 * The connected seller account. One row: a store sells from one Mercado Livre
 * account per site. Both tokens are sealed (lib/crypto.ts).
 */
export const MlAccount = model
  .define('ml_account', {
    id: model.id({ prefix: 'mlacc' }).primaryKey(),
    /** Mercado Livre user id. */
    seller_id: model.text(),
    nickname: model.text().nullable(),
    site_id: model.text(),
    access_token: model.text(),
    refresh_token: model.text(),
    expires_at: model.dateTime(),
    /**
     * Sellers on the "user products" model publish one item per variant
     * (`family_name`, no `variations`); Mercado Livre flags them with a tag.
     */
    user_products: model.boolean().default(false),
    /** Admin user who connected it. */
    connected_by: model.text().nullable(),
    /** Set when a refresh is refused: the seller has to connect again. */
    problem: model.text().nullable(),
  })
  .indexes([{ on: ['seller_id'], unique: true }])
