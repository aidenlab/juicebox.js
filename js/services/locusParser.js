/*
 * LocusParser - Handles locus string parsing and gene lookup
 * Extracted from HICBrowser for better separation of concerns
 */

import { geneSearch } from '../geneSearch.js';
import { Globals } from '../globals.js';

class LocusParser {
    /**
     * Parse a locus string into a locus object
     * @param {string} locus - The locus string to parse
     * @param {Object} genome - The genome object
     * @returns {Object|undefined} Parsed locus object or undefined if invalid
     */
    static parseLocusString(locus, genome) {
        const [chrName, range] = locus.trim().toLowerCase().split(':');
        const chromosome = genome.getChromosome(chrName);

        if (!chromosome) {
            return undefined;
        }

        const locusObject = {
            chr: chromosome.name,
            wholeChr: (undefined === range && 'All' !== chromosome.name)
        };

        if (true === locusObject.wholeChr || 'All' === chromosome.name) {
            // Chromosome name only or All: Set to whole range
            locusObject.start = 0;
            locusObject.end = chromosome.size;
        } else {
            const [startStr, endStr] = range.split('-').map(part => part.replace(/,/g, ''));

            // Internally, loci are 0-based.
            locusObject.start = isNaN(startStr) ? undefined : parseInt(startStr, 10) - 1;
            locusObject.end = isNaN(endStr) ? undefined : parseInt(endStr, 10);
        }

        return locusObject;
    }

    /**
     * Look up a feature or gene by name
     * @param {string} name - The name to look up
     * @param {Object} genome - The genome object
     * @param {Object} state - The browser state (for setting selectedGene)
     * @returns {Object|undefined} Parsed locus object or undefined if not found
     */
    static async lookupFeatureOrGene(name, genome, state) {
        const trimmedName = name.trim();
        const upperName = trimmedName.toUpperCase();

        if (genome.featureDB.has(upperName)) {
            Globals.selectedGene = trimmedName;
            state.selectedGene = Globals.selectedGene;
            const { chr, start, end } = genome.featureDB.get(upperName);

            // Internally, loci are 0-based. parseLocusString() assumes user-provided locus which is 1-based
            return this.parseLocusString(`${chr}:${start + 1}-${end}`, genome);
        }

        const geneResult = await geneSearch(genome.id, trimmedName);
        if (geneResult) {
            Globals.selectedGene = trimmedName;
            state.selectedGene = Globals.selectedGene;
            return this.parseLocusString(geneResult, genome);
        }

        return undefined;  // No match found
    }
}

export default LocusParser;
