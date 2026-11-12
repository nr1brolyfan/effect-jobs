import { Effect } from "effect"
import { Definitions } from "./scenarios/Definitions.js"
export const catalog = Effect.map(Definitions, (definitions) => definitions.definitions)
export { layerNoDeps as handlersLayerNoDeps } from "./scenarios/Handlers.js"
