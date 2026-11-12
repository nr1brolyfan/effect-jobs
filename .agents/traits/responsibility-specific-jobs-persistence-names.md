---
name: responsibility-specific-jobs-persistence-names
subject: Names for configured jobs persistence, its operations and its error
  contracts in project-owned code and maintained examples.
requirement: "Do not use backend, Backend, or compound identifiers containing
  that name for jobs persistence or its error contracts. Use
  responsibility-specific names: jobs for the configured jobs instance, storage
  for its execution storage, producer for production capabilities, and Service
  for the module-owned public service contract. Do not retain superseded names
  as compatibility aliases."
applicability: Applies to current project-owned identifiers, public API names
  and maintained examples. Excludes fixed third-party API identifiers, immutable
  persisted data and explicitly historical evidence or quotations.
purpose: Make jobs configuration and dependencies understandable from their
  actual responsibilities rather than a vague architectural label.
---
