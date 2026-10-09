/**
 * A y-axis track draws the horizontal tile igv renders for it, turned to run down the map's left
 * edge. The turn has to be a rotation: a transpose lays the tile along the axis too, but it is a
 * reflection, and every label on the track came out mirrored.
 *
 * Only the transform handed to the canvas is asserted. Node draws nothing (ADR-0013), so the
 * context is a recorder and the geometry is checked on the matrix.
 */
import { describe, test, expect } from 'vitest';
import TrackRenderer from '../js/trackRenderer.js';

// A 400 bp tile at 1 bp per pixel, 20 px deep; the y-axis canvas is that tile stood on end.
const tile = { startBP: 0, buffer: { width: 400, height: 20 } };
const genomicState = { startBP: 0, bpp: 1 };

function transformFor(axis) {
    let matrix = [1, 0, 0, 1, 0, 0];
    const ctx = {
        setTransform: (...args) => { matrix = args },
        clearRect() {},
        drawImage() {}
    };
    const canvasElement = 'x' === axis ? { width: 400, height: 20 } : { width: 20, height: 400 };
    TrackRenderer.prototype.drawTile.call({ axis, ctx, canvasElement }, tile, genomicState);
    return matrix;
}

// Where tile pixel (x, y) lands on the canvas under setTransform(a, b, c, d, e, f).
function apply([a, b, c, d, e, f], [x, y]) {
    return [a * x + c * y + e, b * x + d * y + f];
}

describe('a y-axis track tile', () => {

    test('is rotated, not reflected, so its labels read the right way round', () => {
        const [a, b, c, d] = transformFor('y');
        expect(a * d - b * c).toBe(1);
    });

    test('runs the genome down the axis', () => {
        const m = transformFor('y');
        const [, top] = apply(m, [0, 0]);
        const [, bottom] = apply(m, [tile.buffer.width, 0]);
        expect(bottom - top).toBe(tile.buffer.width);
    });

    test('lands inside the canvas', () => {
        const m = transformFor('y');
        const corners = [[0, 0], [400, 0], [0, 20], [400, 20]].map(corner => apply(m, corner));
        for (const [x, y] of corners) {
            expect(x).toBeGreaterThanOrEqual(0);
            expect(x).toBeLessThanOrEqual(20);
            expect(y).toBeGreaterThanOrEqual(0);
            expect(y).toBeLessThanOrEqual(400);
        }
    });

    test('an x-axis tile is left untransformed', () => {
        expect(transformFor('x')).toEqual([1, 0, 0, 1, 0, 0]);
    });
});
