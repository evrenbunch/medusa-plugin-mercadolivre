/** Mercado Livre / Mercado Libre sites: where the seller signs in and the currency listings use. */
export const SITES: Record<
  string,
  { name: string; authHost: string; currency: string; country: string }
> = {
  MLB: { name: 'Brasil', authHost: 'auth.mercadolivre.com.br', currency: 'BRL', country: 'br' },
  MLA: { name: 'Argentina', authHost: 'auth.mercadolibre.com.ar', currency: 'ARS', country: 'ar' },
  MLM: { name: 'México', authHost: 'auth.mercadolibre.com.mx', currency: 'MXN', country: 'mx' },
  MLC: { name: 'Chile', authHost: 'auth.mercadolibre.cl', currency: 'CLP', country: 'cl' },
  MCO: { name: 'Colombia', authHost: 'auth.mercadolibre.com.co', currency: 'COP', country: 'co' },
  MLU: { name: 'Uruguay', authHost: 'auth.mercadolibre.com.uy', currency: 'UYU', country: 'uy' },
  MPE: { name: 'Perú', authHost: 'auth.mercadolibre.com.pe', currency: 'PEN', country: 'pe' },
  MEC: { name: 'Ecuador', authHost: 'auth.mercadolibre.com.ec', currency: 'USD', country: 'ec' },
}

export function siteOf(id: string) {
  const site = SITES[id.toUpperCase()]
  if (!site) throw new Error(`Unknown Mercado Livre site "${id}"`)
  return site
}
