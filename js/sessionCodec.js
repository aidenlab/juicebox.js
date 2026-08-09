/**
 * The session wire format, decoded — the pure half.
 *
 * Everything here takes a string (or a plain object) and returns a value. No
 * network, no DOM, no async, no `State` mutation. That is the point: the decode
 * decisions this module owns were previously written two and three times each,
 * inside async wrappers that could only be exercised through `extractConfig`
 * with a stubbed loader, and so were reachable from no test at all.
 *
 * ADR-0006 decision 9. `js/urlUtils.js` keeps only URL-shortcut and
 * query-string concerns, which is the one job its name describes.
 *
 * ## The error contract
 *
 * One condition, one error: anything this module cannot decode raises a
 * `SessionDecodeError` carrying the underlying failure as `cause`. Previously
 * the same malformed input produced a different message depending on which of
 * three call sites reached it, which made a user's bug report ambiguous about
 * where their link actually failed.
 *
 * **The three call sites in `urlUtils.js` still rethrow `cause` in the shape
 * each has always thrown**, because ADR-0006's golden file (#503) pins those
 * outward messages and this ticket changes no behaviour. Unifying what the
 * *caller* reports is a deliberate, snapshot-moving change and belongs to a
 * later ticket in the candidate; unifying what the *decoder* raises is this one.
 *
 * @see docs/adr/0006-session-wire-format-and-one-decoder.md
 * @see docs/url.md — the format specification
 */
import {BGZip} from 'igv-utils'
import State from './hicState.js'

/**
 * The shapes a session string can arrive in.
 *
 * `BLOB` and `DATA_URI` are told apart because the sniff is the one place that
 * can still see the difference — they are handled identically downstream (both
 * prefixes are five characters and both carry the same compressed payload), and
 * naming them separately keeps that an observation rather than a coincidence.
 *
 * There is no `STATE_TOKEN` member. A bare state token (`3,3,6,…`) is a wire
 * format in its own right, but it never arrives as a *session* string — it
 * arrives as the `state=` query parameter, already discriminated by position,
 * and is decoded by {@link decodeState}. Adding a branch here for it would
 * invent a form nothing writes and nothing reads.
 */
export const SessionFormat = {
    BLOB: 'blob',
    DATA_URI: 'data-uri',
    JSON: 'json',
}

const COMPRESSED_PREFIXES = {
    'blob:': SessionFormat.BLOB,
    'data:': SessionFormat.DATA_URI,
}

/**
 * Raised for every input this module refuses.
 *
 * `cause` is the failure underneath — a `SyntaxError` from `JSON.parse`, or
 * whatever the decompressor threw, which is not always an `Error`: `BGZip`
 * rejects a corrupt payload with a bare string.
 */
export class SessionDecodeError extends Error {
    constructor(message, cause) {
        super(message)
        this.name = 'SessionDecodeError'
        this.cause = cause
    }
}

/**
 * Decide what a session string is, and split off the part that carries the
 * payload.
 *
 * @param {string} text - a session string, from a URL parameter, a fetched
 *   document or a file's contents
 * @returns {{format: string, payload: string}} `format` is a
 *   {@link SessionFormat} member; `payload` is the compressed body for the two
 *   compressed forms, and the whole string for `JSON`
 * @throws {SessionDecodeError} if `text` is not a string
 */
export function sniffSessionFormat(text) {

    if (typeof text !== 'string') {
        throw new SessionDecodeError(`Session must be a string, got ${typeof text}`)
    }

    for (const [prefix, format] of Object.entries(COMPRESSED_PREFIXES)) {
        if (text.startsWith(prefix)) {
            return {format, payload: text.substring(prefix.length)}
        }
    }

    return {format: SessionFormat.JSON, payload: text}
}

/**
 * Is this session string one of the compressed forms?
 *
 * The predicate behind the sniff, exported because `extractConfig` needs the
 * same question answered before it knows which of its arms to enter — and
 * answering it with a fourth copy of the prefix literals is exactly what this
 * module exists to stop.
 *
 * Deliberately no type check: a non-string raises the same `TypeError` here
 * that the inline literals raised, on a path the golden file records as
 * unreachable.
 *
 * @param {string} text
 * @returns {boolean}
 */
export function isCompressedSession(text) {
    return Object.keys(COMPRESSED_PREFIXES).some(prefix => text.startsWith(prefix))
}

/**
 * Decode a session string to the session config it encodes.
 *
 * The whole ladder: sniff, decompress if compressed, parse. Every failure —
 * a corrupt compressed payload, a body that is not JSON, a non-string argument
 * — comes back as a {@link SessionDecodeError}.
 *
 * The message names the form that failed to read, so it varies with the *input*
 * and never with which caller reached it. That is the distinction the single
 * error contract is about: today the same malformed string produced a different
 * message depending on the path, which made a bug report ambiguous about where
 * the link actually failed.
 *
 * @param {string} text
 * @returns {object} the decoded session config
 * @throws {SessionDecodeError}
 */
export function decodeSessionString(text) {

    const {format, payload} = sniffSessionFormat(text)

    let json
    if (format === SessionFormat.JSON) {
        json = payload
    } else {
        try {
            json = BGZip.uncompressString(payload)
        } catch (e) {
            throw new SessionDecodeError(`Session is not a readable ${format}`, e)
        }
    }

    try {
        return JSON.parse(json)
    } catch (e) {
        throw new SessionDecodeError('Session is not valid JSON', e)
    }
}

/**
 * Decode the `state` a config carries, whichever of its two spellings it uses.
 *
 * A state reaches a config either as the token string from a `state=` query
 * parameter or as the object `State.toJSON()` writes into a session. Both are
 * live, and a config carrying neither falls back to the default view.
 *
 * This ladder was written twice — `dataLoader.loadHicFile` and
 * `dataLoader.loadLiveContactMap` — and the two copies had drifted: only the
 * first had the unknown-type rung, so a `state` that was neither string nor
 * object reached `State.parse` on the live path and crashed there instead of
 * falling back. The rung is restored here for both.
 *
 * Reporting the unknown type is the caller's job, not this module's — the
 * original copy raised an `alert`, which is exactly the kind of thing that
 * makes a decoder untestable.
 *
 * @param {string|object|undefined} value - `config.state`. Absent or empty
 *   yields the default view, which is the truthiness guard both call sites
 *   wrote around the ladder; delegating it here keeps `''` and `0` out of
 *   `State.parse`, where they decode to a view of `NaN`.
 * @param {object} [config] - passed through to `State.default`, which **ignores
 *   it** — a known defect (`hicState.js`, `State.default(configOrUndefined)`),
 *   filed separately per ADR-0006's consequences. Threaded anyway so that
 *   fixing it there fixes it for both call sites at once.
 * @param {function(*): void} [onUnknownType] - called with `value` when it is
 *   neither a string nor an object; the default view is returned either way
 * @returns {State}
 */
export function decodeState(value, config, onUnknownType = () => {}) {

    if (!value) {
        return State.default(config)
    }

    if (typeof value === 'string') {
        return State.parse(value)
    }

    if (typeof value === 'object') {
        return State.fromJSON(value)
    }

    onUnknownType(value)

    return State.default(config)
}
