---
name: tagged-enum-runtime-factories
subject: Effect Data.TaggedEnum type aliases.
requirement: Every Effect Data.TaggedEnum type alias must have a same-named
  runtime factory. For non-generic aliases, use a Data.taggedEnum value under
  the type name. For generic aliases, a same-named generic helper returning
  Data.taggedEnum instantiated with its type parameters is valid. This applies
  independently of Schema.TaggedUnion construction rules.
applicability: Applies when declaring an Effect Data.TaggedEnum type alias in
  TypeScript or TSX.
purpose: Provide consistent runtime construction and matching support while
  preserving generic type parameters.
---

```ts
type Outcome = Data.TaggedEnum<{ Pass: {}; Fail: { reason: string } }>
const Outcome = Data.taggedEnum<Outcome>()

type ReceiptLookup<A> = Data.TaggedEnum<{ Absent: {}; Matching: { value: A } }>
const ReceiptLookup = <A>() => Data.taggedEnum<ReceiptLookup<A>>()
```
