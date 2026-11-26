import assert from "node:assert/strict"
import { execFileSync } from "node:child_process"
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import { API, SymbolFlags, type Checker, type Symbol } from "typescript/unstable/sync"
import {
  isClassDeclaration,
  isTypeQueryNode,
  isVariableDeclaration
} from "typescript/unstable/ast"

const resolveAlias = (checker: Checker, symbol: Symbol) =>
  symbol.flags & SymbolFlags.Alias ? checker.getAliasedSymbol(symbol) : symbol

/** Extract exact declarations from a fresh emit; never read a potentially stale dist/. */
export const openDeclarations = (root: string) => {
  const parent = join(root, ".toolchain")
  mkdirSync(parent, { recursive: true })
  const scratch = mkdtempSync(join(parent, "reference-declarations-"))
  const emit = join(scratch, "emit")
  const config = join(scratch, "tsconfig.json")
  const api = new API({ cwd: root })
  const close = () => {
    api.close()
    rmSync(scratch, { recursive: true, force: true })
  }
  try {
    execFileSync(
      process.execPath,
      [
        join(root, "node_modules/typescript/bin/tsc"),
        "-p",
        join(root, "tsconfig.build.json"),
        "--emitDeclarationOnly",
        "--declarationMap",
        "false",
        "--outDir",
        emit
      ],
      { cwd: root, stdio: "inherit" }
    )
    writeFileSync(
      config,
      JSON.stringify({
        extends: join(root, "tsconfig.json"),
        include: ["emit/**/*.d.ts"]
      })
    )
    const snapshot = api.updateSnapshot({ openProjects: [config] })
    const project = snapshot.getProject(config)
    assert(project, "Missing emitted declaration project")
    const { checker, program } = project

    const forModule = (types: string) => {
      assert(types.startsWith("dist/"))
      const file = program.getSourceFile(join(emit, types.slice("dist/".length)))
      assert(file, `Missing declaration file for ${types}`)
      const module = checker.getSymbolAtLocation(file)
      assert(module, `Not a declaration module: ${types}`)
      return new Map(
        checker.getExportsOfModule(module).map((symbol) => {
          const target = resolveAlias(checker, symbol)
          const declarations = new Set<string>()
          const resolved = new Set<string>()
          for (const handle of target.declarations) {
            const node = handle.resolve()
            assert(
              node && handle.path.startsWith(`${emit}/`),
              `No local declaration for ${types}#${symbol.name}`
            )
            if (isVariableDeclaration(node)) {
              const statement = node.parent.parent
              // A re-export or `const make: typeof Other.make` is useful only if readers can see the target.
              if (node.type && isTypeQueryNode(node.type)) {
                const referenced = checker.getSymbolAtLocation(node.type.exprName)
                for (const item of referenced
                  ? resolveAlias(checker, referenced).declarations
                  : []) {
                  if (!item.path.startsWith(`${emit}/`)) {
                    continue
                  }
                  const original = item.resolve()
                  if (original && original !== node) {
                    resolved.add(
                      isVariableDeclaration(original)
                        ? original.parent.parent.getText()
                        : original.getText()
                    )
                  }
                }
              }
              declarations.add(statement.getText())
            } else {
              if (isClassDeclaration(node)) {
                for (const clause of node.heritageClauses ?? []) {
                  for (const base of clause.types) {
                    const parent = checker.getSymbolAtLocation(base.expression)
                    if (!parent?.name.endsWith("_base")) {
                      continue
                    }
                    const helper = parent.valueDeclaration?.resolve()
                    if (
                      helper &&
                      isVariableDeclaration(helper) &&
                      helper.getSourceFile() === node.getSourceFile()
                    ) {
                      declarations.add(helper.parent.parent.getText())
                    }
                  }
                }
              }
              declarations.add(node.getText())
            }
          }
          assert(declarations.size, `No signature for ${types}#${symbol.name}`)
          return [
            symbol.name,
            {
              declaredAs: target.name,
              signature: [...declarations].join("\n\n"),
              resolved: [...resolved].join("\n\n")
            }
          ]
        })
      )
    }
    return {
      forModule,
      close: () => {
        snapshot.dispose()
        close()
      }
    }
  } catch (error) {
    close()
    throw error
  }
}
