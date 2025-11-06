import { describe, test, expect } from 'vitest';
import HICMath from "../js/hicMath.js"

describe("math", function () {

    test("Percentile", function () {

        // Find 95th percentile of a list
        const p = 95
        const elements = []

        for (let i = 0; i < 1000000; i++) {
            elements[i] = Math.random() * 1000000;
        }

        const p0 = HICMath.percentile(elements, p);

        const idx = Math.floor((p / 100) * elements.length);
        elements.sort(function (a, b) {
            return a - b
        });
        const p1 = elements[idx];

        expect(p0).toBe(p1);

    })

    test("Percentile small array", function () {

        // Find 95th percentile of a list
        const p = 95
        const elements = []

        for (let i = 0; i < 2; i++) {
            elements[i] = Math.random() * 1000;
        }

        const p0 = HICMath.percentile(elements, p);

        const idx = Math.floor((p / 100) * elements.length);
        elements.sort(function (a, b) {
            return a - b
        });
        const p1 = elements[idx];

        expect(p0).toBe(p1);

    })
})

