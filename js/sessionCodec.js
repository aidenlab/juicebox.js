/**
 * The session wire format, decoded and — for the one form juicebox writes —
 * encoded. Every decision about what a session URL *means* lives here, and
 * nothing here reaches the network.
 *
 * The decode path was a single `async` function that did its own fetching, of
 * which two lines were I/O and ninety were format logic — and because the whole
 * thing was async and fetched for itself, **none of that format logic was
 * reachable from a test**. That, more than the duplication, is the defect this
 * module exists to fix. ADR-0006 decisions 9 and 10.
 *
 * `js/urlUtils.js` keeps only the one I/O site the decode path may need — the
 * session-URL fetch — and the internal entry point that injects it. There were
 * two until #506 retired the legacy bit.ly expansion.
 *
 * ## The decode path
 *
 * {@link decodeSession} is the one decode interface **in this repo** — Spacewalk
 * reads the same `session=` parameter with a decoder of its own, and collapsing
 * these four did not make the contract single-reader (#518). {@link WIRE_FORMATS}
 * is the one place a wire format is named: four formats, one adapter each,
 * folded in order over a shared decode context. **A fifth format is an entry in
 * that array and nothing else** — which is the acceptance criterion of #505 and
 * the reason the fold takes a context rather than four bespoke arms. Retiring
 * one is an entry there too: `juiceboxURL` was dropped by #506 and its adapter
 * stayed, now refusing rather than expanding, so a retired link fails saying so
 * instead of falling through to `query` and decoding to nothing.
 *
 * The order is not decoration. `juicebox` overwrites a config the `session`
 * adapter may have produced, and `query` overwrites both when it names a map.
 * That precedence is exactly what the previous straight-line function expressed
 * by statement order, and the golden file (#503) pins it.
 *
 * ## The encode path
 *
 * {@link encodeSession} is the inverse of {@link decodeSession} for the
 * session-JSON form — the only form juicebox emits — and `decode(encode(x))` is
 * a property test (`test/testSessionRoundTrip.js`, #507). The other three
 * accepted formats are **decode-only** by decision, not by omission: ADR-0006
 * decision 4. `session.compressedSession()` is the one caller.
 *
 * Every session written here carries a version stamp and no session read here
 * requires one — see {@link SESSION_VERSION} for what that buys and what it
 * costs. It does not weaken the identity below, because the stamp belongs to the
 * format rather than to the document and is taken off on the way in.
 *
 * The identity has one exception, asserted by that suite rather than left to be
 * discovered: browser *count* does not survive a session saved with an empty
 * panel (decision 6). It had a second until #533 — `fixDefaults`, normalization
 * sitting inside the decoder, which forced every track to `COLLAPSED` and
 * dropped the default annotation colour on the way in. That pass now lives in
 * `js/normalizeSession.js`, one stage downstream and on every entry path, and
 * the property got stricter when it moved (decision 8, #525).
 *
 * ## No I/O
 *
 * `decodeSession` fetches nothing. The loader it may need arrives as an
 * argument, so the whole path is drivable from a test with string literals.
 * Hoisting the fetching into the caller was considered and rejected in decision
 * 10: a session parameter may name a URL whose *contents* then need sniffing, so
 * a caller deciding whether more I/O is needed would need to know the format.
 *
 * The one read left inside is `File.text()`, in the `session` adapter's second
 * arm — an arm the sole caller cannot reach at all (see `testDecoderGolden.js`,
 * "the File arm is not reachable"). It gets no loader slot because inventing one
 * for a dead arm would be design work in service of nothing.
 *
 * ## What is pure, and what is not
 *
 * Everything above {@link decodeSession} — the sniff, the decode ladders, the
 * query decoders — takes a string or a plain object and returns a value: no network, no DOM, no async. Only the fold and its adapters
 * are `async`, and only because a session may name a document to fetch.
 *
 * ## The error contract
 *
 * One condition, one error: anything this module cannot decode raises a
 * `SessionDecodeError` carrying the underlying failure as `cause`. Previously
 * the same malformed input produced a different message depending on which of
 * three call sites reached it, which made a user's bug report ambiguous about
 * where their link actually failed.
 *
 * **The three arms of the `session` adapter still rethrow `cause` in the shape
 * each has always thrown** — they were three call sites in `urlUtils.js` until
 * #505 moved them here — because ADR-0006's golden file (#503) pins those
 * outward messages and neither ticket changes behaviour. Unifying what the
 * *caller* reports is a deliberate, snapshot-moving change and belongs to a
 * later ticket in the candidate; unifying what the *decoder* raises is this one.
 *
 * @see docs/adr/0006-session-wire-format-and-one-decoder.md
 * @see docs/url.md — the format specification
 */
