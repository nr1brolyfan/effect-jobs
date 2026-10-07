import type { SchemaAST } from "effect"

// Links survive annotation/check/optional rebuilding of native Schema nodes.
// Only links created by our helper may cross the protected encoded boundary.
const links = new WeakSet<SchemaAST.Link["transformation"]>()
export const registerEncryption = (link: SchemaAST.Link): void => {
  links.add(link.transformation)
}
export const hasEncryption = (ast: SchemaAST.AST): boolean =>
  ast.encoding?.some((link) => links.has(link.transformation)) ?? false
