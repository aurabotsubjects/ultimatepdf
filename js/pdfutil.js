/* pdf-lib helpers shared by tools */
(function () {
  const L = PDFLib;
  const P = (U.pdf = {});

  P.load = (bytes, opts) => L.PDFDocument.load(bytes, Object.assign({ ignoreEncryption: true, updateMetadata: false }, opts));

  // visible box of a page + rotation
  P.box = (page) => {
    let b;
    try { b = page.getCropBox(); } catch (_) { b = page.getMediaBox(); }
    if (!b || !b.width) b = page.getMediaBox();
    let rot = ((page.getRotation().angle % 360) + 360) % 360;
    const w = b.width, h = b.height;
    const swap = rot === 90 || rot === 270;
    return { x: b.x, y: b.y, w, h, rot, vw: swap ? h : w, vh: swap ? w : h };
  };
  // visual coordinates (origin bottom-left of the *displayed* page) -> pdf user space
  P.visToPdf = (bx, vx, vy) => {
    let x, y;
    switch (bx.rot) {
      case 90: x = bx.w - vy; y = vx; break;
      case 180: x = bx.w - vx; y = bx.h - vy; break;
      case 270: x = vy; y = bx.h - vx; break;
      default: x = vx; y = vy;
    }
    return [bx.x + x, bx.y + y];
  };
  // pdf user space -> visual (bottom-left origin)
  P.pdfToVis = (bx, px, py) => {
    const x = px - bx.x, y = py - bx.y;
    switch (bx.rot) {
      case 90: return [y, bx.w - x];
      case 180: return [bx.w - x, bx.h - y];
      case 270: return [bx.h - y, x];
      default: return [x, y];
    }
  };

  // can this standard font encode the string?
  const encCache = new WeakMap();
  P.canEncode = (font, text) => {
    let c = encCache.get(font);
    if (!c) encCache.set(font, (c = new Map()));
    for (const ch of text) {
      if (ch === '\n' || ch === '\r' || ch === '\t') continue;
      let ok = c.get(ch);
      if (ok === undefined) { try { font.encodeText(ch); ok = true; } catch (_) { ok = false; } c.set(ch, ok); }
      if (!ok) return false;
    }
    return true;
  };
  P.safeText = (font, text) => {
    let out = '', n = 0;
    for (const ch of text) {
      if (ch === '\t') { out += '    '; continue; }
      if (ch === '\n' || ch === '\r') { out += ch; continue; }
      if (P.canEncode(font, ch)) out += ch;
      else {
        const m = { '‑': '-', '−': '-', ' ': ' ', '→': '->', '←': '<-', '✓': 'v', '•': '•' }[ch];
        if (m) out += m; else { out += '?'; n++; }
      }
    }
    return { text: out, lost: n };
  };

  // copy pages (by index, in the order given, duplicates allowed) from src into dest. returns the new pages (not yet added)
  P.copyOrdered = async (dest, src, indices) => {
    const uniq = [...new Set(indices)];
    const copied = await dest.copyPages(src, uniq);
    const map = new Map(uniq.map((u, i) => [u, copied[i]]));
    const used = new Set();
    const out = [];
    for (const idx of indices) {
      if (!used.has(idx)) { used.add(idx); out.push(map.get(idx)); }
      else out.push((await dest.copyPages(src, [idx]))[0]);
    }
    return out;
  };

  // ---- images ----
  P.jpegOrientation = (b) => {
    try {
      if (b[0] !== 0xff || b[1] !== 0xd8) return 1;
      let o = 2;
      while (o < b.length) {
        if (b[o] !== 0xff) break;
        const m = b[o + 1], len = (b[o + 2] << 8) | b[o + 3];
        if (m === 0xe1 && b[o + 4] === 0x45 && b[o + 5] === 0x78) {
          const t = o + 10, le = b[t] === 0x49;
          const r16 = (p) => le ? b[p] | (b[p + 1] << 8) : (b[p] << 8) | b[p + 1];
          const r32 = (p) => le ? (b[p] | (b[p + 1] << 8) | (b[p + 2] << 16) | (b[p + 3] << 24)) : ((b[p] << 24) | (b[p + 1] << 16) | (b[p + 2] << 8) | b[p + 3]);
          const ifd = t + r32(t + 4), n = r16(ifd);
          for (let i = 0; i < n; i++) { const e = ifd + 2 + i * 12; if (r16(e) === 0x0112) return r16(e + 8); }
          return 1;
        }
        o += 2 + len;
      }
    } catch (_) { }
    return 1;
  };
  P.loadBitmap = async (file) => createImageBitmap(file instanceof Blob ? file : new Blob([file]), { imageOrientation: 'from-image' });
  // Make a pdf-lib image from a File. opts: {maxDim, quality (0-1, null=keep original), forceJpeg}
  P.embedImage = async (doc, file, opts) => {
    opts = opts || {};
    const bytes = await U.readBytes(file);
    const isJpg = /jpe?g/i.test(file.type) || /\.jpe?g$/i.test(file.name);
    const isPng = /png/i.test(file.type) || /\.png$/i.test(file.name);
    const keep = opts.quality == null && !opts.maxDim;
    if (keep && isJpg && P.jpegOrientation(bytes) === 1) return doc.embedJpg(bytes);
    if (keep && isPng) return doc.embedPng(bytes);
    const bmp = await P.loadBitmap(file);
    let w = bmp.width, h = bmp.height;
    if (opts.maxDim && Math.max(w, h) > opts.maxDim) { const s = opts.maxDim / Math.max(w, h); w = Math.round(w * s); h = Math.round(h * s); }
    const cv = document.createElement('canvas'); cv.width = w; cv.height = h;
    const ctx = cv.getContext('2d');
    ctx.imageSmoothingQuality = 'high';
    // JPEG output needs a white background; PNG keeps alpha
    const wantPng = isPng && opts.quality == null && !opts.forceJpeg;
    if (!wantPng) { ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, w, h); }
    ctx.drawImage(bmp, 0, 0, w, h);
    bmp.close && bmp.close();
    if (wantPng) return doc.embedPng(await U.canvasBytes(cv, 'image/png'));
    return doc.embedJpg(await U.canvasBytes(cv, 'image/jpeg', opts.quality == null ? 0.92 : opts.quality));
  };

  P.hex = (hex) => {
    const m = /^#?([0-9a-f]{6})$/i.exec(hex || '#000000');
    const n = parseInt(m ? m[1] : '000000', 16);
    return L.rgb(((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255);
  };

  P.pageSizes = { a4: [595.28, 841.89], letter: [612, 792], legal: [612, 1008], a3: [841.89, 1190.55], a5: [419.53, 595.28] };

  // Add a link annotation
  P.addLink = (doc, page, rect, url) => {
    const ctx = doc.context;
    const annot = ctx.obj({
      Type: 'Annot', Subtype: 'Link', Rect: rect, Border: [0, 0, 0],
      A: { Type: 'Action', S: 'URI', URI: L.PDFString.of(url) },
    });
    page.node.addAnnot(ctx.register(annot));
  };

  P.save = (doc, opts) => doc.save(Object.assign({ useObjectStreams: true }, opts));
  P.finish = (doc, title) => {
    try { doc.setProducer('UltimatePDF'); doc.setModificationDate(new Date()); } catch (_) { }
    return doc;
  };
})();
