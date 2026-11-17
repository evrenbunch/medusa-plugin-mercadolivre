import { defineMiddlewares, validateAndTransformBody } from '@medusajs/framework/http'

import { CreateListing, OrdersAction, UpdateListing } from './admin/mercadolivre/validators'

export default defineMiddlewares({
  routes: [
    {
      method: ['POST'],
      matcher: '/admin/mercadolivre/listings',
      middlewares: [validateAndTransformBody(CreateListing)],
    },
    {
      method: ['POST'],
      matcher: '/admin/mercadolivre/listings/:id',
      middlewares: [validateAndTransformBody(UpdateListing)],
    },
    {
      method: ['POST'],
      matcher: '/admin/mercadolivre/orders',
      middlewares: [validateAndTransformBody(OrdersAction)],
    },
  ],
})
