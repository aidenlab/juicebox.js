/**
 * The wire-format fixture corpus — what the decoder accepts, enumerated.
 *
 * ADR-0006 decision 1 froze the compatibility contract as "the decoder's
 * currently-accepted set." That is only a contract if the set can be listed.
 * This file is the list. #502.
 *
 * Two kinds of fixture, and the distinction is load-bearing:
 *
 * - **harvested** — a string something actually wrote, recovered from `git log`,
 *   `test/test_urls.md`, juicebox-web, or the published docs. These are evidence
 *   about the *real inbound population*, which is the thing ADR-0003's method
 *   tables do not measure at all. Marked `role: 'load-bearing'`.
 * - **synthesized** — one literal per decoder branch, hand-written to cover what
 *   harvesting missed. Marked `role: 'branch-coverage'`.
 *
 * Synthesized-only would be circular: such fixtures encode what the author
 * *thinks* the decoder accepts, so they reproduce any misreading faithfully.
 * Harvested-only would miss branches nothing has exercised in years.
 *
 * **These fixtures carry inputs, not expected outputs.** ADR-0006's "How we know
 * the decoder did not change" rejects hand-written assertions for exactly the
 * reason above; the consuming test is a golden-file snapshot. The only claim a
 * fixture makes about the result is the coarse `outcome` below, which is what a
 * snapshot runner needs in order to know whether to snapshot a value or a throw.
 *
 * Every `outcome` was measured against `extractConfig` at `b92b602` rather than
 * inferred from reading the code. `test/testWireFormatCorpus.js` re-measures on
 * every run everything drivable from literals, including the `sessionUrl`
 * fixtures via a stubbed loader. Four are left out and were measured by hand:
 * the three `sessionFile` fixtures, which the sole caller cannot reach at all
 * (see their notes), and `harvested-juiceboxURL-bitly`, whose outcome depends on
 * a third party. Distrust those four first if the corpus and the decoder ever
 * disagree.
 *
 * Nothing here does I/O. Every fixture whose decode path would reach the network
 * or a file carries the *text* that path would have returned as a further string
 * literal — `loaderResponse`, `fileText`, `expandedUrl` — so the whole decode
 * path is drivable from literals, which is the point of ADR-0006 decision 10's
 * injected loader.
 *
 * **Harvest scope.** ADR-0006 names three repos and the published docs. All
 * three were searched: juicebox.js (`git log`, `test/test_urls.md`,
 * `test/testURL.js`; `dev/` holds no URL literals at all), juicebox-web
 * (`test/testURLs.md`, `js/initializationHelper.js`), and Spacewalk
 * (`~/SpacewalkDevelopment/spacewalk`). External citation harvesting is a
 * separate ticket by design and blocks nothing.
 *
 * **Spacewalk contributes no fixture for this decoder, and the reason matters
 * more than the fixture would have.** It sets `queryParametersSupported: false`
 * (`src/juicebox/juiceboxPanel.js:79,82,97`) and so never reaches
 * `extractConfig` at all. Instead it reads `?session=` itself in
 * `src/launchIntent.js`, decodes it in `src/sessionURLCodec.js`, and hands the
 * parsed object to `hic.restoreSession` — ADR-0006 fact 6's bypass, in
 * production, in a host app.
 *
 * So the `session=` wire format has **two independent decoders**, and they do
 * not accept the same set. Spacewalk's takes a `/gzip;base64` data URI that
 * juicebox's throws on (see `reject-session-gzip-data-uri`), while juicebox's
 * takes a `data:`-prefixed BGZip payload that Spacewalk's would mangle — its
 * `else` arm slices a fixed five characters, which is right for `blob:` and
 * wrong for `data:`. Both are reached by the same parameter name on the same
 * launch URL. ADR-0006's "one decoder" is one decoder *in this repo*; the
 * contract has a second reader, and collapsing the decoders here does not
 * change that. Worth its own ticket — it is a divergence, not a bug in either.
 *
 * @see docs/url.md — the specification these fixtures are instances of
 * @see docs/adr/0006-session-wire-format-and-one-decoder.md
 */

/**
 * The formats. Every one of these has at least one fixture below; a new format
 * is a new entry here and a new fixture, in that order.
 *
 * `sessionBlob`     — `session=blob:` compressed session JSON. The only form
 *                     juicebox writes today (juicebox-web's share link).
 * `sessionData`     — `session=data:`, the same payload under the other prefix.
 * `sessionUrl`      — `session=<url>`, fetched then parsed; the fetched text is
 *                     itself either compressed-prefixed or plain JSON.
 * `sessionFile`     — `session=<File>`, same two sub-forms as `sessionUrl`.
 * `query`           — the `hicUrl=&state=&tracks=` parameter form.
 * `juicebox`        — `juicebox={…},{…}`, one braced query string per browser.
 * `juiceboxData`    — `juiceboxData=`, the *braced* form compressed. Not session
 *                     JSON — see the fixture note.
 * `juiceboxURL`     — `juiceboxURL=`, a bit.ly link. Dropped by decision 1.
 */
export const FORMATS = [
    'sessionBlob',
    'sessionData',
    'sessionUrl',
    'sessionFile',
    'query',
    'juicebox',
    'juiceboxData',
    'juiceboxURL',
]

/**
 * What `extractConfig` does with the input.
 *
 * `decodes`   — returns a session config.
 * `no-config` — returns `undefined`. Not an error: nothing in the URL was ours.
 * `throws`    — rejects. A decoder's rejections are part of its contract.
 */
export const OUTCOMES = ['decodes', 'no-config', 'throws']

/**
 * Fixtures for `extractConfig` (today `js/urlUtils.js`; `decodeSession` in
 * `js/sessionCodec.js` after the collapse). `input` is a whole href or query
 * string, exactly as the decoder receives it from `window.location.href`.
 */
