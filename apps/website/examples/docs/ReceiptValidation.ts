import { Schema } from "effect"
import { ReceiptPayload } from "./ReceiptJob.js"

export const validateReceipt = (input: unknown) =>
  Schema.decodeUnknownEffect(ReceiptPayload)(input)