import {BGZip} from 'igv-utils'
import State from './hicState.js'
import {parseColorScale} from './colorScaleParser.js'
import {isFile} from './fileUtils.js'

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

/**
 * The version stamped on every session juicebox writes, and the only one it
 * reads. ADR-0006 decision 7, #508.
 *
 * **A session that carries no version is v1.** Not a fallback and not a degraded
 * path — the rule, and it has to be, because every session ever saved predates
 * the field: links pasted into mail and papers years ago, session files on disk,
 * the corpus in `test/data/wireFormatCorpus.js`. Requiring the field would break
 * the entire archive to gain a check on nothing.
 *
 * **It buys nothing now.** There is one version and one reader of it. Its whole
 * value is to whoever changes the format next, who would otherwise have to
 * detect structurally what a discriminator states outright — which is exactly
 * the position this format was in until #508.
 *
 * The version belongs to the **wire format**, not to the session document:
 * {@link encodeSession} writes it and {@link takeSessionVersion} takes it off,
 * the same way the `blob:` prefix is written and read off. Nothing downstream of
 * {@link decodeSession} sees it, which is what keeps `decode(encode(x)) === x` a
 * strict identity rather than an identity with an exception.
 *
 * @see docs/url.md — "Version", where the rule is specified rather than
 *   described, since the format is a contract with users
 */
export const SESSION_VERSION = 1

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
 * Raised for every session this module refuses to write.
 *
 * The mirror of {@link SessionDecodeError}, and for the same reason: one
 * condition, one error, with the underlying failure kept as `cause`.
 */
export class SessionEncodeError extends Error {
    constructor(message, cause) {
        super(message)
        this.name = 'SessionEncodeError'
        this.cause = cause
    }
}

/**
 * Write a session as a session string — the inverse of
 * {@link decodeSessionString} for the one spelling juicebox writes.
 *
 * **One spelling, not three.** The sniff reads `blob:`, `data:` and bare JSON;
 * this writes `blob:` only. The other two are inbound spellings — a `data:`
 * share link is not a thing juicebox has ever produced, and a bare-JSON
 * *parameter* would carry braces and quotes into a query string. Taking a
 * `format` argument here would be a live encoder for a spelling nothing emits,
 * which is the same trade ADR-0006 decision 4 refuses at the format level.
 *
 * **No version stamp here.** The stamp goes on in {@link encodeSession}, one
 * layer up, because that is the layer its reader sits in: the `session=` adapter
 * consumes it. Keeping both halves at the same layer is what makes this function
 * and {@link decodeSessionString} exact inverses — this one compresses a
 * document, that one parses one back, and neither has an opinion about what is
 * in it.
 *
 * @param {object} session - a session document, as `registry.toJSON()` writes
 *   one — a plain object. A `State` instance *in* it encodes as the object
 *   `State.toJSON()` writes, because that is what `JSON.stringify` does with it.
 * @returns {string}
 * @throws {SessionEncodeError} if the document is one JSON cannot express
 */
export function encodeSessionString(session) {

    let json
    try {
        json = JSON.stringify(session)
    } catch (e) {
        throw new SessionEncodeError('Session cannot be written as JSON', e)
    }

    return `blob:${BGZip.compressString(json)}`
}

/**
 * Write a session as the query parameter that carries it — the inverse of
 * {@link decodeSession} for the one format juicebox emits.
 *
 * **One encoder, not four.** The other three accepted formats stay decode-only:
 * writing encoders for them would resurrect a live encoder for formats nothing
 * has written in years, and we would then own them forever. ADR-0006 decision 4.
 *
 * The return value is the parameter, not a whole URL — `session=blob:…` — which
 * is the shape juicebox-web appends to its base href, and which
 * {@link decodeSession} accepts directly. Nothing needs escaping on the way in:
 * `BGZip` writes the URL-safe base64 alphabet unpadded, so the payload carries
 * no `&`, `#` or second `=` for the query splitter to eat. That is a dependency
 * of the round trip — the splitter reads a value only as far as its second `=` —
 * and `test/testSessionRoundTrip.js` asserts it.
 *
 * **The version is stamped here**, and here only: this is the one place juicebox
 * writes the `session=` format, and the inverse of the one place that reads a
 * version off it ({@link SESSION_VERSION}, #508). The caller's document is not
 * touched — the stamp goes into the copy that is serialized — and a `version`
 * already on the document is overwritten rather than honoured, because what
 * juicebox writes is what juicebox writes.
 *
 * A session is a plain document here, as `registry.toJSON()` writes one; a
 * top-level `toJSON()` method on the object itself is not consulted.
 *
 * @param {object} session
 * @returns {string}
 * @throws {SessionEncodeError}
 */
