import {registryForContainer, currentRegistry} from "./browserRegistry.js"
import {encodeSession} from "./sessionCodec.js";

/**
 * The exported session functions -- the names both known host apps import, per
 * ADR-0003.
 *
 * A session describes *one embed*, so the work is `registry.toJSON()` and
 * `registry.restoreSession(config)`; these three keep their published
 * signatures and delegate. Decision 5 of ADR-0004, #482.
 *
 * What is left here rather than on the registry is the caption: a single
 * `#hic-caption` element outside every container, which two embeds on a page
 * share and no registry can own.
 */

/**
 * Serialize a session: the browsers of one embed, its selected gene, and the
 * page caption.
 *
 * Which embed is the page-wide one, because `toJSON()` is a published
 * zero-argument export with no container to resolve from -- the same
 * single-embed convenience `getAllBrowsers()` carries. Once resolved, the whole
 * document comes from that one registry: `registry.toJSON()` is where a session
 * is actually written. Decision 5 of ADR-0004, #482.
 */
function toJSON() {

    const jsonOBJ = currentRegistry()?.toJSON() || {browsers: []};

    // The caption is the one part of a session no registry owns: it is a single
    // page element outside every container, so it is read here rather than in
    // the registry. Two embeds on a page share it.
    const captionDiv = document.getElementById('hic-caption');
    if (captionDiv) {
        var captionText = captionDiv.textContent;
        if (captionText) {
            captionText = captionText.trim();
            if (captionText) {
                jsonOBJ.caption = captionText;
            }
        }
    }

    return jsonOBJ;
}

/**
 * The share link's query parameter: `session=blob:<compressed JSON>`, which
 * juicebox-web appends to its base href.
 *
 * The writing is `sessionCodec.encodeSession` -- the inverse of the same
 * module's `decodeSession`, and the reason `decode(encode(x))` can be a property
 * test at all (#507, ADR-0006 decision 4). It was two lines of compression here,
 * which is one of the two halves of the format living apart from the other.
 */
function compressedSession() {
    return encodeSession(toJSON())
}


/**
 * Replace the browsers in `container`'s embed with the ones `session` names.
 *
 * The container argument has always implied this, and since #479 keyed
 * registries by container it has been true. What #482 adds is that the session
 * is the *registry's* -- restoring is something one embed does to itself, not a
 * page-wide operation aimed at a container. A host initializing a second embed
 * keeps the first one's DOM either way; #384.
 */
async function restoreSession(container, session) {

    if (Object.hasOwn(session, "caption")) {
        const captionDiv = document.getElementById("hic-caption");
        if (captionDiv) {
            captionDiv.textContent = session.caption;
        }
    }

    await registryForContainer(container).restoreSession(session);
}


export {toJSON, restoreSession, compressedSession}