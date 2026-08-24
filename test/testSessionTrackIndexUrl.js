/**
 * A saved session keeps a track's `indexURL`.
 *
 * `HICBrowser.toJSON` copies a whitelist of track fields, and `indexURL` was not
 * on it. The field is what makes a track *random-access*, so dropping it does
 * not fail the reload -- it silently downgrades the track to a whole-file read,
 * and the reload only stalls once the view is zoomed in far enough for igv to
 * ask for data. The report that found it was a session saved at 1kb over a
 * `hg38.fa` sequence track: restoring it fetched the entire three-gigabyte FASTA
 * and never finished, while the same session saved zoomed out restored in
 * seconds because nothing had asked the sequence track for anything yet.
 *
 * The dev-proxy spelling is asserted alongside it: `mapTrackConfig` stashes the
 * *original* `indexURL` next to the original url, and a session must carry that
 * one rather than the proxied path -- the same rule as the url itself, #450.
 */
import {describe, it, expect, afterEach} from 'vitest'
import {withContainers} from './utils/browserFixture.js'
import HICBrowser from '../js/hicBrowser.js'
import State from '../js/hicState.js'
import {setUrlMapper, mapTrackConfig} from '../js/urlMapper.js'

const FASTA = 'https://igv.org/genomes/data/hg38/hg38.fa'
const FAI = 'https://igv.org/genomes/data/hg38/hg38.fa.fai'

/** The one thing `toJSON` reads off a dataset, plus the nvi it looks for. */
function stubDataset(url) {
    return {url, name: 'map', hicFile: {config: {}}}
}

/** A `trackPairs` entry, cut down to the `x.track` `toJSON` reaches through. */
function stubTrackPair(config) {
    return {x: {track: {config, name: config.name}}}
}

function serializeWithTracks(browser, configs) {
    browser.dataset = stubDataset('https://example.org/map.hic')
    // `state` is a getter over a private field; the chokepoint that writes it is
    // async and renders. What `toJSON` wants is a State to stringify, so one is
    // placed over the getter for the call.
    Object.defineProperty(browser, 'state', {value: State.default(), configurable: true})
    browser.trackPairs = configs.map(stubTrackPair)
    browser.tracks2D = []
    return browser.toJSON().tracks
}

describe('a saved track keeps its index', () => {

    const dom = withContainers()

    afterEach(() => setUrlMapper(undefined))

    it('serializes indexURL', () => {
        const browser = new HICBrowser(dom.another(), {})
        const [track] = serializeWithTracks(browser, [
            {url: FASTA, indexURL: FAI, type: 'sequence', format: 'sequence'}
        ])
        expect(track.indexURL).toBe(FAI)
    })

    it('leaves indexURL out entirely when the track has none', () => {
        const browser = new HICBrowser(dom.another(), {})
        const [track] = serializeWithTracks(browser, [
            {url: 'https://example.org/a.bigWig', type: 'wig', format: 'bigwig'}
        ])
        expect(Object.hasOwn(track, 'indexURL')).toBe(false)
    })

    it('serializes the original indexURL, not the mapped one', () => {
        setUrlMapper(url => `/__hic-proxy/${url}`)
        const browser = new HICBrowser(dom.another(), {})
        const [track] = serializeWithTracks(browser, [
            mapTrackConfig({url: FASTA, indexURL: FAI, type: 'sequence', format: 'sequence'})
        ])
        expect(track.url).toBe(FASTA)
        expect(track.indexURL).toBe(FAI)
    })
})
