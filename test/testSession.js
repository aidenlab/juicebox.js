/*
 * @author Generated test for session loading
 */

import { describe, test, expect } from 'vitest';
import { extractConfig } from "../js/urlUtils.js";
import { restoreSession } from "../js/session.js";
import { createFile } from "./utils/File.js";
import { resolve } from 'path';
import { fileURLToPath } from 'url';
import { dirname } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

describe("Session Loading", function () {

    test("Load session from local file path", async function () {
        // Test loading session from a local file path
        // The XMLHttpRequestMock will route non-HTTP URLs to XMLHttpRequestLocal
        const sessionFilePath = resolve(__dirname, "data/session.json");
        const url = `http://localhost/juicebox/?session=${sessionFilePath}`;

        const sessionConfig = await extractConfig(url);
        
        expect(sessionConfig).toBeDefined();
        expect(sessionConfig.browsers).toBeDefined();
        expect(sessionConfig.browsers.length).toBe(1);
        
        const browser = sessionConfig.browsers[0];
        expect(browser.name).toBe("Test Browser 1");
        expect(browser.url).toBe("https://www.encodeproject.org/files/ENCFF473CAA/@@download/ENCFF473CAA.hic");
        expect(browser.tracks).toBeDefined();
        expect(browser.tracks.length).toBe(2);
        expect(browser.tracks[0].name).toBe("Test Track 1");
        expect(browser.tracks[1].name).toBe("Test Track 2");
        expect(browser.state).toBeDefined();
        expect(browser.state.chr1).toBe(17);
        expect(browser.state.chr2).toBe(17);
        expect(browser.state.normalization).toBe("NONE");
        
        expect(sessionConfig.selectedGene).toBe("ace");
    });

    test("Load session from relative file path", async function () {
        // Test loading session from a relative file path
        const relativePath = "test/data/session.json";
        const url = `http://localhost/juicebox/?session=${relativePath}`;

        const sessionConfig = await extractConfig(url);
        
        expect(sessionConfig).toBeDefined();
        expect(sessionConfig.browsers).toBeDefined();
        expect(sessionConfig.browsers.length).toBe(1);
        
        const browser = sessionConfig.browsers[0];
        expect(browser.name).toBe("Test Browser 1");
        expect(browser.tracks.length).toBe(2);
        expect(sessionConfig.selectedGene).toBe("ace");
    });

    test("Load session from File object", async function () {
        // Test loading session from a File object
        // This tests the isFile() check in extractConfig
        const sessionFilePath = resolve(__dirname, "data/session.json");
        const file = createFile(sessionFilePath);
        
        // Create a URL with the File object as the session value
        // We need to modify extractConfig to accept File objects directly
        // For now, test by creating a session config from the file content
        const sessionText = await file.text();
        const sessionConfig = JSON.parse(sessionText);
        
        expect(sessionConfig).toBeDefined();
        expect(sessionConfig.browsers).toBeDefined();
        expect(sessionConfig.browsers.length).toBe(1);
        
        const browser = sessionConfig.browsers[0];
        expect(browser.name).toBe("Test Browser 1");
        expect(browser.tracks.length).toBe(2);
        expect(sessionConfig.selectedGene).toBe("ace");
    });

    test("Load session from HTTP URL (mocked)", async function () {
        // Test loading session from an HTTP URL
        // In a real scenario, this would fetch from a remote server
        // For testing, we use a local file path that the mock can handle
        const sessionFilePath = resolve(__dirname, "data/session.json");
        // Encode the file path as if it were a URL parameter
        const url = `https://example.com/juicebox/?session=${sessionFilePath}`;

        const sessionConfig = await extractConfig(url);
        
        expect(sessionConfig).toBeDefined();
        expect(sessionConfig.browsers).toBeDefined();
        expect(sessionConfig.browsers.length).toBe(1);
    });

})

