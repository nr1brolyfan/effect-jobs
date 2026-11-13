---
name: prefer-effect-match-for-value-branching
subject: Alternative-branch selection in project-owned TypeScript code using Effect.
requirement: Prefer Effect Match over switch statements and if/else chains when
  selecting a common result or Effect from alternative cases of the same value,
  especially tagged unions, literal unions and multi-case classification. Match
  closed unions exhaustively rather than hiding missing cases behind a
  catch-all. Preserve existing evaluation order, laziness, error behavior and
  control flow when converting branches.
applicability: Applies to authored .ts, .tsx and .mts source where Effect is
  available. Keep native early-return guards, loop control, independent
  single-action conditions and simple boolean or conditional expressions when
  Match would obscure intent or require artificial wrapping. Native branching
  may remain in measured performance-sensitive paths when conversion would
  regress a demonstrated constraint.
purpose: Favor the consistent, declarative aesthetics of Match and visible case
  coverage without making simple control flow harder to read.
---
Match is a strong preference for alternative-case selection, not a blanket ban on if, switch, native comparisons or ternaries. For example, prefer Match.value(event).pipe(Match.tag("Started", onStarted), Match.tag("Stopped", onStopped), Match.exhaustive) for a closed event union, but keep a guard such as if (items.length === 0) return Effect.void.