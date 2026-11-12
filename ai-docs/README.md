# effect-jobs AI docs

Load `src/index.md`, then only the topic files relevant to the task. The TypeScript files are the documentation: preferred patterns and the few important anti-patterns are expressed as code with short comments.

The maintained jobs observability example is checked by `bun run check:docs:observability`
and the root `verify` gate. Other inherited auth examples remain reference material;
their former imports are not effect-jobs APIs. `ai-docs/tsconfig.json` is a separate
legacy diagnostic, not the jobs observability compiler gate.
