/* Compress PDF + Compress images */
(function () {
  const h = U.h, L = PDFLib, N = (s) => L.PDFName.of(s);
  const sel = (opts, val) => h('select', null, opts.map(([v, t]) => h('option', { value: v, selected: v === val }, t)));

  async function inflate(bytes) {
    if (typeof DecompressionStream === 'function') {
      const s = new Blob([bytes]).stream().pipeThrough(new DecompressionStream('deflate'));
      return new Uint8Array(await new Response(s).arrayBuffer());
    }
    return L.decodePDFRawStream({ dict: null, contents: bytes }).decode();
  }
  function unpredict(d, pred, colors, columns) {
    if (pred < 2) return d;
    const rb = colors * columns, bpp = colors;
    if (pred === 2) { // TIFF
      for (let r = 0; r * rb < d.length; r++) for (let i = bpp; i < rb; i++) d[r * rb + i] = (d[r * rb + i] + d[r * rb + i - bpp]) & 255;
      return d;
    }
    const rows = Math.floor(d.length / (rb + 1)), out = new Uint8Array(rows * rb);
    for (let r = 0; r < rows; r++) {
      const f = d[r * (rb + 1)], src = r * (rb + 1) + 1, dst = r * rb, up = dst - rb;
      for (let i = 0; i < rb; i++) {
        const x = d[src + i], a = i >= bpp ? out[dst + i - bpp] : 0, b = r ? out[up + i] : 0, c = r && i >= bpp ? out[up + i - bpp] : 0;
        let v;
        switch (f) {
          case 1: v = x + a; break;
          case 2: v = x + b; break;
          case 3: v = x + ((a + b) >> 1); break;
          case 4: { const p = a + b - c, pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c); v = x + (pa <= pb && pa <= pc ? a : pb <= pc ? b : c); break; }
          default: v = x;
        }
        out[dst + i] = v & 255;
      }
    }
    return out;
  }
  const num = (o, d) => (o && o.asNumber ? o.asNumber() : d);

  // recompress embedded raster images in-place. returns {count, saved}
  async function recompressImages(doc, o, onProg) {
    const ctx = doc.context, entries = ctx.enumerateIndirectObjects();
    const masks = new Set();
    for (const [, obj] of entries) if (obj instanceof L.PDFRawStream) {
      for (const k of ['SMask', 'Mask']) { const m = obj.dict.get(N(k)); if (m instanceof L.PDFRef) masks.add(m.toString()); }
    }
    let count = 0, saved = 0, i = 0;
    for (const [ref, obj] of entries) {
      i++;
      if (!(obj instanceof L.PDFRawStream)) continue;
      const dict = obj.dict;
      if (dict.get(N('Subtype')) !== N('Image') || masks.has(ref.toString())) continue;
      if (dict.lookup(N('ImageMask')) === L.PDFBool.True) continue;
      const bpc = num(dict.lookup(N('BitsPerComponent')), 8);
      if (bpc !== 8 || dict.has(N('Decode'))) continue;
      const maskEntry = dict.lookup(N('Mask'));
      if (maskEntry instanceof L.PDFArray) continue;
      const W = num(dict.lookup(N('Width'))), H = num(dict.lookup(N('Height')));
      if (!W || !H || obj.contents.length < (o.minBytes || 12000)) continue;
      let f = dict.lookup(N('Filter'));
      if (f instanceof L.PDFArray) { if (f.size() !== 1) continue; f = f.lookup(0); }
      const fname = f instanceof L.PDFName ? f.decodeText() : '';
      if (fname !== 'DCTDecode' && fname !== 'FlateDecode') continue;
      try {
        if (onProg && i % 4 === 0) await onProg(i / entries.length);
        let src; // canvas-drawable
        let sw = W, sh = H;
        if (fname === 'DCTDecode') {
          src = await createImageBitmap(new Blob([obj.contents], { type: 'image/jpeg' }));
          sw = src.width; sh = src.height;
        } else {
          let cs = dict.lookup(N('ColorSpace')), comps = 0;
          if (cs instanceof L.PDFName) comps = cs.decodeText() === 'DeviceRGB' ? 3 : cs.decodeText() === 'DeviceGray' ? 1 : 0;
          else if (cs instanceof L.PDFArray) {
            const t = cs.lookup(0);
            if (t instanceof L.PDFName) {
              const tn = t.decodeText();
              if (tn === 'ICCBased') { const s = cs.lookup(1); comps = num(s && s.dict && s.dict.lookup(N('N')), 0); }
              else if (tn === 'CalRGB') comps = 3; else if (tn === 'CalGray') comps = 1;
            }
          }
          if (comps !== 1 && comps !== 3) continue;
          let dp = dict.lookup(N('DecodeParms'));
          if (dp instanceof L.PDFArray) dp = dp.lookup(0);
          const pred = dp instanceof L.PDFDict ? num(dp.lookup(N('Predictor')), 1) : 1;
          let raw = await inflate(obj.contents);
          raw = unpredict(raw, pred, comps, W);
          if (raw.length < W * H * comps) continue;
          const id = new ImageData(W, H), d = id.data;
          for (let p = 0, q = 0; p < W * H; p++, q += 4) {
            if (comps === 3) { d[q] = raw[p * 3]; d[q + 1] = raw[p * 3 + 1]; d[q + 2] = raw[p * 3 + 2]; }
            else d[q] = d[q + 1] = d[q + 2] = raw[p];
            d[q + 3] = 255;
          }
          const tmp = document.createElement('canvas'); tmp.width = W; tmp.height = H;
          tmp.getContext('2d').putImageData(id, 0, 0);
          src = tmp;
        }
        const s = Math.min(1, o.maxDim / Math.max(sw, sh));
        const nw = Math.max(1, Math.round(sw * s)), nh = Math.max(1, Math.round(sh * s));
        const cv = document.createElement('canvas'); cv.width = nw; cv.height = nh;
        const c2 = cv.getContext('2d', { willReadFrequently: !!o.gray });
        c2.imageSmoothingQuality = 'high'; c2.fillStyle = '#fff'; c2.fillRect(0, 0, nw, nh);
        c2.drawImage(src, 0, 0, nw, nh);
        if (src.close) src.close();
        if (o.gray) { const id = c2.getImageData(0, 0, nw, nh), d = id.data; for (let p = 0; p < d.length; p += 4) { const g = 0.3 * d[p] + 0.59 * d[p + 1] + 0.11 * d[p + 2]; d[p] = d[p + 1] = d[p + 2] = g; } c2.putImageData(id, 0, 0); }
        const nb = await U.canvasBytes(cv, 'image/jpeg', o.quality);
        if (nb.length < obj.contents.length * 0.92) {
          dict.set(N('Width'), L.PDFNumber.of(nw)); dict.set(N('Height'), L.PDFNumber.of(nh));
          dict.set(N('ColorSpace'), N('DeviceRGB')); dict.set(N('BitsPerComponent'), L.PDFNumber.of(8));
          dict.set(N('Filter'), N('DCTDecode')); dict.delete(N('DecodeParms')); dict.delete(N('Decode'));
          dict.set(N('Length'), L.PDFNumber.of(nb.length));
          ctx.assign(ref, L.PDFRawStream.of(dict, nb));
          count++; saved += obj.contents.length - nb.length;
        }
      } catch (e) { console.warn('image skipped', e); }
    }
    return { count, saved };
  }

  async function stripMeta(doc) {
    try { ['Title', 'Author', 'Subject', 'Creator', 'Producer'].forEach((k) => doc.context.trailerInfo.Info && doc.context.lookup(doc.context.trailerInfo.Info).delete(N(k))); } catch (_) { }
    try { doc.setKeywords([]); } catch (_) { }
    try { doc.catalog.delete(N('Metadata')); } catch (_) { }
  }

  U.register({
    id: 'compress', group: 'Optimise', icon: '🗜', title: 'Compress PDF', desc: 'Reduce file size and image quality',
    render(root) {
      let cur = null; const out = h('div'), opts = h('div');
      const PRE = { light: [0, 0, 'Light'], rec: [0.72, 1800, 'Recommended'], strong: [0.5, 1200, 'Strong'], max: [0.5, 100, 'Maximum'] };
      let preset = 'rec';
      const seg = h('div', { class: 'seg' }), desc = h('div', { class: 'hint' });
      const quality = h('input', { type: 'range', min: 20, max: 95, value: 72 });
      const qv = h('b', null, '72%');
      const maxd = h('input', { type: 'number', min: 300, max: 6000, step: 100, value: 1800, style: { width: '100px' } });
      const dpi = h('input', { type: 'number', min: 50, max: 300, step: 10, value: 110, style: { width: '90px' } });
      const gray = h('input', { type: 'checkbox' }), meta = h('input', { type: 'checkbox' });
      const imgRow = h('div', { class: 'row' }, h('label', { class: 'f' }, h('span', null, 'JPEG quality ', qv), quality), h('label', { class: 'f' }, 'Max image size (px)', maxd));
      const rasRow = h('div', { class: 'row' }, h('label', { class: 'f' }, 'Page resolution (dpi)', dpi), h('label', { class: 'f' }, h('span', null, 'JPEG quality ', qv.cloneNode(true)), quality.cloneNode(true)));
      quality.oninput = () => { qv.textContent = quality.value + '%'; };
      const D = { light: 'Re-saves the file more efficiently without touching images. Text stays selectable. Usually saves 0–15%.', rec: 'Shrinks big embedded photos/scans (JPEG 72%, max 1800px). Text stays sharp and selectable. Best for most files.', strong: 'Smaller, noticeably softer images (JPEG 50%, max 1200px). Text stays selectable.', max: 'Turns every page into a compressed picture. Smallest result, but text is no longer selectable or searchable.' };
      function paint() {
        seg.replaceChildren(...Object.entries(PRE).map(([k, v]) => h('button', { class: k === preset ? 'on' : '', onclick: () => { preset = k; if (v[0]) { quality.value = v[0] * 100; qv.textContent = quality.value + '%'; } if (v[1] && k !== 'max') maxd.value = v[1]; paint(); } }, v[2])));
        desc.textContent = D[preset];
        imgRow.hidden = preset === 'light' || preset === 'max';
        rasRow.hidden = preset !== 'max';
      }
      const rasQ = rasRow.querySelector('input[type=range]');
      const input = U.singlePdf({ onLoad: (f) => { cur = f; opts.hidden = false; }, onClear: () => { opts.hidden = true; } });
      async function go() {
        U.run('Compressing…', async () => {
          const before = cur.bytes.length;
          let bytes, info = '';
          if (preset === 'max') {
            const doc = await L.PDFDocument.create(), s = +dpi.value / 72, q = +rasQ.value / 100;
            for (let i = 1; i <= cur.numPages; i++) {
              await U.progress(i / cur.numPages, 'Page ' + i + ' of ' + cur.numPages);
              const pg = await cur.pdf.getPage(i), vp = pg.getViewport({ scale: 1 });
              const cv = await U.renderPage(cur.pdf, i, s);
              if (gray.checked) { const c = cv.getContext('2d'), id = c.getImageData(0, 0, cv.width, cv.height), d = id.data; for (let p = 0; p < d.length; p += 4) d[p] = d[p + 1] = d[p + 2] = 0.3 * d[p] + 0.59 * d[p + 1] + 0.11 * d[p + 2]; c.putImageData(id, 0, 0); }
              const img = await doc.embedJpg(await U.canvasBytes(cv, 'image/jpeg', q));
              doc.addPage([vp.width, vp.height]).drawImage(img, { x: 0, y: 0, width: vp.width, height: vp.height });
              cv.width = cv.height = 0;
            }
            U.pdf.finish(doc); bytes = await U.pdf.save(doc);
            info = 'Pages were flattened to images.';
          } else {
            const doc = await U.pdf.load(cur.bytes);
            if (preset !== 'light') {
              const r = await recompressImages(doc, { quality: +quality.value / 100, maxDim: +maxd.value || 1800, gray: gray.checked }, (f) => U.progress(f, 'Recompressing images…'));
              info = r.count ? 'Recompressed ' + r.count + ' image(s), saving about ' + U.fmtBytes(r.saved) + '.' : 'No large images were found to recompress.';
            }
            if (meta.checked) await stripMeta(doc);
            U.pdf.finish(doc);
            bytes = await U.pdf.save(doc, { useObjectStreams: true });
          }
          const pct = Math.round((1 - bytes.length / before) * 100);
          if (bytes.length >= before) {
            U.showResults(out, [{ name: cur.name, bytes: cur.bytes, mime: 'application/pdf' }], { title: 'Already well optimised', summary: 'This method could not make the file smaller (' + U.fmtBytes(before) + '). Try a stronger setting. ' + info, noEditor: true });
          } else U.showResults(out, [{ name: U.baseName(cur.name) + '_compressed.pdf', bytes, mime: 'application/pdf' }], { title: U.fmtBytes(before) + ' → ' + U.fmtBytes(bytes.length) + ' (' + pct + '% smaller)', summary: info });
        });
      }
      opts.hidden = true; paint();
      opts.append(h('div', { class: 'card' }, seg, desc, h('div', { style: { height: '12px' } }), imgRow, rasRow,
        h('div', { class: 'row', style: { marginTop: '10px' } }, h('label', { class: 'chk' }, gray, 'Convert to grayscale'), h('label', { class: 'chk' }, meta, 'Remove metadata (title, author…)')),
        h('div', { style: { marginTop: '14px' } }, h('button', { class: 'btn pri', onclick: go }, '🗜 Compress'))));
      root.append(h('h1', null, 'Compress PDF'), h('p', { class: 'sub' }, 'Make a PDF smaller for email or upload. Choose how much quality to give up.'), input, h('div', { style: { height: '14px' } }), opts, out);
    },
  });

  // ---------------- COMPRESS IMAGES ----------------
  U.register({
    id: 'compimg', group: 'Optimise', icon: '📉', title: 'Compress images', desc: 'Shrink JPG, PNG, WebP photos',
    render(root) {
      const items = [], out = h('div');
      const list = U.sortList({ items, onChange: upd });
      const fmt = sel([['keep', 'Keep format'], ['jpeg', 'JPG'], ['webp', 'WebP'], ['png', 'PNG']], 'keep');
      const q = h('input', { type: 'range', min: 20, max: 98, value: 75 }), qv = h('b', null, '75%');
      q.oninput = () => { qv.textContent = q.value + '%'; };
      const maxd = h('input', { type: 'number', min: 0, step: 100, placeholder: 'no limit', style: { width: '110px' } });
      const target = h('input', { type: 'number', min: 0, placeholder: 'optional', style: { width: '110px' } });
      const btn = h('button', { class: 'btn pri', disabled: true, onclick: go }, '📉 Compress');
      function upd() { btn.disabled = !items.length; }
      async function add(files) { for (const f of files) items.push({ name: f.name, file: f, meta: U.fmtBytes(f.size), thumb: h('img', { src: URL.createObjectURL(f) }) }); list.render(); upd(); }
      async function enc(cv, type, quality, targetBytes) {
        if (type === 'image/png') return U.canvasBytes(cv, type);
        if (!targetBytes) return U.canvasBytes(cv, type, quality);
        let lo = 0.15, hi = 0.95, best = await U.canvasBytes(cv, type, lo);
        if (best.length > targetBytes) return best;
        for (let i = 0; i < 7; i++) { const mid = (lo + hi) / 2, b = await U.canvasBytes(cv, type, mid); if (b.length <= targetBytes) { best = b; lo = mid; } else hi = mid; }
        return best;
      }
      async function go() {
        U.run('Compressing…', async () => {
          const files = [];
          for (let i = 0; i < items.length; i++) {
            await U.progress(i / items.length, items[i].name);
            const f = items[i].file;
            const bmp = await U.pdf.loadBitmap(f);
            let w = bmp.width, hh = bmp.height; const ow = w;
            const md = +maxd.value;
            if (md > 0 && Math.max(w, hh) > md) { const s = md / Math.max(w, hh); w = Math.round(w * s); hh = Math.round(hh * s); }
            let type = fmt.value === 'keep' ? (/png/.test(f.type) ? 'image/png' : /webp/.test(f.type) ? 'image/webp' : 'image/jpeg') : 'image/' + fmt.value;
            const cv = document.createElement('canvas'); cv.width = w; cv.height = hh;
            const ctx = cv.getContext('2d'); ctx.imageSmoothingQuality = 'high';
            if (type === 'image/jpeg') { ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, w, hh); }
            ctx.drawImage(bmp, 0, 0, w, hh); bmp.close && bmp.close();
            let bytes = await enc(cv, type, +q.value / 100, +target.value > 0 ? +target.value * 1024 : 0);
            let ext = type === 'image/jpeg' ? 'jpg' : type.split('/')[1];
            const resized = w !== ow;
            if (bytes.length >= f.size && !resized && fmt.value === 'keep') { bytes = await U.readBytes(f); ext = f.name.split('.').pop(); }
            files.push({ name: U.baseName(f.name) + '-compressed.' + ext, bytes, mime: type, orig: f.size });
          }
          const before = items.reduce((s, i) => s + i.file.size, 0), after = files.reduce((s, f) => s + f.bytes.length, 0);
          U.showResults(out, files, { title: U.fmtBytes(before) + ' → ' + U.fmtBytes(after) + ' (' + Math.round((1 - after / before) * 100) + '% smaller)', zipName: 'compressed-images', noEditor: true });
        });
      }
      root.append(h('h1', null, 'Compress images'), h('p', { class: 'sub' }, 'Reduce photo size by lowering quality or dimensions. Everything stays on your device.'),
        h('div', { class: 'card' }, U.dropzone({ accept: 'image/*', multiple: true, onFiles: add, icon: '📉', title: 'Drop images here or click to choose' }), h('div', { style: { height: '12px' } }), list),
        h('div', { class: 'card' }, h('div', { class: 'row' }, h('label', { class: 'f' }, 'Output format', fmt), h('label', { class: 'f' }, h('span', null, 'Quality ', qv), q),
          h('label', { class: 'f' }, 'Max width/height (px)', maxd), h('label', { class: 'f' }, 'Target size per image (KB)', target)),
          h('div', { class: 'hint' }, 'PNG is lossless so the quality slider has no effect on it — shrink the dimensions or switch to JPG/WebP.'),
          h('div', { style: { marginTop: '14px' } }, btn)), out);
    },
  });
})();