export const wireFormatCorpus = [

    // ---------------------------------------------------------------------
    // Harvested — real strings, real provenance. Load-bearing.
    // ---------------------------------------------------------------------

    {
        id: 'harvested-session-blob-adac-endoc',
        format: 'sessionBlob',
        provenance: 'harvested',
        role: 'load-bearing',
        source: 'test/test_urls.md and test/testURL.js — an aidenlab.org share link, two browsers, three tracks each',
        outcome: 'decodes',
        input: 'http://aidenlab.org/juicebox/?session=blob:1ZPPbtswDMbfxacNECRR_51b0Qwb1tPS24bAUGylMWpbmaS1w4q8e.UYS5d06C7JYRfC_kRTP9Ifn4pV8I_RhVjMvj0VP0JXzIpNSts4IyRybHv7yw_2MeLa92TT1uu2czE_RPedDLc_N5._fmrmiy_0_uN8QYBhDhg0uZpfXe9DxSnOXxWoGGzvcu1jMSabRpUhhhQCUyoMUjHJNQetmURQgsJKajAgGdfaIMBSMM4MPUR0s8ilat_5cFvbbqwHQmAGhmsBwuQkLRCTElFER5KHNqfo0pRQCiryJUbpMh.kYOv7CwyiHZILuemq9kOydaoa39t2iERSSqtV58dbDxM6FvdtZTXcrd6NLezbeF_s0HkZq877bSS9C3eumV7wyjVb98L117M_8SjiauS7AN1DrD4Mjb8mTbteu.CG1NpuQoFTzrdSjnHHWXKVcZfnBJ5A9_GV.0_Uy9mfYa0FL0VeAloa_tr.yoCRzAAVl7T_1O8ZvAUm05_dW9Ov.h_W840FYP9egJeUk5n.xl3ulrtn',
        note: 'The one format juicebox still writes. If exactly one fixture in this file has to keep working, it is this one.',
    },

    {
        id: 'harvested-query-wapl-wt',
        format: 'query',
        provenance: 'harvested',
        role: 'load-bearing',
        source: 'www.aidenlab.org/juicebox published link, Haarhuis et al. Cell 2017; test/test_urls.md',
        outcome: 'decodes',
        input: 'http://www.aidenlab.org/juicebox/?state=3,3,6,5537.98746,5537.749239047619,1,KR&colorScale=18.89619862813927&hicUrl=https://s3.amazonaws.com/hicfiles/external/wapl_hic/WT.hic&name=Haarhuis%20et%20al.%20|%20Cell%202017%20Hap1%20control&tracks=http://hicfiles.s3.amazonaws.com/external/GM12878_CTCF_orientation.bed|GM12878_CTCF_orientation.bed||rgb(22,%20129,%20198)|||https://s3.amazonaws.com/igv.broadinstitute.org/annotations/hg19/genes/gencode.v18.collapsed.bed.gz|gencode.v18.collapsed.bed.gz||rgb(22,%20129,%20198)',
        note: 'v0 seven-token state, bare-threshold colorScale (#514), two four-field tracks with empty data ranges (#515), and the default annotation colour that fixDefaults strips. Unencoded bars and braces in a real published URL.',
    },

    {
        id: 'harvested-query-wapl-ko',
        format: 'query',
        provenance: 'harvested',
        role: 'load-bearing',
        source: 'test/test_urls.md — the localhost sibling of the published WT link',
        outcome: 'decodes',
        input: 'http://localhost/juicebox.js/dev/juicebox-blank.html?state=3,3,6,5537.98746,5537.749239047619,1,KR&colorScale=18.89619862813927&hicUrl=https://s3.amazonaws.com/hicfiles/external/wapl_hic/WaplKO_1.14.hic&name=Haarhuis%20et%20al.%20|%20Cell%202017%20Hap1%20knockout%20WAPL%20clone%201&tracks=http://hicfiles.s3.amazonaws.com/external/GM12878_CTCF_orientation.bed|GM12878_CTCF_orientation.bed||rgb(22,%20129,%20198)|||https://s3.amazonaws.com/igv.broadinstitute.org/annotations/hg19/genes/gencode.v18.collapsed.bed.gz|gencode.v18.collapsed.bed.gz||rgb(22,%20129,%20198)',
    },

    {
        id: 'harvested-query-degron-fully-encoded',
        format: 'query',
        provenance: 'harvested',
        role: 'load-bearing',
        source: 'git log — Rao et al. Biorxiv 2017 degron link',
        outcome: 'decodes',
        input: '?state=3%2C3%2C7%2C19215%2C19215%2C1.55%2CKR&colorScale=72&hicUrl=https%3A%2F%2Fs3.amazonaws.com%2Fhicfiles%2Fhiseq%2Fdegron%2Funtreated%2Funsynchronized%2Fcombined.hic&name=Rao%20et%20al.%20%7C%20Biorxiv%202017%20Combined%20Untreated&tracks=https%3A%2F%2Fs3.amazonaws.com%2Fhicfiles%2Fhiseq%2Fdegron%2Fchipseq%5Fdata%2Funtreated%2FH3K36me3%5FFE.bw%7CUntreated%20H3K36me3%7C0-3%7Crgb(0%2C150%2C0)%7C%7C%7Chttps%3A%2F%2Fs3.amazonaws.com%2Fhicfiles%2Fhiseq%2Fdegron%2Fchipseq%5Fdata%2Funtreated%2FH3K4me1%5FFE.bw%7CUntreated%20H3K4me1%7C0-7%7Crgb(0%2C150%2C0)',
        note: 'The counterpart to harvested-query-wapl-wt: every separator percent-encoded, including the bars inside the track string and a name carrying a literal bar. Two tracks that do supply a data range.',
    },

    {
        id: 'harvested-query-gm12878-nvi',
        format: 'query',
        provenance: 'harvested',
        role: 'load-bearing',
        source: 'git log — Rao and Huntley et al. Cell 2014 GM12878 link',
        outcome: 'decodes',
        input: '?state=1%2C1%2C4%2C1115.253105%2C1149.253105%2C1%2CNONE&colorScale=29&hicUrl=https%3A%2F%2Fhicfiles.s3.amazonaws.com%2Fhiseq%2Fgm12878%2Fin-situ%2FHIC009.hic&name=Rao%20and%20Huntley%20et%20al.%20%7C%20Cell%202014%20GM12878%20(human)%20in%20situ%20MboI%20HIC009%20(95M)&nvi=2851728310%2C36479',
        note: 'Carries `nvi`, whose table js/nvi.js still serves for exactly this kind of pasted link.',
    },

    {
        id: 'harvested-query-dnazoo-no-state',
        format: 'query',
        provenance: 'harvested',
        role: 'load-bearing',
        source: 'git log — a DNA Zoo draft-assembly link',
        outcome: 'decodes',
        input: '?hicUrl=https://dnazoo.s3.amazonaws.com/Ailurus_fulgens/ASM200746v1.hic&name=Draft%20assembly&colorScale=19556,255,0,0&nvi=2592278165,834',
        note: 'No `state` at all — a map URL with a colour scale is a complete link. Four-token colorScale, harvested rather than synthesized.',
    },

    {
        id: 'harvested-juicebox-literal-braces',
        format: 'juicebox',
        provenance: 'harvested',
        role: 'load-bearing',
        source: 'test/test_urls.md and test/testURL.js — ADAC / EndoC, two browsers, three 2D annotations each',
        outcome: 'decodes',
        input: 'http://aidenlab.org/juicebox/?juicebox={hicUrl%3Dhttps%3A%2F%2Fs3.amazonaws.com%2Fhicfiles%2Fhiseq%2FnSxhJZHdDRQ0kGDR%2F12.31.17%2FADAC%2FADAC_30.hic%26name%3DADAC_30.hic%26state%3D2%2C2%2C6%2C1896.1562537317725%2C1916.657181523778%2C1.5423280423280423%2CKR%26colorScale%3D144.21837414880474%2C255%2C0%2C0%26nvi%3D7989194045%2C18679%26tracks%3Dhttps%3A%2F%2Fs3.amazonaws.com%2Fhicfiles%2Fhiseq%2FnSxhJZHdDRQ0kGDR%2F12.31.17%2FADAC%2Finter_30_contact_domains%2F5000_blocks%7C5000_blocks%7C%7Crgb(255%2C255%2C0)%7C%7C%7Chttps%3A%2F%2Fs3.amazonaws.com%2Fhicfiles%2Fhiseq%2FnSxhJZHdDRQ0kGDR%2F12.31.17%2FADAC_loops%2Fmerged_loops.bedpe%7Cmerged_loops.bedpe%7C%7Crgb(0%2C36%2C255)%7C%7C%7Chttps%3A%2F%2Fs3.amazonaws.com%2Fhicfiles%2Fhiseq%2FnSxhJZHdDRQ0kGDR%2F12.31.17%2FADAC_vs_EndoC%2Fdifferential_loops1.bedpe%7Cdifferential_loops1.bedpe%7C%7Crgb(0%2C255%2C36)},{hicUrl%3Dhttps%3A%2F%2Fs3.amazonaws.com%2Fhicfiles%2Fhiseq%2FnSxhJZHdDRQ0kGDR%2F12.31.17%2FEndoC%2FEndoC_30.hic%26name%3DEndoC_30.hic%26state%3D2%2C2%2C6%2C1896.1562537317725%2C1916.657181523778%2C1.5423280423280423%2CKR%26colorScale%3D142.77439421809834%2C255%2C0%2C0%26nvi%3D6818528104%2C18679%26tracks%3Dhttps%3A%2F%2Fs3.amazonaws.com%2Fhicfiles%2Fhiseq%2FnSxhJZHdDRQ0kGDR%2F12.31.17%2FEndoC_loops%2Fmerged_loops.bedpe%7Cmerged_loops.bedpe%7C%7Crgb(18%2C0%2C255)%7C%7C%7Chttps%3A%2F%2Fs3.amazonaws.com%2Fhicfiles%2Fhiseq%2FnSxhJZHdDRQ0kGDR%2F12.31.17%2FEndoC%2Finter_30_contact_domains%2F5000_blocks%7C5000_blocks%7C%7Crgb(255%2C255%2C0)%7C%7C%7Chttps%3A%2F%2Fs3.amazonaws.com%2Fhicfiles%2Fhiseq%2FnSxhJZHdDRQ0kGDR%2F12.31.17%2FADAC_vs_EndoC%2Fdifferential_loops2.bedpe%7Cdifferential_loops2.bedpe%7C%7Crgb(18%2C255%2C0)}',
        note: 'Braces literal, everything inside them percent-encoded. This is the shape a browser leaves the URL in when the user pastes it: the outer braces survive, the inner separators do not.',
    },

    {
        id: 'harvested-juicebox-encoded-braces',
        format: 'juicebox',
        provenance: 'harvested',
        role: 'load-bearing',
        source: 'juicebox-web test/testURLs.md — two 4DN maps',
        outcome: 'decodes',
        input: 'http://localhost:5173/index.html?juicebox=%7BhicUrl%3Dhttps%3A%2F%2F4dn-open-data-public.s3.amazonaws.com%2Ffourfront-webprod%2Fwfoutput%2F8f064770-6008-4f74-bfca-268d4a22d745%2F4DNFIMROE6N4.hic%26name%3DHFFc6%20DpnII%7D%2C%7BhicUrl%3Dhttps%3A%2F%2F4dn-open-data-public.s3.amazonaws.com%2Ffourfront-webprod%2Fwfoutput%2Fa0859349-5f06-4ad3-b56f-b1166b34a9eb%2F4DNFIIMZB6Y9.hic%26name%3DH1-hESC%20DpnII%7D',
        note: 'The *other* brace spelling, and a genuinely separate branch: `q.startsWith("%7B")` at urlUtils.js:139 decodes the whole value once more before the braces are stripped. Both spellings are in the wild; only this one is currently in a host app.',
    },

    {
        id: 'harvested-query-4dn-control-map',
        format: 'query',
        provenance: 'harvested',
        role: 'load-bearing',
        source: 'juicebox-web test/testURLs.md — the "A" and "B" map link',
        outcome: 'decodes',
        input: 'http://localhost:5173/index.html?hicUrl=https://4dn-open-data-public.s3.amazonaws.com/fourfront-webprod/wfoutput/8f064770-6008-4f74-bfca-268d4a22d745/4DNFIMROE6N4.hic&name=HFFc6%20DpnII&controlUrl=https://4dn-open-data-public.s3.amazonaws.com/fourfront-webprod/wfoutput/a0859349-5f06-4ad3-b56f-b1166b34a9eb/4DNFIIMZB6Y9.hic&controlName=H1-hESC%20DpnII',
        note: 'The only harvested fixture carrying controlUrl / controlName.',
    },

    {
        id: 'harvested-query-4dn-state-colorscale-track',
        format: 'query',
        provenance: 'harvested',
        role: 'load-bearing',
        source: 'juicebox-web test/testURLs.md — map at a locus with a colour scale and a 1D track',
        outcome: 'decodes',
        input: 'http://localhost:5173/index.html?hicUrl=https://4dn-open-data-public.s3.amazonaws.com/fourfront-webprod/wfoutput/8f064770-6008-4f74-bfca-268d4a22d745/4DNFIMROE6N4.hic&name=HFFc6%20DpnII&state=1,1,4,0,0,1,NONE&colorScale=100,255,0,0&tracks=https://hgdownload.soe.ucsc.edu/goldenPath/hg38/database/refGene.txt.gz%7CRefSeq%20genes%7C%7Crgb(22,%20129,%20198)',
        note: 'The most recently written of the harvested query URLs, and the closest thing to a currently-maintained example of the form.',
    },

    {
        id: 'harvested-juiceboxURL-bitly',
        format: 'juiceboxURL',
        provenance: 'harvested',
        role: 'load-bearing',
        outcome: 'decodes',
        source: 'test/test_urls.md and juicebox-web js/initializationHelper.js:490',
        input: 'http://localhost/juicebox-web/index.html?juiceboxURL=http://bit.ly/2C1VSHy',
        expandedUrl: 'http://aidenlab.org/juicebox/?juicebox={hicUrl%253Dhttps%253A%252F%252Fs3.amazonaws.com%252Fhicfiles%252Fhiseq%252FnSxhJZHdDRQ0kGDR%252F12.31.17%252FADAC%252FADAC_30.hic%2526name%253DADAC_30.hic%2526state%253D2%252C2%252C6%252C1896.1562537317725%252C1916.657181523778%252C1.5423280423280423%252CKR%2526colorScale%253D144.21837414880474%252C255%252C0%252C0%2526nvi%253D7989194045%252C18679%2526tracks%253Dhttps%253A%252F%252Fs3.amazonaws.com%252Fhicfiles%252Fhiseq%252FnSxhJZHdDRQ0kGDR%252F12.31.17%252FADAC%252Finter_30_contact_domains%252F5000_blocks%257C5000_blocks%257C%257Crgb(255%252C255%252C0)%257C%257C%257Chttps%253A%252F%252Fs3.amazonaws.com%252Fhicfiles%252Fhiseq%252FnSxhJZHdDRQ0kGDR%252F12.31.17%252FADAC_loops%252Fmerged_loops.bedpe%257Cmerged_loops.bedpe%257C%257Crgb(0%252C36%252C255)%257C%257C%257Chttps%253A%252F%252Fs3.amazonaws.com%252Fhicfiles%252Fhiseq%252FnSxhJZHdDRQ0kGDR%252F12.31.17%252FADAC_vs_EndoC%252Fdifferential_loops1.bedpe%257Cdifferential_loops1.bedpe%257C%257Crgb(0%252C255%252C36)},{hicUrl%253Dhttps%253A%252F%252Fs3.amazonaws.com%252Fhicfiles%252Fhiseq%252FnSxhJZHdDRQ0kGDR%252F12.31.17%252FEndoC%252FEndoC_30.hic%2526name%253DEndoC_30.hic%2526state%253D2%252C2%252C6%252C1896.1562537317725%252C1916.657181523778%252C1.5423280423280423%252CKR%2526colorScale%253D142.77439421809834%252C255%252C0%252C0%2526nvi%253D6818528104%252C18679%2526tracks%253Dhttps%253A%252F%252Fs3.amazonaws.com%252Fhicfiles%252Fhiseq%252FnSxhJZHdDRQ0kGDR%252F12.31.17%252FEndoC_loops%252Fmerged_loops.bedpe%257Cmerged_loops.bedpe%257C%257Crgb(18%252C0%252C255)%257C%257C%257Chttps%253A%252F%252Fs3.amazonaws.com%252Fhicfiles%252Fhiseq%252FnSxhJZHdDRQ0kGDR%252F12.31.17%252FEndoC%252Finter_30_contact_domains%252F5000_blocks%257C5000_blocks%257C%257Crgb(255%252C255%252C0)%257C%257C%257Chttps%253A%252F%252Fs3.amazonaws.com%252Fhicfiles%252Fhiseq%252FnSxhJZHdDRQ0kGDR%252F12.31.17%252FADAC_vs_EndoC%252Fdifferential_loops2.bedpe%257Cdifferential_loops2.bedpe%257C%257Crgb(18%252C255%252C0)}',
        note: 'The one format ADR-0006 decision 1 drops deliberately — and, measured 2026-08-09, **it still works**: bit.ly expands the link and the two-browser session decodes in full. ADR-0006 and docs/url.md both predicted a 401 from the mojibake bearer token at urlUtils.js:405; v4/expand accepts it for a public link. So #506 removes live behaviour rather than tidying a dead path, and this fixture is the evidence. `expandedUrl` is bit.ly\'s `long_url` field captured verbatim on the same date, so the fixture is drivable offline by stubbing the fetch with it — note it arrives **double**-encoded (`%253D` for `=`) with the braces literal, which is what the brace repair at urlUtils.js:417 exists to undo. The corpus integrity test still skips this fixture: it is the one input whose measured outcome depends on a third party.',
    },

    // ---------------------------------------------------------------------
    // Synthesized — one per decoder branch harvesting did not reach.
    // ---------------------------------------------------------------------

    {
        id: 'synth-session-data-prefix',
        format: 'sessionData',
        provenance: 'synthesized',
        role: 'branch-coverage',
        source: 'urlUtils.js:88 — the `data:` half of the `blob:|data:` prefix test',
        outcome: 'decodes',
        input: '?session=data:HZDBboMwEER_pdqzDQ41EPmcROVQIjXHKofFgEABr2WMSEH8e51cRqOn1cxoN6gcLVPjJlC_G8xuAAWd93ZScSxrw8k2htfokdu5GnodTZ8RjriSwWWKNI1xS7NrHRnPl6ayjup4Ccjb2cfHVmQyzwXPhDhy2eaSV61GnmTHWmKS1LlMY3kqL8X3z_WclTLqeg0MDI5N2PF1uejs42RNUQQ4efSBbqA7dwB1YC.TvM1KNIKSDJ6gBIO_t9r.2Qy3fm3eJ4bciEO_ou_JhOzyWp5hDxk0kLtpHF6FByFYkqZMMBEKvUP9eP3lvt_3fw--',
        note: 'Compressed from `synth-session-json-plain` below. No harvested example exists: juicebox has only ever written `blob:`, and both prefixes are stripped by the same `substr(5)`, so the two are indistinguishable after the first five characters. Kept anyway — the branch is live and something else may have written it.',
    },

    {
        id: 'synth-juiceboxData-compressed',
        format: 'juiceboxData',
        provenance: 'synthesized',
        role: 'branch-coverage',
        source: 'urlUtils.js:136 — the `juiceboxData` arm of the juicebox/juiceboxData block',
        outcome: 'decodes',
        input: '?juiceboxData=tc6xasMwEAbgp3GnnpGls2wPGdImph6SQkuHZjtJFg7EkrBlDAl596pDS1.g8A8_Pwf33Yaz_pgumyHGMGdim_E2BY0DH3oHhiJBWNTlrPNZ5DTS1Tta51z7Md1Zv0x28i7C2qsweZO2NY0xLDHV2jKJVcVAMlYD2gpBWU3AZW2QODcVlt_fdse2O7y97uUR8.R5cDT2m5e21TLjbBdc190fb_8JJVaXjcAGyiQGJCNAldKCKgoplUBqevUD7Q6nJ_nZ_IEWMOzfn3.pXw--',
        note: 'The payload is the *braced multi-browser query string*, compressed — not session JSON. `juiceboxData` and `juicebox` share one code block: the only difference is that one value is uncompressed first, after which both go through the same brace strip and `},{` split. docs/url.md calls this "compressed session JSON under an older parameter name", which is wrong. The plaintext here is exactly the value of `harvested-juicebox-encoded-braces` with the outer percent-encoding removed.',
    },

    {
        id: 'synth-session-url-plain-json',
        format: 'sessionUrl',
        provenance: 'synthesized',
        role: 'branch-coverage',
        source: 'urlUtils.js:108,115 — loadString, then the plain-JSON arm',
        outcome: 'decodes',
        input: '?session=https://example.org/fixtures/session.json',
        loaderResponse: '{"browsers":[{"url":"https://example.org/a.hic","name":"A","state":{"chr1":1,"chr2":1,"zoom":4,"x":0,"y":0,"pixelSize":1,"normalization":"NONE"}}]}',
        note: 'Drive this with the injected loader of ADR-0006 decision 10; until it exists, stub igvxhr.loadString to return `loaderResponse`. The session value is a URL, so nothing distinguishes it from a relative file path — juicebox-web writes `?session=${relativePath}` and lands in this same branch.',
    },

    {
        id: 'synth-session-url-blob-prefixed',
        format: 'sessionUrl',
        provenance: 'synthesized',
        role: 'branch-coverage',
        source: 'urlUtils.js:111 — the fetched text is itself compressed',
        outcome: 'decodes',
        input: '?session=https://example.org/fixtures/session.blob',
        loaderResponse: 'blob:HZDBboMwEER_pdqzDQ41EPmcROVQIjXHKofFgEABr2WMSEH8e51cRqOn1cxoN6gcLVPjJlC_G8xuAAWd93ZScSxrw8k2htfokdu5GnodTZ8RjriSwWWKNI1xS7NrHRnPl6ayjup4Ccjb2cfHVmQyzwXPhDhy2eaSV61GnmTHWmKS1LlMY3kqL8X3z_WclTLqeg0MDI5N2PF1uejs42RNUQQ4efSBbqA7dwB1YC.TvM1KNIKSDJ6gBIO_t9r.2Qy3fm3eJ4bciEO_ou_JhOzyWp5hDxk0kLtpHF6FByFYkqZMMBEKvUP9eP3lvt_3fw--',
        note: 'A saved session file whose contents are the share link\'s payload rather than readable JSON. The prefix test is repeated inside the fetch branch, which is why this is a separate fixture from synth-session-data-prefix.',
    },

    {
        id: 'synth-session-file-plain-json',
        format: 'sessionFile',
        provenance: 'synthesized',
        role: 'branch-coverage',
        source: 'urlUtils.js:90-100 — the isFile branch, plain-JSON arm',
        outcome: 'decodes',
        fileText: '{"browsers":[{"url":"https://example.org/a.hic","name":"A","state":{"chr1":1,"chr2":1,"zoom":4,"x":0,"y":0,"pixelSize":1,"normalization":"NONE"}}]}',
        note: 'No `input` string: the decoder reaches this branch only when handed a query object whose `session` value is a File, so a consuming test builds `new File([fileText], "session.json")`. **Unreachable from the sole caller** — init.js:50 passes `window.location.href`, a string, and `extractQuery` can only ever produce string values. Recorded because it is in the accepted set as written, and a corpus that quietly omitted it would be describing the decoder someone meant to write.',
    },

    {
        id: 'synth-session-file-blob-prefixed',
        format: 'sessionFile',
        provenance: 'synthesized',
        role: 'branch-coverage',
        source: 'urlUtils.js:95 — the isFile branch, compressed arm',
        outcome: 'decodes',
        fileText: 'blob:HZDBboMwEER_pdqzDQ41EPmcROVQIjXHKofFgEABr2WMSEH8e51cRqOn1cxoN6gcLVPjJlC_G8xuAAWd93ZScSxrw8k2htfokdu5GnodTZ8RjriSwWWKNI1xS7NrHRnPl6ayjup4Ccjb2cfHVmQyzwXPhDhy2eaSV61GnmTHWmKS1LlMY3kqL8X3z_WclTLqeg0MDI5N2PF1uejs42RNUQQ4efSBbqA7dwB1YC.TvM1KNIKSDJ6gBIO_t9r.2Qy3fm3eJ4bciEO_ou_JhOzyWp5hDxk0kLtpHF6FByFYkqZMMBEKvUP9eP3lvt_3fw--',
        note: 'Same reachability caveat as synth-session-file-plain-json.',
    },

    {
        id: 'synth-query-state-v1-nine-token',
        format: 'query',
        provenance: 'synthesized',
        role: 'branch-coverage',
        source: 'hicState.js State.parse — the `> 7` branch',
        outcome: 'decodes',
        input: '?hicUrl=https://example.org/a.hic&state=3,5,6,100,200,0,0,2,KR',
        note: 'Nothing in this repo has ever written nine tokens — State.stringify(), the only thing that did, was deleted in #501. The branch stays live for links the Java desktop app wrote. Tokens 6 and 7 are the retired view width and height and are never read.',
    },

    {
        id: 'synth-query-state-v1-legacy-viewport',
        format: 'query',
        provenance: 'synthesized',
        role: 'branch-coverage',
        source: 'docs/url.md — v1 filler tokens carrying a real viewport size',
        outcome: 'decodes',
        input: '?hicUrl=https://example.org/a.hic&state=3,5,6,100,200,1250,1250,2,KR',
        note: 'Decodes identically to synth-query-state-v1-nine-token. Links written before March 2025 (5a933f3) carry the genuine viewport there rather than zeroes; that this makes no difference is the property worth pinning.',
    },

    {
        id: 'synth-query-state-v1-eight-token',
        format: 'query',
        provenance: 'synthesized',
        role: 'branch-coverage',
        source: 'hicState.js State.parse — `> 7` with normalization omitted',
        outcome: 'decodes',
        input: '?hicUrl=https://example.org/a.hic&state=3,5,6,100,200,0,0,2',
        note: 'Eight tokens is v1, not v0: the discriminator is *more than seven*, not *exactly nine*. Normalization defaults to NONE.',
    },

    {
        id: 'synth-query-state-v0-six-token',
        format: 'query',
        provenance: 'synthesized',
        role: 'branch-coverage',
        source: 'hicState.js State.parse — `<= 7` with normalization omitted',
        outcome: 'decodes',
        input: '?hicUrl=https://example.org/a.hic&state=1,2,4,10,20,3',
    },

    {
        id: 'synth-query-state-transposed',
        format: 'query',
        provenance: 'synthesized',
        role: 'branch-coverage',
        source: 'hicState.js State constructor — the chr1 > chr2 transposition',
        outcome: 'decodes',
        input: '?hicUrl=https://example.org/a.hic&state=5,3,6,100,200,2,KR',
        note: 'Decodes to the transpose: chr1/chr2 and x/y swap together, giving the same view with the axes flipped about the diagonal. Not a rejection and not a repair — the second spelling of a view that already has one. ADR-0006 decision 3. Links written before the invariant was enforced in setView carry this shape.',
    },

    {
        id: 'synth-query-state-too-few-tokens',
        format: 'query',
        provenance: 'synthesized',
        role: 'branch-coverage',
        outcome: 'decodes',
        source: 'hicState.js State.parse — a truncated state string',
        input: '?hicUrl=https://example.org/a.hic&state=1,2',
        note: 'Accepted, not rejected: zoom, x and y come back NaN and pixelSize falls to the constructor default. A malformed state string is a silently wrong view rather than a load failure, which is worth having pinned before anyone decides to "fix" it.',
    },

    {
        id: 'synth-query-colorscale-four-token',
        format: 'query',
        provenance: 'synthesized',
        role: 'branch-coverage',
        source: 'colorScaleParser.js parseSingle — the complete form',
        outcome: 'decodes',
        input: '?hicUrl=https://example.org/a.hic&colorScale=100,255,0,0',
    },

    {
        id: 'synth-query-colorscale-bare-threshold',
        format: 'query',
        provenance: 'synthesized',
        role: 'branch-coverage',
        source: 'colorScaleParser.js parseSingle — RGB components absent',
        outcome: 'decodes',
        input: '?hicUrl=https://example.org/a.hic&colorScale=18.89619862813927',
        note: 'Common in harvested links (see harvested-query-wapl-wt and harvested-query-degron-fully-encoded) and broken: the absent components are not a request for the default colour, they are NaN. #514. The fixture is here so the bug is *in* the snapshot rather than quietly absent from it — ADR-0006 is explicit that the corpus captures bugs as well as behaviour.',
    },

    {
        id: 'synth-query-colorscale-ratio',
        format: 'query',
        provenance: 'synthesized',
        role: 'branch-coverage',
        source: 'colorScaleParser.js — the RatioColorScale `R:` tag, used by AOB / BOA',
        outcome: 'decodes',
        input: '?hicUrl=https://example.org/a.hic&controlUrl=https://example.org/b.hic&displayMode=AOB&colorScale=R%3A2%3A5%2C255%2C0%2C0%3A5%2C0%2C0%2C255',
    },

    {
        id: 'synth-query-colorscale-diff',
        format: 'query',
        provenance: 'synthesized',
        role: 'branch-coverage',
        source: 'colorScaleParser.js — the DiffColorScale `D:` tag, used by AMB',
        outcome: 'decodes',
        input: '?hicUrl=https://example.org/a.hic&controlUrl=https://example.org/b.hic&displayMode=AMB&colorScale=D%3A2%3A5%2C255%2C0%2C0%3A5%2C0%2C0%2C255',
    },

    {
        id: 'synth-query-tracks-four-field',
        format: 'query',
        provenance: 'synthesized',
        role: 'branch-coverage',
        source: 'urlUtils.js destringifyTracksV0 — the canonical layout',
        outcome: 'decodes',
        input: '?hicUrl=https://example.org/a.hic&tracks=https%3A%2F%2Fexample.org%2Fa.bed%7CA%7C0-50%7Crgb(255%2C0%2C0)',
    },

    {
        id: 'synth-query-tracks-three-field',
        format: 'query',
        provenance: 'synthesized',
        role: 'branch-coverage',
        source: 'urlUtils.js destringifyTracksV0 — the v0 layout',
        outcome: 'decodes',
        input: '?hicUrl=https://example.org/a.hic&tracks=https%3A%2F%2Fexample.org%2Fa.bed%7CA%7Crgb(255%2C0%2C0)',
        note: 'Colour is always the last field, so three fields decode as url | name | colour with no data range. Earlier revisions of docs/url.md called the middle field the data range; no decoder here has ever read it that way.',
    },

    {
        id: 'synth-query-tracks-two-field',
        format: 'query',
        provenance: 'synthesized',
        role: 'branch-coverage',
        source: 'urlUtils.js destringifyTracksV0 — `tokens.length > 1` false after the colour pop',
        outcome: 'decodes',
        input: '?hicUrl=https://example.org/a.hic&tracks=https%3A%2F%2Fexample.org%2Fa.bed%7Crgb(255%2C0%2C0)',
        note: 'Mis-split, and accepted: the whole string including the bar and the colour becomes the URL, and the colour is *also* set. Not a supported layout — pinned so that the collapse does not accidentally start rejecting it.',
    },

    {
        id: 'synth-query-tracks-bare-url',
        format: 'query',
        provenance: 'synthesized',
        role: 'branch-coverage',
        source: 'urlUtils.js destringifyTracksV0 — no bars at all',
        outcome: 'decodes',
        input: '?hicUrl=https://example.org/a.hic&tracks=https%3A%2F%2Fexample.org%2Fa.bed',
        note: 'The single token is popped as the colour and then re-used as the URL, so the track\'s colour is its own URL. Accepted, and wrong.',
    },

    {
        id: 'synth-query-tracks-name-with-bar',
        format: 'query',
        provenance: 'synthesized',
        role: 'branch-coverage',
        source: 'urlUtils.js destringifyTracksV0 — `$` in the name decodes to `|`',
        outcome: 'decodes',
        input: '?hicUrl=https://example.org/a.hic&tracks=https%3A%2F%2Fexample.org%2Fa.bed%7CA%24B%7C0-50%7Crgb(255%2C0%2C0)',
        note: 'How a track name containing a bar survives the field separator. Harvested names carry literal bars via percent-encoding instead (see harvested-query-degron-fully-encoded); both spellings reach the decoder.',
    },

    {
        id: 'synth-query-tracks-negative-range',
        format: 'query',
        provenance: 'synthesized',
        role: 'branch-coverage',
        source: 'urlUtils.js destringifyTracksV0 — the `dataRangeString.startsWith("-")` branch',
        outcome: 'decodes',
        input: '?hicUrl=https://example.org/a.hic&tracks=https%3A%2F%2Fexample.org%2Fa.bed%7CA%7C-5-5%7Crgb(255%2C0%2C0)',
        note: 'A data range starting below zero, written `-5-5` and decoding to min -5, max 5.',
    },

    {
        id: 'synth-query-tracks-empty-range',
        format: 'query',
        provenance: 'synthesized',
        role: 'branch-coverage',
        source: 'urlUtils.js destringifyTracksV0 then fixDefaults',
        outcome: 'decodes',
        input: '?hicUrl=https://example.org/a.hic&tracks=https%3A%2F%2Fexample.org%2Fa.bed%7CA%7C%7Crgb(255%2C0%2C0)',
        note: 'The common harvested shape — every four-field track in test/test_urls.md has an empty range. destringifyTracksV0 sets min and max to NaN and `fixDefaults` then deletes both, so by the time the config leaves extractConfig the range is *absent*, not NaN. #515 is about that round trip through NaN, not about the decoder\'s output.',
    },

    {
        id: 'synth-query-tracks-default-color-stripped',
        format: 'query',
        provenance: 'synthesized',
        role: 'branch-coverage',
        source: 'urlUtils.js fixDefaults — DEFAULT_ANNOTATION_COLOR is deleted',
        outcome: 'decodes',
        input: '?hicUrl=https://example.org/a.hic&tracks=https%3A%2F%2Fexample.org%2Fa.bed%7CA%7C0-50%7Crgb(22%2C%20129%2C%20198)',
        note: 'The colour must match `rgb(22, 129, 198)` byte for byte, spaces included, to be recognised as the default and dropped. Harvested links carry exactly this spelling.',
    },

    {
        id: 'synth-query-tracks-undefined-url',
        format: 'query',
        provenance: 'synthesized',
        role: 'branch-coverage',
        source: 'urlUtils.js destringifyTracksV0 — the `"undefined" !== url` guard',
        outcome: 'decodes',
        input: '?hicUrl=https://example.org/a.hic&tracks=undefined%7CA%7C0-50%7Crgb(255%2C0%2C0)',
        note: 'A track whose URL is the literal string "undefined" is dropped, leaving an empty track list. Written by an older encoder interpolating a missing value.',
    },

    {
        id: 'synth-query-url-shortcuts-https',
        format: 'query',
        provenance: 'synthesized',
        role: 'branch-coverage',
        source: 'urlUtils.js urlShortcuts — *s3/, *s3e/, *enc/',
        outcome: 'decodes',
        input: '?hicUrl=*s3%2Fhiseq%2Fa.hic&controlUrl=*enc%2FENCFF000.hic&tracks=*s3e%2Fb.bed%7CB%7C0-50%7Crgb(255%2C0%2C0)',
        note: 'Shortcuts expand in hicUrl, controlUrl and track URLs — three separate call sites. A session handed straight to restoreSession reaches a fourth, expandSessionUrlShortcuts, which is the duplication ADR-0006 decision 8 hands to candidate 9.',
    },

    {
        id: 'synth-query-url-shortcuts-http',
        format: 'query',
        provenance: 'synthesized',
        role: 'branch-coverage',
        source: 'urlUtils.js urlShortcuts — the trailing-underscore http variants',
        outcome: 'decodes',
        input: '?hicUrl=*s3_%2Fhiseq%2Fa.hic&controlUrl=*s3e_%2Fb.hic',
        note: '*s3_/ and *s3e_/ expand to http rather than https. Both hosts now answer 403 to a browser regardless of scheme (the User-Agent gate), so these expand successfully and then fail to load — a decode fixture, not a load one.',
    },

    {
        id: 'synth-query-every-parameter',
        format: 'query',
        provenance: 'synthesized',
        role: 'branch-coverage',
        source: 'urlUtils.js decodeQuery — every parameter it reads, in one string',
        outcome: 'decodes',
        input: '?hicUrl=https://example.org/a.hic&name=A&controlUrl=https://example.org/b.hic&controlName=B&displayMode=AOB&cycle=true&nvi=123%2C456&controlNvi=789%2C10&selectedGene=MYC&state=1,1,4,0,0,1,KR&colorScale=100,255,0,0&tracks=https%3A%2F%2Fexample.org%2Fa.bed%7CA%7C0-50%7Crgb(255%2C0%2C0)',
        note: 'No harvested link exercises displayMode, cycle or controlNvi. `cycle` is the one parameter written to the config unconditionally, so it is present as undefined even when absent from the URL.',
    },

    {
        id: 'synth-session-with-selected-gene',
        format: 'sessionData',
        provenance: 'synthesized',
        role: 'branch-coverage',
        source: 'urlUtils.js:174-180 — the #481 selectedGene reconciliation',
        outcome: 'decodes',
        input: '?session=data:HZDBboMwEER_pdqzDQ41EPmcROVQIjXHKofFgEABr2WMSEH8e51cRqOn1cxoN6gcLVPjJlC_G8xuAAWd93ZScSxrw8k2htfokdu5GnodTZ8RjriSwWWKNI1xS7NrHRnPl6ayjup4Ccjb2cfHVmQyzwXPhDhy2eaSV61GnmTHWmKS1LlMY3kqL8X3z_WclTLqeg0MDI5N2PF1uejs42RNUQQ4efSBbqA7dwB1YC.TvM1KNIKSDJ6gBIO_t9r.2Qy3fm3eJ4bciEO_ou_JhOzyWp5hDxk0kLtpHF6FByFYkqZMMBEKvUP9eP3lvt_3fw--&selectedGene=MYC',
        note: 'A gene beside a session that does not name one: the query value rides onto the session config rather than being dropped. One of the two paths that used to reach restoreSession through a page-scoped global.',
    },

    {
        id: 'synth-juicebox-browser-carrying-selected-gene',
        format: 'juicebox',
        provenance: 'synthesized',
        role: 'branch-coverage',
        source: 'urlUtils.js:175 — the `fromBrowsers` arm of the selectedGene reconciliation',
        outcome: 'decodes',
        input: '?juicebox={hicUrl%3Dhttps%3A%2F%2Fexample.org%2Fa.hic%26name%3DA%26selectedGene%3DMYC},{hicUrl%3Dhttps%3A%2F%2Fexample.org%2Fb.hic%26name%3DB%26selectedGene%3DACE}',
        note: 'The second of the two paths #481 names: the gene sits inside each browser rather than at the top level, and the *last* browser to name one wins — the order the successive writes to the old page-scoped global produced. Nothing harvested exercises it; the reconciliation is recent and the format is not.',
    },

    {
        id: 'synth-session-and-hic-url-together',
        format: 'query',
        provenance: 'synthesized',
        role: 'branch-coverage',
        source: 'urlUtils.js:157 — `queryConfig.url` overwrites an already-decoded session',
        outcome: 'decodes',
        input: '?session=data:HZDBboMwEER_pdqzDQ41EPmcROVQIjXHKofFgEABr2WMSEH8e51cRqOn1cxoN6gcLVPjJlC_G8xuAAWd93ZScSxrw8k2htfokdu5GnodTZ8RjriSwWWKNI1xS7NrHRnPl6ayjup4Ccjb2cfHVmQyzwXPhDhy2eaSV61GnmTHWmKS1LlMY3kqL8X3z_WclTLqeg0MDI5N2PF1uejs42RNUQQ4efSBbqA7dwB1YC.TvM1KNIKSDJ6gBIO_t9r.2Qy3fm3eJ4bciEO_ou_JhOzyWp5hDxk0kLtpHF6FByFYkqZMMBEKvUP9eP3lvt_3fw--&hicUrl=https%3A%2F%2Fexample.org%2Fwins.hic',
        note: 'Precedence, and the one place the decoder silently discards a whole session: `hicUrl` wins and the decoded session is thrown away. Not a rejection, not an error, and not documented anywhere — pinned because the collapse has to preserve it or knowingly change it.',
    },

    // ---------------------------------------------------------------------
    // Expected to be rejected. A decoder's rejections are part of its contract.
    // ---------------------------------------------------------------------

    {
        id: 'reject-session-gzip-data-uri',
        format: 'sessionData',
        provenance: 'harvested',
        role: 'load-bearing',
        source: 'Spacewalk src/sessionURLCodec.js — the `/gzip;base64` arm of uncompressSessionURL',
        outcome: 'throws',
        input: '?session=data:application/gzip;base64,H4sIAAAAAAAAE6tWSirKLy9OLSpWsoquViotylGyUsooKSkottLXT61IzC3ISdXLL0rXT9TLyExW0lHKS8xNVbJSclSqja0FAMrS4c89AAAA',
        note: 'A real data URI carrying gzipped session JSON. **Spacewalk decodes this and juicebox throws on it**, under the same `?session=` parameter name — juicebox tests only the five-character `data:` prefix and hands the remainder to BGZip.uncompressString, which is not what a data URI holds. Harvested as a *form Spacewalk accepts*, not as a string seen in the wild; Spacewalk documents it as one of two "historical forms", so something once wrote it. The payload here decodes to {"browsers":[{"url":"https://example.org/a.hic","name":"A"}]}. This is the sharpest single piece of evidence that the wire format has two readers — see the harvest-scope note at the top of this file.',
    },

    {
        id: 'reject-session-url-unreachable',
        format: 'sessionUrl',
        provenance: 'synthesized',
        role: 'branch-coverage',
        source: 'urlUtils.js:121-124 — the loadString catch',
        outcome: 'throws',
        input: '?session=https://example.org/fixtures/does-not-exist.json',
        loaderResponse: null,
        note: 'A `loaderResponse` of null means the loader rejects. Wrapped as "Failed to load session from URL/file: …". This is the failure a stale `?session=` link produces, and the outer of the two nested catches — the inner one is reject-session-url-invalid-json.',
    },

    {
        id: 'reject-session-url-invalid-json',
        format: 'sessionUrl',
        provenance: 'synthesized',
        role: 'branch-coverage',
        source: 'urlUtils.js:117-120 — the inner parse catch',
        outcome: 'throws',
        input: '?session=https://example.org/fixtures/not-json.txt',
        loaderResponse: '<!doctype html><title>404</title>',
        note: 'The loader succeeds and returns something that is neither compressed nor JSON — in practice a login page or an error page served with a 200. Wrapped as "Failed to parse session from URL/file: …".',
    },

    {
        id: 'reject-session-blob-corrupt',
        format: 'sessionBlob',
        provenance: 'synthesized',
        role: 'branch-coverage',
        source: 'urlUtils.js:89 — BGZip.uncompressString on a payload that is not compressed',
        outcome: 'throws',
        input: '?session=blob:not-actually-compressed',
        note: 'Throws out of the decompressor, uncaught and unwrapped — the `blob:`/`data:` arm has no try/catch, unlike the file and URL arms. The message is undefined. A truncated share link lands here.',
    },

    {
        id: 'reject-session-file-invalid-json',
        format: 'sessionFile',
        provenance: 'synthesized',
        role: 'branch-coverage',
        source: 'urlUtils.js:101-104 — the isFile catch',
        outcome: 'throws',
        fileText: '{ this is not json',
        note: 'Wrapped: "Failed to parse session file: …". Same reachability caveat as the other sessionFile fixtures.',
    },

    {
        id: 'reject-query-no-recognized-parameters',
        format: 'query',
        provenance: 'synthesized',
        role: 'branch-coverage',
        source: 'urlUtils.js:157 — `queryConfig.url` is the gate on the whole query form',
        outcome: 'no-config',
        input: 'https://example.org/index.html?foo=bar&baz=1',
        note: 'Returns undefined, which is how init.js knows to keep the config the host passed it. A URL carrying every parameter *except* hicUrl decodes to nothing at all: `url` is the only one that makes a query config real.',
    },

    {
        id: 'reject-query-empty',
        format: 'query',
        provenance: 'synthesized',
        role: 'branch-coverage',
        source: 'urlUtils.js extractQuery — no query string',
        outcome: 'no-config',
        input: 'https://example.org/index.html',
        note: 'The overwhelmingly common case in production: a host app embedding juicebox on a plain URL.',
    },

    {
        id: 'reject-query-selected-gene-alone',
        format: 'query',
        provenance: 'synthesized',
        role: 'branch-coverage',
        source: 'urlUtils.js:174 — no sessionConfig for the gene to ride',
        outcome: 'no-config',
        input: '?selectedGene=MYC',
        note: 'Explicitly not preserved, and documented as such at urlUtils.js:170-173. Juicebox never writes such a URL — every URL it produces carries the gene inside the session it also writes. #481.',
    },
]

