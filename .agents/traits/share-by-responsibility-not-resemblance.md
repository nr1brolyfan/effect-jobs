---
name: share-by-responsibility-not-resemblance
subject: Extraction and reuse of logic across operations or modules.
requirement: Share logic when consumers have the same responsibility and
  behavioral contract, not merely similar syntax. Keep separate implementations
  when authorization, lifecycle, failure or evolution contracts differ.
  Introduce an abstraction only when it removes meaningful duplication or
  expresses a real boundary without hiding those differences.
purpose: Reduce accidental coupling and needless indirection while retaining
  useful reuse.
---
