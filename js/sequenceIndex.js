/**
 * The index a sequence track is assumed to have when its config names none.
 * #587.
 *
 * igv reads a FASTA with no index by fetching the whole file, and it does that
 * at paint time, once the view is at `bpPerPixel <= 10`. For a genome-sized
 * file (`hg38.fa`, ~3 GB) the read never finishes, and because an update waits
 * on every track's paint, the contact map stops repainting with it. Every
 * session saved before #584 carries such a track, since `toJSON` dropped the
 * `indexURL` its host supplied.
 *
 * So juicebox assumes the conventional sibling `<url>.fai` (samtools faidx),
 * and says so on the console, as igv does when it guesses a BAM index. A wrong
 * guess costs a blank sequence row and a console error, never the map. A
 * session saved afterwards writes the guessed `indexURL`, which is the same as
 * guessing again on the next load.
 *
 * Not guessed where there is no sibling to guess: a `data:` URL or a local
 * `File`. Nor where the config says `indexed: false`, which is the host asking
 * for the whole-file read on purpose.
 *
 * @param {Object} config - a sequence track config; given an `indexURL` in place.
 * @returns {Object} the same config.
 */
function inferSequenceIndex(config) {

    const url = config.url

    if (config.indexURL || false === config.indexed || typeof url !== 'string' || url.startsWith('data:')) {
        return config
    }

    // Before any query string, as igv's own `inferIndexPath` does, so a signed
    // URL's signature still applies to the index.
    const query = url.indexOf('?')
    config.indexURL = query < 0 ? `${url}.fai` : `${url.slice(0, query)}.fai${url.slice(query)}`

    console.warn(`Sequence track ${url} has no indexURL; assuming ${config.indexURL}`)

    return config
}

export {inferSequenceIndex}
