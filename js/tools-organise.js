/* Merge, Split, Extract/Delete, Organise */
(function () {
  const h = U.h, L = PDFLib;

  // ---------------- MERGE ----------------
  U.register({
    id: 'merge', group: 'Organise', icon: '🧩', title: 'Merge PDFs', desc: 'Combine PDFs and images into one file',
    render(root) {
      const items = [];
      const out = h('div');
      const list = U.sortList({ items, onChange: upd, extra: (it) => it.kind === 'pdf' ? h('label', { class: 'f', style: { width: '120px' } }, 'Pages (optional)',
        h('input', { type: 'text', placeholder: 'e.g. 1-3,5', value: it.range || '', oninput: (e) => { it.range = e.target.value; } })) : null });
      const btn = h('button', { class: 'btn pri', disabled: true, onclick: go }, '🧩 Merge');
      const info = h('span', { class: 'muted' });
      function upd() { btn.disabled = items.length < 1; info.textContent = items.length ? items.length + ' file(s) · ' + items.reduce((s, i) => s + (i.pages || 1), 0) + ' pages total' : ''; }
      async function add(files) {
        U.busy('Reading files…');
        try {
          for (const f of files) {
            const isImg = f.type.startsWith('image/') || /\.(jpe?g|png|webp|gif|bmp|avif)$/i.test(f.name);
            if (isImg) {
              items.push({ name: f.name, kind: 'img', file: f, pages: 1, meta: 'Image · ' + U.fmtBytes(f.size), thumb: h('img', { src: URL.createObjectURL(f) }) });
              continue;
            }
            const bytes = await U.readBytes(f);
            try {
              const pdf = await U.pdfjsLoad(bytes);
              const th = h('div'); U.lazyThumb(th, pdf, 1, 60);
              items.push({ name: f.name, kind: 'pdf', bytes, pages: pdf.numPages, meta: pdf.numPages + ' pages · ' + U.fmtBytes(bytes.length), thumb: th });
            } catch (e) { U.toast(f.name + ': could not open (' + e.message + ')', 'err'); }
          }
        } finally { U.busyEnd(); }
        list.render(); upd();
      }
      async function go() {
        U.run('Merging…', async () => {
          const doc = await L.PDFDocument.create();
          let n = 0;
          for (const it of items) {
            await U.progress(n++ / items.length, 'Adding ' + it.name);
            if (it.kind === 'pdf') {
              const src = await U.pdf.load(it.bytes);
              const idx = U.parseRanges(it.range, src.getPageCount());
              (await U.pdf.copyOrdered(doc, src, idx)).forEach((p) => doc.addPage(p));
            } else {
              const img = await U.pdf.embedImage(doc, it.file, {});
              const [aw, ah] = U.pdf.pageSizes.a4;
              const land = img.width > img.height;
              const pw = land ? ah : aw, ph = land ? aw : ah, m = 24;
              const s = Math.min((pw - 2 * m) / img.width, (ph - 2 * m) / img.height, 1);
              const page = doc.addPage([pw, ph]);
              page.drawImage(img, { x: (pw - img.width * s) / 2, y: (ph - img.height * s) / 2, width: img.width * s, height: img.height * s });
            }
          }
          U.pdf.finish(doc);
          const bytes = await U.pdf.save(doc);
          U.showResults(out, [{ name: 'merged.pdf', bytes, mime: 'application/pdf' }], { title: 'Merged ' + items.length + ' files into ' + doc.getPageCount() + ' pages' });
        });
      }
      root.append(h('h1', null, 'Merge PDFs'), h('p', { class: 'sub' }, 'Add PDFs (and images), drag to reorder, optionally pick only some pages from each.'),
        h('div', { class: 'card' }, U.dropzone({ accept: '.pdf,application/pdf,image/*', multiple: true, onFiles: add, icon: '🧩', title: 'Drop PDFs or images here, or click to choose' }), h('div', { style: { height: '12px' } }), list,
          h('div', { class: 'row', style: { marginTop: '14px', alignItems: 'center' } }, btn, info)), out);
    },
  });

  // ---------------- SPLIT ----------------
  U.register({
    id: 'split', group: 'Organise', icon: '✂️', title: 'Split PDF', desc: 'Cut a PDF into several files',
    render(root) {
      let cur = null, mode = 'ranges';
      const out = h('div'), opts = h('div');
      const ranges = h('input', { type: 'text', value: '', placeholder: '1-3, 4-6, 7-' });
      const every = h('input', { type: 'number', min: 1, value: 1, style: { width: '90px' } });
      const input = U.singlePdf({ onLoad: (f) => { cur = f; ranges.value = f.numPages > 1 ? '1-' + Math.ceil(f.numPages / 2) + ', ' + (Math.ceil(f.numPages / 2) + 1) + '-' : '1-'; opts.hidden = false; }, onClear: () => { cur = null; opts.hidden = true; } });
      const seg = h('div', { class: 'seg' });
      const sub = h('div', { style: { marginTop: '12px' } });
      const modes = [['ranges', 'By page ranges'], ['every', 'Every N pages'], ['each', 'Every page']];
      function paint() {
        seg.replaceChildren(...modes.map(([k, t]) => h('button', { class: k === mode ? 'on' : '', onclick: () => { mode = k; paint(); } }, t)));
        sub.replaceChildren(mode === 'ranges' ? h('label', { class: 'f' }, 'Each range becomes its own PDF (comma separated)', ranges)
          : mode === 'every' ? h('label', { class: 'f' }, 'Pages per file', every) : h('div', { class: 'muted' }, 'One PDF per page.'));
      }
      paint();
      async function go() {
        U.run('Splitting…', async () => {
          const src = await U.pdf.load(cur.bytes), n = src.getPageCount(), base = U.baseName(cur.name);
          let groups = [];
          if (mode === 'ranges') {
            groups = ranges.value.split(',').map((s) => s.trim()).filter(Boolean).map((r) => ({ idx: U.parseRanges(r, n), label: r.replace(/\s/g, '') }));
          } else {
            const k = mode === 'each' ? 1 : Math.max(1, +every.value | 0);
            for (let i = 0; i < n; i += k) { const e = Math.min(n, i + k); groups.push({ idx: Array.from({ length: e - i }, (_, j) => i + j), label: e - i === 1 ? '' + (i + 1) : (i + 1) + '-' + e }); }
          }
          if (!groups.length) throw new Error('Nothing to split');
          const files = [];
          for (let g = 0; g < groups.length; g++) {
            await U.progress(g / groups.length, 'Creating part ' + (g + 1) + ' of ' + groups.length);
            const doc = await L.PDFDocument.create();
            (await U.pdf.copyOrdered(doc, src, groups[g].idx)).forEach((p) => doc.addPage(p));
            U.pdf.finish(doc);
            files.push({ name: base + '_pages_' + groups[g].label + '.pdf', bytes: await U.pdf.save(doc), mime: 'application/pdf' });
          }
          U.showResults(out, files, { title: 'Split into ' + files.length + ' PDFs', zipName: base + '_split', noEditor: files.length > 30 });
        });
      }
      opts.hidden = true;
      opts.append(h('div', { class: 'card' }, seg, sub, h('div', { style: { marginTop: '14px' } }, h('button', { class: 'btn pri', onclick: go }, '✂️ Split'))));
      root.append(h('h1', null, 'Split PDF'), h('p', { class: 'sub' }, 'Split by custom ranges, every N pages, or into single pages.'), input, h('div', { style: { height: '14px' } }), opts, out);
    },
  });

  // ---------------- EXTRACT / DELETE ----------------
  U.register({
    id: 'extract', group: 'Organise', icon: '📑', title: 'Extract / delete pages', desc: 'Keep or remove selected pages',
    render(root) {
      let cur = null, mode = 'keep';
      const sel = new Set();
      const out = h('div'), body = h('div');
      const range = h('input', { type: 'text', placeholder: 'e.g. 1-3, 7, 10-', style: { width: '260px' }, oninput: () => { try { sel.clear(); U.parseRanges(range.value, cur.numPages).forEach((i) => sel.add(i)); sync(false); range.style.outline = ''; } catch (_) { range.style.outline = '2px solid #e5322d'; } } });
      const grid = h('div', { class: 'grid' });
      const go = h('button', { class: 'btn pri', onclick: run }, 'Create PDF');
      const seg = h('div', { class: 'seg' });
      const cnt = h('span', { class: 'muted' });
      const cards = [];
      function paintSeg() {
        seg.replaceChildren(...[['keep', '📑 Extract selected pages'], ['del', '🗑 Delete selected pages']].map(([k, t]) => h('button', { class: k === mode ? 'on' : '', onclick: () => { mode = k; paintSeg(); } }, t)));
        go.textContent = mode === 'keep' ? 'Extract ' + sel.size + ' page(s)' : 'Delete ' + sel.size + ' page(s)';
      }
      function sync(updRange = true) {
        cards.forEach((c, i) => c.classList.toggle('sel', sel.has(i)));
        if (updRange) range.value = U.compactRanges([...sel]);
        cnt.textContent = sel.size + ' of ' + cur.numPages + ' selected';
        go.disabled = !sel.size || (mode === 'del' && sel.size >= cur.numPages);
        paintSeg();
      }
      function build(f) {
        cur = f; sel.clear(); cards.length = 0; range.value = '';
        for (let i = 0; i < f.numPages; i++) {
          const th = h('div', { class: 'cv' }); U.lazyThumb(th, f.pdf, i + 1, 120);
          const c = h('div', { class: 'pg', onclick: (e) => { if (e.shiftKey && last != null) { const [a, b] = [Math.min(last, i), Math.max(last, i)]; for (let k = a; k <= b; k++) sel.add(k); } else sel.has(i) ? sel.delete(i) : sel.add(i); last = i; sync(); } },
            h('div', { class: 'ck' }, '✓'), th, h('div', { class: 'lb' }, 'Page ' + (i + 1)));
          cards.push(c);
        }
        let last = null;
        grid.replaceChildren(...cards);
        body.hidden = false; sync();
      }
      async function run() {
        U.run('Building PDF…', async () => {
          const src = await U.pdf.load(cur.bytes), n = src.getPageCount();
          const idx = mode === 'keep' ? [...sel].sort((a, b) => a - b) : Array.from({ length: n }, (_, i) => i).filter((i) => !sel.has(i));
          const doc = await L.PDFDocument.create();
          (await U.pdf.copyOrdered(doc, src, idx)).forEach((p) => doc.addPage(p));
          U.pdf.finish(doc);
          U.showResults(out, [{ name: U.baseName(cur.name) + (mode === 'keep' ? '_extracted.pdf' : '_trimmed.pdf'), bytes: await U.pdf.save(doc), mime: 'application/pdf' }], { title: idx.length + ' pages in the new PDF' });
        });
      }
      const input = U.singlePdf({ onLoad: build, onClear: () => { body.hidden = true; } });
      body.hidden = true;
      body.append(h('div', { class: 'card' },
        h('div', { class: 'row', style: { marginBottom: '12px' } }, seg, h('label', { class: 'f' }, 'Pages (click thumbnails or type)', range),
          h('button', { class: 'btn sm', onclick: () => { for (let i = 0; i < cur.numPages; i++) sel.add(i); sync(); } }, 'All'),
          h('button', { class: 'btn sm', onclick: () => { sel.clear(); sync(); } }, 'None'),
          h('button', { class: 'btn sm', onclick: () => { const s = new Set(sel); sel.clear(); for (let i = 0; i < cur.numPages; i++) if (!s.has(i)) sel.add(i); sync(); } }, 'Invert'), cnt),
        grid, h('div', { style: { marginTop: '14px' } }, go)));
      root.append(h('h1', null, 'Extract or delete pages'), h('p', { class: 'sub' }, 'Click pages to select (shift-click for a range), or type a range.'), input, h('div', { style: { height: '14px' } }), body, out);
    },
  });

  // ---------------- ORGANISE ----------------
  U.register({
    id: 'organise', group: 'Organise', icon: '🗂', title: 'Organise & rotate', desc: 'Reorder, rotate, duplicate, add blank pages',
    render(root) {
      let srcs = [], items = [];
      const out = h('div'), body = h('div'), grid = h('div', { class: 'grid' });
      let dragFrom = null;
      const input = U.singlePdf({ onLoad: async (f) => { srcs = [{ name: f.name, bytes: f.bytes, pdf: f.pdf }]; items = []; for (let i = 0; i < f.numPages; i++) items.push({ s: 0, p: i, rot: 0 }); body.hidden = false; paint(); }, onClear: () => { body.hidden = true; }, title: 'Drop a PDF to organise' });
      const origRot = {};
      function paint() {
        grid.replaceChildren(...items.map((it, i) => {
          const th = it.blank ? h('div', { style: { width: '80px', height: '110px', background: '#fff', color: '#aaa', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '11px' } }, 'blank') : h('div');
          if (!it.blank) U.lazyThumb(th, srcs[it.s].pdf, it.p + 1, 120);
          const cv = h('div', { class: 'cv', style: { transform: 'rotate(' + it.rot + 'deg)', transition: 'transform .2s' } }, th);
          const c = h('div', { class: 'pg', draggable: true },
            h('div', { class: 'cv' }, h('div', { style: { transform: 'rotate(' + it.rot + 'deg)', transition: 'transform .2s', maxWidth: '100%', maxHeight: '100%', display: 'flex' } }, th)),
            h('div', { class: 'lb' }, (i + 1) + (it.blank ? ' · blank' : ' · from p.' + (it.p + 1) + (srcs.length > 1 ? ' (' + (it.s + 1) + ')' : ''))),
            h('div', { class: 'tools' },
              h('button', { title: 'Rotate left', onclick: () => { it.rot = (it.rot + 270) % 360; paint(); } }, '↺'),
              h('button', { title: 'Rotate right', onclick: () => { it.rot = (it.rot + 90) % 360; paint(); } }, '↻'),
              h('button', { title: 'Duplicate', onclick: () => { items.splice(i + 1, 0, { ...it }); paint(); } }, '⧉'),
              h('button', { title: 'Insert blank page after', onclick: () => { items.splice(i + 1, 0, { blank: true, rot: 0 }); paint(); } }, '＋'),
              h('button', { title: 'Delete', onclick: () => { items.splice(i, 1); paint(); } }, '🗑')));
          c.addEventListener('dragstart', () => { dragFrom = i; });
          c.addEventListener('dragover', (e) => { e.preventDefault(); c.classList.add('over'); });
          c.addEventListener('dragleave', () => c.classList.remove('over'));
          c.addEventListener('drop', (e) => { e.preventDefault(); if (dragFrom == null || dragFrom === i) return; items.splice(i, 0, items.splice(dragFrom, 1)[0]); dragFrom = null; paint(); });
          return c;
        }));
        cnt.textContent = items.length + ' pages';
      }
      const cnt = h('span', { class: 'muted' });
      async function addPdf(files) {
        for (const f of files) {
          const bytes = await U.readBytes(f);
          const pdf = await U.pdfjsLoad(bytes);
          srcs.push({ name: f.name, bytes, pdf });
          for (let i = 0; i < pdf.numPages; i++) items.push({ s: srcs.length - 1, p: i, rot: 0 });
        }
        paint();
      }
      const addInput = h('input', { type: 'file', accept: '.pdf', multiple: true, hidden: true, onchange: (e) => { addPdf([...e.target.files]); e.target.value = ''; } });
      async function save() {
        U.run('Saving…', async () => {
          const doc = await L.PDFDocument.create();
          const libs = {};
          // copy once per source
          const copies = [];
          for (let si = 0; si < srcs.length; si++) {
            const idxs = items.filter((it) => it.s === si && !it.blank).map((it) => it.p);
            if (!idxs.length) continue;
            libs[si] = await U.pdf.load(srcs[si].bytes);
            const uniq = [...new Set(idxs)];
            const pages = await doc.copyPages(libs[si], uniq);
            copies[si] = new Map(uniq.map((u, i) => [u, pages[i]]));
          }
          const used = new Set();
          let lastSize = U.pdf.pageSizes.a4;
          for (const it of items) {
            let page;
            if (it.blank) { page = doc.addPage(lastSize); }
            else {
              const key = it.s + ':' + it.p;
              if (!used.has(key)) { used.add(key); page = copies[it.s].get(it.p); }
              else page = (await doc.copyPages(libs[it.s], [it.p]))[0];
              doc.addPage(page);
              const b = U.pdf.box(page); lastSize = [b.w, b.h];
              if (it.rot) page.setRotation(L.degrees((b.rot + it.rot) % 360));
            }
          }
          U.pdf.finish(doc);
          U.showResults(out, [{ name: U.baseName(srcs[0].name) + '_organised.pdf', bytes: await U.pdf.save(doc), mime: 'application/pdf' }], { title: 'Saved ' + items.length + ' pages' });
        });
      }
      body.hidden = true;
      body.append(h('div', { class: 'card' },
        h('div', { class: 'row', style: { marginBottom: '12px', alignItems: 'center' } },
          h('button', { class: 'btn sm', onclick: () => { items.forEach((i) => (i.rot = (i.rot + 90) % 360)); paint(); } }, '↻ Rotate all'),
          h('button', { class: 'btn sm', onclick: () => { items.reverse(); paint(); } }, '⇅ Reverse order'),
          h('button', { class: 'btn sm', onclick: () => { items.push({ blank: true, rot: 0 }); paint(); } }, '＋ Blank page at end'),
          h('button', { class: 'btn sm', onclick: () => addInput.click() }, '＋ Append another PDF', addInput), cnt),
        grid, h('div', { class: 'hint' }, 'Drag pages to reorder. Use the buttons under each page to rotate, duplicate, insert a blank page after it, or delete it.'),
        h('div', { style: { marginTop: '14px' } }, h('button', { class: 'btn pri', onclick: save }, '💾 Save PDF'))));
      root.append(h('h1', null, 'Organise & rotate pages'), h('p', { class: 'sub' }, 'Drag to reorder, rotate, delete, duplicate and insert blank pages.'), input, h('div', { style: { height: '14px' } }), body, out);
    },
  });
})();
