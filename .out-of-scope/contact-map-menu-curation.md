# Contact Map Menu Curation

juicebox.js does not own the contact-map selection menu, and will not grow a
searchable, metadata-driven catalog of `.hic` files.

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

## Prior requests

- #226 — "Use JSON file to load menu" (attached `hicfiles.json.txt`, requesting
  ENCODE-table-style search over journal and cell type)
