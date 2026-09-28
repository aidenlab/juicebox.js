# The release ceremony

How a juicebox.js release is cut, and how the two host apps are moved onto it.

Reverse-engineered from v3.6.1 (2026-08-05), v4.0.0 (2026-08-24), v4.1.0 / v4.1.1
(2026-08-24) and v4.2.0 (2026-08-26), and confirmed against those commits and tags.
Until this file existed the sequence lived only in habit, which is how v4.1.1
happened.

juicebox.js is an **embeddable component**. A release is not done when the tag is
pushed — it is done when both consumers are pinned to it. Steps 1–5 are this repo;
step 6 is the other two.

## 1. Bump the version — three files

```
npm version <version> --no-git-tag-version
```

That writes `package.json` and `package-lock.json`. `js/version.js` is a
hand-edited two-liner and `npm version` does not touch it:

```js
const version = "4.2.0"
export {version}
```

The vite build also rewrites `js/version.js`, so a stale edit here can be masked
by a local build. Edit it by hand and check it into the bump commit — every bump
commit in the history is exactly these three files and nothing else.

`--no-git-tag-version` matters: the tag is pushed by hand in step 4, after the
bump has landed on master through a PR.

## 2. Verify — build, tests, and the consumer measurement

```
npm run build
npm run test:run
npm run measure-consumers
```

`npm run test:run` is the one-shot run. Bare `npm test` is vitest in **watch
mode** and will sit there looking like a hang.

`npm run measure-consumers` exists for this moment and no other. It greps the two
host checkouts for the surface declared in `js/publicApi.js` and reports what a
host uses that this repo has not declared — the `MapLoad` failure mode, where
juicebox-web stayed subscribed to an event this repo stopped posting in v3.1.0
and nothing broke loudly for eight months. It reports **candidates, not
verdicts**: every hit is a call site to open by hand, and its exit code is a
prompt to look, not a failure. It needs both sibling checkouts present (see step
6 for where they are).

Fold the result into `docs/adr/0003-public-api-contract.md` as a **new dated
re-measurement section** — see `## Re-measurement — 2026-08-24, for the v4.0.0
release` for the shape. That ADR is append-only: the tables above are the
measurement as it stood, they are history, and they are not revised.

If the release changes `exports`, do step 3's `npm pack` check now rather than
after tagging. See the third trap.

## 3. Commit and land it as a PR

Commit message is `Bump version to <version>`, with a body that **argues the
semver choice**. Not a changelog — a reason. The v4.2.0 body is the model: why
minor and not patch (a user-visible surface that did not exist before), why minor
and not major (`js/publicApi.js` is byte-identical to the previous release), and
what the one host-visible removal is and why it is not a behaviour change.

`js/publicApi.js` is the instrument for the major-version question. If it is
unchanged, the release is not major.

Land it as a **PR off a branch**. Never a direct commit on master.

## 4. Tag

After the bump PR is merged, from an up-to-date master:

```
git tag v<version>          # lightweight — no -a, no -m
git push origin master
git push origin v<version>
```

Every tag in this repo is lightweight. Match them. Commit first, then the tag —
a tag pushed ahead of its commit points at nothing on the remote.

## 5. Create the release

```
gh release create v<version> --title "v<version> — <name>" --notes-file <file>
```

**A tag alone is not a release.** The tag is plumbing; the release is the thing a
consumer reads.

House style, from the existing releases:

- **Title**: `v<version> — <Short Name>`. The name says what the release is
  *about*, not what changed: *The Substitution Speaks*, *The corpus actually
  ships*, *The Architecture Review Release*.
- **Body**: opens with one sentence naming the single theme, then `### ` sections
  — the theme, then `### Fixes`, `### Removed`, `### Docs` as they apply.
- Each bullet **leads with a bolded claim** and then explains it. Issue numbers
  as `(#372)`. Link ADRs at the tag, not at master:
  `https://github.com/aidenlab/juicebox.js/blob/v<version>/docs/adr/....`

## 6. Repoint both consumers

Two repos, each its own PR off a feature branch. Both pin
`"juicebox.js": "github:aidenlab/juicebox.js#v<version>"`.

| Repo | Path | Branch | Section | Source dir | `package-lock.json` |
|---|---|---|---|---|---|
| juicebox-web | `../juicebox-web` | `master` | `devDependencies` | `js/` | **tracked — commit it** |
| spacewalk | `../../SpacewalkDevelopment/spacewalk` | `main` | `dependencies` | `src/` | gitignored |

Spacewalk is **not** a sibling of this repo — it lives under
`SpacewalkDevelopment/`, and its source is `src/`, not `js/`.

**Check what juicebox-web actually pins before assuming a version step.** It has
drifted to `#master` before and is on `#master` as this is written, which makes
the bump a re-pin rather than a version bump.

**The two repos treat `package-lock.json` differently**, so the two bump PRs are
not the same shape. Spacewalk gitignores it and its PR is a one-line
`package.json` change. **juicebox-web tracks it** — the lockfile carries the
resolved tag and commit, and leaving it out of the PR means merging a
`package.json` that disagrees with the lockfile beside it. Stage both there.

Check rather than remember: `git ls-files --error-unmatch package-lock.json`.

**Check the consumer's working tree before branching.** These are working repos
and a bump lands in the middle of whatever was already in progress there —
juicebox-web had an unrelated dependency edit uncommitted when v4.3.0 was cut.
`git stash push -- package.json package-lock.json`, branch, bump, then pop it
back on the base branch. A `git add -A` in a consumer sweeps someone else's work
into a release PR.

## The traps

Each of these has cost a real mistake.

### `npm pkg set` splits on the dot

```
npm pkg set 'dependencies.juicebox.js=github:...'   # WRONG
```

It reads the dot in `juicebox.js` as a path separator and writes a nested
`{"juicebox": {"js": ...}}` key. There is no quoting that prevents this. **Edit
`package.json` directly.**

### A plain `npm install` reuses the cached git resolution

After changing the tag, `npm install` can leave the lockfile showing the new tag
while `node_modules` still holds the **old commit**. Force the resolution and
then confirm it:

```
npm install juicebox.js@github:aidenlab/juicebox.js#v<version>
node -e "console.log(require('./node_modules/juicebox.js/package.json').version)"
```

Confirm before trusting any build check in the consumer. Anyone pulling the two
bump PRs hits this too, so say so in the PR body.

### `files` governs a `github:` install exactly as it governs an npm one

npm **packs** a git dependency; it does not clone it whole. Anything a consumer
imports must be listed in `files` in `package.json`, or it resolves to `Cannot
find module` — with a green build here, because nothing in this repo exercises
the packed tree.

This cost **v4.1.1**: the wire-format corpus was added to `exports` in v4.1.0 and
not to `files`, so the export pointed at a file that never shipped. Adding a path
to `exports` means adding it to `files` in the same breath.

Verify *before* tagging:

```
npm pack --dry-run | grep <path>
```

### `gh pr list` is scoped to the repo you are standing in

After opening the two consumer bump PRs, running `gh pr list` from this checkout
shows nothing, which reads as *no open PRs*. Pass the repo:

```
gh pr list --repo aidenlab/juicebox-web
gh pr list --repo aidenlab/spacewalk
```

And always say which repo a PR number belongs to. The three repos share no
number space.

## Known divergence

Spacewalk pins `igv` as `github:igvteam/igv.js#v3.8.0` while juicebox.js pins npm
`igv` at exactly `3.8.9` — two distinct installs of igv in one application.
Predates v3.6.1, flagged in spacewalk PR #81, unresolved. Not a release blocker;
noted here so a release does not rediscover it as a surprise.
