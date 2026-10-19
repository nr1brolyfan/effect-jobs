// apps/playground-worker/tests/integration/NativeDrizzleOperators.ts
import { Data as Data4, Effect as Effect13, Redacted as Redacted3 } from "effect";
import * as Reactivity2 from "effect/reactivity/Reactivity";

// node_modules/.bun/@effect+sql-pg@4.0.0+a594d97e083afb95/node_modules/@effect/sql-pg/dist/PgClient.js
import * as Config from "effect/Config";
import * as Context3 from "effect/Context";
import * as Effect4 from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Reactivity from "effect/reactivity/Reactivity";
import * as Client from "effect/sql/SqlClient";
import { SqlError as SqlError3, UnknownError as UnknownError3 } from "effect/sql/SqlError";
import * as Statement from "effect/sql/Statement";
import * as Stream2 from "effect/Stream";

// node_modules/.bun/@effect+sql-pg@4.0.0+a594d97e083afb95/node_modules/@effect/sql-pg/dist/internal/sqlError.js
import { AuthenticationError, AuthorizationError, ConnectionError, ConstraintError, DeadlockError, LockTimeoutError, SerializationError, SqlError, SqlSyntaxError, StatementTimeoutError, UniqueViolation, UnknownError } from "effect/sql/SqlError";
var channelNameEncoder = /* @__PURE__ */ new TextEncoder();
var validateChannelName = (channel, operation) => {
  if (channelNameEncoder.encode(channel).byteLength <= 63) return void 0;
  const message = "PostgreSQL channel names must not exceed 63 UTF-8 bytes";
  return new SqlError({
    reason: new UnknownError({
      cause: new Error(message),
      message,
      operation
    })
  });
};
var normalizeConstraint = (constraint) => {
  if (typeof constraint !== "string") return "unknown";
  const normalized = constraint.trim();
  return normalized.length === 0 ? "unknown" : normalized;
};
var classifySqlState = (code, constraint, props) => {
  if (code !== void 0) {
    if (code.startsWith("08")) {
      return new ConnectionError(props);
    }
    if (code.startsWith("28")) {
      return new AuthenticationError(props);
    }
    if (code === "42501") {
      return new AuthorizationError(props);
    }
    if (code.startsWith("42")) {
      return new SqlSyntaxError(props);
    }
    if (code === "23505") {
      return new UniqueViolation({
        ...props,
        constraint: normalizeConstraint(constraint)
      });
    }
    if (code.startsWith("23")) {
      return new ConstraintError(props);
    }
    if (code === "40P01") {
      return new DeadlockError(props);
    }
    if (code === "40001") {
      return new SerializationError(props);
    }
    if (code === "55P03") {
      return new LockTimeoutError(props);
    }
    if (code === "57014") {
      return new StatementTimeoutError(props);
    }
  }
  return new UnknownError(props);
};

// node_modules/.bun/@effect+sql-pg@4.0.0+a594d97e083afb95/node_modules/@effect/sql-pg/dist/PgConnection.js
import * as Cause from "effect/Cause";
import * as Channel from "effect/Channel";
import * as Context from "effect/Context";
import * as Deferred from "effect/Deferred";
import * as Duration from "effect/Duration";
import * as Effect2 from "effect/Effect";
import * as Exit from "effect/Exit";
import * as Queue from "effect/Queue";
import * as Redacted2 from "effect/Redacted";
import * as EffectResult from "effect/Result";
import * as Scope from "effect/Scope";
import * as Semaphore from "effect/Semaphore";
import { AuthenticationError as AuthenticationError2, ConnectionError as ConnectionError2, SqlError as SqlError2, UnknownError as UnknownError2 } from "effect/sql/SqlError";
import * as Stream from "effect/Stream";
import { Buffer as Buffer2 } from "node:buffer";
import { randomBytes } from "node:crypto";
import * as Net from "node:net";
import * as Tls from "node:tls";

// node_modules/.bun/@effect+sql-pg@4.0.0+a594d97e083afb95/node_modules/@effect/sql-pg/dist/internal/connection.js
var internalsKey = "~@effect/sql-pg/PgConnection/internals";
var connectionInternals = (connection) => connection[internalsKey];

// node_modules/.bun/@effect+sql-pg@4.0.0+a594d97e083afb95/node_modules/@effect/sql-pg/dist/internal/password.js
import * as Effect from "effect/Effect";
import * as Redacted from "effect/Redacted";
var resolve = (password) => password === void 0 ? Effect.succeed(void 0) : Effect.isEffect(password) ? Effect.map(password, Redacted.value) : Effect.succeed(Redacted.value(password));

// node_modules/.bun/@effect+sql-pg@4.0.0+a594d97e083afb95/node_modules/@effect/sql-pg/dist/PgAuth.js
import * as Data from "effect/Data";
import * as Base64 from "effect/encoding/Base64";
import * as Result from "effect/Result";
import { createHash, createHmac, pbkdf2Sync } from "node:crypto";
var AuthError = class extends (/* @__PURE__ */ Data.TaggedError("PgAuthError")) {
};
var fail2 = (message) => {
  throw new AuthError({
    message
  });
};
var result = (evaluate) => {
  try {
    return Result.succeed(evaluate());
  } catch (error) {
    if (error instanceof AuthError) return Result.fail(error);
    throw error;
  }
};
var textEncoder = /* @__PURE__ */ new TextEncoder();
var textDecoder = /* @__PURE__ */ new TextDecoder("utf-8", {
  fatal: true
});
var maxScramIterations = 1e6;
var bytesOf = (value3) => Uint8Array.from(value3);
var sha256 = (data) => bytesOf(createHash("sha256").update(data).digest());
var hmacSha256 = (key, data) => bytesOf(createHmac("sha256", key).update(data).digest());
var xor = (left, right) => {
  const result3 = new Uint8Array(left.length);
  for (let i = 0; i < left.length; i++) {
    result3[i] = left[i] ^ right[i];
  }
  return result3;
};
var toBase64 = (bytes) => Base64.encode(bytes);
var fromBase64 = (text3, field) => {
  const decoded = Base64.decode(text3);
  if (Result.isFailure(decoded)) {
    return fail2(`Invalid base64 in SCRAM attribute "${field}"`);
  }
  return decoded.success;
};
var decodeUtf8 = (bytes, what) => {
  try {
    return textDecoder.decode(bytes);
  } catch {
    return fail2(`Invalid UTF-8 in ${what}`);
  }
};
var md5PasswordUnsafe = (options) => {
  if (options.salt.length !== 4) {
    return fail2(`PostgreSQL MD5 salt must be exactly 4 bytes, received ${options.salt.length}`);
  }
  const inner = createHash("md5").update(textEncoder.encode(options.password + options.user)).digest("hex");
  const outer = createHash("md5").update(textEncoder.encode(inner)).update(options.salt).digest("hex");
  return `md5${outer}`;
};
var md5Password = (options) => result(() => md5PasswordUnsafe(options));
var SCRAM_SHA_256 = "SCRAM-SHA-256";
var GS2_HEADER = "n,,";
var CHANNEL_BINDING = "biws";
var parseAttributes = (message) => {
  const attributes = /* @__PURE__ */ new Map();
  for (const part of message.split(",")) {
    const separator = part.indexOf("=");
    if (separator < 1) {
      return fail2(`Malformed SCRAM attribute: "${part}"`);
    }
    const key = part.slice(0, separator);
    if (attributes.has(key)) {
      return fail2(`Duplicate SCRAM attribute "${key}"`);
    }
    attributes.set(key, part.slice(separator + 1));
  }
  return attributes;
};
var attribute = (attributes, key) => attributes.get(key) ?? fail2(`Missing SCRAM attribute "${key}"`);
var scramInitUnsafe = (options) => {
  if (!/^[\x21-\x2b\x2d-\x7e]+$/.test(options.nonce)) {
    return fail2("SCRAM nonce must contain only printable ASCII characters other than comma");
  }
  const clientFirstMessageBare = `n=,r=${options.nonce}`;
  return {
    state: {
      _tag: "ScramFirst",
      password: options.password,
      clientNonce: options.nonce,
      clientFirstMessageBare
    },
    response: textEncoder.encode(GS2_HEADER + clientFirstMessageBare)
  };
};
var scramInit = (options) => result(() => scramInitUnsafe(options));
var scramContinueUnsafe = (state, challenge) => {
  const serverFirstMessage = decodeUtf8(challenge, "the SCRAM server-first-message");
  const attributes = parseAttributes(serverFirstMessage);
  const nonce = attribute(attributes, "r");
  if (!nonce.startsWith(state.clientNonce) || nonce.length === state.clientNonce.length) {
    return fail2("SCRAM server nonce does not extend the client nonce");
  }
  const saltText = attribute(attributes, "s");
  if (saltText.length === 0) {
    return fail2("SCRAM salt must not be empty");
  }
  const salt = fromBase64(saltText, "s");
  const iterationText = attribute(attributes, "i");
  const iterations = Number(iterationText);
  if (!/^[1-9]\d*$/.test(iterationText) || !Number.isSafeInteger(iterations) || iterations > maxScramIterations) {
    return fail2(`Invalid SCRAM iteration count: ${iterationText}`);
  }
  const saltedPassword = bytesOf(pbkdf2Sync(textEncoder.encode(state.password), salt, iterations, 32, "sha256"));
  const clientKey = hmacSha256(saltedPassword, textEncoder.encode("Client Key"));
  const storedKey = sha256(clientKey);
  const clientFinalMessageWithoutProof = `c=${CHANNEL_BINDING},r=${nonce}`;
  const authMessage = textEncoder.encode(`${state.clientFirstMessageBare},${serverFirstMessage},${clientFinalMessageWithoutProof}`);
  const clientProof = xor(clientKey, hmacSha256(storedKey, authMessage));
  const serverKey = hmacSha256(saltedPassword, textEncoder.encode("Server Key"));
  return {
    state: {
      _tag: "ScramFinal",
      serverSignature: hmacSha256(serverKey, authMessage)
    },
    response: textEncoder.encode(`${clientFinalMessageWithoutProof},p=${toBase64(clientProof)}`)
  };
};
var scramContinue = (state, challenge) => result(() => scramContinueUnsafe(state, challenge));
var scramFinishUnsafe = (state, challenge) => {
  const attributes = parseAttributes(decodeUtf8(challenge, "the SCRAM server-final-message"));
  const error = attributes.get("e");
  if (error !== void 0) {
    fail2(`SCRAM authentication failed: ${error}`);
  }
  const signature = fromBase64(attribute(attributes, "v"), "v");
  if (toBase64(state.serverSignature) !== toBase64(signature)) {
    fail2("SCRAM server signature mismatch");
  }
};
var scramFinish = (state, challenge) => result(() => scramFinishUnsafe(state, challenge));

// node_modules/.bun/@effect+sql-pg@4.0.0+a594d97e083afb95/node_modules/@effect/sql-pg/dist/PgProtocol.js
import * as Data2 from "effect/Data";
import * as Result2 from "effect/Result";
var defaultMaxMessageSize = 16 * 1024 * 1024;
var maxBufferSize = 64 * 1024;
var makeParser = (options) => {
  const maxMessageSize = options?.maxMessageSize ?? defaultMaxMessageSize;
  const reader = new Reader();
  let bufferSize = 8192;
  let buffer = new Uint8Array(bufferSize);
  let store = buffer.buffer;
  let start = 0;
  let end2 = 0;
  let failed = false;
  const append = (chunk) => {
    if (end2 + chunk.length > buffer.length) {
      const pending = end2 - start;
      if (bufferSize < maxBufferSize) bufferSize *= 2;
      let capacity = bufferSize;
      while (capacity < pending + chunk.length) capacity *= 2;
      const next = new Uint8Array(capacity);
      next.set(buffer.subarray(start, end2));
      buffer = next;
      store = next.buffer;
      start = 0;
      end2 = pending;
    }
    buffer.set(chunk, end2);
    end2 += chunk.length;
  };
  const parser = {
    readField: options?.readField,
    push(chunk) {
      const messages = [];
      parser.pushEach(chunk, (message) => {
        messages.push(message);
      });
      return messages;
    },
    pushEach(chunk, onMessage) {
      if (failed) {
        throw new ParseError({
          message: "Parser cannot be reused after a failure"
        });
      }
      try {
        append(chunk);
        while (end2 - start >= 5) {
          const length = buffer[start + 1] << 24 | buffer[start + 2] << 16 | buffer[start + 3] << 8 | buffer[start + 4];
          if (length < 4) {
            throw new ParseError({
              message: `Invalid message length: ${length}`
            });
          }
          if (length > maxMessageSize) {
            throw new ParseError({
              message: `Message length ${length} exceeds maxMessageSize ${maxMessageSize}`
            });
          }
          if (end2 - start < length + 1) break;
          const type = buffer[start];
          const body = start + 5;
          const limit = start + 1 + length;
          start = limit;
          if (type === BackendType.DataRow) {
            onMessage(decodeDataRow(buffer, store, 0, body, limit, parser.readField));
          } else {
            reader.reset(buffer, body, limit);
            const message = decodeBackend(type, reader);
            if (reader.offset !== limit) {
              throw new ParseError({
                message: `Message has ${limit - reader.offset} trailing byte(s)`
              });
            }
            onMessage(message);
          }
        }
      } catch (error) {
        failed = true;
        throw error;
      }
    }
  };
  return parser;
};
var ParseError = class extends (/* @__PURE__ */ Data2.TaggedError("PgProtocolParseError")) {
};
var EncodeError = class extends (/* @__PURE__ */ Data2.TaggedError("PgProtocolEncodeError")) {
};
var textEncoder2 = /* @__PURE__ */ new TextEncoder();
var textDecoder2 = /* @__PURE__ */ new TextDecoder("utf-8", {
  fatal: true
});
var asciiEncodeLimit = 48;
var view = (store, offset, length) => new Uint8Array(store, offset, length);
var smallCopyLimit = 8;
var Writer = class {
  poolSize;
  bytes;
  view;
  /** Where the message currently being written begins. */
  start = 0;
  offset = 0;
  /** Set by `sqlNull`, read and cleared by the `makeBindEncoder` loop. */
  isNull = false;
  constructor(poolSize) {
    this.poolSize = poolSize;
    this.bytes = new Uint8Array(poolSize);
    this.view = new DataView(this.bytes.buffer);
  }
  reserve(size) {
    if (this.offset + size <= this.bytes.length) return;
    const pending = this.offset - this.start;
    let capacity = this.poolSize;
    while (capacity < pending + size) capacity *= 2;
    const next = new Uint8Array(capacity);
    next.set(this.bytes.subarray(this.start, this.offset));
    this.bytes = next;
    this.view = new DataView(next.buffer);
    this.start = 0;
    this.offset = pending;
  }
  /** Starts a message, dropping anything a failed write left behind. */
  begin() {
    this.start = this.offset;
  }
  uint8(value3) {
    this.reserve(1);
    this.bytes[this.offset++] = value3;
  }
  int16(value3) {
    this.reserve(2);
    const bytes = this.bytes;
    const offset = this.offset;
    bytes[offset] = value3 >>> 8;
    bytes[offset + 1] = value3;
    this.offset = offset + 2;
  }
  int32(value3) {
    this.reserve(4);
    this.setInt32(this.offset, value3);
    this.offset += 4;
  }
  setInt32(offset, value3) {
    const bytes = this.bytes;
    bytes[offset] = value3 >>> 24;
    bytes[offset + 1] = value3 >>> 16;
    bytes[offset + 2] = value3 >>> 8;
    bytes[offset + 3] = value3;
  }
  float32(value3) {
    this.reserve(4);
    this.view.setFloat32(this.offset, value3);
    this.offset += 4;
  }
  float64(value3) {
    this.reserve(8);
    this.view.setFloat64(this.offset, value3);
    this.offset += 8;
  }
  bigInt64(value3) {
    this.reserve(8);
    this.view.setBigInt64(this.offset, value3);
    this.offset += 8;
  }
  raw(value3) {
    const length = value3.length;
    this.reserve(length);
    const bytes = this.bytes;
    const offset = this.offset;
    if (length <= smallCopyLimit) {
      for (let index = 0; index < length; index++) bytes[offset + index] = value3[index];
    } else {
      bytes.set(value3, offset);
    }
    this.offset = offset + length;
  }
  sqlNull() {
    this.isNull = true;
  }
  beginLength() {
    const token = this.offset - this.start;
    this.int32(0);
    return token;
  }
  endLength(token) {
    this.setInt32(this.start + token, this.offset - this.start - token - 4);
  }
  utf8(value3, nul = false) {
    const length = value3.length;
    if (length <= asciiEncodeLimit) {
      this.reserve(length + (nul ? 1 : 0));
      const bytes = this.bytes;
      const start = this.offset;
      let i = 0;
      for (; i < length; i++) {
        const code = value3.charCodeAt(i);
        if (code > 127) break;
        bytes[start + i] = code;
      }
      if (i === length) {
        const offset = start + length;
        if (nul) bytes[offset] = 0;
        this.offset = offset + (nul ? 1 : 0);
        return;
      }
    }
    this.reserve(length * 3 + (nul ? 1 : 0));
    this.offset += textEncoder2.encodeInto(value3, this.bytes.subarray(this.offset)).written;
    if (nul) this.bytes[this.offset++] = 0;
  }
  cString(value3) {
    this.utf8(value3, true);
  }
  finish() {
    const value3 = view(this.bytes.buffer, this.bytes.byteOffset + this.start, this.offset - this.start);
    if (this.bytes.length > this.poolSize) {
      this.bytes = new Uint8Array(this.poolSize);
      this.view = new DataView(this.bytes.buffer);
      this.start = 0;
      this.offset = 0;
    } else {
      this.start = this.offset;
    }
    return value3;
  }
};
var emptyBytes = /* @__PURE__ */ new Uint8Array(0);
var Reader = class {
  bytes = emptyBytes;
  /** The backing store of `bytes` and its offset into it, resolved per message. */
  store = emptyBytes.buffer;
  base = 0;
  offset = 0;
  limit = 0;
  reset(bytes, offset, limit) {
    this.bytes = bytes;
    this.store = bytes.buffer;
    this.base = bytes.byteOffset;
    this.offset = offset;
    this.limit = limit;
  }
  require(size) {
    if (size < 0) {
      throw new ParseError({
        message: `Invalid read of ${size} byte(s)`
      });
    }
    if (this.offset + size > this.limit) {
      throw new ParseError({
        message: `Truncated message: expected ${size} more byte(s)`
      });
    }
  }
  uint8() {
    this.require(1);
    return this.bytes[this.offset++];
  }
  int16() {
    this.require(2);
    const bytes = this.bytes;
    const offset = this.offset;
    this.offset = offset + 2;
    return (bytes[offset] << 8 | bytes[offset + 1]) << 16 >> 16;
  }
  int32() {
    this.require(4);
    const bytes = this.bytes;
    const offset = this.offset;
    this.offset = offset + 4;
    return bytes[offset] << 24 | bytes[offset + 1] << 16 | bytes[offset + 2] << 8 | bytes[offset + 3];
  }
  uint32() {
    return this.int32() >>> 0;
  }
  raw(size) {
    this.require(size);
    const value3 = view(this.store, this.base + this.offset, size);
    this.offset += size;
    return value3;
  }
  rest() {
    return this.raw(this.limit - this.offset);
  }
  cString() {
    const end2 = this.bytes.indexOf(0, this.offset);
    if (end2 === -1 || end2 >= this.limit) {
      throw new ParseError({
        message: "Unterminated string"
      });
    }
    const value3 = decodeUtf82(this.bytes, this.offset, end2 - this.offset);
    this.offset = end2 + 1;
    return value3;
  }
};
var asciiDecodeLimit = 10;
var utf8Slice = globalThis.Buffer?.prototype?.utf8Slice;
var decodeUtf82 = (bytes, offset, size) => {
  if (size <= asciiDecodeLimit) {
    let text3 = "";
    let index = 0;
    for (; index < size; index++) {
      const code = bytes[offset + index];
      if (code > 127) break;
      text3 += String.fromCharCode(code);
    }
    if (index === size) return text3;
  }
  if (utf8Slice !== void 0) {
    const text3 = utf8Slice.call(bytes, offset, offset + size);
    if (text3.indexOf("\uFFFD") === -1) return text3;
  }
  try {
    return textDecoder2.decode(view(bytes.buffer, bytes.byteOffset + offset, size));
  } catch {
    throw new ParseError({
      message: "Invalid UTF-8 in message"
    });
  }
};
var sharedWriter = /* @__PURE__ */ new Writer(8192);
var begin = (type) => {
  const writer = sharedWriter;
  writer.begin();
  writer.reserve(5);
  const bytes = writer.bytes;
  const offset = writer.offset;
  bytes[offset] = type;
  writer.offset = offset + 5;
  return writer;
};
var end = () => {
  sharedWriter.setInt32(sharedWriter.start + 1, sharedWriter.offset - sharedWriter.start - 1);
  return sharedWriter.finish();
};
var empty = (type) => {
  const writer = begin(type);
  writer.setInt32(writer.start + 1, 4);
  return writer.finish();
};
var targetByte = (target) => target === "statement" ? 83 : 80;
var requireInt16Count = (count, name3) => {
  if (count > 32767) throw new EncodeError({
    message: `${name3} count exceeds 32767: ${count}`
  });
  return count;
};
var encodeResult = (evaluate) => {
  try {
    return Result2.succeed(evaluate());
  } catch (error) {
    if (error instanceof EncodeError) return Result2.fail(error);
    throw error;
  }
};
var encodeParseUnsafe = (options) => {
  const writer = begin(80);
  writer.cString(options.name);
  writer.cString(options.query);
  const parameterTypes = options.parameterTypes;
  const count = requireInt16Count(parameterTypes.length, "Parse parameter type");
  writer.reserve(2 + count * 4);
  const bytes = writer.bytes;
  let offset = writer.offset;
  bytes[offset] = count >>> 8;
  bytes[offset + 1] = count;
  offset += 2;
  for (let index = 0; index < count; index++) {
    const oid2 = parameterTypes[index];
    bytes[offset] = oid2 >>> 24;
    bytes[offset + 1] = oid2 >>> 16;
    bytes[offset + 2] = oid2 >>> 8;
    bytes[offset + 3] = oid2;
    offset += 4;
  }
  writer.offset = offset;
  return end();
};
var encodeParse = (options) => encodeResult(() => encodeParseUnsafe(options));
var valueWriterUnsafe = /* @__PURE__ */ Symbol.for("@effect/sql-pg/PgProtocol/ValueWriter/unsafe");
var makeBindEncoder = (writeParameter2, textFormat) => (options) => {
  try {
    const writer = begin(66);
    writer.cString(options.portal);
    writer.cString(options.statement);
    const parameters = options.parameters;
    const count = requireInt16Count(parameters.length, "Bind parameter");
    let textCount = 0;
    if (textFormat !== void 0) {
      for (let index = 0; index < count; index++) {
        if (textFormat(parameters[index])) textCount++;
      }
    }
    if (textCount === 0 || textCount === count) {
      const code = textCount === 0 ? 1 : 0;
      writer.reserve(6);
      const header = writer.bytes;
      const headerOffset = writer.offset;
      header[headerOffset] = 0;
      header[headerOffset + 1] = 1;
      header[headerOffset + 2] = 0;
      header[headerOffset + 3] = code;
      header[headerOffset + 4] = count >>> 8;
      header[headerOffset + 5] = count;
      writer.offset = headerOffset + 6;
    } else {
      writer.int16(count);
      for (let index = 0; index < count; index++) {
        writer.int16(textFormat(parameters[index]) ? 0 : 1);
      }
      writer.int16(count);
    }
    const writeUnsafe = writeParameter2[valueWriterUnsafe];
    for (let index = 0; index < count; index++) {
      const token = writer.beginLength();
      writer.isNull = false;
      if (writeUnsafe === void 0) {
        const written = writeParameter2(writer, parameters[index]);
        if (Result2.isFailure(written)) return Result2.fail(written.failure);
      } else {
        writeUnsafe(writer, parameters[index]);
      }
      if (writer.isNull) {
        writer.isNull = false;
        writer.offset = writer.start + token;
        writer.int32(-1);
      } else {
        writer.endLength(token);
      }
    }
    writer.reserve(4);
    const trailer = writer.bytes;
    const trailerOffset = writer.offset;
    trailer[trailerOffset] = 0;
    trailer[trailerOffset + 1] = 1;
    trailer[trailerOffset + 2] = 0;
    trailer[trailerOffset + 3] = 1;
    writer.offset = trailerOffset + 4;
    return Result2.succeed(end());
  } catch (error) {
    if (error instanceof EncodeError) return Result2.fail(error);
    throw error;
  }
};
var encodeExecute = (options) => {
  const writer = begin(69);
  writer.cString(options.portal);
  writer.int32(options.maxRows);
  return end();
};
var encodeDescribe = (options) => {
  const writer = begin(68);
  writer.uint8(targetByte(options.target));
  writer.cString(options.name);
  return end();
};
var encodeClose = (options) => {
  const writer = begin(67);
  writer.uint8(targetByte(options.target));
  writer.cString(options.name);
  return end();
};
var encodeSync = () => empty(83);
var encodeTerminate = () => empty(88);
var encodePasswordMessage = (options) => {
  const writer = begin(112);
  writer.cString(options.password);
  return end();
};
var encodeSASLInitialResponse = (options) => {
  const writer = begin(112);
  writer.cString(options.mechanism);
  if (options.initialResponse === null) {
    writer.int32(-1);
  } else {
    writer.int32(options.initialResponse.length);
    writer.raw(options.initialResponse);
  }
  return end();
};
var encodeSASLResponse = (options) => {
  const writer = begin(112);
  writer.raw(options.data);
  return end();
};
var PROTOCOL_VERSION_3_0 = 196608;
var SSL_REQUEST_CODE = 80877103;
var CANCEL_REQUEST_CODE = 80877102;
var encodeSslRequest = () => {
  sharedWriter.begin();
  sharedWriter.int32(8);
  sharedWriter.int32(SSL_REQUEST_CODE);
  return sharedWriter.finish();
};
var decodeSslResponse = (byte) => byte === 83 ? Result2.succeed("S") : byte === 78 ? Result2.succeed("N") : Result2.fail(new ParseError({
  message: `Invalid SSLRequest response byte: ${byte}`
}));
var encodeStartupMessage = (parameters) => {
  const writer = sharedWriter;
  writer.begin();
  writer.int32(0);
  writer.int32(PROTOCOL_VERSION_3_0);
  for (const [key, value3] of Object.entries(parameters)) {
    if (value3 === void 0) continue;
    writer.cString(key);
    writer.cString(value3);
  }
  if (parameters.client_encoding === void 0) {
    writer.cString("client_encoding");
    writer.cString("UTF8");
  }
  writer.uint8(0);
  writer.setInt32(writer.start, writer.offset - writer.start);
  return writer.finish();
};
var encodeCancelRequest = (options) => {
  const writer = sharedWriter;
  writer.begin();
  writer.int32(16);
  writer.int32(CANCEL_REQUEST_CODE);
  writer.int32(options.pid);
  writer.int32(options.secret);
  return writer.finish();
};
var BackendType = {
  NotificationResponse: 65,
  // A
  CommandComplete: 67,
  // C
  DataRow: 68,
  // D
  ErrorResponse: 69,
  // E
  CopyInResponse: 71,
  // G
  CopyOutResponse: 72,
  // H
  EmptyQueryResponse: 73,
  // I
  BackendKeyData: 75,
  // K
  NoticeResponse: 78,
  // N
  Authentication: 82,
  // R
  ParameterStatus: 83,
  // S
  RowDescription: 84,
  // T
  CopyBothResponse: 87,
  // W
  ReadyForQuery: 90,
  // Z
  CopyDone: 99,
  // c
  CopyData: 100,
  // d
  NoData: 110,
  // n
  PortalSuspended: 115,
  // s
  ParameterDescription: 116,
  // t
  NegotiateProtocolVersion: 118,
  // v
  ParseComplete: 49,
  // 1
  BindComplete: 50,
  // 2
  CloseComplete: 51
  // 3
};
var errorFieldNames = {
  S: "severity",
  V: "severityUnlocalized",
  C: "code",
  M: "message",
  D: "detail",
  H: "hint",
  P: "position",
  p: "internalPosition",
  q: "internalQuery",
  W: "where",
  s: "schema",
  t: "table",
  c: "column",
  d: "dataType",
  n: "constraint",
  F: "file",
  L: "line",
  R: "routine"
};
var decodeAuthentication = (reader) => {
  const method = reader.int32();
  switch (method) {
    case 0:
      return {
        _tag: "AuthenticationOk"
      };
    case 3:
      return {
        _tag: "AuthenticationCleartextPassword"
      };
    case 5:
      return {
        _tag: "AuthenticationMD5Password",
        salt: reader.raw(4)
      };
    case 10: {
      const mechanisms = [];
      for (; ; ) {
        const mechanism = reader.cString();
        if (mechanism === "") break;
        mechanisms.push(mechanism);
      }
      return {
        _tag: "AuthenticationSASL",
        mechanisms
      };
    }
    case 11:
      return {
        _tag: "AuthenticationSASLContinue",
        data: reader.rest()
      };
    case 12:
      return {
        _tag: "AuthenticationSASLFinal",
        data: reader.rest()
      };
    default:
      return {
        _tag: "AuthenticationUnsupported",
        method,
        payload: reader.rest()
      };
  }
};
var decodeErrorFields = (reader) => {
  const fields = {};
  for (; ; ) {
    const code = reader.uint8();
    if (code === 0) break;
    const key = String.fromCharCode(code);
    fields[errorFieldNames[key] ?? key] = reader.cString();
  }
  return fields;
};
var requireNonNegativeCount = (count, name3) => {
  if (count < 0) {
    throw new ParseError({
      message: `Invalid ${name3} count: ${count}`
    });
  }
  return count;
};
var decodeCopyResponse = (reader) => {
  const format3 = reader.uint8();
  const count = requireNonNegativeCount(reader.int16(), "COPY column");
  const columnFormats = new Array(count);
  for (let i = 0; i < count; i++) {
    columnFormats[i] = reader.int16();
  }
  return {
    format: format3,
    columnFormats
  };
};
var decodeDataRow = (bytes, store, base, offset, limit, readField) => {
  if (offset + 2 > limit) {
    throw new ParseError({
      message: "Truncated message: expected 2 more byte(s)"
    });
  }
  const count = (bytes[offset] << 8 | bytes[offset + 1]) << 16 >> 16;
  if (count < 0) {
    throw new ParseError({
      message: `Invalid DataRow field count: ${count}`
    });
  }
  const values = new Array(count);
  let position = offset + 2;
  for (let i = 0; i < count; i++) {
    if (position + 4 > limit) {
      throw new ParseError({
        message: "Truncated message: expected 4 more byte(s)"
      });
    }
    const size = bytes[position] << 24 | bytes[position + 1] << 16 | bytes[position + 2] << 8 | bytes[position + 3];
    position += 4;
    if (size < 0) {
      if (size < -1) {
        throw new ParseError({
          message: `Invalid DataRow field length: ${size}`
        });
      }
      values[i] = readField === void 0 ? null : readField(bytes, position, -1, i);
      continue;
    }
    const next = position + size;
    if (next > limit) {
      throw new ParseError({
        message: `Truncated message: expected ${size} more byte(s)`
      });
    }
    values[i] = readField === void 0 ? view(store, base + position, size) : readField(bytes, position, size, i);
    position = next;
  }
  if (position !== limit) {
    throw new ParseError({
      message: `DataRow has ${limit - position} trailing byte(s)`
    });
  }
  return {
    _tag: "DataRow",
    values
  };
};
var decodeBackend = (type, reader) => {
  switch (type) {
    case BackendType.Authentication:
      return decodeAuthentication(reader);
    case BackendType.ParameterStatus:
      return {
        _tag: "ParameterStatus",
        name: reader.cString(),
        value: reader.cString()
      };
    case BackendType.BackendKeyData:
      return {
        _tag: "BackendKeyData",
        pid: reader.int32(),
        secret: reader.int32()
      };
    case BackendType.ReadyForQuery: {
      const status = String.fromCharCode(reader.uint8());
      if (status !== "I" && status !== "T" && status !== "E") {
        throw new ParseError({
          message: `Invalid ReadyForQuery status: ${status}`
        });
      }
      return {
        _tag: "ReadyForQuery",
        status
      };
    }
    case BackendType.RowDescription: {
      const count = requireNonNegativeCount(reader.int16(), "RowDescription field");
      const fields = new Array(count);
      for (let i = 0; i < count; i++) {
        fields[i] = {
          name: reader.cString(),
          tableOid: reader.uint32(),
          columnAttributeNumber: reader.int16(),
          dataTypeOid: reader.uint32(),
          dataTypeSize: reader.int16(),
          typeModifier: reader.int32(),
          format: reader.int16()
        };
      }
      return {
        _tag: "RowDescription",
        fields
      };
    }
    case BackendType.DataRow:
      return decodeDataRow(reader.bytes, reader.store, reader.base, reader.offset, reader.limit, void 0);
    case BackendType.CommandComplete:
      return {
        _tag: "CommandComplete",
        commandTag: reader.cString()
      };
    case BackendType.EmptyQueryResponse:
      return {
        _tag: "EmptyQueryResponse"
      };
    case BackendType.NoData:
      return {
        _tag: "NoData"
      };
    case BackendType.ParseComplete:
      return {
        _tag: "ParseComplete"
      };
    case BackendType.BindComplete:
      return {
        _tag: "BindComplete"
      };
    case BackendType.CloseComplete:
      return {
        _tag: "CloseComplete"
      };
    case BackendType.PortalSuspended:
      return {
        _tag: "PortalSuspended"
      };
    case BackendType.ParameterDescription: {
      const count = requireNonNegativeCount(reader.int16(), "ParameterDescription parameter");
      const parameterTypes = new Array(count);
      for (let i = 0; i < count; i++) {
        parameterTypes[i] = reader.uint32();
      }
      return {
        _tag: "ParameterDescription",
        parameterTypes
      };
    }
    case BackendType.ErrorResponse:
      return {
        _tag: "ErrorResponse",
        fields: decodeErrorFields(reader)
      };
    case BackendType.NoticeResponse:
      return {
        _tag: "NoticeResponse",
        fields: decodeErrorFields(reader)
      };
    case BackendType.NotificationResponse:
      return {
        _tag: "NotificationResponse",
        pid: reader.int32(),
        channel: reader.cString(),
        payload: reader.cString()
      };
    case BackendType.NegotiateProtocolVersion: {
      const minorVersion = reader.int32();
      const count = requireNonNegativeCount(reader.int32(), "NegotiateProtocolVersion option");
      const unrecognizedOptions = new Array(count);
      for (let i = 0; i < count; i++) {
        unrecognizedOptions[i] = reader.cString();
      }
      return {
        _tag: "NegotiateProtocolVersion",
        minorVersion,
        unrecognizedOptions
      };
    }
    case BackendType.CopyInResponse:
      return {
        _tag: "CopyInResponse",
        ...decodeCopyResponse(reader)
      };
    case BackendType.CopyOutResponse:
      return {
        _tag: "CopyOutResponse",
        ...decodeCopyResponse(reader)
      };
    case BackendType.CopyBothResponse:
      return {
        _tag: "CopyBothResponse",
        ...decodeCopyResponse(reader)
      };
    case BackendType.CopyData:
      return {
        _tag: "CopyData",
        data: reader.rest()
      };
    case BackendType.CopyDone:
      return {
        _tag: "CopyDone"
      };
    default:
      return {
        _tag: "Unknown",
        type,
        payload: reader.rest()
      };
  }
};

// node_modules/.bun/@effect+sql-pg@4.0.0+a594d97e083afb95/node_modules/@effect/sql-pg/dist/PgTypes.js
import * as Data3 from "effect/Data";
import * as IpInterface from "effect/net/IpInterface";
import * as IpNetwork from "effect/net/IpNetwork";
import * as NetAddress from "effect/net/NetAddress";
import * as Result3 from "effect/Result";
var CodecError = class extends (/* @__PURE__ */ Data3.TaggedError("PgTypesCodecError")) {
};
var fail5 = (message) => {
  throw new CodecError({
    message
  });
};
var result2 = (evaluate) => {
  try {
    return Result3.succeed(evaluate());
  } catch (error) {
    if (error instanceof CodecError) return Result3.fail(error);
    throw error;
  }
};
var textEncoder3 = /* @__PURE__ */ new TextEncoder();
var textDecoder3 = /* @__PURE__ */ new TextDecoder("utf-8", {
  fatal: true
});
var writeInt16 = (bytes, offset, value3) => {
  bytes[offset] = value3 >>> 8;
  bytes[offset + 1] = value3;
};
var readInt16 = (bytes, offset) => (bytes[offset] << 8 | bytes[offset + 1]) << 16 >> 16;
var readUint16 = (bytes, offset) => bytes[offset] << 8 | bytes[offset + 1];
var writeInt32 = (bytes, offset, value3) => {
  bytes[offset] = value3 >>> 24;
  bytes[offset + 1] = value3 >>> 16;
  bytes[offset + 2] = value3 >>> 8;
  bytes[offset + 3] = value3;
};
var readInt32 = (bytes, offset) => bytes[offset] << 24 | bytes[offset + 1] << 16 | bytes[offset + 2] << 8 | bytes[offset + 3];
var writeInt64 = (bytes, offset, value3) => {
  const high = Math.floor(value3 / 4294967296);
  writeInt32(bytes, offset, high);
  writeInt32(bytes, offset + 4, value3 - high * 4294967296);
};
var readUint32 = (bytes, offset) => (bytes[offset] << 24 | bytes[offset + 1] << 16 | bytes[offset + 2] << 8 | bytes[offset + 3]) >>> 0;
var scratch4 = /* @__PURE__ */ new ArrayBuffer(4);
var scratchView4 = /* @__PURE__ */ new DataView(scratch4);
var scratchBytes4 = /* @__PURE__ */ new Uint8Array(scratch4);
var scratch8 = /* @__PURE__ */ new ArrayBuffer(8);
var scratchView8 = /* @__PURE__ */ new DataView(scratch8);
var scratchBytes8 = /* @__PURE__ */ new Uint8Array(scratch8);
var stage8 = (bytes, offset) => {
  scratchView8.setInt32(0, readInt32(bytes, offset));
  scratchView8.setInt32(4, readInt32(bytes, offset + 4));
};
var twoDigits = /* @__PURE__ */ Array.from({
  length: 100
}, (_, value3) => (value3 < 10 ? "0" : "") + value3);
var asciiEncodeLimit2 = 48;
var scratchUtf8 = /* @__PURE__ */ new Uint8Array(4096);
var scratchUtf8Limit = 64 * 1024;
var encodeUtf8Scratch = (text3) => {
  const capacity = text3.length * 3;
  if (capacity > scratchUtf8Limit) return -1;
  if (capacity > scratchUtf8.length) scratchUtf8 = new Uint8Array(capacity);
  return textEncoder3.encodeInto(text3, scratchUtf8).written;
};
var encodeUtf8 = (text3) => {
  const length = text3.length;
  if (length <= asciiEncodeLimit2) {
    const bytes = new Uint8Array(length);
    let i = 0;
    for (; i < length; i++) {
      const code = text3.charCodeAt(i);
      if (code > 127) break;
      bytes[i] = code;
    }
    if (i === length) return bytes;
  }
  const written = encodeUtf8Scratch(text3);
  return written === -1 ? textEncoder3.encode(text3) : scratchUtf8.slice(0, written);
};
var encodeUtf8Prefixed = (text3, prefix) => {
  const length = text3.length;
  if (length <= asciiEncodeLimit2) {
    const bytes2 = new Uint8Array(prefix + length);
    let i = 0;
    for (; i < length; i++) {
      const code = text3.charCodeAt(i);
      if (code > 127) break;
      bytes2[prefix + i] = code;
    }
    if (i === length) return bytes2;
  }
  const written = encodeUtf8Scratch(text3);
  if (written === -1) {
    const body = textEncoder3.encode(text3);
    const bytes2 = new Uint8Array(prefix + body.length);
    bytes2.set(body, prefix);
    return bytes2;
  }
  const bytes = new Uint8Array(prefix + written);
  bytes.set(scratchUtf8.subarray(0, written), prefix);
  return bytes;
};
var region = (bytes, offset, size) => offset === 0 && size === bytes.length ? bytes : new Uint8Array(bytes.buffer, bytes.byteOffset + offset, size);
var asciiDecodeLimit2 = 10;
var utf8Slice2 = globalThis.Buffer?.prototype?.utf8Slice;
var decodeUtf83 = (bytes, offset, size) => {
  if (size <= asciiDecodeLimit2) {
    let text3 = "";
    let index = 0;
    for (; index < size; index++) {
      const code = bytes[offset + index];
      if (code > 127) break;
      text3 += String.fromCharCode(code);
    }
    if (index === size) return text3;
  }
  if (utf8Slice2 !== void 0) {
    const text3 = utf8Slice2.call(bytes, offset, offset + size);
    if (text3.indexOf("\uFFFD") === -1) return text3;
  }
  try {
    return textDecoder3.decode(region(bytes, offset, size));
  } catch {
    return fail5("Invalid UTF-8 in text value");
  }
};
var requireSize = (size, expected, name3) => {
  if (size !== expected) {
    fail5(`Expected ${expected} byte(s) for ${name3}, received ${size}`);
  }
};
var requireString = (value3, name3) => typeof value3 === "string" ? value3 : fail5(`Expected a string for ${name3}`);
var requireBigInt = (value3, name3) => typeof value3 === "bigint" ? value3 : fail5(`Expected a bigint for ${name3}`);
var requireNumber = (value3, name3) => typeof value3 === "number" ? value3 : fail5(`Expected a number for ${name3}`);
var requireInteger = (value3, name3, min, max) => {
  const num = requireNumber(value3, name3);
  if (!Number.isInteger(num) || num < min || num > max) {
    fail5(`Expected an integer in [${min}, ${max}] for ${name3}, received ${num}`);
  }
  return num;
};
var ZERO = /* @__PURE__ */ BigInt(0);
var THOUSAND = /* @__PURE__ */ BigInt(1e3);
var INT64_MIN = /* @__PURE__ */ BigInt("-9223372036854775808");
var INT64_MAX = /* @__PURE__ */ BigInt("9223372036854775807");
var INT32_MIN = -2147483648;
var INT32_MAX = 2147483647;
var PG_EPOCH_MS = 9466848e5;
var PG_EPOCH_MICROS = 9466848e8;
var PG_EPOCH_DAYS = 10957;
var MAX_EXACT = 9007199254740992;
var MAX_EXACT_HIGH = 2097152;
var MAX_TIME_MICROS_NUMBER = 864e8;
var TZDISP_LIMIT_SECONDS = 57600;
var OID = {
  bool: 16,
  bytea: 17,
  name: 19,
  int8: 20,
  int2: 21,
  int4: 23,
  text: 25,
  oid: 26,
  json: 114,
  cidr: 650,
  float4: 700,
  float8: 701,
  inet: 869,
  bpchar: 1042,
  varchar: 1043,
  date: 1082,
  time: 1083,
  timestamp: 1114,
  timestamptz: 1184,
  timetz: 1266,
  numeric: 1700,
  regclass: 2205,
  uuid: 2950,
  jsonb: 3802,
  boolArray: 1e3,
  byteaArray: 1001,
  nameArray: 1003,
  int8Array: 1016,
  int2Array: 1005,
  int4Array: 1007,
  textArray: 1009,
  oidArray: 1028,
  jsonArray: 199,
  cidrArray: 651,
  float4Array: 1021,
  float8Array: 1022,
  inetArray: 1041,
  bpcharArray: 1014,
  varcharArray: 1015,
  dateArray: 1182,
  timeArray: 1183,
  timestampArray: 1115,
  timestamptzArray: 1185,
  timetzArray: 1270,
  numericArray: 1231,
  regclassArray: 2210,
  uuidArray: 2951,
  jsonbArray: 3807
};
var arrayToElement = /* @__PURE__ */ new Map([[OID.boolArray, OID.bool], [OID.byteaArray, OID.bytea], [OID.nameArray, OID.name], [OID.int8Array, OID.int8], [OID.int2Array, OID.int2], [OID.int4Array, OID.int4], [OID.textArray, OID.text], [OID.oidArray, OID.oid], [OID.jsonArray, OID.json], [OID.cidrArray, OID.cidr], [OID.float4Array, OID.float4], [OID.float8Array, OID.float8], [OID.inetArray, OID.inet], [OID.bpcharArray, OID.bpchar], [OID.varcharArray, OID.varchar], [OID.dateArray, OID.date], [OID.timeArray, OID.time], [OID.timestampArray, OID.timestamp], [OID.timestamptzArray, OID.timestamptz], [OID.timetzArray, OID.timetz], [OID.numericArray, OID.numeric], [OID.regclassArray, OID.regclass], [OID.uuidArray, OID.uuid], [OID.jsonbArray, OID.jsonb]]);
var elementToArray = /* @__PURE__ */ new Map(/* @__PURE__ */ Array.from(arrayToElement, ([array, element]) => [element, array]));
var arrayOidFor = (elementOid, registry) => registry === void 0 ? elementToArray.get(elementOid) : getRegistryState(registry).elementToArray.get(elementOid);
var pad = (value3, size) => String(value3).padStart(size, "0");
var civilFromDays = (days) => {
  const z = days + 719468;
  const era = Math.floor(z / 146097);
  const doe = z - era * 146097;
  const yoe = Math.floor((doe - Math.floor(doe / 1460) + Math.floor(doe / 36524) - Math.floor(doe / 146096)) / 365);
  const y = yoe + era * 400;
  const doy = doe - (365 * yoe + Math.floor(yoe / 4) - Math.floor(yoe / 100));
  const mp = Math.floor((5 * doy + 2) / 153);
  const day = doy - Math.floor((153 * mp + 2) / 5) + 1;
  const month = mp < 10 ? mp + 3 : mp - 9;
  return {
    year: month <= 2 ? y + 1 : y,
    month,
    day
  };
};
var daysFromCivil = (year, month, day) => {
  const y = month <= 2 ? year - 1 : year;
  const era = Math.floor(y / 400);
  const yoe = y - era * 400;
  const mp = month > 2 ? month - 3 : month + 9;
  const doy = Math.floor((153 * mp + 2) / 5) + day - 1;
  const doe = yoe * 365 + Math.floor(yoe / 4) - Math.floor(yoe / 100) + doy;
  return era * 146097 + doe - 719468;
};
var monthLengths = [0, 31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
var isLeapYear = (year) => year % 4 === 0 && year % 100 !== 0 || year % 400 === 0;
var twoDigitsAt = (text3, at) => {
  const tens = text3.charCodeAt(at) - 48;
  const units = text3.charCodeAt(at + 1) - 48;
  return tens >= 0 && tens <= 9 && units >= 0 && units <= 9 ? tens * 10 + units : -1;
};
var parseDate = (text3) => {
  const yearStart = text3.charCodeAt(0) === 45 ? 1 : 0;
  const yearEnd = text3.length - 6;
  if (yearEnd - yearStart < 4 || text3.charCodeAt(yearEnd) !== 45 || text3.charCodeAt(yearEnd + 3) !== 45) {
    return fail5(`Expected a YYYY-MM-DD date, received "${text3}"`);
  }
  let year = 0;
  for (let index = yearStart; index < yearEnd; index++) {
    const digit = text3.charCodeAt(index) - 48;
    if (digit < 0 || digit > 9) {
      return fail5(`Expected a YYYY-MM-DD date, received "${text3}"`);
    }
    year = year * 10 + digit;
  }
  const month = twoDigitsAt(text3, yearEnd + 1);
  const day = twoDigitsAt(text3, yearEnd + 4);
  if (month === -1 || day === -1) {
    return fail5(`Expected a YYYY-MM-DD date, received "${text3}"`);
  }
  if (yearStart === 1) year = -year;
  if (!Number.isFinite(year)) {
    return fail5(`date out of range: "${text3}"`);
  }
  const monthLength = month === 2 && isLeapYear(year) ? 29 : monthLengths[month];
  if (month < 1 || month > 12 || day < 1 || day > monthLength) {
    return fail5(`Invalid date "${text3}"`);
  }
  return daysFromCivil(year, month, day);
};
var formatDate = (days) => {
  const {
    day,
    month,
    year
  } = civilFromDays(days);
  const yearText = year < 0 ? `-${pad(-year, 4)}` : year < 1e4 ? twoDigits[year / 100 | 0] + twoDigits[year % 100] : String(year);
  return `${yearText}-${twoDigits[month]}-${twoDigits[day]}`;
};
var timeRegex = /^(\d{1,2}):(\d{2})(?::(\d{2})(?:\.(\d{1,6}))?)?$/;
var parseTimeOfDay = (text3) => {
  const match = timeRegex.exec(text3);
  if (match === null) {
    return fail5(`Expected a HH:MM[:SS[.ffffff]] time, received "${text3}"`);
  }
  const hours = Number(match[1]);
  const minutes = Number(match[2]);
  const seconds3 = match[3] === void 0 ? 0 : Number(match[3]);
  const fraction = match[4] === void 0 ? 0 : Number(match[4].padEnd(6, "0"));
  const micros = (hours * 3600 + minutes * 60 + seconds3) * 1e6 + fraction;
  if (hours > 24 || minutes > 59 || seconds3 > 60 || micros > MAX_TIME_MICROS_NUMBER) {
    return fail5(`Invalid time "${text3}"`);
  }
  return micros;
};
var formatTimeOfDay = (micros) => {
  const seconds3 = micros / 1e6 | 0;
  const fraction = micros - seconds3 * 1e6;
  const base = `${twoDigits[seconds3 / 3600 | 0]}:${twoDigits[(seconds3 / 60 | 0) % 60]}:${twoDigits[seconds3 % 60]}`;
  if (fraction === 0) return base;
  return `${base}.${pad(fraction, 6).replace(/0+$/, "")}`;
};
var zoneRegex = /^(?:Z|([+-])(\d{2})(?::?(\d{2}))?(?::?(\d{2}))?)$/;
var parseZone = (text3) => {
  const match = zoneRegex.exec(text3);
  if (match === null) {
    return fail5(`Expected a time zone offset, received "${text3}"`);
  }
  if (match[1] === void 0) return 0;
  const minutes = match[3] === void 0 ? 0 : Number(match[3]);
  const trailingSeconds = match[4] === void 0 ? 0 : Number(match[4]);
  const seconds3 = Number(match[2]) * 3600 + minutes * 60 + trailingSeconds;
  if (minutes > 59 || trailingSeconds > 59 || seconds3 >= TZDISP_LIMIT_SECONDS) {
    return fail5(`Time zone offset out of range, received "${text3}"`);
  }
  return match[1] === "-" ? -seconds3 : seconds3;
};
var formatZone = (secondsEast) => {
  const sign = secondsEast < 0 ? "-" : "+";
  const total = Math.abs(secondsEast);
  return `${sign}${pad(total / 3600 | 0, 2)}:${twoDigits[(total / 60 | 0) % 60]}`;
};
var NUMERIC_POS = 0;
var NUMERIC_NEG = 16384;
var NUMERIC_NAN = 49152;
var NUMERIC_PINF = 53248;
var NUMERIC_NINF = 61440;
var numericRegex = /^([+-])?(\d*)(?:\.(\d*))?(?:[eE]([+-]?\d+))?$/;
var encodeNumeric = (value3) => {
  const text3 = requireString(value3, "numeric");
  if (text3 === "NaN") return numericSpecial(NUMERIC_NAN);
  if (text3 === "Infinity") return numericSpecial(NUMERIC_PINF);
  if (text3 === "-Infinity") return numericSpecial(NUMERIC_NINF);
  const match = numericRegex.exec(text3);
  if (match === null || (match[2] ?? "") + (match[3] ?? "") === "") {
    return fail5(`Expected a decimal numeric string, received "${text3}"`);
  }
  const exponent = match[4] === void 0 ? 0 : Number(match[4]);
  let digits = (match[2] ?? "") + (match[3] ?? "");
  let scale = (match[3] ?? "").length - exponent;
  if (scale < 0) {
    digits += "0".repeat(-scale);
    scale = 0;
  }
  if (scale > 16383) {
    return fail5(`numeric scale ${scale} exceeds the PostgreSQL maximum`);
  }
  const rightPad = (4 - scale % 4) % 4;
  digits += "0".repeat(rightPad);
  const fractionLength = scale + rightPad;
  const leftPad = (4 - (digits.length - fractionLength) % 4) % 4;
  digits = "0".repeat(leftPad) + digits;
  const groupAt = (index) => {
    const at = index * 4;
    return (digits.charCodeAt(at) - 48) * 1e3 + (digits.charCodeAt(at + 1) - 48) * 100 + (digits.charCodeAt(at + 2) - 48) * 10 + (digits.charCodeAt(at + 3) - 48);
  };
  const groupCount = digits.length / 4;
  let first = 0;
  while (first < groupCount && groupAt(first) === 0) first++;
  let last = groupCount;
  while (last > first && groupAt(last - 1) === 0) last--;
  const count = last - first;
  const weight = count === 0 ? 0 : (digits.length - fractionLength) / 4 - 1 - first;
  const sign = count > 0 && match[1] === "-" ? NUMERIC_NEG : NUMERIC_POS;
  const bytes = new Uint8Array(8 + count * 2);
  writeInt16(bytes, 0, count);
  writeInt16(bytes, 2, weight);
  writeInt16(bytes, 4, sign);
  writeInt16(bytes, 6, scale);
  for (let i = 0; i < count; i++) {
    writeInt16(bytes, 8 + i * 2, groupAt(first + i));
  }
  return bytes;
};
var numericSpecial = (sign) => {
  const bytes = new Uint8Array(8);
  writeInt16(bytes, 4, sign);
  return bytes;
};
var decodeNumeric = (bytes, offset, size) => {
  if (size < 8) return fail5("Truncated numeric value");
  const count = readInt16(bytes, offset);
  const weight = readInt16(bytes, offset + 2);
  const sign = readUint16(bytes, offset + 4);
  const scale = readInt16(bytes, offset + 6);
  if (sign === NUMERIC_NAN) return "NaN";
  if (sign === NUMERIC_PINF) return "Infinity";
  if (sign === NUMERIC_NINF) return "-Infinity";
  if (sign !== NUMERIC_POS && sign !== NUMERIC_NEG) {
    return fail5(`Invalid numeric sign: ${sign}`);
  }
  requireSize(size, 8 + count * 2, "numeric");
  const digits = offset + 8;
  const digitAt = (index) => {
    if (index < 0 || index >= count) return 0;
    const digit = readInt16(bytes, digits + index * 2);
    return digit >= 0 && digit <= 9999 ? digit : fail5(`Invalid numeric digit: ${digit}`);
  };
  let result3 = sign === NUMERIC_NEG ? "-" : "";
  if (weight < 0) {
    result3 += "0";
  } else {
    for (let i = 0; i <= weight; i++) {
      const digit = digitAt(i);
      if (i === 0) {
        result3 += String(digit);
      } else {
        result3 += twoDigits[digit / 100 | 0];
        result3 += twoDigits[digit % 100];
      }
    }
  }
  if (scale > 0) {
    let fraction = "";
    for (let i = weight + 1; fraction.length < scale; i++) {
      const digit = digitAt(i);
      fraction += twoDigits[digit / 100 | 0];
      fraction += twoDigits[digit % 100];
    }
    result3 += `.${fraction.slice(0, scale)}`;
  }
  return result3;
};
var PGSQL_AF_INET = 2;
var PGSQL_AF_INET6 = 3;
var encodeInet = (value3, isCidr) => {
  const type = isCidr ? "cidr" : "inet";
  const text3 = requireString(value3, type);
  const parsed = IpInterface.fromString(text3);
  if (Result3.isFailure(parsed)) return fail5(`Invalid ${type} value ${JSON.stringify(text3)}: ${parsed.failure.message}`);
  const address = parsed.success.address;
  const bits = parsed.success.prefixLength;
  if (isCidr) {
    const network = IpNetwork.make(address, bits);
    if (Result3.isFailure(network)) {
      return fail5(`Invalid ${type} value ${JSON.stringify(text3)}: ${network.failure.message}`);
    }
  }
  const octets = NetAddress.isIpv4Address(address) ? NetAddress.ipv4ToOctets(address) : NetAddress.ipv6ToOctets(address);
  const result3 = new Uint8Array(4 + octets.length);
  result3[0] = NetAddress.isIpv4Address(address) ? PGSQL_AF_INET : PGSQL_AF_INET6;
  result3[1] = bits;
  result3[2] = isCidr ? 1 : 0;
  result3[3] = octets.length;
  result3.set(octets, 4);
  return result3;
};
var decodeInet = (bytes, offset, size) => {
  if (size < 4) return fail5("Truncated inet value");
  const family = bytes[offset];
  const bits = bytes[offset + 1];
  const cidrFlag = bytes[offset + 2];
  if (cidrFlag > 1) return fail5(`Invalid inet CIDR flag: ${cidrFlag}`);
  const isCidr = cidrFlag === 1;
  const addressSize = bytes[offset + 3];
  const expected = family === PGSQL_AF_INET ? 4 : family === PGSQL_AF_INET6 ? 16 : -1;
  if (expected === -1 || addressSize !== expected) {
    return fail5(`Invalid inet address family ${family} with ${addressSize} byte(s)`);
  }
  requireSize(size, 4 + addressSize, "inet");
  if (bits > addressSize * 8) return fail5(`Invalid inet netmask length: ${bits}`);
  const addressBytes = bytes.slice(offset + 4, offset + 4 + addressSize);
  const address = family === PGSQL_AF_INET ? NetAddress.ipv4FromBytesUnsafe(addressBytes) : NetAddress.ipv6FromBytesUnsafe(addressBytes);
  if (isCidr) {
    const network = IpNetwork.make(address, bits);
    if (Result3.isFailure(network)) return fail5(network.failure.message);
    return IpNetwork.format(network.success);
  }
  return bits === addressSize * 8 ? NetAddress.formatIp(address) : IpInterface.format(IpInterface.makeUnsafe(address, bits));
};
var hexDigits = "0123456789abcdef";
var hexValues = /* @__PURE__ */ new Int8Array(128).fill(-1);
for (let i = 0; i < 16; i++) {
  hexValues[/* @__PURE__ */ hexDigits.charCodeAt(i)] = i;
  hexValues[/* @__PURE__ */ "0123456789ABCDEF".charCodeAt(i)] = i;
}
var hexHigh = /* @__PURE__ */ (() => {
  const codes = /* @__PURE__ */ new Uint8Array(256);
  for (let i = 0; i < 256; i++) codes[i] = /* @__PURE__ */ hexDigits.charCodeAt(i >> 4);
  return codes;
})();
var hexLow = /* @__PURE__ */ (() => {
  const codes = /* @__PURE__ */ new Uint8Array(256);
  for (let i = 0; i < 256; i++) codes[i] = /* @__PURE__ */ hexDigits.charCodeAt(i & 15);
  return codes;
})();
var uuidOffsets = [0, 2, 4, 6, 9, 11, 14, 16, 19, 21, 24, 26, 28, 30, 32, 34];
var hexAt = (text3, at) => {
  const code = text3.charCodeAt(at);
  return code < 128 ? hexValues[code] : -1;
};
var uuidWord = /* @__PURE__ */ new Int32Array(4);
var uuidWords = (value3) => {
  const text3 = requireString(value3, "uuid");
  if (text3.length !== 36 || text3.charCodeAt(8) !== 45 || text3.charCodeAt(13) !== 45 || text3.charCodeAt(18) !== 45 || text3.charCodeAt(23) !== 45) {
    return fail5(`Expected a UUID, received "${text3}"`);
  }
  for (let word = 0; word < 4; word++) {
    let bits = 0;
    let valid = 0;
    for (let i = word * 4; i < word * 4 + 4; i++) {
      const at = uuidOffsets[i];
      const high = hexAt(text3, at);
      const low = hexAt(text3, at + 1);
      valid |= high | low;
      bits = bits << 8 | high << 4 | low;
    }
    if (valid < 0) {
      return fail5(`Expected a UUID, received "${text3}"`);
    }
    uuidWord[word] = bits;
  }
};
var encodeUuid = (value3) => {
  uuidWords(value3);
  const bytes = new Uint8Array(16);
  writeInt32(bytes, 0, uuidWord[0]);
  writeInt32(bytes, 4, uuidWord[1]);
  writeInt32(bytes, 8, uuidWord[2]);
  writeInt32(bytes, 12, uuidWord[3]);
  return bytes;
};
var writeUuid = (sink, value3) => {
  uuidWords(value3);
  sink.int32(uuidWord[0]);
  sink.int32(uuidWord[1]);
  sink.int32(uuidWord[2]);
  sink.int32(uuidWord[3]);
};
var decodeUuid = (bytes, offset, size) => {
  requireSize(size, 16, "uuid");
  const b0 = bytes[offset];
  const b1 = bytes[offset + 1];
  const b2 = bytes[offset + 2];
  const b3 = bytes[offset + 3];
  const b4 = bytes[offset + 4];
  const b5 = bytes[offset + 5];
  const b6 = bytes[offset + 6];
  const b7 = bytes[offset + 7];
  const b8 = bytes[offset + 8];
  const b9 = bytes[offset + 9];
  const b10 = bytes[offset + 10];
  const b11 = bytes[offset + 11];
  const b12 = bytes[offset + 12];
  const b13 = bytes[offset + 13];
  const b14 = bytes[offset + 14];
  const b15 = bytes[offset + 15];
  return String.fromCharCode(hexHigh[b0], hexLow[b0], hexHigh[b1], hexLow[b1], hexHigh[b2], hexLow[b2], hexHigh[b3], hexLow[b3], 45, hexHigh[b4], hexLow[b4], hexHigh[b5], hexLow[b5], 45, hexHigh[b6], hexLow[b6], hexHigh[b7], hexLow[b7], 45, hexHigh[b8], hexLow[b8], hexHigh[b9], hexLow[b9], 45, hexHigh[b10], hexLow[b10], hexHigh[b11], hexLow[b11], hexHigh[b12], hexLow[b12], hexHigh[b13], hexLow[b13], hexHigh[b14], hexLow[b14], hexHigh[b15], hexLow[b15]);
};
var codecOf = (read, encode2, write) => {
  const decode2 = (bytes) => read(bytes, 0, bytes.length);
  return write === void 0 ? {
    encode: encode2,
    decode: decode2,
    read
  } : {
    encode: encode2,
    decode: decode2,
    read,
    write
  };
};
var takeScratch4 = () => {
  const bytes = new Uint8Array(4);
  bytes[0] = scratchBytes4[0];
  bytes[1] = scratchBytes4[1];
  bytes[2] = scratchBytes4[2];
  bytes[3] = scratchBytes4[3];
  return bytes;
};
var takeScratch8 = () => {
  const bytes = new Uint8Array(8);
  bytes[0] = scratchBytes8[0];
  bytes[1] = scratchBytes8[1];
  bytes[2] = scratchBytes8[2];
  bytes[3] = scratchBytes8[3];
  bytes[4] = scratchBytes8[4];
  bytes[5] = scratchBytes8[5];
  bytes[6] = scratchBytes8[6];
  bytes[7] = scratchBytes8[7];
  return bytes;
};
var utf8Codec = /* @__PURE__ */ codecOf(decodeUtf83, (value3) => encodeUtf8(requireString(value3, "text")), (sink, value3) => sink.utf8(requireString(value3, "text")));
var int8Value = (value3) => {
  const big = requireBigInt(value3, "int8");
  if (big < INT64_MIN || big > INT64_MAX) fail5(`int8 out of range: ${big}`);
  return big;
};
var MAX_TIME_MICROS = /* @__PURE__ */ BigInt(MAX_TIME_MICROS_NUMBER);
var timeValue = (value3) => {
  const micros = requireBigInt(value3, "time");
  if (micros < ZERO || micros > MAX_TIME_MICROS) fail5(`time out of range: ${micros}`);
  return micros;
};
var readTimeMicros = (bytes, offset) => {
  const high = readInt32(bytes, offset);
  const micros = high * 4294967296 + readUint32(bytes, offset + 4);
  if (high < 0 || micros > MAX_TIME_MICROS_NUMBER) {
    return fail5(`timetz out of range: ${micros}`);
  }
  return micros;
};
var timestampHigh = 0;
var timestampLow = 0;
var timestampInt64 = (value3) => {
  let ms;
  if (value3 instanceof Date) {
    ms = value3.getTime();
    if (Number.isNaN(ms)) fail5("timestamp cannot be an invalid Date");
  } else {
    ms = typeof value3 === "number" ? value3 : fail5("Expected a Date or number for timestamp");
    if (Number.isNaN(ms)) fail5("timestamp cannot be NaN");
  }
  if (ms === Number.POSITIVE_INFINITY) {
    timestampHigh = INT32_MAX;
    timestampLow = -1;
  } else if (ms === Number.NEGATIVE_INFINITY) {
    timestampHigh = INT32_MIN;
    timestampLow = 0;
  } else {
    const unixMicros = Math.trunc(ms * 1e3);
    if (!Number.isFinite(unixMicros)) {
      fail5(`timestamp out of range: ${ms}`);
    }
    const micros = unixMicros - PG_EPOCH_MICROS;
    if (micros > -MAX_EXACT && micros < MAX_EXACT) {
      timestampHigh = Math.floor(micros / 4294967296);
      timestampLow = micros - timestampHigh * 4294967296;
    } else {
      const exact = BigInt(unixMicros) - BigInt(PG_EPOCH_MICROS);
      if (exact < INT64_MIN || exact > INT64_MAX) {
        fail5(`timestamp out of range: ${ms}`);
      }
      scratchView8.setBigInt64(0, exact);
      timestampHigh = scratchView8.getInt32(0);
      timestampLow = scratchView8.getInt32(4);
    }
  }
};
var timestampCodec = /* @__PURE__ */ codecOf((bytes, offset, size) => {
  requireSize(size, 8, "timestamp");
  const high = readInt32(bytes, offset);
  if (high >= -MAX_EXACT_HIGH && high < MAX_EXACT_HIGH) {
    const micros2 = high * 4294967296 + readUint32(bytes, offset + 4);
    return new Date((micros2 - micros2 % 1e3) / 1e3 + PG_EPOCH_MS);
  }
  stage8(bytes, offset);
  const micros = scratchView8.getBigInt64(0);
  if (micros === INT64_MAX || micros === INT64_MIN) return new Date(Number.NaN);
  return new Date(Number(micros / THOUSAND) + PG_EPOCH_MS);
}, (value3) => {
  timestampInt64(value3);
  const bytes = new Uint8Array(8);
  writeInt32(bytes, 0, timestampHigh);
  writeInt32(bytes, 4, timestampLow);
  return bytes;
}, (sink, value3) => {
  timestampInt64(value3);
  sink.int32(timestampHigh);
  sink.int32(timestampLow);
});
var dateDays = (value3) => {
  const text3 = requireString(value3, "date");
  if (text3 === "infinity") return INT32_MAX;
  if (text3 === "-infinity") return INT32_MIN;
  const days = parseDate(text3) - PG_EPOCH_DAYS;
  if (days <= INT32_MIN || days >= INT32_MAX) {
    return fail5(`date out of range: "${text3}"`);
  }
  return days;
};
var dateCodec = /* @__PURE__ */ codecOf((bytes, offset, size) => {
  requireSize(size, 4, "date");
  const days = readInt32(bytes, offset);
  if (days === INT32_MAX) return "infinity";
  if (days === INT32_MIN) return "-infinity";
  return formatDate(days + PG_EPOCH_DAYS);
}, (value3) => {
  const bytes = new Uint8Array(4);
  writeInt32(bytes, 0, dateDays(value3));
  return bytes;
}, (sink, value3) => sink.int32(dateDays(value3)));
var timetzCodec = /* @__PURE__ */ codecOf((bytes, offset, size) => {
  requireSize(size, 12, "timetz");
  const zone = readInt32(bytes, offset + 8);
  if (zone <= -TZDISP_LIMIT_SECONDS || zone >= TZDISP_LIMIT_SECONDS) {
    return fail5(`timetz time zone displacement out of range: ${zone}`);
  }
  return formatTimeOfDay(readTimeMicros(bytes, offset)) + formatZone(-zone);
}, (value3) => {
  const text3 = requireString(value3, "timetz");
  const split = Math.max(text3.lastIndexOf("+"), text3.lastIndexOf("-"), text3.lastIndexOf("Z"));
  if (split <= 0) {
    return fail5(`Expected a timetz with a zone offset, received "${text3}"`);
  }
  const bytes = new Uint8Array(12);
  writeInt64(bytes, 0, parseTimeOfDay(text3.slice(0, split)));
  writeInt32(bytes, 8, -parseZone(text3.slice(split)));
  return bytes;
});
var jsonCodec = /* @__PURE__ */ codecOf((bytes, offset, size) => JSON.parse(decodeUtf83(bytes, offset, size)), (value3) => {
  const text3 = JSON.stringify(value3);
  if (text3 === void 0) return fail5("Value cannot be serialised as JSON");
  return encodeUtf8(text3);
}, (sink, value3) => {
  const text3 = JSON.stringify(value3);
  if (text3 === void 0) return fail5("Value cannot be serialised as JSON");
  sink.utf8(text3);
});
var jsonbCodec = /* @__PURE__ */ codecOf((bytes, offset, size) => {
  if (size === 0 || bytes[offset] !== 1) {
    return fail5("Unsupported jsonb version byte");
  }
  return JSON.parse(decodeUtf83(bytes, offset + 1, size - 1));
}, (value3) => {
  const text3 = JSON.stringify(value3);
  if (text3 === void 0) return fail5("Value cannot be serialised as JSON");
  const bytes = encodeUtf8Prefixed(text3, 1);
  bytes[0] = 1;
  return bytes;
}, (sink, value3) => {
  const text3 = JSON.stringify(value3);
  if (text3 === void 0) return fail5("Value cannot be serialised as JSON");
  sink.uint8(1);
  sink.utf8(text3);
});
var oidCodec = /* @__PURE__ */ codecOf((bytes, offset, size) => {
  requireSize(size, 4, "oid");
  return readUint32(bytes, offset);
}, (value3) => {
  const num = requireInteger(value3, "oid", 0, 4294967295);
  const bytes = new Uint8Array(4);
  bytes[0] = num >>> 24;
  bytes[1] = num >>> 16;
  bytes[2] = num >>> 8;
  bytes[3] = num;
  return bytes;
}, (sink, value3) => sink.int32(requireInteger(value3, "oid", 0, 4294967295)));
var builtinScalars = /* @__PURE__ */ new Map([[OID.bool, /* @__PURE__ */ codecOf((bytes, offset, size) => {
  requireSize(size, 1, "bool");
  return bytes[offset] !== 0;
}, (value3) => {
  if (typeof value3 !== "boolean") fail5("Expected a boolean for bool");
  const bytes = new Uint8Array(1);
  bytes[0] = value3 ? 1 : 0;
  return bytes;
}, (sink, value3) => {
  if (typeof value3 !== "boolean") fail5("Expected a boolean for bool");
  sink.uint8(value3 ? 1 : 0);
})], [OID.bytea, /* @__PURE__ */ codecOf(region, (value3) => value3 instanceof Uint8Array ? value3.slice() : fail5("Expected a Uint8Array for bytea"), (sink, value3) => value3 instanceof Uint8Array ? sink.raw(value3) : fail5("Expected a Uint8Array for bytea"))], [OID.int2, /* @__PURE__ */ codecOf((bytes, offset, size) => {
  requireSize(size, 2, "int2");
  return (bytes[offset] << 8 | bytes[offset + 1]) << 16 >> 16;
}, (value3) => {
  const num = requireInteger(value3, "int2", -32768, 32767);
  const bytes = new Uint8Array(2);
  bytes[0] = num >>> 8;
  bytes[1] = num;
  return bytes;
}, (sink, value3) => sink.int16(requireInteger(value3, "int2", -32768, 32767)))], [OID.int4, /* @__PURE__ */ codecOf((bytes, offset, size) => {
  requireSize(size, 4, "int4");
  return readInt32(bytes, offset);
}, (value3) => {
  const num = requireInteger(value3, "int4", INT32_MIN, INT32_MAX);
  const bytes = new Uint8Array(4);
  bytes[0] = num >>> 24;
  bytes[1] = num >>> 16;
  bytes[2] = num >>> 8;
  bytes[3] = num;
  return bytes;
}, (sink, value3) => sink.int32(requireInteger(value3, "int4", INT32_MIN, INT32_MAX)))], [OID.oid, oidCodec], [OID.regclass, oidCodec], [OID.int8, /* @__PURE__ */ codecOf((bytes, offset, size) => {
  requireSize(size, 8, "int8");
  stage8(bytes, offset);
  return scratchView8.getBigInt64(0);
}, (value3) => {
  scratchView8.setBigInt64(0, int8Value(value3));
  return takeScratch8();
}, (sink, value3) => sink.bigInt64(int8Value(value3)))], [OID.float4, /* @__PURE__ */ codecOf((bytes, offset, size) => {
  requireSize(size, 4, "float4");
  scratchView4.setInt32(0, readInt32(bytes, offset));
  return scratchView4.getFloat32(0);
}, (value3) => {
  scratchView4.setFloat32(0, requireNumber(value3, "float4"));
  return takeScratch4();
}, (sink, value3) => sink.float32(requireNumber(value3, "float4")))], [OID.float8, /* @__PURE__ */ codecOf((bytes, offset, size) => {
  requireSize(size, 8, "float8");
  stage8(bytes, offset);
  return scratchView8.getFloat64(0);
}, (value3) => {
  scratchView8.setFloat64(0, requireNumber(value3, "float8"));
  return takeScratch8();
}, (sink, value3) => sink.float64(requireNumber(value3, "float8")))], [OID.time, /* @__PURE__ */ codecOf((bytes, offset, size) => {
  requireSize(size, 8, "time");
  stage8(bytes, offset);
  return scratchView8.getBigInt64(0);
}, (value3) => {
  scratchView8.setBigInt64(0, timeValue(value3));
  return takeScratch8();
}, (sink, value3) => sink.bigInt64(timeValue(value3)))], [OID.numeric, /* @__PURE__ */ codecOf(decodeNumeric, encodeNumeric)], [OID.text, utf8Codec], [OID.varchar, utf8Codec], [OID.bpchar, utf8Codec], [OID.name, utf8Codec], [OID.json, jsonCodec], [OID.jsonb, jsonbCodec], [OID.uuid, /* @__PURE__ */ codecOf(decodeUuid, encodeUuid, writeUuid)], [OID.inet, /* @__PURE__ */ codecOf(decodeInet, (value3) => encodeInet(value3, false))], [OID.cidr, /* @__PURE__ */ codecOf(decodeInet, (value3) => encodeInet(value3, true))], [OID.date, dateCodec], [OID.timetz, timetzCodec], [OID.timestamp, timestampCodec], [OID.timestamptz, timestampCodec]]);
var makeArrayCodec = (elementOid, lookup2) => codecOf((bytes, offset, size) => decodeArray(bytes, offset, size, elementOid, lookup2), (value3) => encodeArray(value3, elementOid, lookup2), (sink, value3) => writeArray(sink, value3, elementOid, lookup2));
var builtins = /* @__PURE__ */ new Map(builtinScalars);
var codecs = /* @__PURE__ */ new Map(builtins);
var tableSize = 4096;
var table = /* @__PURE__ */ new Array(tableSize);
var lookup = (oid2) => oid2 >= 0 && oid2 < tableSize ? table[oid2] : codecs.get(oid2);
for (const [arrayOid, elementOid] of arrayToElement) {
  const codec = /* @__PURE__ */ makeArrayCodec(elementOid, lookup);
  builtins.set(arrayOid, codec);
  codecs.set(arrayOid, codec);
}
for (const [oid2, codec] of codecs) table[oid2] = codec;
var registryStates = /* @__PURE__ */ new WeakMap();
var getRegistryState = (registry) => {
  const state = registryStates.get(registry);
  if (state === void 0) return fail5("Invalid PgTypes Registry");
  return state;
};
var lookupFor = (registry) => registry === void 0 ? lookup : getRegistryState(registry).lookup;
var encodeArray = (value3, elementOid, lookup2) => {
  if (!Array.isArray(value3)) {
    return fail5("Expected an array");
  }
  const codec = lookup2(elementOid);
  if (codec === void 0) return fail5(`No codec registered for OID ${elementOid}`);
  const count = value3.length;
  const elements = new Array(count);
  let hasNull = false;
  let payloadSize = 0;
  for (let i = 0; i < count; i++) {
    const element = value3[i];
    if (element === null) {
      elements[i] = null;
      hasNull = true;
      payloadSize += 4;
    } else {
      const encoded = codec.encode(element);
      elements[i] = encoded;
      payloadSize += 4 + encoded.length;
    }
  }
  const dimensions = count === 0 ? 0 : 1;
  const bytes = new Uint8Array(12 + dimensions * 8 + payloadSize);
  writeInt32(bytes, 0, dimensions);
  writeInt32(bytes, 4, hasNull ? 1 : 0);
  writeInt32(bytes, 8, elementOid);
  let offset = 12;
  if (dimensions === 1) {
    writeInt32(bytes, offset, count);
    writeInt32(bytes, offset + 4, 1);
    offset += 8;
  }
  for (let i = 0; i < count; i++) {
    const element = elements[i];
    if (element === null) {
      writeInt32(bytes, offset, -1);
      offset += 4;
    } else {
      writeInt32(bytes, offset, element.length);
      bytes.set(element, offset + 4);
      offset += 4 + element.length;
    }
  }
  return bytes;
};
var writeArray = (sink, value3, elementOid, lookup2) => {
  if (!Array.isArray(value3)) {
    return fail5("Expected an array");
  }
  const count = value3.length;
  let hasNull = false;
  for (let i = 0; i < count; i++) {
    if (value3[i] === null) {
      hasNull = true;
      break;
    }
  }
  const dimensions = count === 0 ? 0 : 1;
  sink.int32(dimensions);
  sink.int32(hasNull ? 1 : 0);
  sink.int32(elementOid);
  if (dimensions === 1) {
    sink.int32(count);
    sink.int32(1);
  }
  const write = lookup2(elementOid)?.write;
  for (let i = 0; i < count; i++) {
    const element = value3[i];
    if (element === null) {
      sink.int32(-1);
    } else {
      const token = sink.beginLength();
      if (write === void 0) writeValue(sink, element, elementOid, lookup2);
      else write(sink, element);
      sink.endLength(token);
    }
  }
};
var decodeArray = (bytes, start, size, elementOid, lookup2) => {
  if (size < 12) return fail5("Truncated array value");
  const dimensions = readInt32(bytes, start);
  const wireElementOid = readUint32(bytes, start + 8);
  if (wireElementOid !== elementOid) {
    return fail5(`Array element OID ${wireElementOid} does not match expected OID ${elementOid}`);
  }
  if (dimensions === 0) {
    if (size !== 12) return fail5("Zero-dimensional array has trailing bytes");
    return [];
  }
  if (dimensions !== 1) {
    return fail5(`Only 1-dimensional arrays are supported, received ${dimensions} dimensions`);
  }
  if (size < 20) return fail5("Truncated array value");
  const length = readInt32(bytes, start + 12);
  if (length < 0) return fail5(`Invalid array length: ${length}`);
  const lowerBound = readInt32(bytes, start + 16);
  if (lowerBound !== 1) return fail5(`Only arrays with a lower bound of 1 are supported, received ${lowerBound}`);
  const codec = lookup2(elementOid);
  const read = codec?.read;
  const values = new Array(length);
  const limit = start + size;
  let offset = start + 20;
  for (let i = 0; i < length; i++) {
    if (offset + 4 > limit) return fail5("Truncated array element");
    const elementSize = readInt32(bytes, offset);
    offset += 4;
    if (elementSize < -1) return fail5(`Invalid array element length: ${elementSize}`);
    if (elementSize === -1) {
      values[i] = null;
    } else {
      if (offset + elementSize > limit) return fail5("Truncated array element");
      values[i] = read !== void 0 ? read(bytes, offset, elementSize) : codec === void 0 ? region(bytes, offset, elementSize) : codec.decode(region(bytes, offset, elementSize));
      offset += elementSize;
    }
  }
  if (offset !== limit) return fail5("Array value has trailing bytes");
  return values;
};
var makeFieldReader = (columns, registry) => result2(() => {
  const lookup2 = lookupFor(registry);
  const codecs2 = columns.map((column, index) => {
    if (column.format !== 1) {
      return fail5(`Only the binary format is supported, column ${index} has format ${column.format}`);
    }
    return lookup2(column.dataTypeOid);
  });
  return (bytes, offset, size, column) => {
    if (size < 0) return null;
    const codec = codecs2[column];
    if (codec === void 0) return decodeUtf83(bytes, offset, size);
    const read = codec.read;
    return read === void 0 ? codec.decode(bytes.subarray(offset, offset + size)) : read(bytes, offset, size);
  };
});
var ParameterTypeId = "~@effect/sql-pg/PgTypes/Parameter";
var isParameter = (value3) => typeof value3 === "object" && value3 !== null && value3[ParameterTypeId] === ParameterTypeId;
var writeValue = (sink, value3, oid2, lookup2) => {
  const codec = lookup2(oid2);
  if (codec === void 0) return fail5(`No codec registered for OID ${oid2}`);
  if (codec.write === void 0) sink.raw(codec.encode(value3));
  else codec.write(sink, value3);
};
var isTextFormat = (parameter2) => parameter2.oid === 0;
var writeParameterUnsafe = (sink, parameter2, lookup2) => parameter2.value === null ? sink.sqlNull() : parameter2.oid === 0 ? sink.utf8(String(parameter2.value)) : writeValue(sink, parameter2.value, parameter2.oid, lookup2);
var writeParameter = (sink, parameter2, registry) => {
  try {
    writeParameterUnsafe(sink, parameter2, lookupFor(registry));
    return Result3.void;
  } catch (error) {
    if (error instanceof CodecError) return Result3.fail(error);
    throw error;
  }
};
var valueWriterUnsafe2 = /* @__PURE__ */ Symbol.for("@effect/sql-pg/PgProtocol/ValueWriter/unsafe");
Object.defineProperty(writeParameter, valueWriterUnsafe2, {
  value: (sink, parameter2) => writeParameterUnsafe(sink, parameter2, lookup)
});
var makeParameter = (oid2, value3) => ({
  [ParameterTypeId]: ParameterTypeId,
  oid: oid2,
  value: value3
});
var parameter = (oid2) => (value3) => makeParameter(oid2, value3);
var bool = /* @__PURE__ */ parameter(OID.bool);
var int2 = /* @__PURE__ */ parameter(OID.int2);
var int4 = /* @__PURE__ */ parameter(OID.int4);
var int8 = /* @__PURE__ */ parameter(OID.int8);
var oid = /* @__PURE__ */ parameter(OID.oid);
var float4 = /* @__PURE__ */ parameter(OID.float4);
var float8 = /* @__PURE__ */ parameter(OID.float8);
var numeric = /* @__PURE__ */ parameter(OID.numeric);
var text = /* @__PURE__ */ parameter(OID.text);
var varchar = /* @__PURE__ */ parameter(OID.varchar);
var bpchar = /* @__PURE__ */ parameter(OID.bpchar);
var name = /* @__PURE__ */ parameter(OID.name);
var bytea = /* @__PURE__ */ parameter(OID.bytea);
var json = /* @__PURE__ */ parameter(OID.json);
var jsonb = /* @__PURE__ */ parameter(OID.jsonb);
var uuid = /* @__PURE__ */ parameter(OID.uuid);
var inet = /* @__PURE__ */ parameter(OID.inet);
var cidr = /* @__PURE__ */ parameter(OID.cidr);
var date = /* @__PURE__ */ parameter(OID.date);
var time = /* @__PURE__ */ parameter(OID.time);
var timetz = /* @__PURE__ */ parameter(OID.timetz);
var timestamp = /* @__PURE__ */ parameter(OID.timestamp);
var timestamptz = /* @__PURE__ */ parameter(OID.timestamptz);

// node_modules/.bun/@effect+sql-pg@4.0.0+a594d97e083afb95/node_modules/@effect/sql-pg/dist/PgConnection.js
var TypeId = "~@effect/sql-pg/PgConnection";
var preparedCacheFor = (config) => {
  if (config.prepare === false) return void 0;
  const max = config.preparedStatementCacheSize ?? defaultPreparedStatements;
  return max > 0 ? new PreparedCache(max) : void 0;
};
var make3 = (options) => Effect2.flatMap(resolveConfig(options), (config) => Effect2.acquireRelease(Effect2.gen(function* () {
  const password = yield* resolve(config.password);
  const session = yield* connect3(config, password);
  return new PgConnectionImpl(options, config, session, options.types);
}), (connection) => Effect2.sync(() => connection.closeUnsafe()), {
  interruptible: true
}).pipe(Effect2.timeoutOrElse({
  duration: config.connectTimeout,
  orElse: () => Effect2.fail(new SqlError2({
    reason: new ConnectionError2({
      cause: new Error("Connection timed out"),
      message: "PgConnection: Connection timed out",
      operation: "connect"
    })
  }))
})));
var abortDrainTimeoutMillis = 5e3;
var abortDrainGraceMillis = 10;
var queryCanceledCode = "57014";
var cancelRequestTimeoutMillis = 5e3;
var maxPipelineDepth = 128;
var streamPauseThreshold = 512;
var PgConnectionImpl = class {
  [TypeId] = TypeId;
  config;
  processId;
  session;
  /** The custom codec registry, or `undefined` for the builtin catalogue. */
  registry;
  bindEncoder;
  /** The statements this session has named, or `undefined` when disabled. */
  prepared;
  resolved;
  multiplex;
  /** Serializes statements: one in-flight extended-query cycle. */
  wire = /* @__PURE__ */ Semaphore.makeUnsafe(1);
  /** Exclusive-ownership queue used by `pin` and unpinned statements. */
  owner = /* @__PURE__ */ Semaphore.makeUnsafe(1);
  pinned = false;
  consumer;
  deadWith;
  closed = false;
  cancelPending = false;
  channels = /* @__PURE__ */ new Map();
  retireHooks = /* @__PURE__ */ new Set();
  /** Queued but not yet written; drained into `pipelineInFlight` on flush. */
  pipelinePending = [];
  /** Written and awaiting their `ReadyForQuery`, oldest first. */
  pipelineInFlight = [];
  pipelineHead = 0;
  pipelineFlushScheduled = false;
  pipelineIdleWaiters = /* @__PURE__ */ new Set();
  pinnedView;
  [internalsKey];
  constructor(config, resolved, session, registry) {
    this.config = config;
    this.resolved = resolved;
    this.session = session;
    this.processId = session.processId;
    this.registry = registry;
    this.bindEncoder = makeBindEncoder2(registry);
    this.prepared = preparedCacheFor(config);
    this.multiplex = config.multiplex ?? false;
    this[internalsKey] = {
      base: this,
      deadError: () => this.deadWith,
      retireHooks: this.retireHooks
    };
    this.pinnedView = new PinnedPgConnection(this);
    session.socket.on("data", this.onData);
    session.socket.on("error", this.onSocketError);
    session.socket.on("close", this.onSocketClose);
  }
  onData = (chunk) => {
    try {
      this.session.parser.pushEach(chunk, this.dispatch);
    } catch (cause) {
      return this.fatal(cause instanceof ParseError ? connectionQueryError(cause, "PgConnection: Failed to parse server messages") : queryError(cause, "PgConnection: Failed to decode row"));
    }
    if (this.deadWith === void 0) this.consumer?.onBatchEnd?.();
  };
  onSocketError = (cause) => this.fatal(connectionQueryError(cause, "PgConnection: Socket error"));
  onSocketClose = () => this.fatal(connectionQueryError(new Error("Connection closed"), "PgConnection: Connection closed"));
  dispatch = (message) => {
    if (this.deadWith !== void 0) return;
    switch (message._tag) {
      case "ErrorResponse":
        if (message.fields.code === queryCanceledCode) this.cancelPending = false;
        break;
      case "ReadyForQuery":
        if (this.cancelPending) {
          this.cancelPending = false;
          this.retire();
        }
        break;
      case "NotificationResponse": {
        const queues = this.channels.get(message.channel);
        if (queues !== void 0) {
          const notification = {
            processId: message.pid,
            channel: message.channel,
            payload: message.payload
          };
          for (const queue of queues) Queue.offerUnsafe(queue, notification);
        }
        return;
      }
      case "ParameterStatus":
      case "NoticeResponse":
        return;
    }
    if (this.consumer !== void 0) return this.consumer.onMessage(message);
    if (message._tag === "ErrorResponse") {
      return this.fatal(new SqlError2({
        reason: classifyFields(message.fields, "PgConnection: The server reported an error", "query")
      }));
    }
    this.fatal(connectionQueryError(new Error(`Unexpected ${message._tag} while idle`), `PgConnection: Unexpected ${message._tag} while idle`));
  };
  /** Marks the session dead: optionally destroys the socket, fails the active statement
   * and every listen queue, and notifies pool hooks unless the session's own
   * scope is being released. */
  fatal(error, destroySocket = true) {
    if (this.deadWith !== void 0) return;
    this.deadWith = error;
    if (destroySocket) this.session.socket.destroy();
    const consumer = this.consumer;
    this.consumer = void 0;
    this.retire();
    consumer?.onFatal(error);
    const sets = Array.from(this.channels.values());
    this.channels.clear();
    const cause = this.closed ? Cause.interrupt() : Cause.fail(error);
    for (const set of sets) {
      for (const queue of set) Queue.failCauseUnsafe(queue, cause);
    }
  }
  retire() {
    if (this.closed) return;
    for (const hook of this.retireHooks) hook();
  }
  closeUnsafe() {
    this.closed = true;
    let destroySocket = true;
    if (this.deadWith === void 0 && this.session.socket.writable) {
      try {
        this.session.socket.end(encodeTerminate());
        destroySocket = false;
      } catch {
      }
    }
    this.fatal(new SqlError2({
      reason: new ConnectionError2({
        cause: new Error("Connection is closed"),
        message: "PgConnection: Connection is closed",
        operation: "query"
      })
    }), destroySocket);
  }
  /** Plans one execution. `cache` is `undefined` to force the unnamed path. */
  encodeQuery = (sql2, params, cache) => encodeQuery(sql2, params, this.registry, this.bindEncoder, cache);
  /**
   * Routes backend messages to the oldest statement still on the wire.
   *
   * Every cycle carries its own `Sync`, so the backend answers them in order
   * and finishes each with a `ReadyForQuery`. That boundary is what advances
   * the queue, and it is also why a statement the backend rejects only skips
   * the rest of its own cycle: the ones queued behind it still run.
   */
  pipelineConsumer = {
    onMessage: (message) => {
      const entry = this.pipelineInFlight[this.pipelineHead];
      if (entry === void 0) {
        return this.fatal(connectionQueryError(new Error(`Unexpected ${message._tag} without an in-flight query`), `PgConnection: Unexpected ${message._tag} without an in-flight query`));
      }
      entry.machine.onMessage(message);
    },
    onBatchEnd: () => this.flushPipeline(),
    onFatal: (error) => {
      const entries = [...this.pipelineInFlight.slice(this.pipelineHead), ...this.pipelinePending];
      this.pipelineInFlight.length = 0;
      this.pipelineHead = 0;
      this.pipelinePending.length = 0;
      this.pipelineFlushScheduled = false;
      for (const entry of entries) {
        if (!entry.abandoned) Deferred.doneUnsafe(entry.deferred, Effect2.fail(error));
      }
      this.notifyPipelineIdle();
    }
  };
  pipelineDepth = () => this.pipelineInFlight.length - this.pipelineHead;
  pipelineIsIdle = () => this.pipelineDepth() === 0 && this.pipelinePending.length === 0;
  notifyPipelineIdle = () => {
    if (!this.pipelineIsIdle()) return;
    this.consumer = void 0;
    this.session.parser.readField = void 0;
    const waiters = Array.from(this.pipelineIdleWaiters);
    this.pipelineIdleWaiters.clear();
    for (const waiter of waiters) waiter();
  };
  /** Resolves once nothing is on the wire, so `pin` can take the connection. */
  waitPipelineIdle = /* @__PURE__ */ Effect2.callback((resume) => {
    if (this.pipelineIsIdle()) return resume(Effect2.void);
    const waiter = () => resume(Effect2.void);
    this.pipelineIdleWaiters.add(waiter);
    return Effect2.sync(() => this.pipelineIdleWaiters.delete(waiter));
  });
  finishPipelineEntry = (entry, result3) => {
    if (this.pipelineInFlight[this.pipelineHead] !== entry) {
      return this.fatal(connectionQueryError(new Error("A pipelined query completed out of order"), "PgConnection: A pipelined query completed out of order"));
    }
    this.pipelineHead++;
    this.session.parser.readField = this.pipelineInFlight[this.pipelineHead]?.machine.readField;
    if (!entry.abandoned) Deferred.doneUnsafe(entry.deferred, result3);
    if (this.pipelineHead === this.pipelineInFlight.length) {
      this.pipelineInFlight.length = 0;
      this.pipelineHead = 0;
    }
  };
  /** Writes everything queued since the last flush as one batch. */
  flushPipeline = () => {
    this.pipelineFlushScheduled = false;
    if (this.deadWith !== void 0) return;
    let capacity = maxPipelineDepth - this.pipelineDepth();
    if (capacity <= 0) return;
    const wasEmpty = this.pipelineDepth() === 0;
    const batch = [];
    let index = 0;
    while (capacity > 0 && index < this.pipelinePending.length) {
      const entry = this.pipelinePending[index++];
      if (entry.abandoned) {
        if (entry.plan.parses && entry.plan.prepared !== void 0) {
          entry.plan.prepared.parsing = false;
        }
        continue;
      }
      batch.push(entry);
      this.pipelineInFlight.push(entry);
      capacity--;
    }
    this.pipelinePending.splice(0, index);
    if (batch.length === 0) {
      this.notifyPipelineIdle();
      return;
    }
    if (wasEmpty) this.session.parser.readField = batch[0].machine.readField;
    const frame = batch.length === 1 ? batch[0].plan.frame : concat(batch.map((entry) => entry.plan.frame));
    try {
      this.session.socket.write(frame);
    } catch (cause) {
      this.fatal(connectionQueryError(cause, "PgConnection: Failed to write query batch"));
    }
  };
  schedulePipelineFlush = () => {
    if (this.pipelineFlushScheduled || this.pipelineDepth() >= maxPipelineDepth) return;
    this.pipelineFlushScheduled = true;
    queueMicrotask(this.flushPipeline);
  };
  /**
   * One cycle on a multiplexed connection. The `owner` permit is only taken to
   * queue the statement, so a pin still orders against submissions without
   * serializing them.
   */
  pipelineCycle = (sql2, params, wantRows, cache) => Effect2.flatMap(this.owner.withPermit(Effect2.suspend(() => {
    if (this.deadWith !== void 0) return Effect2.fail(this.deadWith);
    let plan;
    try {
      plan = this.encodeQuery(sql2, params, cache);
    } catch (cause) {
      return Effect2.fail(queryError(cause, "PgConnection: Failed to encode query"));
    }
    const deferred = Deferred.makeUnsafe();
    let entry;
    const machine = new QueryMachine(this, plan, wantRows, (result3) => this.finishPipelineEntry(entry, result3));
    entry = {
      plan,
      deferred,
      machine,
      abandoned: false
    };
    this.pipelinePending.push(entry);
    this.consumer = this.pipelineConsumer;
    this.schedulePipelineFlush();
    return Effect2.succeed(entry);
  })), (entry) => {
    const awaited = Deferred.await(entry.deferred).pipe(Effect2.onInterrupt(() => Effect2.sync(() => {
      entry.abandoned = true;
    })));
    if (cache === void 0 || entry.plan.parses) return awaited;
    return retryStale(entry.plan, cache, awaited, () => this.pipelineCycle(sql2, params, wantRows, void 0));
  });
  /**
   * One extended-query cycle for a caller that shares the session with others:
   * the fibers inside a transaction, and a stream running beside them. The
   * wire permit is what serializes them.
   */
  cycle = (sql2, params, wantRows, cache) => this.wire.withPermit(this.cycleOwned(sql2, params, wantRows, cache));
  /**
   * Runs one cycle for a caller that owns the session. No wire permit is needed
   * because competing pinned work and streams must acquire `owner` first.
   */
  cycleOwned = (sql2, params, wantRows, cache) => Effect2.suspend(() => this.attempt(sql2, params, wantRows, cache));
  /**
   * Runs one cycle. A reused statement the backend has since dropped, or whose
   * plan no longer matches its columns, is parsed again on a second attempt;
   * that attempt skips the cache, so it cannot loop.
   */
  attempt = (sql2, params, wantRows, cache) => {
    if (this.deadWith !== void 0) return Effect2.fail(this.deadWith);
    let plan;
    try {
      plan = this.encodeQuery(sql2, params, cache);
    } catch (cause) {
      return Effect2.fail(queryError(cause, "PgConnection: Failed to encode query"));
    }
    const run = runQuery(this, plan, wantRows);
    if (cache === void 0 || plan.parses) return run;
    return retryStale(plan, cache, run, () => this.attempt(sql2, params, wantRows, void 0));
  };
  /** Sends a `CancelRequest` for this session on a side connection. */
  cancel = /* @__PURE__ */ Effect2.suspend(() => {
    if (this.deadWith !== void 0) return Effect2.void;
    this.cancelPending = true;
    if (this.consumer === void 0) this.retire();
    return sendCancelRequest(this.resolved, this.session);
  });
  pin = /* @__PURE__ */ Effect2.suspend(() => {
    const reserve2 = this[internalsKey].reserve;
    return reserve2 === void 0 ? this.pinExclusive : Effect2.andThen(reserve2, this.pinExclusive);
  });
  pinExclusive = /* @__PURE__ */ Effect2.acquireRelease(/* @__PURE__ */ Effect2.flatMap(/* @__PURE__ */ this.owner.take(1), () => (
    // Holding `owner` stops new submissions; a pipeline already on the wire
    // still has to drain before this fiber owns the connection.
    Effect2.as(Effect2.tap(Effect2.onInterrupt(this.waitPipelineIdle, () => this.owner.release(1)), () => Effect2.sync(() => {
      this.pinned = true;
    })), this.pinnedView)
  )), () => Effect2.suspend(() => {
    this.pinned = false;
    return this.owner.release(1);
  }));
  run = (sql2, params, wantRows, prepare) => {
    const cache = prepare ? this.prepared : void 0;
    return this.multiplex ? this.pipelineCycle(sql2, params, wantRows, cache) : this.owner.withPermit(this.cycleOwned(sql2, params, wantRows, cache));
  };
  query = (sql2, params, prepare = true) => Effect2.map(this.run(sql2, params ?? emptyParams, true, prepare), takeResult);
  queryValues = (sql2, params, prepare = true) => Effect2.map(this.run(sql2, params ?? emptyParams, false, prepare), takeValues);
  stream = (sql2, params) => streamRows(this, this.pin, sql2, params ?? emptyParams);
  listen = (channel) => listenChannel(this, this.pin, channel);
  interrupt = /* @__PURE__ */ Effect2.suspend(() => this.multiplex && !this.pinned ? Effect2.void : this.cancel);
};
var PinnedPgConnection = class {
  [TypeId] = TypeId;
  base;
  [internalsKey];
  pin;
  interrupt;
  constructor(base) {
    this.base = base;
    this[internalsKey] = base[internalsKey];
    this.pin = Effect2.succeed(this);
    this.interrupt = base.cancel;
  }
  get config() {
    return this.base.config;
  }
  get processId() {
    return this.base.processId;
  }
  query = (sql2, params, prepare = true) => Effect2.map(this.base.cycle(sql2, params ?? emptyParams, true, prepare ? this.base.prepared : void 0), takeResult);
  queryValues = (sql2, params, prepare = true) => Effect2.map(this.base.cycle(sql2, params ?? emptyParams, false, prepare ? this.base.prepared : void 0), takeValues);
  stream = (sql2, params) => streamRows(this.base, this.pin, sql2, params ?? emptyParams);
  listen = (channel) => listenChannel(this.base, this.pin, channel);
};
var INT32_MIN2 = -2147483648;
var INT32_MAX2 = 2147483647;
var inferredParameter = (oid2, value3) => ({
  [ParameterTypeId]: ParameterTypeId,
  oid: oid2,
  value: value3
});
var inferScalar = (value3) => {
  if (isParameter(value3)) return value3;
  if (value3 === null || value3 === void 0) return inferredParameter(0, null);
  switch (typeof value3) {
    case "boolean":
      return inferredParameter(OID.bool, value3);
    case "bigint":
      return inferredParameter(OID.int8, value3);
    case "number":
      if (Number.isInteger(value3)) {
        if (value3 >= INT32_MIN2 && value3 <= INT32_MAX2) {
          return inferredParameter(OID.int4, value3);
        }
        if (Number.isSafeInteger(value3)) {
          return inferredParameter(OID.int8, BigInt(value3));
        }
      }
      return inferredParameter(OID.float8, value3);
    case "string":
      return inferredParameter(0, value3);
  }
  if (value3 instanceof Date) return inferredParameter(OID.timestamptz, value3);
  if (value3 instanceof Uint8Array) return inferredParameter(OID.bytea, value3);
  if (value3 instanceof Int8Array) {
    return inferredParameter(OID.bytea, new Uint8Array(value3.buffer, value3.byteOffset, value3.byteLength));
  }
  throw new CodecError({
    message: `Cannot infer a PostgreSQL type for ${String(value3)}`
  });
};
var inferParameter = (value3, registry) => {
  if (!Array.isArray(value3)) return inferScalar(value3);
  if (value3.length === 0) {
    throw new CodecError({
      message: "Cannot infer the type of an empty array; use PgTypes.array"
    });
  }
  let elementOid;
  const values = new Array(value3.length);
  for (let index = 0; index < value3.length; index++) {
    const element = value3[index];
    if (Array.isArray(element)) {
      throw new CodecError({
        message: "Nested array parameters are not supported"
      });
    }
    const parameter2 = inferScalar(element);
    let oid2 = parameter2.oid;
    if (oid2 === 0) {
      if (parameter2.value === null) {
        values[index] = null;
        continue;
      }
      oid2 = OID.text;
    }
    if (Array.isArray(parameter2.value)) {
      throw new CodecError({
        message: "Nested array parameters are not supported"
      });
    }
    if (elementOid === void 0) elementOid = oid2;
    else if (elementOid !== oid2) {
      throw new CodecError({
        message: "Array parameter elements must have the same inferred OID"
      });
    }
    values[index] = parameter2.value;
  }
  if (elementOid === void 0) {
    throw new CodecError({
      message: "Cannot infer the type of an array containing only null values"
    });
  }
  const arrayOid = arrayOidFor(elementOid, registry);
  if (arrayOid === void 0) {
    throw new CodecError({
      message: `No array type known for element OID ${elementOid}`
    });
  }
  return inferredParameter(arrayOid, values);
};
var concat = (chunks) => {
  let length = 0;
  for (let index = 0; index < chunks.length; index++) length += chunks[index].length;
  const output = Buffer2.allocUnsafe(length);
  let offset = 0;
  for (let index = 0; index < chunks.length; index++) {
    output.set(chunks[index], offset);
    offset += chunks[index].length;
  }
  return output;
};
var emptyParams = [];
var takeResult = (output) => output.result;
var takeValues = (output) => output.values;
var describeExecuteSync = /* @__PURE__ */ concat([/* @__PURE__ */ encodeDescribe({
  target: "portal",
  name: ""
}), /* @__PURE__ */ encodeExecute({
  portal: "",
  maxRows: 0
}), /* @__PURE__ */ encodeSync()]);
var executeSync = /* @__PURE__ */ concat([/* @__PURE__ */ encodeExecute({
  portal: "",
  maxRows: 0
}), /* @__PURE__ */ encodeSync()]);
var defaultPreparedStatements = 100;
var encodeUnnamed = (sql2, parameters, parameterTypes, encodeBind) => {
  const parse = encodeParse({
    name: "",
    query: sql2,
    parameterTypes
  });
  if (EffectResult.isFailure(parse)) throw parse.failure;
  const bind = encodeBind({
    portal: "",
    statement: "",
    parameters
  });
  if (EffectResult.isFailure(bind)) throw bind.failure;
  return {
    frame: concat([parse.success, bind.success, describeExecuteSync]),
    closes: 0,
    parses: true,
    describes: true,
    prepared: void 0,
    description: void 0,
    stale: false
  };
};
var encodeQuery = (sql2, params, registry, encodeBind, cache) => {
  const count = params.length;
  const parameters = new Array(count);
  const parameterTypes = new Array(count);
  for (let index = 0; index < count; index++) {
    const parameter2 = inferParameter(params[index], registry);
    parameters[index] = parameter2;
    parameterTypes[index] = parameter2.oid;
  }
  if (cache === void 0) {
    return encodeUnnamed(sql2, parameters, parameterTypes, encodeBind);
  }
  const prepared = cache.get(sql2, parameterTypes);
  if (!prepared.ready && prepared.parsing) {
    return encodeUnnamed(sql2, parameters, parameterTypes, encodeBind);
  }
  const bind = encodeBind({
    portal: "",
    statement: prepared.name,
    parameters
  });
  if (EffectResult.isFailure(bind)) throw bind.failure;
  const parse = prepared.ready ? void 0 : encodeParse({
    name: prepared.name,
    query: sql2,
    parameterTypes
  });
  if (parse !== void 0 && EffectResult.isFailure(parse)) throw parse.failure;
  const closeFrames = cache.takeCloses();
  if (parse === void 0) {
    return {
      frame: closeFrames === void 0 ? concat([bind.success, executeSync]) : concat([closeFrames.frames, bind.success, executeSync]),
      closes: closeFrames?.count ?? 0,
      parses: false,
      describes: false,
      prepared,
      description: prepared.description,
      stale: false
    };
  }
  prepared.parsing = true;
  return {
    frame: closeFrames === void 0 ? concat([parse.success, bind.success, describeExecuteSync]) : concat([closeFrames.frames, parse.success, bind.success, describeExecuteSync]),
    closes: closeFrames?.count ?? 0,
    parses: true,
    describes: true,
    prepared,
    description: void 0,
    stale: false
  };
};
var PreparedCache = class {
  max;
  statements = /* @__PURE__ */ new Map();
  namespace = /* @__PURE__ */ randomBytes(8).toString("hex");
  closes;
  counter = 0;
  constructor(max) {
    this.max = max;
  }
  get(sql2, parameterTypes) {
    const key = parameterTypes.length === 0 ? sql2 : `${sql2}\0${parameterTypes.join(",")}`;
    const found = this.statements.get(key);
    if (found !== void 0) {
      this.statements.delete(key);
      this.statements.set(key, found);
      this.trim(found);
      return found;
    }
    const prepared = {
      name: `effect_${this.namespace}_${++this.counter}`,
      key,
      ready: false,
      parsing: false,
      description: void 0
    };
    this.statements.set(key, prepared);
    this.trim(prepared);
    return prepared;
  }
  /**
   * A statement still being parsed cannot be closed yet: its `Parse` may not
   * have reached the socket. Let the cache exceed its bound temporarily, then
   * discard abandoned entries and close excess ready statements on access.
   */
  trim(protectedStatement) {
    while (this.statements.size > this.max) {
      let evicted;
      for (const prepared of this.statements.values()) {
        if (prepared !== protectedStatement && (prepared.ready || !prepared.parsing)) {
          evicted = prepared;
          break;
        }
      }
      if (evicted === void 0) return;
      this.statements.delete(evicted.key);
      if (evicted.ready) this.close(evicted.name);
    }
  }
  /**
   * Drops a statement the backend no longer holds, or whose plan went stale.
   *
   * The name is closed either way. A plan that went stale is still held under
   * it, and re-parsing would collide; a name the backend has already lost
   * ignores the `Close`, which Postgres treats as a success.
   */
  evict(prepared) {
    if (prepared.parsing) return;
    if (this.statements.delete(prepared.key) && prepared.ready) this.close(prepared.name);
  }
  /**
   * Drops a statement whose parsing cycle failed before its columns arrived.
   *
   * A `Parse` that completed before the error outlives the failed cycle, so
   * the backend may hold the name while the entry can never become ready. The
   * name is closed either way: closing one the backend never registered is a
   * no-op.
   */
  evictFailed(prepared) {
    this.statements.delete(prepared.key);
    this.close(prepared.name);
  }
  close(name3) {
    ;
    (this.closes ??= []).push(encodeClose({
      target: "statement",
      name: name3
    }));
  }
  takeCloses() {
    const closes = this.closes;
    if (closes === void 0) return void 0;
    this.closes = void 0;
    return {
      frames: closes.length === 1 ? closes[0] : concat(closes),
      count: closes.length
    };
  }
};
var isStalePreparedStatement = (code) => code === "26000" || code === "0A000";
var defaultBindEncoder = /* @__PURE__ */ makeBindEncoder(writeParameter, isTextFormat);
var makeBindEncoder2 = (registry) => registry === void 0 ? defaultBindEncoder : makeBindEncoder((sink, parameter2) => writeParameter(sink, parameter2, registry), isTextFormat);
var queryError = (cause, message) => new SqlError2({
  reason: new UnknownError2({
    cause,
    message,
    operation: "query"
  })
});
var retryStale = (plan, cache, run, rerun) => Effect2.catchCause(run, (cause) => {
  if (!plan.stale) return Effect2.failCause(cause);
  cache.evict(plan.prepared);
  return rerun();
});
var connectionQueryError = (cause, message) => new SqlError2({
  reason: new ConnectionError2({
    cause,
    message,
    operation: "query"
  })
});
var escapeIdentifier = (identifier) => `"${identifier.replaceAll('"', '""')}"`;
var parseCommandTag = (tag) => {
  const firstSpace = tag.indexOf(" ");
  if (firstSpace < 0) return {
    command: tag,
    oid: null,
    rowCount: 0
  };
  const command = tag.slice(0, firstSpace);
  const secondSpace = tag.indexOf(" ", firstSpace + 1);
  if (command === "INSERT" && secondSpace > 0) {
    return {
      command,
      oid: Number(tag.slice(firstSpace + 1, secondSpace)),
      rowCount: Number(tag.slice(secondSpace + 1))
    };
  }
  const last = tag.slice((secondSpace < 0 ? firstSpace : secondSpace) + 1);
  return {
    command,
    oid: null,
    rowCount: isDigits(last) ? Number(last) : 0
  };
};
var isDigits = (value3) => {
  if (value3.length === 0) return false;
  for (let index = 0; index < value3.length; index++) {
    const code = value3.charCodeAt(index);
    if (code < 48 || code > 57) return false;
  }
  return true;
};
var QueryMachine = class {
  conn;
  plan;
  finish;
  /** Installed on the parser while this machine is at the head of the queue. */
  readField;
  /** Object rows, or `undefined` when the caller asked for positional ones. */
  rows;
  values;
  closes;
  phase;
  fieldCount;
  resultFields;
  rowBuilder;
  command = "";
  rowCount = 0;
  oid = null;
  failure;
  done = false;
  aborted = false;
  drainDone;
  constructor(conn, plan, wantRows, finish) {
    this.conn = conn;
    this.plan = plan;
    this.finish = finish;
    this.rows = wantRows ? [] : void 0;
    this.values = wantRows ? void 0 : [];
    this.closes = plan.closes;
    this.phase = plan.closes > 0 ? "close" : plan.parses ? "parse" : "bind";
    const description = plan.description;
    this.readField = description?.readField;
    this.fieldCount = description?.resultFields.length ?? 0;
    this.resultFields = description?.resultFields ?? emptyFields;
    this.rowBuilder = description?.rowBuilder;
  }
  isDone() {
    return this.done;
  }
  abort(onDrained) {
    if (this.done) return onDrained();
    this.aborted = true;
    this.drainDone = onDrained;
  }
  complete(effect3) {
    if (this.done) return;
    this.done = true;
    const prepared = this.plan.prepared;
    if (prepared !== void 0) prepared.parsing = false;
    this.finish(effect3);
  }
  failDesync(message) {
    this.conn.fatal(connectionQueryError(new Error(message), `PgConnection: ${message}`));
  }
  onFatal(error) {
    if (this.done) return;
    this.done = true;
    const prepared = this.plan.prepared;
    if (prepared !== void 0) prepared.parsing = false;
    if (this.aborted) this.drainDone?.();
    else this.finish(Effect2.fail(error));
  }
  onMessage(message) {
    if (this.aborted) {
      if (message._tag === "ReadyForQuery") {
        this.done = true;
        this.drainDone?.();
      }
      return;
    }
    if (this.phase === "error") {
      if (message._tag === "ReadyForQuery") return this.complete(Effect2.fail(this.failure));
      return this.failDesync(`Unexpected ${message._tag} after ErrorResponse`);
    }
    switch (message._tag) {
      case "CloseComplete":
        if (this.phase !== "close") return this.failDesync(`Unexpected CloseComplete during ${this.phase}`);
        if (--this.closes === 0) this.phase = this.plan.parses ? "parse" : "bind";
        return;
      case "ParseComplete":
        if (this.phase !== "parse") return this.failDesync(`Unexpected ParseComplete during ${this.phase}`);
        this.phase = "bind";
        return;
      case "BindComplete":
        if (this.phase !== "bind") return this.failDesync(`Unexpected BindComplete during ${this.phase}`);
        this.phase = this.plan.describes ? "describe" : "rows";
        return;
      case "RowDescription": {
        if (this.phase !== "describe") return this.failDesync(`Unexpected RowDescription during ${this.phase}`);
        const description = describe(message.fields, this.conn.registry);
        if (EffectResult.isFailure(description)) {
          return this.conn.fatal(queryError(description.failure, "PgConnection: Failed to decode row"));
        }
        this.fieldCount = message.fields.length;
        this.resultFields = description.success.resultFields;
        this.rowBuilder = description.success.rowBuilder;
        this.conn.session.parser.readField = description.success.readField;
        const prepared = this.plan.prepared;
        if (prepared !== void 0) {
          prepared.description = description.success;
          prepared.ready = true;
        }
        this.phase = "rows";
        return;
      }
      case "NoData": {
        if (this.phase !== "describe") return this.failDesync(`Unexpected NoData during ${this.phase}`);
        const prepared = this.plan.prepared;
        if (prepared !== void 0) {
          prepared.description = void 0;
          prepared.ready = true;
        }
        this.phase = "rows";
        return;
      }
      case "DataRow": {
        if (this.phase !== "rows" || this.rowBuilder === void 0) {
          return this.failDesync(`Unexpected DataRow during ${this.phase}`);
        }
        const rowValues = message.values;
        if (rowValues.length !== this.fieldCount) {
          return this.failDesync(`DataRow has ${rowValues.length} values for ${this.fieldCount} fields`);
        }
        if (this.rows !== void 0) this.rows.push(this.rowBuilder(rowValues));
        else this.values.push(rowValues);
        return;
      }
      case "CommandComplete": {
        if (this.phase !== "rows") return this.failDesync(`Unexpected CommandComplete during ${this.phase}`);
        const parsed = parseCommandTag(message.commandTag);
        this.command = parsed.command;
        this.rowCount = parsed.rowCount;
        this.oid = parsed.oid;
        this.phase = "complete";
        return;
      }
      case "EmptyQueryResponse":
        if (this.phase !== "rows") return this.failDesync(`Unexpected EmptyQueryResponse during ${this.phase}`);
        this.phase = "complete";
        return;
      case "ErrorResponse": {
        if (isStalePreparedStatement(message.fields.code)) this.plan.stale = true;
        const prepared = this.plan.prepared;
        if (this.plan.parses && prepared !== void 0 && !prepared.ready) {
          this.conn.prepared?.evictFailed(prepared);
        }
        this.failure = new SqlError2({
          reason: classifyFields(message.fields, "PgConnection: Query failed", "query")
        });
        this.phase = "error";
        return;
      }
      case "ReadyForQuery":
        if (this.phase !== "complete") return this.failDesync(`Unexpected ReadyForQuery during ${this.phase}`);
        return this.complete(Effect2.succeed({
          result: {
            command: this.command,
            rowCount: this.rowCount,
            oid: this.oid,
            rows: this.rows ?? emptyRows,
            fields: this.resultFields
          },
          values: this.values ?? emptyValues
        }));
      case "CopyInResponse":
      case "CopyOutResponse":
      case "CopyBothResponse":
      case "CopyData":
      case "CopyDone":
        return this.failDesync(`Unexpected ${message._tag}; COPY is not supported`);
      default:
        return this.failDesync(`Unexpected ${message._tag} during ${this.phase}`);
    }
  }
};
var emptyRows = [];
var emptyValues = [];
var drainAborted = (conn, timeoutMessage, abort) => {
  const drained = Deferred.makeUnsafe();
  const timeout = setTimeout(() => conn.fatal(connectionQueryError(new Error(timeoutMessage), `PgConnection: ${timeoutMessage}`)), abortDrainTimeoutMillis);
  abort(() => {
    clearTimeout(timeout);
    Deferred.doneUnsafe(drained, Effect2.void);
  });
  const grace = Effect2.callback((resume) => {
    const timer = setTimeout(() => resume(Effect2.void), abortDrainGraceMillis);
    return Effect2.sync(() => clearTimeout(timer));
  });
  const cancelAndDrain = Effect2.andThen(conn.cancel, Deferred.await(drained));
  return Effect2.andThen(Effect2.raceFirst(Deferred.await(drained), grace), Effect2.suspend(() => Deferred.isDoneUnsafe(drained) ? Effect2.void : cancelAndDrain));
};
var runQuery = (conn, plan, wantRows) => Effect2.callback((resume) => {
  if (conn.deadWith !== void 0) {
    resume(Effect2.fail(conn.deadWith));
    return;
  }
  const machine = new QueryMachine(conn, plan, wantRows, (effect3) => {
    conn.consumer = void 0;
    resume(effect3);
  });
  conn.consumer = machine;
  conn.session.parser.readField = machine.readField;
  try {
    conn.session.socket.write(plan.frame);
  } catch (cause) {
    conn.fatal(connectionQueryError(cause, "PgConnection: Failed to write query"));
  }
  return Effect2.suspend(() => {
    if (machine.isDone()) return Effect2.void;
    return drainAborted(conn, "Query cancellation timed out", (onDrained) => machine.abort(() => {
      conn.consumer = void 0;
      onDrained();
    }));
  });
});
var emptyFields = [];
var describe = (fields, registry) => {
  const reader = makeFieldReader(fields, registry);
  if (EffectResult.isFailure(reader)) return EffectResult.fail(reader.failure);
  const resultFields = new Array(fields.length);
  for (let index = 0; index < fields.length; index++) {
    resultFields[index] = {
      name: fields[index].name,
      dataTypeId: fields[index].dataTypeOid
    };
  }
  return EffectResult.succeed({
    readField: reader.success,
    rowBuilder: makeRowBuilder(fields),
    resultFields
  });
};
var makeRowBuilder = (fields) => {
  const names = new Array(fields.length);
  let hasProto = false;
  for (let index = 0; index < fields.length; index++) {
    const name3 = fields[index].name;
    names[index] = name3;
    if (name3 === "__proto__") hasProto = true;
  }
  if (hasProto) {
    return (rowValues) => {
      const row = {};
      for (let index = 0; index < names.length; index++) {
        Object.defineProperty(row, names[index], {
          value: rowValues[index],
          enumerable: true,
          configurable: true,
          writable: true
        });
      }
      return row;
    };
  }
  return (rowValues) => {
    const row = {};
    for (let index = 0; index < names.length; index++) {
      row[names[index]] = rowValues[index];
    }
    return row;
  };
};
var streamRows = (conn, pin, sql2, params) => Stream.fromChannel(Channel.fromTransform(Effect2.fnUntraced(function* (_, scope) {
  yield* Scope.provide(pin, scope);
  yield* Scope.provide(Effect2.acquireRelease(conn.wire.take(1), () => conn.wire.release(1)), scope);
  if (conn.deadWith !== void 0) return yield* conn.deadWith;
  const plan = yield* Effect2.try({
    try: () => conn.encodeQuery(sql2, params, void 0),
    catch: (cause) => queryError(cause, "PgConnection: Failed to encode query")
  });
  const frame = plan.frame;
  const socket = conn.session.socket;
  const parser = conn.session.parser;
  let phase = "parse";
  let fieldCount = 0;
  let rowBuilder;
  let buffer = [];
  let failure;
  let finished = false;
  let done2 = false;
  let aborted = false;
  let paused = false;
  let pending;
  let drainDone;
  const setPaused = (value3) => {
    if (paused === value3) return;
    paused = value3;
    if (value3) socket.pause();
    else socket.resume();
  };
  const deliver = () => {
    if (pending === void 0) return;
    const resume = pending;
    if (buffer.length > 0) {
      const chunk = buffer;
      buffer = [];
      pending = void 0;
      resume(Effect2.succeed(chunk));
    } else if (finished) {
      pending = void 0;
      resume(failure !== void 0 ? Effect2.fail(failure) : Cause.done());
    }
  };
  const onFatal = (error) => {
    if (done2) return;
    done2 = true;
    finished = true;
    if (failure === void 0) failure = error;
    drainDone?.();
    deliver();
  };
  const failFatal = (error) => {
    conn.fatal(error);
    onFatal(error);
  };
  const failDesync = (message) => failFatal(connectionQueryError(new Error(message), `PgConnection: ${message}`));
  const onMessage = (message) => {
    if (aborted) {
      if (message._tag === "ReadyForQuery") {
        done2 = true;
        conn.consumer = void 0;
        drainDone?.();
      }
      return;
    }
    if (phase === "error") {
      switch (message._tag) {
        case "ReadyForQuery":
          finished = true;
          done2 = true;
          conn.consumer = void 0;
          deliver();
          return;
        default:
          return failDesync(`Unexpected ${message._tag} after ErrorResponse`);
      }
    }
    switch (message._tag) {
      case "ParseComplete":
        if (phase !== "parse") return failDesync(`Unexpected ParseComplete during ${phase}`);
        phase = "bind";
        return;
      case "BindComplete":
        if (phase !== "bind") return failDesync(`Unexpected BindComplete during ${phase}`);
        phase = "describe";
        return;
      case "RowDescription": {
        if (phase !== "describe") return failDesync(`Unexpected RowDescription during ${phase}`);
        const description = describe(message.fields, conn.registry);
        if (EffectResult.isFailure(description)) {
          return failFatal(queryError(description.failure, "PgConnection: Failed to decode row"));
        }
        fieldCount = message.fields.length;
        rowBuilder = description.success.rowBuilder;
        parser.readField = description.success.readField;
        phase = "rows";
        return;
      }
      case "NoData":
        if (phase !== "describe") return failDesync(`Unexpected NoData during ${phase}`);
        phase = "rows";
        return;
      case "DataRow": {
        if (phase !== "rows" || rowBuilder === void 0) {
          return failDesync(`Unexpected DataRow during ${phase}`);
        }
        const rowValues = message.values;
        if (rowValues.length !== fieldCount) {
          return failDesync(`DataRow has ${rowValues.length} values for ${fieldCount} fields`);
        }
        buffer.push(rowBuilder(rowValues));
        return;
      }
      case "CommandComplete":
        if (phase !== "rows") return failDesync(`Unexpected CommandComplete during ${phase}`);
        phase = "complete";
        return;
      case "EmptyQueryResponse":
        if (phase !== "rows") return failDesync(`Unexpected EmptyQueryResponse during ${phase}`);
        phase = "complete";
        return;
      case "ErrorResponse": {
        failure = new SqlError2({
          reason: classifyFields(message.fields, "PgConnection: Query failed", "query")
        });
        phase = "error";
        return;
      }
      case "ReadyForQuery":
        if (phase !== "complete") return failDesync(`Unexpected ReadyForQuery during ${phase}`);
        finished = true;
        done2 = true;
        conn.consumer = void 0;
        deliver();
        return;
      case "CopyInResponse":
      case "CopyOutResponse":
      case "CopyBothResponse":
      case "CopyData":
      case "CopyDone":
        return failDesync(`Unexpected ${message._tag}; COPY is not supported`);
      default:
        return failDesync(`Unexpected ${message._tag} during ${phase}`);
    }
  };
  const onBatchEnd = () => {
    if (done2 || aborted) return;
    if (pending !== void 0) deliver();
    else if (buffer.length >= streamPauseThreshold) setPaused(true);
  };
  yield* Scope.addFinalizer(scope, Effect2.suspend(() => {
    if (done2) return Effect2.void;
    aborted = true;
    const drain = drainAborted(conn, "Stream cancellation timed out", (onDrained) => {
      drainDone = onDrained;
    });
    setPaused(false);
    return drain;
  }));
  conn.consumer = {
    onMessage,
    onBatchEnd,
    onFatal
  };
  parser.readField = void 0;
  try {
    socket.write(frame);
  } catch (cause) {
    failFatal(connectionQueryError(cause, "PgConnection: Failed to write query"));
  }
  return Effect2.callback((resume) => {
    pending = resume;
    setPaused(false);
    deliver();
    if (pending === void 0) return;
    return Effect2.sync(() => {
      if (pending === resume) pending = void 0;
    });
  });
})));
var listenChannel = (conn, pin, channel) => Effect2.uninterruptibleMask((restore) => Effect2.gen(function* () {
  const channelError = validateChannelName(channel, "listen");
  if (channelError !== void 0) return yield* Effect2.fail(channelError);
  const parentScope = yield* Scope.Scope;
  const scope = yield* Scope.fork(parentScope);
  return yield* restore(Effect2.gen(function* () {
    const pinned = yield* Scope.provide(pin, scope);
    if (conn.deadWith !== void 0) return yield* conn.deadWith;
    const queue = yield* Queue.unbounded();
    const identifier = escapeIdentifier(channel);
    let queues = conn.channels.get(channel);
    if (queues === void 0) {
      queues = /* @__PURE__ */ new Set();
      conn.channels.set(channel, queues);
    }
    queues.add(queue);
    yield* Scope.addFinalizer(scope, Effect2.suspend(() => {
      const current = conn.channels.get(channel);
      if (current === void 0) return Queue.shutdown(queue);
      current.delete(queue);
      if (current.size > 0) return Queue.shutdown(queue);
      conn.channels.delete(channel);
      const unlisten = conn.deadWith === void 0 ? Effect2.ignore(pinned.query(`UNLISTEN ${identifier}`)) : Effect2.void;
      return Effect2.andThen(unlisten, Queue.shutdown(queue));
    }));
    yield* pinned.query(`LISTEN ${identifier}`);
    return queue;
  })).pipe(Effect2.tapCause((cause) => Scope.close(scope, Exit.failCause(cause))));
}));
var sendCancelRequest = (config, session) => Effect2.callback((resume) => {
  let done2 = false;
  let socket;
  let timer;
  const finish = () => {
    if (done2) return;
    done2 = true;
    if (timer !== void 0) clearTimeout(timer);
    socket?.destroy();
    resume(Effect2.void);
  };
  const frame = encodeCancelRequest({
    pid: session.processId,
    secret: session.secretKey
  });
  const send = () => {
    socket.write(frame);
  };
  const begin2 = () => {
    if (config.ssl === false) return send();
    socket.once("data", (chunk) => {
      if (done2) return;
      if (chunk.length === 1 && chunk[0] === 78 && config.sslOptional && !session.encrypted) return send();
      if (chunk.length !== 1 || chunk[0] !== 83) return finish();
      const raw = socket;
      raw.off("error", finish);
      raw.off("close", finish);
      socket = Tls.connect({
        host: config.host,
        servername: Net.isIP(config.host) === 0 ? config.host : void 0,
        ...typeof config.ssl === "object" ? config.ssl : {},
        socket: raw
      });
      socket.on("error", finish);
      socket.on("close", finish);
      socket.once("secureConnect", send);
    });
    socket.write(encodeSslRequest());
  };
  try {
    socket = config.stream !== void 0 ? config.stream() : config.path !== void 0 ? Net.connect({
      path: config.path
    }) : Net.connect({
      host: config.host,
      port: config.port,
      noDelay: true
    });
  } catch {
    resume(Effect2.void);
    return;
  }
  timer = setTimeout(finish, cancelRequestTimeoutMillis);
  socket.on("error", finish);
  socket.on("close", finish);
  if (config.stream !== void 0) begin2();
  else socket.once("connect", begin2);
  return Effect2.sync(finish);
});
var connect3 = (config, resolvedPassword) => Effect2.callback((resume) => {
  let done2 = false;
  let socket;
  let encrypted = false;
  let parser;
  let sslErrorParser;
  let scram;
  let processId = 0;
  let secretKey = 0;
  const fail12 = (reason) => {
    if (done2) return;
    done2 = true;
    socket?.destroy();
    resume(Effect2.fail(new SqlError2({
      reason
    })));
  };
  const failConnect = (cause, message) => fail12(new ConnectionError2({
    cause,
    message,
    operation: "connect"
  }));
  const failAuth = (cause, message) => fail12(new AuthenticationError2({
    cause,
    message,
    operation: "connect"
  }));
  const onError = (cause) => failConnect(cause, "PgConnection: Failed to connect");
  const onClose = () => failConnect(new Error("Connection closed unexpectedly"), "PgConnection: Connection closed during startup");
  const password = () => {
    if (resolvedPassword === void 0) {
      failAuth(new Error("The server requested password authentication"), "PgConnection: No password configured");
      return void 0;
    }
    return resolvedPassword;
  };
  const handleMessage = (message) => {
    switch (message._tag) {
      case "AuthenticationOk":
      case "NoticeResponse":
      case "NegotiateProtocolVersion":
      case "ParameterStatus":
        return;
      case "AuthenticationCleartextPassword": {
        const secret = password();
        if (secret === void 0) return;
        socket.write(encodePasswordMessage({
          password: secret
        }));
        return;
      }
      case "AuthenticationMD5Password": {
        const secret = password();
        if (secret === void 0) return;
        const hashed = md5Password({
          user: config.username,
          password: secret,
          salt: message.salt
        });
        if (EffectResult.isFailure(hashed)) {
          return failAuth(hashed.failure, "PgConnection: MD5 authentication failed");
        }
        socket.write(encodePasswordMessage({
          password: hashed.success
        }));
        return;
      }
      case "AuthenticationSASL": {
        if (!message.mechanisms.includes(SCRAM_SHA_256)) {
          return failAuth(new Error(`Unsupported SASL mechanisms: ${message.mechanisms.join(", ")}`), `PgConnection: Only ${SCRAM_SHA_256} is supported`);
        }
        const secret = password();
        if (secret === void 0) return;
        const init = scramInit({
          password: secret,
          nonce: randomBytes(18).toString("base64")
        });
        if (EffectResult.isFailure(init)) {
          return failAuth(init.failure, "PgConnection: SCRAM authentication failed");
        }
        scram = init.success.state;
        socket.write(encodeSASLInitialResponse({
          mechanism: SCRAM_SHA_256,
          initialResponse: init.success.response
        }));
        return;
      }
      case "AuthenticationSASLContinue": {
        if (scram === void 0 || scram._tag !== "ScramFirst") {
          return failConnect(new Error("Unexpected AuthenticationSASLContinue"), "PgConnection: Protocol desync");
        }
        const next = scramContinue(scram, message.data);
        if (EffectResult.isFailure(next)) {
          return failAuth(next.failure, "PgConnection: SCRAM authentication failed");
        }
        scram = next.success.state;
        socket.write(encodeSASLResponse({
          data: next.success.response
        }));
        return;
      }
      case "AuthenticationSASLFinal": {
        if (scram === void 0 || scram._tag !== "ScramFinal") {
          return failConnect(new Error("Unexpected AuthenticationSASLFinal"), "PgConnection: Protocol desync");
        }
        const verified = scramFinish(scram, message.data);
        if (EffectResult.isFailure(verified)) {
          return failAuth(verified.failure, "PgConnection: SCRAM server verification failed");
        }
        scram = void 0;
        return;
      }
      case "AuthenticationUnsupported":
        return failAuth(new Error(`Authentication method ${message.method} is not supported`), "PgConnection: Unsupported authentication method");
      case "BackendKeyData":
        processId = message.pid;
        secretKey = message.secret;
        return;
      case "ErrorResponse":
        return fail12(classifyFields(message.fields, "PgConnection: Failed to connect", "connect"));
      case "ReadyForQuery":
        if (scram !== void 0) {
          return failAuth(new Error("The server completed authentication without proving its identity"), "PgConnection: SCRAM exchange did not complete");
        }
        done2 = true;
        socket.off("data", onData);
        socket.off("error", onError);
        socket.off("close", onClose);
        socket.on("error", ignoreError);
        resume(Effect2.succeed({
          socket,
          encrypted,
          parser,
          processId,
          secretKey
        }));
        return;
      default:
        return failConnect(new Error(`Unexpected ${message._tag} message during startup`), "PgConnection: Protocol desync");
    }
  };
  const onData = (chunk) => {
    let messages;
    try {
      messages = parser.push(chunk);
    } catch (cause) {
      return failConnect(cause, "PgConnection: Failed to parse server response");
    }
    for (const message of messages) {
      if (done2) return;
      handleMessage(message);
    }
  };
  const startup = () => {
    parser = makeParser({
      maxMessageSize: config.maxMessageSize
    });
    socket.on("data", onData);
    socket.write(encodeStartupMessage(config.startupParameters));
  };
  const onSslResponse = (chunk) => {
    if (done2) return;
    if (sslErrorParser !== void 0 || chunk[0] === 69) {
      sslErrorParser ??= makeParser({
        maxMessageSize: config.maxMessageSize
      });
      let messages;
      try {
        messages = sslErrorParser.push(chunk);
      } catch (cause) {
        return failConnect(cause, "PgConnection: Failed to parse SSLRequest error response");
      }
      if (messages.length === 0) return;
      socket.off("data", onSslResponse);
      const message = messages[0];
      if (messages.length !== 1 || message._tag !== "ErrorResponse") {
        return failConnect(new Error("Expected one ErrorResponse after SSLRequest"), "PgConnection: Invalid SSLRequest response");
      }
      return fail12(classifyFields(message.fields, "PgConnection: Failed to negotiate TLS", "connect"));
    }
    socket.off("data", onSslResponse);
    if (chunk.length !== 1) {
      return failConnect(new Error(`Received ${chunk.length} bytes in response to SSLRequest`), "PgConnection: Invalid SSLRequest response");
    }
    const response = decodeSslResponse(chunk[0]);
    if (EffectResult.isFailure(response)) {
      return failConnect(response.failure, "PgConnection: Invalid SSLRequest response");
    }
    if (response.success === "N") {
      if (config.sslOptional) return startup();
      return failConnect(new Error("The server does not support TLS"), "PgConnection: Server refused TLS");
    }
    const raw = socket;
    raw.off("error", onError);
    raw.off("close", onClose);
    socket = Tls.connect({
      host: config.host,
      servername: Net.isIP(config.host) === 0 ? config.host : void 0,
      ...typeof config.ssl === "object" ? config.ssl : {},
      socket: raw
    });
    socket.on("error", onError);
    socket.on("close", onClose);
    socket.once("secureConnect", () => {
      encrypted = true;
      startup();
    });
  };
  const begin2 = () => {
    if (config.ssl === false) return startup();
    socket.on("data", onSslResponse);
    socket.write(encodeSslRequest());
  };
  try {
    socket = config.stream !== void 0 ? config.stream() : config.path !== void 0 ? Net.connect({
      path: config.path
    }) : Net.connect({
      host: config.host,
      port: config.port,
      noDelay: true
    });
  } catch (cause) {
    resume(Effect2.fail(new SqlError2({
      reason: new ConnectionError2({
        cause,
        message: "PgConnection: Failed to connect",
        operation: "connect"
      })
    })));
    return;
  }
  socket.on("error", onError);
  socket.on("close", onClose);
  if (config.stream !== void 0) {
    begin2();
  } else {
    socket.once("connect", begin2);
  }
  return Effect2.sync(() => {
    if (done2) return;
    done2 = true;
    socket.destroy();
  });
});
var ignoreError = (_) => {
};
var configError = (message, cause) => new SqlError2({
  reason: new ConnectionError2({
    cause: cause ?? new Error(message),
    message: `PgConnection: ${message}`,
    operation: "connect"
  })
});
var resolveConfig = (options) => Effect2.suspend(() => {
  const parsed = options.url !== void 0 ? parseUrl(Redacted2.value(options.url)) : EffectResult.succeed({});
  if (EffectResult.isFailure(parsed)) return Effect2.fail(parsed.failure);
  const url = parsed.success;
  const host = options.host ?? url.host ?? "localhost";
  const port = options.port ?? url.port ?? 5432;
  const username = options.username ?? url.username ?? process.env.USER ?? process.env.USERNAME;
  if (username === void 0) {
    return Effect2.fail(configError("No username configured"));
  }
  const named = /* @__PURE__ */ Object.create(null);
  for (const [name3, value3] of Object.entries(options.startupParameters ?? {})) {
    const key = name3.toLowerCase();
    if (key === "user" || key === "database" || key === "replication" || key === "options") {
      return Effect2.fail(configError(`Reserved startup parameter: "${name3}"`));
    }
    if (key === "client_encoding") {
      const encoding = value3.toUpperCase();
      if (encoding !== "UTF8" && encoding !== "UTF-8") {
        return Effect2.fail(configError("Startup parameter client_encoding must be UTF8 or UTF-8"));
      }
      named[key] = "UTF8";
    } else {
      named[key] = value3;
    }
    if (name3 === "" || name3.includes("\0") || value3.includes("\0")) {
      return Effect2.fail(configError("Startup parameter names must be nonempty and names/values must not contain NUL"));
    }
  }
  const startupParameters = {
    ...named,
    user: username,
    database: options.database ?? url.database,
    application_name: options.applicationName ?? named.application_name ?? url.applicationName ?? "@effect/sql-pg",
    options: options.startupOptions ?? url.options
  };
  for (const [name3, value3] of Object.entries(startupParameters)) {
    if (value3?.includes("\0")) {
      return Effect2.fail(configError(`Startup parameter "${name3}" must not contain NUL`));
    }
  }
  return Effect2.succeed({
    host,
    port,
    path: options.path ?? (host.startsWith("/") ? `${host}/.s.PGSQL.${port}` : void 0),
    ssl: options.ssl ?? (url.ssl === "prefer" ? true : url.ssl ?? false),
    sslOptional: options.ssl === void 0 && url.ssl === "prefer",
    username,
    password: options.password ?? (url.password !== void 0 ? Redacted2.make(url.password) : void 0),
    connectTimeout: Duration.fromInputUnsafe(options.connectTimeout ?? url.connectTimeout ?? Duration.seconds(5)),
    startupParameters,
    stream: options.stream,
    maxMessageSize: options.maxMessageSize
  });
});
var decodeComponent = (value3, what) => {
  try {
    return EffectResult.succeed(decodeURIComponent(value3));
  } catch {
    return EffectResult.fail(configError(`Invalid percent-encoding in URL ${what}`));
  }
};
var parsePort = (value3, what) => {
  const port = Number(value3);
  return !Number.isInteger(port) || port < 1 || port > 65535 ? EffectResult.fail(configError(`Invalid port in URL ${what}: "${value3}"`)) : EffectResult.succeed(port);
};
var parseUrl = (raw) => {
  let url;
  try {
    url = new URL(raw);
  } catch (cause) {
    return EffectResult.fail(configError("Invalid connection URL", cause));
  }
  if (url.protocol !== "postgres:" && url.protocol !== "postgresql:") {
    return EffectResult.fail(configError(`Unsupported connection URL protocol: "${url.protocol}"`));
  }
  const config = {};
  if (url.hostname !== "") {
    if (url.hostname.startsWith("[") && url.hostname.endsWith("]")) {
      config.host = url.hostname.slice(1, -1);
    } else {
      const host = decodeComponent(url.hostname, "host");
      if (EffectResult.isFailure(host)) return EffectResult.fail(host.failure);
      config.host = host.success;
    }
  }
  if (url.port !== "") {
    const port = parsePort(url.port, "authority");
    if (EffectResult.isFailure(port)) return EffectResult.fail(port.failure);
    config.port = port.success;
  }
  if (url.username !== "") {
    const username = decodeComponent(url.username, "username");
    if (EffectResult.isFailure(username)) return EffectResult.fail(username.failure);
    config.username = username.success;
  }
  if (url.password !== "") {
    const password = decodeComponent(url.password, "password");
    if (EffectResult.isFailure(password)) return EffectResult.fail(password.failure);
    config.password = password.success;
  }
  const database = decodeComponent(url.pathname.replace(/^\//, ""), "database");
  if (EffectResult.isFailure(database)) return EffectResult.fail(database.failure);
  if (database.success !== "") config.database = database.success;
  for (const [key, value3] of url.searchParams) {
    switch (key) {
      case "host":
        config.host = value3;
        break;
      case "port": {
        const port = parsePort(value3, "port parameter");
        if (EffectResult.isFailure(port)) return EffectResult.fail(port.failure);
        config.port = port.success;
        break;
      }
      case "user":
        config.username = value3;
        break;
      case "password":
        config.password = value3;
        break;
      case "dbname":
        config.database = value3;
        break;
      case "application_name":
        config.applicationName = value3;
        break;
      case "options":
        config.options = value3;
        break;
      case "connect_timeout": {
        const seconds3 = Number(value3);
        if (!Number.isInteger(seconds3) || seconds3 < 0) {
          return EffectResult.fail(configError(`Invalid connect_timeout in URL: "${value3}"`));
        }
        config.connectTimeout = seconds3 === 0 ? Duration.infinity : Duration.seconds(seconds3);
        break;
      }
      case "sslmode":
        switch (value3) {
          case "disable":
            config.ssl = false;
            break;
          case "require":
          case "verify-ca":
          case "verify-full":
            config.ssl = true;
            break;
          case "prefer":
          case "allow":
            config.ssl = "prefer";
            break;
          default:
            return EffectResult.fail(configError(`Unrecognized sslmode in URL: "${value3}"`));
        }
        break;
    }
  }
  return EffectResult.succeed(config);
};
var classifyFields = (fields, message, operation) => {
  const cause = Object.assign(new Error(fields.message ?? "Unknown PostgreSQL error"), fields);
  return classifySqlState(fields.code, fields.constraint, {
    cause,
    message,
    operation
  });
};

// node_modules/.bun/@effect+sql-pg@4.0.0+a594d97e083afb95/node_modules/@effect/sql-pg/dist/PgPool.js
import * as Clock from "effect/Clock";
import * as Context2 from "effect/Context";
import * as Duration2 from "effect/Duration";
import * as Effect3 from "effect/Effect";
import * as Pool from "effect/Pool";
var defaultMultiplexConcurrency = 32;
var TypeId2 = "~@effect/sql-pg/PgPool";
var make4 = /* @__PURE__ */ Effect3.fnUntraced(function* (options) {
  const clock = yield* Clock.Clock;
  const runFork = Effect3.runForkWith(yield* Effect3.context());
  const multiplex = options.multiplex ?? false;
  const connectionTTL = options.connectionTTL !== void 0 ? Duration2.toMillis(Duration2.fromInputUnsafe(options.connectionTTL)) : void 0;
  const deadConnections = /* @__PURE__ */ new Set();
  const createdAt = /* @__PURE__ */ new WeakMap();
  const checkedOut = /* @__PURE__ */ new WeakSet();
  let pool;
  const acquire = Effect3.tap(make3(options), (connection) => Effect3.sync(() => {
    createdAt.set(connection, clock.currentTimeMillisUnsafe());
    const internals = connectionInternals(connection);
    internals.retireHooks.add(() => {
      deadConnections.add(connection);
      runFork(Pool.invalidate(pool, connection));
    });
    if (multiplex) internals.reserve = Pool.reserve(pool, connection);
  }));
  const maxConnections = options.maxConnections ?? 10;
  pool = yield* Pool.makeWithTTL({
    acquire,
    min: options.minConnections ?? 0,
    max: maxConnections,
    concurrency: multiplex ? Math.max(1, options.multiplexConcurrency ?? defaultMultiplexConcurrency) : 1,
    timeToLive: options.idleTimeout ?? Duration2.seconds(10),
    timeToLiveStrategy: "usage"
  });
  const expired = (connection) => {
    if (connectionInternals(connection).deadError() !== void 0) return true;
    if (connectionTTL === void 0) return false;
    if (!checkedOut.has(connection)) {
      checkedOut.add(connection);
      return false;
    }
    const openedAt = createdAt.get(connection);
    return openedAt !== void 0 && clock.currentTimeMillisUnsafe() - openedAt >= connectionTTL;
  };
  const retry = Effect3.gen(function* () {
    while (true) {
      if (deadConnections.size > 0) {
        const dead = Array.from(deadConnections);
        deadConnections.clear();
        yield* Effect3.forEach(dead, (connection2) => Pool.invalidate(pool, connection2), {
          discard: true
        });
      }
      const connection = yield* Pool.get(pool);
      if (expired(connection)) {
        yield* Pool.invalidate(pool, connection);
        continue;
      }
      return connection;
    }
  });
  const get2 = Effect3.suspend(() => deadConnections.size > 0 ? retry : Effect3.flatMap(Pool.get(pool), (connection) => expired(connection) ? Effect3.andThen(Pool.invalidate(pool, connection), retry) : Effect3.succeed(connection)));
  const reserve2 = Effect3.flatMap(get2, (connection) => connection.pin);
  const use2 = (f) => Effect3.suspend(() => connectionTTL === void 0 && deadConnections.size === 0 ? Pool.use(pool, f) : Effect3.scoped(Effect3.flatMap(get2, f)));
  const pgPool = {
    [TypeId2]: TypeId2,
    config: options,
    get: get2,
    reserve: reserve2,
    use: use2,
    invalidate: (connection) => Pool.invalidate(pool, connectionInternals(connection).base)
  };
  return pgPool;
});

// node_modules/.bun/@effect+sql-pg@4.0.0+a594d97e083afb95/node_modules/@effect/sql-pg/dist/PgClient.js
var TypeId3 = "~@effect/sql-pg/PgClient";
var PgClient = /* @__PURE__ */ Context3.Service("@effect/sql-pg/PgClient");
var make7 = (options) => Effect4.flatMap(make4(options), (pool) => makeImpl({
  acquirer: Effect4.map(pool.get, makeConnection),
  borrower: (f) => pool.use((connection) => f(makeConnection(connection))),
  transactionAcquirer: Effect4.map(pool.reserve, makeConnection),
  listenAcquirer: pool.reserve,
  config: options
}));
var makeImpl = /* @__PURE__ */ Effect4.fnUntraced(function* (options) {
  const config = options.config;
  const compiler = makeCompiler2(config.transformQueryNames, config.transformJson);
  const transformRows = config.transformResultNames ? Statement.defaultTransforms(config.transformResultNames, config.transformJson).array : void 0;
  const listen = (channel) => Effect4.flatMap(options.listenAcquirer, (connection) => connection.listen(channel));
  return Object.assign(yield* Client.make({
    acquirer: options.acquirer,
    borrower: options.borrower,
    // Postgres prepares transaction control like anything else, and a client
    // with preparation turned off falls back to the unnamed path anyway.
    prepareTransactionControls: true,
    commit,
    releaseSavepoint: (name3) => `RELEASE SAVEPOINT ${name3}`,
    transactionAcquirer: options.transactionAcquirer,
    compiler,
    spanAttributes: [...config.spanAttributes ? Object.entries(config.spanAttributes) : [], [ATTR_DB_SYSTEM_NAME, "postgresql"], [ATTR_DB_NAMESPACE, config.database ?? config.username ?? "postgres"], [ATTR_SERVER_ADDRESS, config.host ?? "localhost"], [ATTR_SERVER_PORT, config.port ?? 5432]],
    transformRows
  }), {
    [TypeId3]: TypeId3,
    config,
    json: (_) => Statement.fragment([PgJson(_)]),
    listen,
    notify: (channel, payload) => {
      const channelError = validateChannelName(channel, "notify");
      return channelError !== void 0 ? Effect4.fail(channelError) : Effect4.asVoid(Effect4.scoped(Effect4.flatMap(options.acquirer, (conn) => conn.executeRaw(`SELECT pg_notify($1, $2)`, [channel, payload]))));
    }
  });
});
var ConnectionImpl = class {
  connection;
  streamAcquirer;
  constructor(connection, streamAcquirer) {
    this.connection = connection;
    this.streamAcquirer = streamAcquirer;
  }
  run(query, params, prepare = true) {
    return Effect4.map(this.connection.query(query, params, prepare), (result3) => result3.rows);
  }
  execute(sql2, params, transformRows) {
    return transformRows ? Effect4.map(this.run(sql2, params), transformRows) : this.run(sql2, params);
  }
  executeRaw(sql2, params) {
    return this.connection.query(sql2, params);
  }
  executeWithoutTransform(sql2, params) {
    return this.run(sql2, params);
  }
  executeValues(sql2, params) {
    return this.connection.queryValues(sql2, params);
  }
  executeValuesUnprepared(sql2, params) {
    return this.connection.queryValues(sql2, params, false);
  }
  executeUnprepared(sql2, params, transformRows) {
    const operation = this.run(sql2, params, false);
    return transformRows ? Effect4.map(operation, transformRows) : operation;
  }
  executeStream(sql2, params, transformRows) {
    const stream = this.streamAcquirer === void 0 ? this.connection.stream(sql2, params) : Stream2.unwrap(Effect4.map(this.streamAcquirer, (connection) => connection.stream(sql2, params)));
    return transformRows ? Stream2.mapArray(stream, (rows) => transformRows(rows)) : stream;
  }
};
var commit = (conn) => Effect4.flatMap(conn.executeRaw("COMMIT", []), (result3) => result3.command === "ROLLBACK" ? Effect4.fail(new SqlError3({
  reason: new UnknownError3({
    cause: new Error("COMMIT rolled back an aborted transaction"),
    message: "PgClient: COMMIT rolled back an aborted transaction",
    operation: "commit"
  })
})) : Effect4.void);
var makeConnection = (connection, streamAcquirer) => new ConnectionImpl(connection, streamAcquirer);
var makeCompiler2 = (transform, transformJson = true) => {
  const transformValue = transformJson && transform ? Statement.defaultTransforms(transform).value : void 0;
  return Statement.makeCompiler({
    dialect: "pg",
    placeholder(_) {
      return `$${_}`;
    },
    onIdentifier: transform ? function(value3, withoutTransform) {
      return withoutTransform ? escape(value3) : escape(transform(value3));
    } : escape,
    onRecordUpdate(placeholders, valueAlias, valueColumns, values, returning) {
      return [`(values ${placeholders}) AS ${valueAlias}${valueColumns}${returning ? ` RETURNING ${returning[0]}` : ""}`, returning ? values.flat().concat(returning[1]) : values.flat()];
    },
    onCustom(type, placeholder2, withoutTransform) {
      switch (type.kind) {
        case "PgJson": {
          const value3 = withoutTransform || transformValue === void 0 ? type.paramA : transformValue(type.paramA);
          return [placeholder2(void 0), [jsonb(value3)]];
        }
      }
    }
  });
};
var escape = /* @__PURE__ */ Statement.defaultEscape('"');
var PgJson = /* @__PURE__ */ Statement.custom("PgJson");
var ATTR_DB_SYSTEM_NAME = "db.system.name";
var ATTR_DB_NAMESPACE = "db.namespace";
var ATTR_SERVER_ADDRESS = "server.address";
var ATTR_SERVER_PORT = "server.port";

// node_modules/.bun/drizzle-orm@1.0.0-rc.5-169397b+5a2a64b31368e2d8/node_modules/drizzle-orm/pg-core/array.js
var DEFAULT_DELIM = ",";
function parsePgArrayValue(arrayString, startFrom, inQuotes, delim) {
  for (let i = startFrom; i < arrayString.length; i++) {
    const char2 = arrayString[i];
    if (char2 === "\\") {
      i++;
      continue;
    }
    if (char2 === '"') return [arrayString.slice(startFrom, i).replace(/\\(.)/g, "$1"), i + 1];
    if (inQuotes) continue;
    if (char2 === delim || char2 === "}") return [arrayString.slice(startFrom, i).replace(/\\(.)/g, "$1"), i];
  }
  return [arrayString.slice(startFrom).replace(/\\(.)/g, "$1"), arrayString.length];
}
function parsePgNestedArray(arrayString, startFrom = 0, delim = DEFAULT_DELIM) {
  const result3 = [];
  let i = startFrom;
  let lastCharIsDelim = false;
  while (i < arrayString.length) {
    const char2 = arrayString[i];
    if (char2 === delim) {
      if (lastCharIsDelim || i === startFrom) result3.push("");
      lastCharIsDelim = true;
      i++;
      continue;
    }
    lastCharIsDelim = false;
    if (char2 === "\\") {
      i += 2;
      continue;
    }
    if (char2 === '"') {
      const [value4, startFrom2] = parsePgArrayValue(arrayString, i + 1, true, delim);
      result3.push(value4);
      i = startFrom2;
      continue;
    }
    if (char2 === "}") return [result3, i + 1];
    if (char2 === "{") {
      const [value4, startFrom2] = parsePgNestedArray(arrayString, i + 1, delim);
      result3.push(value4);
      i = startFrom2;
      continue;
    }
    const [value3, newStartFrom] = parsePgArrayValue(arrayString, i, false, delim);
    result3.push(value3);
    i = newStartFrom;
  }
  return [result3, i];
}
function parsePgArray(arrayString, delim = DEFAULT_DELIM) {
  const [result3] = parsePgNestedArray(arrayString, 1, delim);
  return result3;
}
function buildPgArray(array, delim) {
  return `{${array.map((item) => {
    if (Array.isArray(item)) return buildPgArray(item, delim);
    if (typeof item === "string") return `"${item.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;
    return `${item}`;
  }).join(delim)}}`;
}
function makePgArray(array, delim = DEFAULT_DELIM) {
  return buildPgArray(array, delim);
}

// node_modules/.bun/drizzle-orm@1.0.0-rc.5-169397b+5a2a64b31368e2d8/node_modules/drizzle-orm/pg-core/columns/postgis_extension/utils.js
function hexToBytes(hex) {
  const bytes = [];
  for (let c = 0; c < hex.length; c += 2) bytes.push(Number.parseInt(hex.slice(c, c + 2), 16));
  return new Uint8Array(bytes);
}
function bytesToFloat64(bytes, offset) {
  const buffer = /* @__PURE__ */ new ArrayBuffer(8);
  const view2 = new DataView(buffer);
  for (let i = 0; i < 8; i++) view2.setUint8(i, bytes[offset + i]);
  return view2.getFloat64(0, true);
}
function parseEWKB(hex) {
  const bytes = hexToBytes(hex);
  let offset = 0;
  const byteOrder = bytes[offset];
  offset += 1;
  const view2 = new DataView(bytes.buffer);
  const geomType = view2.getUint32(offset, byteOrder === 1);
  offset += 4;
  let srid;
  if (geomType & 536870912) {
    srid = view2.getUint32(offset, byteOrder === 1);
    offset += 4;
  }
  if ((geomType & 65535) === 1) {
    const x = bytesToFloat64(bytes, offset);
    offset += 8;
    const y = bytesToFloat64(bytes, offset);
    offset += 8;
    return {
      srid,
      point: [x, y]
    };
  }
  throw new Error("Unsupported geometry type");
}

// node_modules/.bun/drizzle-orm@1.0.0-rc.5-169397b+5a2a64b31368e2d8/node_modules/drizzle-orm/entity.js
var entityKind = Symbol.for("drizzle:entityKind");
var hasOwnEntityKind = Symbol.for("drizzle:hasOwnEntityKind");
function is(value3, type) {
  if (!value3 || typeof value3 !== "object") return false;
  if (value3 instanceof type) return true;
  let cls = Object.getPrototypeOf(value3)?.constructor;
  while (cls) {
    if (entityKind in cls && cls[entityKind] === type[entityKind]) return true;
    cls = Object.getPrototypeOf(cls);
  }
  return false;
}

// node_modules/.bun/drizzle-orm@1.0.0-rc.5-169397b+5a2a64b31368e2d8/node_modules/drizzle-orm/codecs.js
var noopCodecs = {};
var arrayToItemTypeCodecNameMap = {
  cast: "cast",
  castArray: "cast",
  castInJson: "castInJson",
  castArrayInJson: "castInJson",
  castParam: "castParam",
  castArrayParam: "castParam",
  normalize: "normalize",
  normalizeArray: "normalize",
  normalizeInJson: "normalizeInJson",
  normalizeArrayInJson: "normalizeInJson",
  normalizeParam: "normalizeParam",
  normalizeParamArray: "normalizeParam"
};
var itemToArrayTypeCodecNameMap = {
  cast: "castArray",
  castArray: "castArray",
  castInJson: "castArrayInJson",
  castArrayInJson: "castArrayInJson",
  castParam: "castArrayParam",
  castArrayParam: "castArrayParam",
  normalize: "normalizeArray",
  normalizeArray: "normalizeArray",
  normalizeInJson: "normalizeArrayInJson",
  normalizeArrayInJson: "normalizeArrayInJson",
  normalizeParam: "normalizeParamArray",
  normalizeParamArray: "normalizeParamArray"
};
var CodecsCollection = class {
  static [entityKind] = "CodecsCollection";
  constructor(resolveTypes, codecs2 = noopCodecs) {
    this.resolveTypes = resolveTypes;
    this.codecs = codecs2;
  }
  get(column, type, override) {
    const sqlType = override ?? column.codec;
    if (!sqlType) return void 0;
    const codecType = column.dimensions ? itemToArrayTypeCodecNameMap[type] : arrayToItemTypeCodecNameMap[type];
    return this.codecs[sqlType]?.[codecType];
  }
  apply(column, type, value3, override) {
    const sqlType = override ?? column.codec;
    if (!sqlType) return value3;
    const codecType = column.dimensions ? itemToArrayTypeCodecNameMap[type] : arrayToItemTypeCodecNameMap[type];
    const codec = this.codecs[sqlType]?.[codecType];
    if (!codec) return value3;
    if (codecType === "castParam" || codecType === "castArrayParam") return codec(value3, column, column.dimensions);
    return codec(value3, column.dimensions);
  }
};
function refineCodecs(source, extension = {}) {
  const keys = (/* @__PURE__ */ new Set([...Object.keys(source), ...Object.keys(extension)])).values();
  const result3 = {};
  for (const k of keys) {
    if (!(k in extension)) {
      result3[k] = source[k] ? { ...source[k] } : void 0;
      continue;
    }
    if (!(k in source) || extension[k] === void 0) {
      result3[k] = extension[k] ? { ...extension[k] } : void 0;
      continue;
    }
    const innerKeys = (/* @__PURE__ */ new Set([...Object.keys(extension[k]), ...Object.keys(source[k] ?? {})])).values();
    result3[k] = {};
    for (const ik of innerKeys) result3[k][ik] = ik in extension[k] ? extension[k][ik] : source[k]?.[ik];
  }
  return result3;
}

// node_modules/.bun/drizzle-orm@1.0.0-rc.5-169397b+5a2a64b31368e2d8/node_modules/drizzle-orm/column-common.js
var OriginalColumn = Symbol.for("drizzle:OriginalColumn");

// node_modules/.bun/drizzle-orm@1.0.0-rc.5-169397b+5a2a64b31368e2d8/node_modules/drizzle-orm/column.js
var noop = (v) => v;
noop.isNoop = true;
var Column = class {
  static [entityKind] = "Column";
  /** @internal */
  codec;
  name;
  keyAsName;
  primary;
  notNull;
  default;
  defaultFn;
  onUpdateFn;
  hasDefault;
  isUnique;
  uniqueName;
  uniqueType;
  dataType;
  columnType;
  enumValues = void 0;
  generated = void 0;
  generatedIdentity = void 0;
  length;
  isLengthExact;
  isAlias;
  /** @internal */
  config;
  /** @internal */
  table;
  /** @internal */
  onInit() {
  }
  constructor(table2, config) {
    this.config = config;
    this.onInit();
    this.table = table2;
    this.name = config.name;
    this.isAlias = false;
    this.keyAsName = config.keyAsName;
    this.notNull = config.notNull;
    this.default = config.default;
    this.defaultFn = config.defaultFn;
    this.onUpdateFn = config.onUpdateFn;
    this.hasDefault = config.hasDefault;
    this.primary = config.primaryKey;
    this.isUnique = config.isUnique;
    this.uniqueName = config.uniqueName;
    this.uniqueType = config.uniqueType;
    this.dataType = config.dataType;
    this.columnType = config.columnType;
    this.generated = config.generated;
    this.generatedIdentity = config.generatedIdentity;
    this.length = config["length"];
    this.isLengthExact = config["isLengthExact"];
  }
  mapFromDriverValue = noop;
  mapToDriverValue = noop;
  /** @internal */
  postBuild() {
    return this;
  }
  /** @internal */
  shouldDisableInsert() {
    return this.config.generated !== void 0 && this.config.generated.type !== "byDefault";
  }
  /** @internal */
  [OriginalColumn]() {
    return this;
  }
};

// node_modules/.bun/drizzle-orm@1.0.0-rc.5-169397b+5a2a64b31368e2d8/node_modules/drizzle-orm/table.utils.js
var TableName = Symbol.for("drizzle:Name");

// node_modules/.bun/drizzle-orm@1.0.0-rc.5-169397b+5a2a64b31368e2d8/node_modules/drizzle-orm/table.js
var TableSchema = Symbol.for("drizzle:Schema");
var TableColumns = Symbol.for("drizzle:Columns");
var ExtraConfigColumns = Symbol.for("drizzle:ExtraConfigColumns");
var OriginalName = Symbol.for("drizzle:OriginalName");
var BaseName = Symbol.for("drizzle:BaseName");
var IsAlias = Symbol.for("drizzle:IsAlias");
var ExtraConfigBuilder = Symbol.for("drizzle:ExtraConfigBuilder");
var IsDrizzleTable = Symbol.for("drizzle:IsDrizzleTable");
var Table = class {
  static [entityKind] = "Table";
  /** @internal */
  static Symbol = {
    Name: TableName,
    Schema: TableSchema,
    OriginalName,
    Columns: TableColumns,
    ExtraConfigColumns,
    BaseName,
    IsAlias,
    ExtraConfigBuilder
  };
  /**
  * @internal
  * Can be changed if the table is aliased.
  */
  [TableName];
  /**
  * @internal
  * Used to store the original name of the table, before any aliasing.
  */
  [OriginalName];
  /** @internal */
  [TableSchema];
  /** @internal */
  [TableColumns];
  /** @internal */
  [ExtraConfigColumns];
  /**
  *  @internal
  * Used to store the table name before the transformation via the `tableCreator` functions.
  */
  [BaseName];
  /** @internal */
  [IsAlias] = false;
  /** @internal */
  [IsDrizzleTable] = true;
  /** @internal */
  [ExtraConfigBuilder] = void 0;
  constructor(name3, schema, baseName) {
    this[TableName] = this[OriginalName] = name3;
    this[TableSchema] = schema;
    this[BaseName] = baseName;
  }
};
function getTableName(table2) {
  return table2[TableName];
}

// node_modules/.bun/drizzle-orm@1.0.0-rc.5-169397b+5a2a64b31368e2d8/node_modules/drizzle-orm/subquery.js
var Subquery = class {
  static [entityKind] = "Subquery";
  constructor(sql2, fields, alias, isWith = false, usedTables = []) {
    this._ = {
      brand: "Subquery",
      sql: sql2,
      selectedFields: fields,
      alias,
      isWith,
      usedTables
    };
  }
};
var WithSubquery = class extends Subquery {
  static [entityKind] = "WithSubquery";
};

// node_modules/.bun/drizzle-orm@1.0.0-rc.5-169397b+5a2a64b31368e2d8/node_modules/drizzle-orm/tracing-utils.js
function iife(fn4, ...args) {
  return fn4(...args);
}

// node_modules/.bun/drizzle-orm@1.0.0-rc.5-169397b+5a2a64b31368e2d8/node_modules/drizzle-orm/tracing.js
var hasTelemetry = false;
var tracer = { startActiveSpan(name3, fn4) {
  return fn4();
} };

// node_modules/.bun/drizzle-orm@1.0.0-rc.5-169397b+5a2a64b31368e2d8/node_modules/drizzle-orm/view-common.js
var ViewBaseConfig = Symbol.for("drizzle:ViewBaseConfig");

// node_modules/.bun/drizzle-orm@1.0.0-rc.5-169397b+5a2a64b31368e2d8/node_modules/drizzle-orm/sql/sql.js
var FakePrimitiveParam = class {
  static [entityKind] = "FakePrimitiveParam";
};
function isSQLWrapper(value3) {
  return value3 !== null && value3 !== void 0 && typeof value3.getSQL === "function";
}
var StringChunk = class {
  static [entityKind] = "StringChunk";
  constructor(value3) {
    this.value = value3;
  }
  getSQL() {
    return new SQL([this]);
  }
};
var SQL = class SQL2 {
  static [entityKind] = "SQL";
  /** @internal */
  decoder = noopDecoder;
  /** @internal */
  shouldInlineParams = false;
  /** @internal */
  _usedTables;
  /** @internal */
  get usedTables() {
    if (this._usedTables) return this._usedTables;
    this._usedTables = [];
    for (let i = 0; i < this.queryChunks.length; ++i) {
      const chunk = this.queryChunks[i];
      if (is(chunk, Table)) {
        const schemaName = chunk[Table.Symbol.Schema];
        this._usedTables.push(schemaName === void 0 ? chunk[Table.Symbol.Name] : schemaName + "." + chunk[Table.Symbol.Name]);
      }
    }
    return this._usedTables;
  }
  constructor(queryChunks) {
    this.queryChunks = queryChunks;
  }
  append(query) {
    this.queryChunks.push(...query.queryChunks);
    return this;
  }
  toQuery(config) {
    if (!hasTelemetry) return this.buildQueryFromSourceParams(this.queryChunks, config);
    return tracer.startActiveSpan("drizzle.buildSQL", (span) => {
      const query = this.buildQueryFromSourceParams(this.queryChunks, config);
      span?.setAttributes({
        "drizzle.query.text": query.sql,
        "drizzle.query.params": JSON.stringify(query.params)
      });
      return query;
    });
  }
  buildQueryFromSourceParams(chunks, _config) {
    const strings = [];
    const params = [];
    const bounds = _config.tagged ? [] : void 0;
    this.collectSQL(chunks, _config, _config.paramStartIndex || { value: 0 }, _config.inlineParams || this.shouldInlineParams, strings, params, bounds);
    if (bounds === void 0) return {
      sql: strings.join(""),
      params
    };
    const segments = new Array(bounds.length);
    for (let i = 0; i < bounds.length; ++i) {
      const end2 = i + 1 < bounds.length ? bounds[i + 1] : strings.length;
      let segment = "";
      for (let j = bounds[i]; j < end2; ++j) segment += strings[j];
      segments[i] = segment;
    }
    return {
      sql: strings.join(""),
      params,
      _sql: Object.assign(segments, { raw: segments })
    };
  }
  collectSQL(chunks, config, paramStartIndex, inlineParams, strings, params, bounds) {
    const { escapeName, escapeParam, codecs: codecs2, invokeSource } = config;
    for (let i = 0; i < chunks.length; ++i) {
      if (bounds !== void 0) bounds.push(strings.length);
      const chunk = chunks[i];
      if (is(chunk, StringChunk)) {
        strings.push(chunk.value);
        continue;
      }
      if (is(chunk, SQL2)) {
        this.collectSQL(chunk.queryChunks, config, paramStartIndex, inlineParams || chunk.shouldInlineParams, strings, params, void 0);
        continue;
      }
      if (is(chunk, Name)) {
        strings.push(escapeName(chunk.value));
        continue;
      }
      if (chunk === void 0) continue;
      if (is(chunk, Column)) {
        const columnName = chunk.name;
        if (invokeSource === "indexes") {
          strings.push(escapeName(columnName));
          continue;
        }
        const schemaName = invokeSource === "mssql-check" ? void 0 : chunk.table[Table.Symbol.Schema];
        strings.push(chunk.isAlias ? escapeName(chunk.name) : chunk.table[IsAlias] || schemaName === void 0 ? escapeName(chunk.table[Table.Symbol.Name]) + "." + escapeName(columnName) : escapeName(schemaName) + "." + escapeName(chunk.table[Table.Symbol.Name]) + "." + escapeName(columnName));
        continue;
      }
      if (is(chunk, Param)) {
        if (is(chunk.value, SQL2)) {
          const nested = chunk.value;
          this.collectSQL(nested.queryChunks, config, paramStartIndex, inlineParams || nested.shouldInlineParams, strings, params, void 0);
          continue;
        }
        const useCodecs = codecs2 && is(chunk.encoder, Column);
        if (is(chunk.value, Placeholder)) {
          const escaped2 = escapeParam(paramStartIndex.value++, chunk);
          chunk.codec = useCodecs ? (value3) => codecs2.apply(chunk.encoder, "normalizeParam", value3) : void 0;
          strings.push(useCodecs ? codecs2.apply(chunk.encoder, "castParam", escaped2) : escaped2);
          params.push(chunk);
          continue;
        }
        let mappedValue;
        if (chunk.value === null) mappedValue = chunk.value;
        else {
          mappedValue = chunk.encoder.mapToDriverValue.isNoop ? chunk.value : chunk.encoder.mapToDriverValue(chunk.value);
          if (is(mappedValue, SQL2)) {
            const nested = mappedValue;
            this.collectSQL(nested.queryChunks, config, paramStartIndex, inlineParams || nested.shouldInlineParams, strings, params, void 0);
            continue;
          }
          if (useCodecs) mappedValue = codecs2.apply(chunk.encoder, "normalizeParam", mappedValue);
        }
        if (inlineParams) {
          strings.push(this.mapInlineParam(mappedValue, config));
          continue;
        }
        const escaped = escapeParam(paramStartIndex.value++, mappedValue);
        strings.push(useCodecs ? codecs2.apply(chunk.encoder, "castParam", escaped) : escaped);
        params.push(mappedValue);
        continue;
      }
      if (is(chunk, Placeholder)) {
        strings.push(escapeParam(paramStartIndex.value++, chunk));
        params.push(chunk);
        continue;
      }
      if (is(chunk, Table)) {
        const schemaName = chunk[Table.Symbol.Schema];
        const tableName = chunk[Table.Symbol.Name];
        if (invokeSource === "mssql-view-with-schemabinding") {
          strings.push((schemaName === void 0 ? escapeName("dbo") : escapeName(schemaName)) + "." + escapeName(tableName));
          continue;
        }
        strings.push(schemaName === void 0 || chunk[IsAlias] ? escapeName(tableName) : escapeName(schemaName) + "." + escapeName(tableName));
        continue;
      }
      if (is(chunk, View)) {
        const schemaName = chunk[ViewBaseConfig].schema;
        const viewName = chunk[ViewBaseConfig].name;
        strings.push(schemaName === void 0 || chunk[ViewBaseConfig].isAlias ? escapeName(viewName) : escapeName(schemaName) + "." + escapeName(viewName));
        continue;
      }
      if (is(chunk, SQL2.Aliased) && chunk.fieldAlias !== void 0) {
        strings.push((chunk.origin !== void 0 ? escapeName(chunk.origin) + "." : "") + escapeName(chunk.fieldAlias));
        continue;
      }
      if (is(chunk, Subquery)) {
        if (chunk._.isWith) {
          strings.push(escapeName(chunk._.alias));
          continue;
        }
        const nested = chunk._.sql;
        strings.push("(");
        this.collectSQL(nested.queryChunks, config, paramStartIndex, inlineParams || nested.shouldInlineParams, strings, params, void 0);
        strings.push(") " + escapeName(chunk._.alias));
        continue;
      }
      if (typeof chunk === "function" && "enumName" in chunk) {
        if ("schema" in chunk && chunk.schema) {
          strings.push(escapeName(chunk.schema) + "." + escapeName(chunk.enumName));
          continue;
        }
        strings.push(escapeName(chunk.enumName));
        continue;
      }
      if (isSQLWrapper(chunk)) {
        const nested = chunk.getSQL();
        const nestedInlineParams = inlineParams || nested.shouldInlineParams;
        if (chunk.shouldOmitSQLParens?.()) {
          this.collectSQL(nested.queryChunks, config, paramStartIndex, nestedInlineParams, strings, params, void 0);
          continue;
        }
        strings.push("(");
        this.collectSQL(nested.queryChunks, config, paramStartIndex, nestedInlineParams, strings, params, void 0);
        strings.push(")");
        continue;
      }
      if (Array.isArray(chunk)) {
        strings.push("(");
        const element = [void 0];
        for (let j = 0; j < chunk.length; ++j) {
          if (j > 0) strings.push(", ");
          element[0] = chunk[j];
          this.collectSQL(element, config, paramStartIndex, inlineParams, strings, params, void 0);
        }
        strings.push(")");
        continue;
      }
      if (inlineParams) {
        strings.push(this.mapInlineParam(chunk, config));
        continue;
      }
      strings.push(escapeParam(paramStartIndex.value++, chunk));
      params.push(chunk);
    }
  }
  mapInlineParam(chunk, { escapeString }) {
    if (chunk === null) return "null";
    if (typeof chunk === "number" || typeof chunk === "boolean" || typeof chunk === "bigint") return chunk.toString();
    if (typeof chunk === "string") return escapeString(chunk);
    if (typeof chunk === "object") {
      const mappedValueAsString = chunk.toString();
      if (mappedValueAsString === "[object Object]") return escapeString(JSON.stringify(chunk));
      return escapeString(mappedValueAsString);
    }
    throw new Error("Unexpected param value: " + chunk);
  }
  getSQL() {
    return this;
  }
  as(alias) {
    if (alias === void 0) return this;
    return new SQL2.Aliased(this, alias);
  }
  mapWith(decoder) {
    this.decoder = typeof decoder === "function" ? { mapFromDriverValue: decoder } : decoder;
    return this;
  }
  nullable() {
    return this;
  }
  inlineParams() {
    this.shouldInlineParams = true;
    return this;
  }
  /**
  * This method is used to conditionally include a part of the query.
  *
  * @param condition - Condition to check
  * @returns itself if the condition is `true`, otherwise `undefined`
  */
  if(condition) {
    return condition ? this : void 0;
  }
};
var Name = class {
  static [entityKind] = "Name";
  brand;
  constructor(value3) {
    this.value = value3;
  }
  getSQL() {
    return new SQL([this]);
  }
};
function isDriverValueEncoder(value3) {
  return typeof value3 === "object" && value3 !== null && "mapToDriverValue" in value3 && typeof value3.mapToDriverValue === "function";
}
var noopDecoder = { mapFromDriverValue: (value3) => value3 };
noopDecoder.mapFromDriverValue.isNoop = true;
var noopEncoder = { mapToDriverValue: (value3) => value3 };
noopEncoder.mapToDriverValue.isNoop = true;
var noopMapper = {
  ...noopDecoder,
  ...noopEncoder
};
var Param = class {
  static [entityKind] = "Param";
  brand;
  /**
  * @param value - Parameter value
  * @param encoder - Encoder to convert the value to a driver parameter
  */
  constructor(value3, encoder2 = noopEncoder, codec) {
    this.value = value3;
    this.encoder = encoder2;
    this.codec = codec;
  }
  getSQL() {
    return new SQL([this]);
  }
};
function sql(strings, ...params) {
  const startWithString = params.length > 0 || strings.length > 0 && strings[0] !== "";
  const chunkCount = startWithString ? strings.length + params.length : strings.length - 1;
  const queryChunks = new Array(chunkCount < 0 ? 0 : chunkCount);
  let writeIdx = 0;
  if (startWithString) queryChunks[writeIdx++] = new StringChunk(strings[0]);
  for (let paramIdx = 0; paramIdx < params.length; ++paramIdx) {
    const param2 = params[paramIdx];
    queryChunks[writeIdx++] = param2;
    queryChunks[writeIdx++] = new StringChunk(strings[paramIdx + 1]);
  }
  return new SQL(queryChunks);
}
(function(_sql) {
  function empty2() {
    return new SQL([]);
  }
  _sql.empty = empty2;
  function fromList(list) {
    return new SQL(list);
  }
  _sql.fromList = fromList;
  function raw(str) {
    return new SQL([new StringChunk(str)]);
  }
  _sql.raw = raw;
  function join(chunks, separator) {
    const { length } = chunks;
    if (separator === void 0 || length === 0) return new SQL(chunks.slice());
    const result3 = new Array(length * 2 - 1);
    for (let i = 0, writeIdx = 0; i < length; ++i) {
      result3[writeIdx++] = chunks[i];
      if (i < length - 1) result3[writeIdx++] = separator;
    }
    return new SQL(result3);
  }
  _sql.join = join;
  function identifier(value3) {
    return new Name(value3);
  }
  _sql.identifier = identifier;
  function placeholder2(name3) {
    return new Placeholder(name3);
  }
  _sql.placeholder = placeholder2;
  function param2(value3, encoder2) {
    return new Param(value3, encoder2);
  }
  _sql.param = param2;
  function comment(input) {
    const encoded = sqlCommenter(input);
    if (!encoded.length) return void 0;
    return sql.raw(encoded);
  }
  _sql.comment = comment;
})(sql || (sql = {}));
function sqlCommenter(input) {
  const encoded = sqlCommenter.encodeInput(input);
  if (!encoded.length) return "";
  return `/*${encoded}*/`;
}
(function(_sqlCommenter) {
  function merge(input1, input2) {
    let encoded;
    if (typeof input1 === "object" && typeof input2 === "object") encoded = encodeInput({
      ...input1,
      ...input2
    });
    else if (input1 && input2) encoded = [encodeInput(input1), encodeInput(input2)].filter((i) => i.length).join(",");
    else if (input2) encoded = encodeInput(input2);
    else if (input1) encoded = encodeInput(input1);
    else return "";
    if (!encoded.length) return "";
    return `/*${encoded}*/`;
  }
  _sqlCommenter.merge = merge;
  function encodeInput(input) {
    if (typeof input === "string") {
      if (!input.length) return input;
      return sanitizeStringInput(input);
    }
    const parts = [];
    for (const [key, value3] of Object.entries(input)) {
      if (value3 === null || value3 === void 0 || value3 === "") continue;
      const encodedKey = sanitizeObjectElement(key);
      const encodedValue = sanitizeObjectElement(String(value3));
      parts.push(`${encodedKey}='${encodedValue}'`);
    }
    if (!parts.length) return "";
    return parts.sort().join(",");
  }
  _sqlCommenter.encodeInput = encodeInput;
  function sanitizeObjectElement(key) {
    return encodeURIComponent(key).replace(/'/g, `\\'`);
  }
  _sqlCommenter.sanitizeObjectElement = sanitizeObjectElement;
  function sanitizeStringInput(input) {
    return input.replace(/\/\*/g, "/ *").replace(/\*\//g, "* /");
  }
  _sqlCommenter.sanitizeStringInput = sanitizeStringInput;
})(sqlCommenter || (sqlCommenter = {}));
(function(_SQL) {
  class Aliased {
    static [entityKind] = "SQL.Aliased";
    /** @internal */
    isSelectionField = false;
    /** @internal */
    origin;
    constructor(sql2, fieldAlias) {
      this.sql = sql2;
      this.fieldAlias = fieldAlias;
    }
    getSQL() {
      return this.sql;
    }
    /** @internal */
    clone() {
      return new Aliased(this.sql, this.fieldAlias);
    }
  }
  _SQL.Aliased = Aliased;
})(SQL || (SQL = {}));
var Placeholder = class {
  static [entityKind] = "Placeholder";
  constructor(name3) {
    this.name = name3;
  }
  getSQL() {
    return new SQL([this]);
  }
};
function fillPlaceholders(params, values) {
  return params.map((p) => {
    if (is(p, Placeholder)) {
      if (!(p.name in values)) throw new Error(`No value for placeholder "${p.name}" was provided`);
      return values[p.name];
    }
    if (is(p, Param) && is(p.value, Placeholder)) {
      if (!(p.value.name in values)) throw new Error(`No value for placeholder "${p.value.name}" was provided`);
      const value3 = values[p.value.name];
      if (value3 === null) return value3;
      const mapped = p.encoder.mapToDriverValue.isNoop ? value3 : p.encoder.mapToDriverValue(value3);
      return p.codec ? p.codec(mapped) : mapped;
    }
    return p;
  });
}
var IsDrizzleView = Symbol.for("drizzle:IsDrizzleView");
var View = class {
  static [entityKind] = "View";
  /** @internal */
  [ViewBaseConfig];
  /** @internal */
  [IsDrizzleView] = true;
  /** @internal */
  get [TableName]() {
    return this[ViewBaseConfig].name;
  }
  /** @internal */
  get [TableSchema]() {
    return this[ViewBaseConfig].schema;
  }
  /** @internal */
  get [IsAlias]() {
    return this[ViewBaseConfig].isAlias;
  }
  /** @internal */
  get [OriginalName]() {
    return this[ViewBaseConfig].originalName;
  }
  /** @internal */
  get [TableColumns]() {
    return this[ViewBaseConfig].selectedFields;
  }
  constructor({ name: name3, schema, selectedFields, query }) {
    this[ViewBaseConfig] = {
      name: name3,
      originalName: name3,
      schema,
      selectedFields,
      query,
      isExisting: !query,
      isAlias: false
    };
  }
};
Column.prototype.getSQL = function() {
  return new SQL([this]);
};
Subquery.prototype.getSQL = function() {
  return new SQL([this]);
};

// node_modules/.bun/drizzle-orm@1.0.0-rc.5-169397b+5a2a64b31368e2d8/node_modules/drizzle-orm/pg-core/codecs.js
var PG_ALIAS_TO_TYPE_MAP = {
  int2: "smallint",
  integer: "int",
  int4: "int",
  int8: "bigint",
  decimal: "numeric",
  real: "float4",
  double: "float8",
  "double precision": "float8",
  serial2: "smallserial",
  serial4: "serial",
  serial8: "bigserial",
  character: "char",
  "character varying": "varchar",
  "time with time zone": "timetz",
  "time without time zone": "time",
  "timestamp with time zone": "timestamptz",
  "timestamp without time zone": "timestamp",
  boolean: "bool",
  "bit varying": "varbit"
};
function resolvePgTypeAlias(type) {
  return PG_ALIAS_TO_TYPE_MAP[type] ?? type;
}
var unionsTypeTable = {
  smallint: {
    smallint: "smallint",
    int: "int",
    bigint: "bigint:number",
    "bigint:number": "bigint:number",
    "bigint:string": "bigint:number",
    numeric: "numeric:number",
    "numeric:number": "numeric:number",
    "numeric:bigint": "numeric:number",
    float4: "float4",
    float8: "float8",
    smallserial: "smallint",
    serial: "int",
    bigserial: "bigint:number",
    "bigserial:number": "bigint:number",
    oid: "oid",
    regproc: "regproc",
    regprocedure: "regprocedure",
    regoper: "regoper",
    regoperator: "regoperator",
    regclass: "regclass",
    regtype: "regtype",
    regrole: "regrole",
    regnamespace: "regnamespace",
    regconfig: "regconfig",
    regdictionary: "regdictionary"
  },
  int: {
    smallint: "int",
    int: "int",
    bigint: "bigint:number",
    "bigint:number": "bigint:number",
    "bigint:string": "bigint:number",
    numeric: "numeric:number",
    "numeric:number": "numeric:number",
    "numeric:bigint": "numeric:number",
    float4: "float4",
    float8: "float8",
    smallserial: "int",
    serial: "int",
    bigserial: "bigint:number",
    "bigserial:number": "bigint:number",
    oid: "oid",
    regproc: "regproc",
    regprocedure: "regprocedure",
    regoper: "regoper",
    regoperator: "regoperator",
    regclass: "regclass",
    regtype: "regtype",
    regrole: "regrole",
    regnamespace: "regnamespace",
    regconfig: "regconfig",
    regdictionary: "regdictionary"
  },
  bigint: {
    smallint: "bigint",
    int: "bigint",
    bigint: "bigint",
    "bigint:number": "bigint",
    "bigint:string": "bigint",
    numeric: "numeric:bigint",
    "numeric:number": "numeric:bigint",
    "numeric:bigint": "numeric:bigint",
    float4: "float4",
    float8: "float8",
    smallserial: "bigint",
    serial: "bigint",
    bigserial: "bigint",
    "bigserial:number": "bigint",
    oid: "oid",
    regproc: "regproc",
    regprocedure: "regprocedure",
    regoper: "regoper",
    regoperator: "regoperator",
    regclass: "regclass",
    regtype: "regtype",
    regrole: "regrole",
    regnamespace: "regnamespace",
    regconfig: "regconfig",
    regdictionary: "regdictionary"
  },
  "bigint:number": {
    smallint: "bigint:number",
    int: "bigint:number",
    bigint: "bigint:number",
    "bigint:number": "bigint:number",
    "bigint:string": "bigint:number",
    numeric: "numeric:number",
    "numeric:number": "numeric:number",
    "numeric:bigint": "numeric:number",
    float4: "float4",
    float8: "float8",
    smallserial: "bigint:number",
    serial: "bigint:number",
    bigserial: "bigint:number",
    "bigserial:number": "bigint:number",
    oid: "oid",
    regproc: "regproc",
    regprocedure: "regprocedure",
    regoper: "regoper",
    regoperator: "regoperator",
    regclass: "regclass",
    regtype: "regtype",
    regrole: "regrole",
    regnamespace: "regnamespace",
    regconfig: "regconfig",
    regdictionary: "regdictionary"
  },
  "bigint:string": {
    smallint: "bigint:string",
    int: "bigint:string",
    bigint: "bigint:string",
    "bigint:number": "bigint:string",
    "bigint:string": "bigint:string",
    numeric: "numeric",
    "numeric:number": "numeric",
    "numeric:bigint": "numeric",
    float4: "float4",
    float8: "float8",
    smallserial: "bigint:string",
    serial: "bigint:string",
    bigserial: "bigint:string",
    "bigserial:number": "bigint:string",
    oid: "oid",
    regproc: "regproc",
    regprocedure: "regprocedure",
    regoper: "regoper",
    regoperator: "regoperator",
    regclass: "regclass",
    regtype: "regtype",
    regrole: "regrole",
    regnamespace: "regnamespace",
    regconfig: "regconfig",
    regdictionary: "regdictionary"
  },
  numeric: {
    smallint: "numeric",
    int: "numeric",
    bigint: "numeric",
    "bigint:number": "numeric",
    "bigint:string": "numeric",
    numeric: "numeric",
    "numeric:number": "numeric",
    "numeric:bigint": "numeric",
    float4: "float4",
    float8: "float8",
    smallserial: "numeric",
    serial: "numeric",
    bigserial: "numeric",
    "bigserial:number": "numeric"
  },
  "numeric:number": {
    smallint: "numeric:number",
    int: "numeric:number",
    bigint: "numeric:number",
    "bigint:number": "numeric:number",
    "bigint:string": "numeric:number",
    numeric: "numeric:number",
    "numeric:number": "numeric:number",
    "numeric:bigint": "numeric:number",
    float4: "float4",
    float8: "float8",
    smallserial: "numeric:number",
    serial: "numeric:number",
    bigserial: "numeric:number",
    "bigserial:number": "numeric:number"
  },
  "numeric:bigint": {
    smallint: "numeric:bigint",
    int: "numeric:bigint",
    bigint: "numeric:bigint",
    "bigint:number": "numeric:bigint",
    "bigint:string": "numeric:bigint",
    numeric: "numeric:bigint",
    "numeric:number": "numeric:bigint",
    "numeric:bigint": "numeric:bigint",
    float4: "float4",
    float8: "float8",
    smallserial: "numeric:bigint",
    serial: "numeric:bigint",
    bigserial: "numeric:bigint",
    "bigserial:number": "numeric:bigint"
  },
  float4: {
    smallint: "float4",
    int: "float4",
    bigint: "float4",
    "bigint:number": "float4",
    "bigint:string": "float4",
    numeric: "float4",
    "numeric:number": "float4",
    "numeric:bigint": "float4",
    float4: "float4",
    float8: "float8",
    smallserial: "float4",
    serial: "float4",
    bigserial: "float4",
    "bigserial:number": "float4"
  },
  float8: {
    smallint: "float8",
    int: "float8",
    bigint: "float8",
    "bigint:number": "float8",
    "bigint:string": "float8",
    numeric: "float8",
    "numeric:number": "float8",
    "numeric:bigint": "float8",
    float4: "float8",
    float8: "float8",
    smallserial: "float8",
    serial: "float8",
    bigserial: "float8",
    "bigserial:number": "float8"
  },
  money: { money: "money" },
  smallserial: {
    smallint: "smallint",
    int: "int",
    bigint: "bigint:number",
    "bigint:number": "bigint:number",
    "bigint:string": "bigint:number",
    numeric: "numeric:number",
    "numeric:number": "numeric:number",
    "numeric:bigint": "numeric:number",
    float4: "float4",
    float8: "float8",
    smallserial: "smallint",
    serial: "int",
    bigserial: "bigint:number",
    "bigserial:number": "bigint:number",
    oid: "oid",
    regproc: "regproc",
    regprocedure: "regprocedure",
    regoper: "regoper",
    regoperator: "regoperator",
    regclass: "regclass",
    regtype: "regtype",
    regrole: "regrole",
    regnamespace: "regnamespace",
    regconfig: "regconfig",
    regdictionary: "regdictionary"
  },
  serial: {
    smallint: "int",
    int: "int",
    bigint: "bigint:number",
    "bigint:number": "bigint:number",
    "bigint:string": "bigint:number",
    numeric: "numeric:number",
    "numeric:number": "numeric:number",
    "numeric:bigint": "numeric:number",
    float4: "float4",
    float8: "float8",
    smallserial: "int",
    serial: "int",
    bigserial: "bigint:number",
    "bigserial:number": "bigint:number",
    oid: "oid",
    regproc: "regproc",
    regprocedure: "regprocedure",
    regoper: "regoper",
    regoperator: "regoperator",
    regclass: "regclass",
    regtype: "regtype",
    regrole: "regrole",
    regnamespace: "regnamespace",
    regconfig: "regconfig",
    regdictionary: "regdictionary"
  },
  bigserial: {
    smallint: "bigint",
    int: "bigint",
    bigint: "bigint",
    "bigint:number": "bigint",
    "bigint:string": "bigint",
    numeric: "numeric:bigint",
    "numeric:number": "numeric:bigint",
    "numeric:bigint": "numeric:bigint",
    float4: "float4",
    float8: "float8",
    smallserial: "bigint",
    serial: "bigint",
    bigserial: "bigint",
    "bigserial:number": "bigint",
    oid: "oid",
    regproc: "regproc",
    regprocedure: "regprocedure",
    regoper: "regoper",
    regoperator: "regoperator",
    regclass: "regclass",
    regtype: "regtype",
    regrole: "regrole",
    regnamespace: "regnamespace",
    regconfig: "regconfig",
    regdictionary: "regdictionary"
  },
  "bigserial:number": {
    smallint: "bigint:number",
    int: "bigint:number",
    bigint: "bigint:number",
    "bigint:number": "bigint:number",
    "bigint:string": "bigint:number",
    numeric: "numeric:number",
    "numeric:number": "numeric:number",
    "numeric:bigint": "numeric:number",
    float4: "float4",
    float8: "float8",
    smallserial: "bigint:number",
    serial: "bigint:number",
    bigserial: "bigint:number",
    "bigserial:number": "bigint:number",
    oid: "oid",
    regproc: "regproc",
    regprocedure: "regprocedure",
    regoper: "regoper",
    regoperator: "regoperator",
    regclass: "regclass",
    regtype: "regtype",
    regrole: "regrole",
    regnamespace: "regnamespace",
    regconfig: "regconfig",
    regdictionary: "regdictionary"
  },
  char: {
    char: "char",
    varchar: "char",
    text: "char"
  },
  varchar: {
    char: "varchar",
    varchar: "varchar",
    text: "varchar"
  },
  text: {
    char: "text",
    varchar: "text",
    text: "text"
  },
  bytea: { bytea: "bytea" },
  date: {
    date: "date",
    "date:string": "date",
    timestamp: "timestamp",
    "timestamp:string": "timestamp",
    timestamptz: "timestamptz",
    "timestamptz:string": "timestamptz"
  },
  "date:string": {
    date: "date:string",
    "date:string": "date:string",
    timestamp: "timestamp:string",
    "timestamp:string": "timestamp:string",
    timestamptz: "timestamptz:string",
    "timestamptz:string": "timestamptz:string"
  },
  time: {
    time: "time",
    timetz: "timetz"
  },
  timetz: {
    time: "timetz",
    timetz: "timetz"
  },
  timestamp: {
    date: "timestamp",
    "date:string": "timestamp",
    timestamp: "timestamp",
    "timestamp:string": "timestamp",
    timestamptz: "timestamptz",
    "timestamptz:string": "timestamptz"
  },
  "timestamp:string": {
    date: "timestamp:string",
    "date:string": "timestamp:string",
    timestamp: "timestamp:string",
    "timestamp:string": "timestamp:string",
    timestamptz: "timestamptz:string",
    "timestamptz:string": "timestamptz:string"
  },
  timestamptz: {
    date: "timestamptz",
    "date:string": "timestamptz",
    timestamp: "timestamptz",
    "timestamp:string": "timestamptz",
    timestamptz: "timestamptz",
    "timestamptz:string": "timestamptz"
  },
  "timestamptz:string": {
    date: "timestamptz:string",
    "date:string": "timestamptz:string",
    timestamp: "timestamptz:string",
    "timestamp:string": "timestamptz:string",
    timestamptz: "timestamptz:string",
    "timestamptz:string": "timestamptz:string"
  },
  interval: {
    interval: "interval",
    "interval:tuple": "interval"
  },
  "interval:tuple": {
    interval: "interval:tuple",
    "interval:tuple": "interval:tuple"
  },
  bool: { bool: "bool" },
  enum: { enum: "enum" },
  point: {
    point: "point",
    "point:tuple": "point"
  },
  "point:tuple": {
    point: "point:tuple",
    "point:tuple": "point:tuple"
  },
  line: {
    line: "line",
    "line:tuple": "line"
  },
  "line:tuple": {
    line: "line:tuple",
    "line:tuple": "line:tuple"
  },
  lseg: { lseg: "lseg" },
  box: { box: "box" },
  path: { path: "path" },
  polygon: { polygon: "polygon" },
  circle: { circle: "circle" },
  cidr: {
    cidr: "cidr",
    inet: "inet"
  },
  inet: {
    cidr: "inet",
    inet: "inet"
  },
  macaddr: {
    macaddr: "macaddr",
    macaddr8: "macaddr"
  },
  macaddr8: {
    macaddr: "macaddr8",
    macaddr8: "macaddr8"
  },
  bit: {
    bit: "bit",
    varbit: "bit"
  },
  varbit: {
    bit: "varbit",
    varbit: "varbit"
  },
  tsvector: { tsvector: "tsvector" },
  tsquery: { tsquery: "tsquery" },
  uuid: { uuid: "uuid" },
  xml: { xml: "xml" },
  json: { json: "json" },
  jsonb: { jsonb: "jsonb" },
  int4range: { int4range: "int4range" },
  int8range: { int8range: "int8range" },
  numrange: { numrange: "numrange" },
  tsrange: { tsrange: "tsrange" },
  tstzrange: { tstzrange: "tstzrange" },
  daterange: { daterange: "daterange" },
  int4multirange: { int4multirange: "int4multirange" },
  int8multirange: { int8multirange: "int8multirange" },
  nummultirange: { nummultirange: "nummultirange" },
  tsmultirange: { tsmultirange: "tsmultirange" },
  tstzmultirange: { tstzmultirange: "tstzmultirange" },
  datemultirange: { datemultirange: "datemultirange" },
  oid: {
    smallint: "oid",
    int: "oid",
    bigint: "oid",
    "bigint:number": "oid",
    "bigint:string": "oid",
    smallserial: "oid",
    serial: "oid",
    bigserial: "oid",
    "bigserial:number": "oid",
    oid: "oid",
    regproc: "oid",
    regprocedure: "oid",
    regoper: "oid",
    regoperator: "oid",
    regclass: "oid",
    regtype: "oid",
    regrole: "oid",
    regnamespace: "oid",
    regconfig: "oid",
    regdictionary: "oid"
  },
  regproc: {
    smallint: "regproc",
    int: "regproc",
    bigint: "regproc",
    "bigint:number": "regproc",
    "bigint:string": "regproc",
    smallserial: "regproc",
    serial: "regproc",
    bigserial: "regproc",
    "bigserial:number": "regproc",
    oid: "regproc",
    regproc: "regproc",
    regprocedure: "regproc"
  },
  regprocedure: {
    smallint: "regprocedure",
    int: "regprocedure",
    bigint: "regprocedure",
    "bigint:number": "regprocedure",
    "bigint:string": "regprocedure",
    smallserial: "regprocedure",
    serial: "regprocedure",
    bigserial: "regprocedure",
    "bigserial:number": "regprocedure",
    oid: "regprocedure",
    regproc: "regprocedure",
    regprocedure: "regprocedure"
  },
  regoper: {
    smallint: "regoper",
    int: "regoper",
    bigint: "regoper",
    "bigint:number": "regoper",
    "bigint:string": "regoper",
    smallserial: "regoper",
    serial: "regoper",
    bigserial: "regoper",
    "bigserial:number": "regoper",
    oid: "regoper",
    regoper: "regoper",
    regoperator: "regoper"
  },
  regoperator: {
    smallint: "regoperator",
    int: "regoperator",
    bigint: "regoperator",
    "bigint:number": "regoperator",
    "bigint:string": "regoperator",
    smallserial: "regoperator",
    serial: "regoperator",
    bigserial: "regoperator",
    "bigserial:number": "regoperator",
    oid: "regoperator",
    regoper: "regoperator",
    regoperator: "regoperator"
  },
  regclass: {
    smallint: "regclass",
    int: "regclass",
    bigint: "regclass",
    "bigint:number": "regclass",
    "bigint:string": "regclass",
    smallserial: "regclass",
    serial: "regclass",
    bigserial: "regclass",
    "bigserial:number": "regclass",
    oid: "regclass",
    regclass: "regclass"
  },
  regtype: {
    smallint: "regtype",
    int: "regtype",
    bigint: "regtype",
    "bigint:number": "regtype",
    "bigint:string": "regtype",
    smallserial: "regtype",
    serial: "regtype",
    bigserial: "regtype",
    "bigserial:number": "regtype",
    oid: "regtype",
    regtype: "regtype"
  },
  regrole: {
    smallint: "regrole",
    int: "regrole",
    bigint: "regrole",
    "bigint:number": "regrole",
    "bigint:string": "regrole",
    smallserial: "regrole",
    serial: "regrole",
    bigserial: "regrole",
    "bigserial:number": "regrole",
    oid: "regrole",
    regrole: "regrole"
  },
  regnamespace: {
    smallint: "regnamespace",
    int: "regnamespace",
    bigint: "regnamespace",
    "bigint:number": "regnamespace",
    "bigint:string": "regnamespace",
    smallserial: "regnamespace",
    serial: "regnamespace",
    bigserial: "regnamespace",
    "bigserial:number": "regnamespace",
    oid: "regnamespace",
    regnamespace: "regnamespace"
  },
  regconfig: {
    smallint: "regconfig",
    int: "regconfig",
    bigint: "regconfig",
    "bigint:number": "regconfig",
    "bigint:string": "regconfig",
    smallserial: "regconfig",
    serial: "regconfig",
    bigserial: "regconfig",
    "bigserial:number": "regconfig",
    oid: "regconfig",
    regconfig: "regconfig"
  },
  regdictionary: {
    smallint: "regdictionary",
    int: "regdictionary",
    bigint: "regdictionary",
    "bigint:number": "regdictionary",
    "bigint:string": "regdictionary",
    smallserial: "regdictionary",
    serial: "regdictionary",
    bigserial: "regdictionary",
    "bigserial:number": "regdictionary",
    oid: "regdictionary",
    regdictionary: "regdictionary"
  }
};
var castToText = (name3) => sql`${name3}::text`;
var castToTextArr = (name3, arrayDimensions) => sql`${name3}::text${sql.raw("[]".repeat(arrayDimensions))}`;
var arrayCompatCast = (cast) => (name3, arrayDimensions) => {
  if (!arrayDimensions) return cast(name3);
  const aliases = [];
  for (let i = 0; i < arrayDimensions; i++) aliases.push(sql.identifier(`s${i}`));
  let indexed = name3;
  for (const alias of aliases) indexed = sql`${indexed}[${alias}]`;
  let expression = sql`array(\
select ${cast(indexed)} \
from generate_subscripts(${name3}, ${sql.raw(arrayDimensions.toString())}) ${aliases[arrayDimensions - 1]} \
order by ${aliases[arrayDimensions - 1]})`;
  for (let dim = arrayDimensions - 1; dim > 0; dim--) expression = sql`array(\
select ${expression} \
from generate_subscripts(${name3}, ${sql.raw(dim.toString())}) ${aliases[dim - 1]} \
order by ${aliases[dim - 1]})`;
  return sql`case when ${name3} is null then null else ${expression} end`;
};
var arrayCompatNormalize = (normalize) => {
  const loop = (value3, arrayDimensions) => {
    const innerDimensions = arrayDimensions - 1;
    if (arrayDimensions > 1) for (let i = 0; i < value3.length; ++i) loop(value3[i], innerDimensions);
    else for (let i = 0; i < value3.length; ++i) value3[i] = normalize(value3[i]);
    return value3;
  };
  return loop;
};
var arrayCompatNormalizeInput = (normalize, transformToPgArray = false) => {
  const loop = (value3, arrayDimensions) => {
    const innerDimensions = arrayDimensions - 1;
    const out = new Array(value3.length);
    if (arrayDimensions > 1) for (let i = 0; i < value3.length; ++i) out[i] = loop(value3[i], innerDimensions);
    else for (let i = 0; i < value3.length; ++i) out[i] = normalize(value3[i]);
    return out;
  };
  return transformToPgArray ? (v, d) => makePgArray(loop(v, d)) : loop;
};
var parsePgArrayAndNormalize = (normalize, delim) => {
  const codec = arrayCompatNormalize(normalize);
  return (value3, arrayDimensions) => codec(parsePgArray(value3, delim), arrayDimensions);
};
var parseGeometryArrayAndNormalize = (normalize) => parsePgArrayAndNormalize(normalize, ":");
var makeGeometryArray = (value3) => makePgArray(value3, ":");
var makeBoxArray = (value3) => makePgArray(value3, ";");
var parseLineTuple = (v) => {
  const [a, b, c] = v.slice(1, -1).split(",");
  return [
    Number.parseFloat(a),
    Number.parseFloat(b),
    Number.parseFloat(c)
  ];
};
var parseLineABC = (v) => {
  const [a, b, c] = v.slice(1, -1).split(",");
  return {
    a: Number.parseFloat(a),
    b: Number.parseFloat(b),
    c: Number.parseFloat(c)
  };
};
var parsePointTuple = (v) => {
  const [x, y] = v.slice(1, -1).split(",");
  return [Number.parseFloat(x), Number.parseFloat(y)];
};
var parsePointXY = (v) => {
  const [x, y] = v.slice(1, -1).split(",");
  return {
    x: Number.parseFloat(x),
    y: Number.parseFloat(y)
  };
};
var parseGeometryTuple = (v) => parseEWKB(v).point;
var parseGeometryXY = (v) => {
  const parsed = parseEWKB(v);
  return {
    x: parsed.point[0],
    y: parsed.point[1]
  };
};
var textToDate = (v) => new Date(v);
var textToDateWithTz = (v) => /* @__PURE__ */ new Date(v + "+0000");
var parsePgVector = (v) => {
  const body = v.slice(1, -1);
  if (body.length === 0) return [];
  return body.split(",").map(Number.parseFloat);
};
var genericPgCodecs = {
  bytea: {
    castInJson: (name3) => sql`encode(${name3}, 'base64')`,
    castArrayInJson: arrayCompatCast((name3) => sql`encode(${name3}, 'base64')`),
    normalizeInJson: (v) => Buffer.from(v, "base64"),
    normalizeArrayInJson: arrayCompatNormalize((v) => Buffer.from(v, "base64"))
  },
  bigint: {
    castInJson: castToText,
    castArrayInJson: castToTextArr,
    normalizeInJson: BigInt,
    normalizeArrayInJson: arrayCompatNormalize(BigInt)
  },
  "bigint:number": {
    castInJson: castToText,
    castArrayInJson: castToTextArr,
    normalizeInJson: Number,
    normalizeArrayInJson: arrayCompatNormalize(Number)
  },
  "bigint:string": {
    castInJson: castToText,
    castArrayInJson: castToTextArr
  },
  bigserial: {
    castInJson: castToText,
    castArrayInJson: castToTextArr,
    normalizeInJson: BigInt,
    normalizeArrayInJson: arrayCompatNormalize(BigInt)
  },
  "bigserial:number": {
    castInJson: castToText,
    castArrayInJson: castToTextArr,
    normalizeInJson: Number,
    normalizeArrayInJson: arrayCompatNormalize(Number)
  },
  date: {
    normalizeInJson: textToDate,
    normalizeArrayInJson: arrayCompatNormalize(textToDate)
  },
  "date:string": {},
  "geometry(point)": {
    castInJson: castToText,
    castArrayInJson: castToTextArr,
    normalizeInJson: parseGeometryXY,
    normalizeArrayInJson: arrayCompatNormalize(parseGeometryXY)
  },
  "geometry(point):tuple": {
    castInJson: castToText,
    castArrayInJson: castToTextArr,
    normalizeInJson: parseGeometryTuple,
    normalizeArrayInJson: arrayCompatNormalize(parseGeometryTuple)
  },
  interval: { castArrayInJson: castToTextArr },
  line: {
    castInJson: castToText,
    castArrayInJson: castToTextArr,
    normalizeInJson: parseLineABC,
    normalizeArrayInJson: arrayCompatNormalize(parseLineABC)
  },
  "line:tuple": {
    castInJson: castToText,
    castArrayInJson: castToTextArr,
    normalizeInJson: parseLineTuple,
    normalizeArrayInJson: arrayCompatNormalize(parseLineTuple)
  },
  numeric: {
    castInJson: castToText,
    castArrayInJson: castToTextArr
  },
  "numeric:number": {
    castInJson: castToText,
    castArrayInJson: castToTextArr,
    normalizeInJson: Number,
    normalizeArrayInJson: arrayCompatNormalize(Number)
  },
  "numeric:bigint": {
    castInJson: castToText,
    castArrayInJson: castToTextArr,
    normalizeInJson: BigInt,
    normalizeArrayInJson: arrayCompatNormalize(BigInt)
  },
  point: {
    castInJson: castToText,
    castArrayInJson: castToTextArr,
    normalizeInJson: parsePointXY,
    normalizeArrayInJson: arrayCompatNormalize(parsePointXY)
  },
  "point:tuple": {
    castInJson: castToText,
    castArrayInJson: castToTextArr,
    normalizeInJson: parsePointTuple,
    normalizeArrayInJson: arrayCompatNormalize(parsePointTuple)
  },
  timestamp: {
    castInJson: castToText,
    castArrayInJson: castToTextArr,
    normalizeInJson: textToDateWithTz,
    normalizeArrayInJson: arrayCompatNormalize(textToDateWithTz)
  },
  timestamptz: {
    castInJson: castToText,
    castArrayInJson: castToTextArr,
    normalizeInJson: textToDate,
    normalizeArrayInJson: arrayCompatNormalize(textToDate)
  },
  "timestamp:string": {
    castInJson: castToText,
    castArrayInJson: castToTextArr
  },
  "timestamptz:string": {
    castInJson: castToText,
    castArrayInJson: castToTextArr
  },
  halfvec: {
    normalizeInJson: parsePgVector,
    normalizeArrayInJson: arrayCompatNormalize(parsePgVector)
  },
  vector: {
    normalizeInJson: parsePgVector,
    normalizeArrayInJson: arrayCompatNormalize(parsePgVector)
  }
};
var refineGenericPgCodecs = (extension) => refineCodecs(genericPgCodecs, extension);

// node_modules/.bun/drizzle-orm@1.0.0-rc.5-169397b+5a2a64b31368e2d8/node_modules/drizzle-orm/effect-postgres/codecs.js
var effectPgCodecs = refineGenericPgCodecs({
  bigint: {
    normalize: BigInt,
    normalizeArray: arrayCompatNormalize(BigInt),
    normalizeParamArray: (v) => makePgArray(v)
  },
  bigserial: {
    normalize: BigInt,
    normalizeArray: arrayCompatNormalize(BigInt),
    normalizeParamArray: (v) => makePgArray(v)
  },
  bit: {
    normalizeArray: (v) => parsePgArray(v),
    normalizeParamArray: (v) => makePgArray(v)
  },
  date: {
    cast: castToText,
    castArray: castToTextArr,
    normalize: textToDate,
    normalizeArray: arrayCompatNormalize(textToDate),
    normalizeParamArray: (v) => makePgArray(v)
  },
  "date:string": {
    cast: castToText,
    castArray: castToTextArr,
    normalizeParamArray: (v) => makePgArray(v)
  },
  "geometry(point)": {
    normalize: parseGeometryXY,
    normalizeArray: parseGeometryArrayAndNormalize(parseGeometryXY),
    normalizeParamArray: makeGeometryArray
  },
  "geometry(point):tuple": {
    normalize: parseGeometryTuple,
    normalizeArray: parseGeometryArrayAndNormalize(parseGeometryTuple),
    normalizeParamArray: makeGeometryArray
  },
  interval: {
    cast: castToText,
    castArray: castToTextArr,
    normalizeParamArray: (v) => makePgArray(v)
  },
  line: {
    cast: castToText,
    castArray: castToTextArr,
    normalize: parseLineABC,
    normalizeArray: arrayCompatNormalize(parseLineABC),
    normalizeParamArray: (v) => makePgArray(v)
  },
  "line:tuple": {
    cast: castToText,
    castArray: castToTextArr,
    normalize: parseLineTuple,
    normalizeArray: arrayCompatNormalize(parseLineTuple),
    normalizeParamArray: (v) => makePgArray(v)
  },
  macaddr8: {
    castArrayInJson: castToTextArr,
    castArray: castToTextArr,
    normalizeParamArray: (v) => makePgArray(v)
  },
  point: {
    cast: castToText,
    castArray: castToTextArr,
    normalize: parsePointXY,
    normalizeArray: arrayCompatNormalize(parsePointXY),
    normalizeParamArray: (v) => makePgArray(v)
  },
  "point:tuple": {
    cast: castToText,
    castArray: castToTextArr,
    normalize: parsePointTuple,
    normalizeArray: arrayCompatNormalize(parsePointTuple),
    normalizeParamArray: (v) => makePgArray(v)
  },
  timestamp: {
    cast: castToText,
    castArray: castToTextArr,
    normalize: textToDateWithTz,
    normalizeArray: arrayCompatNormalize(textToDateWithTz),
    normalizeParamArray: (v) => makePgArray(v)
  },
  timestamptz: {
    cast: castToText,
    castArray: castToTextArr,
    normalize: textToDate,
    normalizeArray: arrayCompatNormalize(textToDate),
    normalizeParamArray: (v) => makePgArray(v)
  },
  "timestamp:string": {
    cast: castToText,
    castArray: castToTextArr,
    normalizeParamArray: (v) => makePgArray(v)
  },
  "timestamptz:string": {
    cast: castToText,
    castArray: castToTextArr,
    normalizeParamArray: (v) => makePgArray(v)
  },
  json: {
    normalizeParam: (v) => JSON.stringify(v),
    normalizeParamArray: arrayCompatNormalizeInput((v) => JSON.stringify(v), true)
  },
  jsonb: {
    normalizeParam: (v) => JSON.stringify(v),
    normalizeParamArray: arrayCompatNormalizeInput((v) => JSON.stringify(v), true)
  },
  bool: { normalizeParamArray: (v) => makePgArray(v) },
  box: { normalizeParamArray: makeBoxArray },
  box2d: { normalizeParamArray: (v) => makePgArray(v) },
  box3d: { normalizeParamArray: (v) => makePgArray(v) },
  char: { normalizeParamArray: (v) => makePgArray(v) },
  cidr: { normalizeParamArray: (v) => makePgArray(v) },
  circle: { normalizeParamArray: (v) => makePgArray(v) },
  datemultirange: { normalizeParamArray: (v) => makePgArray(v) },
  daterange: { normalizeParamArray: (v) => makePgArray(v) },
  float8: { normalizeParamArray: (v) => makePgArray(v) },
  "geography(point)": { normalizeParamArray: makeGeometryArray },
  "geography(point):tuple": { normalizeParamArray: makeGeometryArray },
  inet: { normalizeParamArray: (v) => makePgArray(v) },
  int4multirange: { normalizeParamArray: (v) => makePgArray(v) },
  int4range: { normalizeParamArray: (v) => makePgArray(v) },
  int8multirange: { normalizeParamArray: (v) => makePgArray(v) },
  int8range: { normalizeParamArray: (v) => makePgArray(v) },
  lseg: { normalizeParamArray: (v) => makePgArray(v) },
  macaddr: { normalizeParamArray: (v) => makePgArray(v) },
  money: { normalizeParamArray: (v) => makePgArray(v) },
  nummultirange: { normalizeParamArray: (v) => makePgArray(v) },
  numrange: { normalizeParamArray: (v) => makePgArray(v) },
  oid: { normalizeParamArray: (v) => makePgArray(v) },
  path: { normalizeParamArray: (v) => makePgArray(v) },
  polygon: { normalizeParamArray: (v) => makePgArray(v) },
  raster: { normalizeParamArray: (v) => makePgArray(v) },
  regclass: { normalizeParamArray: (v) => makePgArray(v) },
  regconfig: { normalizeParamArray: (v) => makePgArray(v) },
  regdictionary: { normalizeParamArray: (v) => makePgArray(v) },
  regnamespace: { normalizeParamArray: (v) => makePgArray(v) },
  regoper: { normalizeParamArray: (v) => makePgArray(v) },
  regoperator: { normalizeParamArray: (v) => makePgArray(v) },
  regproc: { normalizeParamArray: (v) => makePgArray(v) },
  regprocedure: { normalizeParamArray: (v) => makePgArray(v) },
  regrole: { normalizeParamArray: (v) => makePgArray(v) },
  regtype: { normalizeParamArray: (v) => makePgArray(v) },
  serial: { normalizeParamArray: (v) => makePgArray(v) },
  smallint: { normalizeParamArray: (v) => makePgArray(v) },
  smallserial: { normalizeParamArray: (v) => makePgArray(v) },
  text: { normalizeParamArray: (v) => makePgArray(v) },
  time: { normalizeParamArray: (v) => makePgArray(v) },
  timetz: { normalizeParamArray: (v) => makePgArray(v) },
  tsmultirange: { normalizeParamArray: (v) => makePgArray(v) },
  tsquery: { normalizeParamArray: (v) => makePgArray(v) },
  tsrange: { normalizeParamArray: (v) => makePgArray(v) },
  tstzmultirange: { normalizeParamArray: (v) => makePgArray(v) },
  tstzrange: { normalizeParamArray: (v) => makePgArray(v) },
  tsvector: { normalizeParamArray: (v) => makePgArray(v) },
  varbit: { normalizeParamArray: (v) => makePgArray(v) },
  varchar: { normalizeParamArray: (v) => makePgArray(v) },
  xml: { normalizeParamArray: (v) => makePgArray(v) },
  bytea: { normalizeParamArray: (v) => makePgArray(v) },
  enum: {
    castArray: castToTextArr,
    normalizeParamArray: (v) => makePgArray(v)
  },
  numeric: {
    castArray: castToTextArr,
    normalizeParamArray: (v) => makePgArray(v)
  },
  "numeric:number": {
    castArray: castToTextArr,
    normalize: Number,
    normalizeArray: arrayCompatNormalize(Number),
    normalizeParamArray: (v) => makePgArray(v)
  },
  "numeric:bigint": {
    castArray: castToTextArr,
    normalize: BigInt,
    normalizeArray: arrayCompatNormalize(BigInt),
    normalizeParamArray: (v) => makePgArray(v)
  },
  "bigint:number": {
    normalize: Number,
    normalizeArray: arrayCompatNormalize(Number),
    normalizeParamArray: (v) => makePgArray(v)
  },
  "bigint:string": { normalizeParamArray: (v) => makePgArray(v) },
  "bigserial:number": {
    normalize: Number,
    normalizeArray: arrayCompatNormalize(Number),
    normalizeParamArray: (v) => makePgArray(v)
  },
  float4: { normalizeParamArray: (v) => makePgArray(v) },
  int: { normalizeParamArray: (v) => makePgArray(v) },
  uuid: { normalizeParamArray: (v) => makePgArray(v) },
  halfvec: {
    normalize: parsePgVector,
    normalizeArray: parsePgArrayAndNormalize(parsePgVector),
    normalizeParamArray: (v) => makePgArray(v)
  },
  sparsevec: {
    normalizeArray: (v) => parsePgArray(v),
    normalizeParamArray: (v) => makePgArray(v)
  },
  vector: {
    normalize: parsePgVector,
    normalizeArray: parsePgArrayAndNormalize(parsePgVector),
    normalizeParamArray: (v) => makePgArray(v)
  }
});

// node_modules/.bun/drizzle-orm@1.0.0-rc.5-169397b+5a2a64b31368e2d8/node_modules/drizzle-orm/effect-postgres/session.js
import * as Effect10 from "effect/Effect";

// node_modules/.bun/drizzle-orm@1.0.0-rc.5-169397b+5a2a64b31368e2d8/node_modules/drizzle-orm/pg-core/session.js
var PgBasePreparedQuery = class {
  static [entityKind] = "PgBasePreparedQuery";
  constructor(query) {
    this.query = query;
  }
  getQuery() {
    return this.query;
  }
};
var PgSession = class {
  static [entityKind] = "PgSession";
  constructor(dialect) {
    this.dialect = dialect;
  }
};

// node_modules/.bun/drizzle-orm@1.0.0-rc.5-169397b+5a2a64b31368e2d8/node_modules/drizzle-orm/pg-core/foreign-keys.js
var ForeignKeyBuilder = class {
  static [entityKind] = "PgForeignKeyBuilder";
  /** @internal */
  reference;
  /** @internal */
  _onUpdate = "no action";
  /** @internal */
  _onDelete = "no action";
  constructor(config, actions) {
    this.reference = () => {
      const { name: name3, columns, foreignColumns } = config();
      return {
        name: name3,
        columns,
        foreignTable: foreignColumns[0].table,
        foreignColumns
      };
    };
    if (actions) {
      this._onUpdate = actions.onUpdate;
      this._onDelete = actions.onDelete;
    }
  }
  onUpdate(action) {
    this._onUpdate = action === void 0 ? "no action" : action;
    return this;
  }
  onDelete(action) {
    this._onDelete = action === void 0 ? "no action" : action;
    return this;
  }
  /** @internal */
  build(table2) {
    return new ForeignKey(table2, this);
  }
};
var ForeignKey = class {
  static [entityKind] = "PgForeignKey";
  reference;
  onUpdate;
  onDelete;
  name;
  constructor(table2, builder) {
    this.table = table2;
    this.reference = builder.reference;
    this.onUpdate = builder._onUpdate;
    this.onDelete = builder._onDelete;
  }
  getName() {
    const { name: name3, columns, foreignColumns } = this.reference();
    const columnNames = columns.map((column) => column.name);
    const foreignColumnNames = foreignColumns.map((column) => column.name);
    const chunks = [
      this.table[TableName],
      ...columnNames,
      foreignColumns[0].table[TableName],
      ...foreignColumnNames
    ];
    return name3 ?? `${chunks.join("_")}_fk`;
  }
  isNameExplicit() {
    return !!this.reference().name;
  }
};

// node_modules/.bun/drizzle-orm@1.0.0-rc.5-169397b+5a2a64b31368e2d8/node_modules/drizzle-orm/pg-core/columns/common.js
var PgColumnBuilder = class {
  static [entityKind] = "PgColumnBuilder";
  foreignKeyConfigs = [];
  config;
  constructor(name3, dataType, columnType) {
    this.config = {
      name: name3,
      keyAsName: name3 === "",
      notNull: false,
      default: void 0,
      hasDefault: false,
      primaryKey: false,
      isUnique: false,
      uniqueName: void 0,
      uniqueType: void 0,
      dataType,
      columnType,
      generated: void 0,
      defaultFn: void 0,
      onUpdateFn: void 0,
      generatedIdentity: void 0
    };
  }
  /**
  * Changes the data type of the column. Commonly used with `json` columns. Also, useful for branded types.
  *
  * @example
  * ```ts
  * const users = pgTable('users', {
  * 	id: integer('id').$type<UserId>().primaryKey(),
  * 	details: json('details').$type<UserDetails>().notNull(),
  * });
  * ```
  */
  $type() {
    return this;
  }
  /**
  * Adds a `not null` clause to the column definition.
  *
  * Affects the `select` model of the table - columns *without* `not null` will be nullable on select.
  */
  notNull() {
    this.config.notNull = true;
    return this;
  }
  /**
  * Adds a `default <value>` clause to the column definition.
  *
  * Affects the `insert` model of the table - columns *with* `default` are optional on insert.
  *
  * If you need to set a dynamic default value, use {@link $defaultFn} instead.
  */
  default(value3) {
    this.config.default = value3;
    this.config.hasDefault = true;
    return this;
  }
  /**
  * Adds a dynamic default value to the column.
  * The function will be called when the row is inserted, and the returned value will be used as the column value.
  *
  * **Note:** This value does not affect the `drizzle-kit` behavior, it is only used at runtime in `drizzle-orm`.
  */
  $defaultFn(fn4) {
    this.config.defaultFn = fn4;
    this.config.hasDefault = true;
    return this;
  }
  /**
  * Alias for {@link $defaultFn}.
  */
  $default(fn4) {
    return this.$defaultFn(fn4);
  }
  /**
  * Adds a dynamic update value to the column.
  * The function will be called when the row is updated, and the returned value will be used as the column value if none is provided.
  * If no `default` (or `$defaultFn`) value is provided, the function will be called when the row is inserted as well, and the returned value will be used as the column value.
  *
  * **Note:** This value does not affect the `drizzle-kit` behavior, it is only used at runtime in `drizzle-orm`.
  */
  $onUpdateFn(fn4) {
    this.config.onUpdateFn = fn4;
    this.config.hasDefault = true;
    return this;
  }
  /**
  * Alias for {@link $onUpdateFn}.
  */
  $onUpdate(fn4) {
    return this.$onUpdateFn(fn4);
  }
  /**
  * Adds a `primary key` clause to the column definition. This implicitly makes the column `not null`.
  *
  * In SQLite, `integer primary key` implicitly makes the column auto-incrementing.
  */
  primaryKey() {
    this.config.primaryKey = true;
    this.config.notNull = true;
    return this;
  }
  /** @internal Sets the name of the column to the key within the table definition if a name was not given. */
  setName(name3, casingFn) {
    if (this.config.name !== "") return;
    this.config.name = casingFn(name3);
  }
  array(dimensions) {
    const dim = dimensions ?? "[]";
    this.config.dimensions = dim.length / 2;
    return this;
  }
  references(ref, config = {}) {
    this.foreignKeyConfigs.push({
      ref,
      config
    });
    return this;
  }
  unique(name3, config) {
    this.config.isUnique = true;
    this.config.uniqueName = name3;
    this.config.uniqueType = config?.nulls;
    return this;
  }
  generatedAlwaysAs(as2) {
    this.config.generated = {
      as: as2,
      type: "always",
      mode: "stored"
    };
    return this;
  }
  /** @internal */
  buildForeignKeys(column, table2) {
    return this.foreignKeyConfigs.map(({ ref, config }) => {
      return iife((ref2, config2) => {
        const builder = new ForeignKeyBuilder(() => {
          const foreignColumn = ref2();
          return {
            name: config2.name,
            columns: [column],
            foreignColumns: [foreignColumn]
          };
        });
        if (config2.onUpdate) builder.onUpdate(config2.onUpdate);
        if (config2.onDelete) builder.onDelete(config2.onDelete);
        return builder.build(table2);
      }, ref, config);
    });
  }
  /** @internal */
  buildExtraConfigColumn(table2) {
    return new ExtraConfigColumn(table2, {
      ...this.config,
      dimensions: this.config.dimensions ?? 0
    });
  }
};
var PgColumn = class extends Column {
  static [entityKind] = "PgColumn";
  /** @internal */
  table;
  dimensions;
  constructor(table2, config) {
    super(table2, config);
    this.table = table2;
    this.dimensions = config.dimensions ?? 0;
  }
  /** @internal */
  postBuild() {
    if (this.dimensions) {
      const originalFromDriver = this.mapFromDriverValue.bind(this);
      const originalToDriver = this.mapToDriverValue.bind(this);
      this.mapFromDriverValue = this.mapFromDriverValue.isNoop ? this.mapFromDriverValue : (value3) => {
        return this.mapArrayElements(value3, originalFromDriver, this.dimensions);
      };
      this.mapToDriverValue = this.mapToDriverValue.isNoop ? this.mapToDriverValue : (value3) => {
        return this.mapArrayElements(value3, originalToDriver, this.dimensions);
      };
    }
    return this;
  }
  /**
  * Transforms this built column back into a fresh {@link PgColumnBuilder} in the exact same state:
  * a bare `toBuilder()` yields a builder whose built column is config-identical to this one.
  *
  * Useful for deriving a table from an existing one — pass the returned builder to `pgTable()` or
  * `pgSchema().table()` — while adjusting individual clauses through {@link overrides}.
  */
  toBuilder(overrides) {
    const config = { ...this.config };
    if (overrides) {
      const { name: name3, unique, ...rest } = overrides;
      Object.assign(config, rest);
      if (name3 !== void 0) {
        config.name = name3;
        config.keyAsName = false;
      }
      if (unique !== void 0) {
        config.isUnique = unique !== false;
        const uniqueConfig = typeof unique === "object" ? unique : void 0;
        config.uniqueName = uniqueConfig?.name;
        config.uniqueType = uniqueConfig?.nulls;
      }
      config.hasDefault = config.default !== void 0 || config.defaultFn !== void 0 || config.onUpdateFn !== void 0 || config.generatedIdentity !== void 0;
    }
    return new PgClonedColumnBuilder(config, Object.getPrototypeOf(this).constructor);
  }
  /** @internal */
  shouldDisableInsert() {
    return this.config.generatedIdentity !== void 0 && this.config.generatedIdentity.type !== "byDefault" || this.config.generated !== void 0 && this.config.generated.type !== "byDefault";
  }
  /** @internal */
  mapArrayElements(value3, mapper, depth) {
    if (depth > 0 && Array.isArray(value3)) return value3.map((v) => v === null ? null : this.mapArrayElements(v, mapper, depth - 1));
    return mapper(value3);
  }
};
var PgClonedColumnBuilder = class extends PgColumnBuilder {
  static [entityKind] = "PgClonedColumnBuilder";
  ColumnClass;
  constructor(config, ColumnClass) {
    super(config.name, config.dataType, config.columnType);
    this.config = config;
    this.ColumnClass = ColumnClass;
  }
  /** @internal */
  build(table2) {
    return new this.ColumnClass(table2, this.config);
  }
};
var ExtraConfigColumn = class extends PgColumn {
  static [entityKind] = "ExtraConfigColumn";
  /** @itnernal */
  codec = void 0;
  getSQLType() {
    return this.getSQLType();
  }
  indexConfig = {
    order: this.config.order ?? "asc",
    nulls: this.config.nulls ?? "last",
    opClass: this.config.opClass
  };
  defaultConfig = {
    order: "asc",
    nulls: "last",
    opClass: void 0
  };
  asc() {
    this.indexConfig.order = "asc";
    return this;
  }
  desc() {
    this.indexConfig.order = "desc";
    return this;
  }
  nullsFirst() {
    this.indexConfig.nulls = "first";
    return this;
  }
  nullsLast() {
    this.indexConfig.nulls = "last";
    return this;
  }
  /**
  * ### PostgreSQL documentation quote
  *
  * > An operator class with optional parameters can be specified for each column of an index.
  * The operator class identifies the operators to be used by the index for that column.
  * For example, a B-tree index on four-byte integers would use the int4_ops class;
  * this operator class includes comparison functions for four-byte integers.
  * In practice the default operator class for the column's data type is usually sufficient.
  * The main point of having operator classes is that for some data types, there could be more than one meaningful ordering.
  * For example, we might want to sort a complex-number data type either by absolute value or by real part.
  * We could do this by defining two operator classes for the data type and then selecting the proper class when creating an index.
  * More information about operator classes check:
  *
  * ### Useful links
  * https://www.postgresql.org/docs/current/sql-createindex.html
  *
  * https://www.postgresql.org/docs/current/indexes-opclass.html
  *
  * https://www.postgresql.org/docs/current/xindex.html
  *
  * ### Additional types
  * If you have the `pg_vector` extension installed in your database, you can use the
  * `vector_l2_ops`, `vector_ip_ops`, `vector_cosine_ops`, `vector_l1_ops`, `bit_hamming_ops`, `bit_jaccard_ops`, `halfvec_l2_ops`, `sparsevec_l2_ops` options, which are predefined types.
  *
  * **You can always specify any string you want in the operator class, in case Drizzle doesn't have it natively in its types**
  *
  * @param opClass
  * @returns
  */
  op(opClass) {
    this.indexConfig.opClass = opClass;
    return this;
  }
};
var IndexedColumn = class {
  static [entityKind] = "IndexedColumn";
  constructor(name3, keyAsName, type, indexConfig) {
    this.name = name3;
    this.keyAsName = keyAsName;
    this.type = type;
    this.indexConfig = indexConfig;
  }
  name;
  keyAsName;
  type;
  indexConfig;
};

// node_modules/.bun/drizzle-orm@1.0.0-rc.5-169397b+5a2a64b31368e2d8/node_modules/drizzle-orm/pg-core/columns/int.common.js
var PgIntColumnBuilder = class extends PgColumnBuilder {
  static [entityKind] = "PgIntColumnBaseBuilder";
  /**
  * Adds an `ALWAYS AS IDENTITY` clause to the column definition.
  * Available for integer column types.
  */
  generatedAlwaysAsIdentity(sequence) {
    if (sequence) {
      const { name: name3, ...options } = sequence;
      this.config.generatedIdentity = {
        type: "always",
        sequenceName: name3,
        sequenceOptions: options
      };
    } else this.config.generatedIdentity = { type: "always" };
    this.config.hasDefault = true;
    this.config.notNull = true;
    return this;
  }
  /**
  * Adds a `BY DEFAULT AS IDENTITY` clause to the column definition.
  * Available for integer column types.
  */
  generatedByDefaultAsIdentity(sequence) {
    if (sequence) {
      const { name: name3, ...options } = sequence;
      this.config.generatedIdentity = {
        type: "byDefault",
        sequenceName: name3,
        sequenceOptions: options
      };
    } else this.config.generatedIdentity = { type: "byDefault" };
    this.config.hasDefault = true;
    this.config.notNull = true;
    return this;
  }
};

// node_modules/.bun/drizzle-orm@1.0.0-rc.5-169397b+5a2a64b31368e2d8/node_modules/drizzle-orm/utils.js
function resolveNullableObjectPaths(columns, joinsNotNullableMap) {
  if (!joinsNotNullableMap) return void 0;
  const tableOf = /* @__PURE__ */ new Map();
  const order = [];
  const seen = /* @__PURE__ */ new Set();
  for (const { path, field, fieldType } of columns) {
    if (path.length < 2) continue;
    const key = path[0];
    if (!seen.has(key)) {
      seen.add(key);
      order.push(key);
    }
    if (fieldType !== "Column") continue;
    const tableName = getTableName(field.table);
    const current = tableOf.get(key);
    if (current === void 0) tableOf.set(key, tableName);
    else if (current !== false && current !== tableName) tableOf.set(key, false);
  }
  const result3 = [];
  for (const key of order) {
    const table2 = tableOf.get(key);
    if (typeof table2 === "string" && !joinsNotNullableMap[table2]) result3.push(key);
  }
  return result3;
}
function nullablePathTargets(columns, nullableObjectPaths) {
  const targets = new Array(nullableObjectPaths.length);
  for (let i = 0; i < nullableObjectPaths.length; ++i) {
    const key = nullableObjectPaths[i];
    const leaves = [];
    for (let j = 0; j < columns.length; ++j) {
      const cp = columns[j].path;
      if (cp.length > 1 && cp[0] === key) leaves.push(j);
    }
    targets[i] = {
      key,
      leaves
    };
  }
  return targets;
}
var FnConstructor = Object.getPrototypeOf(() => null).constructor;
function makeJitQueryMapperInner(columns, nullableObjectPaths) {
  const preFn = [];
  const fn4 = [];
  fn4.push(`const [ ${columns.map((_, i) => `c${i}`).join(", ")} ] = rows[i];`);
  const descendantIds = {};
  const nullableKeys = new Set(nullableObjectPaths ?? []);
  const decodes = new Array(columns.length);
  for (let idx = 0; idx < columns.length; ++idx) {
    const { field, fieldType, path, codec, arrayDimensions } = columns[idx];
    let decoder;
    let decoderStr;
    let decoderFieldDestructure;
    switch (fieldType) {
      case "Column":
        decoder = field;
        decoderFieldDestructure = `field: decoder${idx}`;
        break;
      case "SQL":
        decoder = field.decoder;
        decoderFieldDestructure = `field: { decoder: decoder${idx} }`;
        break;
      case "Subquery":
        decoder = field._.sql.decoder;
        decoderFieldDestructure = `field: { _: { sql: { decoder: decoder${idx} } } }`;
        break;
      default:
        decoder = field.sql.decoder;
        decoderFieldDestructure = `field: { sql: { decoder: decoder${idx} } }`;
    }
    decoderStr = `decoder${idx}.mapFromDriverValue`;
    if (decoder.mapFromDriverValue.isNoop) decoderStr = "";
    if (decoderStr) preFn.push(`const { ${decoderFieldDestructure}${codec ? `, codec: codec${idx}` : ""} } = columns[${idx}];`);
    else if (codec) preFn.push(`const { codec: codec${idx} } = columns[${idx}];`);
    const colStr = `c${idx}`;
    let decodedValue = colStr;
    if (codec) decodedValue = `codec${idx}(${decodedValue}, ${arrayDimensions})`;
    if (decoderStr) decodedValue = `${decoderStr}(${decodedValue})`;
    decodes[idx] = colStr === decodedValue ? `${colStr}` : `${colStr} === null ? ${colStr} : ${decodedValue}`;
    if (path.length > 1) (descendantIds[path[0]] ??= []).push(colStr);
  }
  fn4.push(`mapped[i] = {`);
  let currentObjectPath = [];
  for (let idx = 0; idx < columns.length; ++idx) {
    const { path } = columns[idx];
    const jsonPath = path.map((e) => JSON.stringify(e));
    const decodedValue = decodes[idx];
    const objectPath = path.slice(0, -1);
    let commonLen = 0;
    while (commonLen < currentObjectPath.length && commonLen < objectPath.length && currentObjectPath[commonLen] === objectPath[commonLen]) commonLen++;
    for (let d = currentObjectPath.length - 1; d >= commonLen; --d) fn4.push(`${"	".repeat(d + 1)}},`);
    for (let d = commonLen; d < objectPath.length; ++d) {
      const nullable = d === 0 && nullableKeys.has(path[0]);
      fn4.push(`${"	".repeat(d + 1)}${jsonPath[d]}: ${nullable ? `${descendantIds[path[0]].map((c) => `${c} === null`).join(" && ")} ? null : {` : "{"}`);
    }
    currentObjectPath = objectPath;
    fn4.push(`${"	".repeat(path.length)}${jsonPath[path.length - 1]}: ${decodedValue},`);
  }
  for (let d = currentObjectPath.length - 1; d >= 0; --d) fn4.push(`${"	".repeat(d + 1)}},`);
  fn4.push(`};`);
  return `${preFn.length ? `${preFn.join("\n	")}
	` : ""}for (let i = 0; i < length; ++i) {
		${fn4.join("\n		")}
	}`;
}
function makeJitQueryMapper(columns, nullableObjectPaths) {
  const internals = `	"use strict";
	const { columns } = this;
	const { length } = rows;
	const mapped = new Array(length);
	${makeJitQueryMapperInner(columns, nullableObjectPaths)}
	return mapped;
	//# sourceURL=drizzle:jit-query-mapper`;
  return Object.assign(new FnConstructor("rows", internals).bind({ columns }), { body: `function jitQueryMapper (rows) {
${internals}
}` });
}
function jitCompatCheck(isEnabled) {
  if (!isEnabled) return false;
  try {
    const res = new FnConstructor("input", '"use strict"; return input;')(true);
    if (res !== true) {
      console.warn("Unable to use jit mappers due to incompatibility: corrupted jit function output.\nFalling back to premade mappers.\nError details:");
      console.error(`Expected to receive \`true\`, got: ${res}`);
    }
    return true;
  } catch (e) {
    console.warn("Unable to use jit mappers due to incompatibility.\nFalling back to premade mappers.\nError details:");
    console.error(e);
    return false;
  }
}
function makeDefaultQueryMapper(columns, nullableObjectPaths) {
  const interpretedData = new Array(columns.length);
  for (let i = 0; i < columns.length; ++i) {
    const { field, fieldType, codec, arrayDimensions } = columns[i];
    let decoderSrc;
    switch (fieldType) {
      case "Column":
        decoderSrc = field;
        break;
      case "SQL":
        decoderSrc = field.decoder;
        break;
      case "Subquery":
        decoderSrc = field._.sql.decoder;
        break;
      default:
        decoderSrc = field.sql.decoder;
    }
    let decoder;
    if (decoderSrc.mapFromDriverValue.isNoop) decoder = codec ? (v) => codec(v, arrayDimensions) : void 0;
    else decoder = codec ? (v) => decoderSrc.mapFromDriverValue(codec(v, arrayDimensions)) : (v) => decoderSrc.mapFromDriverValue(v);
    interpretedData[i] = decoder;
  }
  const targets = nullableObjectPaths?.length ? nullablePathTargets(columns, nullableObjectPaths) : void 0;
  return ((rows) => {
    const { length: rowLength } = rows;
    const output = new Array(rowLength);
    for (let j = 0; j < rowLength; ++j) {
      const row = rows[j];
      const result3 = {};
      for (let i = 0; i < columns.length; ++i) {
        const { path } = columns[i];
        let node = result3;
        for (let p = 0; p < path.length; ++p) {
          const pathChunk = path[p];
          if (p < path.length - 1) {
            if (!(pathChunk in node)) node[pathChunk] = {};
            node = node[pathChunk];
          } else {
            const decoder = interpretedData[i];
            const rawValue = row[i];
            node[pathChunk] = rawValue === null ? null : decoder ? decoder(rawValue) : rawValue;
          }
        }
      }
      if (targets) for (let i = 0; i < targets.length; ++i) {
        const { key, leaves } = targets[i];
        let allNull = true;
        for (let j2 = 0; j2 < leaves.length; ++j2) if (row[leaves[j2]] !== null) {
          allNull = false;
          break;
        }
        if (allNull) result3[key] = null;
      }
      output[j] = result3;
    }
    return output;
  });
}
function orderSelectedFields(fields, pathPrefix, codecs2, result3 = []) {
  const entries = Object.entries(fields);
  for (let i = 0; i < entries.length; ++i) {
    const [name3, field] = entries[i];
    if (typeof name3 !== "string") return result3;
    const newPath = pathPrefix ? [...pathPrefix, name3] : [name3];
    if (is(field, Column)) result3.push({
      path: newPath,
      field,
      fieldType: "Column",
      codec: codecs2?.get(field, "normalize"),
      arrayDimensions: field.dimensions,
      column: field
    });
    else if (is(field, SQL)) {
      const col = getColumnFromDecoder(field);
      result3.push(col ? {
        path: newPath,
        field,
        fieldType: "SQL",
        codec: codecs2?.get(col, "normalize"),
        arrayDimensions: col.dimensions,
        column: col
      } : {
        path: newPath,
        field,
        fieldType: "SQL"
      });
    } else if (is(field, SQL.Aliased)) {
      const col = getColumnFromDecoder(field);
      result3.push(col ? {
        path: newPath,
        field,
        fieldType: "SQL.Aliased",
        codec: codecs2?.get(col, "normalize"),
        arrayDimensions: col.dimensions,
        column: col
      } : {
        path: newPath,
        field,
        fieldType: "SQL.Aliased"
      });
    } else if (is(field, Subquery)) {
      let column;
      const entry = Object.values(field._.selectedFields)[0];
      let fieldDecoder;
      if (is(entry, Column)) {
        column = entry;
        fieldDecoder = entry;
      } else if (is(entry, SQL)) {
        column = getColumnFromDecoder(entry);
        fieldDecoder = entry.decoder;
      } else {
        column = getColumnFromDecoder(entry);
        fieldDecoder = entry.sql.decoder;
      }
      if (fieldDecoder) field._.sql.decoder = fieldDecoder;
      result3.push(column ? {
        path: newPath,
        field,
        fieldType: "Subquery",
        codec: codecs2?.get(column, "normalize"),
        arrayDimensions: column.dimensions,
        column
      } : {
        path: newPath,
        field,
        fieldType: "Subquery"
      });
    } else if (is(field, Table)) orderSelectedFields(field[Table.Symbol.Columns], newPath, codecs2, result3);
    else orderSelectedFields(field, newPath, codecs2, result3);
  }
  return result3;
}
function getColumnFromDecoder(source) {
  const query = source.getSQL();
  if (is(query.decoder, Column)) return query.decoder;
}
function haveSameKeys(left, right) {
  const leftKeys = Object.keys(left);
  const rightKeys = Object.keys(right);
  if (leftKeys.length !== rightKeys.length) return false;
  for (const [index, key] of leftKeys.entries()) if (key !== rightKeys[index]) return false;
  return true;
}
function mapUpdateSet(table2, values) {
  const entries = Object.entries(values).filter(([, value3]) => value3 !== void 0);
  if (entries.length === 0) throw new Error("No values to set");
  const mapped = new Array(entries.length);
  for (let i = 0; i < entries.length; ++i) {
    const [key, value3] = entries[i];
    if (is(value3, SQL) || is(value3, Column)) mapped[i] = [key, value3];
    else mapped[i] = [key, new Param(value3, table2[Table.Symbol.Columns][key])];
  }
  return Object.fromEntries(mapped);
}
function getTableColumns(table2) {
  return table2[Table.Symbol.Columns];
}
function getTableLikeName(table2) {
  return is(table2, Subquery) ? table2._.alias : is(table2, View) ? table2[ViewBaseConfig].name : is(table2, SQL) ? void 0 : table2[Table.Symbol.IsAlias] ? table2[Table.Symbol.Name] : table2[Table.Symbol.BaseName];
}
function getColumnNameAndConfig(a, b) {
  return {
    name: typeof a === "string" && a.length > 0 ? a : "",
    config: typeof a === "object" ? a : b
  };
}
var textDecoder4 = typeof TextDecoder === "undefined" ? null : new TextDecoder();
function assertUnreachable(_x) {
  throw new Error("Didn't expect to get here");
}

// node_modules/.bun/drizzle-orm@1.0.0-rc.5-169397b+5a2a64b31368e2d8/node_modules/drizzle-orm/pg-core/columns/bigint.js
var PgBigInt53Builder = class extends PgIntColumnBuilder {
  static [entityKind] = "PgBigInt53Builder";
  constructor(name3) {
    super(name3, "number int53", "PgBigInt53");
  }
  /** @internal */
  build(table2) {
    return new PgBigInt53(table2, this.config);
  }
};
var PgBigInt53 = class extends PgColumn {
  static [entityKind] = "PgBigInt53";
  /** @internal */
  codec = "bigint:number";
  getSQLType() {
    return "bigint";
  }
};
var PgBigInt64Builder = class extends PgIntColumnBuilder {
  static [entityKind] = "PgBigInt64Builder";
  constructor(name3) {
    super(name3, "bigint int64", "PgBigInt64");
  }
  /** @internal */
  build(table2) {
    return new PgBigInt64(table2, this.config);
  }
};
var PgBigInt64 = class extends PgColumn {
  static [entityKind] = "PgBigInt64";
  /** @internal */
  codec = "bigint";
  getSQLType() {
    return "bigint";
  }
};
var PgBigIntStringBuilder = class extends PgIntColumnBuilder {
  static [entityKind] = "PgBigIntStringBuilder";
  constructor(name3) {
    super(name3, "string int64", "PgBigIntString");
  }
  /** @internal */
  build(table2) {
    return new PgBigIntString(table2, this.config);
  }
};
var PgBigIntString = class extends PgColumn {
  static [entityKind] = "PgBigIntString";
  /** @internal */
  codec = "bigint:string";
  getSQLType() {
    return "bigint";
  }
};
function bigint(a, b) {
  const { name: name3, config } = getColumnNameAndConfig(a, b);
  if (config.mode === "number") return new PgBigInt53Builder(name3);
  if (config.mode === "string") return new PgBigIntStringBuilder(name3);
  return new PgBigInt64Builder(name3);
}

// node_modules/.bun/drizzle-orm@1.0.0-rc.5-169397b+5a2a64b31368e2d8/node_modules/drizzle-orm/pg-core/columns/bigserial.js
var PgBigSerial53Builder = class extends PgColumnBuilder {
  static [entityKind] = "PgBigSerial53Builder";
  constructor(name3) {
    super(name3, "number int53", "PgBigSerial53");
    this.config.hasDefault = true;
    this.config.notNull = true;
  }
  /** @internal */
  build(table2) {
    return new PgBigSerial53(table2, this.config);
  }
};
var PgBigSerial53 = class extends PgColumn {
  static [entityKind] = "PgBigSerial53";
  /** @internal */
  codec = "bigserial:number";
  getSQLType() {
    return "bigserial";
  }
};
var PgBigSerial64Builder = class extends PgColumnBuilder {
  static [entityKind] = "PgBigSerial64Builder";
  constructor(name3) {
    super(name3, "bigint int64", "PgBigSerial64");
    this.config.hasDefault = true;
    this.config.notNull = true;
  }
  /** @internal */
  build(table2) {
    return new PgBigSerial64(table2, this.config);
  }
};
var PgBigSerial64 = class extends PgColumn {
  static [entityKind] = "PgBigSerial64";
  /** @internal */
  codec = "bigserial";
  getSQLType() {
    return "bigserial";
  }
};
function bigserial(a, b) {
  const { name: name3, config } = getColumnNameAndConfig(a, b);
  if (config.mode === "number") return new PgBigSerial53Builder(name3);
  return new PgBigSerial64Builder(name3);
}

// node_modules/.bun/drizzle-orm@1.0.0-rc.5-169397b+5a2a64b31368e2d8/node_modules/drizzle-orm/pg-core/columns/boolean.js
var PgBooleanBuilder = class extends PgColumnBuilder {
  static [entityKind] = "PgBooleanBuilder";
  constructor(name3) {
    super(name3, "boolean", "PgBoolean");
  }
  /** @internal */
  build(table2) {
    return new PgBoolean(table2, this.config);
  }
};
var PgBoolean = class extends PgColumn {
  static [entityKind] = "PgBoolean";
  /** @internal */
  codec = "bool";
  getSQLType() {
    return "boolean";
  }
};
function boolean(name3) {
  return new PgBooleanBuilder(name3 ?? "");
}

// node_modules/.bun/drizzle-orm@1.0.0-rc.5-169397b+5a2a64b31368e2d8/node_modules/drizzle-orm/pg-core/columns/bytea.js
var PgByteaBuilder = class extends PgColumnBuilder {
  static [entityKind] = "PgByteaBuilder";
  constructor(name3) {
    super(name3, "object buffer", "PgBytea");
  }
  /** @internal */
  build(table2) {
    return new PgBytea(table2, this.config);
  }
};
var PgBytea = class extends PgColumn {
  static [entityKind] = "PgBytea";
  /** @internal */
  codec = "bytea";
  getSQLType() {
    return "bytea";
  }
};
function bytea2(name3) {
  return new PgByteaBuilder(name3 ?? "");
}

// node_modules/.bun/drizzle-orm@1.0.0-rc.5-169397b+5a2a64b31368e2d8/node_modules/drizzle-orm/pg-core/columns/char.js
var PgCharBuilder = class extends PgColumnBuilder {
  static [entityKind] = "PgCharBuilder";
  constructor(name3, config) {
    super(name3, config.enum?.length ? "string enum" : "string", "PgChar");
    this.config.length = config.length ?? 1;
    this.config.setLength = config.length !== void 0;
    this.config.enumValues = config.enum;
  }
  /** @internal */
  build(table2) {
    return new PgChar(table2, this.config);
  }
};
var PgChar = class extends PgColumn {
  static [entityKind] = "PgChar";
  /** @internal */
  codec = "char";
  enumValues;
  setLength;
  constructor(table2, config) {
    super(table2, config);
    this.enumValues = config.enumValues;
    this.setLength = config.setLength;
  }
  getSQLType() {
    return this.setLength ? `char(${this.length})` : `char`;
  }
};
function char(a, b = {}) {
  const { name: name3, config } = getColumnNameAndConfig(a, b);
  return new PgCharBuilder(name3, config);
}

// node_modules/.bun/drizzle-orm@1.0.0-rc.5-169397b+5a2a64b31368e2d8/node_modules/drizzle-orm/pg-core/columns/cidr.js
var PgCidrBuilder = class extends PgColumnBuilder {
  static [entityKind] = "PgCidrBuilder";
  constructor(name3) {
    super(name3, "string cidr", "PgCidr");
  }
  /** @internal */
  build(table2) {
    return new PgCidr(table2, this.config);
  }
};
var PgCidr = class extends PgColumn {
  static [entityKind] = "PgCidr";
  /** @internal */
  codec = "cidr";
  getSQLType() {
    return "cidr";
  }
};
function cidr2(name3) {
  return new PgCidrBuilder(name3 ?? "");
}

// node_modules/.bun/drizzle-orm@1.0.0-rc.5-169397b+5a2a64b31368e2d8/node_modules/drizzle-orm/pg-core/columns/custom.js
var PgCustomColumnBuilder = class extends PgColumnBuilder {
  static [entityKind] = "PgCustomColumnBuilder";
  constructor(name3, fieldConfig, customTypeParams) {
    super(name3, "custom", "PgCustomColumn");
    this.config.fieldConfig = fieldConfig;
    this.config.customTypeParams = customTypeParams;
  }
  /** @internal */
  build(table2) {
    return new PgCustomColumn(table2, this.config);
  }
};
var PgCustomColumn = class extends PgColumn {
  static [entityKind] = "PgCustomColumn";
  /** @internal */
  codec;
  sqlName;
  mapFromJsonValue;
  jsonSelectIdentifier;
  constructor(table2, config) {
    super(table2, config);
    this.sqlName = config.customTypeParams.dataType(config.fieldConfig);
    this.mapToDriverValue = config.customTypeParams.toDriver ?? this.mapToDriverValue;
    this.mapFromDriverValue = config.customTypeParams.fromDriver ?? this.mapFromDriverValue;
    this.mapFromJsonValue = config.customTypeParams.fromJson;
    this.jsonSelectIdentifier = config.customTypeParams.forJsonSelect;
    const cfgCodec = typeof config.customTypeParams.codec === "string" || typeof config.customTypeParams.codec === "undefined" ? config.customTypeParams.codec : config.customTypeParams.codec(config.fieldConfig);
    this.codec = typeof cfgCodec === "string" ? resolvePgTypeAlias(cfgCodec) : void 0;
    if (this.dimensions && config.customTypeParams.fromJson) this.mapFromJsonValue = (value3) => {
      if (value3 === null) return value3;
      const arr = typeof value3 === "string" ? parsePgArray(value3) : value3;
      return this.mapJsonArrayElements(arr, config.customTypeParams.fromJson, this.dimensions);
    };
  }
  /** @internal */
  mapJsonArrayElements(value3, mapper, depth) {
    if (depth > 0 && Array.isArray(value3)) return value3.map((v) => v === null ? null : this.mapJsonArrayElements(v, mapper, depth - 1));
    return mapper(value3);
  }
  getSQLType() {
    return this.sqlName;
  }
};
function customType(customTypeParams) {
  return (a, b) => {
    const { name: name3, config } = getColumnNameAndConfig(a, b);
    return new PgCustomColumnBuilder(name3, config, customTypeParams);
  };
}

// node_modules/.bun/drizzle-orm@1.0.0-rc.5-169397b+5a2a64b31368e2d8/node_modules/drizzle-orm/pg-core/columns/date.common.js
var PgDateColumnBuilder = class extends PgColumnBuilder {
  static [entityKind] = "PgDateColumnBaseBuilder";
  /**
  * Adds a `default now()` clause to the column definition.
  * Available for date/time column types.
  */
  defaultNow() {
    return this.default(sql`now()`);
  }
};

// node_modules/.bun/drizzle-orm@1.0.0-rc.5-169397b+5a2a64b31368e2d8/node_modules/drizzle-orm/pg-core/columns/date.js
var PgDateBuilder = class extends PgDateColumnBuilder {
  static [entityKind] = "PgDateBuilder";
  constructor(name3) {
    super(name3, "object date", "PgDate");
  }
  /** @internal */
  build(table2) {
    return new PgDate(table2, this.config);
  }
};
var PgDate = class extends PgColumn {
  static [entityKind] = "PgDate";
  /** @internal */
  codec = "date";
  getSQLType() {
    return "date";
  }
  mapToDriverValue = function(value3) {
    if (typeof value3 === "string") return value3;
    return value3.toISOString();
  };
};
var PgDateStringBuilder = class extends PgDateColumnBuilder {
  static [entityKind] = "PgDateStringBuilder";
  constructor(name3) {
    super(name3, "string date", "PgDateString");
  }
  /** @internal */
  build(table2) {
    return new PgDateString(table2, this.config);
  }
};
var PgDateString = class extends PgColumn {
  static [entityKind] = "PgDateString";
  /** @internal */
  codec = "date:string";
  getSQLType() {
    return "date";
  }
  mapToDriverValue = (value3) => {
    if (typeof value3 === "string") return value3;
    return value3.toISOString();
  };
};
function date2(a, b) {
  const { name: name3, config } = getColumnNameAndConfig(a, b);
  if (config?.mode === "date") return new PgDateBuilder(name3);
  return new PgDateStringBuilder(name3);
}

// node_modules/.bun/drizzle-orm@1.0.0-rc.5-169397b+5a2a64b31368e2d8/node_modules/drizzle-orm/pg-core/columns/double-precision.js
var PgDoublePrecisionBuilder = class extends PgColumnBuilder {
  static [entityKind] = "PgDoublePrecisionBuilder";
  constructor(name3) {
    super(name3, "number double", "PgDoublePrecision");
  }
  /** @internal */
  build(table2) {
    return new PgDoublePrecision(table2, this.config);
  }
};
var PgDoublePrecision = class extends PgColumn {
  static [entityKind] = "PgDoublePrecision";
  /** @internal */
  codec = "float8";
  getSQLType() {
    return "double precision";
  }
};
function doublePrecision(name3) {
  return new PgDoublePrecisionBuilder(name3 ?? "");
}

// node_modules/.bun/drizzle-orm@1.0.0-rc.5-169397b+5a2a64b31368e2d8/node_modules/drizzle-orm/pg-core/columns/inet.js
var PgInetBuilder = class extends PgColumnBuilder {
  static [entityKind] = "PgInetBuilder";
  constructor(name3) {
    super(name3, "string inet", "PgInet");
  }
  /** @internal */
  build(table2) {
    return new PgInet(table2, this.config);
  }
};
var PgInet = class extends PgColumn {
  static [entityKind] = "PgInet";
  /** @internal */
  codec = "inet";
  getSQLType() {
    return "inet";
  }
};
function inet2(name3) {
  return new PgInetBuilder(name3 ?? "");
}

// node_modules/.bun/drizzle-orm@1.0.0-rc.5-169397b+5a2a64b31368e2d8/node_modules/drizzle-orm/pg-core/columns/integer.js
var PgIntegerBuilder = class extends PgIntColumnBuilder {
  static [entityKind] = "PgIntegerBuilder";
  constructor(name3) {
    super(name3, "number int32", "PgInteger");
  }
  /** @internal */
  build(table2) {
    return new PgInteger(table2, this.config);
  }
};
var PgInteger = class extends PgColumn {
  static [entityKind] = "PgInteger";
  /** @internal */
  codec = "int";
  getSQLType() {
    return "integer";
  }
};
function integer(name3) {
  return new PgIntegerBuilder(name3 ?? "");
}

// node_modules/.bun/drizzle-orm@1.0.0-rc.5-169397b+5a2a64b31368e2d8/node_modules/drizzle-orm/pg-core/columns/interval.js
var PgIntervalBuilder = class extends PgColumnBuilder {
  static [entityKind] = "PgIntervalBuilder";
  constructor(name3, intervalConfig) {
    super(name3, "string interval", "PgInterval");
    this.config.intervalConfig = intervalConfig;
  }
  /** @internal */
  build(table2) {
    return new PgInterval(table2, this.config);
  }
};
var PgInterval = class extends PgColumn {
  static [entityKind] = "PgInterval";
  /** @internal */
  codec = "interval";
  fields;
  precision;
  constructor(table2, config) {
    super(table2, config);
    this.fields = config.intervalConfig.fields;
    this.precision = config.intervalConfig.precision;
  }
  getSQLType() {
    return `interval${this.fields ? ` ${this.fields}` : ""}${this.precision ? `(${this.precision})` : ""}`;
  }
};
function interval(a, b = {}) {
  const { name: name3, config } = getColumnNameAndConfig(a, b);
  return new PgIntervalBuilder(name3, config);
}

// node_modules/.bun/drizzle-orm@1.0.0-rc.5-169397b+5a2a64b31368e2d8/node_modules/drizzle-orm/pg-core/columns/json.js
var PgJsonBuilder = class extends PgColumnBuilder {
  static [entityKind] = "PgJsonBuilder";
  constructor(name3) {
    super(name3, "object json", "PgJson");
  }
  /** @internal */
  build(table2) {
    return new PgJson2(table2, this.config);
  }
};
var PgJson2 = class extends PgColumn {
  static [entityKind] = "PgJson";
  /** @internal */
  codec = "json";
  constructor(table2, config) {
    super(table2, config);
  }
  getSQLType() {
    return "json";
  }
};
function json2(name3) {
  return new PgJsonBuilder(name3 ?? "");
}

// node_modules/.bun/drizzle-orm@1.0.0-rc.5-169397b+5a2a64b31368e2d8/node_modules/drizzle-orm/pg-core/columns/jsonb.js
var PgJsonbBuilder = class extends PgColumnBuilder {
  static [entityKind] = "PgJsonbBuilder";
  constructor(name3) {
    super(name3, "object json", "PgJsonb");
  }
  /** @internal */
  build(table2) {
    return new PgJsonb(table2, this.config);
  }
};
var PgJsonb = class extends PgColumn {
  static [entityKind] = "PgJsonb";
  /** @internal */
  codec = "jsonb";
  constructor(table2, config) {
    super(table2, config);
  }
  getSQLType() {
    return "jsonb";
  }
};
function jsonb2(name3) {
  return new PgJsonbBuilder(name3 ?? "");
}

// node_modules/.bun/drizzle-orm@1.0.0-rc.5-169397b+5a2a64b31368e2d8/node_modules/drizzle-orm/pg-core/columns/line.js
var PgLineBuilder = class extends PgColumnBuilder {
  static [entityKind] = "PgLineBuilder";
  constructor(name3) {
    super(name3, "array line", "PgLine");
  }
  /** @internal */
  build(table2) {
    return new PgLineTuple(table2, this.config);
  }
};
var PgLineTuple = class extends PgColumn {
  static [entityKind] = "PgLine";
  /** @internal */
  codec = "line:tuple";
  mode = "tuple";
  getSQLType() {
    return "line";
  }
  mapToDriverValue = (value3) => {
    return `{${value3[0]},${value3[1]},${value3[2]}}`;
  };
};
var PgLineABCBuilder = class extends PgColumnBuilder {
  static [entityKind] = "PgLineABCBuilder";
  constructor(name3) {
    super(name3, "object line", "PgLineABC");
  }
  /** @internal */
  build(table2) {
    return new PgLineABC(table2, this.config);
  }
};
var PgLineABC = class extends PgColumn {
  static [entityKind] = "PgLineABC";
  /** @internal */
  codec = "line";
  mode = "abc";
  getSQLType() {
    return "line";
  }
  mapToDriverValue = (value3) => {
    return `{${value3.a},${value3.b},${value3.c}}`;
  };
};
function line(a, b) {
  const { name: name3, config } = getColumnNameAndConfig(a, b);
  if (!config?.mode || config.mode === "tuple") return new PgLineBuilder(name3);
  return new PgLineABCBuilder(name3);
}

// node_modules/.bun/drizzle-orm@1.0.0-rc.5-169397b+5a2a64b31368e2d8/node_modules/drizzle-orm/pg-core/columns/macaddr.js
var PgMacaddrBuilder = class extends PgColumnBuilder {
  static [entityKind] = "PgMacaddrBuilder";
  constructor(name3) {
    super(name3, "string macaddr", "PgMacaddr");
  }
  /** @internal */
  build(table2) {
    return new PgMacaddr(table2, this.config);
  }
};
var PgMacaddr = class extends PgColumn {
  static [entityKind] = "PgMacaddr";
  /** @internal */
  codec = "macaddr";
  getSQLType() {
    return "macaddr";
  }
};
function macaddr(name3) {
  return new PgMacaddrBuilder(name3 ?? "");
}

// node_modules/.bun/drizzle-orm@1.0.0-rc.5-169397b+5a2a64b31368e2d8/node_modules/drizzle-orm/pg-core/columns/macaddr8.js
var PgMacaddr8Builder = class extends PgColumnBuilder {
  static [entityKind] = "PgMacaddr8Builder";
  constructor(name3) {
    super(name3, "string macaddr8", "PgMacaddr8");
  }
  /** @internal */
  build(table2) {
    return new PgMacaddr8(table2, this.config);
  }
};
var PgMacaddr8 = class extends PgColumn {
  static [entityKind] = "PgMacaddr8";
  /** @internal */
  codec = "macaddr8";
  getSQLType() {
    return "macaddr8";
  }
};
function macaddr8(name3) {
  return new PgMacaddr8Builder(name3 ?? "");
}

// node_modules/.bun/drizzle-orm@1.0.0-rc.5-169397b+5a2a64b31368e2d8/node_modules/drizzle-orm/pg-core/columns/numeric.js
var PgNumericBuilder = class extends PgColumnBuilder {
  static [entityKind] = "PgNumericBuilder";
  constructor(name3, precision, scale) {
    super(name3, "string numeric", "PgNumeric");
    this.config.precision = precision;
    this.config.scale = scale;
  }
  /** @internal */
  build(table2) {
    return new PgNumeric(table2, this.config);
  }
};
var PgNumeric = class extends PgColumn {
  static [entityKind] = "PgNumeric";
  /** @internal */
  codec = "numeric";
  precision;
  scale;
  constructor(table2, config) {
    super(table2, config);
    this.precision = config.precision;
    this.scale = config.scale;
  }
  getSQLType() {
    if (this.precision !== void 0 && this.scale !== void 0) return `numeric(${this.precision}, ${this.scale})`;
    else if (this.precision === void 0) return "numeric";
    else return `numeric(${this.precision})`;
  }
};
var PgNumericNumberBuilder = class extends PgColumnBuilder {
  static [entityKind] = "PgNumericNumberBuilder";
  constructor(name3, precision, scale) {
    super(name3, "number", "PgNumericNumber");
    this.config.precision = precision;
    this.config.scale = scale;
  }
  /** @internal */
  build(table2) {
    return new PgNumericNumber(table2, this.config);
  }
};
var PgNumericNumber = class extends PgColumn {
  static [entityKind] = "PgNumericNumber";
  /** @internal */
  codec = "numeric:number";
  precision;
  scale;
  constructor(table2, config) {
    super(table2, config);
    this.precision = config.precision;
    this.scale = config.scale;
  }
  mapToDriverValue = String;
  getSQLType() {
    if (this.precision !== void 0 && this.scale !== void 0) return `numeric(${this.precision}, ${this.scale})`;
    else if (this.precision === void 0) return "numeric";
    else return `numeric(${this.precision})`;
  }
};
var PgNumericBigIntBuilder = class extends PgColumnBuilder {
  static [entityKind] = "PgNumericBigIntBuilder";
  constructor(name3, precision, scale) {
    super(name3, "bigint int64", "PgNumericBigInt");
    this.config.precision = precision;
    this.config.scale = scale;
  }
  /** @internal */
  build(table2) {
    return new PgNumericBigInt(table2, this.config);
  }
};
var PgNumericBigInt = class extends PgColumn {
  static [entityKind] = "PgNumericBigInt";
  /** @internal */
  codec = "numeric:bigint";
  precision;
  scale;
  constructor(table2, config) {
    super(table2, config);
    this.precision = config.precision;
    this.scale = config.scale;
  }
  mapToDriverValue = String;
  getSQLType() {
    if (this.precision !== void 0 && this.scale !== void 0) return `numeric(${this.precision}, ${this.scale})`;
    else if (this.precision === void 0) return "numeric";
    else return `numeric(${this.precision})`;
  }
};
function numeric2(a, b) {
  const { name: name3, config } = getColumnNameAndConfig(a, b);
  const mode = config?.mode;
  return mode === "number" ? new PgNumericNumberBuilder(name3, config?.precision, config?.scale) : mode === "bigint" ? new PgNumericBigIntBuilder(name3, config?.precision, config?.scale) : new PgNumericBuilder(name3, config?.precision, config?.scale);
}

// node_modules/.bun/drizzle-orm@1.0.0-rc.5-169397b+5a2a64b31368e2d8/node_modules/drizzle-orm/pg-core/columns/point.js
var PgPointTupleBuilder = class extends PgColumnBuilder {
  static [entityKind] = "PgPointTupleBuilder";
  constructor(name3) {
    super(name3, "array point", "PgPointTuple");
  }
  /** @internal */
  build(table2) {
    return new PgPointTuple(table2, this.config);
  }
};
var PgPointTuple = class extends PgColumn {
  static [entityKind] = "PgPointTuple";
  /** @internal */
  codec = "point:tuple";
  mode = "tuple";
  getSQLType() {
    return "point";
  }
  mapToDriverValue = (value3) => {
    return `(${value3[0]},${value3[1]})`;
  };
};
var PgPointObjectBuilder = class extends PgColumnBuilder {
  static [entityKind] = "PgPointObjectBuilder";
  constructor(name3) {
    super(name3, "object point", "PgPointObject");
  }
  /** @internal */
  build(table2) {
    return new PgPointObject(table2, this.config);
  }
};
var PgPointObject = class extends PgColumn {
  static [entityKind] = "PgPointObject";
  /** @internal */
  codec = "point";
  mode = "xy";
  getSQLType() {
    return "point";
  }
  mapToDriverValue = (value3) => {
    return `(${value3.x},${value3.y})`;
  };
};
function point(a, b) {
  const { name: name3, config } = getColumnNameAndConfig(a, b);
  if (!config?.mode || config.mode === "tuple") return new PgPointTupleBuilder(name3);
  return new PgPointObjectBuilder(name3);
}

// node_modules/.bun/drizzle-orm@1.0.0-rc.5-169397b+5a2a64b31368e2d8/node_modules/drizzle-orm/pg-core/columns/postgis_extension/geometry.js
var PgGeometryBuilder = class extends PgColumnBuilder {
  static [entityKind] = "PgGeometryBuilder";
  constructor(name3, srid) {
    super(name3, "array geometry", "PgGeometry");
    this.config.srid = srid;
  }
  /** @internal */
  build(table2) {
    return new PgGeometry(table2, this.config);
  }
};
var PgGeometry = class extends PgColumn {
  static [entityKind] = "PgGeometry";
  /** @internal */
  codec = "geometry(point):tuple";
  srid = this.config.srid;
  mode = "tuple";
  getSQLType() {
    return `geometry(point${this.srid === void 0 ? "" : `,${this.srid}`})`;
  }
  mapToDriverValue = (value3) => {
    return `point(${value3[0]} ${value3[1]})`;
  };
};
var PgGeometryObjectBuilder = class extends PgColumnBuilder {
  static [entityKind] = "PgGeometryObjectBuilder";
  constructor(name3, srid) {
    super(name3, "object geometry", "PgGeometryObject");
    this.config.srid = srid;
  }
  /** @internal */
  build(table2) {
    return new PgGeometryObject(table2, this.config);
  }
};
var PgGeometryObject = class extends PgColumn {
  static [entityKind] = "PgGeometryObject";
  /** @internal */
  codec = "geometry(point)";
  srid = this.config.srid;
  mode = "object";
  getSQLType() {
    return `geometry(point${this.srid === void 0 ? "" : `,${this.srid}`})`;
  }
  mapToDriverValue = (value3) => {
    return `point(${value3.x} ${value3.y})`;
  };
};
function geometry(a, b) {
  const { name: name3, config } = getColumnNameAndConfig(a, b);
  if (!config?.mode || config.mode === "tuple") return new PgGeometryBuilder(name3, config?.srid);
  return new PgGeometryObjectBuilder(name3, config?.srid);
}

// node_modules/.bun/drizzle-orm@1.0.0-rc.5-169397b+5a2a64b31368e2d8/node_modules/drizzle-orm/pg-core/columns/real.js
var PgRealBuilder = class extends PgColumnBuilder {
  static [entityKind] = "PgRealBuilder";
  constructor(name3, length) {
    super(name3, "number float", "PgReal");
    this.config.length = length;
  }
  /** @internal */
  build(table2) {
    return new PgReal(table2, this.config);
  }
};
var PgReal = class extends PgColumn {
  static [entityKind] = "PgReal";
  /** @internal */
  codec = "float4";
  constructor(table2, config) {
    super(table2, config);
  }
  getSQLType() {
    return "real";
  }
};
function real(name3) {
  return new PgRealBuilder(name3 ?? "");
}

// node_modules/.bun/drizzle-orm@1.0.0-rc.5-169397b+5a2a64b31368e2d8/node_modules/drizzle-orm/pg-core/columns/serial.js
var PgSerialBuilder = class extends PgColumnBuilder {
  static [entityKind] = "PgSerialBuilder";
  constructor(name3) {
    super(name3, "number int32", "PgSerial");
    this.config.hasDefault = true;
    this.config.notNull = true;
  }
  /** @internal */
  build(table2) {
    return new PgSerial(table2, this.config);
  }
};
var PgSerial = class extends PgColumn {
  static [entityKind] = "PgSerial";
  /** @internal */
  codec = "serial";
  getSQLType() {
    return "serial";
  }
};
function serial(name3) {
  return new PgSerialBuilder(name3 ?? "");
}

// node_modules/.bun/drizzle-orm@1.0.0-rc.5-169397b+5a2a64b31368e2d8/node_modules/drizzle-orm/pg-core/columns/smallint.js
var PgSmallIntBuilder = class extends PgIntColumnBuilder {
  static [entityKind] = "PgSmallIntBuilder";
  constructor(name3) {
    super(name3, "number int16", "PgSmallInt");
  }
  /** @internal */
  build(table2) {
    return new PgSmallInt(table2, this.config);
  }
};
var PgSmallInt = class extends PgColumn {
  static [entityKind] = "PgSmallInt";
  /** @internal */
  codec = "smallint";
  getSQLType() {
    return "smallint";
  }
};
function smallint(name3) {
  return new PgSmallIntBuilder(name3 ?? "");
}

// node_modules/.bun/drizzle-orm@1.0.0-rc.5-169397b+5a2a64b31368e2d8/node_modules/drizzle-orm/pg-core/columns/smallserial.js
var PgSmallSerialBuilder = class extends PgColumnBuilder {
  static [entityKind] = "PgSmallSerialBuilder";
  constructor(name3) {
    super(name3, "number int16", "PgSmallSerial");
    this.config.hasDefault = true;
    this.config.notNull = true;
  }
  /** @internal */
  build(table2) {
    return new PgSmallSerial(table2, this.config);
  }
};
var PgSmallSerial = class extends PgColumn {
  static [entityKind] = "PgSmallSerial";
  /** @internal */
  codec = "smallserial";
  getSQLType() {
    return "smallserial";
  }
};
function smallserial(name3) {
  return new PgSmallSerialBuilder(name3 ?? "");
}

// node_modules/.bun/drizzle-orm@1.0.0-rc.5-169397b+5a2a64b31368e2d8/node_modules/drizzle-orm/pg-core/columns/text.js
var PgTextBuilder = class extends PgColumnBuilder {
  static [entityKind] = "PgTextBuilder";
  constructor(name3, config) {
    super(name3, config.enum?.length ? "string enum" : "string", "PgText");
    this.config.enumValues = config.enum;
  }
  /** @internal */
  build(table2) {
    return new PgText(table2, this.config);
  }
};
var PgText = class extends PgColumn {
  static [entityKind] = "PgText";
  enumValues;
  /** @internal */
  codec = "text";
  constructor(table2, config) {
    super(table2, config);
    this.enumValues = config.enumValues;
  }
  getSQLType() {
    return "text";
  }
};
function text2(a, b = {}) {
  const { name: name3, config } = getColumnNameAndConfig(a, b);
  return new PgTextBuilder(name3, config);
}

// node_modules/.bun/drizzle-orm@1.0.0-rc.5-169397b+5a2a64b31368e2d8/node_modules/drizzle-orm/pg-core/columns/time.js
var PgTimeBuilder = class extends PgDateColumnBuilder {
  static [entityKind] = "PgTimeBuilder";
  constructor(name3, withTimezone, precision) {
    super(name3, "string time", "PgTime");
    this.withTimezone = withTimezone;
    this.precision = precision;
    this.config.withTimezone = withTimezone;
    this.config.precision = precision;
  }
  /** @internal */
  build(table2) {
    return new PgTime(table2, this.config);
  }
};
var PgTime = class extends PgColumn {
  static [entityKind] = "PgTime";
  /** @internal */
  codec = "time";
  withTimezone;
  precision;
  constructor(table2, config) {
    super(table2, config);
    this.withTimezone = config.withTimezone;
    this.precision = config.precision;
  }
  getSQLType() {
    return `time${this.precision === void 0 ? "" : `(${this.precision})`}${this.withTimezone ? " with time zone" : ""}`;
  }
};
function time2(a, b = {}) {
  const { name: name3, config } = getColumnNameAndConfig(a, b);
  return new PgTimeBuilder(name3, config.withTimezone ?? false, config.precision);
}

// node_modules/.bun/drizzle-orm@1.0.0-rc.5-169397b+5a2a64b31368e2d8/node_modules/drizzle-orm/pg-core/columns/timestamp.js
var PgTimestampBuilder = class extends PgDateColumnBuilder {
  static [entityKind] = "PgTimestampBuilder";
  constructor(name3, withTimezone, precision) {
    super(name3, "object date", "PgTimestamp");
    this.config.withTimezone = withTimezone;
    this.config.precision = precision;
  }
  /** @internal */
  build(table2) {
    return new PgTimestamp(table2, this.config);
  }
};
var PgTimestamp = class extends PgColumn {
  static [entityKind] = "PgTimestamp";
  /** @internal */
  codec;
  withTimezone;
  precision;
  constructor(table2, config) {
    super(table2, config);
    this.withTimezone = config.withTimezone;
    this.precision = config.precision;
    this.codec = this.withTimezone ? "timestamptz" : "timestamp";
  }
  getSQLType() {
    return `timestamp${this.precision === void 0 ? "" : ` (${this.precision})`}${this.withTimezone ? " with time zone" : ""}`;
  }
  mapToDriverValue = (value3) => {
    if (typeof value3 === "string") return value3;
    return value3.toISOString();
  };
};
var PgTimestampStringBuilder = class extends PgDateColumnBuilder {
  static [entityKind] = "PgTimestampStringBuilder";
  constructor(name3, withTimezone, precision) {
    super(name3, "string timestamp", "PgTimestampString");
    this.config.withTimezone = withTimezone;
    this.config.precision = precision;
  }
  /** @internal */
  build(table2) {
    return new PgTimestampString(table2, this.config);
  }
};
var PgTimestampString = class extends PgColumn {
  static [entityKind] = "PgTimestampString";
  /** @internal */
  codec;
  withTimezone;
  precision;
  constructor(table2, config) {
    super(table2, config);
    this.withTimezone = config.withTimezone;
    this.precision = config.precision;
    this.codec = this.withTimezone ? "timestamptz:string" : "timestamp:string";
  }
  getSQLType() {
    return `timestamp${this.precision === void 0 ? "" : `(${this.precision})`}${this.withTimezone ? " with time zone" : ""}`;
  }
  mapToDriverValue = (value3) => {
    if (typeof value3 === "string") return value3;
    return value3.toISOString();
  };
};
function timestamp2(a, b = {}) {
  const { name: name3, config } = getColumnNameAndConfig(a, b);
  if (config?.mode === "string") return new PgTimestampStringBuilder(name3, config.withTimezone ?? false, config.precision);
  return new PgTimestampBuilder(name3, config?.withTimezone ?? false, config?.precision);
}

// node_modules/.bun/drizzle-orm@1.0.0-rc.5-169397b+5a2a64b31368e2d8/node_modules/drizzle-orm/pg-core/columns/uuid.js
var PgUUIDBuilder = class extends PgColumnBuilder {
  static [entityKind] = "PgUUIDBuilder";
  constructor(name3) {
    super(name3, "string uuid", "PgUUID");
  }
  /**
  * Adds `default gen_random_uuid()` to the column definition.
  */
  defaultRandom() {
    return this.default(sql`gen_random_uuid()`);
  }
  /** @internal */
  build(table2) {
    return new PgUUID(table2, this.config);
  }
};
var PgUUID = class extends PgColumn {
  static [entityKind] = "PgUUID";
  /** @internal */
  codec = "uuid";
  getSQLType() {
    return "uuid";
  }
};
function uuid2(name3) {
  return new PgUUIDBuilder(name3 ?? "");
}

// node_modules/.bun/drizzle-orm@1.0.0-rc.5-169397b+5a2a64b31368e2d8/node_modules/drizzle-orm/pg-core/columns/varchar.js
var PgVarcharBuilder = class extends PgColumnBuilder {
  static [entityKind] = "PgVarcharBuilder";
  constructor(name3, config) {
    super(name3, config.enum?.length ? "string enum" : "string", "PgVarchar");
    this.config.length = config.length;
    this.config.enumValues = config.enum;
  }
  /** @internal */
  build(table2) {
    return new PgVarchar(table2, this.config);
  }
};
var PgVarchar = class extends PgColumn {
  static [entityKind] = "PgVarchar";
  /** @internal */
  codec = "varchar";
  enumValues;
  constructor(table2, config) {
    super(table2, config);
    this.enumValues = config.enumValues;
  }
  getSQLType() {
    return this.length === void 0 ? `varchar` : `varchar(${this.length})`;
  }
};
function varchar2(a, b = {}) {
  const { name: name3, config } = getColumnNameAndConfig(a, b);
  return new PgVarcharBuilder(name3, config);
}

// node_modules/.bun/drizzle-orm@1.0.0-rc.5-169397b+5a2a64b31368e2d8/node_modules/drizzle-orm/pg-core/columns/vector_extension/bit.js
var PgBinaryVectorBuilder = class extends PgColumnBuilder {
  static [entityKind] = "PgBinaryVectorBuilder";
  constructor(name3, config) {
    super(name3, "string binary", "PgBinaryVector");
    this.config.length = config.dimensions;
    this.config.isLengthExact = true;
  }
  /** @internal */
  build(table2) {
    return new PgBinaryVector(table2, this.config);
  }
};
var PgBinaryVector = class extends PgColumn {
  static [entityKind] = "PgBinaryVector";
  /** @internal */
  codec = "bit";
  getSQLType() {
    return `bit(${this.length})`;
  }
};
function bit(a, b) {
  const { name: name3, config } = getColumnNameAndConfig(a, b);
  return new PgBinaryVectorBuilder(name3, config);
}

// node_modules/.bun/drizzle-orm@1.0.0-rc.5-169397b+5a2a64b31368e2d8/node_modules/drizzle-orm/pg-core/columns/vector_extension/halfvec.js
var PgHalfVectorBuilder = class extends PgColumnBuilder {
  static [entityKind] = "PgHalfVectorBuilder";
  constructor(name3, config) {
    super(name3, "array halfvector", "PgHalfVector");
    this.config.length = config.dimensions;
    this.config.isLengthExact = true;
  }
  /** @internal */
  build(table2) {
    return new PgHalfVector(table2, this.config);
  }
};
var PgHalfVector = class extends PgColumn {
  static [entityKind] = "PgHalfVector";
  /** @internal */
  codec = "halfvec";
  getSQLType() {
    return `halfvec(${this.length})`;
  }
  mapToDriverValue = (value3) => {
    return JSON.stringify(value3);
  };
};
function halfvec(a, b) {
  const { name: name3, config } = getColumnNameAndConfig(a, b);
  return new PgHalfVectorBuilder(name3, config);
}

// node_modules/.bun/drizzle-orm@1.0.0-rc.5-169397b+5a2a64b31368e2d8/node_modules/drizzle-orm/pg-core/columns/vector_extension/sparsevec.js
var PgSparseVectorBuilder = class extends PgColumnBuilder {
  static [entityKind] = "PgSparseVectorBuilder";
  constructor(name3, config) {
    super(name3, "string sparsevec", "PgSparseVector");
    this.config.vectorDimensions = config.dimensions;
  }
  /** @internal */
  build(table2) {
    return new PgSparseVector(table2, this.config);
  }
};
var PgSparseVector = class extends PgColumn {
  static [entityKind] = "PgSparseVector";
  /** @internal */
  codec = "sparsevec";
  vectorDimensions = this.config.vectorDimensions;
  getSQLType() {
    return `sparsevec(${this.vectorDimensions})`;
  }
};
function sparsevec(a, b) {
  const { name: name3, config } = getColumnNameAndConfig(a, b);
  return new PgSparseVectorBuilder(name3, config);
}

// node_modules/.bun/drizzle-orm@1.0.0-rc.5-169397b+5a2a64b31368e2d8/node_modules/drizzle-orm/pg-core/columns/vector_extension/vector.js
var PgVectorBuilder = class extends PgColumnBuilder {
  static [entityKind] = "PgVectorBuilder";
  constructor(name3, config) {
    super(name3, "array vector", "PgVector");
    this.config.length = config.dimensions;
    this.config.isLengthExact = true;
  }
  /** @internal */
  build(table2) {
    return new PgVector(table2, this.config);
  }
};
var PgVector = class extends PgColumn {
  static [entityKind] = "PgVector";
  /** @internal */
  codec = "vector";
  getSQLType() {
    return `vector(${this.length})`;
  }
  mapToDriverValue = (value3) => {
    return JSON.stringify(value3);
  };
};
function vector(a, b) {
  const { name: name3, config } = getColumnNameAndConfig(a, b);
  return new PgVectorBuilder(name3, config);
}

// node_modules/.bun/drizzle-orm@1.0.0-rc.5-169397b+5a2a64b31368e2d8/node_modules/drizzle-orm/pg-core/columns/all.js
function getPgColumnBuilders() {
  return {
    bigint,
    bigserial,
    bytea: bytea2,
    boolean,
    char,
    cidr: cidr2,
    customType,
    date: date2,
    doublePrecision,
    inet: inet2,
    integer,
    interval,
    json: json2,
    jsonb: jsonb2,
    line,
    macaddr,
    macaddr8,
    numeric: numeric2,
    point,
    geometry,
    real,
    serial,
    smallint,
    smallserial,
    text: text2,
    time: time2,
    timestamp: timestamp2,
    uuid: uuid2,
    varchar: varchar2,
    bit,
    halfvec,
    sparsevec,
    vector
  };
}

// node_modules/.bun/drizzle-orm@1.0.0-rc.5-169397b+5a2a64b31368e2d8/node_modules/drizzle-orm/casing.js
function toSnakeCase(input) {
  return (input.replace(/['\u2019]/g, "").match(/[\da-z]+|[A-Z]+(?![a-z])|[A-Z][\da-z]+/g) ?? []).map((word) => word.toLowerCase()).join("_");
}
function toCamelCase(input) {
  return (input.replace(/['\u2019]/g, "").match(/[\da-z]+|[A-Z]+(?![a-z])|[A-Z][\da-z]+/g) ?? []).reduce((acc, word, i) => {
    return acc + (i === 0 ? word.toLowerCase() : `${word[0].toUpperCase()}${word.slice(1)}`);
  }, "");
}
function getCasingFn(casing) {
  if (casing === "snake_case") return toSnakeCase;
  if (casing === "camelCase") return toCamelCase;
  return (name3) => name3;
}

// node_modules/.bun/drizzle-orm@1.0.0-rc.5-169397b+5a2a64b31368e2d8/node_modules/drizzle-orm/pg-core/table.js
var InlineForeignKeys = Symbol.for("drizzle:PgInlineForeignKeys");
var EnableRLS = Symbol.for("drizzle:EnableRLS");
var PgTable = class extends Table {
  static [entityKind] = "PgTable";
  /** @internal */
  static Symbol = Object.assign({}, Table.Symbol, {
    InlineForeignKeys,
    EnableRLS
  });
  /**@internal */
  [InlineForeignKeys] = [];
  /** @internal */
  [EnableRLS] = false;
  /** @internal */
  [Table.Symbol.ExtraConfigBuilder] = void 0;
  /** @internal */
  [Table.Symbol.ExtraConfigColumns] = {};
};
function pgTableWithSchema(name3, columns, extraConfig, schema, casing, baseName = name3) {
  const casingFn = getCasingFn(casing);
  const rawTable = new PgTable(name3, schema, baseName);
  const parsedColumns = typeof columns === "function" ? columns(getPgColumnBuilders()) : columns;
  const builtColumns = Object.fromEntries(Object.entries(parsedColumns).map(([name4, colBuilderBase]) => {
    const colBuilder = colBuilderBase;
    colBuilder.setName(name4, casingFn);
    const column = colBuilder.build(rawTable).postBuild();
    rawTable[InlineForeignKeys].push(...colBuilder.buildForeignKeys(column, rawTable));
    return [name4, column];
  }));
  const builtColumnsForExtraConfig = Object.fromEntries(Object.entries(parsedColumns).map(([name4, colBuilderBase]) => {
    const colBuilder = colBuilderBase;
    colBuilder.setName(name4, casingFn);
    return [name4, colBuilder.buildExtraConfigColumn(rawTable)];
  }));
  const table2 = Object.assign(rawTable, builtColumns);
  table2[Table.Symbol.Columns] = builtColumns;
  table2[Table.Symbol.ExtraConfigColumns] = builtColumnsForExtraConfig;
  if (extraConfig) table2[PgTable.Symbol.ExtraConfigBuilder] = extraConfig;
  return Object.assign(table2, { enableRLS: () => {
    table2[PgTable.Symbol.EnableRLS] = true;
    return table2;
  } });
}
function pgTableWithCasing(casing) {
  const pgTableInternal = (name3, columns, extraConfig) => {
    return pgTableWithSchema(name3, columns, extraConfig, void 0, casing);
  };
  const pgTableWithRLS = (name3, columns, extraConfig) => {
    const table2 = pgTableWithSchema(name3, columns, extraConfig, void 0, casing);
    table2[EnableRLS] = true;
    return table2;
  };
  return Object.assign(pgTableInternal, { withRLS: pgTableWithRLS });
}
var pgTable = pgTableWithCasing(void 0);

// node_modules/.bun/drizzle-orm@1.0.0-rc.5-169397b+5a2a64b31368e2d8/node_modules/drizzle-orm/pg-core/utils.js
function extractUsedTable(table2) {
  if (is(table2, PgTable)) return [table2[TableSchema] ? `${table2[TableSchema]}.${table2[Table.Symbol.BaseName]}` : table2[Table.Symbol.BaseName]];
  if (is(table2, Subquery)) return table2._.usedTables ?? [];
  if (is(table2, SQL)) return table2.usedTables ?? [];
  return [];
}

// node_modules/.bun/drizzle-orm@1.0.0-rc.5-169397b+5a2a64b31368e2d8/node_modules/drizzle-orm/alias.js
var ColumnTableAliasProxyHandler = class {
  static [entityKind] = "ColumnTableAliasProxyHandler";
  constructor(table2, ignoreColumnAlias) {
    this.table = table2;
    this.ignoreColumnAlias = ignoreColumnAlias;
  }
  get(columnObj, prop) {
    if (prop === "table") return this.table;
    if (prop === "isAlias" && this.ignoreColumnAlias) return false;
    if (prop === OriginalColumn && !this.ignoreColumnAlias) return () => columnObj;
    return columnObj[prop];
  }
};
var ViewSelectionAliasProxyHandler = class {
  static [entityKind] = "ViewSelectionAliasProxyHandler";
  constructor(view2, selection, ignoreColumnAlias) {
    this.view = view2;
    this.selection = selection;
    this.ignoreColumnAlias = ignoreColumnAlias;
  }
  get(selection, prop) {
    const value3 = selection[prop];
    if (is(value3, Column)) return new Proxy(value3, new ColumnTableAliasProxyHandler(this.view, this.ignoreColumnAlias));
    if (is(value3, Subquery) || is(value3, SQL) || is(value3, SQL.Aliased) || isSQLWrapper(value3) || typeof value3 !== "object" || value3 === null) return value3;
    return new Proxy(value3, this);
  }
};
var TableAliasProxyHandler = class {
  static [entityKind] = "TableAliasProxyHandler";
  constructor(alias, replaceOriginalName, ignoreColumnAlias) {
    this.alias = alias;
    this.replaceOriginalName = replaceOriginalName;
    this.ignoreColumnAlias = ignoreColumnAlias;
  }
  get(target, prop) {
    if (prop === Table.Symbol.IsAlias) return true;
    if (prop === Table.Symbol.Name) return this.alias;
    if (this.replaceOriginalName && prop === Table.Symbol.OriginalName) return this.alias;
    if (prop === ViewBaseConfig) return {
      ...target[ViewBaseConfig],
      name: this.alias,
      isAlias: true,
      selectedFields: new Proxy(target[ViewBaseConfig].selectedFields, new ViewSelectionAliasProxyHandler(new Proxy(target, this), target[ViewBaseConfig].selectedFields, this.ignoreColumnAlias))
    };
    if (prop === Table.Symbol.Columns) {
      const columns = target[Table.Symbol.Columns];
      if (!columns) return columns;
      if (is(target, View)) return new Proxy(target[Table.Symbol.Columns], new ViewSelectionAliasProxyHandler(new Proxy(target, this), target[Table.Symbol.Columns], this.ignoreColumnAlias));
      const proxiedColumns = {};
      Object.keys(columns).map((key) => {
        proxiedColumns[key] = new Proxy(columns[key], new ColumnTableAliasProxyHandler(new Proxy(target, this), this.ignoreColumnAlias));
      });
      return proxiedColumns;
    }
    const value3 = target[prop];
    if (is(value3, Column)) return new Proxy(value3, new ColumnTableAliasProxyHandler(new Proxy(target, this), this.ignoreColumnAlias));
    return value3;
  }
};
var ColumnAliasProxyHandler = class {
  static [entityKind] = "ColumnAliasProxyHandler";
  constructor(alias) {
    this.alias = alias;
  }
  get(target, prop) {
    if (prop === "isAlias") return true;
    if (prop === "name") return this.alias;
    if (prop === "keyAsName") return false;
    if (prop === OriginalColumn) return () => target;
    return target[prop];
  }
};
var RelationTableAliasProxyHandler = class {
  static [entityKind] = "RelationTableAliasProxyHandler";
  constructor(alias) {
    this.alias = alias;
  }
  get(target, prop) {
    if (prop === "sourceTable") return aliasedTable(target.sourceTable, this.alias);
    return target[prop];
  }
};
function aliasedTable(table2, tableAlias) {
  return new Proxy(table2, new TableAliasProxyHandler(tableAlias, false, false));
}
function aliasedColumn(column, alias) {
  return new Proxy(column, new ColumnAliasProxyHandler(alias));
}
Column.prototype.as = function(alias) {
  return aliasedColumn(this, alias);
};
function getOriginalColumnFromAlias(column) {
  return column[OriginalColumn]();
}

// node_modules/.bun/drizzle-orm@1.0.0-rc.5-169397b+5a2a64b31368e2d8/node_modules/drizzle-orm/selection-proxy.js
var SelectionProxyHandler = class SelectionProxyHandler2 {
  static [entityKind] = "SelectionProxyHandler";
  config;
  constructor(config) {
    this.config = { ...config };
  }
  get(subquery, prop) {
    if (prop === "_") return {
      ...subquery["_"],
      selectedFields: new Proxy(subquery._.selectedFields, this)
    };
    if (prop === ViewBaseConfig) return {
      ...subquery[ViewBaseConfig],
      selectedFields: new Proxy(subquery[ViewBaseConfig].selectedFields, this)
    };
    if (typeof prop === "symbol") return subquery[prop];
    const value3 = (is(subquery, Subquery) ? subquery._.selectedFields : is(subquery, View) ? subquery[ViewBaseConfig].selectedFields : subquery)[prop];
    if (is(value3, SQL.Aliased)) {
      if (this.config.sqlAliasedBehavior === "sql" && !value3.isSelectionField) return value3.sql;
      const newValue = value3.clone();
      newValue.isSelectionField = true;
      newValue.origin = this.config.alias;
      return newValue;
    }
    if (is(value3, SQL)) {
      if (this.config.sqlBehavior === "sql") return value3;
      throw new Error(`You tried to reference "${prop}" field from a subquery, which is a raw SQL field, but it doesn't have an alias declared. Please add an alias to the field using ".as('alias')" method.`);
    }
    if (is(value3, Column)) {
      if (this.config.alias) return new Proxy(value3, new ColumnTableAliasProxyHandler(new Proxy(value3.table, new TableAliasProxyHandler(this.config.alias, this.config.replaceOriginalName ?? false, true)), true));
      return value3;
    }
    if (typeof value3 !== "object" || value3 === null) return value3;
    return new Proxy(value3, new SelectionProxyHandler2(this.config));
  }
};

// node_modules/.bun/drizzle-orm@1.0.0-rc.5-169397b+5a2a64b31368e2d8/node_modules/drizzle-orm/query-builders/query-builder.js
var TypedQueryBuilder = class {
  static [entityKind] = "TypedQueryBuilder";
  /** @internal */
  getSelectedFields() {
    return this._.selectedFields;
  }
  /** @internal */
  withoutSelectionCastCodecs() {
    return this;
  }
};

// node_modules/.bun/drizzle-orm@1.0.0-rc.5-169397b+5a2a64b31368e2d8/node_modules/drizzle-orm/pg-core/view-base.js
var PgViewBase = class extends View {
  static [entityKind] = "PgViewBase";
};

// node_modules/.bun/drizzle-orm@1.0.0-rc.5-169397b+5a2a64b31368e2d8/node_modules/drizzle-orm/pg-core/query-builders/select.js
var PgSelectBuilder = class {
  static [entityKind] = "PgSelectBuilder";
  fields;
  session;
  dialect;
  withList = [];
  distinct;
  tagged;
  constructor(config, builder = PgSelectBase) {
    this.builder = builder;
    this.fields = config.fields;
    this.session = config.session;
    this.dialect = config.dialect;
    if (config.withList) this.withList = config.withList;
    this.distinct = config.distinct;
  }
  /**
  * Specify the table, subquery, or other target that you're
  * building a select query against.
  *
  * {@link https://www.postgresql.org/docs/current/sql-select.html#SQL-FROM | Postgres from documentation}
  */
  from(source) {
    const isPartialSelect = !!this.fields;
    const src = source;
    let fields;
    if (this.fields) fields = this.fields;
    else if (is(src, Subquery)) fields = Object.fromEntries(Object.keys(src._.selectedFields).map((key) => [key, src[key]]));
    else if (is(src, PgViewBase)) fields = src[ViewBaseConfig].selectedFields;
    else if (is(src, SQL)) fields = {};
    else fields = getTableColumns(src);
    return new this.builder({
      table: src,
      fields,
      isPartialSelect,
      session: this.session,
      dialect: this.dialect,
      withList: this.withList,
      distinct: this.distinct
    });
  }
};
var PgSelectBase = class extends TypedQueryBuilder {
  static [entityKind] = "PgSelectQueryBuilder";
  _;
  config;
  joinsNotNullableMap;
  tableName;
  isPartialSelect;
  session;
  dialect;
  cacheConfig;
  usedTables = /* @__PURE__ */ new Set();
  constructor(config) {
    super();
    this.session = config.session;
    this.dialect = config.dialect;
    this.config = {
      withList: config.withList,
      table: config.table,
      fields: { ...config.fields },
      distinct: config.distinct,
      setOperators: []
    };
    this.isPartialSelect = config.isPartialSelect;
    this._ = {
      selectedFields: this.config.fields,
      config: this.config
    };
    this.tableName = getTableLikeName(config.table);
    this.joinsNotNullableMap = typeof this.tableName === "string" ? { [this.tableName]: true } : {};
    for (const item of extractUsedTable(config.table)) this.usedTables.add(item);
    this.config.withList?.forEach((it) => {
      const extracted = extractUsedTable(it);
      for (const el of extracted) this.usedTables.add(el);
    });
  }
  /** @internal */
  getUsedTables() {
    return [...this.usedTables];
  }
  createJoin(joinType, lateral) {
    return ((table2, on) => {
      const baseTableName = this.tableName;
      const tableName = getTableLikeName(table2);
      for (const item of extractUsedTable(table2)) this.usedTables.add(item);
      if (typeof tableName === "string" && this.config.joins?.some((join) => join.alias === tableName)) throw new Error(`Alias "${tableName}" is already used in this query`);
      if (!this.isPartialSelect) {
        if (Object.keys(this.joinsNotNullableMap).length === 1 && typeof baseTableName === "string") this.config.fields = { [baseTableName]: this.config.fields };
        if (typeof tableName === "string" && !is(table2, SQL)) {
          const selection = is(table2, Subquery) ? table2._.selectedFields : is(table2, View) ? table2[ViewBaseConfig].selectedFields : table2[Table.Symbol.Columns];
          this.config.fields[tableName] = selection;
        }
      }
      if (typeof on === "function") on = on(new Proxy(this.config.fields, new SelectionProxyHandler({
        sqlAliasedBehavior: "sql",
        sqlBehavior: "sql"
      })));
      if (!this.config.joins) this.config.joins = [];
      this.config.joins.push({
        on,
        table: table2,
        joinType,
        alias: tableName,
        lateral
      });
      if (typeof tableName === "string") switch (joinType) {
        case "left":
          this.joinsNotNullableMap[tableName] = false;
          break;
        case "right":
          this.joinsNotNullableMap = Object.fromEntries(Object.entries(this.joinsNotNullableMap).map(([key]) => [key, false]));
          this.joinsNotNullableMap[tableName] = true;
          break;
        case "cross":
        case "inner":
          this.joinsNotNullableMap[tableName] = true;
          break;
        case "full":
          this.joinsNotNullableMap = Object.fromEntries(Object.entries(this.joinsNotNullableMap).map(([key]) => [key, false]));
          this.joinsNotNullableMap[tableName] = false;
          break;
      }
      return this;
    });
  }
  /**
  * Executes a `left join` operation by adding another table to the current query.
  *
  * Calling this method associates each row of the table with the corresponding row from the joined table, if a match is found. If no matching row exists, it sets all columns of the joined table to null.
  *
  * See docs: {@link https://orm.drizzle.team/docs/joins#left-join}
  *
  * @param table the table to join.
  * @param on the `on` clause.
  *
  * @example
  *
  * ```ts
  * // Select all users and their pets
  * const usersWithPets: { user: User; pets: Pet | null; }[] = await db.select()
  *   .from(users)
  *   .leftJoin(pets, eq(users.id, pets.ownerId))
  *
  * // Select userId and petId
  * const usersIdsAndPetIds: { userId: number; petId: number | null; }[] = await db.select({
  *   userId: users.id,
  *   petId: pets.id,
  * })
  *   .from(users)
  *   .leftJoin(pets, eq(users.id, pets.ownerId))
  * ```
  */
  leftJoin = this.createJoin("left", false);
  /**
  * Executes a `left join lateral` operation by adding subquery to the current query.
  *
  * A `lateral` join allows the right-hand expression to refer to columns from the left-hand side.
  *
  * Calling this method associates each row of the table with the corresponding row from the joined table, if a match is found. If no matching row exists, it sets all columns of the joined table to null.
  *
  * See docs: {@link https://orm.drizzle.team/docs/joins#left-join-lateral}
  *
  * @param table the subquery to join.
  * @param on the `on` clause.
  *
  * @example
  *
  * ```ts
  * // Select every city and, for each, the users that live in it
  * const sq = db.select({ userId: users.id }).from(users).where(eq(users.cityId, cities.id)).as('sq');
  *
  * const rows: { cities: City; sq: { userId: number } | null }[] = await db.select()
  *   .from(cities)
  *   .leftJoinLateral(sq, sql`true`)
  * ```
  */
  leftJoinLateral = this.createJoin("left", true);
  /**
  * Executes a `right join` operation by adding another table to the current query.
  *
  * Calling this method associates each row of the joined table with the corresponding row from the main table, if a match is found. If no matching row exists, it sets all columns of the main table to null.
  *
  * See docs: {@link https://orm.drizzle.team/docs/joins#right-join}
  *
  * @param table the table to join.
  * @param on the `on` clause.
  *
  * @example
  *
  * ```ts
  * // Select all users and their pets
  * const usersWithPets: { user: User | null; pets: Pet; }[] = await db.select()
  *   .from(users)
  *   .rightJoin(pets, eq(users.id, pets.ownerId))
  *
  * // Select userId and petId
  * const usersIdsAndPetIds: { userId: number | null; petId: number; }[] = await db.select({
  *   userId: users.id,
  *   petId: pets.id,
  * })
  *   .from(users)
  *   .rightJoin(pets, eq(users.id, pets.ownerId))
  * ```
  */
  rightJoin = this.createJoin("right", false);
  /**
  * Executes an `inner join` operation, creating a new table by combining rows from two tables that have matching values.
  *
  * Calling this method retrieves rows that have corresponding entries in both joined tables. Rows without matching entries in either table are excluded, resulting in a table that includes only matching pairs.
  *
  * See docs: {@link https://orm.drizzle.team/docs/joins#inner-join}
  *
  * @param table the table to join.
  * @param on the `on` clause.
  *
  * @example
  *
  * ```ts
  * // Select all users and their pets
  * const usersWithPets: { user: User; pets: Pet; }[] = await db.select()
  *   .from(users)
  *   .innerJoin(pets, eq(users.id, pets.ownerId))
  *
  * // Select userId and petId
  * const usersIdsAndPetIds: { userId: number; petId: number; }[] = await db.select({
  *   userId: users.id,
  *   petId: pets.id,
  * })
  *   .from(users)
  *   .innerJoin(pets, eq(users.id, pets.ownerId))
  * ```
  */
  innerJoin = this.createJoin("inner", false);
  /**
  * Executes an `inner join lateral` operation, creating a new table by combining rows from two queries that have matching values.
  *
  * A `lateral` join allows the right-hand expression to refer to columns from the left-hand side.
  *
  * Calling this method retrieves rows that have corresponding entries in both joined tables. Rows without matching entries in either table are excluded, resulting in a table that includes only matching pairs.
  *
  * See docs: {@link https://orm.drizzle.team/docs/joins#inner-join-lateral}
  *
  * @param table the subquery to join.
  * @param on the `on` clause.
  *
  * @example
  *
  * ```ts
  * // Select only the cities that have users, along with those users
  * const sq = db.select({ userId: users.id }).from(users).where(eq(users.cityId, cities.id)).as('sq');
  *
  * const rows: { cities: City; sq: { userId: number } }[] = await db.select()
  *   .from(cities)
  *   .innerJoinLateral(sq, sql`true`)
  * ```
  */
  innerJoinLateral = this.createJoin("inner", true);
  /**
  * Executes a `full join` operation by combining rows from two tables into a new table.
  *
  * Calling this method retrieves all rows from both main and joined tables, merging rows with matching values and filling in `null` for non-matching columns.
  *
  * See docs: {@link https://orm.drizzle.team/docs/joins#full-join}
  *
  * @param table the table to join.
  * @param on the `on` clause.
  *
  * @example
  *
  * ```ts
  * // Select all users and their pets
  * const usersWithPets: { user: User | null; pets: Pet | null; }[] = await db.select()
  *   .from(users)
  *   .fullJoin(pets, eq(users.id, pets.ownerId))
  *
  * // Select userId and petId
  * const usersIdsAndPetIds: { userId: number | null; petId: number | null; }[] = await db.select({
  *   userId: users.id,
  *   petId: pets.id,
  * })
  *   .from(users)
  *   .fullJoin(pets, eq(users.id, pets.ownerId))
  * ```
  */
  fullJoin = this.createJoin("full", false);
  /**
  * Executes a `cross join` operation by combining rows from two tables into a new table.
  *
  * Calling this method retrieves all rows from both main and joined tables, merging all rows from each table.
  *
  * See docs: {@link https://orm.drizzle.team/docs/joins#cross-join}
  *
  * @param table the table to join.
  *
  * @example
  *
  * ```ts
  * // Select all users, each user with every pet
  * const usersWithPets: { user: User; pets: Pet; }[] = await db.select()
  *   .from(users)
  *   .crossJoin(pets)
  *
  * // Select userId and petId
  * const usersIdsAndPetIds: { userId: number; petId: number; }[] = await db.select({
  *   userId: users.id,
  *   petId: pets.id,
  * })
  *   .from(users)
  *   .crossJoin(pets)
  * ```
  */
  crossJoin = this.createJoin("cross", false);
  /**
  * Executes a `cross join lateral` operation by combining rows from two queries into a new table.
  *
  * A `lateral` join allows the right-hand expression to refer to columns from the left-hand side.
  *
  * Calling this method retrieves all rows from both main and joined queries, merging all rows from each query.
  *
  * See docs: {@link https://orm.drizzle.team/docs/joins#cross-join-lateral}
  *
  * @param table the query to join.
  *
  * @example
  *
  * ```ts
  * // Pair each city with every row its correlated subquery produces; cities with none are dropped
  * const sq = db.select({ userId: users.id }).from(users).where(eq(users.cityId, cities.id)).as('sq');
  *
  * const rows: { cities: City; sq: { userId: number } }[] = await db.select()
  *   .from(cities)
  *   .crossJoinLateral(sq)
  * ```
  */
  crossJoinLateral = this.createJoin("cross", true);
  createSetOperator(type, isAll) {
    return (rightSelection) => {
      const rightSelect = typeof rightSelection === "function" ? rightSelection(getPgSetOperators()) : rightSelection;
      if (!haveSameKeys(this.getSelectedFields(), rightSelect.getSelectedFields())) throw new Error("Set operator error (union / intersect / except): selected fields are not the same or are in a different order");
      this.config.setOperators.push({
        type,
        isAll,
        rightSelect
      });
      return this;
    };
  }
  /**
  * Adds `union` set operator to the query.
  *
  * Calling this method will combine the result sets of the `select` statements and remove any duplicate rows that appear across them.
  *
  * See docs: {@link https://orm.drizzle.team/docs/set-operations#union}
  *
  * @example
  *
  * ```ts
  * // Select all unique names from customers and users tables
  * await db.select({ name: users.name })
  *   .from(users)
  *   .union(
  *     db.select({ name: customers.name }).from(customers)
  *   );
  * // or
  * import { union } from 'drizzle-orm/pg-core'
  *
  * await union(
  *   db.select({ name: users.name }).from(users),
  *   db.select({ name: customers.name }).from(customers)
  * );
  * ```
  */
  union = this.createSetOperator("union", false);
  /**
  * Adds `union all` set operator to the query.
  *
  * Calling this method will combine the result-set of the `select` statements and keep all duplicate rows that appear across them.
  *
  * See docs: {@link https://orm.drizzle.team/docs/set-operations#union-all}
  *
  * @example
  *
  * ```ts
  * // Select all transaction ids from both online and in-store sales
  * await db.select({ transaction: onlineSales.transactionId })
  *   .from(onlineSales)
  *   .unionAll(
  *     db.select({ transaction: inStoreSales.transactionId }).from(inStoreSales)
  *   );
  * // or
  * import { unionAll } from 'drizzle-orm/pg-core'
  *
  * await unionAll(
  *   db.select({ transaction: onlineSales.transactionId }).from(onlineSales),
  *   db.select({ transaction: inStoreSales.transactionId }).from(inStoreSales)
  * );
  * ```
  */
  unionAll = this.createSetOperator("union", true);
  /**
  * Adds `intersect` set operator to the query.
  *
  * Calling this method will retain only the rows that are present in both result sets and eliminate duplicates.
  *
  * See docs: {@link https://orm.drizzle.team/docs/set-operations#intersect}
  *
  * @example
  *
  * ```ts
  * // Select course names that are offered in both departments A and B
  * await db.select({ courseName: depA.courseName })
  *   .from(depA)
  *   .intersect(
  *     db.select({ courseName: depB.courseName }).from(depB)
  *   );
  * // or
  * import { intersect } from 'drizzle-orm/pg-core'
  *
  * await intersect(
  *   db.select({ courseName: depA.courseName }).from(depA),
  *   db.select({ courseName: depB.courseName }).from(depB)
  * );
  * ```
  */
  intersect = this.createSetOperator("intersect", false);
  /**
  * Adds `intersect all` set operator to the query.
  *
  * Calling this method will retain only the rows that are present in both result sets including all duplicates.
  *
  * See docs: {@link https://orm.drizzle.team/docs/set-operations#intersect-all}
  *
  * @example
  *
  * ```ts
  * // Select all products and quantities that are ordered by both regular and VIP customers
  * await db.select({
  *   productId: regularCustomerOrders.productId,
  *   quantityOrdered: regularCustomerOrders.quantityOrdered
  * })
  * .from(regularCustomerOrders)
  * .intersectAll(
  *   db.select({
  *     productId: vipCustomerOrders.productId,
  *     quantityOrdered: vipCustomerOrders.quantityOrdered
  *   })
  *   .from(vipCustomerOrders)
  * );
  * // or
  * import { intersectAll } from 'drizzle-orm/pg-core'
  *
  * await intersectAll(
  *   db.select({
  *     productId: regularCustomerOrders.productId,
  *     quantityOrdered: regularCustomerOrders.quantityOrdered
  *   })
  *   .from(regularCustomerOrders),
  *   db.select({
  *     productId: vipCustomerOrders.productId,
  *     quantityOrdered: vipCustomerOrders.quantityOrdered
  *   })
  *   .from(vipCustomerOrders)
  * );
  * ```
  */
  intersectAll = this.createSetOperator("intersect", true);
  /**
  * Adds `except` set operator to the query.
  *
  * Calling this method will retrieve all unique rows from the left query, except for the rows that are present in the result set of the right query.
  *
  * See docs: {@link https://orm.drizzle.team/docs/set-operations#except}
  *
  * @example
  *
  * ```ts
  * // Select all courses offered in department A but not in department B
  * await db.select({ courseName: depA.courseName })
  *   .from(depA)
  *   .except(
  *     db.select({ courseName: depB.courseName }).from(depB)
  *   );
  * // or
  * import { except } from 'drizzle-orm/pg-core'
  *
  * await except(
  *   db.select({ courseName: depA.courseName }).from(depA),
  *   db.select({ courseName: depB.courseName }).from(depB)
  * );
  * ```
  */
  except = this.createSetOperator("except", false);
  /**
  * Adds `except all` set operator to the query.
  *
  * Calling this method will retrieve all rows from the left query, except for the rows that are present in the result set of the right query.
  *
  * See docs: {@link https://orm.drizzle.team/docs/set-operations#except-all}
  *
  * @example
  *
  * ```ts
  * // Select all products that are ordered by regular customers but not by VIP customers
  * await db.select({
  *   productId: regularCustomerOrders.productId,
  *   quantityOrdered: regularCustomerOrders.quantityOrdered,
  * })
  * .from(regularCustomerOrders)
  * .exceptAll(
  *   db.select({
  *     productId: vipCustomerOrders.productId,
  *     quantityOrdered: vipCustomerOrders.quantityOrdered,
  *   })
  *   .from(vipCustomerOrders)
  * );
  * // or
  * import { exceptAll } from 'drizzle-orm/pg-core'
  *
  * await exceptAll(
  *   db.select({
  *     productId: regularCustomerOrders.productId,
  *     quantityOrdered: regularCustomerOrders.quantityOrdered
  *   })
  *   .from(regularCustomerOrders),
  *   db.select({
  *     productId: vipCustomerOrders.productId,
  *     quantityOrdered: vipCustomerOrders.quantityOrdered
  *   })
  *   .from(vipCustomerOrders)
  * );
  * ```
  */
  exceptAll = this.createSetOperator("except", true);
  /** @internal */
  addSetOperators(setOperators) {
    this.config.setOperators.push(...setOperators);
    return this;
  }
  /**
  * Adds a `where` clause to the query.
  *
  * Calling this method will select only those rows that fulfill a specified condition.
  *
  * See docs: {@link https://orm.drizzle.team/docs/select#filtering}
  *
  * @param where the `where` clause.
  *
  * @example
  * You can use conditional operators and `sql function` to filter the rows to be selected.
  *
  * ```ts
  * // Select all cars with green color
  * await db.select().from(cars).where(eq(cars.color, 'green'));
  * // or
  * await db.select().from(cars).where(sql`${cars.color} = 'green'`)
  * ```
  *
  * You can logically combine conditional operators with `and()` and `or()` operators:
  *
  * ```ts
  * // Select all BMW cars with a green color
  * await db.select().from(cars).where(and(eq(cars.color, 'green'), eq(cars.brand, 'BMW')));
  *
  * // Select all cars with the green or blue color
  * await db.select().from(cars).where(or(eq(cars.color, 'green'), eq(cars.color, 'blue')));
  * ```
  */
  where(where) {
    if (typeof where === "function") where = where(new Proxy(this.config.fields, new SelectionProxyHandler({
      sqlAliasedBehavior: "sql",
      sqlBehavior: "sql"
    })));
    this.config.where = where;
    return this;
  }
  /**
  * Adds a `having` clause to the query.
  *
  * Calling this method will select only those rows that fulfill a specified condition. It is typically used with aggregate functions to filter the aggregated data based on a specified condition.
  *
  * See docs: {@link https://orm.drizzle.team/docs/select#aggregations}
  *
  * @param having the `having` clause.
  *
  * @example
  *
  * ```ts
  * // Select all brands with more than one car
  * await db.select({
  * 	brand: cars.brand,
  * 	count: sql<number>`cast(count(${cars.id}) as int)`,
  * })
  *   .from(cars)
  *   .groupBy(cars.brand)
  *   .having(({ count }) => gt(count, 1));
  * ```
  */
  having(having) {
    if (typeof having === "function") having = having(new Proxy(this.config.fields, new SelectionProxyHandler({
      sqlAliasedBehavior: "sql",
      sqlBehavior: "sql"
    })));
    this.config.having = having;
    return this;
  }
  groupBy(...columns) {
    if (typeof columns[0] === "function") {
      const groupBy = columns[0](new Proxy(this.config.fields, new SelectionProxyHandler({
        sqlAliasedBehavior: "alias",
        sqlBehavior: "sql"
      })));
      this.config.groupBy = Array.isArray(groupBy) ? groupBy : [groupBy];
    } else this.config.groupBy = columns;
    return this;
  }
  orderBy(...columns) {
    if (typeof columns[0] === "function") {
      const orderBy = columns[0](new Proxy(this.config.fields, new SelectionProxyHandler({
        sqlAliasedBehavior: "alias",
        sqlBehavior: "sql"
      })));
      const orderByArray = Array.isArray(orderBy) ? orderBy : [orderBy];
      if (this.config.setOperators.length > 0) this.config.setOperators.at(-1).orderBy = orderByArray;
      else this.config.orderBy = orderByArray;
    } else {
      const orderByArray = columns;
      if (this.config.setOperators.length > 0) this.config.setOperators.at(-1).orderBy = orderByArray;
      else this.config.orderBy = orderByArray;
    }
    return this;
  }
  /**
  * Adds a `limit` clause to the query.
  *
  * Calling this method will set the maximum number of rows that will be returned by this query.
  *
  * See docs: {@link https://orm.drizzle.team/docs/select#limit--offset}
  *
  * @param limit the `limit` clause.
  *
  * @example
  *
  * ```ts
  * // Get the first 10 people from this query.
  * await db.select().from(people).limit(10);
  * ```
  */
  limit(limit) {
    if (this.config.setOperators.length > 0) this.config.setOperators.at(-1).limit = limit;
    else this.config.limit = limit;
    return this;
  }
  /**
  * Adds an `offset` clause to the query.
  *
  * Calling this method will skip a number of rows when returning results from this query.
  *
  * See docs: {@link https://orm.drizzle.team/docs/select#limit--offset}
  *
  * @param offset the `offset` clause.
  *
  * @example
  *
  * ```ts
  * // Get the 10th-20th people from this query.
  * await db.select().from(people).offset(10).limit(10);
  * ```
  */
  offset(offset) {
    if (this.config.setOperators.length > 0) this.config.setOperators.at(-1).offset = offset;
    else this.config.offset = offset;
    return this;
  }
  /**
  * Adds a `for` clause to the query.
  *
  * Calling this method will specify a lock strength for this query that controls how strictly it acquires exclusive access to the rows being queried.
  *
  * See docs: {@link https://www.postgresql.org/docs/current/sql-select.html#SQL-FOR-UPDATE-SHARE}
  *
  * @param strength the lock strength.
  * @param config the lock configuration.
  */
  for(strength, config = {}) {
    this.config.lockingClause = {
      strength,
      config
    };
    return this;
  }
  /**
  * Attach [sqlcommenter](https://google.github.io/sqlcommenter) comment to a query
  */
  comment(comment) {
    this.config.comment = sql.comment(comment);
    return this;
  }
  /**
  * Resolve the ordered selection into `config`, and return the list the row mapper reads.
  *
  * Split out of `getSQL` because the driver's shape generator has to see the selection *before* the query is
  * built: whether a shape exists decides whether `buildSelection` emits the `cast` codecs.
  *
  * @internal
  */
  _resolveSelection() {
    const { config, dialect } = this;
    config.fieldsFlat ??= orderSelectedFields(config.fields, void 0, dialect.codecs);
    const { fieldsFlat, setOperators } = config;
    if (setOperators.length && !config.setFieldsFlat) {
      const setSelection = new Array(fieldsFlat.length);
      for (let i = 0; i < setOperators.length; ++i) {
        const setOperator = setOperators[i];
        if (!setOperator) throw new Error("Cannot pass undefined values to any set operator");
        const rightSelection = orderSelectedFields(setOperator.rightSelect.getSelectedFields());
        for (let j = 0; j < fieldsFlat.length; ++j) {
          setSelection[j] = { ...fieldsFlat[j] };
          const l = setSelection[j];
          const lPath = l.path.join(".");
          const r = rightSelection.find((e) => e.path.join(".") === lPath);
          const lc = l.codecOverride ?? l.column?.codec;
          const rc = r.codecOverride ?? r.column?.codec;
          setSelection[j].codecOverride = lc && rc ? unionsTypeTable[lc]?.[rc] : lc;
        }
      }
      for (let i = 0; i < setSelection.length; ++i) {
        const out = setSelection[i];
        out.codec = out.codecOverride ? dialect.codecs.get(out.column, "normalize", out.codecOverride) : out.codec;
      }
      config.setFieldsFlat = setSelection;
    }
    return config.setFieldsFlat ?? fieldsFlat;
  }
  getSQL() {
    this._resolveSelection();
    return this.dialect.buildSelectQuery(this.config);
  }
  toSQL() {
    return this.dialect.sqlToQuery(this.getSQL());
  }
  as(alias) {
    const usedTables = [];
    usedTables.push(...extractUsedTable(this.config.table));
    if (this.config.joins) for (const it of this.config.joins) usedTables.push(...extractUsedTable(it.table));
    return new Proxy(new Subquery(this.withoutSelectionCastCodecs().getSQL(), this.config.fields, alias, false, [...new Set(usedTables)]), new SelectionProxyHandler({
      alias,
      sqlAliasedBehavior: "alias",
      sqlBehavior: "error"
    }));
  }
  /** @internal */
  getSelectedFields() {
    return new Proxy(this.config.fields, new SelectionProxyHandler({
      alias: this.tableName,
      sqlAliasedBehavior: "alias",
      sqlBehavior: "error"
    }));
  }
  /** @internal */
  withoutSelectionCastCodecs() {
    this.config.ignoreSelectionCastCodecs = true;
    return this;
  }
  $dynamic() {
    return this;
  }
  $withCache(config) {
    this.cacheConfig = config === void 0 ? {
      config: {},
      enabled: true,
      autoInvalidate: true
    } : config === false ? { enabled: false } : {
      enabled: true,
      autoInvalidate: true,
      ...config
    };
    return this;
  }
};
function createSetOperator(type, isAll) {
  return (leftSelect, rightSelect, ...restSelects) => {
    const setOperators = [rightSelect, ...restSelects].map((select) => ({
      type,
      isAll,
      rightSelect: select
    }));
    for (const setOperator of setOperators) if (!haveSameKeys(leftSelect.getSelectedFields(), setOperator.rightSelect.getSelectedFields())) throw new Error("Set operator error (union / intersect / except): selected fields are not the same or are in a different order");
    return leftSelect.addSetOperators(setOperators);
  };
}
var getPgSetOperators = () => ({
  union,
  unionAll,
  intersect,
  intersectAll,
  except,
  exceptAll
});
var union = createSetOperator("union", false);
var unionAll = createSetOperator("union", true);
var intersect = createSetOperator("intersect", false);
var intersectAll = createSetOperator("intersect", true);
var except = createSetOperator("except", false);
var exceptAll = createSetOperator("except", true);

// node_modules/.bun/drizzle-orm@1.0.0-rc.5-169397b+5a2a64b31368e2d8/node_modules/drizzle-orm/errors.js
var DrizzleError = class extends Error {
  static [entityKind] = "DrizzleError";
  constructor({ message, cause }) {
    super(message);
    this.name = "DrizzleError";
    this.cause = cause;
  }
};
var DrizzleQueryError = class DrizzleQueryError2 extends Error {
  static [entityKind] = "DrizzleQueryError";
  constructor(query, params, cause) {
    super(`Failed query: ${query}
params: ${params}`);
    this.query = query;
    this.params = params;
    this.cause = cause;
    this.name = "DrizzleQueryError";
    Error.captureStackTrace(this, DrizzleQueryError2);
    if (cause) this.cause = cause;
  }
};
var TransactionRollbackError = class extends DrizzleError {
  static [entityKind] = "TransactionRollbackError";
  constructor() {
    super({ message: "Rollback" });
    this.name = "TransactionRollbackError";
  }
};

// node_modules/.bun/drizzle-orm@1.0.0-rc.5-169397b+5a2a64b31368e2d8/node_modules/drizzle-orm/sql/expressions/conditions.js
function bindIfParam(value3, column) {
  if (isDriverValueEncoder(column) && !isSQLWrapper(value3) && !is(value3, Param) && !is(value3, Placeholder) && !is(value3, Column) && !is(value3, Table) && !is(value3, View)) return new Param(value3, column);
  return value3;
}
var eq = (left, right) => {
  return sql`${left} = ${bindIfParam(right, left)}`;
};
var ne = (left, right) => {
  return sql`${left} <> ${bindIfParam(right, left)}`;
};
function and(...unfilteredConditions) {
  const conditions = unfilteredConditions.filter((c) => c !== void 0);
  if (conditions.length === 0) return;
  if (conditions.length === 1) return new SQL(conditions);
  return new SQL([
    new StringChunk("("),
    sql.join(conditions.map((c) => sql`(${c})`), new StringChunk(" and ")),
    new StringChunk(")")
  ]);
}
function or(...unfilteredConditions) {
  const conditions = unfilteredConditions.filter((c) => c !== void 0);
  if (conditions.length === 0) return;
  if (conditions.length === 1) return new SQL(conditions);
  return new SQL([
    new StringChunk("("),
    sql.join(conditions.map((c) => sql`(${c})`), new StringChunk(" or ")),
    new StringChunk(")")
  ]);
}
function not(condition) {
  if (!condition) return void 0;
  return is(condition, SQL) ? sql`not (${condition})` : sql`not ${condition}`;
}
var gt = (left, right) => {
  return sql`${left} > ${bindIfParam(right, left)}`;
};
var gte = (left, right) => {
  return sql`${left} >= ${bindIfParam(right, left)}`;
};
var lt = (left, right) => {
  return sql`${left} < ${bindIfParam(right, left)}`;
};
var lte = (left, right) => {
  return sql`${left} <= ${bindIfParam(right, left)}`;
};
function inArray(column, values) {
  if (Array.isArray(values)) {
    if (values.length === 0) return sql`1 = 0`;
    return sql`${column} in ${values.map((v) => bindIfParam(v, column))}`;
  }
  return sql`${column} in ${bindIfParam(values, column)}`;
}
function notInArray(column, values) {
  if (Array.isArray(values)) {
    if (values.length === 0) return sql`1 = 1`;
    return sql`${column} not in ${values.map((v) => bindIfParam(v, column))}`;
  }
  return sql`${column} not in ${bindIfParam(values, column)}`;
}
function isNull(value3) {
  return sql`(${value3} is null)`;
}
function isNotNull(value3) {
  return sql`(${value3} is not null)`;
}
function exists(subquery) {
  return sql`exists ${subquery}`;
}
function notExists(subquery) {
  return sql`not exists ${subquery}`;
}
function between(column, min, max) {
  return sql`${column} between ${bindIfParam(min, column)} and ${bindIfParam(max, column)}`;
}
function notBetween(column, min, max) {
  return sql`${column} not between ${bindIfParam(min, column)} and ${bindIfParam(max, column)}`;
}
function like(column, value3) {
  return sql`${column} like ${value3}`;
}
function notLike(column, value3) {
  return sql`${column} not like ${value3}`;
}
function ilike(column, value3) {
  return sql`${column} ilike ${value3}`;
}
function notIlike(column, value3) {
  return sql`${column} not ilike ${value3}`;
}
function arrayContains(column, values) {
  if (Array.isArray(values)) {
    if (values.length === 0) throw new Error("arrayContains requires at least one value");
    const par = bindIfParam(values, column);
    return sql`${column} @> ${sql`${Array.isArray(par) ? new Param(par) : par}`}`;
  }
  return sql`${column} @> ${bindIfParam(values, column)}`;
}
function arrayContained(column, values) {
  if (Array.isArray(values)) {
    if (values.length === 0) throw new Error("arrayContained requires at least one value");
    const par = bindIfParam(values, column);
    return sql`${column} <@ ${sql`${Array.isArray(par) ? new Param(par) : par}`}`;
  }
  return sql`${column} <@ ${bindIfParam(values, column)}`;
}
function arrayOverlaps(column, values) {
  if (Array.isArray(values)) {
    if (values.length === 0) throw new Error("arrayOverlaps requires at least one value");
    const par = bindIfParam(values, column);
    return sql`${column} && ${sql`${Array.isArray(par) ? new Param(par) : par}`}`;
  }
  return sql`${column} && ${bindIfParam(values, column)}`;
}

// node_modules/.bun/drizzle-orm@1.0.0-rc.5-169397b+5a2a64b31368e2d8/node_modules/drizzle-orm/sql/expressions/select.js
function asc(column) {
  return sql`${column} asc`;
}
function desc(column) {
  return sql`${column} desc`;
}

// node_modules/.bun/drizzle-orm@1.0.0-rc.5-169397b+5a2a64b31368e2d8/node_modules/drizzle-orm/relations.js
var Relation = class {
  static [entityKind] = "RelationV2";
  fieldName;
  sourceColumns;
  targetColumns;
  alias;
  where;
  sourceTable;
  targetTable;
  through;
  throughTable;
  isFilterReversed;
  /** @internal */
  sourceColumnTableNames = [];
  /** @internal */
  targetColumnTableNames = [];
  constructor(targetTable, targetTableName) {
    this.targetTableName = targetTableName;
    this.targetTable = targetTable;
  }
};
var One = class extends Relation {
  static [entityKind] = "OneV2";
  relationType = "one";
  optional;
  constructor(tables, targetTable, targetTableName, config) {
    super(targetTable, targetTableName);
    this.alias = config?.alias;
    if (config && "where" in config) {
      if (config.where === void 0) throw new Error(`Unexpected 'undefined' in filter value. Use 'EmptyFilter' if you want the filter field to be skipped.`);
      this.where = config.where;
    } else this.where = EmptyFilter;
    if (config?.from) this.sourceColumns = (Array.isArray(config.from) ? config.from : [config.from]).map((it) => {
      this.throughTable ??= it._.through ? tables[it._.through._.tableName] : void 0;
      this.sourceColumnTableNames.push(it._.tableName);
      return it._.column;
    });
    if (config?.to) this.targetColumns = (Array.isArray(config.to) ? config.to : [config.to]).map((it) => {
      this.throughTable ??= it._.through ? tables[it._.through._.tableName] : void 0;
      this.targetColumnTableNames.push(it._.tableName);
      return it._.column;
    });
    if (this.throughTable) this.through = {
      source: (Array.isArray(config?.from) ? config.from : config?.from ? [config.from] : []).map((c) => c._.through),
      target: (Array.isArray(config?.to) ? config.to : config?.to ? [config.to] : []).map((c) => c._.through)
    };
    this.optional = config?.optional ?? true;
  }
};
var Many = class extends Relation {
  static [entityKind] = "ManyV2";
  relationType = "many";
  constructor(tables, targetTable, targetTableName, config) {
    super(targetTable, targetTableName);
    this.config = config;
    this.alias = config?.alias;
    if (config && "where" in config) {
      if (config.where === void 0) throw new Error(`Unexpected 'undefined' in filter value. Use 'EmptyFilter' if you want the filter field to be skipped.`);
      this.where = config.where;
    } else this.where = EmptyFilter;
    if (config?.from) this.sourceColumns = (Array.isArray(config.from) ? config.from : [config.from]).map((it) => {
      this.throughTable ??= it._.through ? tables[it._.through._.tableName] : void 0;
      this.sourceColumnTableNames.push(it._.tableName);
      return it._.column;
    });
    if (config?.to) this.targetColumns = (Array.isArray(config.to) ? config.to : [config.to]).map((it) => {
      this.throughTable ??= it._.through ? tables[it._.through._.tableName] : void 0;
      this.targetColumnTableNames.push(it._.tableName);
      return it._.column;
    });
    if (this.throughTable) this.through = {
      source: (Array.isArray(config?.from) ? config.from : config?.from ? [config.from] : []).map((c) => c._.through),
      target: (Array.isArray(config?.to) ? config.to : config?.to ? [config.to] : []).map((c) => c._.through)
    };
  }
};
var AggregatedField = class {
  static [entityKind] = "AggregatedField";
  table;
  onTable(table2) {
    this.table = table2;
    return this;
  }
};
var Count = class extends AggregatedField {
  static [entityKind] = "AggregatedFieldCount";
  query;
  getSQL() {
    if (!this.query) {
      if (!this.table) throw new Error("Table must be set before building aggregate field");
      this.query = sql`select count(*) as ${sql.identifier("r")} from ${getTableAsAliasSQL(this.table)}`.mapWith(Number);
    }
    return this.query;
  }
};
var operators = {
  and,
  between,
  eq,
  exists,
  gt,
  gte,
  ilike,
  inArray,
  arrayContains,
  arrayContained,
  arrayOverlaps,
  isNull,
  isNotNull,
  like,
  lt,
  lte,
  ne,
  not,
  notBetween,
  notExists,
  notLike,
  notIlike,
  notInArray,
  or,
  sql
};
var orderByOperators = {
  sql,
  asc,
  desc
};
function mapRelationalRow(rows, isOne, buildQueryResultSelection, parseJson = false, parseJsonIfString = false, useJsonMappers = true) {
  const maxIdx = isOne ? 1 : rows.length;
  const decoders = buildQueryResultSelection.map(({ field, fieldType, codec, arrayDimensions }) => {
    let decoder;
    switch (fieldType) {
      case "Column":
        decoder = field;
        break;
      case "SQL":
        decoder = field.decoder;
        break;
      case "SQL.Aliased":
        decoder = field.sql.decoder;
        break;
      case "Nested":
        decoder = noopDecoder;
        break;
      default:
        decoder = field.getSQL().decoder;
    }
    if (useJsonMappers && field.mapFromJsonValue) return (v) => field.mapFromJsonValue(v);
    return decoder.mapFromDriverValue.isNoop ? codec ? (value3) => codec(value3, arrayDimensions) : void 0 : codec ? (value3) => decoder.mapFromDriverValue(codec(value3, arrayDimensions)) : (value3) => decoder.mapFromDriverValue(value3);
  });
  for (let i = 0; i < maxIdx; ++i) {
    const row = isOne ? rows : rows[i];
    for (let selectionItemIdx = 0; selectionItemIdx < buildQueryResultSelection.length; ++selectionItemIdx) {
      const selectionItem = buildQueryResultSelection[selectionItemIdx];
      if (selectionItem.selection) {
        if (row[selectionItem.key] === null) continue;
        if (parseJson) {
          row[selectionItem.key] = JSON.parse(row[selectionItem.key]);
          if (row[selectionItem.key] === null) continue;
        } else if (parseJsonIfString && typeof row[selectionItem.key] === "string") row[selectionItem.key] = JSON.parse(row[selectionItem.key]);
        if (selectionItem.isArray) {
          mapRelationalRow(row[selectionItem.key], false, selectionItem.selection, false, parseJsonIfString);
          continue;
        }
        mapRelationalRow(row[selectionItem.key], true, selectionItem.selection, false, parseJsonIfString);
        continue;
      }
      if (row[selectionItem.key] === null) continue;
      const decoder = decoders[selectionItemIdx];
      if (!decoder) continue;
      row[selectionItem.key] = decoder(row[selectionItem.key]);
    }
  }
  return rows;
}
function mapRelationalRowFromArrays(rows, isOne, buildQueryResultSelection, parseJson = false, parseJsonIfString = false) {
  const maxIdx = isOne ? 1 : rows.length;
  const decoders = buildQueryResultSelection.map(({ field, fieldType, codec, arrayDimensions }) => {
    let decoder;
    switch (fieldType) {
      case "Column":
        decoder = field;
        break;
      case "SQL":
        decoder = field.decoder;
        break;
      case "SQL.Aliased":
        decoder = field.sql.decoder;
        break;
      case "Nested":
        decoder = noopDecoder;
        break;
      default:
        decoder = field.getSQL().decoder;
    }
    return decoder.mapFromDriverValue.isNoop ? codec ? (value3) => codec(value3, arrayDimensions) : void 0 : codec ? (value3) => decoder.mapFromDriverValue(codec(value3, arrayDimensions)) : (value3) => decoder.mapFromDriverValue(value3);
  });
  const results = new Array(maxIdx);
  for (let i = 0; i < maxIdx; ++i) {
    const row = isOne ? rows : rows[i];
    const result3 = {};
    for (let selectionItemIdx = 0; selectionItemIdx < buildQueryResultSelection.length; ++selectionItemIdx) {
      const selectionItem = buildQueryResultSelection[selectionItemIdx];
      let value3 = row[selectionItemIdx];
      if (selectionItem.selection) {
        if (value3 === null) {
          result3[selectionItem.key] = null;
          continue;
        }
        if (parseJson) {
          value3 = JSON.parse(value3);
          if (value3 === null) {
            result3[selectionItem.key] = null;
            continue;
          }
        } else if (parseJsonIfString && typeof value3 === "string") value3 = JSON.parse(value3);
        if (selectionItem.isArray) mapRelationalRow(value3, false, selectionItem.selection, false, parseJsonIfString);
        else mapRelationalRow(value3, true, selectionItem.selection, false, parseJsonIfString);
        result3[selectionItem.key] = value3;
        continue;
      }
      if (value3 === null) {
        result3[selectionItem.key] = null;
        continue;
      }
      const decoder = decoders[selectionItemIdx];
      result3[selectionItem.key] = decoder ? decoder(value3) : value3;
    }
    results[i] = result3;
  }
  return isOne ? results[0] : results;
}
function makeDefaultRqbMapper({ selection, isFirst, parseJson, parseJsonIfString, rootJsonMappers, arrayModeRoot }) {
  return ((rows) => {
    if (isFirst && !rows[0]) return rows[0];
    return arrayModeRoot ? mapRelationalRowFromArrays(isFirst ? rows[0] : rows, isFirst, selection, parseJson, parseJsonIfString) : mapRelationalRow(isFirst ? rows[0] : rows, isFirst, selection, parseJson, parseJsonIfString, rootJsonMappers);
  });
}
function makeJitRqbMapperInner(selection, rowExpr, selectionVar, parseJson, parseJsonIfString, useJsonMappers, preFn, counter, accessByIdx) {
  const bodyStmts = [];
  const literalEntries = [];
  let hasWork = false;
  const fieldVars = selection.map(() => `c${counter.n++}`);
  const destructurePieces = selection.map((item, idx) => accessByIdx ? fieldVars[idx] : `${JSON.stringify(item.key)}: ${fieldVars[idx]}`);
  bodyStmts.push(accessByIdx ? `let [ ${destructurePieces.join(", ")} ] = ${rowExpr};` : `let { ${destructurePieces.join(", ")} } = ${rowExpr};`);
  for (const [idx, { field, fieldType, key, codec, isArray, selection: innerSelection, arrayDimensions }] of selection.entries()) {
    const sel = `${selectionVar}[${idx}]`;
    const keyStr = JSON.stringify(key);
    const slot = fieldVars[idx];
    if (innerSelection) {
      if (parseJson) {
        bodyStmts.push(`if (${slot} !== null) ${slot} = JSON.parse(${slot});`);
        hasWork = true;
      } else if (parseJsonIfString) {
        bodyStmts.push(`if (typeof ${slot} === 'string') ${slot} = JSON.parse(${slot});`);
        hasWork = true;
      }
      const nestedSelVar = `s${counter.n++}`;
      const savedPreFnLen = preFn.length;
      preFn.push(`const { selection: ${nestedSelVar} } = ${sel};`);
      if (isArray) {
        const j = `j${counter.n++}`;
        const inner = makeJitRqbMapperInner(innerSelection, `${slot}[${j}]`, nestedSelVar, false, parseJsonIfString, true, preFn, counter, false);
        if (inner.hasWork) {
          hasWork = true;
          bodyStmts.push(`if (${slot} !== null) {`);
          bodyStmts.push(`	for (let ${j} = 0; ${j} < ${slot}.length; ++${j}) {`);
          for (const s of inner.bodyStmts) bodyStmts.push(`		${s}`);
          bodyStmts.push(`		${slot}[${j}] = ${inner.literal};`);
          bodyStmts.push(`	}`);
          bodyStmts.push(`}`);
        } else preFn.splice(savedPreFnLen, 1);
      } else {
        const inner = makeJitRqbMapperInner(innerSelection, slot, nestedSelVar, false, parseJsonIfString, true, preFn, counter, false);
        if (inner.hasWork) {
          hasWork = true;
          bodyStmts.push(`if (${slot} !== null) {`);
          for (const s of inner.bodyStmts) bodyStmts.push(`	${s}`);
          bodyStmts.push(`	${slot} = ${inner.literal};`);
          bodyStmts.push(`}`);
        } else preFn.splice(savedPreFnLen, 1);
      }
      literalEntries.push(`${keyStr}: ${slot}`);
      continue;
    }
    let decoderExpr = "";
    let destructure = "";
    let bypassCodecs = false;
    switch (fieldType) {
      case "Column":
        if (useJsonMappers && field.mapFromJsonValue) {
          bypassCodecs = true;
          const id = counter.n++;
          destructure = `field: dec${id}`;
          decoderExpr = `dec${id}.mapFromJsonValue`;
        } else if (!field.mapFromDriverValue.isNoop) {
          const id = counter.n++;
          destructure = `field: dec${id}`;
          decoderExpr = `dec${id}.mapFromDriverValue`;
        }
        break;
      case "SQL":
        if (useJsonMappers && field.decoder.mapFromJsonValue) {
          bypassCodecs = true;
          const id = counter.n++;
          destructure = `field: { decoder: dec${id} }`;
          decoderExpr = `dec${id}.mapFromJsonValue`;
        } else if (!field.decoder.mapFromDriverValue.isNoop) {
          const id = counter.n++;
          destructure = `field: { decoder: dec${id} }`;
          decoderExpr = `dec${id}.mapFromDriverValue`;
        }
        break;
      case "SQL.Aliased":
        if (useJsonMappers && field.sql.decoder.mapFromJsonValue) {
          bypassCodecs = true;
          const id = counter.n++;
          destructure = `field: { sql: { decoder: dec${id} } }`;
          decoderExpr = `dec${id}.mapFromJsonValue`;
        } else if (!field.sql.decoder.mapFromDriverValue.isNoop) {
          const id = counter.n++;
          destructure = `field: { sql: { decoder: dec${id} } }`;
          decoderExpr = `dec${id}.mapFromDriverValue`;
        }
        break;
      case "Nested":
        break;
      default: {
        const sqlExpr = field.getSQL();
        if (useJsonMappers && sqlExpr.decoder.mapFromJsonValue) {
          bypassCodecs = true;
          const id = counter.n++;
          preFn.push(`const dec${id} = ${sel}.field.getSQL().decoder;`);
          decoderExpr = `dec${id}.mapFromJsonValue`;
        } else if (!sqlExpr.decoder.mapFromDriverValue.isNoop) {
          const id = counter.n++;
          preFn.push(`const dec${id} = ${sel}.field.getSQL().decoder;`);
          decoderExpr = `dec${id}.mapFromDriverValue`;
        }
      }
    }
    let codecVar = "";
    if (!bypassCodecs && codec) codecVar = `codec${counter.n++}`;
    if (destructure || codecVar) {
      const parts = [];
      if (destructure) parts.push(destructure);
      if (codecVar) parts.push(`codec: ${codecVar}`);
      preFn.push(`const { ${parts.join(", ")} } = ${sel};`);
    }
    if (decoderExpr || codecVar) {
      hasWork = true;
      let decoded = slot;
      if (codecVar) decoded = `${codecVar}(${decoded}, ${arrayDimensions})`;
      if (decoderExpr) decoded = `${decoderExpr}(${decoded})`;
      literalEntries.push(`${keyStr}: ${slot} === null ? null : ${decoded}`);
    } else literalEntries.push(`${keyStr}: ${slot}`);
  }
  return {
    bodyStmts,
    literal: `{ ${literalEntries.join(", ")} }`,
    hasWork
  };
}
function makeJitRqbMapper({ selection, isFirst, parseJson, parseJsonIfString, rootJsonMappers, arrayModeRoot }) {
  const preFn = [];
  const inner = makeJitRqbMapperInner(selection, "row", "selection", parseJson, parseJsonIfString, arrayModeRoot ? false : rootJsonMappers, preFn, { n: 0 }, !!arrayModeRoot);
  const lines = [];
  lines.push(`	"use strict";
	const { selection } = this;`);
  for (const p of preFn) lines.push(`	${p}`);
  if (arrayModeRoot) if (isFirst) {
    lines.push(`	const row = rows[0];`);
    lines.push(`	if (!row) return undefined;`);
    for (const s of inner.bodyStmts) lines.push(`	${s}`);
    lines.push(`	return ${inner.literal};`);
  } else {
    lines.push(`	const { length } = rows;`);
    lines.push(`	const mapped = new Array(length);`);
    lines.push(`	for (let i = 0; i < length; ++i) {`);
    lines.push(`		const row = rows[i];`);
    for (const s of inner.bodyStmts) lines.push(`		${s}`);
    lines.push(`		mapped[i] = ${inner.literal};`);
    lines.push(`	}`);
    lines.push(`	return mapped;`);
  }
  else if (!inner.hasWork) lines.push(isFirst ? `	return rows[0];` : `	return rows;`);
  else if (isFirst) {
    lines.push(`	const row = rows[0];`);
    lines.push(`	if (!row) return undefined;`);
    for (const s of inner.bodyStmts) lines.push(`	${s}`);
    lines.push(`	rows[0] = ${inner.literal};`);
    lines.push(`	return rows[0];`);
  } else {
    lines.push(`	for (let i = 0; i < rows.length; ++i) {`);
    lines.push(`		const row = rows[i];`);
    for (const s of inner.bodyStmts) lines.push(`		${s}`);
    lines.push(`		rows[i] = ${inner.literal};`);
    lines.push(`	}`);
    lines.push(`	return rows;`);
  }
  lines.push("	//# sourceURL=drizzle:jit-relational-query-mapper");
  const compiled = lines.join("\n");
  return Object.assign(new FnConstructor("rows", compiled).bind({ selection }), { body: `function jitRqbMapper (rows) {
${compiled}
}` });
}
var RelationsBuilderTable = class {
  static [entityKind] = "RelationsBuilderTable";
  _;
  constructor(table2, name3) {
    this._ = {
      name: name3,
      table: table2
    };
  }
};
var RelationsBuilderColumn = class {
  static [entityKind] = "RelationsBuilderColumn";
  _;
  constructor(column, tableName, key) {
    this._ = {
      tableName,
      column,
      key
    };
  }
  through(column) {
    return new RelationsBuilderJunctionColumn(this._.column, this._.tableName, this._.key, column);
  }
};
var RelationsBuilderJunctionColumn = class {
  static [entityKind] = "RelationsBuilderColumn";
  _;
  constructor(column, tableName, key, through) {
    this._ = {
      tableName,
      column,
      through,
      key
    };
  }
};
var RelationsHelperStatic = class {
  static [entityKind] = "RelationsHelperStatic";
  constructor(tables) {
    const one = {};
    const many = {};
    for (const [tableName, table2] of Object.entries(tables)) {
      one[tableName] = (config) => {
        return new One(tables, table2, tableName, config);
      };
      many[tableName] = (config) => {
        return new Many(tables, table2, tableName, config);
      };
    }
    this.one = one;
    this.many = many;
  }
  one;
  many;
  /** @internal - to be reworked */
  aggs = { count() {
    return new Count();
  } };
};
function fieldSelectionToSQL(table2, target) {
  const field = table2[TableColumns][target];
  return field ? is(field, Column) ? field : is(field, SQL.Aliased) ? sql`${table2}.${sql.identifier(field.fieldAlias)}` : sql`${table2}.${sql.identifier(target)}` : sql`${table2}.${sql.identifier(target)}`;
}
function relationsFieldFilterToSQL(column, filter) {
  if (filter === EmptyFilter) return void 0;
  if (filter === void 0) throw new Error(`Unexpected 'undefined' in filter value. Use 'EmptyFilter' if you want the filter field to be skipped.`);
  if (typeof filter !== "object" || is(filter, Placeholder)) return eq(column, filter);
  const entries = Object.entries(filter);
  if (!entries.length) return void 0;
  const parts = [];
  for (const [target, value3] of entries) {
    if (value3 === EmptyFilter) continue;
    if (value3 === void 0) throw new Error(`Unexpected 'undefined' in filter value. Use 'EmptyFilter' if you want the filter field to be skipped.`);
    switch (target) {
      case "NOT": {
        const res = relationsFieldFilterToSQL(column, value3);
        if (!res) continue;
        parts.push(not(res));
        continue;
      }
      case "OR":
        if (!value3.length) throw new Error("Unexpected empty array in filters' 'OR' section. Omit field or use 'EmptyFilter' if you want filter to be skipped.");
        parts.push(or(...value3.map((subFilter) => relationsFieldFilterToSQL(column, subFilter))));
        continue;
      case "AND":
        if (!value3.length) throw new Error("Unexpected empty array in filters' 'AND' section. Omit field or use 'EmptyFilter' if you want filter to be skipped.");
        parts.push(and(...value3.map((subFilter) => relationsFieldFilterToSQL(column, subFilter))));
        continue;
      case "isNotNull":
      case "isNull":
        if (!value3) continue;
        parts.push(operators[target](column));
        continue;
      case "in":
        parts.push(operators.inArray(column, value3));
        continue;
      case "notIn":
        parts.push(operators.notInArray(column, value3));
        continue;
      default:
        parts.push(operators[target](column, value3));
        continue;
    }
  }
  if (!parts.length) return void 0;
  return and(...parts);
}
function relationsFilterToSQL(table2, filter, tableRelations = {}, tablesRelations = {}, depth = 0) {
  if (filter === EmptyFilter) return void 0;
  if (filter === void 0) throw new Error(`Unexpected 'undefined' in filter value. Use 'EmptyFilter' if you want the filter field to be skipped.`);
  const entries = Object.entries(filter);
  if (!entries.length) return void 0;
  const parts = [];
  for (const [target, value3] of entries) {
    if (value3 === EmptyFilter) continue;
    if (value3 === void 0) throw new Error(`Unexpected 'undefined' in filter value. Use 'EmptyFilter' if you want the filter field to be skipped.`);
    switch (target) {
      case "RAW": {
        const processed = typeof value3 === "function" ? value3(table2, operators) : value3.getSQL();
        if (processed === EmptyFilter) continue;
        parts.push(processed);
        continue;
      }
      case "OR":
        if (!value3.length) throw new Error("Unexpected empty array in filters' 'OR' section. Omit field or use 'EmptyFilter' if you want filter to be skipped.");
        parts.push(or(...value3.map((subFilter) => relationsFilterToSQL(table2, subFilter, tableRelations, tablesRelations, depth))));
        continue;
      case "AND":
        if (!value3.length) throw new Error("Unexpected empty array in filters' 'AND' section. Omit field or use 'EmptyFilter' if you want filter to be skipped.");
        parts.push(and(...value3.map((subFilter) => relationsFilterToSQL(table2, subFilter, tableRelations, tablesRelations, depth))));
        continue;
      case "NOT": {
        const built = relationsFilterToSQL(table2, value3, tableRelations, tablesRelations, depth);
        if (!built) continue;
        parts.push(not(built));
        continue;
      }
      default: {
        if (Object.prototype.hasOwnProperty.call(table2[TableColumns], target) && table2[TableColumns][target]) {
          const colFilter = relationsFieldFilterToSQL(fieldSelectionToSQL(table2, target), value3);
          if (colFilter) parts.push(colFilter);
          continue;
        }
        const relation = Object.prototype.hasOwnProperty.call(tableRelations, target) ? tableRelations[target] : void 0;
        if (!relation) throw new DrizzleError({ message: `Unknown relational filter field: "${target}"` });
        const targetTable = aliasedTable(relation.targetTable, `f${depth}`);
        const throughTable = relation.throughTable ? aliasedTable(relation.throughTable, `ft${depth}`) : void 0;
        const targetConfig = tablesRelations[relation.targetTableName];
        const { filter: relationFilter, joinCondition } = relationToSQL(relation, table2, targetTable, throughTable);
        const filter2 = and(relationFilter, typeof value3 === "boolean" ? void 0 : relationsFilterToSQL(targetTable, value3, targetConfig.relations, tablesRelations, depth + 1));
        const subquery = throughTable ? sql`(select * from ${getTableAsAliasSQL(targetTable)} inner join ${getTableAsAliasSQL(throughTable)} on ${joinCondition}${sql` where ${filter2}`.if(filter2)} limit 1)` : sql`(select * from ${getTableAsAliasSQL(targetTable)}${sql` where ${filter2}`.if(filter2)} limit 1)`;
        if (filter2) parts.push((value3 ? exists : notExists)(subquery));
      }
    }
  }
  return and(...parts);
}
function relationsOrderToSQL(table2, orders) {
  if (typeof orders === "function") {
    const data = orders(table2, orderByOperators);
    if (!data) return void 0;
    return is(data, SQL) ? data : Array.isArray(data) ? data.length ? sql.join(data.map((o) => is(o, SQL) ? o : asc(o)), new StringChunk(`, `)) : void 0 : is(data, Column) ? asc(data) : void 0;
  }
  const entries = Object.entries(orders).filter(([_, value3]) => value3);
  if (!entries.length) return void 0;
  return sql.join(entries.map(([target, value3]) => (value3 === "asc" ? asc : desc)(fieldSelectionToSQL(table2, target))), new StringChunk(`, `));
}
function relationExtrasToSQL(table2, extras, codecs2, inJson) {
  const subqueries = [];
  const selection = [];
  for (const [key, field] of Object.entries(extras)) {
    const extra = typeof field === "function" ? field(table2, { sql: operators.sql }) : field;
    if (!extra) continue;
    const subq = extra.getSQL();
    const column = codecs2 ? getColumnFromDecoder(subq) : void 0;
    const query = column && (!inJson || !column.jsonSelectIdentifier) ? sql`${codecs2.apply(column, inJson ? "castInJson" : "cast", sql`(${subq})`)} as ${sql.identifier(key)}` : sql`(${subq}) as ${sql.identifier(key)}`;
    query.decoder = subq.decoder;
    subqueries.push(query);
    selection.push(column && (!inJson || !column.mapFromJsonValue) ? {
      key,
      field: query,
      fieldType: "SQL",
      codec: codecs2.get(column, inJson ? "normalizeInJson" : "normalize"),
      arrayDimensions: column.dimensions
    } : {
      key,
      field: query,
      fieldType: "SQL"
    });
  }
  return {
    sql: subqueries.length ? sql.join(subqueries, new StringChunk(`, `)) : void 0,
    selection
  };
}
function relationToSQL(relation, sourceTable, targetTable, throughTable) {
  if (relation.through) {
    const outerColumnWhere = relation.sourceColumns.map((s, i) => {
      const t = relation.through.source[i];
      return eq(sql`${sourceTable}.${sql.identifier(s.name)}`, sql`${throughTable}.${sql.identifier(is(t._.column, Column) ? t._.column.name : t._.key)}`);
    });
    const innerColumnWhere = relation.targetColumns.map((s, i) => {
      const t = relation.through.target[i];
      return eq(sql`${throughTable}.${sql.identifier(is(t._.column, Column) ? t._.column.name : t._.key)}`, sql`${targetTable}.${sql.identifier(s.name)}`);
    });
    return {
      filter: and(relationsFilterToSQL(relation.isFilterReversed ? sourceTable : targetTable, relation.where), ...outerColumnWhere),
      joinCondition: and(...innerColumnWhere)
    };
  }
  return { filter: and(...relation.sourceColumns.map((s, i) => {
    const t = relation.targetColumns[i];
    return eq(sql`${sourceTable}.${sql.identifier(s.name)}`, sql`${targetTable}.${sql.identifier(t.name)}`);
  }), relationsFilterToSQL(relation.isFilterReversed ? sourceTable : targetTable, relation.where)) };
}
function getTableAsAliasSQL(table2) {
  return sql`${table2[IsAlias] ? sql`${sql`${sql.identifier(table2[TableSchema] ?? "")}.`.if(table2[TableSchema])}${sql.identifier(table2[OriginalName])} as ${table2}` : table2}`;
}
var EmptyFilter = Symbol.for("drizzle:EmptyFilter");

// node_modules/.bun/drizzle-orm@1.0.0-rc.5-169397b+5a2a64b31368e2d8/node_modules/drizzle-orm/pg-core/dialect.js
var PgDialect = class {
  static [entityKind] = "PgDialect";
  codecs;
  mapperGenerators;
  shapeGenerator;
  constructor(config) {
    this.codecs = new CodecsCollection(resolvePgTypeAlias, config?.codecs);
    this.shapeGenerator = config?.shapeGenerator;
    this.mapperGenerators = config?.useJitMappers ? {
      rows: makeJitQueryMapper,
      relationalRows: makeJitRqbMapper
    } : {
      rows: makeDefaultQueryMapper,
      relationalRows: makeDefaultRqbMapper
    };
  }
  escapeName(name3) {
    return `"${name3.replace(/"/g, '""')}"`;
  }
  escapeParam(num) {
    return `$${num + 1}`;
  }
  escapeString(str) {
    return `'${str.replace(/'/g, "''")}'`;
  }
  buildWithCTE(queries) {
    if (!queries?.length) return void 0;
    const queriesLen = queries.length;
    const withSqlChunks = new Array(queriesLen + 1);
    let writeIdx = 0;
    withSqlChunks[writeIdx++] = new StringChunk("with ");
    for (let i = 0; i < queriesLen; ++i) {
      const w = queries[i];
      withSqlChunks[writeIdx++] = i < queriesLen - 1 ? sql`${sql.identifier(w._.alias)} as (${w._.sql}), ` : sql`${sql.identifier(w._.alias)} as (${w._.sql}) `;
    }
    return new SQL(withSqlChunks);
  }
  buildDeleteQuery({ table: table2, where, returning, withList, comment, ignoreSelectionCastCodecs }) {
    const withSql = this.buildWithCTE(withList);
    const returningSql = returning ? sql` returning ${this.buildSelection(returning, {
      isSingleTable: true,
      ignoreCastCodecs: ignoreSelectionCastCodecs,
      table: table2
    })}` : void 0;
    return sql`${withSql}delete from ${table2}${where ? sql` where ${where}` : void 0}${returningSql}${comment !== void 0 ? sql` ${comment}` : void 0}`;
  }
  buildUpdateSet(table2, set) {
    const tableColumns = table2[Table.Symbol.Columns];
    const columnNames = Object.keys(tableColumns).filter((colName) => set[colName] !== void 0 || tableColumns[colName]?.onUpdateFn !== void 0);
    const setLength = columnNames.length;
    const setArr = new Array(setLength);
    for (let i = 0; i < columnNames.length; ++i) {
      const colName = columnNames[i];
      const col = tableColumns[colName];
      let value3;
      if (set[colName] !== void 0) value3 = set[colName];
      else {
        const updateRes = col.onUpdateFn?.();
        value3 = is(updateRes, SQL) ? updateRes : sql.param(updateRes, col);
      }
      setArr[i] = i < setLength - 1 ? sql`${sql.identifier(col.name)} = ${value3}, ` : sql`${sql.identifier(col.name)} = ${value3}`;
    }
    return new SQL(setArr);
  }
  buildUpdateQuery({ table: table2, set, where, returning, withList, from, joins, comment, ignoreSelectionCastCodecs }) {
    const withSql = this.buildWithCTE(withList);
    const tableName = table2[PgTable.Symbol.Name];
    const tableSchema = table2[PgTable.Symbol.Schema];
    const origTableName = table2[PgTable.Symbol.OriginalName];
    const alias = tableName === origTableName ? void 0 : tableName;
    const tableSql = sql`${tableSchema ? sql`${sql.identifier(tableSchema)}.` : void 0}${sql.identifier(origTableName)}${alias && sql` ${sql.identifier(alias)}`}`;
    const setSql = this.buildUpdateSet(table2, set);
    const fromSql = from && new SQL([new StringChunk(" from "), this.buildFromTable(from)]);
    const joinsSql = this.buildJoins(joins);
    const returningSql = returning ? sql` returning ${this.buildSelection(returning, {
      isSingleTable: !from,
      ignoreCastCodecs: ignoreSelectionCastCodecs,
      table: table2
    })}` : void 0;
    return sql`${withSql}update ${tableSql} set ${setSql}${fromSql}${joinsSql}${where ? sql` where ${where}` : void 0}${returningSql}${comment !== void 0 ? sql` ${comment}` : void 0}`;
  }
  /**
  * Builds selection SQL with provided fields/expressions
  *
  * Examples:
  *
  * `select <selection> from`
  *
  * `insert ... returning <selection>`
  *
  * If `isSingleTable` is true, then columns won't be prefixed with table name
  */
  buildSelection(fields, { isSingleTable = false, ignoreCastCodecs = false, table: table2 } = {}) {
    const { length: columnsLen } = fields;
    const chunks = [];
    const tableName = table2 ? is(table2, SQL) || is(table2, Subquery) ? void 0 : table2[Table.Symbol.IsAlias] || table2[Table.Symbol.Schema] === void 0 ? table2[Table.Symbol.Name] : `${table2[Table.Symbol.Schema]}.${table2[Table.Symbol.Name]}` : void 0;
    for (let i = 0; i < columnsLen; ++i) {
      const { field, codecOverride, column, fieldType } = fields[i];
      const override = codecOverride;
      switch (fieldType) {
        case "Column": {
          let name3;
          if (isSingleTable) name3 = field.isAlias ? sql.identifier(getOriginalColumnFromAlias(field).name) : sql.identifier(field.name);
          else name3 = field.isAlias ? getOriginalColumnFromAlias(field) : field;
          const casted = ignoreCastCodecs ? name3 : this.codecs.apply(field, "cast", name3, override);
          chunks.push(field.isAlias ? sql`${casted} as ${field}` : casted);
          break;
        }
        case "SQL.Aliased":
          if (field.isSelectionField) {
            const query = !isSingleTable && field.origin !== void 0 ? sql`${sql.identifier(field.origin)}.${sql.identifier(field.fieldAlias)}` : sql.identifier(field.fieldAlias);
            if (column && !ignoreCastCodecs) chunks.push(this.codecs.apply(column, "cast", query, override));
            else chunks.push(query);
          } else {
            if (isSingleTable && tableName !== void 0) {
              const { queryChunks } = field.sql;
              const newChunks = new Array(queryChunks.length);
              let abort = false;
              for (let i2 = 0; i2 < queryChunks.length; ++i2) {
                const c = queryChunks[i2];
                if (is(c, Column)) {
                  const { table: table3 } = c;
                  if ((table3[Table.Symbol.IsAlias] || table3[Table.Symbol.Schema] === void 0 ? table3[Table.Symbol.Name] : `${table3[Table.Symbol.Schema]}.${table3[Table.Symbol.Name]}`) !== tableName) {
                    abort = true;
                    break;
                  }
                  newChunks[i2] = sql.identifier(c.name);
                } else newChunks[i2] = c;
              }
              if (abort) chunks.push(column && !ignoreCastCodecs ? this.codecs.apply(column, "cast", field.sql, override) : field.sql);
              else {
                const newSql = new SQL(newChunks);
                if (field.sql.shouldInlineParams) newSql.inlineParams();
                chunks.push(column && !ignoreCastCodecs ? this.codecs.apply(column, "cast", newSql, override) : newSql);
              }
            } else chunks.push(column && !ignoreCastCodecs ? this.codecs.apply(column, "cast", field.sql, override) : field.sql);
            chunks.push(sql` as ${sql.identifier(field.fieldAlias)}`);
          }
          break;
        case "SQL":
          if (isSingleTable && tableName !== void 0) {
            const { queryChunks } = field;
            const newChunks = new Array(queryChunks.length);
            let abort = false;
            for (let i2 = 0; i2 < queryChunks.length; ++i2) {
              const c = queryChunks[i2];
              if (is(c, Column)) {
                const { table: table3 } = c;
                if ((table3[Table.Symbol.IsAlias] || table3[Table.Symbol.Schema] === void 0 ? table3[Table.Symbol.Name] : `${table3[Table.Symbol.Schema]}.${table3[Table.Symbol.Name]}`) !== tableName) {
                  abort = true;
                  break;
                }
                newChunks[i2] = sql.identifier(c.name);
              } else newChunks[i2] = c;
            }
            if (abort) chunks.push(column && !ignoreCastCodecs ? this.codecs.apply(column, "cast", field, override) : field);
            else {
              const newSql = new SQL(newChunks);
              if (field.shouldInlineParams) newSql.inlineParams();
              chunks.push(column && !ignoreCastCodecs ? this.codecs.apply(column, "cast", newSql, override) : newSql);
            }
          } else chunks.push(column && !ignoreCastCodecs ? this.codecs.apply(column, "cast", field, override) : field);
          break;
        case "Subquery":
          if (column && !ignoreCastCodecs && !field._.isWith) {
            const innerCasted = this.codecs.apply(column, "cast", sql`(${field._.sql})`, override);
            chunks.push(sql`${innerCasted} ${sql.identifier(field._.alias)}`);
          } else chunks.push(column ? this.codecs.apply(column, "cast", field) : field, override);
          break;
      }
      if (i < columnsLen - 1) chunks.push(new StringChunk(", "));
    }
    return new SQL(chunks);
  }
  buildJoins(joins) {
    if (!joins || joins.length === 0) return;
    const joinsArray = [];
    for (const [index, joinMeta] of joins.entries()) {
      if (index === 0) joinsArray.push(new StringChunk(" "));
      const table2 = joinMeta.table;
      const lateralSql = joinMeta.lateral ? sql` lateral` : void 0;
      const onSql = joinMeta.on ? sql` on ${joinMeta.on}` : void 0;
      if (is(table2, PgTable)) {
        const tableName = table2[PgTable.Symbol.Name];
        const tableSchema = table2[PgTable.Symbol.Schema];
        const origTableName = table2[PgTable.Symbol.OriginalName];
        const alias = tableName === origTableName ? void 0 : joinMeta.alias;
        joinsArray.push(sql`${new StringChunk(joinMeta.joinType)} join${lateralSql} ${tableSchema ? sql`${sql.identifier(tableSchema)}.` : void 0}${sql.identifier(origTableName)}${alias && sql` ${sql.identifier(alias)}`}${onSql}`);
      } else if (is(table2, View)) {
        const viewName = table2[ViewBaseConfig].name;
        const viewSchema = table2[ViewBaseConfig].schema;
        const origViewName = table2[ViewBaseConfig].originalName;
        const alias = viewName === origViewName ? void 0 : joinMeta.alias;
        joinsArray.push(sql`${new StringChunk(joinMeta.joinType)} join${lateralSql} ${viewSchema ? sql`${sql.identifier(viewSchema)}.` : void 0}${sql.identifier(origViewName)}${alias && sql` ${sql.identifier(alias)}`}${onSql}`);
      } else joinsArray.push(sql`${new StringChunk(joinMeta.joinType)} join${lateralSql} ${table2}${onSql}`);
      if (index < joins.length - 1) joinsArray.push(new StringChunk(" "));
    }
    return new SQL(joinsArray);
  }
  buildFromTable(table2) {
    if (is(table2, Table) && table2[Table.Symbol.IsAlias]) {
      let fullName = sql`${sql.identifier(table2[Table.Symbol.OriginalName])}`;
      if (table2[Table.Symbol.Schema]) fullName = sql`${sql.identifier(table2[Table.Symbol.Schema])}.${fullName}`;
      return sql`${fullName} ${sql.identifier(table2[Table.Symbol.Name])}`;
    }
    if (is(table2, View) && table2[ViewBaseConfig].isAlias) {
      let fullName = sql`${sql.identifier(table2[ViewBaseConfig].originalName)}`;
      if (table2[ViewBaseConfig].schema) fullName = sql`${sql.identifier(table2[ViewBaseConfig].schema)}.${fullName}`;
      return sql`${fullName} ${sql.identifier(table2[ViewBaseConfig].name)}`;
    }
    return table2;
  }
  buildSelectQuery({ withList, fieldsFlat, where, having, table: table2, joins, orderBy, groupBy, limit, offset, lockingClause, distinct, setOperators, setFieldsFlat: setSelection, comment, ignoreSelectionCastCodecs }) {
    if (!fieldsFlat) throw new Error("Select query builder must be provided with `fieldsFlat` on `buildSelectQuery` invocation");
    const fieldsList = fieldsFlat;
    for (const f of fieldsList) if (is(f.field, Column) && getTableName(f.field.table) !== (is(table2, Subquery) ? table2._.alias : is(table2, PgViewBase) ? table2[ViewBaseConfig].name : is(table2, SQL) ? void 0 : getTableName(table2)) && !((table3) => joins?.some(({ alias }) => alias === (table3[Table.Symbol.IsAlias] ? getTableName(table3) : table3[Table.Symbol.BaseName])))(f.field.table)) {
      const tableName = getTableName(f.field.table);
      throw new Error(`Your "${f.path.join("->")}" field references a column "${tableName}"."${f.field.name}", but the table "${tableName}" is not part of the query! Did you forget to join it?`);
    }
    const isSingleTable = !joins || joins.length === 0;
    const withSql = this.buildWithCTE(withList);
    let distinctSql;
    if (distinct) distinctSql = distinct === true ? sql` distinct` : sql` distinct on (${sql.join(distinct.on, new StringChunk(", "))})`;
    const selection = this.buildSelection(fieldsList, {
      isSingleTable,
      ignoreCastCodecs: ignoreSelectionCastCodecs || setOperators.length > 0,
      table: table2
    });
    const tableSql = this.buildFromTable(table2);
    const joinsSql = this.buildJoins(joins);
    const whereSql = where ? sql` where ${where}` : void 0;
    const havingSql = having ? sql` having ${having}` : void 0;
    let orderBySql;
    if (orderBy && orderBy.length > 0) orderBySql = sql` order by ${sql.join(orderBy, new StringChunk(", "))}`;
    let groupBySql;
    if (groupBy && groupBy.length > 0) groupBySql = sql` group by ${sql.join(groupBy, new StringChunk(", "))}`;
    const limitSql = typeof limit === "object" || typeof limit === "number" && limit >= 0 ? sql` limit ${limit}` : void 0;
    const offsetSql = offset ? sql` offset ${offset}` : void 0;
    const lockingClauseSql = sql.empty();
    if (lockingClause) {
      const clauseSql = sql` for ${new StringChunk(lockingClause.strength)}`;
      if (lockingClause.config.of) clauseSql.append(sql` of ${sql.join(Array.isArray(lockingClause.config.of) ? lockingClause.config.of.map((it) => sql.identifier(it[PgTable.Symbol.Name])) : [sql.identifier(lockingClause.config.of[PgTable.Symbol.Name])], new StringChunk(", "))}`);
      if (lockingClause.config.noWait) clauseSql.append(sql` nowait`);
      else if (lockingClause.config.skipLocked) clauseSql.append(sql` skip locked`);
      lockingClauseSql.append(clauseSql);
    }
    const finalQuery = sql`${withSql}select${distinctSql} ${selection} from ${tableSql}${joinsSql}${whereSql}${groupBySql}${havingSql}${orderBySql}${limitSql}${offsetSql}${lockingClauseSql}${comment !== void 0 ? sql` ${comment}` : void 0}`;
    if (setOperators.length > 0) return this.buildSetOperations(finalQuery, setSelection, ignoreSelectionCastCodecs, setOperators);
    return finalQuery;
  }
  buildSetOperations(leftSelect, outputSelection, ignoreSelectionCastCodecs, setOperators) {
    for (let i = 0; i < setOperators.length; ++i) {
      const setOperator = setOperators[i];
      leftSelect = this.buildSetOperationQuery({
        leftSelect,
        setOperator
      });
    }
    return ignoreSelectionCastCodecs ? leftSelect : sql`select ${this.buildSelection(outputSelection.map((field) => {
      if (field.fieldType === "SQL.Aliased") {
        const ref = field.field.clone();
        ref.isSelectionField = true;
        return {
          ...field,
          field: ref,
          fieldType: "SQL.Aliased"
        };
      }
      if (field.fieldType === "Column" && field.field.isAlias) {
        const ref = new SQL.Aliased(sql`${sql.identifier(field.field.name)}`, field.field.name);
        ref.isSelectionField = true;
        return {
          ...field,
          field: ref,
          fieldType: "SQL.Aliased"
        };
      }
      if (field.fieldType === "Subquery") {
        const ref = new SQL.Aliased(sql`${field.field.getSQL()}`, field.field._.alias);
        ref.isSelectionField = true;
        return {
          ...field,
          field: ref,
          fieldType: "SQL.Aliased"
        };
      }
      return field;
    }), {
      isSingleTable: true,
      ignoreCastCodecs: ignoreSelectionCastCodecs
    })} from (${leftSelect}) ${sql.identifier("drizzle_union")}`;
  }
  buildSetOperationQuery({ leftSelect, setOperator: { type, isAll, rightSelect, limit, orderBy, offset } }) {
    const leftChunk = sql`(${leftSelect.getSQL()}) `;
    const rightChunk = sql`(${rightSelect.withoutSelectionCastCodecs().getSQL()})`;
    let orderBySql;
    if (orderBy && orderBy.length > 0) {
      const orderByValues = [];
      for (const singleOrderBy of orderBy) if (is(singleOrderBy, PgColumn)) orderByValues.push(sql.identifier(singleOrderBy.name));
      else if (is(singleOrderBy, SQL)) {
        for (let i = 0; i < singleOrderBy.queryChunks.length; i++) {
          const chunk = singleOrderBy.queryChunks[i];
          if (is(chunk, PgColumn)) singleOrderBy.queryChunks[i] = sql.identifier(chunk.name);
        }
        orderByValues.push(sql`${singleOrderBy}`);
      } else orderByValues.push(sql`${singleOrderBy}`);
      orderBySql = sql` order by ${sql.join(orderByValues, new StringChunk(", "))} `;
    }
    const limitSql = typeof limit === "object" || typeof limit === "number" && limit >= 0 ? sql` limit ${limit}` : void 0;
    const operatorChunk = new StringChunk(`${type} ${isAll ? "all " : ""}`);
    const offsetSql = offset ? sql` offset ${offset}` : void 0;
    return sql`${leftChunk}${operatorChunk}${rightChunk}${orderBySql}${limitSql}${offsetSql}`;
  }
  buildInsertQuery({ table: table2, values: valuesOrSelect, onConflict, returning, withList, select, overridingSystemValue_, comment, columnList, ignoreSelectionCastCodecs }) {
    const columns = table2[Table.Symbol.Columns];
    const colEntries = columnList ? columnList.map((name3) => [name3, columns[name3]]) : Object.entries(columns);
    const colFilteredEntries = select && !is(valuesOrSelect, SQL) ? Object.keys(valuesOrSelect.getSelectedFields()).map((key) => [key, columns[key]]) : overridingSystemValue_ ? colEntries : colEntries.filter(([_, col]) => !col.shouldDisableInsert());
    const insertOrderArr = new Array(colFilteredEntries.length * 2 + 1);
    let writeIdx = 0;
    insertOrderArr[writeIdx++] = new StringChunk("(");
    for (let i = 0; i < colFilteredEntries.length; ++i) {
      const [, { name: name3 }] = colFilteredEntries[i];
      insertOrderArr[writeIdx++] = sql.identifier(name3);
      if (i < colFilteredEntries.length - 1) insertOrderArr[writeIdx++] = new StringChunk(", ");
    }
    insertOrderArr[writeIdx++] = new StringChunk(")");
    const insertOrder = new SQL(insertOrderArr);
    const valuesSqlList = Array.from({ length: select ? 1 : (colFilteredEntries.length * 2 + 1) * valuesOrSelect.length + valuesOrSelect.length });
    if (select) valuesSqlList[0] = valuesOrSelect.getSQL();
    else {
      const values = valuesOrSelect;
      let writeIdx2 = 0;
      valuesSqlList[writeIdx2++] = new StringChunk("values ");
      for (let valueIndex = 0; valueIndex < values.length; ++valueIndex) {
        const value3 = values[valueIndex];
        valuesSqlList[writeIdx2++] = new StringChunk("(");
        for (let i = 0; i < colFilteredEntries.length; ++i) {
          const [fieldName, col] = colFilteredEntries[i];
          const colValue = value3[fieldName];
          if (colValue === void 0) if (col.defaultFn !== void 0) {
            const defaultFnResult = col.defaultFn();
            const defaultValue = is(defaultFnResult, SQL) ? defaultFnResult : sql.param(defaultFnResult, col);
            valuesSqlList[writeIdx2++] = defaultValue;
          } else if (!col.default && col.onUpdateFn !== void 0) {
            const onUpdateFnResult = col.onUpdateFn();
            const newValue = is(onUpdateFnResult, SQL) ? onUpdateFnResult : sql.param(onUpdateFnResult, col);
            valuesSqlList[writeIdx2++] = newValue;
          } else valuesSqlList[writeIdx2++] = new StringChunk(`default`);
          else valuesSqlList[writeIdx2++] = is(colValue, SQL) ? colValue : new Param(colValue, col);
          if (i < colFilteredEntries.length - 1) valuesSqlList[writeIdx2++] = new StringChunk(", ");
        }
        valuesSqlList[writeIdx2++] = new StringChunk(")");
        if (valueIndex < values.length - 1) valuesSqlList[writeIdx2++] = new StringChunk(`, `);
      }
    }
    const withSql = this.buildWithCTE(withList);
    const valuesSql = new SQL(valuesSqlList);
    const returningSql = returning ? sql` returning ${this.buildSelection(returning, {
      isSingleTable: true,
      ignoreCastCodecs: ignoreSelectionCastCodecs,
      table: table2
    })}` : void 0;
    const onConflictSql = onConflict ? sql` on conflict ${onConflict}` : void 0;
    return sql`${withSql}insert into ${table2} ${insertOrder} ${overridingSystemValue_ === true ? sql`overriding system value ` : void 0}${valuesSql}${onConflictSql}${returningSql}${comment !== void 0 ? sql` ${comment}` : void 0}`;
  }
  buildRefreshMaterializedViewQuery({ view: view2, concurrently, withNoData }) {
    return sql`refresh materialized view${concurrently ? sql` concurrently` : void 0} ${view2}${withNoData ? sql` with no data` : void 0}`;
  }
  sqlToQuery(sql2, invokeSource) {
    return sql2.toQuery({
      escapeName: this.escapeName,
      escapeParam: this.escapeParam,
      escapeString: this.escapeString,
      codecs: this.codecs,
      invokeSource
    });
  }
  _sqlToQuery(sql2) {
    return sql2.toQuery({
      escapeName: this.escapeName,
      escapeParam: this.escapeParam,
      escapeString: this.escapeString,
      codecs: this.codecs,
      tagged: true
    });
  }
  buildRqbColumn(table2, field, key, inJson, selection, tableTsName) {
    let decoderColumn;
    let fieldType;
    let output;
    if (is(field, Column)) {
      decoderColumn = field;
      fieldType = "Column";
      const name3 = sql`${table2}.${sql.identifier(field.name)}`;
      output = sql`${inJson && field.jsonSelectIdentifier ? field.jsonSelectIdentifier(name3, sql, field.dimensions) : this.codecs.apply(field, inJson ? "castInJson" : "cast", name3)} as ${sql.identifier(key)}`;
    } else if (is(field, SQL)) {
      decoderColumn = is(field.decoder, Column) ? field.decoder : void 0;
      fieldType = "SQL";
      const q = sql`${table2}.${sql.identifier(key)}`;
      output = sql`${decoderColumn ? this.codecs.apply(decoderColumn, inJson ? "castInJson" : "cast", q) : q} as ${sql.identifier(key)}`;
    } else if (is(field, SQL.Aliased)) {
      decoderColumn = is(field.sql.decoder, Column) ? field.sql.decoder : void 0;
      fieldType = "SQL.Aliased";
      const q = sql`${table2}.${sql.identifier(field.fieldAlias)}`;
      output = sql`${decoderColumn ? this.codecs.apply(decoderColumn, inJson ? "castInJson" : "cast", q) : q} as ${sql.identifier(key)}`;
    } else if (isSQLWrapper(field)) {
      const query = field.getSQL();
      decoderColumn = is(query.decoder, Column) ? query.decoder : void 0;
      fieldType = "SQLWrapper";
      const q = sql`${table2}.${sql.identifier(key)}`;
      output = sql`${decoderColumn ? this.codecs.apply(decoderColumn, inJson ? "castInJson" : "cast", q) : q} as ${sql.identifier(key)}`;
    } else throw new DrizzleError({ message: field === void 0 ? `Unknown column: "${tableTsName}"."${key}"` : `Views with nested selections are not supported by the relational query builder` });
    selection.push(decoderColumn ? {
      key,
      field,
      fieldType,
      codec: decoderColumn && (!inJson || !decoderColumn.mapFromJsonValue) ? this.codecs.get(decoderColumn, inJson ? "normalizeInJson" : "normalize") : void 0,
      arrayDimensions: decoderColumn.dimensions
    } : {
      key,
      field,
      fieldType
    });
    return output;
  }
  buildColumns = (table2, selection, inJson, tableTsName, config) => {
    if (!config?.columns) return sql.join(Object.entries(table2[TableColumns]).map(([k, v]) => {
      return this.buildRqbColumn(table2, v, k, inJson, selection, tableTsName);
    }), new StringChunk(", "));
    const entries = Object.entries(config.columns);
    const columnContainer = table2[TableColumns];
    const columnIdentifiers = [];
    let colSelectionMode;
    for (const [k, v] of entries) {
      if (v === void 0) continue;
      colSelectionMode = colSelectionMode || v;
      if (v) columnIdentifiers.push(this.buildRqbColumn(table2, columnContainer[k], k, inJson, selection, tableTsName));
    }
    if (colSelectionMode === false) for (const [k, v] of Object.entries(columnContainer)) {
      if (config.columns[k] === false) continue;
      columnIdentifiers.push(this.buildRqbColumn(table2, v, k, inJson, selection, tableTsName));
    }
    return columnIdentifiers.length ? sql.join(columnIdentifiers, new StringChunk(", ")) : void 0;
  };
  buildRelationalQuery({ schema, table: table2, tableConfig, queryConfig: config, relationWhere, mode, errorPath, depth, throughJoin, nested }) {
    const selection = [];
    const isSingle = mode === "first";
    const params = config === true ? void 0 : config;
    const currentPath = errorPath ?? "";
    const currentDepth = depth ?? 0;
    if (!currentDepth) table2 = aliasedTable(table2, `d${currentDepth}`);
    const limit = isSingle ? 1 : params?.limit;
    const offset = params?.offset;
    const where = params && "where" in params && relationWhere ? and(relationsFilterToSQL(table2, params.where, tableConfig.relations, schema), relationWhere) : params && "where" in params ? relationsFilterToSQL(table2, params.where, tableConfig.relations, schema) : relationWhere;
    const order = params?.orderBy ? relationsOrderToSQL(table2, params.orderBy) : void 0;
    const columns = this.buildColumns(table2, selection, !!nested, tableConfig.name, params);
    const extras = params?.extras ? relationExtrasToSQL(table2, params.extras, this.codecs, nested) : void 0;
    if (extras) selection.push(...extras.selection);
    const selectionArr = [];
    if (columns) selectionArr.push(columns);
    if (extras?.sql) selectionArr.push(extras.sql);
    let joins;
    switch (params) {
      case void 0:
        break;
      default: {
        const { with: withParam } = params;
        if (!withParam) break;
        const withEntries = Object.entries(withParam).filter(([_, v]) => v);
        if (!withEntries.length) break;
        const joinChunks = new Array(withEntries.length * 2);
        joinChunks[0] = new StringChunk(" ");
        for (let readIdx = 0, writeIdx = 1; readIdx < withEntries.length; ++readIdx) {
          const [k, join] = withEntries[readIdx];
          const relation = tableConfig.relations[k];
          if (!relation) throw new DrizzleError({ message: `Unknown relation "${tableConfig.name}" -> "${k}"` });
          const isSingle2 = relation.relationType === "one";
          const targetTable = aliasedTable(relation.targetTable, `d${currentDepth + 1}`);
          const throughTable = relation.throughTable ? aliasedTable(relation.throughTable, `tr${currentDepth}`) : void 0;
          const { filter, joinCondition } = relationToSQL(relation, table2, targetTable, throughTable);
          selectionArr.push(sql`${sql.identifier(k)}.${sql.identifier("r")} as ${sql.identifier(k)}`);
          const throughJoin2 = throughTable ? sql` inner join ${getTableAsAliasSQL(throughTable)} on ${joinCondition}` : void 0;
          const innerQuery = this.buildRelationalQuery({
            table: targetTable,
            mode: isSingle2 ? "first" : "many",
            schema,
            queryConfig: join,
            tableConfig: schema[relation.targetTableName],
            relationWhere: filter,
            errorPath: `${currentPath.length ? `${currentPath}.` : ""}${k}`,
            depth: currentDepth + 1,
            throughJoin: throughJoin2,
            nested: true
          });
          selection.push({
            field: targetTable,
            fieldType: "Nested",
            key: k,
            selection: innerQuery.selection,
            isArray: !isSingle2,
            isOptional: (relation.optional ?? false) || join !== true && !!join.where
          });
          const joinQuery = sql`left join lateral(select ${isSingle2 ? sql`row_to_json(${sql.identifier("t")}.*) ${sql.identifier("r")}` : sql`coalesce(json_agg(row_to_json(${sql.identifier("t")}.*)), '[]') as ${sql.identifier("r")}`} from (${innerQuery.sql}) as ${sql.identifier("t")}) as ${sql.identifier(k)} on true`;
          joinChunks[writeIdx++] = joinQuery;
          if (readIdx < withEntries.length - 1) joinChunks[writeIdx++] = new StringChunk(" ");
        }
        joins = new SQL(joinChunks);
        break;
      }
    }
    if (!selectionArr.length) throw new DrizzleError({ message: `No fields selected for table "${tableConfig.name}"${currentPath ? ` ("${currentPath}")` : ""}` });
    const selectionSet = sql.join(selectionArr, new StringChunk(", "));
    const comment = config !== true && config?.comment ? sql.comment(config.comment) : void 0;
    return {
      sql: sql`select ${selectionSet} from ${getTableAsAliasSQL(table2)}${throughJoin}${joins}${where ? sql` where ${where}` : void 0}${order ? sql` order by ${order}` : void 0}${limit !== void 0 ? sql` limit ${limit}` : void 0}${offset !== void 0 ? sql` offset ${offset}` : void 0}${comment ? sql` ${comment}` : void 0}`,
      selection
    };
  }
};

// node_modules/.bun/drizzle-orm@1.0.0-rc.5-169397b+5a2a64b31368e2d8/node_modules/drizzle-orm/pg-core/query-builders/query-builder.js
var QueryBuilder = class {
  static [entityKind] = "PgQueryBuilder";
  dialect;
  dialectConfig;
  constructor(dialect) {
    this.dialect = is(dialect, PgDialect) ? dialect : void 0;
    this.dialectConfig = is(dialect, PgDialect) ? void 0 : dialect;
  }
  $with = (alias, selection) => {
    const queryBuilder = this;
    const as2 = (qb) => {
      if (typeof qb === "function") qb = qb(queryBuilder);
      const sql2 = ("withoutSelectionCastCodecs" in qb ? qb.withoutSelectionCastCodecs() : qb).getSQL();
      return new Proxy(new WithSubquery(sql2, selection ?? ("getSelectedFields" in qb ? qb.getSelectedFields() ?? {} : {}), alias, true, sql2.usedTables ?? []), new SelectionProxyHandler({
        alias,
        sqlAliasedBehavior: "alias",
        sqlBehavior: "error"
      }));
    };
    return { as: as2 };
  };
  with(...queries) {
    const self = this;
    function select(fields) {
      return new PgSelectBuilder({
        fields: fields ?? void 0,
        session: void 0,
        dialect: self.getDialect(),
        withList: queries
      });
    }
    function selectDistinct(fields) {
      return new PgSelectBuilder({
        fields: fields ?? void 0,
        session: void 0,
        dialect: self.getDialect(),
        distinct: true
      });
    }
    function selectDistinctOn(on, fields) {
      return new PgSelectBuilder({
        fields: fields ?? void 0,
        session: void 0,
        dialect: self.getDialect(),
        distinct: { on }
      });
    }
    return {
      select,
      selectDistinct,
      selectDistinctOn
    };
  }
  select(fields) {
    return new PgSelectBuilder({
      fields: fields ?? void 0,
      session: void 0,
      dialect: this.getDialect()
    });
  }
  selectDistinct(fields) {
    return new PgSelectBuilder({
      fields: fields ?? void 0,
      session: void 0,
      dialect: this.getDialect(),
      distinct: true
    });
  }
  selectDistinctOn(on, fields) {
    return new PgSelectBuilder({
      fields: fields ?? void 0,
      session: void 0,
      dialect: this.getDialect(),
      distinct: { on }
    });
  }
  getDialect() {
    if (!this.dialect) this.dialect = new PgDialect(this.dialectConfig);
    return this.dialect;
  }
};

// node_modules/.bun/drizzle-orm@1.0.0-rc.5-169397b+5a2a64b31368e2d8/node_modules/drizzle-orm/pg-core/query-builders/update.js
var PgUpdateBuilder = class {
  static [entityKind] = "PgUpdateBuilder";
  constructor(table2, session, dialect, withList, builder = PgUpdateBase) {
    this.table = table2;
    this.session = session;
    this.dialect = dialect;
    this.withList = withList;
    this.builder = builder;
  }
  set(values) {
    return new this.builder(this.table, mapUpdateSet(this.table, values), this.session, this.dialect, this.withList);
  }
};
var PgUpdateBase = class {
  static [entityKind] = "PgUpdate";
  config;
  tableName;
  joinsNotNullableMap;
  constructor(table2, set, session, dialect, withList) {
    this.session = session;
    this.dialect = dialect;
    this.config = {
      set,
      table: table2,
      withList,
      joins: []
    };
    this.tableName = getTableLikeName(table2);
    this.joinsNotNullableMap = typeof this.tableName === "string" ? { [this.tableName]: true } : {};
  }
  from(source) {
    const src = source;
    const tableName = getTableLikeName(src);
    if (typeof tableName === "string") this.joinsNotNullableMap[tableName] = true;
    this.config.from = src;
    return this;
  }
  getTableLikeFields(table2) {
    if (is(table2, PgTable)) return table2[Table.Symbol.Columns];
    else if (is(table2, Subquery)) return table2._.selectedFields;
    return table2[ViewBaseConfig].selectedFields;
  }
  createJoin(joinType) {
    return ((table2, on) => {
      const tableName = getTableLikeName(table2);
      if (typeof tableName === "string" && this.config.joins.some((join) => join.alias === tableName)) throw new Error(`Alias "${tableName}" is already used in this query`);
      if (typeof on === "function") {
        const from = this.config.from && !is(this.config.from, SQL) ? this.getTableLikeFields(this.config.from) : void 0;
        on = on(new Proxy(this.config.table[Table.Symbol.Columns], new SelectionProxyHandler({
          sqlAliasedBehavior: "sql",
          sqlBehavior: "sql"
        })), from && new Proxy(from, new SelectionProxyHandler({
          sqlAliasedBehavior: "sql",
          sqlBehavior: "sql"
        })));
      }
      this.config.joins.push({
        on,
        table: table2,
        joinType,
        alias: tableName
      });
      if (typeof tableName === "string") switch (joinType) {
        case "left":
          this.joinsNotNullableMap[tableName] = false;
          break;
        case "right":
          this.joinsNotNullableMap = Object.fromEntries(Object.entries(this.joinsNotNullableMap).map(([key]) => [key, false]));
          this.joinsNotNullableMap[tableName] = true;
          break;
        case "inner":
          this.joinsNotNullableMap[tableName] = true;
          break;
        case "full":
          this.joinsNotNullableMap = Object.fromEntries(Object.entries(this.joinsNotNullableMap).map(([key]) => [key, false]));
          this.joinsNotNullableMap[tableName] = false;
          break;
      }
      return this;
    });
  }
  leftJoin = this.createJoin("left");
  rightJoin = this.createJoin("right");
  innerJoin = this.createJoin("inner");
  fullJoin = this.createJoin("full");
  /**
  * Adds a 'where' clause to the query.
  *
  * Calling this method will update only those rows that fulfill a specified condition.
  *
  * See docs: {@link https://orm.drizzle.team/docs/update}
  *
  * @param where the 'where' clause.
  *
  * @example
  * You can use conditional operators and `sql function` to filter the rows to be updated.
  *
  * ```ts
  * // Update all cars with green color
  * await db.update(cars).set({ color: 'red' })
  *   .where(eq(cars.color, 'green'));
  * // or
  * await db.update(cars).set({ color: 'red' })
  *   .where(sql`${cars.color} = 'green'`)
  * ```
  *
  * You can logically combine conditional operators with `and()` and `or()` operators:
  *
  * ```ts
  * // Update all BMW cars with a green color
  * await db.update(cars).set({ color: 'red' })
  *   .where(and(eq(cars.color, 'green'), eq(cars.brand, 'BMW')));
  *
  * // Update all cars with the green or blue color
  * await db.update(cars).set({ color: 'red' })
  *   .where(or(eq(cars.color, 'green'), eq(cars.color, 'blue')));
  * ```
  */
  where(where) {
    this.config.where = where;
    return this;
  }
  returning(fields) {
    if (!fields) {
      fields = Object.assign({}, this.config.table[Table.Symbol.Columns]);
      if (this.config.from) {
        const tableName = getTableLikeName(this.config.from);
        if (typeof tableName === "string" && this.config.from && !is(this.config.from, SQL)) {
          const fromFields = this.getTableLikeFields(this.config.from);
          fields[tableName] = fromFields;
        }
        for (const join of this.config.joins) {
          const tableName2 = getTableLikeName(join.table);
          if (typeof tableName2 === "string" && !is(join.table, SQL)) {
            const fromFields = this.getTableLikeFields(join.table);
            fields[tableName2] = fromFields;
          }
        }
      }
    }
    this.config.returningFields = fields;
    this.config.returning = orderSelectedFields(fields, void 0, this.dialect.codecs);
    return this;
  }
  /**
  * Attach [sqlcommenter](https://google.github.io/sqlcommenter) comment to a query
  */
  comment(comment) {
    this.config.comment = sql.comment(comment);
    return this;
  }
  getSQL() {
    return this.dialect.buildUpdateQuery(this.config);
  }
  toSQL() {
    return this.dialect.sqlToQuery(this.getSQL());
  }
  /** @internal */
  getSelectedFields() {
    return this.config.returningFields ? new Proxy(this.config.returningFields, new SelectionProxyHandler({
      alias: getTableName(this.config.table),
      sqlAliasedBehavior: "alias",
      sqlBehavior: "error"
    })) : void 0;
  }
  /** @internal */
  withoutSelectionCastCodecs() {
    this.config.ignoreSelectionCastCodecs = true;
    return this;
  }
  $dynamic() {
    return this;
  }
};

// node_modules/.bun/drizzle-orm@1.0.0-rc.5-169397b+5a2a64b31368e2d8/node_modules/drizzle-orm/pg-core/query-builders/refresh-materialized-view.js
var PgRefreshMaterializedView = class {
  static [entityKind] = "PgRefreshMaterializedView";
  config;
  constructor(view2, session, dialect) {
    this.session = session;
    this.dialect = dialect;
    this.config = { view: view2 };
  }
  concurrently() {
    if (this.config.withNoData !== void 0) throw new Error("Cannot use concurrently and withNoData together");
    this.config.concurrently = true;
    return this;
  }
  withNoData() {
    if (this.config.concurrently !== void 0) throw new Error("Cannot use concurrently and withNoData together");
    this.config.withNoData = true;
    return this;
  }
  getSQL() {
    return this.dialect.buildRefreshMaterializedViewQuery(this.config);
  }
  toSQL() {
    return this.dialect.sqlToQuery(this.getSQL());
  }
};

// node_modules/.bun/drizzle-orm@1.0.0-rc.5-169397b+5a2a64b31368e2d8/node_modules/drizzle-orm/effect-core/query-effect.js
import * as Effectable from "effect/Effectable";
function applyEffectWrapper(baseClass) {
  Object.assign(baseClass.prototype, Effectable.Prototype({
    label: "DrizzleQuery",
    evaluate() {
      return this.execute();
    }
  }));
}

// node_modules/.bun/drizzle-orm@1.0.0-rc.5-169397b+5a2a64b31368e2d8/node_modules/drizzle-orm/pg-core/effect/refresh-materialized-view.js
var PgEffectRefreshMaterializedView = class extends PgRefreshMaterializedView {
  static [entityKind] = "PgEffectRefreshMaterializedView";
  /** @internal */
  _prepare(name3, generateName = false) {
    const query = this.dialect.sqlToQuery(this.getSQL());
    return this.session.prepareQuery(query, "raw", name3 ?? generateName);
  }
  prepare(name3) {
    return this._prepare(name3, true);
  }
  execute = (placeholderValues) => {
    return this._prepare().execute(placeholderValues);
  };
};
applyEffectWrapper(PgEffectRefreshMaterializedView);

// node_modules/.bun/drizzle-orm@1.0.0-rc.5-169397b+5a2a64b31368e2d8/node_modules/drizzle-orm/pg-core/query-builders/raw.js
var PgRaw = class {
  static [entityKind] = "PgRaw";
  constructor(prepared, sql2, query) {
    this.prepared = prepared;
    this.sql = sql2;
    this.query = query;
  }
  getSQL() {
    return this.sql;
  }
  getQuery() {
    return this.query;
  }
  _prepare() {
    return this.prepared;
  }
};

// node_modules/.bun/drizzle-orm@1.0.0-rc.5-169397b+5a2a64b31368e2d8/node_modules/drizzle-orm/pg-core/effect/raw.js
var PgEffectRaw = class extends PgRaw {
  static [entityKind] = "PgEffectRaw";
  constructor(prepared, sql2, query) {
    super(prepared, sql2, query);
  }
  execute(placeholderValues) {
    return this.prepared.execute(placeholderValues);
  }
  _prepare() {
    return this.prepared;
  }
};
applyEffectWrapper(PgEffectRaw);

// node_modules/.bun/drizzle-orm@1.0.0-rc.5-169397b+5a2a64b31368e2d8/node_modules/drizzle-orm/pg-core/query-builders/delete.js
var PgDeleteBase = class {
  static [entityKind] = "PgDelete";
  config;
  constructor(table2, session, dialect, withList) {
    this.session = session;
    this.dialect = dialect;
    this.config = {
      table: table2,
      withList
    };
  }
  /**
  * Adds a `where` clause to the query.
  *
  * Calling this method will delete only those rows that fulfill a specified condition.
  *
  * See docs: {@link https://orm.drizzle.team/docs/delete}
  *
  * @param where the `where` clause.
  *
  * @example
  * You can use conditional operators and `sql function` to filter the rows to be deleted.
  *
  * ```ts
  * // Delete all cars with green color
  * await db.delete(cars).where(eq(cars.color, 'green'));
  * // or
  * await db.delete(cars).where(sql`${cars.color} = 'green'`)
  * ```
  *
  * You can logically combine conditional operators with `and()` and `or()` operators:
  *
  * ```ts
  * // Delete all BMW cars with a green color
  * await db.delete(cars).where(and(eq(cars.color, 'green'), eq(cars.brand, 'BMW')));
  *
  * // Delete all cars with the green or blue color
  * await db.delete(cars).where(or(eq(cars.color, 'green'), eq(cars.color, 'blue')));
  * ```
  */
  where(where) {
    this.config.where = where;
    return this;
  }
  returning(fields = this.config.table[Table.Symbol.Columns]) {
    this.config.returningFields = fields;
    this.config.returning = orderSelectedFields(fields, void 0, this.dialect.codecs);
    return this;
  }
  /**
  * Attach [sqlcommenter](https://google.github.io/sqlcommenter) comment to a query
  */
  comment(comment) {
    this.config.comment = sql.comment(comment);
    return this;
  }
  getSQL() {
    return this.dialect.buildDeleteQuery(this.config);
  }
  toSQL() {
    return this.dialect.sqlToQuery(this.getSQL());
  }
  /** @internal */
  getSelectedFields() {
    return this.config.returningFields ? new Proxy(this.config.returningFields, new SelectionProxyHandler({
      alias: getTableName(this.config.table),
      sqlAliasedBehavior: "alias",
      sqlBehavior: "error"
    })) : void 0;
  }
  /** @internal */
  withoutSelectionCastCodecs() {
    this.config.ignoreSelectionCastCodecs = true;
    return this;
  }
  $dynamic() {
    return this;
  }
};

// node_modules/.bun/drizzle-orm@1.0.0-rc.5-169397b+5a2a64b31368e2d8/node_modules/drizzle-orm/pg-core/effect/delete.js
var PgEffectDeleteBase = class extends PgDeleteBase {
  static [entityKind] = "PgEffectDelete";
  /** @internal */
  _prepare(name3, generateName = false) {
    const { session, config, dialect } = this;
    const { returning: fields } = config;
    const query = dialect.sqlToQuery(this.getSQL());
    const mapper = fields ? this.dialect.mapperGenerators.rows(fields, void 0) : void 0;
    return session.prepareQuery(query, fields ? "arrays" : "raw", name3 ?? generateName, mapper, {
      type: "delete",
      tables: [...extractUsedTable(this.config.table)]
    });
  }
  prepare(name3) {
    return this._prepare(name3, true);
  }
  execute = (placeholderValues) => {
    return this._prepare().execute(placeholderValues);
  };
};
applyEffectWrapper(PgEffectDeleteBase);

// node_modules/.bun/drizzle-orm@1.0.0-rc.5-169397b+5a2a64b31368e2d8/node_modules/drizzle-orm/pg-core/query-builders/query.js
var RelationalQueryBuilder = class {
  static [entityKind] = "PgRelationalQueryBuilderV2";
  constructor(schema, table2, tableConfig, dialect, session, parseJson, builder = PgRelationalQuery) {
    this.schema = schema;
    this.table = table2;
    this.tableConfig = tableConfig;
    this.dialect = dialect;
    this.session = session;
    this.parseJson = parseJson;
    this.builder = builder;
  }
  findMany(config) {
    return new this.builder(this.schema, this.table, this.tableConfig, this.dialect, this.session, config ?? true, "many", this.parseJson);
  }
  findFirst(config) {
    return new this.builder(this.schema, this.table, this.tableConfig, this.dialect, this.session, config ?? true, "first", this.parseJson);
  }
};
var PgRelationalQuery = class {
  static [entityKind] = "PgRelationalQueryV2";
  constructor(schema, table2, tableConfig, dialect, session, config, mode, parseJson) {
    this.schema = schema;
    this.table = table2;
    this.tableConfig = tableConfig;
    this.dialect = dialect;
    this.session = session;
    this.config = config;
    this.mode = mode;
    this.parseJson = parseJson;
  }
  _getQuery() {
    return this.dialect.buildRelationalQuery({
      schema: this.schema,
      table: this.table,
      tableConfig: this.tableConfig,
      queryConfig: this.config,
      mode: this.mode
    });
  }
  getSQL() {
    return this._getQuery().sql;
  }
  _toSQL() {
    const query = this._getQuery();
    return {
      query,
      builtQuery: this.dialect.sqlToQuery(query.sql)
    };
  }
  toSQL() {
    return this._toSQL().builtQuery;
  }
};

// node_modules/.bun/drizzle-orm@1.0.0-rc.5-169397b+5a2a64b31368e2d8/node_modules/drizzle-orm/pg-core/effect/query.js
var PgEffectRelationalQuery = class extends PgRelationalQuery {
  static [entityKind] = "PgEffectRelationalQueryV2";
  /** @internal */
  _prepare(name3, generateName = false) {
    const { query, builtQuery } = this._toSQL();
    const mapper = this.dialect.mapperGenerators.relationalRows({
      isFirst: this.mode === "first",
      parseJson: this.parseJson,
      parseJsonIfString: false,
      rootJsonMappers: false,
      selection: query.selection,
      arrayModeRoot: true
    });
    return this.session.prepareQuery(builtQuery, "arrays", name3 ?? generateName, mapper);
  }
  prepare(name3) {
    return this._prepare(name3, true);
  }
  execute(placeholderValues) {
    return this._prepare().execute(placeholderValues);
  }
};
applyEffectWrapper(PgEffectRelationalQuery);

// node_modules/.bun/drizzle-orm@1.0.0-rc.5-169397b+5a2a64b31368e2d8/node_modules/drizzle-orm/pg-core/effect/update.js
var PgEffectUpdateBase = class extends PgUpdateBase {
  static [entityKind] = "PgEffectUpdate";
  /** @internal */
  _prepare(name3, generateName = false) {
    const { session, config, dialect, joinsNotNullableMap } = this;
    const { returning: fields } = config;
    const query = dialect.sqlToQuery(this.getSQL());
    const mapper = fields ? this.dialect.mapperGenerators.rows(fields, resolveNullableObjectPaths(fields, joinsNotNullableMap)) : void 0;
    return session.prepareQuery(query, fields ? "arrays" : "raw", name3 ?? generateName, mapper, {
      type: "update",
      tables: [...extractUsedTable(this.config.table)]
    });
  }
  prepare(name3) {
    return this._prepare(name3, true);
  }
  execute = (placeholderValues = {}) => {
    return this._prepare().execute(placeholderValues);
  };
};
applyEffectWrapper(PgEffectUpdateBase);

// node_modules/.bun/drizzle-orm@1.0.0-rc.5-169397b+5a2a64b31368e2d8/node_modules/drizzle-orm/pg-core/effect/db.js
import { Effect as Effect6 } from "effect";

// node_modules/.bun/drizzle-orm@1.0.0-rc.5-169397b+5a2a64b31368e2d8/node_modules/drizzle-orm/pg-core/query-builders/count.js
var PgCountBuilder = class PgCountBuilder2 extends SQL {
  static [entityKind] = "PgCountBuilder";
  dialect;
  static buildCount(source, filters, parens) {
    const query = sql`select count(*) from ${source}${sql` where ${filters}`.if(filters)}`;
    return parens ? sql`(${query})` : query;
  }
  constructor(countConfig) {
    super(PgCountBuilder2.buildCount(countConfig.source, countConfig.filters, true).queryChunks);
    this.countConfig = countConfig;
    this.dialect = countConfig.dialect;
    this.mapWith((e) => {
      if (typeof e === "number") return e;
      return Number(e ?? 0);
    });
  }
  executableSql;
  build() {
    if (!this.executableSql) {
      const { source, filters } = this.countConfig;
      this.executableSql = PgCountBuilder2.buildCount(source, filters);
    }
    return this.dialect.sqlToQuery(this.executableSql);
  }
};

// node_modules/.bun/drizzle-orm@1.0.0-rc.5-169397b+5a2a64b31368e2d8/node_modules/drizzle-orm/pg-core/effect/count.js
var PgEffectCountBuilder = class extends PgCountBuilder {
  static [entityKind] = "PgEffectCountBuilder";
  session;
  constructor({ source, dialect, filters, session }) {
    super({
      source,
      dialect,
      filters
    });
    this.session = session;
  }
  execute(placeholderValues) {
    return this.session.prepareQuery(this.build(), "arrays", false, (rows) => {
      const v = rows[0]?.[0];
      if (typeof v === "number") return v;
      return v ? Number(v) : 0;
    }).execute(placeholderValues);
  }
};
applyEffectWrapper(PgEffectCountBuilder);

// node_modules/.bun/drizzle-orm@1.0.0-rc.5-169397b+5a2a64b31368e2d8/node_modules/drizzle-orm/pg-core/query-builders/insert.js
var PgInsertBuilder = class {
  static [entityKind] = "PgInsertBuilder";
  constructor(table2, session, dialect, withList, overridingSystemValue_, columnList, builder = PgInsertBase) {
    this.table = table2;
    this.session = session;
    this.dialect = dialect;
    this.withList = withList;
    this.overridingSystemValue_ = overridingSystemValue_;
    this.columnList = columnList;
    this.builder = builder;
  }
  overridingSystemValue() {
    this.overridingSystemValue_ = true;
    return this;
  }
  values(values) {
    values = Array.isArray(values) ? values : [values];
    if (values.length === 0) throw new Error("values() must be called with at least one value");
    return new this.builder(this.table, values, this.session, this.dialect, this.withList, false, this.columnList, this.overridingSystemValue_);
  }
  select(selectQuery) {
    const select = typeof selectQuery === "function" ? selectQuery(new QueryBuilder()) : selectQuery;
    if ("withoutSelectionCastCodecs" in select) select.withoutSelectionCastCodecs();
    if (!is(select, SQL)) {
      const insertCols = Object.keys(this.table[Table.Symbol.Columns]);
      const selected = Object.keys(select._.selectedFields);
      for (const col of selected) if (!insertCols.includes(col)) throw new Error(`Insert select error: column "${col}" does not exist in table "${this.table[Table.Symbol.Name]}"`);
    }
    return new this.builder(this.table, select, this.session, this.dialect, this.withList, true, this.columnList, this.overridingSystemValue_);
  }
};
var PgInsertBase = class {
  static [entityKind] = "PgInsert";
  config;
  constructor(table2, values, session, dialect, withList, select, columnList, overridingSystemValue_) {
    this.session = session;
    this.dialect = dialect;
    this.config = {
      table: table2,
      values,
      withList,
      select,
      columnList,
      overridingSystemValue_
    };
  }
  returning(fields = this.config.table[Table.Symbol.Columns]) {
    this.config.returningFields = fields;
    this.config.returning = orderSelectedFields(this.config.returningFields, void 0, this.dialect.codecs);
    return this;
  }
  /**
  * Adds an `on conflict do nothing` clause to the query.
  *
  * Calling this method simply avoids inserting a row as its alternative action.
  *
  * See docs: {@link https://orm.drizzle.team/docs/insert#on-conflict-do-nothing}
  *
  * @param config The `target` and `where` clauses.
  *
  * @example
  * ```ts
  * // Insert one row and cancel the insert if there's a conflict
  * await db.insert(cars)
  *   .values({ id: 1, brand: 'BMW' })
  *   .onConflictDoNothing();
  *
  * // Explicitly specify conflict target
  * await db.insert(cars)
  *   .values({ id: 1, brand: 'BMW' })
  *   .onConflictDoNothing({ target: cars.id });
  * ```
  */
  onConflictDoNothing(config = {}) {
    if (config.target === void 0) this.config.onConflict = sql`do nothing`;
    else {
      let targetColumn = "";
      targetColumn = Array.isArray(config.target) ? config.target.map((it) => this.dialect.escapeName(it.name)).join(",") : this.dialect.escapeName(config.target.name);
      const whereSql = config.where ? sql` where ${config.where}` : void 0;
      this.config.onConflict = sql`(${sql.raw(targetColumn)})${whereSql} do nothing`;
    }
    return this;
  }
  /**
  * Adds an `on conflict do update` clause to the query.
  *
  * Calling this method will update the existing row that conflicts with the row proposed for insertion as its alternative action.
  *
  * See docs: {@link https://orm.drizzle.team/docs/insert#upserts-and-conflicts}
  *
  * @param config The `target`, `set` and `where` clauses.
  *
  * @example
  * ```ts
  * // Update the row if there's a conflict
  * await db.insert(cars)
  *   .values({ id: 1, brand: 'BMW' })
  *   .onConflictDoUpdate({
  *     target: cars.id,
  *     set: { brand: 'Porsche' }
  *   });
  *
  * // Upsert with 'where' clause
  * await db.insert(cars)
  *   .values({ id: 1, brand: 'BMW' })
  *   .onConflictDoUpdate({
  *     target: cars.id,
  *     set: { brand: 'newBMW' },
  *     targetWhere: sql`${cars.createdAt} > '2023-01-01'::date`,
  *   });
  * ```
  */
  onConflictDoUpdate(config) {
    if (config.where && (config.targetWhere || config.setWhere)) throw new Error('You cannot use both "where" and "targetWhere"/"setWhere" at the same time - "where" is deprecated, use "targetWhere" or "setWhere" instead.');
    const whereSql = config.where ? sql` where ${config.where}` : void 0;
    const targetWhereSql = config.targetWhere ? sql` where ${config.targetWhere}` : void 0;
    const setWhereSql = config.setWhere ? sql` where ${config.setWhere}` : void 0;
    const setSql = this.dialect.buildUpdateSet(this.config.table, mapUpdateSet(this.config.table, config.set));
    let targetColumn = "";
    targetColumn = Array.isArray(config.target) ? config.target.map((it) => this.dialect.escapeName(it.name)).join(",") : this.dialect.escapeName(config.target.name);
    this.config.onConflict = sql`(${sql.raw(targetColumn)})${targetWhereSql} do update set ${setSql}${whereSql}${setWhereSql}`;
    return this;
  }
  /**
  * Attach [sqlcommenter](https://google.github.io/sqlcommenter) comment to a query
  */
  comment(comment) {
    this.config.comment = sql.comment(comment);
    return this;
  }
  getSQL() {
    return this.dialect.buildInsertQuery(this.config);
  }
  toSQL() {
    return this.dialect.sqlToQuery(this.getSQL());
  }
  /** @internal */
  getSelectedFields() {
    return this.config.returningFields ? new Proxy(this.config.returningFields, new SelectionProxyHandler({
      alias: getTableName(this.config.table),
      sqlAliasedBehavior: "alias",
      sqlBehavior: "error"
    })) : void 0;
  }
  /** @internal */
  withoutSelectionCastCodecs() {
    this.config.ignoreSelectionCastCodecs = true;
    return this;
  }
  $dynamic() {
    return this;
  }
};

// node_modules/.bun/drizzle-orm@1.0.0-rc.5-169397b+5a2a64b31368e2d8/node_modules/drizzle-orm/pg-core/effect/insert.js
import * as Effect5 from "effect/Effect";
var PgEffectInsertBase = class extends PgInsertBase {
  static [entityKind] = "PgEffectInsert";
  /** @internal */
  _prepare(name3, generateName = false) {
    const { session, config, dialect } = this;
    const { returning: fields } = config;
    const query = dialect.sqlToQuery(this.getSQL());
    const mapper = fields ? this.dialect.mapperGenerators.rows(fields, void 0) : void 0;
    return session.prepareQuery(query, fields ? "arrays" : "raw", name3 ?? generateName, mapper, {
      type: "insert",
      tables: [...extractUsedTable(this.config.table)]
    });
  }
  prepare(name3) {
    return this._prepare(name3, true);
  }
  execute = (placeholderValues) => {
    return this._prepare().execute(placeholderValues).pipe(Effect5.withSpan("drizzle.operation"));
  };
};
applyEffectWrapper(PgEffectInsertBase);

// node_modules/.bun/drizzle-orm@1.0.0-rc.5-169397b+5a2a64b31368e2d8/node_modules/drizzle-orm/pg-core/effect/select.js
var PgEffectSelectBase = class extends PgSelectBase {
  static [entityKind] = "PgEffectSelectQueryBuilder";
  /** @internal */
  _prepare(name3, generateName = false) {
    const { session, cacheConfig, usedTables } = this;
    const fieldsList = this._resolveSelection();
    const query = this.dialect.sqlToQuery(this.getSQL());
    const nullableObjectPaths = resolveNullableObjectPaths(fieldsList, this.joinsNotNullableMap);
    const mapper = this.dialect.mapperGenerators.rows(fieldsList, nullableObjectPaths);
    return session.prepareQuery(query, "arrays", name3 ?? generateName, mapper, {
      type: "select",
      tables: [...usedTables]
    }, cacheConfig);
  }
  /**
  * Create a prepared statement for this query. This allows
  * the database to remember this query for the given session
  * and call it by name, rather than specifying the full query.
  *
  * {@link https://www.postgresql.org/docs/current/sql-prepare.html | Postgres prepare documentation}
  */
  prepare(name3) {
    return this._prepare(name3, true);
  }
  execute = (placeholderValues) => {
    return this._prepare().execute(placeholderValues);
  };
};
applyEffectWrapper(PgEffectSelectBase);

// node_modules/.bun/drizzle-orm@1.0.0-rc.5-169397b+5a2a64b31368e2d8/node_modules/drizzle-orm/pg-core/effect/db.js
var PgEffectDatabase = class {
  static [entityKind] = "EffectPgDatabase";
  query;
  constructor(dialect, session, relations, parseRqbJson = false) {
    this.dialect = dialect;
    this.session = session;
    this._ = {
      relations,
      session
    };
    this.query = {};
    for (const [tableName, relation] of Object.entries(relations)) this.query[tableName] = new RelationalQueryBuilder(relations, relations[relation.name].table, relation, dialect, session, parseRqbJson, PgEffectRelationalQuery);
    this.$cache = { invalidate: (_params) => Effect6.void };
  }
  /**
  * Creates a subquery that defines a temporary named result set as a CTE.
  *
  * It is useful for breaking down complex queries into simpler parts and for reusing the result set in subsequent parts of the query.
  *
  * See docs: {@link https://orm.drizzle.team/docs/select#with-clause}
  *
  * @param alias The alias for the subquery.
  *
  * Failure to provide an alias will result in a DrizzleTypeError, preventing the subquery from being referenced in other queries.
  *
  * @example
  *
  * ```ts
  * // Create a subquery with alias 'sq' and use it in the select query
  * const sq = db.$with('sq').as(db.select().from(users).where(eq(users.id, 42)));
  *
  * const result = yield* db.with(sq).select().from(sq);
  * ```
  *
  * To select arbitrary SQL values as fields in a CTE and reference them in other CTEs or in the main query, you need to add aliases to them:
  *
  * ```ts
  * // Select an arbitrary SQL value as a field in a CTE and reference it in the main query
  * const sq = db.$with('sq').as(db.select({
  *   name: sql<string>`upper(${users.name})`.as('name'),
  * })
  * .from(users));
  *
  * const result = yield* db.with(sq).select({ name: sq.name }).from(sq);
  * ```
  */
  $with = (alias, selection) => {
    const as2 = (qb) => {
      if (typeof qb === "function") qb = qb(new QueryBuilder(this.dialect));
      const sql2 = ("withoutSelectionCastCodecs" in qb ? qb.withoutSelectionCastCodecs() : qb).getSQL();
      return new Proxy(new WithSubquery(sql2, selection ?? ("getSelectedFields" in qb ? qb.getSelectedFields() ?? {} : {}), alias, true, sql2.usedTables ?? []), new SelectionProxyHandler({
        alias,
        sqlAliasedBehavior: "alias",
        sqlBehavior: "error"
      }));
    };
    return { as: as2 };
  };
  $cache;
  $count(source, filters) {
    return new PgEffectCountBuilder({
      source,
      filters,
      session: this.session,
      dialect: this.dialect
    });
  }
  /**
  * Incorporates a previously defined CTE (using `$with`) into the main query.
  *
  * This method allows the main query to reference a temporary named result set.
  *
  * See docs: {@link https://orm.drizzle.team/docs/select#with-clause}
  *
  * @param queries The CTEs to incorporate into the main query.
  *
  * @example
  *
  * ```ts
  * // Define a subquery 'sq' as a CTE using $with
  * const sq = db.$with('sq').as(db.select().from(users).where(eq(users.id, 42)));
  *
  * // Incorporate the CTE 'sq' into the main query and select from it
  * const result = yield* db.with(sq).select().from(sq);
  * ```
  */
  with(...queries) {
    const self = this;
    function select(fields) {
      return new PgSelectBuilder({
        fields: fields ?? void 0,
        session: self.session,
        dialect: self.dialect,
        withList: queries
      }, PgEffectSelectBase);
    }
    function selectDistinct(fields) {
      return new PgSelectBuilder({
        fields: fields ?? void 0,
        session: self.session,
        dialect: self.dialect,
        withList: queries,
        distinct: true
      }, PgEffectSelectBase);
    }
    function selectDistinctOn(on, fields) {
      return new PgSelectBuilder({
        fields: fields ?? void 0,
        session: self.session,
        dialect: self.dialect,
        withList: queries,
        distinct: { on }
      }, PgEffectSelectBase);
    }
    function update(table2) {
      return new PgUpdateBuilder(table2, self.session, self.dialect, queries, PgEffectUpdateBase);
    }
    function insert(table2, ...columns) {
      return new PgInsertBuilder(table2, self.session, self.dialect, queries, void 0, columns.length ? columns : void 0, PgEffectInsertBase);
    }
    function delete_(table2) {
      return new PgEffectDeleteBase(table2, self.session, self.dialect, queries);
    }
    return {
      select,
      selectDistinct,
      selectDistinctOn,
      update,
      insert,
      delete: delete_
    };
  }
  select(fields) {
    return new PgSelectBuilder({
      fields: fields ?? void 0,
      session: this.session,
      dialect: this.dialect
    }, PgEffectSelectBase);
  }
  selectDistinct(fields) {
    return new PgSelectBuilder({
      fields: fields ?? void 0,
      session: this.session,
      dialect: this.dialect,
      distinct: true
    }, PgEffectSelectBase);
  }
  selectDistinctOn(on, fields) {
    return new PgSelectBuilder({
      fields: fields ?? void 0,
      session: this.session,
      dialect: this.dialect,
      distinct: { on }
    }, PgEffectSelectBase);
  }
  /**
  * Creates an update query.
  *
  * Calling this method without `.where()` clause will update all rows in a table. The `.where()` clause specifies which rows should be updated.
  *
  * Use `.set()` method to specify which values to update.
  *
  * See docs: {@link https://orm.drizzle.team/docs/update}
  *
  * @param table The table to update.
  *
  * @example
  *
  * ```ts
  * // Update all rows in the 'cars' table
  * yield* db.update(cars).set({ color: 'red' });
  *
  * // Update rows with filters and conditions
  * yield* db.update(cars).set({ color: 'red' }).where(eq(cars.brand, 'BMW'));
  *
  * // Update with returning clause
  * const updatedCar: Car[] = yield* db.update(cars)
  *   .set({ color: 'red' })
  *   .where(eq(cars.id, 1))
  *   .returning();
  * ```
  */
  update(table2) {
    return new PgUpdateBuilder(table2, this.session, this.dialect, void 0, PgEffectUpdateBase);
  }
  insert(table2, ...columns) {
    return new PgInsertBuilder(table2, this.session, this.dialect, void 0, void 0, columns.length ? columns : void 0, PgEffectInsertBase);
  }
  /**
  * Creates a delete query.
  *
  * Calling this method without `.where()` clause will delete all rows in a table. The `.where()` clause specifies which rows should be deleted.
  *
  * See docs: {@link https://orm.drizzle.team/docs/delete}
  *
  * @param table The table to delete from.
  *
  * @example
  *
  * ```ts
  * // Delete all rows in the 'cars' table
  * yield* db.delete(cars);
  *
  * // Delete rows with filters and conditions
  * yield* db.delete(cars).where(eq(cars.color, 'green'));
  *
  * // Delete with returning clause
  * const deletedCar: Car[] = yield* db.delete(cars)
  *   .where(eq(cars.id, 1))
  *   .returning();
  * ```
  */
  delete(table2) {
    return new PgEffectDeleteBase(table2, this.session, this.dialect);
  }
  refreshMaterializedView(view2) {
    return new PgEffectRefreshMaterializedView(view2, this.session, this.dialect);
  }
  execute(query, mode) {
    const sequel = typeof query === "string" ? sql.raw(query) : query.getSQL();
    const builtQuery = this.dialect.sqlToQuery(sequel);
    return new PgEffectRaw(this.session.prepareQuery(builtQuery, mode ?? "raw", false), sequel, builtQuery);
  }
  transaction(transaction, config) {
    return this.session.transaction(transaction, config);
  }
};

// node_modules/.bun/drizzle-orm@1.0.0-rc.5-169397b+5a2a64b31368e2d8/node_modules/drizzle-orm/migrator.utils.js
function getMigrationsToRun(params) {
  const { localMigrations, dbMigrations } = params;
  const dbNamesSet = new Set(dbMigrations.map((m) => m.name).filter((n) => n !== null));
  return localMigrations.filter((lm) => !lm.name || !dbNamesSet.has(lm.name));
}

// node_modules/.bun/drizzle-orm@1.0.0-rc.5-169397b+5a2a64b31368e2d8/node_modules/drizzle-orm/pg-core/effect/session.js
import * as Effect9 from "effect/Effect";

// node_modules/.bun/drizzle-orm@1.0.0-rc.5-169397b+5a2a64b31368e2d8/node_modules/drizzle-orm/cache/core/cache.js
var Cache = class {
  static [entityKind] = "Cache";
};
var NoopCache = class extends Cache {
  static [entityKind] = "NoopCache";
  strategy() {
    return "all";
  }
  async get(_key) {
  }
  async put(_hashedQuery, _response, _tables, _config) {
  }
  async onMutate(_params) {
  }
};
var strategyFor = async (query, params, queryMetadata, withCacheConfig) => {
  if (!queryMetadata) return { type: "skip" };
  const { type, tables } = queryMetadata;
  if ((type === "insert" || type === "update" || type === "delete") && tables.length > 0) return {
    type: "invalidate",
    tables
  };
  if (!withCacheConfig) return { type: "skip" };
  if (!withCacheConfig.enabled) return { type: "skip" };
  if (type === "select") return {
    type: "try",
    key: withCacheConfig.tag ?? await hashQuery(query, params),
    isTag: typeof withCacheConfig.tag !== "undefined",
    autoInvalidate: withCacheConfig.autoInvalidate,
    tables: queryMetadata.tables,
    config: withCacheConfig.config
  };
  return { type: "skip" };
};
var SHA256_K = /* @__PURE__ */ new Uint32Array([
  1116352408,
  1899447441,
  3049323471,
  3921009573,
  961987163,
  1508970993,
  2453635748,
  2870763221,
  3624381080,
  310598401,
  607225278,
  1426881987,
  1925078388,
  2162078206,
  2614888103,
  3248222580,
  3835390401,
  4022224774,
  264347078,
  604807628,
  770255983,
  1249150122,
  1555081692,
  1996064986,
  2554220882,
  2821834349,
  2952996808,
  3210313671,
  3336571891,
  3584528711,
  113926993,
  338241895,
  666307205,
  773529912,
  1294757372,
  1396182291,
  1695183700,
  1986661051,
  2177026350,
  2456956037,
  2730485921,
  2820302411,
  3259730800,
  3345764771,
  3516065817,
  3600352804,
  4094571909,
  275423344,
  430227734,
  506948616,
  659060556,
  883997877,
  958139571,
  1322822218,
  1537002063,
  1747873779,
  1955562222,
  2024104815,
  2227730452,
  2361852424,
  2428436474,
  2756734187,
  3204031479,
  3329325298
]);
function rotr(x, n) {
  return x >>> n | x << 32 - n;
}
function sha2562(bytes) {
  const h = new Uint32Array([
    1779033703,
    3144134277,
    1013904242,
    2773480762,
    1359893119,
    2600822924,
    528734635,
    1541459225
  ]);
  const byteLength = bytes.length;
  const padded = new Uint8Array(Math.ceil((byteLength + 9) / 64) * 64);
  padded.set(bytes);
  padded[byteLength] = 128;
  const view2 = new DataView(padded.buffer);
  const bitLength = byteLength * 8;
  view2.setUint32(padded.length - 8, Math.floor(bitLength / 4294967296));
  view2.setUint32(padded.length - 4, bitLength >>> 0);
  const w = new Uint32Array(64);
  for (let offset = 0; offset < padded.length; offset += 64) {
    for (let i = 0; i < 16; i++) w[i] = view2.getUint32(offset + i * 4);
    for (let i = 16; i < 64; i++) {
      const a0 = w[i - 15];
      const a1 = w[i - 2];
      const s0 = rotr(a0, 7) ^ rotr(a0, 18) ^ a0 >>> 3;
      const s1 = rotr(a1, 17) ^ rotr(a1, 19) ^ a1 >>> 10;
      w[i] = w[i - 16] + s0 + w[i - 7] + s1 >>> 0;
    }
    let a = h[0], b = h[1], c = h[2], d = h[3], e = h[4], f = h[5], g = h[6], hh = h[7];
    for (let i = 0; i < 64; i++) {
      const s1 = rotr(e, 6) ^ rotr(e, 11) ^ rotr(e, 25);
      const ch = e & f ^ ~e & g;
      const t1 = hh + s1 + ch + SHA256_K[i] + w[i] >>> 0;
      const t2 = (rotr(a, 2) ^ rotr(a, 13) ^ rotr(a, 22)) + (a & b ^ a & c ^ b & c) >>> 0;
      hh = g;
      g = f;
      f = e;
      e = d + t1 >>> 0;
      d = c;
      c = b;
      b = a;
      a = t1 + t2 >>> 0;
    }
    h[0] = h[0] + a;
    h[1] = h[1] + b;
    h[2] = h[2] + c;
    h[3] = h[3] + d;
    h[4] = h[4] + e;
    h[5] = h[5] + f;
    h[6] = h[6] + g;
    h[7] = h[7] + hh;
  }
  const out = new Uint8Array(32);
  const outView = new DataView(out.buffer);
  for (let i = 0; i < 8; i++) outView.setUint32(i * 4, h[i]);
  return out;
}
var HEX = /* @__PURE__ */ (() => {
  const table2 = new Array(256);
  for (let i = 0; i < 256; i++) table2[i] = i.toString(16).padStart(2, "0");
  return table2;
})();
function toHex(bytes) {
  let hex = "";
  for (let i = 0; i < bytes.length; i++) hex += HEX[bytes[i]];
  return hex;
}
var nodeCreateHash;
function getNodeCreateHash() {
  if (nodeCreateHash !== void 0) return nodeCreateHash;
  let resolved;
  try {
    const nodeCrypto = globalThis.process?.getBuiltinModule?.("node:crypto");
    resolved = typeof nodeCrypto?.createHash === "function" ? nodeCrypto.createHash : null;
  } catch {
    resolved = null;
  }
  return nodeCreateHash = resolved;
}
var encoder;
async function hashQuery(sql2, params) {
  const dataToHash = `${sql2}-${JSON.stringify(params, (_, v) => typeof v === "bigint" ? `${v}n` : v)}`;
  const createHash2 = getNodeCreateHash();
  if (createHash2) return createHash2("sha256").update(dataToHash).digest("hex");
  encoder ??= new TextEncoder();
  const data = encoder.encode(dataToHash);
  const subtle = typeof globalThis.crypto !== "undefined" ? globalThis.crypto.subtle : void 0;
  return toHex(subtle ? new Uint8Array(await subtle.digest("SHA-256", data)) : sha2562(data));
}

// node_modules/.bun/drizzle-orm@1.0.0-rc.5-169397b+5a2a64b31368e2d8/node_modules/drizzle-orm/cache/core/cache-effect.js
import * as Effect7 from "effect/Effect";
import * as Context4 from "effect/Context";
import * as Layer2 from "effect/Layer";
import * as Schema$1 from "effect/Schema";
var EffectCache = class EffectCache2 extends Context4.Service()("drizzle-orm/EffectCache", { make: Effect7.sync(() => make8(new NoopCache())) }) {
  static [entityKind] = "drizzle-orm/EffectCache";
  /**
  * The default layer providing a no-op cache.
  */
  static Default = Layer2.effect(EffectCache2, EffectCache2.make);
  /**
  * Creates an EffectCacheShape from a standard Drizzle cache.
  *
  * @param cache - A Drizzle cache instance implementing the `Cache` interface.
  * @returns A new EffectCacheShape that delegates to the provided Drizzle cache.
  *
  * @example
  * ```ts
  * const drizzleCache = new MyCustomCache();
  * const effectCache = EffectCache.fromDrizzle(drizzleCache);
  * ```
  */
  static fromDrizzle(cache) {
    return make8(cache);
  }
  /**
  * Creates a Layer that provides an EffectCache from a standard Drizzle cache.
  *
  * @param cache - A Drizzle cache instance implementing the `Cache` interface.
  * @returns A Layer that provides the EffectCache service.
  *
  * @example
  * ```ts
  * const drizzleCache = new MyCustomCache();
  * const db = yield* PgDrizzle.make({ relations }).pipe(
  *   Effect.provide(EffectCache.layerFromDrizzle(drizzleCache)),
  *   Effect.provide(PgDrizzle.DefaultServices),
  * );
  * ```
  */
  static layerFromDrizzle(cache) {
    return Layer2.succeed(EffectCache2, EffectCache2.fromDrizzle(cache));
  }
};
function make8(cache) {
  const strategy = () => cache.strategy();
  const get2 = (...args) => Effect7.tryPromise({
    try: () => cache.get(...args),
    catch: (error) => new EffectCacheError({ cause: error })
  });
  const put = (...args) => Effect7.tryPromise({
    try: () => cache.put(...args),
    catch: (error) => new EffectCacheError({ cause: error })
  });
  const onMutate = (params) => Effect7.tryPromise({
    try: () => cache.onMutate(params),
    catch: (error) => new EffectCacheError({ cause: error })
  });
  return {
    strategy,
    get: get2,
    put,
    onMutate,
    cache
  };
}
var EffectCacheError = class extends Schema$1.TaggedError()("EffectCacheError", { cause: Schema$1.Unknown }) {
  static [entityKind] = "EffectCacheError";
};

// node_modules/.bun/drizzle-orm@1.0.0-rc.5-169397b+5a2a64b31368e2d8/node_modules/drizzle-orm/pg-core/effect/session.js
import * as Cause2 from "effect/Cause";

// node_modules/.bun/drizzle-orm@1.0.0-rc.5-169397b+5a2a64b31368e2d8/node_modules/drizzle-orm/effect-core/errors.js
import * as Schema$12 from "effect/Schema";
var EffectDrizzleError = class extends Schema$12.TaggedError()("EffectDrizzleError", {
  message: Schema$12.String,
  cause: Schema$12.Unknown
}) {
  static [entityKind] = "EffectDrizzleError";
};
var EffectDrizzleQueryError = class EffectDrizzleQueryError2 extends Schema$12.TaggedError()("EffectDrizzleQueryError", {
  query: Schema$12.String,
  params: Schema$12.Array(Schema$12.Any).pipe(Schema$12.mutable),
  cause: Schema$12.Unknown
}) {
  static [entityKind] = "EffectDrizzleQueryError";
  get message() {
    return `Failed query: ${this.query}
params: ${this.params}`;
  }
  constructor(params) {
    super(params);
    Error.captureStackTrace(this, EffectDrizzleQueryError2);
  }
};
var EffectTransactionRollbackError = class extends Schema$12.TaggedError()("EffectTransactionRollbackError", {}) {
  static [entityKind] = "EffectTransactionRollbackError";
  message = "Rollback";
};
var MigratorInitError = class extends Schema$12.TaggedError()("MigratorInitError", { exitCode: Schema$12.Literals(["databaseMigrations", "localMigrations"]) }) {
  static [entityKind] = "MigratorInitError";
};

// node_modules/.bun/drizzle-orm@1.0.0-rc.5-169397b+5a2a64b31368e2d8/node_modules/drizzle-orm/up-migrations/utils.js
var MIGRATIONS_TABLE_VERSIONS = {
  sqlite: 1,
  pg: 1,
  effect: 1,
  mysql: 1,
  mssql: 1,
  cockroach: 1,
  singlestore: 1
};
var GET_VERSION_FOR = {
  mysql: (columns) => {
    if (columns.includes("name")) return 1;
    return 0;
  },
  pg: (columns) => {
    if (columns.includes("name")) return 1;
    return 0;
  },
  effect: (columns) => {
    if (columns.includes("name")) return 1;
    return 0;
  },
  mssql: (columns) => {
    if (columns.includes("name")) return 1;
    return 0;
  },
  cockroach: (columns) => {
    if (columns.includes("name")) return 1;
    return 0;
  },
  singlestore: (columns) => {
    if (columns.includes("name")) return 1;
    return 0;
  },
  sqlite: (columns) => {
    if (columns.includes("name")) return 1;
    return 0;
  }
};

// node_modules/.bun/drizzle-orm@1.0.0-rc.5-169397b+5a2a64b31368e2d8/node_modules/drizzle-orm/up-migrations/effect-pg.js
import { Effect as Effect8 } from "effect";
var upgradeFunctions = { 0: (migrationsSchema, migrationsTable, session, localMigrations) => {
  return Effect8.gen(function* () {
    const table2 = sql`${sql.identifier(migrationsSchema)}.${sql.identifier(migrationsTable)}`;
    const dbRows = yield* session.objects(sql`SELECT id, hash, created_at FROM ${table2} ORDER BY id ASC`);
    localMigrations.sort((a, b) => a.folderMillis !== b.folderMillis ? a.folderMillis - b.folderMillis : (a.name ?? "").localeCompare(b.name ?? ""));
    const byMillis = /* @__PURE__ */ new Map();
    const byHash = /* @__PURE__ */ new Map();
    for (const lm of localMigrations) {
      if (!byMillis.has(lm.folderMillis)) byMillis.set(lm.folderMillis, []);
      byMillis.get(lm.folderMillis).push(lm);
      byHash.set(lm.hash, lm);
    }
    const toApply = [];
    let unmatchedIds = [];
    for (const dbRow of dbRows) {
      const stringified = String(dbRow.created_at);
      const millis = Number(stringified.substring(0, stringified.length - 3) + "000");
      const candidates = byMillis.get(millis);
      let matched;
      if (candidates && candidates.length === 1) matched = candidates[0];
      else if (candidates && candidates.length > 1) matched = candidates.find((c) => c.hash === dbRow.hash);
      else matched = byHash.get(dbRow.hash);
      if (matched) toApply.push({
        id: dbRow.id,
        name: matched.name
      });
      else unmatchedIds.push(dbRow.id);
    }
    if (unmatchedIds.length > 0) throw Error(`While upgrading your database migrations table we found ${unmatchedIds.length} migrations (ids: ${unmatchedIds.join(", ")}) in the database that do not match any local migration. This means that some migrations were applied to the database but are missing from the local environment`);
    yield* session.transaction((tx) => Effect8.gen(function* () {
      yield* tx.execute(sql`ALTER TABLE ${table2} ADD COLUMN IF NOT EXISTS ${sql.identifier("name")} text`);
      yield* tx.execute(sql`ALTER TABLE ${table2} ADD COLUMN IF NOT EXISTS ${sql.identifier("applied_at")} timestamp with time zone DEFAULT now()`);
      for (const backfillEntry of toApply) yield* tx.execute(sql`UPDATE ${table2} SET ${sql.identifier("name")} = ${backfillEntry.name}, ${sql.identifier("applied_at")} = NULL WHERE ${sql.identifier("id")} = ${backfillEntry.id}`);
    }));
  });
} };
var upgradeIfNeeded = Effect8.fn("upgradeIfNeeded")(function* (migrationsSchema, migrationsTable, session, localMigrations) {
  if ((yield* session.objects(sql`SELECT 1 FROM information_schema.tables
			WHERE table_schema = ${migrationsSchema}
			AND table_name = ${migrationsTable}`)).length === 0) return { newDb: true };
  const rows = yield* session.objects(sql`SELECT
			n.nspname AS "schema",
			c.relname AS "table_name",
			a.attname AS "column_name",
			pg_catalog.format_type(a.atttypid, a.atttypmod) AS "type"
		FROM
			pg_catalog.pg_attribute a
			JOIN pg_catalog.pg_class c ON c.oid = a.attrelid
			JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
		WHERE
			a.attnum > 0
			AND NOT a.attisdropped
			AND n.nspname = ${migrationsSchema}
			AND c.relname = ${migrationsTable}
		ORDER BY a.attnum;`);
  const version = GET_VERSION_FOR.effect(rows.map((r) => r.column_name));
  for (let v = version; v < MIGRATIONS_TABLE_VERSIONS.effect; v++) {
    const upgradeFn = upgradeFunctions[v];
    if (!upgradeFn) throw new Error(`No upgrade path from migration table version ${v} to ${v + 1}`);
    yield* upgradeFn(migrationsSchema, migrationsTable, session, localMigrations);
  }
  return { newDb: false };
});

// node_modules/.bun/drizzle-orm@1.0.0-rc.5-169397b+5a2a64b31368e2d8/node_modules/drizzle-orm/pg-core/effect/session.js
var PgEffectPreparedQuery = class extends PgBasePreparedQuery {
  static [entityKind] = "PgEffectPreparedQuery";
  /** @internal */
  mapper;
  constructor(executor, query, mapper, mode, logger, cache, queryMetadata, cacheConfig) {
    super(query);
    this.executor = executor;
    this.mode = mode;
    this.logger = logger;
    this.cache = cache;
    this.queryMetadata = queryMetadata;
    this.cacheConfig = cacheConfig;
    this.mapper = mapper;
    if (cache && cache.strategy() === "all" && cacheConfig === void 0) this.cacheConfig = {
      enabled: true,
      autoInvalidate: true
    };
    if (!this.cacheConfig?.enabled) this.cacheConfig = void 0;
  }
  execute(placeholderValues = {}) {
    return Effect9.gen({ self: this }, function* () {
      const params = fillPlaceholders(this.query.params, placeholderValues);
      const { query: { sql: sql2 }, mapper, logger } = this;
      yield* logger.logQuery(sql2, params);
      const query = this.queryWithCache(sql2, params, Effect9.suspend(() => this.executor(params)));
      if (!mapper) return yield* query;
      return yield* query.pipe(Effect9.map((rows) => mapper(rows)));
    });
  }
  /** @internal */
  queryWithCache(queryString, params, query) {
    return Effect9.gen({ self: this }, function* () {
      const { cacheConfig, queryMetadata } = this;
      const cache = yield* EffectCache;
      const cacheStrat = cache && !(cache.cache && is(cache.cache, NoopCache)) ? yield* Effect9.tryPromise(() => strategyFor(queryString, params, queryMetadata, cacheConfig)) : { type: "skip" };
      if (cacheStrat.type === "skip") return yield* query;
      if (cacheStrat.type === "invalidate") {
        const result3 = yield* query;
        yield* cache.onMutate({ tables: cacheStrat.tables });
        return result3;
      }
      if (cacheStrat.type === "try") {
        const { tables, key, isTag, autoInvalidate, config } = cacheStrat;
        const fromCache = yield* cache.get(key, tables, isTag, autoInvalidate);
        if (typeof fromCache !== "undefined") return fromCache;
        const result3 = yield* query;
        yield* cache.put(key, result3, autoInvalidate ? tables : [], isTag, config);
        return result3;
      }
      assertUnreachable(cacheStrat);
    }).pipe(Effect9.provideService(EffectCache, this.cache), Effect9.catch((e) => {
      return Effect9.fail(new EffectDrizzleQueryError({
        query: queryString,
        params,
        cause: Cause2.fail(e)
      }));
    }));
  }
};
var PgEffectSession = class extends PgSession {
  static [entityKind] = "PgEffectSession";
  constructor(dialect) {
    super(dialect);
  }
  execute(query) {
    return this.prepareQuery(this.dialect.sqlToQuery(query), "raw", false).execute();
  }
  arrays(query) {
    return this.prepareQuery(this.dialect.sqlToQuery(query), "arrays", false).execute();
  }
  objects(query) {
    return this.prepareQuery(this.dialect.sqlToQuery(query), "objects", false).execute();
  }
};
var PgEffectTransaction = class extends PgEffectDatabase {
  static [entityKind] = "PgEffectTransaction";
  constructor(dialect, session, relations, nestedIndex = 0, parseRqbJson) {
    super(dialect, session, relations, parseRqbJson);
    this.relations = relations;
    this.nestedIndex = nestedIndex;
  }
  rollback() {
    return new EffectTransactionRollbackError();
  }
  /** @internal */
  getTransactionConfigChunks(config) {
    const chunks = [];
    if (config.isolationLevel) chunks.push(`isolation level ${config.isolationLevel}`);
    if (config.accessMode) chunks.push(config.accessMode);
    if (typeof config.deferrable === "boolean") chunks.push(config.deferrable ? "deferrable" : "not deferrable");
    return chunks;
  }
  /** @internal */
  getTransactionConfigSQL(config) {
    return sql.raw(this.getTransactionConfigChunks(config).join(" "));
  }
  /** @internal */
  setTransactionSnapshotSQL(snapshot) {
    return sql`set transaction snapshot ${snapshot}`.inlineParams();
  }
  /** @internal */
  getTransactionConfigStatements(config) {
    const statements = [];
    const chunks = this.getTransactionConfigChunks(config);
    if (chunks.length) statements.push(`set transaction ${chunks.join(" ")}`);
    if (typeof config.snapshot === "string") statements.push(this.dialect.sqlToQuery(this.setTransactionSnapshotSQL(config.snapshot)).sql);
    return statements;
  }
  setTransaction(config) {
    const chunks = this.getTransactionConfigChunks(config);
    const setOptions = chunks.length ? Effect9.asVoid(this.session.execute(sql.raw(`set transaction ${chunks.join(" ")}`))) : Effect9.void;
    if (typeof config.snapshot === "string") return Effect9.flatMap(setOptions, () => Effect9.asVoid(this.session.execute(this.setTransactionSnapshotSQL(config.snapshot))));
    return setOptions;
  }
};
var migrate = Effect9.fn("migrate")(function* (migrations, session, config) {
  const migrationsTable = typeof config === "string" ? "__drizzle_migrations" : config.migrationsTable ?? "__drizzle_migrations";
  const migrationsSchema = typeof config === "string" ? "drizzle" : config.migrationsSchema ?? "drizzle";
  yield* session.execute(sql`CREATE SCHEMA IF NOT EXISTS ${sql.identifier(migrationsSchema)}`);
  const { newDb } = yield* upgradeIfNeeded(migrationsSchema, migrationsTable, session, migrations);
  if (newDb) {
    const migrationTableCreate = sql`
			CREATE TABLE IF NOT EXISTS ${sql.identifier(migrationsSchema)}.${sql.identifier(migrationsTable)} (
				id SERIAL PRIMARY KEY,
				hash text NOT NULL,
				created_at bigint,
				name text,
				applied_at timestamp with time zone DEFAULT now()
			)
		`;
    yield* session.execute(migrationTableCreate);
  }
  const dbMigrations = yield* session.objects(sql`select id, hash, created_at, name from ${sql.identifier(migrationsSchema)}.${sql.identifier(migrationsTable)}`);
  if (typeof config === "object" && config.init) {
    if (dbMigrations.length) return yield* new MigratorInitError({ exitCode: "databaseMigrations" });
    if (migrations.length > 1) return yield* new MigratorInitError({ exitCode: "localMigrations" });
    const [migration] = migrations;
    if (!migration) return;
    yield* session.execute(sql`insert into ${sql.identifier(migrationsSchema)}.${sql.identifier(migrationsTable)} ("hash", "created_at", "name") values(${migration.hash}, ${migration.folderMillis}, ${migration.name})`);
    return;
  }
  const migrationsToRun = getMigrationsToRun({
    localMigrations: migrations,
    dbMigrations
  });
  yield* session.transaction((tx) => Effect9.gen(function* () {
    for (const migration of migrationsToRun) {
      for (const stmt of migration.sql) yield* tx.execute(sql.raw(stmt));
      yield* tx.execute(sql`insert into ${sql.identifier(migrationsSchema)}.${sql.identifier(migrationsTable)} ("hash", "created_at", "name") values(${migration.hash}, ${migration.folderMillis}, ${migration.name})`);
    }
  }));
});

// node_modules/.bun/drizzle-orm@1.0.0-rc.5-169397b+5a2a64b31368e2d8/node_modules/drizzle-orm/effect-postgres/session.js
var EffectPgSession = class extends PgEffectSession {
  static [entityKind] = "EffectPgSession";
  constructor(client, dialect, relations, options) {
    super(dialect);
    this.client = client;
    this.relations = relations;
    this.options = options;
  }
  prepareQuery(query, mode, _name, mapper, queryMetadata, cacheConfig) {
    const executor = (params) => {
      const q = this.client.unsafe(query.sql, params);
      if (mode === "arrays") return q.values;
      if (mode === "objects") return q.withoutTransform;
      return q.raw;
    };
    return new PgEffectPreparedQuery(executor, query, mapper, mode, this.options.logger, this.options.cache, queryMetadata, cacheConfig);
  }
  transaction(transaction, config) {
    const { dialect, relations } = this;
    return this.client.withTransaction(Effect10.gen({ self: this }, function* () {
      const tx = new EffectPgTransaction(dialect, this, relations);
      if (config) for (const statement of tx.getTransactionConfigStatements(config)) yield* this.client.unsafe(statement);
      return yield* transaction(tx);
    }));
  }
};
var EffectPgTransaction = class extends PgEffectTransaction {
  static [entityKind] = "EffectPgTransaction";
  transaction(transaction) {
    return this.session.transaction(transaction);
  }
};

// node_modules/.bun/drizzle-orm@1.0.0-rc.5-169397b+5a2a64b31368e2d8/node_modules/drizzle-orm/effect-core/logger.js
import * as Effect11 from "effect/Effect";
import * as Context5 from "effect/Context";
import * as Layer3 from "effect/Layer";
var EffectLogger = class EffectLogger2 extends Context5.Service()("drizzle-orm/EffectLogger", { make: Effect11.sync(() => ({ logQuery: (_query, _params) => Effect11.void })) }) {
  static [entityKind] = "drizzle-orm/EffectLogger";
  /**
  * The default layer providing a no-op logger.
  */
  static Default = Layer3.effect(EffectLogger2, EffectLogger2.make);
  /**
  * Creates an EffectLoggerShape from a standard Drizzle logger.
  *
  * @param logger - A Drizzle logger instance implementing the `Logger` interface.
  * @returns A new EffectLoggerShape that delegates to the provided Drizzle logger.
  *
  * @example
  * ```ts
  * const drizzleLogger = new DefaultLogger();
  * const effectLogger = EffectLogger.fromDrizzle(drizzleLogger);
  * ```
  */
  static fromDrizzle(logger) {
    return { logQuery: (query, params) => {
      return Effect11.sync(() => logger.logQuery(query, params));
    } };
  }
  /**
  * Creates a Layer that provides an EffectLogger from a standard Drizzle logger.
  *
  * @param logger - A Drizzle logger instance implementing the `Logger` interface.
  * @returns A Layer that provides the EffectLogger service.
  *
  * @example
  * ```ts
  * const drizzleLogger = new DefaultLogger();
  * const db = yield* PgDrizzle.make({ relations }).pipe(
  *   Effect.provide(EffectLogger.layerFromDrizzle(drizzleLogger)),
  *   Effect.provide(PgDrizzle.DefaultServices),
  * );
  * ```
  */
  static layerFromDrizzle(logger) {
    return Layer3.succeed(EffectLogger2, EffectLogger2.fromDrizzle(logger));
  }
  /**
  * A Layer that provides an EffectLogger with Effect-based logging.
  *
  * This layer logs queries using `Effect.log()` with annotations for the query
  * SQL and parameters. Use this when you want query logging integrated with
  * Effect's logging infrastructure.
  *
  * @example
  * ```ts
  * const db = yield* PgDrizzle.make({ relations }).pipe(
  *   Effect.provide(EffectLogger.layer),
  *   Effect.provide(PgDrizzle.DefaultServices),
  * );
  * ```
  */
  static layer = Layer3.succeed(EffectLogger2, { logQuery: Effect11.fn("EffectLogger.logQuery")(function* (query, params) {
    const stringifiedParams = params.map((p) => {
      try {
        return JSON.stringify(p);
      } catch {
        return String(p);
      }
    });
    yield* Effect11.log().pipe(Effect11.annotateLogs({
      query,
      params: stringifiedParams
    }));
  }) });
};

// node_modules/.bun/drizzle-orm@1.0.0-rc.5-169397b+5a2a64b31368e2d8/node_modules/drizzle-orm/effect-postgres/driver.js
import * as Effect12 from "effect/Effect";

// node_modules/.bun/drizzle-orm@1.0.0-rc.5-169397b+5a2a64b31368e2d8/node_modules/drizzle-orm/effect-core/defaults.js
import { Layer as Layer4 } from "effect";
var DefaultServices = Layer4.merge(EffectCache.Default, EffectLogger.Default);

// node_modules/.bun/drizzle-orm@1.0.0-rc.5-169397b+5a2a64b31368e2d8/node_modules/drizzle-orm/effect-postgres/driver.js
var EffectPgDatabase = class extends PgEffectDatabase {
  static [entityKind] = "EffectPgDatabase";
};
var make9 = Effect12.fn("PgDrizzle.make")(function* (config = {}) {
  const client = yield* PgClient;
  const cache = yield* EffectCache;
  const logger = yield* EffectLogger;
  const dialect = new PgDialect({
    useJitMappers: jitCompatCheck(config.jit),
    codecs: config.codecs ?? effectPgCodecs
  });
  const relations = config.relations ?? {};
  const db = new EffectPgDatabase(dialect, new EffectPgSession(client, dialect, relations, {
    logger,
    cache
  }), relations);
  db.$client = client;
  db.$cache = cache;
  if (db.$cache) db.$cache["invalidate"] = cache.onMutate;
  return db;
});
var makeWithDefaults = (config = {}) => make9(config).pipe(Effect12.provide(DefaultServices));

// apps/playground-worker/tests/integration/NativeDrizzleOperators.ts
import * as Jobs from "effect-jobs/PostgreSqlJobs";
import * as Native from "effect-jobs/PostgreSqlNative";
import { PostgreSqlApplication } from "effect-jobs/PostgreSqlTransaction";
var DrizzleProbeFailure = class extends Data4.TaggedError("DrizzleProbeFailure") {
};
var cancel = (connectionString, schema, expected, rollback = false) => Effect13.scoped(
  Effect13.gen(function* () {
    const client = yield* make7({
      url: Redacted3.make(connectionString),
      maxConnections: 2,
      minConnections: 0,
      prepare: false,
      connectTimeout: "2 seconds"
    });
    const backend = yield* Jobs.make({
      schema,
      operationResponseBudgetMillis: 500
    }).pipe(
      Effect13.provideService(
        PostgreSqlApplication,
        Native.make({ client, operationTimeoutMillis: 2e3 })
      )
    );
    const db = yield* makeWithDefaults().pipe(
      Effect13.provideService(PgClient, client)
    );
    const transaction = db.transaction(
      () => Effect13.gen(function* () {
        const result3 = yield* backend.operators.cancel(expected);
        yield* client.unsafe(
          `INSERT INTO "${schema}".drizzle_operator_receipts(job_id,xid) VALUES ($1,txid_current())`,
          [expected.jobId]
        );
        if (rollback) {
          return yield* Effect13.fail("fixture-rollback");
        }
        return result3;
      })
    ).pipe(Effect13.mapError(() => new DrizzleProbeFailure()));
    return yield* transaction;
  })
).pipe(Effect13.provide(Reactivity2.layer));
export {
  cancel
};
