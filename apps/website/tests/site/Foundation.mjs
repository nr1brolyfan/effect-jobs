// Compatibility CLI until foundation replaces the app registrar.
import { runProjectTests } from "../modernization/Compatibility.ts"
runProjectTests("website-unit", [
  "apps/website/tests/modernization/Extraction.unit.ts",
  "apps/website/tests/modernization/StaticAssets.unit.ts"
])
