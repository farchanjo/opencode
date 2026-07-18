/**
 * Alias generation shared with registry (avoid circular imports from catalog).
 */
export function generateAliases(id: string): {
  readonly slash: string
  readonly cli: readonly string[]
  readonly palette: string
} {
  const segments = id.split(".")
  const domain = segments[0] ?? id
  const rest = segments.slice(1)
  return {
    slash: `/op.${id}`,
    cli: ["op", domain, ...rest],
    palette: id,
  }
}
