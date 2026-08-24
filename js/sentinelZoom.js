/**
 * The zoom index of a resolution rung juicebox synthesises rather than reads out
 * of the `.hic` file.
 *
 * Reserved so it can never collide with an index into `bpResolutions`, and never
 * serialized -- `State.toJSON` writes the whole-genome view in its place. It has
 * a module of its own, importing nothing, because `imageTileCore.js` needs it
 * and is deliberately free of dataset and browser dependencies.
 *
 * See CONTEXT.md "Sentinel zoom" and ADR-0010.
 */
const SENTINEL_ZOOM = -1

export {SENTINEL_ZOOM}
