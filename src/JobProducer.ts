import {
  JobDeclarationError,
  validateOperationId,
  validateProducerDeclaration
} from "./JobIdentity.js"
import type { ProducerIdentity } from "./JobIdentity.js"

export interface JobProducer<
  Operation extends string,
  Slots extends ReadonlyArray<string>
> {
  readonly operation: Operation
  readonly slots: Readonly<Slots>
  readonly identity: <const Slot extends Slots[number]>(input: {
    readonly operationId: string
    readonly slot: Slot
  }) => ProducerIdentity<Operation, Slot>
}

export const make = <
  const Operation extends string,
  const Slots extends ReadonlyArray<string>
>(options: {
  readonly operation: Operation
  readonly slots: Slots
}): JobProducer<Operation, Slots> => {
  validateProducerDeclaration(options)
  const operation = options.operation
  // The copy retains tuple positions without retaining the caller's mutable array.
  const slots = Object.freeze([...options.slots]) as unknown as Readonly<Slots>
  return Object.freeze({
    operation,
    slots,
    identity: <const Slot extends Slots[number]>(input: {
      readonly operationId: string
      readonly slot: Slot
    }): ProducerIdentity<Operation, Slot> => {
      validateOperationId(input.operationId)
      if (!slots.includes(input.slot)) {
        throw new JobDeclarationError({ field: "slots", expected: "a declared slot" })
      }
      return Object.freeze({
        operation,
        operationId: input.operationId,
        slot: input.slot
      })
    }
  })
}