/**
 * Fixtures for `State.parse` (`js/hicState.js`), the `state` query parameter on
 * its own.
 *
 * Separate from the corpus above because the state string is a wire format in
 * its own right — it is the one piece of the query form that also appears inside
 * session JSON, and the one with two live versions. The query fixtures above
 * exercise it through the decoder; these pin it directly, which is what
 * `test/testState.js`'s wire-format block already does by hand.
 */
export const stateStringCorpus = [
    {
        id: 'state-v0-seven-token',
        version: 'v0',
        provenance: 'harvested',
        role: 'load-bearing',
        source: 'the published Haarhuis et al. link; also test/testURL.js',
        input: '3,3,6,5537.98746,5537.749239047619,1,KR',
    },
    {
        id: 'state-v0-seven-token-encoded-origin',
        version: 'v0',
        provenance: 'harvested',
        role: 'load-bearing',
        source: 'git log — Rao et al. degron link, after percent-decoding',
        input: '3,3,7,19215,19215,1.55,KR',
    },
    {
        id: 'state-v0-six-token-no-normalization',
        version: 'v0',
        provenance: 'synthesized',
        role: 'branch-coverage',
        source: 'State.parse — `tokens.length > 6` false',
        input: '1,2,4,10,20,3',
        note: 'Normalization defaults to NONE.',
    },
    {
        id: 'state-v1-nine-token',
        version: 'v1',
        provenance: 'synthesized',
        role: 'branch-coverage',
        source: 'State.parse — the `> 7` branch',
        input: '3,5,6,100,200,0,0,2,KR',
        note: 'Zeroes in the filler positions, as State.stringify() wrote them from March 2025 until it was deleted in #501.',
    },
    {
        id: 'state-v1-nine-token-legacy-viewport',
        version: 'v1',
        provenance: 'synthesized',
        role: 'branch-coverage',
        source: 'docs/url.md — filler tokens carrying a real viewport size',
        input: '3,5,6,100,200,1250,1250,2,KR',
        note: 'Decodes identically to state-v1-nine-token. The filler positions held the view width and height until 5a933f3; the decoder has never read them.',
    },
    {
        id: 'state-v1-eight-token-no-normalization',
        version: 'v1',
        provenance: 'synthesized',
        role: 'branch-coverage',
        source: 'State.parse — `> 7` with `tokens.length > 8` false',
        input: '3,5,6,100,200,0,0,2',
        note: 'Eight tokens is v1. The discriminator is *more than seven*, not *exactly nine*.',
    },
    {
        id: 'state-v0-transposed-pair',
        version: 'v0',
        provenance: 'synthesized',
        role: 'branch-coverage',
        source: 'State constructor — chr1 > chr2',
        input: '5,3,6,100,200,2,KR',
        note: 'Decodes equal to `3,5,6,200,100,2,KR`: chromosomes and origins swap together. ADR-0006 decision 3.',
    },
    {
        id: 'state-v1-transposed-pair',
        version: 'v1',
        provenance: 'synthesized',
        role: 'branch-coverage',
        source: 'State constructor — chr1 > chr2, v1 token layout',
        input: '5,3,6,100,200,0,0,2,KR',
        note: 'Decodes equal to `3,5,6,200,100,0,0,2,KR`.',
    },
    {
        id: 'state-truncated',
        version: 'v0',
        provenance: 'synthesized',
        role: 'branch-coverage',
        source: 'State.parse — fewer tokens than the layout needs',
        input: '1,2',
        note: 'Accepted. zoom, x and y come back NaN; pixelSize falls to the constructor default. Not a rejection.',
    },
]
