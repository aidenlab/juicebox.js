/**
 * An unindexed FASTA is given the conventional sibling `.fai`. #587; the why is
 * in js/sequenceIndex.js.
 */
import {describe, it, expect, vi, afterEach} from 'vitest'
import {inferSequenceIndex} from '../js/sequenceIndex.js'

afterEach(() => vi.restoreAllMocks())

describe('inferSequenceIndex', () => {

    it('gives an unindexed FASTA the sibling .fai', () => {
        vi.spyOn(console, 'warn').mockImplementation(() => {})
        const config = {url: 'https://igv.org/genomes/data/hg38/hg38.fa'}
        inferSequenceIndex(config)
        expect(config.indexURL).toBe('https://igv.org/genomes/data/hg38/hg38.fa.fai')
    })

    it('says on the console that it guessed, naming the guess', () => {
        const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
        inferSequenceIndex({url: 'https://igv.org/genomes/data/hg38/hg38.fa'})
        expect(warn).toHaveBeenCalledTimes(1)
        expect(warn.mock.calls[0].join(' ')).toContain('https://igv.org/genomes/data/hg38/hg38.fa.fai')
    })

    it('puts the .fai before a query string, so a signed URL keeps its signature', () => {
        vi.spyOn(console, 'warn').mockImplementation(() => {})
        const config = {url: 'https://bucket.example.org/hg38.fa?X-Amz-Signature=abc&X-Amz-Expires=3600'}
        inferSequenceIndex(config)
        expect(config.indexURL).toBe('https://bucket.example.org/hg38.fa.fai?X-Amz-Signature=abc&X-Amz-Expires=3600')
    })

    it('leaves a config that names its index alone, and says nothing', () => {
        const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
        const config = {url: 'https://example.org/hg38.fa', indexURL: 'https://elsewhere.org/hg38.index'}
        inferSequenceIndex(config)
        expect(config.indexURL).toBe('https://elsewhere.org/hg38.index')
        expect(warn).not.toHaveBeenCalled()
    })

    describe('is not guessed for', () => {

        it('a data: URL, which has no sibling', () => {
            const config = {url: 'data:application/gzip;base64,H4sIAAAAAAAAA0vMTQUAAAD//w=='}
            inferSequenceIndex(config)
            expect(config.indexURL).toBeUndefined()
        })

        it('a local File, which has no URL to put a sibling beside', () => {
            const config = {url: new File(['>chr1\nACGT\n'], 'local.fa')}
            inferSequenceIndex(config)
            expect(config.indexURL).toBeUndefined()
        })

        it('a config that says it is not indexed', () => {
            const config = {url: 'https://example.org/small.fa', indexed: false}
            inferSequenceIndex(config)
            expect(config.indexURL).toBeUndefined()
        })
    })
})
