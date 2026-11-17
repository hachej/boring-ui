# Scanned fictional invoices

`scan-1.pdf` to `scan-3.pdf` are the first three fictional invoices of `../extraction/invoices.mjs` (Atelier Imaginaire, Garage Martin, Boulangerie Exemple), each rendered once by `pdf()` of `../extraction/documents.mjs` and then made image-only (no text layer, so `read_pdf` sees a scan):

```sh
convert -density 150 <invoice>.pdf -quality 80 -compress jpeg scan-<n>.pdf
```

They are read by `scripts/cap-real/extraction-openai.mjs` (the owner's real check); the offline tests build their own PDFs.
