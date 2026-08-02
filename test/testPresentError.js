/**
 * presentError maps HTTP status codes to friendly alert text. The lookup used to be keyed on
 * error.message, so it never fired. See issue #442.
 */
import { describe, test, expect, vi, beforeEach } from 'vitest';

const presented = [];

vi.mock('igv-ui', () => ({
    Alert: {
        presentAlert: (message) => presented.push(message)
    }
}));

const { presentError } = await import("../js/utils.js");

function alertFor(message, code) {
    const error = Error(message);
    if (code !== undefined) {
        error.code = code;
    }
    presentError("Error loading map", error);
    return presented.at(-1);
}

describe("presentError", function () {

    beforeEach(() => {
        presented.length = 0;
    });

    test("maps a numeric http status code to a friendly message", function () {
        expect(alertFor("Forbidden", 403)).toBe("Error loading map: Access forbidden");
    });

    test("maps a string http status code to a friendly message", function () {
        expect(alertFor("Not Found", "404")).toBe("Error loading map: Not found");
    });

    test("maps 401 to a friendly message", function () {
        expect(alertFor("Unauthorized", 401)).toBe("Error loading map: Access unauthorized");
    });

    test("falls back to the error message when there is no code", function () {
        expect(alertFor("Something went sideways")).toBe("Error loading map: Something went sideways");
    });

    test("falls back to the error message for an unmapped code", function () {
        const message = "500 Internal Server Error — https://example.org/x.hic";
        expect(alertFor(message, 500)).toBe(`Error loading map: ${message}`);
    });

    test("does not treat inherited Object properties as status codes", function () {
        expect(alertFor("Bad Request", "toString")).toBe("Error loading map: Bad Request");
    });

});
