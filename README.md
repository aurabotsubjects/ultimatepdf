# UltimatePDF

A free, private PDF toolkit that runs **entirely in your browser** – no server, no uploads, no accounts.
Host it for free on GitHub Pages.

## Tools

| Group | Tool |
|---|---|
| Edit | **Edit & fill PDF** – fill editable form fields, add text, edit existing text, images, ticks/crosses, draw, highlight, boxes, ovals, lines, arrows, cover-up (whiteout) and permanent **redaction** |
| Edit | **Sign PDF** – draw, type or upload a signature/initials (saved on your device for next time), drop a date stamp |
| Organise | **Merge** PDFs and images (pick page ranges per file) · **Split** (ranges / every N pages / each page) · **Extract or delete** pages visually · **Organise & rotate** (drag to reorder, rotate, duplicate, insert blank pages, append another PDF) |
| Convert | **Word → PDF** (.docx, .txt, .html) · **Images → PDF** · **PDF → images** (PNG/JPG/WebP) · **PDF → text** |
| Optimise | **Compress PDF** (light / recommended / strong / maximum) · **Compress images** (quality, resize, target file size) |
| Stamp & secure | **Watermark** (text or image) · **Page numbers, headers & footers** · **Metadata & flatten** (edit properties, flatten forms, strip annotations/metadata) |

## Put it on GitHub Pages

1. Create a new GitHub repository (e.g. `ultimatepdf`).
2. Upload **the contents of this folder** (everything including `index.html`, `css/`, `js/`, `lib/`, and the hidden `.nojekyll` file) to the repository root.
   - Easiest on the web: *Add file → Upload files*, drag the contents in, commit.
   - Note: GitHub's web upload accepts up to 100 files per drag; the `lib/pdfjs/cmaps` folder has ~170 small files, so upload it in two batches or use GitHub Desktop / `git push`.
3. In the repo go to **Settings → Pages**, set *Source* to **Deploy from a branch**, choose `main` and `/ (root)`, and Save.
4. After a minute your app is live at `https://<your-username>.github.io/<repo-name>/`.

The same folder also works on Netlify (drag the folder onto app.netlify.com/drop).

## Run it locally

Browsers block some features when opening `index.html` straight from disk, so use a tiny local server:

```bash
cd ultimatepdf
python3 -m http.server 8000      # then open http://localhost:8000
```

## Notes & limits

* All third-party libraries are bundled in `lib/` (pdf-lib, pdf.js, mammoth, JSZip, html2canvas) – the app works offline once loaded.
* **Word → PDF** keeps headings, bold/italic, lists, tables, links and pictures. Text boxes, columns and headers/footers are simplified. Documents with non-Latin text (e.g. Korean) are rendered as page images so every character shows correctly (not selectable).
* **Cover** hides content visually only. Use **Redact** to remove it for real – redacted pages are flattened to images on download.
* Encrypted PDFs that need a password prompt for it when opened; adding password protection is not supported.
* OCR (making scans searchable) is not included.
