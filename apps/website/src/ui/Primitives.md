# Shared playground primitives

The owned components adapt the [shadcn-cssinjs registry](https://www.shadcn-cssinjs.com/) to the existing compiled StyleX pipeline and six-state dark palette. The installation guide and site skill were inspected; no shadcn CLI, Next, Tailwind, second theme, or global helper was installed.

## Contracts

- `Button`, `Panel`, `Badge`, `Field`, `Icon` retain their existing signatures. Button remains a native button with a forwarded HTMLButtonElement ref, default `type="button"`, native disabled/form props and caller class/style. The registry button uses render composition rather than the Base UI Button runtime; a native button needs no extra interaction layer. Card surface/spacing guidance is consumed through the existing semantic section `Panel`; no unused Card header/footer/context API is added.
- `TabsRoot`, `TabsList`, `TabsTab`, `TabsPanel` are exported from `Primitives.js`. Their exported Props types match pinned Base UI Root/List/Tab/Panel props; `TabsTabProps` additionally accepts `count?: number`. Root supports controlled `value` and `onValueChange(value, eventDetails)`. Tab/Panel share a `value`; give the List an accessible name. Supply authoritative global counts, never page counts; zero renders normally. Ref types are Base UI compatible. Native style, render and state-dependent className props are retained.
- `TabsList` defaults explicitly to `activateOnFocus={false}`: arrows/Home/End move roving focus; Enter/Space activates. This avoids API requests on mere focus. Base UI 1.9.0 keeps disabled tabs focusable for discovery with aria-disabled but rejects activation. Enable automatic activation only for local content without network latency. Render matching TabsPanel content with each selectable value; a filter-only tablist without its linked panels does not fulfill the ARIA tabs contract. Integrator must keep the real results panel associated with the selected state, retaining localized loading and focus.
- `Popover.js` exports `Root`, `Trigger`, `Portal`, `Positioner`, `Popup`, `Close`, plus `Title` and `Description`. Props and refs match the underlying Base UI parts; native style/render and string/function className pass through. Positioner defaults sideOffset to 8; it preserves collision avoidance. Compose Root > Trigger + Portal > Positioner > Popup > Title/Description/Close. Name each popup with Title or aria-label. Keyboard Enter/Space, Escape, outside dismissal, focus restoration and touch initial focus are owned by Base UI, verified in Chromium. No hover-only dependence. Popup uses viewport-bounded width and available-height scrolling. Explicit Close is recommended for touch.
- `Pagination({current,pages,hasPrevious,hasNext,disabled?,onPage,onFirst,onPrevious,onNext})` accepts only navigable known cursor pages. It never derives pages from totals. It sorts/deduplicates known numbers and renders first/last known and neighbors by known-history index. Ellipsis appears only when entries from that supplied history were omitted; numeric gaps alone never create an ellipsis or fictional button. First requires a known page 1 and hasPrevious; boundary booleans come from the cursor owner. Every control is a native button; current uses aria-current=page. `disabled` makes the nav aria-busy and disables all actions. Existing rows/loading announcements remain the integrator's responsibility. Controls wrap on mobile; no offsets or backend API changes.

Body typography is 14px; secondary 13px; small 12px. Coarse pointer controls are at least 44px. Motion is limited to existing colors with reduced-motion support; popovers have no animation dependency. Semantic state colors remain unchanged.

## Provenance and dependencies

Registry fetched 2026-10-12, upstream commit `08a2e9fe44c24bf6341dce2afc11bfdbe5fa5d5a` in [shadcn-labs/shadcn-cssinjs](https://github.com/shadcn-labs/shadcn-cssinjs). MIT copyright 2026 Shadcn Labs; full notice is in `Primitives.LICENSE` and applies to adapted code/styles. Registry contents match the commit's `apps/www/registry/bases/stylex/ui/*.tsx` after registry generation rewrites import aliases. JSON artifact SHA256:

| Component  | Registry JSON SHA256                                               |
| ---------- | ------------------------------------------------------------------ |
| button     | `ff49d2776c32b8daccb44f2c54b950cc314926bc1c35f720df6344faee8f2440` |
| tabs       | `223b752db9471f2f774251d4faf0ab6390e4c78961a6cf7c5868d6aec56340cd` |
| popover    | `4be9ec5eebfd91a41a7cc75b035979fd7c370156c44c9be94601ef1aec7882c7` |
| pagination | `27ae231a4b17fbdba3f20e1a713e506bacfca928d00443f896118b6e023bd035` |
| card       | `6702c1e6c8ed3bcf1153557e7e0c9f58a87442a194137ea26977ab255760185e` |

Pinned `@base-ui/react@1.9.0` (MIT, copyright 2019 Material-UI SAS) supports React/ReactDOM 17/18/19; existing React/ReactDOM 19.3.0 and StyleX 0.19.1 remain unchanged. Actual installed package/source/license/peer metadata was inspected. Bun lock records package integrity and transitive versions. Optional date-fns peers are unused; no temporal/date/icon library added. Existing Icon replaces registry lucide pagination icons. Select/Tooltip/Chart are omitted: current native select remains valid, keyboard/touch Popover fulfills exact-time details, and qualified Recharts already exists.

## Focused qualification

`bun run playground:test:primitives` compiles actual StyleX sources with runtimeInjection=false and bundles a production synthetic component fixture. It uses the pinned local Playwright/axe toolchain, a dynamically allocated localhost port, strict self-only CSP, and no API/private runtime. It checks native props/ref/form semantics, manual controlled tabs, disabled activation, linked panels/counts, Popover focus/touch/dismissal, real pagination callbacks/bounds/loading/history, desktop/mobile WCAG A/AA, no horizontal overflow and no style injection. Receipt and screenshots are written to `.multica/primitives-browser/`; they qualify components only, not dashboard/backend/WS/privacy integration. Existing Field and Theme tests remain required.

Reproducible fresh worktree setup: `bun install --frozen-lockfile`, `bun run build`, `bun install --frozen-lockfile` (refresh file: root package after dist creation), then `bun run playground:check`, `bun run playground:build`, and focused tests. No build config adaptation was needed.

Commit source SHA256 (before registry alias rewriting):

- `button`: `80da2b43505674e9842f96fabb239a3e73b563a569550aa5596a7864d85fc1b9`
- `tabs`: `d1d1f8255b8a9a48a075369291e91b96ccefdb703955978fca64a587083387aa`
- `popover`: `6e29ac971e79768f2f3a22bb1aebb2db9cd5efcea3b858b2c2ebf54d6e2287f8`
- `pagination`: `cb3d1ac594a59dac186ae20ad89528b16275c7dc4ab2f40b31f48d5938254e2a`
- `card`: `b5ec5b69290a86966a291ce654fedfb81f8b7fc05423c867e35a78bb7631217f`

Registry component-content SHA256 (the copied/adapted input after alias rewriting):

- `button`: `08c3925a1ef405f09594c8059b15ec3dc460fa2f6f0f8052a58958aa9817caf8`
- `tabs`: `22cefc929a498376144c299d4dd027495b19ba0dea88fdb7fcb6402133b51256`
- `popover`: `2ff6ec5732af4ae11cd88f156866044c57d2901a2b26df4a1b68fa1ecc54c1af`
- `pagination`: `6cb2e5bb5d29c8fd724f91cbfc24db90365a4216a9de86c0fa7ba4e3924b5759`
- `card`: `87dbf3afdc8d7e5ddf9d8c8e37b430cb387bf822c34dec75b05555c612d65593`
