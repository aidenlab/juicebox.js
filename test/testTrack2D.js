import "./utils/mockObjects.js"
import {assert} from 'chai'

import Track2D from '../js/track2D.js'

suite("testTrack2D", function () {

    test("2D track", async function () {

        const url = "test/data/breakFinder/breaks.txt"
        const track2D = await Track2D.loadTrack2D({url: url})
        assert.equal(track2D.featureCount, 56)

    })
})
