import type { AuthenticatedMedusaRequest, MedusaResponse } from '@medusajs/framework/http'

import { sessionOf } from '../../../../../lib/session'

interface CategoryAttribute {
  id: string
  name: string
  value_type?: string
  tags?: Record<string, unknown>
  values?: { id: string; name: string }[]
  hint?: string
}

/**
 * The attributes a category asks for. Only those a person fills are returned:
 * read-only ones and those that vary per variant come from the product.
 */
export async function GET(req: AuthenticatedMedusaRequest, res: MedusaResponse) {
  const session = await sessionOf(req.scope)
  const id = req.params.id!
  const [category, attributes] = await Promise.all([
    session.client.get<{ id: string; name: string; settings?: { max_title_length?: number } }>(
      `/categories/${id}`
    ),
    session.client.get<CategoryAttribute[]>(`/categories/${id}/attributes`),
  ])
  res.json({
    category: {
      id: category.id,
      name: category.name,
      max_title_length: category.settings?.max_title_length ?? null,
    },
    attributes: attributes
      .filter((attribute) => !attribute.tags?.read_only && !attribute.tags?.hidden)
      .map((attribute) => ({
        id: attribute.id,
        name: attribute.name,
        value_type: attribute.value_type ?? 'string',
        required: !!(
          attribute.tags?.required ||
          attribute.tags?.catalog_required ||
          attribute.tags?.conditional_required
        ),
        varies: !!(attribute.tags?.allow_variations || attribute.tags?.variation_attribute),
        hint: attribute.hint ?? null,
        values: (attribute.values ?? []).slice(0, 200).map((value) => ({
          id: value.id,
          name: value.name,
        })),
      })),
  })
}
