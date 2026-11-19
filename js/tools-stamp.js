/* Watermark, headers/footers/page numbers, metadata & flatten */
(function () {
  const h = U.h, L = PDFLib, P = () => U.pdf;
  const sel = (opts, val) => h('select', null, opts.map(([v, t]) => h('option', { value: v, selected: v === val }, t)));

  function shell(root, title, sub, build) {
    let cur = null; const out = h('div'), opts = h('div');
    opts.hidden = true;
    const input = U.singlePdf({ onLoad: (f) => { cur = f; opts.hidden = false; api.onload && api.onload(f); }, onClear: () => { opts.hidden = true; } });
    const api = { get cur() { return cur; }, out, opts };
    build(api);
    root.append(h('h1', null, title), h('p', { class: 'sub' }, sub), input, h('div', { style: { height: '14px' } }), opts, out);
    return api;
  }
  const pageSave = async (api, doc, suffix, title) => {
    U.pdf.finish(doc);
    U.showResults(api.out, [{ name: U.baseName(api.cur.name) + suffix + '.pdf', bytes: await U.pdf.save(doc), mime: 'application/pdf' }], { title });
  };

  // ---------------- WATERMARK ----------------
  U.register({
    id: 'watermark', group: 'Stamp & secure', icon: '💧', title: 'Watermark', desc: 'Add text or image watermark',
    render(root) {
      let kind = 'text', imgFile = null;
      const text = h('input', { type: 'text', value: 'CONFIDENTIAL' });
      const size = h('input', { type: 'number', value: 64, min: 6, max: 400, style: { width: '80px' } });
      const color = h('input', { type: 'color', value: '#d93025' });
      const op = h('input', { type: 'range', min: 5, max: 100, value: 25 });
      const angle = h('input', { type: 'number', value: 45, min: -180, max: 180, style: { width: '80px' } });
      const tile = h('input', { type: 'checkbox' });
      const range = h('input', { type: 'text', placeholder: 'all pages', style: { width: '130px' } });
      const seg = h('div', { class: 'seg' }), body = h('div');
      const imgIn = h('input', { type: 'file', accept: 'image/png,image/jpeg,image/webp', onchange: (e) => { imgFile = e.target.files[0]; } });
      const imgW = h('input', { type: 'number', value: 50, min: 5, max: 100, style: { width: '80px' } });
      function paint() {
        seg.replaceChildren(...[['text', 'Text'], ['image', 'Image']].map(([k, t]) => h('button', { class: k === kind ? 'on' : '', onclick: () => { kind = k; paint(); } }, t)));
        body.replaceChildren(kind === 'text' ? h('div', { class: 'row' }, h('label', { class: 'f' }, 'Text', text), h('label', { class: 'f' }, 'Size', size), h('label', { class: 'f' }, 'Colour', color))
          : h('div', { class: 'row' }, h('label', { class: 'f' }, 'Image (PNG/JPG)', imgIn), h('label', { class: 'f' }, 'Width (% of page)', imgW)));
      }
      shell(root, 'Add watermark', 'Stamp text or a logo across your pages.', (api) => {
        paint();
        api.opts.append(h('div', { class: 'card' }, seg, h('div', { style: { height: '12px' } }), body, h('div', { class: 'row', style: { marginTop: '12px' } },
          h('label', { class: 'f' }, 'Opacity', op), h('label', { class: 'f' }, 'Rotation °', angle), h('label', { class: 'f' }, 'Pages', range), h('label', { class: 'chk' }, tile, 'Repeat across page')),
          h('div', { style: { marginTop: '14px' } }, h('button', { class: 'btn pri', onclick: () => U.run('Adding watermark…', async () => {
            const doc = await U.pdf.load(api.cur.bytes), pages = doc.getPages();
            const idx = new Set(U.parseRanges(range.value, pages.length));
            let img = null, font = null;
            if (kind === 'image') { if (!imgFile) throw new Error('Choose an image first'); img = await U.pdf.embedImage(doc, imgFile, {}); }
            else { font = await doc.embedFont(L.StandardFonts.HelveticaBold); if (!U.pdf.canEncode(font, text.value)) throw new Error('Watermark text has characters the standard font cannot print. Use an image watermark for other alphabets.'); }
            const th = +angle.value * Math.PI / 180, c = Math.cos(th), s = Math.sin(th), opacity = +op.value / 100;
            const col = U.pdf.hex(color.value);
            pages.forEach((pg, i) => {
              if (!idx.has(i)) return;
              const bx = U.pdf.box(pg);
              let w, hgt;
              if (kind === 'text') { w = font.widthOfTextAtSize(text.value, +size.value); hgt = +size.value * 0.7; }
              else { w = bx.vw * (+imgW.value / 100); hgt = w * img.height / img.width; }
              const centers = [];
              if (tile.checked) { const gx = Math.max(w, 1) * 1.5 + 30, gy = Math.max(hgt * 3, 110); for (let yy = gy / 2; yy < bx.vh + gy; yy += gy) for (let xx = ((Math.round(yy / gy) % 2) * gx) / 2; xx < bx.vw + gx; xx += gx) centers.push([xx, yy]); }
              else centers.push([bx.vw / 2, bx.vh / 2]);
              for (const [cx, cy] of centers) {
                const ax = cx - (c * (w / 2) - s * (hgt / 2)), ay = cy - (s * (w / 2) + c * (hgt / 2));
                const [px, py] = U.pdf.visToPdf(bx, ax, ay);
                const rot = L.degrees(+angle.value + bx.rot);
                if (kind === 'text') pg.drawText(text.value, { x: px, y: py, size: +size.value, font, color: col, opacity, rotate: rot });
                else pg.drawImage(img, { x: px, y: py, width: w, height: hgt, opacity, rotate: rot });
              }
            });
            await pageSave(api, doc, '_watermarked', 'Watermark added');
          }) }, '💧 Apply watermark'))));
      });
    },
  });

  // ---------------- HEADER / FOOTER / PAGE NUMBERS ----------------
  U.register({
    id: 'pagenum', group: 'Stamp & secure', icon: '🔢', title: 'Page numbers & headers', desc: 'Numbering, header & footer text',
    render(root) {
      const mk = (v) => h('input', { type: 'text', value: v || '', style: { width: '100%' } });
      const hl = mk(), hc = mk(), hr = mk(), fl = mk(), fc = mk('Page {n} of {total}'), fr = mk();
      const size = h('input', { type: 'number', value: 10, min: 5, max: 40, style: { width: '70px' } });
      const margin = h('input', { type: 'number', value: 28, min: 5, max: 120, style: { width: '70px' } });
      const start = h('input', { type: 'number', value: 1, style: { width: '70px' } });
      const font = sel([['Helvetica', 'Helvetica'], ['TimesRoman', 'Times'], ['Courier', 'Courier']], 'Helvetica');
      const color = h('input', { type: 'color', value: '#333333' });
      const range = h('input', { type: 'text', placeholder: 'all pages', style: { width: '130px' } });
      const skip = h('input', { type: 'checkbox' });
      const cell = (t, i) => h('label', { class: 'f' }, t, i);
      shell(root, 'Page numbers, headers & footers', 'Tokens: {n} page number · {total} page count · {date} today · {file} file name', (api) => {
        api.opts.append(h('div', { class: 'card' },
          h('h3', null, 'Header'), h('div', { class: 'row' }, ...[['Left', hl], ['Centre', hc], ['Right', hr]].map(([t, i]) => h('div', { style: { flex: 1, minWidth: '160px' } }, cell(t, i)))),
          h('h3', { style: { marginTop: '14px' } }, 'Footer'), h('div', { class: 'row' }, ...[['Left', fl], ['Centre', fc], ['Right', fr]].map(([t, i]) => h('div', { style: { flex: 1, minWidth: '160px' } }, cell(t, i)))),
          h('div', { class: 'row', style: { marginTop: '14px' } }, cell('Font', font), cell('Size', size), cell('Colour', color), cell('Distance from edge', margin), cell('First number', start), cell('Pages', range), h('label', { class: 'chk' }, skip, 'Skip first page')),
          h('div', { style: { marginTop: '14px' } }, h('button', { class: 'btn pri', onclick: () => U.run('Stamping…', async () => {
            const doc = await U.pdf.load(api.cur.bytes), pages = doc.getPages(), total = pages.length;
            const f = await doc.embedFont(L.StandardFonts[font.value]);
            const idx = new Set(U.parseRanges(range.value, total)); if (skip.checked) idx.delete(0);
            const sz = +size.value, col = U.pdf.hex(color.value), m = +margin.value;
            const date = new Date().toLocaleDateString();
            let lost = 0;
            pages.forEach((pg, i) => {
              if (!idx.has(i)) return;
              const bx = U.pdf.box(pg);
              const sub = (t) => t.replace(/\{n\}/g, i + (+start.value) - (skip.checked ? 1 : 0) + (skip.checked ? 0 : 0)).replace(/\{total\}/g, total).replace(/\{date\}/g, date).replace(/\{file\}/g, api.cur.name);
              const draw = (t, pos, top) => {
                if (!t.trim()) return;
                const r = U.pdf.safeText(f, sub(t)); lost += r.lost;
                const w = f.widthOfTextAtSize(r.text, sz);
                const vx = pos === 0 ? m : pos === 1 ? (bx.vw - w) / 2 : bx.vw - m - w;
                const vy = top ? bx.vh - m - sz * 0.8 : m;
                const [px, py] = U.pdf.visToPdf(bx, vx, vy);
                pg.drawText(r.text, { x: px, y: py, size: sz, font: f, color: col, rotate: L.degrees(bx.rot) });
              };
              [hl, hc, hr].forEach((el, k) => draw(el.value, k, true)); [fl, fc, fr].forEach((el, k) => draw(el.value, k, false));
            });
            await pageSave(api, doc, '_numbered', 'Stamped ' + idx.size + ' page(s)' + (lost ? ' (' + lost + ' unsupported characters replaced)' : ''));
          }) }, '🔢 Apply'))));
      });
    },
  });

  // ---------------- METADATA / FLATTEN / CLEAN ----------------
  U.register({
    id: 'metadata', group: 'Stamp & secure', icon: '🏷', title: 'Metadata & flatten', desc: 'Edit properties, flatten forms, strip data',
    render(root) {
      const f = {};
      const inp = (k, label) => h('label', { class: 'f', style: { flex: '1 1 260px' } }, label, (f[k] = h('input', { type: 'text' })));
      const flat = h('input', { type: 'checkbox' }), noAnn = h('input', { type: 'checkbox' }), wipe = h('input', { type: 'checkbox' });
      const info = h('div', { class: 'muted small' });
      const api = shell(root, 'Metadata & clean-up', 'Edit document properties, flatten fillable forms into plain content, or strip hidden data before sharing.', (api) => {
        api.opts.append(h('div', { class: 'card' }, h('div', { class: 'row' }, inp('title', 'Title'), inp('author', 'Author'), inp('subject', 'Subject'), inp('keywords', 'Keywords (comma separated)'), inp('creator', 'Creator')), info),
          h('div', { class: 'card' }, h('h3', null, 'Clean-up'),
            h('label', { class: 'chk' }, flat, 'Flatten form fields (make filled-in values permanent, no longer editable)'),
            h('label', { class: 'chk', style: { marginTop: '6px' } }, noAnn, 'Remove all annotations (links, comments, highlights)'),
            h('label', { class: 'chk', style: { marginTop: '6px' } }, wipe, 'Wipe all metadata (ignores the fields above)'),
            h('div', { style: { marginTop: '14px' } }, h('button', { class: 'btn pri', onclick: () => U.run('Saving…', async () => {
              const doc = await U.pdf.load(api.cur.bytes);
              if (flat.checked) { try { doc.getForm().flatten(); } catch (e) { U.toast('Could not flatten form: ' + e.message, 'err'); } }
              if (noAnn.checked) doc.getPages().forEach((p) => p.node.delete(L.PDFName.of('Annots')));
              if (wipe.checked) { await (async () => { /* reuse */ })(); doc.setTitle(''); doc.setAuthor(''); doc.setSubject(''); doc.setKeywords([]); doc.setCreator(''); try { doc.catalog.delete(L.PDFName.of('Metadata')); } catch (_) { } }
              else {
                doc.setTitle(f.title.value); doc.setAuthor(f.author.value); doc.setSubject(f.subject.value); doc.setCreator(f.creator.value);
                doc.setKeywords(f.keywords.value.split(',').map((s) => s.trim()).filter(Boolean));
              }
              U.pdf.finish(doc);
              U.showResults(api.out, [{ name: U.baseName(api.cur.name) + '_clean.pdf', bytes: await U.pdf.save(doc), mime: 'application/pdf' }], { title: 'Saved' });
            }) }, '💾 Save PDF'))));
        api.onload = async (file) => {
          const doc = await U.pdf.load(file.bytes);
          f.title.value = doc.getTitle() || ''; f.author.value = doc.getAuthor() || ''; f.subject.value = doc.getSubject() || '';
          f.keywords.value = doc.getKeywords() || ''; f.creator.value = doc.getCreator() || '';
          let nf = 0; try { nf = doc.getForm().getFields().length; } catch (_) { }
          info.textContent = 'Producer: ' + (doc.getProducer() || '—') + ' · Created: ' + (doc.getCreationDate() ? doc.getCreationDate().toLocaleString() : '—') + ' · ' + nf + ' form field(s)';
        };
      });
    },
  });
})();
