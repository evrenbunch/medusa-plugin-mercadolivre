import { Module } from '@medusajs/framework/utils'

import MercadoLivreModuleService from './service'

export const MERCADOLIVRE_MODULE = 'mercadolivre'

export default Module(MERCADOLIVRE_MODULE, {
  service: MercadoLivreModuleService,
})
