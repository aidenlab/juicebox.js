import "./utils/mockObjects.js"
import { describe, it, expect } from 'vitest'

import Track2D from '../js/track2D.js'

describe("testTrack2D", () => {

    it("2D track", async () => {

        const url = "test/data/breakFinder/breaks.txt"
        const track2D = await Track2D.loadTrack2D({url: url})
        expect(track2D.featureCount).toBe(56)

    })
})
