/* HTML -> PDF.  Vector text layout engine (pdf-lib) with an image-based fallback (html2canvas) for non-Latin scripts. */
(function () {
  const L = PDFLib;
  const BLOCK = new Set(['P', 'DIV', 'H1', 'H2', 'H3', 'H4', 'H5', 'H6', 'UL', 'OL', 'LI', 'TABLE', 'PRE', 'BLOCKQUOTE', 'HR', 'SECTION', 'ARTICLE', 'HEADER', 'FOOTER', 'FIGURE', 'FIGCAPTION', 'BODY', 'MAIN', 'ASIDE', 'NAV', 'DL', 'DT', 'DD', 'ADDRESS', 'FORM', 'FIELDSET']);

  function parse(html) {
    const dom = new DOMParser().parseFromString(html, 'text/html');
    dom.querySelectorAll('script,style,head,noscript,iframe,object,embed').forEach((n) => n.remove());
    return dom;
  }

  async function toPdfImage(doc, src) {
    // returns {img, w, h} or null
    try {
      let bytes, type;
      if (src.startsWith('data:')) {
        const m = /^data:([^;,]+)(;base64)?,(.*)$/s.exec(src);
        type = m[1].toLowerCase();
        if (m[2]) { const bin = atob(m[3]); bytes = new Uint8Array(bin.length); for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i); }
        else bytes = new TextEncoder().encode(decodeURIComponent(m[3]));
      } else return null;
      if (type === 'image/png') { const img = await doc.embedPng(bytes); return { img, w: img.width, h: img.height }; }
      if (type === 'image/jpeg' || type === 'image/jpg') { const img = await doc.embedJpg(bytes); return { img, w: img.width, h: img.height }; }
      const bmp = await createImageBitmap(new Blob([bytes], { type }));
      const cv = document.createElement('canvas'); cv.width = bmp.width; cv.height = bmp.height;
      cv.getContext('2d').drawImage(bmp, 0, 0);
      const img = await doc.embedPng(await U.canvasBytes(cv, 'image/png'));
      return { img, w: img.width, h: img.height };
    } catch (_) { return null; }
  }

  async function vector(html, o) {
    const doc = await L.PDFDocument.create();
    const SF = L.StandardFonts;
    const sets = {
      Helvetica: [SF.Helvetica, SF.HelveticaBold, SF.HelveticaOblique, SF.HelveticaBoldOblique],
      Times: [SF.TimesRoman, SF.TimesRomanBold, SF.TimesRomanItalic, SF.TimesRomanBoldItalic],
      Courier: [SF.Courier, SF.CourierBold, SF.CourierOblique, SF.CourierBoldOblique],
    };
    const fam = sets[o.family] || sets.Helvetica;
    const F = { fam: await Promise.all(fam.map((n) => doc.embedFont(n))), mono: await Promise.all(sets.Courier.map((n) => doc.embedFont(n))) };
    const fontOf = (st) => (st.mono ? F.mono : F.fam)[(st.b ? 1 : 0) + (st.i ? 2 : 0)];

    const dom = parse(html);
    // pre-embed images
    const imgMap = new Map();
    for (const el of dom.body.querySelectorAll('img')) {
      const r = await toPdfImage(doc, el.getAttribute('src') || '');
      if (r) imgMap.set(el, r);
    }

    const [PW, PH] = U.pdf.pageSizes[o.page] || U.pdf.pageSizes.a4;
    const M = o.margin, CW = PW - 2 * M, CH = PH - 2 * M;
    const base = o.fontSize;
    let lost = 0, page = null, y = 0, pages = [], pending = null;

    const newPage = () => { page = doc.addPage([PW, PH]); pages.push(page); y = PH - M; };
    const ensure = (h) => { if (!page || y - h < M) newPage(); };
    const gap = (g) => { if (page && y < PH - M - 0.5) y -= g; };
    newPage();

    // ---- inline tokenizer ----
    const mk = (st, ch) => Object.assign({}, st, ch);
    function inline(nodes, st, out) {
      for (const n of nodes) {
        if (n.nodeType === 3) {
          const txt = n.nodeValue;
          if (st.pre) { for (const p of txt.split(/(\n|[^\S\n]+|\S+)/).filter(Boolean)) out.push(p === '\n' ? { t: 'br' } : { t: 'w', text: p, st }); }
          else for (const p of txt.split(/(\s+)/).filter(Boolean)) out.push(/^\s+$/.test(p) ? { t: 's', st } : { t: 'w', text: p, st });
        } else if (n.nodeType === 1) {
          const tag = n.tagName;
          if (tag === 'BR') out.push({ t: 'br' });
          else if (tag === 'IMG') { const r = imgMap.get(n); if (r) out.push({ t: 'img', r }); }
          else if (BLOCK.has(tag) && tag !== 'LI') { out.push({ t: 'br' }); inline(n.childNodes, st, out); out.push({ t: 'br' }); }
          else {
            let s = st;
            if (tag === 'B' || tag === 'STRONG' || /^H[1-6]$/.test(tag) || tag === 'TH') s = mk(s, { b: true });
            if (tag === 'I' || tag === 'EM' || tag === 'CITE' || tag === 'DFN') s = mk(s, { i: true });
            if (tag === 'U' || tag === 'INS') s = mk(s, { u: true });
            if (tag === 'S' || tag === 'STRIKE' || tag === 'DEL') s = mk(s, { s: true });
            if (tag === 'CODE' || tag === 'KBD' || tag === 'TT' || tag === 'SAMP') s = mk(s, { mono: true });
            if (tag === 'SUP') s = mk(s, { size: st.size * 0.7, raise: st.size * 0.35 });
            if (tag === 'SUB') s = mk(s, { size: st.size * 0.7, raise: -st.size * 0.15 });
            if (tag === 'A' && n.getAttribute('href')) s = mk(s, { href: n.getAttribute('href'), u: true, link: true });
            inline(n.childNodes, s, out);
          }
        }
      }
    }

    // ---- line layout ----
    function layout(tokens, maxW, firstIndent) {
      const lines = [];
      let line = { segs: [], w: 0 }, pend = null, first = true;
      const avail = () => maxW - (first ? firstIndent || 0 : 0);
      const push = (force) => {
        const s = line.segs[line.segs.length - 1];
        if (s && /\s$/.test(s.text) && !s.st.pre) { const f = fontOf(s.st); s.text = s.text.trimEnd(); s.w = f.widthOfTextAtSize(s.text, s.st.size); line.w = line.segs.reduce((a, b) => a + b.w, 0); }
        lines.push(line); line = { segs: [], w: 0 }; pend = null; first = false;
      };
      const add = (text, st, w) => {
        const last = line.segs[line.segs.length - 1];
        if (last && last.st === st) { last.text += text; last.w += w; }
        else line.segs.push({ text, st, w });
        line.w += w;
      };
      for (const tk of tokens) {
        if (tk.t === 'br') { push(); continue; }
        if (tk.t === 'img') { if (line.segs.length) push(); lines.push({ img: tk.r }); first = false; continue; }
        if (tk.t === 's') { if (line.segs.length) pend = tk.st; continue; }
        const f = fontOf(tk.st), size = tk.st.size;
        const s = U.pdf.safeText(f, tk.text); lost += s.lost;
        let text = s.text;
        if (!text) continue;
        let w = f.widthOfTextAtSize(text, size);
        let spw = pend ? fontOf(pend).widthOfTextAtSize(' ', pend.size) : 0;
        if (line.segs.length && line.w + spw + w > avail() + 0.01) { push(); spw = 0; pend = null; }
        if (w > avail()) { // break a very long word by characters
          let chunk = '';
          for (const ch of text) {
            if (f.widthOfTextAtSize(chunk + ch, size) > avail() && chunk) { add(chunk, tk.st, f.widthOfTextAtSize(chunk, size)); push(); chunk = ''; }
            chunk += ch;
          }
          text = chunk; w = f.widthOfTextAtSize(chunk, size);
        }
        if (spw && line.segs.length) add(' ', pend, spw);
        add(text, tk.st, w);
        pend = null;
      }
      if (line.segs.length || !lines.length) push();
      return lines;
    }
    const lineH = (ln) => ln.img ? Math.min(ln.img.h * 0.75, CH * 0.92) + 4 : Math.max(base, ...ln.segs.map((s) => s.st.size || base)) * 1.28;
    const imgDims = (r, maxW) => { let w = r.w * 0.75, h = r.h * 0.75; const s = Math.min(1, maxW / w, (CH * 0.92) / h); return [w * s, h * s]; };

    function drawLine(pg, ln, x, top, maxW) {
      if (ln.img) {
        const [w, h] = imgDims(ln.img, maxW);
        pg.drawImage(ln.img.img, { x, y: top - h - 2, width: w, height: h });
        return;
      }
      const lh = lineH(ln), mx = Math.max(base, ...ln.segs.map((s) => s.st.size || base));
      const bl = top - mx * 0.98;
      let cx = x;
      for (const sg of ln.segs) {
        const f = fontOf(sg.st), size = sg.st.size;
        if (sg.text.trim() || sg.st.u || sg.st.s) {
          const yy = bl + (sg.st.raise || 0);
          if (sg.text) pg.drawText(sg.text, { x: cx, y: yy, size, font: f, color: sg.st.link ? L.rgb(0.05, 0.25, 0.75) : L.rgb(0, 0, 0) });
          if (sg.st.u) pg.drawLine({ start: { x: cx, y: yy - size * 0.12 }, end: { x: cx + sg.w, y: yy - size * 0.12 }, thickness: size * 0.06, color: sg.st.link ? L.rgb(0.05, 0.25, 0.75) : L.rgb(0, 0, 0) });
          if (sg.st.s) pg.drawLine({ start: { x: cx, y: yy + size * 0.3 }, end: { x: cx + sg.w, y: yy + size * 0.3 }, thickness: size * 0.06, color: L.rgb(0, 0, 0) });
          if (sg.st.href && /^(https?:|mailto:)/i.test(sg.st.href)) U.pdf.addLink(doc, pg, [cx, yy - size * 0.2, cx + sg.w, yy + size * 0.9], sg.st.href);
        }
        cx += sg.w;
      }
    }

    // paragraph into main flow
    function para(tokens, x, w, o2) {
      o2 = o2 || {};
      if (!tokens.some((t) => t.t === 'w' || t.t === 'img')) { if (pending) { /* empty list item */ } return; }
      const lines = layout(tokens, w, 0);
      gap(o2.before || 0);
      lines.forEach((ln, i) => {
        const lh = lineH(ln);
        ensure(lh + (i === 0 && o2.keep ? lh * 2 : 0));
        if (i === 0 && pending) {
          const f = fontOf({ b: false, i: false, size: base, mono: false });
          pg2().drawText(pending.text, { x: x - 6 - f.widthOfTextAtSize(pending.text, base), y: y - base * 0.98, size: base, font: f });
          pending = null;
        }
        drawLine(page, ln, x, y, w);
        y -= lh;
      });
      gap(o2.after == null ? base * 0.55 : o2.after);
    }
    const pg2 = () => page;

    // ---- block flow ----
    function flow(nodes, indent, st, depth) {
      let buf = [];
      const flush = () => {
        if (!buf.length) return;
        const toks = []; inline(buf, st, toks); buf = [];
        para(toks, M + indent, CW - indent);
      };
      for (const n of nodes) {
        if (n.nodeType === 1 && BLOCK.has(n.tagName)) { flush(); blockEl(n, indent, st, depth); }
        else if (n.nodeType === 1 || n.nodeType === 3) buf.push(n);
      }
      flush();
    }
    function blockEl(n, indent, st, depth) {
      const tag = n.tagName;
      if (/^H[1-6]$/.test(tag)) {
        const lv = +tag[1], size = base * [2, 1.6, 1.35, 1.15, 1.05, 1][lv - 1];
        const toks = []; inline(n.childNodes, mk(st, { b: true, size }), toks);
        para(toks, M + indent, CW - indent, { before: size * 0.6, after: size * 0.3, keep: true });
      } else if (tag === 'UL' || tag === 'OL') {
        let k = +(n.getAttribute('start') || 1);
        for (const li of n.children) {
          if (li.tagName !== 'LI') continue;
          pending = { text: tag === 'OL' ? k++ + '.' : (depth % 2 ? '-' : '•') };
          flow(li.childNodes, indent + 20, st, depth + 1);
          if (pending) { // empty item
            ensure(base * 1.3); page.drawText(pending.text, { x: M + indent + 20 - 6 - 5, y: y - base * 0.98, size: base, font: F.fam[0] }); y -= base * 1.3; pending = null;
          }
        }
        gap(base * 0.3);
      } else if (tag === 'TABLE') table(n, indent, st);
      else if (tag === 'PRE') {
        const toks = []; inline(n.childNodes, mk(st, { mono: true, pre: true, size: base * 0.9 }), toks);
        para(toks, M + indent, CW - indent, { before: 2, after: base * 0.6 });
      } else if (tag === 'HR') {
        ensure(base); gap(base * 0.4); page.drawLine({ start: { x: M + indent, y }, end: { x: M + CW, y }, thickness: 0.7, color: L.rgb(0.6, 0.6, 0.6) }); gap(base * 0.8);
      } else if (tag === 'BLOCKQUOTE') {
        const y0 = y, p0 = pages.length;
        flow(n.childNodes, indent + 24, mk(st, { i: true }), depth);
        if (pages.length === p0) page.drawLine({ start: { x: M + indent + 10, y: y0 }, end: { x: M + indent + 10, y: y + base * 0.4 }, thickness: 2, color: L.rgb(0.75, 0.75, 0.75) });
      } else if (tag === 'FIGURE' || tag === 'DIV' || tag === 'SECTION' || tag === 'ARTICLE' || tag === 'BODY' || tag === 'MAIN' || tag === 'HEADER' || tag === 'FOOTER' || tag === 'ASIDE' || tag === 'NAV' || tag === 'FORM' || tag === 'FIELDSET' || tag === 'ADDRESS') flow(n.childNodes, indent, st, depth);
      else if (tag === 'DT') { const toks = []; inline(n.childNodes, mk(st, { b: true }), toks); para(toks, M + indent, CW - indent, { after: 1 }); }
      else if (tag === 'DD') flow(n.childNodes, indent + 24, st, depth);
      else if (tag === 'DL') flow(n.childNodes, indent, st, depth);
      else if (tag === 'LI') flow(n.childNodes, indent, st, depth);
      else { const toks = []; inline(n.childNodes, st, toks); para(toks, M + indent, CW - indent); } // P, FIGCAPTION
    }

    // ---- tables ----
    function table(tbl, indent, st) {
      const rowsEl = [...tbl.querySelectorAll('tr')].filter((r) => r.closest('table') === tbl);
      const rows = rowsEl.map((r) => [...r.children].filter((c) => c.tagName === 'TD' || c.tagName === 'TH').map((c) => ({ el: c, span: Math.max(1, +(c.getAttribute('colspan') || 1)), th: c.tagName === 'TH' })));
      const ncols = Math.max(1, ...rows.map((r) => r.reduce((a, c) => a + c.span, 0)));
      const pad = 4, avail = CW - indent;
      const cellToks = (c) => {
        // blocks inside the cell -> separate token arrays
        const groups = []; let cur = [];
        const s0 = c.th ? mk(st, { b: true, size: base * 0.95 }) : mk(st, { size: base * 0.95 });
        const walk = (nodes) => { for (const n of nodes) { if (n.nodeType === 1 && BLOCK.has(n.tagName) && n.tagName !== 'UL' && n.tagName !== 'OL') { if (cur.length) { groups.push(cur); cur = []; } walk(n.childNodes); if (cur.length) { groups.push(cur); cur = []; } } else if (n.nodeType === 1 && (n.tagName === 'UL' || n.tagName === 'OL')) { if (cur.length) { groups.push(cur); cur = []; } let k = 1; for (const li of n.children) { const t = []; inline([document.createTextNode((n.tagName === 'OL' ? k++ + '. ' : '• '))], s0, t); inline(li.childNodes, s0, t); groups.push(t); } } else { const t = []; inline([n], s0, t); cur.push(...t); } } };
        walk(c.el.childNodes); if (cur.length) groups.push(cur);
        return groups.filter((g) => g.some((t) => t.t === 'w' || t.t === 'img'));
      };
      const meas = (toks) => { let min = 8, nat = 0; for (const t of toks) { if (t.t === 'w') { const f = fontOf(t.st); const w = f.widthOfTextAtSize(U.pdf.safeText(f, t.text).text, t.st.size); min = Math.max(min, w); nat += w; } else if (t.t === 's') nat += t.st.size * 0.3; else if (t.t === 'img') { const w = Math.min(t.r.w * 0.75, avail); min = Math.max(min, Math.min(w, 120)); nat += w; } } return [min, nat]; };
      const colMin = Array(ncols).fill(12), colNat = Array(ncols).fill(12);
      rows.forEach((r) => r.forEach((c) => { c.groups = cellToks(c); }));
      rows.forEach((r) => { let ci = 0; r.forEach((c) => { c.col = ci; if (c.span === 1) { for (const g of c.groups) { const [mi, na] = meas(g); colMin[ci] = Math.max(colMin[ci], mi); colNat[ci] = Math.max(colNat[ci], na); } } ci += c.span; }); });
      let wd = colNat.map((v, i) => v + 2 * pad);
      const sumNat = wd.reduce((a, b) => a + b, 0);
      if (sumNat > avail) {
        const mins = colMin.map((v) => v + 2 * pad), sm = mins.reduce((a, b) => a + b, 0);
        if (sm >= avail) wd = mins.map((v) => v * avail / sm);
        else { const extra = avail - sm, want = wd.map((v, i) => Math.max(0, v - mins[i])), sw = want.reduce((a, b) => a + b, 0) || 1; wd = mins.map((v, i) => v + extra * want[i] / sw); }
      } else { const s = avail / sumNat; wd = wd.map((v) => v * s); }
      gap(base * 0.3);
      for (const r of rows) {
        let rh = 0;
        for (const c of r) {
          c.w = wd.slice(c.col, c.col + c.span).reduce((a, b) => a + b, 0);
          c.x = wd.slice(0, c.col).reduce((a, b) => a + b, 0);
          c.lines = c.groups.map((g) => layout(g, c.w - 2 * pad, 0));
          c.h = c.lines.reduce((a, ls) => a + ls.reduce((s, l) => s + lineH(l), 0) + 2, 0) + 2 * pad - 2;
          rh = Math.max(rh, c.h, base * 1.2 + 2 * pad);
        }
        if (page && y - rh < M && rh < CH) newPage(); else ensure(Math.min(rh, CH));
        for (const c of r) {
          const x = M + indent + c.x;
          if (c.th) page.drawRectangle({ x, y: y - rh, width: c.w, height: rh, color: L.rgb(0.92, 0.92, 0.92) });
          page.drawRectangle({ x, y: y - rh, width: c.w, height: rh, borderColor: L.rgb(0.55, 0.55, 0.55), borderWidth: 0.6 });
          let cy = y - pad;
          for (const ls of c.lines) { for (const ln of ls) { drawLine(page, ln, x + pad, cy, c.w - 2 * pad); cy -= lineH(ln); } cy -= 2; }
        }
        y -= rh;
      }
      gap(base * 0.7);
    }

    flow(dom.body.childNodes, 0, { size: base }, 0);

    if (o.numbers) {
      const f = F.fam[0];
      pages.forEach((p, i) => { const t = (i + 1) + ' / ' + pages.length, w = f.widthOfTextAtSize(t, 9); p.drawText(t, { x: (PW - w) / 2, y: M / 2 - 3, size: 9, font: f, color: L.rgb(0.4, 0.4, 0.4) }); });
    }
    if (o.title) try { doc.setTitle(o.title); } catch (_) { }
    U.pdf.finish(doc);
    return { bytes: await U.pdf.save(doc), lost, pages: pages.length };
  }

  // does the HTML contain characters the standard fonts cannot print?
  async function needsUnicode(html) {
    const doc = await L.PDFDocument.create();
    const f = await doc.embedFont(L.StandardFonts.Helvetica);
    const text = parse(html).body.textContent || '';
    return !U.pdf.canEncode(f, text.replace(/[ ‑−→←✓​-‏﻿]/g, ' '));
  }

  async function raster(html, o) {
    const [PW, PH] = U.pdf.pageSizes[o.page] || U.pdf.pageSizes.a4;
    const M = o.margin, cw = PW - 2 * M, ch = PH - 2 * M;
    const pxW = Math.round(cw * 96 / 72);
    const holder = document.createElement('div');
    const dom = parse(html);
    holder.innerHTML = dom.body.innerHTML;
    const fam = o.family === 'Times' ? "'Times New Roman',Times,serif" : o.family === 'Courier' ? "'Courier New',monospace" : "-apple-system,'Helvetica Neue',Arial,'Noto Sans CJK KR','Malgun Gothic','Apple SD Gothic Neo','PingFang SC','Noto Sans',sans-serif";
    holder.style.cssText = 'position:absolute;left:-99999px;top:0;background:#fff;color:#000;width:' + pxW + 'px;font:' + o.fontSize * 96 / 72 + 'px/1.45 ' + fam + ';word-wrap:break-word';
    const st = document.createElement('style');
    st.textContent = 'h1{font-size:2em}h2{font-size:1.5em}h3{font-size:1.2em}table{border-collapse:collapse;width:100%}td,th{border:1px solid #888;padding:4px 6px;vertical-align:top}th{background:#eee}img{max-width:100%;height:auto}pre{white-space:pre-wrap;font-family:monospace}p{margin:0 0 .7em}';
    holder.prepend(st);
    document.body.append(holder);
    try {
      await new Promise((r) => setTimeout(r, 60));
      const scale = 2;
      const cv = await html2canvas(holder, { scale, backgroundColor: '#fff', useCORS: true, logging: false });
      const doc = await L.PDFDocument.create();
      const sliceH = Math.floor(ch * (cv.width / cw));
      const ctx = cv.getContext('2d', { willReadFrequently: true });
      const white = (yy) => { const d = ctx.getImageData(0, yy, cv.width, 1).data; for (let i = 0; i < d.length; i += 16) if (d[i] < 245 || d[i + 1] < 245 || d[i + 2] < 245) return false; return true; };
      let y0 = 0, n = 0;
      while (y0 < cv.height - 2) {
        let y1 = Math.min(cv.height, y0 + sliceH);
        if (y1 < cv.height) { for (let yy = y1; yy > y1 - 90 * scale && yy > y0 + 50; yy--) if (white(yy)) { y1 = yy; break; } }
        const part = document.createElement('canvas'); part.width = cv.width; part.height = y1 - y0;
        part.getContext('2d').drawImage(cv, 0, y0, cv.width, y1 - y0, 0, 0, cv.width, y1 - y0);
        const img = await doc.embedJpg(await U.canvasBytes(part, 'image/jpeg', 0.9));
        const page = doc.addPage([PW, PH]);
        const wpt = cw, hpt = (y1 - y0) * cw / cv.width;
        page.drawImage(img, { x: M, y: PH - M - hpt, width: wpt, height: hpt });
        y0 = y1; n++;
      }
      if (!n) doc.addPage([PW, PH]);
      U.pdf.finish(doc);
      return { bytes: await U.pdf.save(doc), lost: 0, pages: doc.getPageCount(), rasterised: true };
    } finally { holder.remove(); }
  }

  U.htmlToPdf = async (html, o) => {
    o = Object.assign({ page: 'a4', margin: 54, fontSize: 11, family: 'Helvetica', numbers: false, mode: 'auto' }, o);
    let useRaster = o.mode === 'image';
    if (o.mode === 'auto') useRaster = await needsUnicode(html);
    return useRaster ? raster(html, o) : vector(html, o);
  };
  U.escapeHtml = (s) => s.replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]));
})();
