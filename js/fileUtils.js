
/**
 * Test if object is a File or File-like object.
 *
 * Copied from igv-utils.FileUtils version 1.3.8
 *
 * @param object
 */
function isFile(object) {
    if(!object) {
        return false;
    }
    return typeof object !== 'function' &&
        (object instanceof File ||
            (object.name !== undefined &&  typeof object.slice === 'function' && typeof object.arrayBuffer === 'function'))
}

export {isFile}
