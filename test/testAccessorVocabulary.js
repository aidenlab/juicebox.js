import {describe, it, expect} from 'vitest'
import fs from 'fs'
import path from 'path'
import {fileURLToPath} from 'url'
import {withBrowser} from './utils/browserFixture.js'

/**
 * One accessor vocabulary for dataset and state -- see #468.
 *
 * `dataset`/`state` is canonical: it is what the render path, `toJSON()` and
 * `resolution()` already read, and `activeDataset` earns its "active" only when
 * read next to `controlDataset`. `activeDataset`/`activeState` survive as
 * aliases because a host app reads them -- Spacewalk, `juiceboxPanel.js`, four
 * sites. They are not deprecated, because no removal is scheduled.
 *
 * Two things are worth pinning. That the alias really is an alias, so a host
 * writing either name sees the same object. And that nothing *inside* this repo
 * reads the alias, because the alias exists only for consumers we cannot see:
 * an internal read is how a second vocabulary grows back.
 */

const jsDirectory = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../js')

describe('alias accessors', () => {

    const context = withBrowser()

    it('reads the same dataset through either name', () => {
        const dataset = {name: 'stand-in'}
        context.browser.dataset = dataset
        expect(context.browser.activeDataset).toBe(dataset)
        expect(context.browser.activeDataset).toBe(context.browser.dataset)
    })

    it('reads the same state through either name', () => {
        const state = {chr1: 0, chr2: 0}
        context.browser.state = state
        expect(context.browser.activeState).toBe(state)
        expect(context.browser.activeState).toBe(context.browser.state)
    })

    it('writes through the alias to the canonical name', () => {
        const dataset = {name: 'stand-in'}
        const state = {chr1: 1, chr2: 1}
        context.browser.activeDataset = dataset
        context.browser.activeState = state
        expect(context.browser.dataset).toBe(dataset)
        expect(context.browser.state).toBe(state)
    })
})

describe('internal call sites', () => {

    /**
     * Lines that may mention the alias, by repo-relative path.
     *
     * Exemptions are per line rather than per file: exempting `hicBrowser.js`
     * outright would excuse the largest internal reader there ever was, and
     * exempting `stateManager.js` would let a `browser.activeDataset` read in
     * there pass. A line in one of these files still fails unless it is one of
     * the shapes below.
     */
    const allowances = new Map([
        // The alias accessors themselves, the one place the state field is
        // written through the manager rather than through setActiveDataset, and
        // the doc comments that explain the arrangement -- prose is not a read.
        ['hicBrowser.js', [/^\s*(get|set) active(Dataset|State)\(/, /^\s*this\.stateManager\.activeState\b/, /^\s*(\*|\/\/|\/\*)/]],
        // StateManager's own fields, not the browser accessor. Collapsing
        // StateManager is its own candidate; until then its internal spelling
        // is its business, but reaching for the browser's alias is not. Prose is
        // exempt here for the same reason it is in hicBrowser.js -- a doc
        // comment naming the field it documents is not a read, and #559's
        // `setActiveDataset` comment is one.
        ['stateManager.js', [/\bthis\.active(Dataset|State)\b/, /^\s*(\*|\/\/|\/\*)/]],
        // The declaration of the aliases as public surface.
        ['publicApi.js', [/active(Dataset|State)/]]
    ])

    function sourceFiles(directory) {
        return fs.readdirSync(directory, {withFileTypes: true}).flatMap(entry => {
            const entryPath = path.join(directory, entry.name)
            if (entry.isDirectory()) return sourceFiles(entryPath)
            return entry.isFile() && entry.name.endsWith('.js') ? [entryPath] : []
        })
    }

    it('reads dataset and state, never the alias', () => {

        const offenders = []

        for (const filePath of sourceFiles(jsDirectory)) {
            const relativePath = path.relative(jsDirectory, filePath)
            const allowed = allowances.get(relativePath) || []
            const lines = fs.readFileSync(filePath, 'utf8').split('\n')
            lines.forEach((line, index) => {
                if (!/activeDataset|activeState/.test(line)) return
                if (allowed.some(pattern => pattern.test(line))) return
                offenders.push(`${relativePath}:${index + 1}`)
            })
        }

        expect(offenders, `these mention the alias instead of dataset/state: ${offenders.join(', ')}`).toEqual([])
    })
})
