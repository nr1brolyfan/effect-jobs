# Project-local Traits

The setup follows `https://github.com/crosshatch/traits/blob/main/SETUP.md`.

- Package manager: Bun 1.4.2; dependencies and the workspace lockfile stay at the repository root.
- Decision provider: OpenRouter, model `~typesafe/jev-latest`.
- Generation provider: the local OpenCode API, model `openai/gpt-6.1-sol`, variant `medium`.
- `traits.ts` owns this project's configuration. Rules belong in `.agents/traits/` after approval through `derive_trait`.
- `.agents/skills/traits/SKILL.md` is a regular snapshot of the installed package's bundled skill. Refresh it after updating Traits. A dependency symlink is not used because Multica cannot replay an untracked symlink into isolated task worktrees.

Set `OPENROUTER_API_KEY` in the MCP process environment or the repository-root `.env` file, which is Git-ignored. Never commit the key or paste it into a report. The local generation adapter uses OpenCode's existing provider authentication and has no API fallback. It supports non-streaming text and schema-requested JSON generation, not tools or streaming; it uses the experimental generation endpoint and must be reverified after OpenCode API changes.

After changing credentials or dependencies, reconnect **this project's** Traits server in OpenCode's `/mcps` interface. `opencode mcp list` reports the managed connection; a previous startup failure may remain until reconnecting. Startup and tool exposure alone do not prove provider requests or rule assessment work. Retry any failed `check_traits` call after reconnecting.

No rules are imported from other repositories automatically, and no sample rule is created to test installation. Compare proposed rules with the project's store and obtain approval before saving them. A failed or incomplete check is not a clean assessment.

Default assessments target relevant authored TypeScript files (`.ts`, `.tsx`, and `.mts`), not every tracked file. Markdown and HTML are excluded from this project's checks. Other file types require a concrete applicable rule and an explicit selection; dependencies, generated files and secrets remain excluded. For initial adoption, inspect the applicable TypeScript scope; for ongoing work, assess changed files and relevant callers rather than repeating a whole-project scan.
