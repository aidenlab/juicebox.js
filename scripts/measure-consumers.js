#!/usr/bin/env node
/**
 * Re-run ADR-0003's measurement: what do the known host apps actually use?
 *
 * juicebox.js is an embeddable component. `js/index.js` exports twelve names and
 * `HICBrowser` is not one of them, so asking "does anything call this?" and
 * grepping `js/` returns *no* for members two shipped applications depend on.
 * `js/publicApi.js` declares the surface and `test/testPublicApi.js` enforces
 * that the declared names exist -- but nothing here can see the other side of
 * the contract, because the consumers are repos this one does not build or test
 * against. That check is this script, and it is deliberately not a test: it
 * needs two sibling checkouts, and a suite that skips when they are absent
 * would be a green result proving nothing.
 *
 * It answers one question -- **is a host using something we have not declared?**
 * That is the `MapLoad` failure mode from ADR-0003, where juicebox-web
 * subscribed to an event this repo stopped posting in v3.1.0 and nothing broke
 * loudly for eight months.
 *
 * It reports candidates, not verdicts. Two reasons it cannot be an oracle, both
 * from ADR-0003's measurement trap:
 *
 * - Spacewalk embeds **igv as well as juicebox**, and both are reached through a
 *   variable named `browser`. Scoping to `src/juicebox/` removes most of that,
 *   not all of it.
 * - A property access is matched by name, not resolved. `foo.update()` on some
 *   other object looks exactly like `contactMatrixView.update()`.
 *
 * So every hit is a call site to open and confirm by hand. The exit code is a
 * prompt to look, not a failure.
 *
 * The two `*_PAYLOAD_SHAPES` manifests are **not** checked. They describe what a
 * host reads *into* a payload, which no textual grep can attribute to us.
 *
 * Run it from the repo root, `npm run measure-consumers`, before a release; fold
 * the result into ADR-0003 as a new dated re-measurement section.
 */

import fs from 'node:fs'
import path from 'node:path'
import {fileURLToPath} from 'node:url'
import {
    NAMESPACE_SURFACE,
    BROWSER_SURFACE,
    REGISTRY_SURFACE,
    POST_LOAD_SURFACE,
    SUB_SURFACES,
    COORDINATOR_CALLBACKS,
    EVENTS_POSTED
} from '../js/publicApi.js'

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

/**
 * Where the consumers are and which of their source counts.
 *
 * `scope` is load-bearing for Spacewalk and is the trap ADR-0003 wrote down: a
 * naive grep of all of `src/` returns `trackViews`, `loadGenome`,
 * `referenceFrameList` and friends, none of which are ours -- they are
 * `igvPanel.browser`. Override either path with `SPACEWALK_PATH` /
 * `JUICEBOX_WEB_PATH`; note the two are not siblings of each other.
 */
const consumers = [
    {
        name: 'spacewalk',
        root: process.env.SPACEWALK_PATH ?? path.resolve(repoRoot, '../../SpacewalkDevelopment/spacewalk'),
        scope: 'src/juicebox'
    },
    {
        name: 'juicebox-web',
        root: process.env.JUICEBOX_WEB_PATH ?? path.resolve(repoRoot, '../juicebox-web'),
        scope: 'js'
    }
]

/**
 * The objects whose property accesses are ours to classify.
 *
 * Without this every `foo.bar` in the consumer is a candidate. The split
 * matters: a **root** is a name only a juicebox object goes by, so it counts
 * anywhere in a chain. A **reachable** is a juicebox object a host holds
 * directly, and only counts as the head of a chain -- juicebox-web's
 * `option.dataset.url` is an HTMLElement's `dataset`, not ours, and the
 * position is what tells them apart.
 *
 * Names, not members: a receiver name survives a consumer refactor in a way a
 * member count does not.
 */
const roots = new Set(['browser', 'hic', 'juicebox', 'registry'])
const reachable = new Set(['dataset', 'activeDataset', 'contactMatrixView', 'layoutController', 'coordinator'])

/**
 * Where our contract stops inside a chain.
 *
 * `contactMatrixView.viewportElement.offsetWidth` reaches a DOM element we hand
 * over: `viewportElement` is ours to declare, `offsetWidth` is the DOM's. So a
 * chain is followed only while each link is itself an object we publish.
 */
const publishes = name => roots.has(name) || reachable.has(name)

/** Every declared name, flattened to the spelling a grep would find. */
function declaredNames() {
    const names = new Set([
        ...NAMESPACE_SURFACE,
        ...BROWSER_SURFACE,
        ...REGISTRY_SURFACE,
        ...COORDINATOR_CALLBACKS,
        ...EVENTS_POSTED.map(event => event.name),
        ...SUB_SURFACES.map(entry => entry.member)
    ])
    // POST_LOAD_SURFACE holds dotted paths; every segment past the receiver is a
    // declared reachable name.
    for (const {path: dotted} of POST_LOAD_SURFACE) {
        for (const segment of dotted.split('.').slice(1)) names.add(segment)
    }
    return names
}

