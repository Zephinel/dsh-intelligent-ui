/**
 * The JSON Schema subset DSH's tool registry accepts.
 *
 * `dsh-tools` validates a tool's `output.schema` with its own
 * `assertSupportedJsonSchema` and throws `JsonSchemaError` for any keyword
 * outside the subset. With the current registration order that throw happens at
 * the *last* step of this plugin's activation, so a schema carrying e.g.
 * `maxLength` leaves the prompt section and the HTTP routes live while the
 * `render_ui` tool silently never exists: the composer shows Intelligent UI
 * enabled, the prompt tells the model to call `render_ui`, and every call fails
 * as an unknown tool.
 *
 * The Host therefore validates its own schemas before it registers anything, so
 * a bad (or stale) artifact fails activation as a unit, with a message that
 * names the offending keyword. `test/host/tool-schema.test.mjs` pins both the
 * accepted subset and this failure shape.
 */
const SUPPORTED_KEYWORDS = new Set([
  'type', 'oneOf', 'properties', 'required', 'additionalProperties', 'items', 'enum', 'const',
  'description', 'title', 'default', 'examples',
])

const SUPPORTED_TYPES = new Set(['object', 'array', 'string', 'number', 'integer', 'boolean', 'null'])

/** The message DSH itself reports, kept in the same shape so logs read alike. */
export const SUBSET_DESCRIPTION =
  'type/oneOf/properties/required/additionalProperties/items/enum/const + annotations'

/**
 * Assert that `schema` stays inside the subset DSH accepts for tool schemas.
 * @param schema - untrusted raw JSON Schema.
 * @param path - label used in the failure message, e.g. `parameters`.
 */
export function assertDshToolSchema(schema: unknown, path: string): void {
  if (typeof schema !== 'object' || schema === null || Array.isArray(schema)) {
    throw new Error(`${path} must be a JSON Schema object`)
  }
  const node = schema as Record<string, unknown>
  for (const key of Object.keys(node)) {
    if (!SUPPORTED_KEYWORDS.has(key)) {
      throw new Error(`${path}.${key} is not a supported keyword (subset: ${SUBSET_DESCRIPTION})`)
    }
  }
  if (!('type' in node)) return
  if (typeof node.type !== 'string' || !SUPPORTED_TYPES.has(node.type)) {
    throw new Error(`${path}.type is not a supported JSON Schema type`)
  }
  if (node.type === 'object') {
    const properties = (node.properties ?? {}) as Record<string, unknown>
    for (const [name, child] of Object.entries(properties)) {
      assertDshToolSchema(child, `${path}.properties.${name}`)
    }
    const required = (node.required ?? []) as unknown[]
    if (!Array.isArray(required)) throw new Error(`${path}.required must be an array of property names`)
    for (const name of required) {
      if (typeof name !== 'string' || !Object.hasOwn(properties, name)) {
        throw new Error(`${path}.required names an undeclared property`)
      }
    }
  } else if (node.type === 'array' && 'items' in node) {
    assertDshToolSchema(node.items, `${path}.items`)
  }
}
