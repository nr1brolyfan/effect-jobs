import assert from "node:assert/strict"
import { resolve } from "node:path"
import { API } from "typescript/unstable/sync"
import { createVirtualFileSystem } from "typescript/unstable/fs"
import * as ts from "typescript/unstable/ast"

// Parse archive bytes without executing them or resolving their dependencies.
// The compiler is an existing, exact-pinned development tool, not a package peer.
export const releaseImports = (sources) => {
  const directory = resolve(import.meta.dirname, "../.toolchain/release-graph")
  const config = resolve(directory, "tsconfig.json")
  const files = Object.fromEntries(
    sources.map(({ filename, source }) => [resolve(directory, filename), source])
  )
  files[config] = JSON.stringify({
    compilerOptions: { allowJs: true, noResolve: true, noLib: true },
    files: Object.keys(files)
  })
  const api = new API({ fs: createVirtualFileSystem(files) })
  try {
    using snapshot = api.updateSnapshot({ openProjects: [config] })
    const program = snapshot.getProject(config).program
    assert.deepEqual(program.getSyntacticDiagnostics(), [], "Invalid archive syntax")
    return sources.map(({ filename }) => {
      const imports = []
      const add = (literal) => {
        if (
          literal &&
          (ts.isStringLiteral(literal) || ts.isNoSubstitutionTemplateLiteral(literal))
        ) {
          imports.push(literal.text)
        }
      }
      const visit = (node) => {
        if (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) {
          add(node.moduleSpecifier)
        } else if (ts.isImportTypeNode(node) && ts.isLiteralTypeNode(node.argument)) {
          add(node.argument.literal)
        } else if (ts.isExternalModuleReference(node)) {
          add(node.expression)
        } else if (
          ts.isCallExpression(node) &&
          node.expression.kind === ts.SyntaxKind.ImportKeyword
        ) {
          add(node.arguments[0])
        }
        node.forEachChild(visit)
      }
      const sourceFile = program.getSourceFile(resolve(directory, filename))
      assert(sourceFile, `Missing archive source ${filename}`)
      visit(sourceFile)
      return { filename, imports }
    })
  } finally {
    api.close()
  }
}
