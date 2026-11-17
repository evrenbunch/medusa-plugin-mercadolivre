import { z } from '@medusajs/framework/zod'

const Attribute = z.object({
  id: z.string().trim().max(80).optional(),
  name: z.string().trim().max(80).optional(),
  value_id: z.string().trim().max(80).optional(),
  value_name: z.string().trim().max(255).optional(),
})

export const ListingSettings = z.object({
  attributes: z.array(Attribute).max(80).optional(),
  option_map: z.record(z.string(), z.string().trim().max(80)).optional(),
  size_grid_id: z.string().trim().max(40).optional(),
  manufacturing_days: z.number().int().min(0).max(45).optional(),
  warranty: z
    .object({
      type: z.string().trim().max(80).optional(),
      time: z.string().trim().max(40).optional(),
    })
    .optional(),
  shipping: z
    .object({
      mode: z.enum(['me2', 'me1', 'custom', 'not_specified']).optional(),
      free_shipping: z.boolean().optional(),
      local_pick_up: z.boolean().optional(),
    })
    .optional(),
  condition: z.enum(['new', 'used']).optional(),
  title: z.string().trim().max(120).optional(),
  description: z.string().max(20000).optional(),
})

export const CreateListing = z.object({
  product_id: z.string(),
  category_id: z
    .string()
    .trim()
    .regex(/^[A-Z]{3}\d+$/),
  category_name: z.string().trim().max(200).nullish(),
  listing_type_id: z.string().trim().max(40).optional(),
  price_adjustment_percent: z.number().min(-90).max(500).nullish(),
  settings: ListingSettings.optional(),
})
export type CreateListing = z.infer<typeof CreateListing>

export const UpdateListing = z.object({
  category_id: z
    .string()
    .trim()
    .regex(/^[A-Z]{3}\d+$/)
    .optional(),
  category_name: z.string().trim().max(200).nullish(),
  listing_type_id: z.string().trim().max(40).optional(),
  price_adjustment_percent: z.number().min(-90).max(500).nullish(),
  settings: ListingSettings.optional(),
  sync_stock: z.boolean().optional(),
  sync_price: z.boolean().optional(),
  action: z
    .enum(['validate', 'publish', 'sync', 'refresh', 'content', 'pause', 'activate', 'close'])
    .optional(),
})
export type UpdateListing = z.infer<typeof UpdateListing>

export const OrdersAction = z.object({ action: z.literal('pull') })
