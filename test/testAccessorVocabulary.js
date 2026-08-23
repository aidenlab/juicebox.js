import {describe, it, expect} from 'vitest'
import fs from 'fs'
import path from 'path'
import {fileURLToPath} from 'url'
import {withBrowser} from './utils/browserFixture.js'
import {withStubbedLoads} from './utils/stubbedLoads.js'

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
 * reading either name sees the same object. And that nothing *inside* this repo
 * reads the alias, because the alias exists only for consumers we cannot see:
 * an internal read is how a second vocabulary grows back.
 *
 * The state half is read-only as of #563 (ADR-0009 decision 7): `state` and
 * `activeState` are getters over a private field, and the setters that used to
 * stand beside them -- commented "direct assignment bypasses validation", with
 * no production caller -- are gone. So the state claims here are made against a
 * state the chokepoint installed, and the last one pins the absence itself.
 * Reading is plausible host behaviour and stays; writing is not, and went.
 */

const jsDirectory = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../js')

describe('alias accessors', () => {

    const context = withBrowser()
    withStubbedLoads()

    /** A state in force, put there the only way there is: the chokepoint. */
    async function load() {
        await context.browser.loadHicFile({url: 'https://example.org/alias-vocabulary.hic'})
        expect(context.browser.state).toBeDefined()
    }

    it('reads the same dataset through either name', () => {
        const dataset = {name: 'stand-in'}
        context.browser.dataset = dataset
        expect(context.browser.activeDataset).toBe(dataset)
        expect(context.browser.activeDataset).toBe(context.browser.dataset)
    })

    it('reads the same state through either name', async () => {
        await load()
        expect(context.browser.activeState).toBe(context.browser.state)
    })

    it('writes the dataset through the alias to the canonical name', () => {
        const dataset = {name: 'stand-in'}
        context.browser.activeDataset = dataset
        expect(context.browser.dataset).toBe(dataset)
    })

    it('has no state setter under either name', async () => {
        await load()

        const inForce = context.browser.state

        // Strict mode, so the assignment throws rather than failing quietly --
        // which is the point: a host that was writing state finds out.
        for (const name of ['state', 'activeState']) {
            expect(Object.getOwnPropertyDescriptor(Object.getPrototypeOf(context.browser), name).set,
                `"${name}" has a setter again`).toBeUndefined()
            expect(() => { context.browser[name] = {chr1: 9, chr2: 9} }).toThrow(TypeError)
        }

        expect(context.browser.state).toBe(inForce)
    })
})

describe('internal call sites', () => {

    /**
     * Lines that may mention the alias, by repo-relative path.
     *
     * Exemptions are per line rather than per file: exempting `hicBrowser.js`
     * outright would excuse the largest internal reader there ever was. A line
     * in one of these files still fails unless it is one of the shapes below.
     */
    const allowances = new Map([
        // The alias accessors themselves, and the doc comments that explain the
        // arrangement -- prose is not a read. `stateManager.js` used to want a
        // third allowance for its own two fields; #563 folded it away, and the
        // fields are `dataset` and a private `#state` on the browser now.
        ['hicBrowser.js', [/^\s*(get|set) active(Dataset|State)\(/, /^\s*(\*|\/\/|\/\*)/]],
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
