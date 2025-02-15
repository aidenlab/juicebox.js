function createDOMFromHTMLString(string) {
    const template = document.createElement('template');
    template.innerHTML = string.trim(); // Removes whitespace to avoid unintended text nodes
    return template.content.firstElementChild;
}

function getOffset(element) {
    const { top, left } = element.getBoundingClientRect();
    return { top: top + window.scrollY, left: left + window.scrollX };
}

function parseRgbString(rgbString) {

    // Use a regular expression to extract the numbers from the string
    const match = rgbString.match(/^rgb\((\d+),\s*(\d+),\s*(\d+)\)$/);

    // Check if the match is successful
    if (!match) {
        throw new Error("Invalid RGB string format");
    }

    // Convert the matched strings into integers and return them as an array
    return match.slice(1, 4).map(Number);
}

export { createDOMFromHTMLString, getOffset, parseRgbString }