function sourceFiles(directory) {
    const found = []
    const walk = current => {
        for (const entry of fs.readdirSync(current, {withFileTypes: true})) {
            if (entry.name === 'node_modules' || entry.name.startsWith('.')) continue
            const full = path.join(current, entry.name)
            if (entry.isDirectory()) walk(full)
            else if (/\.(js|mjs|jsx|ts)$/.test(entry.name)) found.push(full)
        }
    }
    walk(directory)
    return found
}

/**
 * A whole property chain, so every link in it is seen.
 *
 * Matching one pair at a time misses the far end of
 * `browser.layoutController.getContactMatrixViewport()` -- the sub-surface case,
 * which is the easiest part of the contract to miss and so the part most worth
 * catching. `?.` counts: Spacewalk reaches the same viewport optionally.
 */
const CHAIN = /(?:^|[^\w$.?])(?:this\??\.)?([A-Za-z_$][\w$]*(?:\s*\??\.\s*[A-Za-z_$][\w$]*)+)/g

/**
 * An event or callback name registered on one of our objects.
 *
 * The chain has to *start* at a receiver, which is what tells
 * `browser.eventBus.subscribe('DidHideCrosshairs')` and juicebox-web's
 * `hic.EventBus.globalBus.subscribe(...)` apart from Spacewalk's own
 * `SpacewalkEventBus.globalBus.subscribe('DidLoadEnsembleFile')` -- three
 * identical-looking calls, one of them not ours.
 */
const LITERAL = /(?:^|[^\w$.])(?:this\.)?([A-Za-z_$][\w$]*)[\w$.]*\.(?:subscribe|addCallback)\s*\(\s*['"]([^'"]+)['"]/g

/** A property access never lives inside a string, but `'juicebox.js'` looks like one. */
const stripStrings = line => line.replace(/(['"`])(?:\\.|(?!\1)[^\\])*\1/g, '""')

/** Undeclared names a consumer appears to use, as file:line candidates. */
function measure(consumer, declared) {
    const scoped = path.join(consumer.root, consumer.scope)
    if (!fs.existsSync(scoped)) return null

    const hits = new Map()
    const record = (name, file, lineNumber) => {
        const where = `${path.relative(consumer.root, file)}:${lineNumber}`
        if (hits.has(name)) hits.get(name).push(where)
        else hits.set(name, [where])
    }

    for (const file of sourceFiles(scoped)) {
        const lines = fs.readFileSync(file, 'utf8').split('\n')
        lines.forEach((line, index) => {
            if (/^\s*(\/\/|\*|\/\*)/.test(line)) return
            for (const [, receiver, name] of line.matchAll(LITERAL)) {
                if (roots.has(receiver) && !declared.has(name)) record(name, file, index + 1)
            }
            const code = stripStrings(line)
            for (const [, chain] of code.matchAll(CHAIN)) {
                const links = chain.split(/\s*\??\.\s*/)
                let at = links.findIndex(link => roots.has(link))
                if (at === -1 && reachable.has(links[0])) at = 0
                if (at === -1) continue
                // Walk the tail rather than the first hop alone: the sub-surface
                // case (`browser.layoutController.getContactMatrixViewport`) is
                // the easiest part of the contract to miss.
                while (at < links.length - 1 && publishes(links[at])) {
                    const member = links[at + 1]
                    if (!declared.has(member)) record(member, file, index + 1)
                    at += 1
                }
            }
        })
    }
    return hits
}

function main() {
    const declared = declaredNames()
    let anyFound = false
    let measured = 0

    console.log('Consumer measurement -- undeclared names in use (ADR-0003)\n')

    for (const consumer of consumers) {
        const hits = measure(consumer, declared)
        if (hits === null) {
            console.log(`${consumer.name}: skipped, no checkout at ${consumer.root}\n`)
            continue
        }
        measured += 1
        if (hits.size === 0) {
            console.log(`${consumer.name} (${consumer.scope}): nothing undeclared.\n`)
            continue
        }
        anyFound = true
        console.log(`${consumer.name} (${consumer.scope}): ${hits.size} candidate(s)`)
        for (const [name, sites] of [...hits].sort()) {
            console.log(`  ${name}  ${sites.join(', ')}`)
        }
        console.log()
    }

    console.log('Candidates, not verdicts: names are matched textually, never resolved.')
    console.log('Spacewalk reaches igv through a variable named `browser` too -- open each')
    console.log('site before believing it. Payload shapes are not checked at all.')

    if (measured === 0) process.exit(0)
    process.exit(anyFound ? 1 : 0)
}

main()
