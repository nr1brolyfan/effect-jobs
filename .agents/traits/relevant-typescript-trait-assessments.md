---
name: relevant-typescript-trait-assessments
subject: Selection of files for automated Traits assessments.
requirement: Select files relevant to the rule and task. Default code
  assessments to authored TypeScript (.ts, .tsx and .mts), excluding Markdown,
  HTML, dependencies, generated output and secrets. Assess other file types only
  when an applicable rule and the task explicitly require them. For initial rule
  adoption assess its applicable project-owned TypeScript scope; for ongoing
  work assess changed files and relevant callers rather than repeating unrelated
  whole-project scans.
purpose: Keep automated rule assessment focused and useful without spending
  requests on unrelated documents or mistaking broad scans for behavioral
  verification.
---
