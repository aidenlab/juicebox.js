/**
 * Guards the fixture corpus itself, not the decoder.
 *
 * The golden-file characterization test ADR-0006 asks for is a later ticket; the
 * corpus lands first, deliberately, so that it exists before one line of decoder
 * code moves. What this file checks is that the corpus is *honest*: that every
 * accepted format has a fixture, that no fixture misdeclares its provenance or
 * shape, and — the part that rots fastest — that every `outcome` still matches
 * what the decoder actually does.
 *
 * A fixture whose `outcome` has silently drifted is worse than no fixture: the
 * snapshot runner would record a throw where the corpus promised a config and
 * nobody would look. #502.
 */
import { describe, test, expect, vi, afterEach } from 'vitest'
import { igvxhr } from 'igv-utils'
import { extractConfig } from '../js/urlUtils.js'
import State from '../js/hicState.js'
import {
    FORMATS,
    OUTCOMES,
    selfContained,
    stateStringCorpus,
    viaLoader,
    wireFormatCorpus,
} from './data/wireFormatCorpus.js'

const stateStringById = Object.fromEntries(stateStringCorpus.map(f => [f.id, f.input]))

describe('wire-format corpus — shape', () => {

    test('every fixture id is unique', () => {
        const ids = [...wireFormatCorpus, ...stateStringCorpus].map(f => f.id)
        expect(new Set(ids).size).toBe(ids.length)
    })

    test('every fixture declares provenance, role, source and a known format', () => {
        for (const fixture of wireFormatCorpus) {
            expect(FORMATS, fixture.id).toContain(fixture.format)
            expect(OUTCOMES, fixture.id).toContain(fixture.outcome)
            expect(['harvested', 'harvested-external', 'synthesized'], fixture.id).toContain(fixture.provenance)
            expect(['load-bearing', 'branch-coverage'], fixture.id).toContain(fixture.role)
            expect(fixture.source, fixture.id).toBeTruthy()
        }
    })

    test('harvested fixtures are load-bearing and synthesized ones are branch coverage', () => {
        // The two axes are one axis. Harvesting is what makes a fixture evidence
        // about the real inbound population; synthesizing is what makes it
        // evidence only about a branch. ADR-0006, "How we know the decoder did
        // not change".
        //
        // `harvested-external` (#509) is a third provenance and not a third
        // role: a link recovered from an issue tracker is stronger evidence than
        // one recovered from our own test files, but it buys the suite the same
        // thing, so the distinction stays on the origin axis.
        for (const fixture of [...wireFormatCorpus, ...stateStringCorpus]) {
            const harvested = fixture.provenance.startsWith('harvested')
            expect(fixture.role, fixture.id).toBe(harvested ? 'load-bearing' : 'branch-coverage')
        }
    })

    test('every fixture carries an input, a loader response or a file text', () => {
        for (const fixture of wireFormatCorpus) {
            const carriers = [fixture.input, fixture.loaderResponse, fixture.fileText]
            expect(carriers.some(c => typeof c === 'string'), fixture.id).toBe(true)
        }
    })

    test('every accepted format has at least one fixture', () => {
        const covered = new Set(wireFormatCorpus.map(f => f.format))
        expect([...FORMATS].filter(f => !covered.has(f))).toEqual([])
    })

    test('the harvested half is not empty for the formats still in the wild', () => {
        // Synthesized-only would be circular for these: they are the formats a
        // pasted link actually arrives in.
        for (const format of ['sessionBlob', 'query', 'juicebox']) {
            const harvested = wireFormatCorpus
                .filter(f => f.format === format && f.provenance === 'harvested')
            expect(harvested.length, format).toBeGreaterThan(0)
        }
    })

    test('inputs expected to be rejected are present and marked', () => {
        const rejected = wireFormatCorpus.filter(f => f.outcome !== 'decodes')
        expect(rejected.length).toBeGreaterThan(0)
        for (const fixture of rejected) {
            expect(fixture.note, fixture.id).toBeTruthy()
        }
    })

    test('both state-string versions are covered', () => {
        const versions = new Set(stateStringCorpus.map(f => f.version))
        expect([...versions].sort()).toEqual(['v0', 'v1'])
    })
})

describe('wire-format corpus — the declared outcome is the real one', () => {

    for (const fixture of selfContained) {
        test(fixture.id, async () => {
            if (fixture.outcome === 'throws') {
                await expect(extractConfig(fixture.input)).rejects.toBeDefined()
                return
            }

            const config = await extractConfig(fixture.input)

            if (fixture.outcome === 'no-config') {
                expect(config).toBeUndefined()
            } else {
                expect(config).toBeDefined()
            }
        })
    }
})

/**
 * The `session=<url>` fixtures, driven from their `loaderResponse` literal.
 *
 * This is what ADR-0006 decision 10's injected loader buys, done by hand until
 * the loader exists: stub the one I/O call and the whole decode path runs off
 * string literals. A `loaderResponse` of null means the fetch itself fails.
 */
describe('wire-format corpus — session URLs decode from their loader response', () => {

    afterEach(() => vi.restoreAllMocks())

    for (const fixture of viaLoader) {
        test(fixture.id, async () => {
            vi.spyOn(igvxhr, 'loadString').mockImplementation(async () => {
                if (fixture.loaderResponse === null) throw new Error('simulated fetch failure')
                return fixture.loaderResponse
            })

            if (fixture.outcome === 'throws') {
                await expect(extractConfig(fixture.input)).rejects.toBeDefined()
            } else {
                expect(await extractConfig(fixture.input)).toBeDefined()
            }
        })
    }
})

describe('wire-format corpus — state strings decode', () => {

    for (const fixture of stateStringCorpus) {
        test(fixture.id, () => {
            const state = State.parse(fixture.input)
            expect(state.chr1).toBeLessThanOrEqual(state.chr2)
        })
    }

    test('a transposed pair is the same view under its second spelling', () => {
        expect(State.parse(stateStringById['state-v0-transposed-pair']).toJSON())
            .toEqual(State.parse('3,5,6,200,100,2,KR').toJSON())

        expect(State.parse(stateStringById['state-v1-transposed-pair']).toJSON())
            .toEqual(State.parse('3,5,6,200,100,0,0,2,KR').toJSON())
    })

    test('the v1 filler tokens are not read', () => {
        expect(State.parse(stateStringById['state-v1-nine-token-legacy-viewport']).toJSON())
            .toEqual(State.parse(stateStringById['state-v1-nine-token']).toJSON())
    })
})
