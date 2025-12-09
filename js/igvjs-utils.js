/**
 * Utility functions for working with IGV.js file formats.
 * These functions are based on IGV.js logic but implemented locally
 * to avoid direct dependencies on IGV source code.
 */

/**
 * Infer file format from filename.
 * Based on IGV's inferFileFormatFromName logic, but implemented locally.
 * 
 * @param {string} filename - The filename to infer format from
 * @returns {string|undefined} - The inferred format, or undefined if unknown
 */
function inferFileFormatFromName(filename) {
    if (!filename) {
        return undefined;
    }

    let fn = filename.toLowerCase();

    // Special case -- UCSC refgene files
    if (fn.endsWith("refgene.txt.gz") ||
        fn.endsWith("refgene.txt.bgz") ||
        fn.endsWith("refgene.txt") ||
        fn.endsWith("refgene.sorted.txt.gz") ||
        fn.endsWith("refgene.sorted.txt.bgz")) {
        return "refgene";
    }

    // Strip gzip extension
    if (fn.endsWith(".gz")) {
        fn = fn.substring(0, fn.length - 3);
    }
    if (fn.endsWith(".bgz")) {
        fn = fn.substring(0, fn.length - 4);
    }

    // Strip aux extensions .tsv, .tab, and .txt
    if (fn.endsWith(".txt") || fn.endsWith(".tab") || fn.endsWith(".tsv")) {
        fn = fn.substring(0, fn.length - 4);
    }

    const idx = fn.lastIndexOf(".");
    const ext = idx < 0 ? fn : fn.substring(idx + 1);

    // Known file extensions (based on IGV's knownFileExtensions set)
    const knownExtensions = new Set([
        "narrowpeak", "broadpeak", "regionpeak", "peaks", "bedgraph", "wig",
        "gff3", "gff", "gtf", "fusionjuncspan", "refflat", "seg", "aed",
        "bed", "bedMethyl", "vcf", "bb", "bigbed", "biginteract",
        "biggenepred", "bignarrowpeak", "bw", "bigwig", "bam", "tdf",
        "refgene", "genepred", "genepredext", "bedpe", "bp", "snp", "rmsk",
        "cram", "gwas", "maf", "mut", "hiccups", "fasta", "fa", "fna",
        "pytor", "hic", "qtl"
    ]);

    switch (ext) {
        case "bw":
            return "bigwig";
        case "bb":
            return "bigbed";
        case "fasta":
        case "fa":
        case "fna":
            return "fasta";
        default:
            if (knownExtensions.has(ext)) {
                return ext;
            } else {
                return undefined;
            }
    }
}

export {inferFileFormatFromName};

