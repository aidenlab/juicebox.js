import { describe, test, expect } from 'vitest';
import Track2D from '../js/track2D.js'

describe("testTrack2D", function () {

    test("2D track", async function () {

        const url = "test/data/breakFinder/breaks.txt"
        const track2D = await Track2D.loadTrack2D({url: url})
        expect(track2D.featureCount).toBe(56)

    })
})
