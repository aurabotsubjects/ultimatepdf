/* Convert: images->PDF, PDF->images, Word->PDF, PDF->text */
(function () {
  const h = U.h, L = PDFLib;
  const sel = (opts, val) => h('select', null, opts.map(([v, t]) => h('option', { value: v, selected: v === val }, t)));

  // ---------------- IMAGES -> PDF ----------------
  U.register({
    id: 'img2pdf', group: 'Convert', icon: '🖼', title: 'Images to PDF', desc: 'JPG, PNG, WebP… into one PDF',
    render(root) {
      const items = [], out = h('div');
      const list = U.sortList({ items, onChange: upd });
      const size = sel([['fit', 'Same as image'], ['a4', 'A4'], ['letter', 'US Letter'], ['a5', 'A5'], ['legal', 'US Legal']], 'a4');
      const orient = sel([['auto', 'Auto'], ['p', 'Portrait'], ['l', 'Landscape']], 'auto');
      const margin = sel([['0', 'None'], ['18', 'Small'], ['36', 'Medium'], ['54', 'Large']], '18');
      const qual = sel([['orig', 'Original (no recompression)'], ['0.9', 'High (JPEG 90%)'], ['0.75', 'Medium (JPEG 75%)'], ['0.55', 'Small (JPEG 55%, max 1600px)']], 'orig');
      const btn = h('button', { class: 'btn pri', disabled: true, onclick: go }, '🖼 Create PDF');
      function upd() { btn.disabled = !items.length; }
      async function add(files) {
        for (const f of files) items.push({ name: f.name, file: f, meta: U.fmtBytes(f.size), thumb: h('img', { src: URL.createObjectURL(f) }) });
        list.render(); upd();
      }
      async function go() {
        U.run('Creating PDF…', async () => {
          const doc = await L.PDFDocument.create();
          const q = qual.value === 'orig' ? null : +qual.value;
          const m = +margin.value;
          for (let i = 0; i < items.length; i++) {
            await U.progress(i / items.length, 'Image ' + (i + 1) + ' of ' + items.length);
            const img = await U.pdf.embedImage(doc, items[i].file, { quality: q, maxDim: q != null && q < 0.6 ? 1600 : q != null ? 3000 : 0 });
            let pw, ph;
            if (size.value === 'fit') { pw = img.width + 2 * m; ph = img.height + 2 * m; }
            else {
              [pw, ph] = U.pdf.pageSizes[size.value];
              const land = orient.value === 'l' || (orient.value === 'auto' && img.width > img.height);
              if (land) [pw, ph] = [ph, pw];
            }
            const s = Math.min((pw - 2 * m) / img.width, (ph - 2 * m) / img.height, size.value === 'fit' ? 1 : Infinity);
            const w = img.width * s, hh = img.height * s;
            doc.addPage([pw, ph]).drawImage(img, { x: (pw - w) / 2, y: (ph - hh) / 2, width: w, height: hh });
          }
          U.pdf.finish(doc);
          U.showResults(out, [{ name: items.length === 1 ? U.baseName(items[0].name) + '.pdf' : 'images.pdf', bytes: await U.pdf.save(doc), mime: 'application/pdf' }], { title: 'Created a ' + items.length + '-page PDF' });
        });
      }
      root.append(h('h1', null, 'Images to PDF'), h('p', { class: 'sub' }, 'JPG, PNG, WebP, GIF, BMP… Photos are auto-rotated using their EXIF data.'),
        h('div', { class: 'card' }, U.dropzone({ accept: 'image/*', multiple: true, onFiles: add, icon: '🖼', title: 'Drop images here or click to choose' }), h('div', { style: { height: '12px' } }), list),
        h('div', { class: 'card' }, h('div', { class: 'row' },
          h('label', { class: 'f' }, 'Page size', size), h('label', { class: 'f' }, 'Orientation', orient), h('label', { class: 'f' }, 'Margin', margin), h('label', { class: 'f' }, 'Image quality', qual)),
          h('div', { style: { marginTop: '14px' } }, btn)), out);
    },
  });

  // ---------------- PDF -> IMAGES ----------------
  U.register({
    id: 'pdf2img', group: 'Convert', icon: '📸', title: 'PDF to images', desc: 'Export pages as PNG, JPG or WebP',
    render(root) {
      let cur = null; const out = h('div'), opts = h('div');
      const fmt = sel([['png', 'PNG (sharp, lossless)'], ['jpeg', 'JPG (smaller)'], ['webp', 'WebP (smallest)']], 'png');
      const dpi = sel([['72', '72 dpi (screen)'], ['110', '110 dpi'], ['150', '150 dpi (good)'], ['220', '220 dpi'], ['300', '300 dpi (print)']], '150');
      const q = h('input', { type: 'range', min: 40, max: 100, value: 90 });
      const range = h('input', { type: 'text', placeholder: 'all', style: { width: '150px' } });
      const input = U.singlePdf({ onLoad: (f) => { cur = f; opts.hidden = false; }, onClear: () => { opts.hidden = true; } });
      async function go() {
        U.run('Rendering pages…', async () => {
          const idx = U.parseRanges(range.value, cur.numPages), files = [], type = 'image/' + fmt.value, ext = fmt.value === 'jpeg' ? 'jpg' : fmt.value;
          for (let k = 0; k < idx.length; k++) {
            await U.progress(k / idx.length, 'Page ' + (idx[k] + 1));
            const cv = await U.renderPage(cur.pdf, idx[k] + 1, +dpi.value / 72);
            files.push({ name: U.baseName(cur.name) + '_page' + String(idx[k] + 1).padStart(String(cur.numPages).length, '0') + '.' + ext, bytes: await U.canvasBytes(cv, type, +q.value / 100), mime: type });
            cv.width = cv.height = 0;
          }
          U.showResults(out, files, { title: 'Exported ' + files.length + ' image(s)', zipName: U.baseName(cur.name) + '_images', noEditor: true });
        });
      }
      opts.hidden = true;
      opts.append(h('div', { class: 'card' }, h('div', { class: 'row' }, h('label', { class: 'f' }, 'Format', fmt), h('label', { class: 'f' }, 'Resolution', dpi),
        h('label', { class: 'f' }, 'Quality (JPG/WebP)', q), h('label', { class: 'f' }, 'Pages (blank = all)', range)),
        h('div', { style: { marginTop: '14px' } }, h('button', { class: 'btn pri', onclick: go }, '📸 Convert'))));
      root.append(h('h1', null, 'PDF to images'), h('p', { class: 'sub' }, 'Turn every page (or just some) into an image file.'), input, h('div', { style: { height: '14px' } }), opts, out);
    },
  });

  // ---------------- WORD -> PDF ----------------
  U.register({
    id: 'word2pdf', group: 'Convert', icon: '📝', title: 'Word to PDF', desc: '.docx, .txt, .html → PDF',
    render(root) {
      let file = null; const out = h('div'), opts = h('div'), info = h('div', { class: 'card fileinfo' });
      const page = sel([['a4', 'A4'], ['letter', 'US Letter'], ['legal', 'US Legal']], 'a4');
      const fam = sel([['Helvetica', 'Sans-serif (Helvetica)'], ['Times', 'Serif (Times)'], ['Courier', 'Monospace (Courier)']], 'Helvetica');
      const fs = h('input', { type: 'number', min: 7, max: 20, step: 0.5, value: 11, style: { width: '80px' } });
      const mg = sel([['36', 'Narrow (0.5")'], ['54', 'Normal (0.75")'], ['72', 'Wide (1")']], '54');
      const mode = sel([['auto', 'Automatic'], ['vector', 'Selectable text (Latin only)'], ['image', 'Exact look as images (any language)']], 'auto');
      const nums = h('input', { type: 'checkbox' });
      const input = U.dropzone({ accept: '.docx,.txt,.html,.htm,.md', icon: '📝', title: 'Drop a Word (.docx), text or HTML file here', subtitle: 'Old .doc files: open in Word and "Save as .docx" first', onFiles: ([f]) => { file = f; info.replaceChildren(h('div', null, h('div', { class: 'nm' }, f.name), h('div', { class: 'meta' }, U.fmtBytes(f.size))), h('button', { class: 'btn sm', onclick: () => { file = null; opts.hidden = true; info.replaceWith(input); } }, 'Change file')); input.replaceWith(info); opts.hidden = false; } });
      async function go() {
        U.run('Converting…', async () => {
          let html, msgs = [];
          if (/\.docx$/i.test(file.name)) {
            const r = await mammoth.convertToHtml({ arrayBuffer: await file.arrayBuffer() });
            html = r.value; msgs = r.messages;
          } else {
            const txt = await file.text();
            if (/\.html?$/i.test(file.name)) html = txt;
            else html = '<pre>' + U.escapeHtml(txt) + '</pre>';
          }
          const res = await U.htmlToPdf(html, { page: page.value, family: fam.value, fontSize: +fs.value || 11, margin: +mg.value, numbers: nums.checked, mode: mode.value, title: U.baseName(file.name) });
          const notes = [];
          if (res.rasterised) notes.push('Rendered as images so every character displays correctly (text in the PDF is not selectable).');
          if (res.lost) notes.push(res.lost + ' character(s) could not be shown in the standard fonts and were replaced with "?". Choose “Exact look as images” to keep them.');
          if (/\.docx$/i.test(file.name)) notes.push('Complex layout (text boxes, columns, headers/footers) is simplified. Formatting, lists, tables, links and pictures are kept.');
          U.showResults(out, [{ name: U.baseName(file.name) + '.pdf', bytes: res.bytes, mime: 'application/pdf' }], { title: 'Converted — ' + res.pages + ' page(s)', summary: notes.join(' ') });
        });
      }
      opts.hidden = true;
      opts.append(h('div', { class: 'card' }, h('div', { class: 'row' }, h('label', { class: 'f' }, 'Page size', page), h('label', { class: 'f' }, 'Font', fam), h('label', { class: 'f' }, 'Font size (pt)', fs), h('label', { class: 'f' }, 'Margins', mg), h('label', { class: 'f' }, 'Rendering', mode)),
        h('label', { class: 'chk', style: { marginTop: '12px' } }, nums, 'Add page numbers'),
        h('div', { style: { marginTop: '14px' } }, h('button', { class: 'btn pri', onclick: go }, '📝 Convert to PDF'))));
      root.append(h('h1', null, 'Word to PDF'), h('p', { class: 'sub' }, 'Converted privately in your browser. Works with .docx, .txt and .html.'), input, h('div', { style: { height: '14px' } }), opts, out);
    },
  });

  // ---------------- PDF -> TEXT ----------------
  U.register({
    id: 'pdf2text', group: 'Convert', icon: '🔤', title: 'PDF to text', desc: 'Extract all text from a PDF',
    render(root) {
      let cur = null; const out = h('div');
      const ta = h('textarea', { readOnly: true, rows: 16 });
      const input = U.singlePdf({ onLoad: (f) => { cur = f; go(); }, onClear: () => { out.hidden = true; } });
      async function go() {
        U.busy('Extracting text…');
        try {
          let all = [];
          for (let i = 1; i <= cur.numPages; i++) {
            await U.progress(i / cur.numPages);
            const tc = await (await cur.pdf.getPage(i)).getTextContent();
            let s = '', lastY = null;
            for (const it of tc.items) {
              if (lastY !== null && Math.abs(it.transform[5] - lastY) > 2) s += '\n'; else if (s && !/\s$/.test(s) && it.str && !/^\s/.test(it.str)) s += ' ';
              s += it.str; lastY = it.transform[5];
              if (it.hasEOL) { s += '\n'; lastY = null; }
            }
            all.push('--- Page ' + i + ' ---\n' + s.replace(/[ \t]+\n/g, '\n').trim());
          }
          ta.value = all.join('\n\n');
          out.hidden = false;
          const empty = ta.value.replace(/--- Page \d+ ---/g, '').trim().length < 5;
          out.replaceChildren(h('div', { class: 'card' }, empty ? h('div', { class: 'note' }, 'No text found — this looks like a scanned PDF (images only). OCR is not included.') : null, ta,
            h('div', { class: 'row', style: { marginTop: '12px' } },
              h('button', { class: 'btn pri', onclick: () => U.download(new Blob([ta.value], { type: 'text/plain' }), U.baseName(cur.name) + '.txt') }, '⬇ Download .txt'),
              h('button', { class: 'btn', onclick: () => { navigator.clipboard.writeText(ta.value); U.toast('Copied', 'ok'); } }, 'Copy'))));
        } catch (e) { U.error(e); } finally { U.busyEnd(); }
      }
      out.hidden = true;
      root.append(h('h1', null, 'PDF to text'), h('p', { class: 'sub' }, 'Pull the text out of a PDF.'), input, h('div', { style: { height: '14px' } }), out);
    },
  });
})();
