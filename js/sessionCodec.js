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
 * There is no read left inside at all. There was one until #519 — `File.text()`,
 * in a `session` adapter arm for a `File` value that no caller could produce.
 * With it gone, every byte this module decodes arrives either in the string it
 * was handed or through the injected loader.
 *
 * ## What is pure, and what is not
 *
 * Everything above {@link decodeSession} — the sniff, the decode ladders, the
 * query decoders — takes a string or a plain object and returns a value: no
 * network, no DOM, no async. Only the fold and its adapters are `async`, and
 * only because a session may name a document to fetch.
 *
 * ## The error contract
 *
 * One condition, one error, one shape: anything this module cannot decode
 * raises a `SessionDecodeError` carrying the underlying failure as `cause`, and
 * anything that leaves the `session` adapter has been through
 * {@link sessionFailure} — so a malformed session reports the same way whichever
 * arm fetched it, naming both what would not decode and where the session came
 * from. Before, the same input produced a different message depending on which
 * path reached it (and, down one of them, a value that was
 * not an `Error` at all), which made a user's bug report ambiguous about where
 * their link had actually failed. #504 unified what the decoder *raises*; #521
 * unified what the caller *reports*, and moved four golden snapshots doing it.
 *
 * @see docs/adr/0006-session-wire-format-and-one-decoder.md
 * @see docs/url.md — the format specification
 */
import {BGZip} from 'igv-utils'
import State from './hicState.js'
import {parseColorScale} from './colorScaleParser.js'

/**
 * The shapes a session string can arrive in.
 *
 * `BLOB` and `DATA_URI` are told apart because the sniff is the one place that
 * can still see the difference — both prefixes are five characters and both
 * usually carry the same compressed payload, and naming them separately keeps
 * that an observation rather than a coincidence. It stopped being *only* an
 * observation with ADR-0011 decision 2: `DATA_URI` now covers a second body,
 * `application/gzip;base64,…`, which {@link decodeSessionString} routes
 * elsewhere. `BLOB` covers one body and always has.
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
 * The marker that tells a *real* data URI from juicebox's `data:`-prefixed BGZip
 * payload — `data:application/gzip;base64,…`, which carries gzipped bytes where
 * the other carries `BGZip.compressString` output.
 *
 * Both spellings start `data:`, so the five-character prefix cannot tell them
 * apart and the body has to be looked at. Matching the media-type fragment
 * rather than the whole prefix is what Spacewalk's decoder does
 * (`src/sessionURLCodec.js`), and this test was written to accept exactly what
 * that one accepts — the point of admitting the form at all.
 *
 * @see docs/adr/0011-session-string-is-the-cross-host-contract.md decision 2
 */
const GZIP_DATA_URI_MARKER = '/gzip;base64'

/**
 * Raised for every input this module refuses.
 *
 * `cause` is the failure underneath — a `SyntaxError` from `JSON.parse`, or
 * whatever the decompressor threw, which is not always an `Error`: `BGZip`
 * rejects a corrupt payload with a bare string.
 *
 * `source` says where the session came from — a key of {@link SESSION_SOURCES}
 * — and is carried by the one a caller sees, the error {@link sessionFailure}
 * writes. It is a constructor parameter rather than a field stamped on
 * afterwards because it is the half of the report a caller is invited to branch
 * on, and a field the type does not declare is a field the next reader has to
 * discover. Absent on the errors raised *inside* the decode ladder, which
 * describe a string and cannot know where it was read from.
 */