export function encodeSession(session) {
    return `session=${encodeSessionString({...session, version: SESSION_VERSION})}`
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

// ---------------------------------------------------------------------------
// Query strings
//
// Everything from here to the end of `decodeQuery` is a verbatim move from
// `urlUtils.js`. Its `var` and its semicolons do not match the rest of the file,
// deliberately: #503's golden file is the only thing standing between this
// refactor and a silent change to a format users have pasted into papers, and a
// verbatim move is the one kind of move it can vouch for. Restyling belongs to a
// commit that moves nothing.
//
// The URL-shortcut expansion used to live above this line, because `decodeQuery`
// expanded at three call sites. It is `js/normalizeSession.js`'s now (#534): a
// `*s3/` prefix is a spelling of a URL rather than a wire format, and every
// entry path meets the normalize stage while only this one meets the decoder.
// So a shortcut leaves this module unexpanded and is expanded one stage later --
// visible in `testDecoderGolden.js`, invisible in `testConfigGolden.js`.
// ---------------------------------------------------------------------------

function extractQuery(uri) {
    var i1, i2, i, j, s, query, tokens;

    query = {};
    i1 = uri.indexOf("?");
    i2 = uri.lastIndexOf("#");
    const i3 = uri.indexOf("=");
    if (i1 > i3) i1 = -1;

    if (i2 < 0) i2 = uri.length;
    for (i = i1 + 1; i < i2;) {

        j = uri.indexOf("&", i);
        if (j < 0) j = i2;

        s = uri.substring(i, j);
        tokens = s.split("=", 2);
        if (tokens.length === 2) {
            query[tokens[0]] = tokens[1];
        }

        i = j + 1;

    }
    return query;
}

function paramDecode(str, uriDecode) {

    if (uriDecode) {
        return decodeURIComponent(str);   // Still more backward compatibility
    } else {
        var s = replaceAll(str, '%26', '&');
        s = replaceAll(s, '%20', ' ');
        s = replaceAll(s, '+', ' ');
        s = replaceAll(s, "%7C", "|");
        s = replaceAll(s, "%23", "#");
        s = replaceAll(s, "%3F", "?");
        s = replaceAll(s, "%3D", "=");
        return s;
    }
}

function replaceAll(str, target, replacement) {
    return str.split(target).join(replacement);
}

/**
 * Extend config properties with query parameters
 *
 * @param query
 * @param config
 */
function decodeQuery(query, uriDecode) {

    const config = {};

    let hicUrl = query["hicUrl"];
    const name = query["name"];
    let stateString = query["state"];
    let colorScale = query["colorScale"];
    let trackString = query["tracks"];
    const selectedGene = query["selectedGene"];
    const nvi = query["nvi"];

    let controlUrl = query["controlUrl"];
    const controlName = query["controlName"];
    const displayMode = query["displayMode"];
    const controlNvi = query["controlNvi"];
    const cycle = query["cycle"];

    if (hicUrl) {
        hicUrl = paramDecode(hicUrl, uriDecode);
        config.url = hicUrl;

    }
    if (name) {
        config.name = paramDecode(name, uriDecode);
    }
    if (controlUrl) {
        controlUrl = paramDecode(controlUrl, uriDecode);
        config.controlUrl = controlUrl;
    }
    if (controlName) {
        config.controlName = paramDecode(controlName, uriDecode);
    }

    if (stateString) {
        stateString = paramDecode(stateString, uriDecode);
        config.state = State.parse(stateString);
    }
    if (colorScale) {
        colorScale = paramDecode(colorScale, uriDecode);
        config.colorScale = parseColorScale(colorScale);
    }

    if (displayMode) {
        config.displayMode = paramDecode(displayMode, uriDecode);
    }

    if (trackString) {
        trackString = paramDecode(trackString, uriDecode);
        config.tracks = destringifyTracksV0(trackString);

        // If an oAuth token is provided append it to track configs.
        if (config.tracks && config.oauthToken) {
            config.tracks.forEach(function (t) {
                t.oauthToken = config.oauthToken;
            })
        }
    }

    if (selectedGene) {
        config.selectedGene = selectedGene;
    }

    config.cycle = cycle;

    if (nvi) {
        config.nvi = paramDecode(nvi, uriDecode);
    }
    if (controlNvi) {
        config.controlNvi = paramDecode(controlNvi, uriDecode);
    }

    return config;

    function destringifyTracksV0(tracks) {

        const trackStringList = tracks.split("|||");
        const configList = [];
        for (let trackString of trackStringList) {

            const tokens = trackString.split("|");
            const color = tokens.pop();
            let url = tokens.length > 1 ? tokens[0] : trackString;
            if (url && url.trim().length > 0 && "undefined" !== url) {
                const trackConfig = {url: url};

                if (tokens.length > 1) {
                    trackConfig.name = replaceAll(tokens[1], "$", "|");
                }

                if (tokens.length > 2) {
                    const dataRangeString = tokens[2];
                    if (dataRangeString.startsWith("-")) {
                        const r = dataRangeString.substring(1).split("-");
                        trackConfig.min = -parseFloat(r[0]);
                        trackConfig.max = parseFloat(r[1]);
                    } else {
                        const r = dataRangeString.split("-");
                        trackConfig.min = parseFloat(r[0]);
                        trackConfig.max = parseFloat(r[1]);
                    }
                }

                if (color) {
                    trackConfig.color = color;
                }

                configList.push(trackConfig);
            }
        }
        return configList;
    }

}

// ---------------------------------------------------------------------------
// The wire formats
// ---------------------------------------------------------------------------

/**
 * Report a session that would not decode, in the shape the arm naming `origin`
 * has always reported it. Two arms, one shape, one noun apart.
 *
 * `cause` is the failure underneath the codec's single `SessionDecodeError`, and
 * is not always an `Error` -- `BGZip` rejects a corrupt payload with a bare
 * string, whose `message` is `undefined`. That `undefined` reaches the user
 * today; #521 is where it stops.
 */
function parseFailure(origin, e) {
    console.error(`Error parsing session ${origin}:`, e.cause);
    return new Error(`Failed to parse session ${origin}: ${e.cause?.message}`);
}

/**
 * Take the version off a decoded session document — the read half of
 * {@link SESSION_VERSION}, and the inverse of the stamp {@link encodeSession}
 * writes.
 *
 * Three rules:
 *
 * 1. **No version means v1**, so the document is returned exactly as it arrived,
 *    with nothing logged. This is the common case forever, not a fallback.
 * 2. **{@link SESSION_VERSION} is accepted and consumed** — taken off rather
 *    than passed on, because a version describes the wire format and not the
 *    session.
 * 3. **Anything else is refused, by name.** A session from a future juicebox may
 *    spell fields this reader would misread, so half-decoding it into a view the
 *    user never saved is worse than saying what happened. Quoting the version
 *    lets a bug report say which juicebox wrote the link.
 *
 * Only the `session=` adapter calls this: the braced legacy forms are query
 * strings with nowhere to put a version, and nothing has written one in years.
 * A copy comes back rather than a mutated argument, which is the same courtesy
 * the encoder extends to its caller's document.
 *
 * @param {object} session - a decoded session document
 * @returns {object} the document, without its version field
 * @throws {SessionDecodeError} if the version is one this juicebox cannot read
 */
function takeSessionVersion(session) {

    if (null === session || typeof session !== 'object' || !Object.hasOwn(session, 'version')) {
        return session
    }

    const {version, ...document} = session

    if (SESSION_VERSION !== version) {
        throw new SessionDecodeError(
            `Session was written in wire format version ${JSON.stringify(version)}, and this ` +
            `juicebox reads version ${SESSION_VERSION}. Update juicebox to open it. See docs/url.md.`)
    }

    return document
}

/**
 * @typedef {object} DecodeContext
 * @property {object} query - the query parameters, as `extractQuery` read them.
 *   Context rather than an argument because an adapter may rewrite it for the
 *   ones below: `juiceboxURL` did exactly that until #506 retired it, and it is
 *   the shape the fold is built for rather than a quirk of that one format.
 * @property {object|undefined} config - the session config decoded so far. A
 *   later adapter that owns the input overwrites an earlier one's answer.
 * @property {object|undefined} queryConfig - what the query parameters alone
 *   decode to, kept because the `selectedGene` reconciliation below needs it
 *   whether or not the query named a map.
 * @property {SessionLoaders} loaders
 */

/**
 * @typedef {object} SessionLoaders
 * @property {function(string): Promise<string>} [loadString] - fetches the
 *   document a `session=<url>` names. The only loader: `expandUrl` went with the
 *   bit.ly expansion in #506.
 */

/**
 * @typedef {object} WireFormatAdapter
 * @property {string} format - the parameter family this adapter owns
 * @property {function(DecodeContext): boolean} appliesTo
 * @property {function(DecodeContext): Promise<void>} decode - writes its answer
 *   into the context
 */

/**
 * One adapter per wire format, applied in order. **This array is the one place a
 * format is named**; a fifth is an entry here.
 *
 * @type {WireFormatAdapter[]}
 */
export const WIRE_FORMATS = [

    /**
     * `?session=` — the only form juicebox still writes, and the only one that
     * may need a second read. Three arms, one decoder: they differ in where the
     * session text comes from — the parameter itself, a File, or a fetched
     * document — and in how they report a failure. The reporting is preserved
     * verbatim, because #503's golden file pins those messages; collapsing the
     * three outward messages into one is #521.
     */
    {
        format: 'session',
        appliesTo: ({query}) => query.hasOwnProperty('session'),
        decode: async ctx => {
            const sessionValue = ctx.query.session

            if (isCompressedSession(sessionValue)) {
                // No wrapping here, and never has been: a corrupt share link
                // rejects with whatever the decompressor threw, which is a bare
                // string rather than an Error.
                try {
                    ctx.config = decodeSessionString(sessionValue)
                } catch (e) {
                    throw e.cause ?? e
                }
            } else if (isFile(sessionValue)) {
                const sessionText = await sessionValue.text()
                try {
                    ctx.config = decodeSessionString(sessionText)
                } catch (e) {
                    throw parseFailure('file', e)
                }
            } else if (typeof sessionValue === 'string') {
                // A session URL, or a local file path. The fetched document is
                // itself sniffed -- it may be plain JSON or either compressed
                // form -- which is why this read cannot be hoisted out of the
                // decoder (ADR-0006 decision 10).
                const loadString = requireLoader(ctx, 'loadString', 'a session URL')
                try {
                    const sessionText = await loadString(sessionValue)
                    try {
                        ctx.config = decodeSessionString(sessionText)
                    } catch (e) {
                        throw parseFailure('from URL/file', e)
                    }
                } catch (e) {
                    console.error("Error loading session from URL/file:", e);
                    throw new Error(`Failed to load session from URL/file: ${e.message}`);
                }
            }

            // Outside the arms on purpose, and after all three. Outside, because
            // each arm rewraps what it catches -- the URL arm's wrapper reads
            // `cause.message`, which a version refusal does not have, so a check
            // inside would report `undefined` to the user (#521). After, because
            // the version is a property of the document, not of where it was
            // read from: a session named by a URL is version-checked exactly as
            // one carried in the parameter.
            if (ctx.config) {
                ctx.config = takeSessionVersion(ctx.config)
            }
        },
    },

    /**
     * `?juiceboxURL=` — **retired**. A bit.ly link standing for a whole juicebox
     * href; expanding it replaced the query the adapters below read. ADR-0006
     * decision 1 named this the one deliberate exception to the frozen
     * compatibility contract, and #506 removed the expansion.
     *
     * The entry stays, and what it does now is refuse. Deleting it would leave
     * `?juiceboxURL=…` matching no adapter, so it would fall through to `query`,
     * decode to no config, and the host would silently show whatever it was
     * configured with — a link that does nothing, with nothing said. A retired
     * format is still a format the decoder has an answer for; this is the
     * answer.
     *
     * The grounds for the removal are ADR-0006 decision 1's, and are recorded
     * there rather than repeated here.
     */
    {
        format: 'juiceboxURL',
        appliesTo: ({query}) => query.hasOwnProperty('juiceboxURL'),
        decode: async () => {
            throw new SessionDecodeError(
                'juiceboxURL= links are no longer supported: the bit.ly expansion was ' +
                'removed in #506 (ADR-0006 decision 1). Open the link in a browser to ' +
                'read the juicebox URL it stands for, and use that. See docs/url.md.')
        },
    },

    /**
     * `?juicebox={…},{…}` and its compressed spelling `?juiceboxData=` — one
     * braced query string per browser. Read-only legacy inbound: nothing has
     * written either in years.
     */
    {
        format: 'juicebox',
        appliesTo: ({query}) =>
            query.hasOwnProperty('juicebox') || query.hasOwnProperty('juiceboxData'),
        decode: async ctx => {
            const {query} = ctx
            let q;
            if (query.hasOwnProperty("juiceboxData")) {
                q = BGZip.uncompressString(query["juiceboxData"])
            } else {
                q = query["juicebox"];
                if (q.startsWith("%7B")) {
                    q = decodeURIComponent(q);
                }
            }

            q = q.substr(1, q.length - 2);  // Strip leading and trailing bracket
            const parts = q.split("},{");
            const browsers = [];
            for (let p of parts) {
                const qObj = extractQuery(decodeURIComponent(p));
                browsers.push(decodeQuery(qObj))
            }
            ctx.config = {browsers};
        },
    },

    /**
     * `?hicUrl=&state=&tracks=` — the parameter form.
     *
     * The one adapter whose `appliesTo` is unconditional, and it has to be: its
     * decode is also what the `selectedGene` reconciliation reads, whether or
     * not the query named a map. It claims the session only when it does.
     */
    {
        format: 'query',
        appliesTo: () => true,
        decode: async ctx => {
            const uriDecode = true;
            ctx.queryConfig = decodeQuery(ctx.query, uriDecode)
            if (ctx.queryConfig.url) {
                ctx.config = ctx.queryConfig
            }
        },
    },
]

function requireLoader(ctx, name, what) {
    const loader = ctx.loaders[name]
    if (typeof loader !== 'function') {
        throw new Error(`decodeSession was given no ${name}, and this session names ${what}`)
    }
    return loader
}

/**
 * Decode a URL to the session config it encodes, whichever wire format it is in.
 *
 * @param {string} queryString - a whole href or query string, exactly as the
 *   caller received it from `window.location.href`
 * @param {SessionLoaders} [loaders] - the I/O this decoder will not do itself.
 *   Both are optional: a format that needs one and was not given it says so.
 * @returns {Promise<object|undefined>} the session config, or `undefined` when
 *   nothing in the URL was ours
 */
export async function decodeSession(queryString, loaders = {}) {

    const ctx = {query: extractQuery(queryString), config: undefined, queryConfig: undefined, loaders}

    for (const adapter of WIRE_FORMATS) {
        if (adapter.appliesTo(ctx)) {
            await adapter.decode(ctx)
        }
    }

    // `selectedGene` used to leave `decodeQuery` as a write to a page-scoped
    // global, which is how it reached `restoreSession` from the two paths that
    // do not put it at the top level: a query string carrying the gene beside a
    // `session=`, and the legacy `juicebox=` form, where it sits inside each
    // browser's config. It now rides the session config instead, so it can land
    // on one registry (#481).
    //
    // **Half of that reconciliation is here and half is not.** This half reads a
    // *query parameter*, which is format knowledge and so cannot leave the
    // decoder. The other half -- hoisting a gene named inside one of the
    // browsers -- is a reading of a session document, and #533 moved it to
    // `normalizeSession`, where every entry path meets it rather than only this
    // one. Precedence is unchanged, because this runs first: the session's own
    // value wins, then the query parameter, then the last browser to name one.
    //
    // Not preserved: `?selectedGene=` on a URL naming no map and no session at
    // all. There being no session config to ride, the gene is dropped rather
    // than reaching whatever config the host passed `init()`. juicebox never
    // writes such a URL -- every URL it produces carries the gene inside the
    // session it also writes.
    if (ctx.config && undefined === ctx.config.selectedGene) {
        // `?.` rather than a bare dereference: `queryConfig` is set by the last
        // adapter, so it is only guaranteed by that adapter's `appliesTo` being
        // unconditional. Reading it defensively keeps this line's correctness
        // independent of the registry's contents.
        const selectedGene = ctx.queryConfig?.selectedGene;
        if (selectedGene) {
            ctx.config.selectedGene = selectedGene;
        }
    }

    // No `fixDefaults` here any more. The track defaults it applied were
    // normalization sitting inside the decoder, so they reached a session that
    // arrived as a URL and skipped one handed straight to `restoreSession`.
    // #533 moved them to `normalizeSession.applyTrackDefaults`, which every entry
    // path passes through. What this module returns is now a decoded document
    // and nothing else -- which is what makes `decode(encode(x))` a strict
    // identity over tracks as well (ADR-0006 decision 8, #525).

    return ctx.config
}
