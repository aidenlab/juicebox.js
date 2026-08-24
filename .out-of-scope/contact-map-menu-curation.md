# Data Selection UI Curation

juicebox.js does not own the UI by which a user *chooses* data — neither the
contact-map selection menu nor the ENCODE track pane — and will not grow
searchable, metadata-driven catalogs for either.

_(File kept under its original name so links posted on closed issues still
resolve; the concept it records is the broader one.)_

## Why this is out of scope

juicebox.js is an embeddable component, not an application. The list of maps a
user can choose from is a property of the *host* — Juicebox-web presents a
curated public catalog, Spacewalk presents whatever the current model implies,
and a third embedder may present none at all. There is no menu machinery in
`js/` to extend, and adding one would push product curation into a library.

The component's contract is the other direction: the host hands it a map to
load, through the documented config and session paths. Anything richer — search
by journal, filter by cell type, faceted browse in the manner of the ENCODE
table — is a catalog UI, and belongs to whoever owns the catalog.

The specific artifact attached to the original request (`hicfiles.json`, a flat
list of S3 URLs with per-file metadata) is also a snapshot of one lab's holdings
at one moment, not a format this component should learn to read.

## The same applies to the ENCODE pane

A later request asked for richer detail in the ENCODE track pane — searching by
ENCODE file accession so that, for example, a replicate-combination file can be
told apart from its siblings.

That pane is not juicebox.js's either. There is no ENCODE selector anywhere in
`js/`, and no `igv-widgets` dependency to supply one; the only ENCODE strings in
this repo are entries in the `nvi.js` lookup table, which is a normalization
index, not a catalog. The host app owns the pane, so the search fields it offers
are the host's decision — and how much metadata is available to offer is
ENCODE's.

## Prior requests

- #226 — "Use JSON file to load menu" (attached `hicfiles.json.txt`, requesting
  ENCODE-table-style search over journal and cell type)
- #285 — "More detail in ENCODE pane" (requesting search by ENCODE file
  accession, to distinguish a replicate combination from its siblings)
