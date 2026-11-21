// A union or an index signature cannot prove that assembly installed one key.
export type IsUnion<A, Whole = A> = A extends Whole
  ? [Whole] extends [A]
    ? false
    : true
  : never

export type SingleKey<K extends string> =
  {} extends Record<K, never> ? never : IsUnion<K> extends false ? unknown : never
