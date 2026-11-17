import { model } from '@medusajs/framework/utils'

/**
 * A notification Mercado Livre delivered. It must be acknowledged within
 * 500 ms, so it is stored first and handled afterwards; a failed one is
 * retried by the scheduled job.
 */
export const MlEvent = model
  .define('ml_event', {
    id: model.id({ prefix: 'mlev' }).primaryKey(),
    /** The notification's own `_id`; a repeated delivery is dropped. */
    notification_id: model.text(),
    topic: model.text(),
    resource: model.text(),
    seller_id: model.text().nullable(),
    processed_at: model.dateTime().nullable(),
    tries: model.number().default(0),
    problem: model.text().nullable(),
  })
  .indexes([{ on: ['notification_id'], unique: true }, { on: ['processed_at'] }])