export class SessionDecodeError extends Error {
    constructor(message, cause, source) {
        super(message)
        this.name = 'SessionDecodeError'
        this.cause = cause
        this.source = source
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
 * Un-gzip a `data:application/gzip;base64,…` session string to its JSON text.
 *
 * `BGZip.decodeDataURI` hands back the inflated **bytes**, so the last step is
 * ours. They are decoded as UTF-8 rather than byte-by-byte through
 * `String.fromCharCode`, which is what Spacewalk does: the two agree on every
 * ASCII payload and this one is right for the rest — a session naming a sample
 * with an accent in it survives the round trip.
 *
 * @param {string} text - the whole session string, `data:` prefix included
 * @returns {string} the session JSON
 */
function decodeGzipDataURI(text) {
    const inflated = BGZip.decodeDataURI(text)
    return typeof inflated === 'string' ? inflated : new TextDecoder().decode(inflated)
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
    } else if (format === SessionFormat.DATA_URI && payload.includes(GZIP_DATA_URI_MARKER)) {
        // A real data URI, and the one arm that reads the *whole* string rather
        // than the sniffed payload: `decodeDataURI` parses the `data:` prefix
        // itself. Ahead of the raw-payload path because both spellings sniff as
        // DATA_URI and only this one holds gzipped bytes.
        //
        // juicebox has never written this form; it is accepted because
        // Spacewalk's decoder reads it under the same parameter name and the
        // sent set is not enumerable from here (ADR-0011 decision 2).
        try {
            json = decodeGzipDataURI(text)
        } catch (e) {
            throw new SessionDecodeError(`Session is not a readable ${format}`, e)
        }
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
 * The default view is config-independent, so nothing about the config reaches
 * it. The `config` this used to take and thread through to `State.default` was
 * ignored there, and is gone from both (#510).
 *
 * @param {string|object|undefined} value - `config.state`. Absent or empty
 *   yields the default view, which is the truthiness guard both call sites
 *   wrote around the ladder; delegating it here keeps `''` and `0` out of
 *   `State.parse`, where they decode to a view of `NaN`.
 * @param {function(*): void} [onUnknownType] - called with `value` when it is
 *   neither a string nor an object; the default view is returned either way
 * @returns {State}
 */
export function decodeState(value, onUnknownType = () => {}) {

    if (!value) {
        return State.default()
    }

    if (typeof value === 'string') {
        return State.parse(value)
    }

    if (typeof value === 'object') {
        return State.fromJSON(value)
    }

    onUnknownType(value)

    return State.default()
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
// So a shortcut leaves this module unexpanded and is expanded one stage later:
// `testDecoderGolden.js` moved to record that, and `testConfigGolden.js`'s query
// columns -- what a browser actually ends up holding -- did not move at all.
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

                // An empty third field means *no data range*, and it is the
                // common shape -- every harvested four-field track writes
                // `...|name||colour`. `"".split("-")` is `[""]`, so reading one
                // anyway gave `min: NaN, max: NaN` and handed a track that would
                // otherwise autoscale a range it cannot use. #515.
                if (tokens.length > 2 && tokens[2].trim().length > 0) {
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
 * Where a session came from, spelled for a user. The keys are the vocabulary a
 * caller branches on and the values are what the message says; both are here so
 * that the arms cannot drift into separate ways of naming the same thing again.
 *
 * There were three until #519 removed a `File` arm no caller could reach.
 */
export const SESSION_SOURCES = {
    parameter: 'the session= parameter',
    url: 'a session URL',
}

/**
 * The one outward shape for a session that will not decode. #521.
 *
 * Until this ticket each arm reported in the shape it happened to have grown:
 * the parameter arm rethrew `cause` untouched — a bare **string** from `BGZip`,
 * so `name` and `message` were both `undefined` and what escaped `extractConfig`
 * was not an `Error` at all — while the File and URL arms wrote one sentence and
 * two respectively (the File arm is gone as of #519, having never been
 * reachable). The same malformed input therefore reported differently
 * depending on which path reached it, and a user's bug report could not say
 * where their link had actually failed.
 *
 * What comes out now is always a `SessionDecodeError` carrying **two facts in
 * one message**: what would not decode, and where the session came from. The
 * *what* is the codec's own reason ({@link decodeSessionString} and
 * {@link takeSessionVersion} raise one for every condition), which is why this
 * reads `e.message` and not `e.cause?.message` — the reason is always present
 * and always a string, where the underlying failure is neither. The underlying
 * failure is not lost: it is quoted in parentheses when it says anything, and
 * stays reachable through the `cause` chain either way.
 *
 * @param {string} source - a key of {@link SESSION_SOURCES}
 * @param {SessionDecodeError} e - the codec's reason for refusing. An arm that
 *   fails before the codec is reached — the URL arm, whose fetch can fail —
 *   states its own reason as one of these, so that every path through here has
 *   a *what* to report and not just a cause.
 * @returns {SessionDecodeError} to throw
 */
function sessionFailure(source, e) {

    const failure = new SessionDecodeError(
        `Could not decode the session from ${SESSION_SOURCES[source]}: ${e.message}${describeCause(e.cause)}`,
        e, source)

    console.error(failure.message, e)

    return failure
}

/**
 * Quote a failure that is not necessarily an `Error` — `BGZip` rejects a corrupt
 * payload with a bare string — as a parenthetical, or as nothing when there is
 * nothing underneath. A version refusal has no cause, and reads better without
 * an empty pair of brackets after it.
 */
function describeCause(cause) {
    const described = undefined === cause || null === cause
        ? ''
        : (cause instanceof Error ? cause.message : String(cause))
    return '' === described ? '' : ` (${described})`
}

/**
 * Decode one session string, reporting a refusal as coming from `source`.
 *
 * The arms differ in where their text comes from and in nothing else, so this is
 * what they have in common written once rather than once per arm — which is the
 * "one shape" of #521 made structural instead of maintained by hand.
 */
function decodeFrom(source, text) {
    try {
        return decodeSessionString(text)
    } catch (e) {
        throw sessionFailure(source, e)
    }
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
     * may need a second read. Two arms, one decoder: they differ in where the
     * session text comes from — the parameter itself, or a fetched document —
     * and in nothing else. **They used to differ in how they reported a failure
     * too**; #521 collapsed that into the one shape {@link sessionFailure}
     * writes, which is why each arm now does no more than name where its text
     * came from.
     *
     * There was a third, for a `session` value that was a `File`. Nothing could
     * reach it — `extractQuery` can only produce strings — and #519 removed it
     * along with the row in `docs/url.md` it was mistaken for. A host opening a
     * session file parses it and calls `restoreSession`; a `File` never arrives
     * in a URL, so a query-parameter adapter was the wrong seam for one.
     */
    {
        format: 'session',
        appliesTo: ({query}) => query.hasOwnProperty('session'),
        decode: async ctx => {
            const sessionValue = ctx.query.session
            let source

            // Two arms, and this is the one that decodes what it was handed:
            // the value is the session text, so nothing more is read.
            //
            // The type test guards the sniff as well as selecting the arm --
            // `isCompressedSession` raises a bare `TypeError` on a non-string --
            // which is why it comes first and why `||` rather than a branch of
            // its own: short-circuit is what keeps the sniff from seeing one. A
            // non-string is unreachable from `extractConfig`, whose parser can
            // only produce strings, and is reported anyway: the value came off
            // the parameter, and the ladder says what is wrong with it
            // ("Session must be a string, got ...") in the one shape rather
            // than as a bare `TypeError`.
            if (typeof sessionValue !== 'string' || isCompressedSession(sessionValue)) {
                source = 'parameter'
                ctx.config = decodeFrom(source, sessionValue)
            } else {
                // A session URL, or a local file path. The fetched document is
                // itself sniffed -- it may be plain JSON or either compressed
                // form -- which is why this read cannot be hoisted out of the
                // decoder (ADR-0006 decision 10).
                source = 'url'
                const loadString = requireLoader(ctx, 'loadString', 'a session URL')

                // Two reads, two catches, in sequence rather than nested. Nested
                // is how the double-wrapped message arose -- the outer catch saw
                // the inner one's rethrow and wrapped it a second time -- and it
                // also folded two different repairs, a link that does not resolve
                // and a document that is not a session, into one report.
                let sessionText
                try {
                    sessionText = await loadString(sessionValue)
                } catch (e) {
                    throw sessionFailure(source,
                        new SessionDecodeError('Session document could not be fetched', e))
                }

                ctx.config = decodeFrom(source, sessionText)
            }

            // Outside the arms on purpose, and after both: the version is a
            // property of the document, not of where it was read from, so a
            // session named by a URL is version-checked exactly as one carried
            // in the parameter. It is reported *with* the source all the same --
            // "which of my links is this?" is the first question a refusal has
            // to answer, whatever raised it.
            if (ctx.config) {
                try {
                    ctx.config = takeSessionVersion(ctx.config)
                } catch (e) {
                    throw sessionFailure(source, e)
                }
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
                // Wrapped for the same reason the session arms are (#521): a
                // corrupt payload rejects out of `BGZip` with a bare string, and
                // "the rejection is always an `Error`" is a claim about
                // `extractConfig`, not about the `session` parameter alone. The
                // parameter names itself in the message, so there is no source
                // to carry -- `SESSION_SOURCES` is the `session=` vocabulary.
                try {
                    q = BGZip.uncompressString(query["juiceboxData"])
                } catch (e) {
                    throw new SessionDecodeError(
                        'juiceboxData= is not a readable compressed query string', e)
                }
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
