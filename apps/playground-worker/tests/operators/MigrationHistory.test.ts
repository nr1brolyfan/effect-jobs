import { describe, expect, it } from "vitest"
import { migrations } from "../../src/persistence/MigrationRegistry.js"
import * as OperatorSchema from "../../src/persistence/commands/OperatorSchema.js"

describe("immutable historical playground migration bytes", () => {
  it("retains exact v1/v2/v3 checksums across independently named schemas", () => {
    expect(
      migrations("public")
        .slice(0, 3)
        .map((m) => m.checksum)
    ).toEqual([
      "cda9236b221f05e3819cd2bfb5bcf7c4fc41bcd200501b9a64a7982c441652be",
      "bb94a55bddd16be6aa012af13e8b97939c3a2c474c09656113cb291b649e6c71",
      "705a092daa45767ce6c02e85a0d3a0037a0ccc416186c491ceca869f93d1b2c3"
    ])
    expect(
      migrations("operators_legacy")
        .slice(0, 3)
        .map((m) => m.checksum)
    ).toEqual([
      "1360ffaed9731877583df2897fa58ac5da468f08a91d26301567e21c377ec9e6",
      "a658b228792a6e1ed44b402b808a5c6be4ae7f47aa6e5c8049cd284f035329eb",
      "5e17cd1a136c9c12ec1e73e824455d2df85ae4ae10da7755003ad109563a144e"
    ])
  })
  it("rejects unvalidated schema names before generating additive DDL", () => {
    expect(() => OperatorSchema.proposal('x"; DROP TABLE jobs; --')).toThrow()
  })
})
