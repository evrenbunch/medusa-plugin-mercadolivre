import { model } from '@medusajs/framework/utils'

/**
 * A Mercado Livre sale and the Medusa order made from it. A cart bought on
 * Mercado Livre is a "pack" of several orders with one shipment, and becomes
 * one Medusa order: `external_key` is the pack id, or the order id when the
 * sale has no pack.
 */
export const MlOrder = model
  .define('ml_order', {
    id: model.id({ prefix: 'mlord' }).primaryKey(),
    external_key: model.text(),
    pack_id: model.text().nullable(),
    /** Mercado Livre order ids in the sale. */
    order_ids: model.json(),
    shipment_id: model.text().nullable(),
    /** The Medusa order; null until the sale is paid and imported. */
    order_id: model.text().nullable(),
    /** Mercado Livre order status: payment_required, paid, cancelled… */
    status: model.text(),
    shipping_status: model.text().nullable(),
    shipping_substatus: model.text().nullable(),
    /** me2, me1, custom, not_specified. */
    shipping_mode: model.text().nullable(),
    /** drop_off, cross_docking, xd_drop_off, self_service, fulfillment… */
    logistic_type: model.text().nullable(),
    tracking_number: model.text().nullable(),
    buyer_nickname: model.text().nullable(),
    total: model.float().nullable(),
    currency_code: model.text().nullable(),
    /** Why it was not imported or could not be updated. Never a buyer document. */
    problem: model.text().nullable(),
    sold_at: model.dateTime().nullable(),
    synced_at: model.dateTime().nullable(),
  })
  .indexes([
    { on: ['external_key'], unique: true },
    { on: ['order_id'] },
    { on: ['shipment_id'] },
    { on: ['status'] },
  ])
