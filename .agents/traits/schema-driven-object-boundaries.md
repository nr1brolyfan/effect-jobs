---
name: schema-driven-object-boundaries
subject: Decoding and encoding objects across external-data and
  persisted-representation boundaries in Effect-based code.
requirement: Decode and validate externally supplied objects, configuration and
  storage rows with an owned Effect Schema or the authoritative runtime
  validator for that data contract, and consume the validated result. When
  converting a structured record between external or persisted and domain
  representations, describe the complete object contract and its transformations
  in Schema rather than rebuilding the record with ad-hoc per-property coercions
  such as Number(row.value), String(row.id), unchecked casts or shape
  predicates. Encode structured output through its owned Schema when that
  boundary requires a distinct encoded representation. Preserve required numeric
  precision, bounds, optionality and error semantics; never treat successful
  validation as authorization. Do not redundantly decode already-validated
  internal values unless they may have changed, persisted compatibility is
  uncertain, or a documented runtime invariant requires it.
applicability: Applies to authored Effect-based library and application code at
  real external-input, configuration, wire-format and persistence boundaries.
  Ordinary arithmetic, intentional conversions of already-trusted domain values
  and focused foreign-interface checks do not require a whole-object Schema. Do
  not duplicate equivalent validation already performed by the authoritative
  library validator.
purpose: Keep object validation and representation transformations explicit,
  coherent and reusable without scattering unchecked field coercions or adding
  redundant defensive validation.
---
