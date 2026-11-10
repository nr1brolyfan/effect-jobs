# React theme slice

The semantic theme lives in `src/ui/Theme.stylex.ts`. Import its named StyleX
variable groups from the `.stylex.js` specifier in source. All primitive styles
use `stylex.create` and `stylex.props`; the production build must transform them
and serve extracted CSS. There is no uncompiled runtime fallback.

`stateColors` is the single literal state palette for CSS variables and SVG
fills. `stateLabels` supplies readable state names. Badge always renders the
state name, including when children add supplementary content. The default
badge surface gives the lowest-contrast state (Pending) 5.90:1 contrast.

Button defaults to `type="button"` and the secondary variant, forwards its DOM
ref, and preserves native disabled behavior and other native button attributes.
Panel forwards a section ref and native section attributes. Both preserve
caller class names. Callers name icon-only buttons with `aria-label`.

Field preserves a supplied nonempty id or generates one with React `useId`.
It clones the child without replacing its ref, value, handlers or other props.
Native inputs, selects and textareas receive compiled control/focus styles;
custom controls must forward id to a labelable element and own their styles.
Explicit ids must be unique within the caller's document. Checkbox/radio inputs
retain native behavior. Coarse-pointer controls increase their touch size, and
text inputs use 16px text to avoid mobile focus zoom. Panels reduce padding at
600px. Buttons disable transitions under reduced motion.

Icon is decorative and hidden from assistive technology. Its exact Design path
registry is retained locally because the existing registry is private and the
Design renderer constructs DOM nodes; editing Design is outside this slice.
The parity test detects drift. Extracting a public shared path registry would
require coordinated ownership of Design, outside this task.

Global Jobs.css contains document resets and rules scoped to the existing
static Documentation navigation. It deliberately removes legacy dashboard
selectors; foundation and chart provide their own compiled component styles.
The guide preserves its existing markup and in-document anchors.

## Focused verification

Run `node --test apps/website/tests/ui/Theme.test.mjs` from the repository root.
The dependency-free tests check small-text contrast on all four dark surfaces,
primary button label contrast, focus indicator contrast and complete icon path
parity. They do not qualify compiled CSS, accessible DOM associations or refs.

Formatting uses foundation's disposable node_modules symlink and oxfmt 0.71.0;
Node is 24.15.0. No dependency or lockfile changes belong to this slice.
At handoff, foundation had not installed React, React types or StyleX runtime/
compiler. Typecheck, Babel extraction, rendered DOM/ref/disabled/label tests and
browser/mobile/reduced-motion checks are **NotTested** pending those exact
shared dependencies and the central compiler configuration. The repository
lint command could not load `effecttsgo` from the unpatched shared oxlint preset;
toolchain setup is foundation-owned and was not run against its node_modules.

The [StyleX defineVars API](https://stylexjs.com/docs/api/javascript/defineVars/)
requires named exports in `.stylex.ts` files. The
[style authoring guide](https://stylexjs.com/docs/learn/styling-ui/defining-styles/)
allows statically evaluable local values and literal media conditions. This
slice uses local palette literals/member references and literal media queries.
The [theming guide](https://stylexjs.com/docs/learn/theming/defining-variables/)
also states that variable files should have no other exports; the explicit
shared task contract requires `stateOrder`, `stateLabels`, and `stateColors`
from Theme.stylex.ts. Actual pinned compiler acceptance of those exports and
TypeScript `as const satisfies` expressions must be checked during integration.
The task contract is preserved, without a second palette or runtime styling.
Full integration/production qualification belongs to the serial integrator.

## Field integration correction

The continuation reproduces TS2322 at `Primitives.tsx:88` using foundation's
strict playground options, including `exactOptionalPropertyTypes`, and its pinned
dependencies at commit `203e5dce974d168eac820c3cf4364b7341adf241`. A cloned native
input has optional `id?: string | undefined`; it cannot be assigned to the
inferred `ReactElement<{ id?: string }>` under those options. The local render
variable now explicitly accepts `ReactNode`, the type React renders. The public
Field contract, id assignment and native cloning remain unchanged; no new cast
or compiler relaxation is used.

Focused qualification uses disposable read-only links to foundation's root and
website node_modules. A scratch tsconfig extends foundation's
`tsconfig.playground.json` and includes `apps/website/src/ui/*.ts` and `*.tsx`.
`tsc -p .multica/theme-field-fix/tsconfig.json` reproduces the original error and
passes with the correction. No package, lockfile or shared toolchain is changed.

Run `bun apps/website/tests/ui/Field.test.mjs` for label/id behavior evidence.
It transpiles the actual theme/primitives with Bun and compiles StyleX with the
pinned Babel plugin before rendering through React server rendering. It verifies
unique generated ids for input/select/textarea, empty-id fallback, explicit id
preservation, custom-control association and native value/checked/disabled/class/
style preservation. Scratch modules are removed after the run. Bun uses classic
JSX for this rendering harness; production uses foundation's automatic JSX build.
This is rendered markup evidence, not browser label activation, focus or ref
qualification. Browser/PG and full integrated gates remain the serial task.

`Theme.test.mjs`, focused oxlint and oxfmt also pass with the correction. The
earlier NotTested/toolchain notes above record the original handoff; they do not
describe these newly completed focused checks. Documentation was reread for the
correction: every ai-docs path listed below, architecture decisions, canonical
workflow attachment, parent/child contracts and foundation's handoff/build config.

## Documentation read

UPVE-2008, parent UPVE-2006, canonical UPVE-1020 and its multica-workflow.md
attachment; supplied runtime instructions; all accepted decisions in
`specs/architecture-decisions.md`; existing Design, Jobs contracts, global CSS,
static Jobs.html guide and repository formatter/TypeScript/lint settings.
No repository-local AGENTS.md was found outside node_modules.

All ai-docs files were read recursively:

- `ai-docs/README.md`
- `ai-docs/src/01_services/10_services-and-layers.ts`
- `ai-docs/src/01_services/20_module-consumption.ts`
- `ai-docs/src/01_services/30_layer-composition.ts`
- `ai-docs/src/02_modeling/10_schema-tagged-match.ts`
- `ai-docs/src/03_errors/10_errors-and-causes.ts`
- `ai-docs/src/04_observability/10_operation-observability.ts`
- `ai-docs/src/05_resources/10_resources-interruption-secrets.ts`
- `ai-docs/src/06_persistence/10_mutation-boundaries.ts`
- `ai-docs/src/07_transport/10_wire-errors.ts`
- `ai-docs/src/08_style/10_visible-code-and-modules.ts`
- `ai-docs/src/09_testing/10_testing-and-review.ts`
- `ai-docs/src/10_boundaries/10_external-time-regex.ts`
- `ai-docs/src/fixtures/Auth.ts`
- `ai-docs/src/index.md`
- `ai-docs/tsconfig.json`
