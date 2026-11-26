# Project-local Traits

The setup follows `https://github.com/crosshatch/traits/blob/main/SETUP.md`.

- Package manager: Bun 1.4.2; dependencies and the workspace lockfile stay at the repository root.
- Decision provider: Cloudflare Workers AI. Clef Flash (`@cf/cloudflare/clef-flash`) is the default for routine checks. Select full Clef 27B (`@cf/cloudflare/clef`) for a difficult review or trait-relationship decision by setting `TRAITS_CLEF_MODEL=clef` in the server's environment before starting it. Model selection is per server, not per file or automatic escalation.
- Generation provider: the local OpenCode API, model `openai/gpt-6.1-sol`, variant `medium`.
- `traits.ts` owns this project's configuration. Rules belong in `.agents/traits/` after approval through `derive_trait`.
- `.agents/skills/traits/SKILL.md` is a regular snapshot of the installed package's bundled skill. Refresh it after updating Traits. A dependency symlink is not used because Multica cannot replay an untracked symlink into isolated task worktrees.

Set `CLOUDFLARE_ACCOUNT_ID` and `CLOUDFLARE_API_TOKEN` in the MCP process environment or the Git-ignored repository-root `.env`. The token needs Workers AI access on that account. Never commit it or paste it into a report. Decision requests send the selected source excerpts to Workers AI; keep the secret and generated-file exclusions. There is no fallback provider or model.

The client calls Workers AI directly. It does not read `CLOUDFLARE_AI_GATEWAY_ID` or send the AI Gateway routing header.

Clef is a decision model, not a text generator. The local generation adapter is unchanged: it uses OpenCode's existing authentication and supports non-streaming text and schema-requested JSON, not tools or streaming. Reverify its experimental generation endpoint after OpenCode API changes.

After changing credentials or dependencies, reconnect **this project's** Traits server in OpenCode's `/mcps` interface. `opencode mcp list` reports the managed connection; a previous startup failure may remain until reconnecting. Startup and tool exposure alone do not prove provider requests or rule assessment work. Retry any failed `check_traits` call after reconnecting.

No rules are imported from other repositories automatically, and no sample rule is created to test installation. Compare proposed rules with the project's store and obtain approval before saving them. A failed or incomplete check is not a clean assessment.

Default assessments target relevant authored TypeScript files (`.ts`, `.tsx`, and `.mts`), not every tracked file. Markdown and HTML are excluded from this project's checks. Other file types require a concrete applicable rule and an explicit selection; dependencies, generated files and secrets remain excluded. For initial adoption, inspect the applicable TypeScript scope; for ongoing work, assess changed files and relevant callers rather than repeating a whole-project scan.
