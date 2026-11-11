// Compatibility CLI until foundation replaces the root registrar.
import { runProjectTests } from "../modernization/Compatibility.ts"
runProjectTests("website-unit", ["apps/website/tests/modernization/Theme.unit.ts"])
