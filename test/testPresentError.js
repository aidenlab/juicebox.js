/**
 * presentError maps HTTP status codes to friendly alert text. The lookup used to be keyed on
 * error.message, so it never fired. See issue #442.
 */
import { describe, test, expect, beforeEach } from 'vitest';

import { presentError } from "../js/utils.js";

const presented = [];

/** The one thing presentError asks of a registry. */
const registry = { presentAlert: (message) => presented.push(message) };

function alertFor(message, code, headers) {
    const error = Error(message);
    if (code !== undefined) {
        error.code = code;
    }
    if (headers !== undefined) {
        error.headers = headers;
    }
    presentError(registry, "Error loading map", error);
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

    // Bot challenge — see issue #441 and docs/adr/0001-dev-proxy-for-waf-protected-hosts.md.
    describe("bot challenge", function () {

        test("reports the cause rather than the misleading status", function () {
            const headers = new Headers({ 'x-amzn-waf-action': 'captcha' });
            const alert = alertFor("405 Method Not Allowed — https://www.encodeproject.org/x.hic", 405, headers);

            expect(alert).not.toContain("405");
            expect(alert).toContain("bot protection");
            expect(alert).toContain("allowlist");
            expect(alert).toContain("https://github.com/aidenlab/juicebox.js/issues/441");
        });

        test("matches the header case-insensitively", function () {
            const headers = new Headers({ 'X-Amzn-Waf-Action': 'captcha' });

            expect(alertFor("Method Not Allowed", 405, headers)).toContain("bot protection");
        });

        test("leaves an ordinary 403 with headers alone", function () {
            const headers = new Headers({ 'content-type': 'text/html' });

            expect(alertFor("Forbidden", 403, headers)).toBe("Error loading map: Access forbidden");
        });

        test("leaves a non-captcha waf action alone", function () {
            const headers = new Headers({ 'x-amzn-waf-action': 'challenge' });

            expect(alertFor("Method Not Allowed", 405, headers)).toBe("Error loading map: Method Not Allowed");
        });

        test("is safe when the error carries no headers", function () {
            expect(alertFor("Failed to fetch")).toBe("Error loading map: Failed to fetch");
        });

        test("is safe when headers is not a Headers instance", function () {
            const alert = alertFor("Failed to fetch", undefined, { 'x-amzn-waf-action': 'captcha' });

            expect(alert).toBe("Error loading map: Failed to fetch");
        });

    });

});
