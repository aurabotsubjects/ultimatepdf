/* PDF editor: fill forms, text, signatures, shapes, highlights, whiteout, redaction */
(function () {
  const h = U.h, L = PDFLib;

  const FONT_CSS = { Helvetica: 'Helvetica, Arial, sans-serif', Times: "'Times New Roman', Times, serif", Courier: "'Courier New', Courier, monospace" };
  const BASE = { Helvetica: 0.9465, Times: 0.9375, Courier: 0.8665 };
  const STD = {
    Helvetica: ['Helvetica', 'HelveticaBold', 'HelveticaOblique', 'HelveticaBoldOblique'],
    Times: ['TimesRoman', 'TimesRomanBold', 'TimesRomanItalic', 'TimesRomanBoldItalic'],
    Courier: ['Courier', 'CourierBold', 'CourierOblique', 'CourierBoldOblique'],
  };
  const TOOLS = [
    ['select', '➤', 'Select', 'Click an object to move or resize it. Double-click text to edit. Fill form fields directly.'],
    ['edittext', '🅰', 'Edit text', 'Click any existing text on the page to replace it.'],
    ['text', 'T', 'Text', 'Click on the page and start typing.'],
    ['|'],
    ['sign', '✍️', 'Signature', 'Create or pick a signature, then click where it should go.'],
    ['initials', 'AB', 'Initials', 'Create or pick initials, then click where they should go.'],
    ['date', '📅', 'Date', 'Click to stamp today’s date.'],
    ['image', '🖼', 'Image', 'Choose an image, then click where it should go.'],
    ['|'],
    ['check', '✓', 'Tick', 'Click to place a tick mark.'],
    ['cross', '✗', 'Cross', 'Click to place a cross.'],
    ['|'],
    ['draw', '✎', 'Draw', 'Draw freehand with the mouse, finger or pen.'],
    ['highlight', '🖍', 'Highlight', 'Drag over text to highlight it.'],
    ['rect', '▭', 'Box', 'Drag to draw a rectangle.'],
    ['ellipse', '◯', 'Oval', 'Drag to draw an oval.'],
    ['line', '╱', 'Line', 'Drag to draw a line (hold Shift for straight angles).'],
    ['arrow', '➜', 'Arrow', 'Drag to draw an arrow.'],
    ['|'],
    ['whiteout', '▯', 'Cover', 'Drag to hide something with a coloured box. (Cosmetic only — the hidden text remains in the file. Use Redact to remove it.)'],
    ['redact', '■', 'Redact', 'Drag over sensitive content. On download, those pages are permanently flattened so the content is truly gone.'],
  ];
  const DRAG_TOOLS = new Set(['draw', 'highlight', 'rect', 'ellipse', 'line', 'arrow', 'whiteout', 'redact']);
  const KIND = { text: 'text', date: 'text', edittext: 'text', rect: 'shape', ellipse: 'shape', line: 'line', arrow: 'line', draw: 'line', check: 'line', cross: 'line', highlight: 'hl', whiteout: 'whiteout' };

  U.register({
    id: 'editor', group: 'Edit', icon: '✏️', title: 'Edit & fill PDF', desc: 'Fill forms, add text, shapes, images & signatures', wide: true,
    render(root) {
      const S = {
        name: '', bytes: null, pdf: null, libForm: false, pages: [], zoom: 1, tool: 'select', objs: [], sel: null, uid: 0,
        assets: new Map(), undo: [], redo: [], fields: [], fieldVals: new Map(), dirty: false, editing: null, placing: null,
        vis: new Set(), pendingIntent: null, hlFields: true,
        D: { text: { font: 'Helvetica', size: 14, color: '#000000', b: false, i: false }, shape: { stroke: '#e5322d', fill: '', sw: 2 }, line: { color: '#e5322d', sw: 2.5 }, hl: { color: '#ffe033' }, whiteout: { color: '#ffffff' } },
      };
      const els = new Map();
      const ui = {};
      const clone = (x) => JSON.parse(JSON.stringify(x));
      const byId = (id) => S.objs.find((o) => o.id === id);

      // ============ empty state ============
      const empty = h('div', { style: { maxWidth: '640px', margin: '0 auto', padding: '40px 20px' } },
        h('h1', null, 'Edit, fill & sign PDFs'),
        h('p', { class: 'sub' }, 'Fill in forms, type on any page, add your signature, draw, highlight, white-out or redact — then download. Nothing is uploaded.'),
        U.dropzone({ accept: '.pdf,application/pdf', icon: '✏️', title: 'Drop a PDF here or click to choose', onFiles: async ([f]) => open(await U.readBytes(f), f.name) }),
        h('div', { class: 'hint', id: 'edLast' }));
      const main = h('div', { class: 'ed', hidden: true });
      root.append(empty, main);

      // ============ toolbar ============
      const toolRow = h('div', { class: 'ed-tools' });
      const propsRow = h('div', { class: 'ed-props' });
      const scroll = h('div', { class: 'ed-scroll' });
      const pagesBox = h('div', { class: 'ed-pages' });
      scroll.append(pagesBox);
      const btnUndo = h('button', { class: 'tb', title: 'Undo (Ctrl/⌘+Z)', onclick: () => undo() }, '↶');
      const btnRedo = h('button', { class: 'tb', title: 'Redo (Ctrl/⌘+Shift+Z)', onclick: () => redo() }, '↷');
      const pageIn = h('input', { type: 'number', min: 1, value: 1, onchange: () => goPage(+pageIn.value - 1) });
      const pageTot = h('span');
      const zoomLbl = h('span', null, '100%');
      const flatChk = h('input', { type: 'checkbox' });
      const hlChk = h('input', { type: 'checkbox', checked: true, onchange: () => { S.hlFields = hlChk.checked; main.classList.toggle('nofldhl', !S.hlFields); } });
      const fileLbl = h('span', { class: 'muted small', style: { maxWidth: '200px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' } });
      const toolBtns = {};
      TOOLS.forEach((t) => {
        if (t[0] === '|') return toolRow.append(h('span', { class: 'sep' }));
        const b = h('button', { class: 'tb', title: t[3], onclick: () => chooseTool(t[0]) }, h('span', null, t[1]), t[2]);
        toolBtns[t[0]] = b; toolRow.append(b);
      });
      toolRow.append(h('span', { class: 'sep' }), btnUndo, btnRedo, h('span', { class: 'sep' }),
        h('button', { class: 'tb', onclick: () => setZoom(S.zoom / 1.2), title: 'Zoom out' }, '−'), zoomLbl,
        h('button', { class: 'tb', onclick: () => setZoom(S.zoom * 1.2), title: 'Zoom in' }, '+'),
        h('button', { class: 'tb', onclick: () => fitWidth(), title: 'Fit to width' }, '⤢'),
        h('div', { class: 'ed-status' }, fileLbl, h('span', null, 'Page ', pageIn, ' / ', pageTot),
          h('label', { class: 'chk small', title: 'Highlight fillable fields' }, hlChk, 'Fields'),
          h('label', { class: 'chk small', title: 'Make form values permanent' }, flatChk, 'Flatten'),
          h('button', { class: 'btn sm', onclick: () => closeDoc() }, 'Close'),
          h('button', { class: 'btn pri sm', onclick: () => download() }, '⬇ Download PDF')));
      main.append(h('div', { class: 'ed-top' }, toolRow, propsRow), scroll);

      // ============ document loading ============
      async function open(bytes, name) {
        U.busy('Opening PDF…');
        try {
          if (S.pdf) { try { S.pdf.destroy(); } catch (_) { } }
          S.bytes = bytes; S.name = name || 'document.pdf';
          S.pdf = await U.pdfjsLoad(bytes);
          S.objs = []; S.sel = null; S.undo = []; S.redo = []; S.fieldVals = new Map(); S.fields = []; S.dirty = false; els.clear(); S.vis.clear();
          // detect form fields via pdf-lib
          try { await detectFields(); } catch (e) { console.warn('form detect failed', e); S.fields = []; }
          pagesBox.replaceChildren(); S.pages = [];
          for (let i = 1; i <= S.pdf.numPages; i++) {
            const proxy = await S.pdf.getPage(i), vp = proxy.getViewport({ scale: 1 });
            S.pages.push({ proxy, vw: vp.width, vh: vp.height, rendered: false, token: 0 });
          }
          S.pages.forEach((pg, i) => buildPage(pg, i));
          empty.hidden = true; main.hidden = false;
          fileLbl.textContent = S.name; pageTot.textContent = S.pdf.numPages; pageIn.max = S.pdf.numPages; pageIn.value = 1;
          chooseTool('select');
          fitWidth(true);
          U.busyEnd();
          if (S.fields.length) U.toast('This PDF has ' + S.fields.length + ' fillable field(s) — click one and type.', 'ok');
          if (S.pendingIntent) { const it = S.pendingIntent; S.pendingIntent = null; api.intent(it); }
        } catch (e) { U.error(e, 'Could not open PDF'); }
      }

      async function detectFields() {
        const doc = await U.pdf.load(S.bytes);
        const form = doc.getForm(), fields = form.getFields();
        if (!fields.length) return;
        // map widget ref -> page index
        const refToPage = new Map();
        doc.getPages().forEach((pg, pi) => { const an = pg.node.Annots(); if (an) for (let k = 0; k < an.size(); k++) { const r = an.get(k); if (r instanceof L.PDFRef) refToPage.set(r.toString(), pi); } });
        const pages = doc.getPages();
        for (const f of fields) {
          let kind = null;
          if (f instanceof L.PDFTextField) kind = 'text';
          else if (f instanceof L.PDFCheckBox) kind = 'check';
          else if (f instanceof L.PDFRadioGroup) kind = 'radio';
          else if (f instanceof L.PDFDropdown) kind = 'dropdown';
          else if (f instanceof L.PDFOptionList) kind = 'list';
          else if (f instanceof L.PDFSignature) kind = 'sig';
          if (!kind) continue;
          const name = f.getName();
          let value, options = [], multiline = false, maxLen, ro = false;
          try { ro = f.isReadOnly(); } catch (_) { }
          if (kind === 'text') { value = f.getText() || ''; multiline = f.isMultiline(); maxLen = f.getMaxLength(); }
          else if (kind === 'check') value = f.isChecked();
          else if (kind === 'radio') { value = f.getSelected() || ''; options = f.getOptions(); }
          else if (kind === 'dropdown') { value = (f.getSelected() || [])[0] || ''; options = f.getOptions(); }
          else if (kind === 'list') { value = f.getSelected() || []; options = f.getOptions(); }
          const widgets = f.acroField.getWidgets();
          widgets.forEach((w, wi) => {
            try {
              const ref = doc.context.getObjectRef(w.dict);
              let pi = ref ? refToPage.get(ref.toString()) : undefined;
              if (pi === undefined) { const P = w.P(); if (P) pi = pages.findIndex((p) => p.ref === P); }
              if (pi === undefined || pi < 0) return;
              const r = w.getRectangle(), bx = U.pdf.box(pages[pi]);
              const c = [U.pdf.pdfToVis(bx, r.x, r.y), U.pdf.pdfToVis(bx, r.x + r.width, r.y + r.height)];
              const x0 = Math.min(c[0][0], c[1][0]), x1 = Math.max(c[0][0], c[1][0]), y0 = Math.min(c[0][1], c[1][1]), y1 = Math.max(c[0][1], c[1][1]);
              let on = null; if (kind === 'radio') { try { on = w.getOnValue() && w.getOnValue().decodeText(); } catch (_) { } if (!options.includes(on)) on = options[+on] !== undefined ? options[+on] : options[wi]; }
              let fs = 0; try { const da = f.acroField.getDefaultAppearance() || ''; const m = /([\d.]+)\s+Tf/.exec(da); if (m) fs = +m[1]; } catch (_) { }
              S.fields.push({ page: pi, name, kind, value, options, multiline, maxLen, ro, on, fs, x: x0, y: bx.vh - y1, w: x1 - x0, h: y1 - y0, vw: bx.vw, vh: bx.vh });
            } catch (e) { console.warn('widget skipped', e); }
          });
          if (kind === 'text' || kind === 'dropdown' || kind === 'radio' || kind === 'list' || kind === 'check') S.fieldVals.set(name, value);
        }
        S.fieldInit = new Map(S.fieldVals);
      }

      // ============ page DOM ============
      const io = new IntersectionObserver((ents) => {
        ents.forEach((en) => {
          const i = +en.target.dataset.i;
          if (en.isIntersecting) { S.vis.add(i); renderCanvas(i); }
          else { S.vis.delete(i); releaseCanvas(i); }
        });
      }, { root: scroll, rootMargin: '900px 0px' });

      function buildPage(pg, i) {
        const el = h('div', { class: 'epage', 'data-i': i });
        const cv = h('canvas', { class: 'pc' });
        const ov = h('div', { class: 'ov' });
        el.append(cv, ov);
        pg.el = el; pg.cv = cv; pg.ov = ov;
        ov.addEventListener('pointerdown', (e) => onOvDown(e, i));
        // form fields
        S.fields.filter((f) => f.page === i).forEach((f) => ov.append(buildField(f)));
        pagesBox.append(el);
        io.observe(el);
      }
      function sizePage(pg) {
        pg.el.style.width = pg.vw * S.zoom + 'px'; pg.el.style.height = pg.vh * S.zoom + 'px'; pg.el.style.setProperty('--z', S.zoom);
      }
      async function renderCanvas(i, force) {
        const pg = S.pages[i];
        if (!pg || (pg.rendered && !force)) return;
        const token = ++pg.token; pg.rendered = true;
        const dpr = Math.min(2, window.devicePixelRatio || 1), scale = S.zoom * dpr;
        try {
          const vp = pg.proxy.getViewport({ scale });
          const cv = document.createElement('canvas'); cv.width = Math.ceil(vp.width); cv.height = Math.ceil(vp.height); cv.className = 'pc';
          const ctx = cv.getContext('2d', { willReadFrequently: true });
          ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, cv.width, cv.height);
          if (pg.task) { try { pg.task.cancel(); } catch (_) { } }
          pg.task = pg.proxy.render({ canvasContext: ctx, viewport: vp, annotationMode: S.fields.length ? pdfjsLib.AnnotationMode.ENABLE_FORMS : pdfjsLib.AnnotationMode.ENABLE });
          await pg.task.promise;
          if (token !== pg.token) return;
          pg.cv.replaceWith(cv); pg.cv = cv; pg.dpr = dpr;
          if (S.tool === 'edittext') showTextBoxes(i);
        } catch (e) { if (e && e.name !== 'RenderingCancelledException') console.warn(e); pg.rendered = false; }
      }
      function releaseCanvas(i) {
        const pg = S.pages[i]; if (!pg || !pg.rendered) return;
        pg.token++; pg.rendered = false;
        if (pg.task) { try { pg.task.cancel(); } catch (_) { } }
        const c = h('canvas', { class: 'pc' }); pg.cv.replaceWith(c); pg.cv = c;
      }

      // ---- form fields ----
      function buildField(f) {
        const st = { left: f.x / f.vw * 100 + '%', top: f.y / f.vh * 100 + '%', width: f.w / f.vw * 100 + '%', height: f.h / f.vh * 100 + '%' };
        const fsz = f.fs > 0 ? Math.min(f.fs, f.multiline ? 24 : f.h * 0.78) : Math.max(7, Math.min(14, f.h * 0.62));
        st.fontSize = 'calc(var(--z) * ' + fsz + 'px)';
        let el;
        const sync = (v) => { S.fieldVals.set(f.name, v); S.dirty = true; };
        if (f.kind === 'text') {
          el = f.multiline ? h('textarea', { class: 'fld' }) : h('input', { class: 'fld', type: 'text' });
          el.value = S.fieldVals.get(f.name) || '';
          if (f.maxLen) el.maxLength = f.maxLen;
          el.addEventListener('input', () => { sync(el.value); document.querySelectorAll('.fld[data-fn="' + CSS.escape(f.name) + '"]').forEach((o) => { if (o !== el) o.value = el.value; }); });
          if (f.multiline) st.paddingTop = '2px';
        } else if (f.kind === 'check') {
          el = h('input', { class: 'fld cb', type: 'checkbox' }); el.checked = !!S.fieldVals.get(f.name);
          el.addEventListener('change', () => sync(el.checked));
        } else if (f.kind === 'radio') {
          el = h('input', { class: 'fld cb', type: 'radio', name: 'rg_' + f.name + '_' + f.page }); el.checked = S.fieldVals.get(f.name) === f.on;
          el.addEventListener('change', () => { if (el.checked) sync(f.on); });
        } else if (f.kind === 'dropdown' || f.kind === 'list') {
          el = h('select', { class: 'fld', multiple: f.kind === 'list' }, f.kind === 'dropdown' ? h('option', { value: '' }, '') : null, f.options.map((o) => h('option', { value: o }, o)));
          const v = S.fieldVals.get(f.name);
          if (f.kind === 'list') [...el.options].forEach((o) => { o.selected = (v || []).includes(o.value); }); else el.value = v || '';
          el.addEventListener('change', () => sync(f.kind === 'list' ? [...el.selectedOptions].map((o) => o.value) : el.value));
        } else {
          el = h('div', { class: 'fld sigf', title: 'Click to sign' }); el.textContent = '';
          el.addEventListener('click', async () => {
            const url = await U.signature.get('signature'); if (!url) return;
            const a = await addAsset(url);
            before(); const pad = 2, r = Math.min((f.w - pad * 2) / a.w, (f.h - pad * 2) / a.h);
            addObj({ type: 'image', page: f.page, asset: a.id, x: f.x + (f.w - a.w * r) / 2, y: f.y + (f.h - a.h * r) / 2, w: a.w * r, h: a.h * r });
          });
        }
        el.dataset.fn = f.name;
        Object.assign(el.style, st);
        if (f.ro) el.disabled = true;
        el.addEventListener('pointerdown', (e) => e.stopPropagation());
        return el;
      }

      // ============ zoom / navigation ============
      function setZoom(z, keep) {
        z = Math.max(0.3, Math.min(4, z));
        const ratio = scroll.scrollHeight ? scroll.scrollTop / scroll.scrollHeight : 0;
        S.zoom = z; zoomLbl.textContent = Math.round(z * 100) + '%';
        S.pages.forEach((pg) => sizePage(pg));
        S.objs.forEach(renderObj);
        S.pages.forEach((pg, i) => { if (S.vis.has(i)) renderCanvas(i, true); else pg.rendered = false; });
        if (!keep) scroll.scrollTop = ratio * scroll.scrollHeight;
      }
      function fitWidth(first) {
        if (!S.pages.length) return;
        const maxW = Math.max(...S.pages.map((p) => p.vw));
        const avail = (scroll.clientWidth || main.clientWidth || 900) - 44;
        setZoom(Math.min(1.6, Math.max(0.3, avail / maxW)), first);
      }
      function goPage(i) { i = Math.max(0, Math.min(S.pages.length - 1, i | 0)); S.pages[i].el.scrollIntoView({ block: 'start' }); }
      let raf = 0;
      scroll.addEventListener('scroll', () => {
        if (raf) return; raf = requestAnimationFrame(() => {
          raf = 0; const mid = scroll.getBoundingClientRect().top + scroll.clientHeight / 3;
          for (let i = 0; i < S.pages.length; i++) { const r = S.pages[i].el.getBoundingClientRect(); if (r.bottom > mid) { if (document.activeElement !== pageIn) pageIn.value = i + 1; break; } }
        });
      });

      // ============ tools ============
      function chooseTool(t) {
        finishEdit();
        if (t === 'sign' || t === 'initials') { startPlace(t === 'sign' ? 'signature' : 'initials'); return; }
        if (t === 'image') { pickImage(); return; }
        S.tool = t; S.placing = null;
        applyToolUI();
      }
      function applyToolUI() {
        Object.entries(toolBtns).forEach(([k, b]) => b.classList.toggle('on', k === S.tool));
        main.classList.toggle('ed-select', S.tool === 'select'); main.classList.toggle('ed-text', S.tool === 'text');
        S.pages.forEach((pg, i) => { pg.ov.classList.toggle('cross', S.tool !== 'select'); pg.ov.style.cursor = S.tool === 'text' || S.tool === 'edittext' ? 'text' : S.tool === 'select' ? 'default' : 'crosshair'; pg.ov.style.touchAction = DRAG_TOOLS.has(S.tool) ? 'none' : ''; clearTextBoxes(i); if (S.tool === 'edittext') showTextBoxes(i); });
        main.classList.toggle('ed-placing', !!S.placing);
        renderProps();
      }
      async function startPlace(kind) {
        const url = await U.signature.get(kind);
        if (!url) return;
        const a = await addAsset(url);
        S.placing = { asset: a, width: kind === 'initials' ? 70 : 170 };
        S.tool = 'place'; applyToolUI();
        propsRow.replaceChildren('Click on the page where the ' + kind + ' should go.');
      }
      function pickImage() {
        const inp = h('input', { type: 'file', accept: 'image/*', onchange: async () => {
          const f = inp.files[0]; if (!f) return;
          const bmp = await createImageBitmap(f, { imageOrientation: 'from-image' });
          const s = Math.min(1, 1800 / Math.max(bmp.width, bmp.height));
          const cv = document.createElement('canvas'); cv.width = Math.round(bmp.width * s); cv.height = Math.round(bmp.height * s);
          cv.getContext('2d').drawImage(bmp, 0, 0, cv.width, cv.height);
          const url = cv.toDataURL(/jpe?g/.test(f.type) ? 'image/jpeg' : 'image/png', 0.92);
          const a = await addAsset(url);
          S.placing = { asset: a, width: Math.min(260, a.w) }; S.tool = 'place'; applyToolUI();
          propsRow.replaceChildren('Click on the page where the image should go.');
        } });
        inp.click();
      }
      async function addAsset(url) {
        const img = new Image(); img.src = url; await img.decode();
        const id = 'a' + (++S.uid);
        const a = { id, url, w: img.naturalWidth, h: img.naturalHeight, type: url.startsWith('data:image/jpeg') ? 'jpeg' : 'png' };
        S.assets.set(id, a); return a;
      }

      // ============ objects ============
      const snapshot = () => JSON.stringify(S.objs);
      let pendingSnap = null;
      function before() { pendingSnap = snapshot(); commitUndo(pendingSnap); }
      function commitUndo(snap) { S.undo.push(snap); if (S.undo.length > 120) S.undo.shift(); S.redo = []; S.dirty = true; updUndo(); }
      function updUndo() { btnUndo.disabled = !S.undo.length; btnRedo.disabled = !S.redo.length; }
      function restore(snap) {
        finishEdit(true);
        S.objs = JSON.parse(snap);
        els.forEach((e) => e.remove()); els.clear();
        if (!S.objs.find((o) => o.id === S.sel)) S.sel = null;
        S.objs.forEach(renderObj); renderProps(); updUndo();
      }
      function undo() { if (!S.undo.length) return; S.redo.push(snapshot()); restore(S.undo.pop()); }
      function redo() { if (!S.redo.length) return; S.undo.push(snapshot()); restore(S.redo.pop()); }
      function addObj(o, noSelect) {
        o.id = ++S.uid; S.objs.push(o); renderObj(o);
        if (!noSelect) select(o.id);
        S.dirty = true; return o;
      }
      function select(id) {
        if (S.editing && S.editing !== id) finishEdit();
        const prev = S.sel; S.sel = id;
        if (prev && els.get(prev)) els.get(prev).classList.remove('sel');
        if (id && els.get(id)) els.get(id).classList.add('sel');
        renderProps();
      }
      function removeObj(id) {
        const i = S.objs.findIndex((o) => o.id === id); if (i < 0) return;
        S.objs.splice(i, 1); const e = els.get(id); if (e) e.remove(); els.delete(id);
        if (S.sel === id) S.sel = null; S.dirty = true; renderProps();
      }
      const pts = (o) => o.strokes && [].concat(...o.strokes);
      function fitBox(o) {
        const p = pts(o); if (!p || !p.length) return;
        let x0 = 1e9, y0 = 1e9, x1 = -1e9, y1 = -1e9;
        p.forEach(([x, y]) => { x0 = Math.min(x0, x); y0 = Math.min(y0, y); x1 = Math.max(x1, x); y1 = Math.max(y1, y); });
        const pad = (o.sw || 2) / 2 + 3;
        o.x = x0 - pad; o.y = y0 - pad; o.w = x1 - x0 + 2 * pad; o.h = y1 - y0 + 2 * pad;
      }
      const rgba = (hex, a) => { const n = parseInt((hex || '#000000').slice(1), 16); return 'rgba(' + ((n >> 16) & 255) + ',' + ((n >> 8) & 255) + ',' + (n & 255) + ',' + a + ')'; };

      function ensureEl(o) {
        let el = els.get(o.id);
        if (el) return el;
        el = h('div', { class: 'obj t-' + o.type, 'data-id': o.id });
        el.append(h('div', { class: 'c' }));
        ['nw', 'ne', 'sw', 'se'].forEach((k) => el.append(h('div', { class: 'h ' + k, 'data-h': k })));
        els.set(o.id, el);
        el.addEventListener('pointerdown', (e) => {
          const o2 = byId(o.id); if (!o2) return;
          if (S.tool === 'text' && o2.type === 'text') { e.stopPropagation(); select(o2.id); if (S.editing !== o2.id) { e.preventDefault(); startEdit(o2); } return; }
          if (S.tool !== 'select') return;
          if (S.editing === o2.id) { e.stopPropagation(); return; }
          e.stopPropagation(); e.preventDefault();
          select(o2.id); startDrag(o2, e, e.target.dataset.h || null);
        });
        el.addEventListener('dblclick', () => { const o2 = byId(o.id); if (o2 && o2.type === 'text' && S.tool === 'select') startEdit(o2); });
        return el;
      }
      function renderObj(o) {
        const pg = S.pages[o.page]; if (!pg) return;
        const z = S.zoom, el = ensureEl(o), c = el.firstChild, st = el.style;
        if (el.parentNode !== pg.ov) pg.ov.append(el);
        el.classList.toggle('sel', S.sel === o.id);
        st.left = o.x * z + 'px'; st.top = o.y * z + 'px';
        if (o.type === 'text') {
          st.width = st.height = '';
          if (S.editing !== o.id) { if (c.textContent !== o.text) c.textContent = o.text; }
          c.className = 'txt';
          Object.assign(c.style, { fontFamily: FONT_CSS[o.font], fontSize: o.size * z + 'px', fontWeight: o.b ? 700 : 400, fontStyle: o.i ? 'italic' : 'normal', color: o.color });
          o.w = c.offsetWidth / z; o.h = c.offsetHeight / z;
          return;
        }
        st.width = o.w * z + 'px'; st.height = o.h * z + 'px';
        if (o.type === 'image') {
          const a = S.assets.get(o.asset); c.className = 'c'; c.style.cssText = 'width:100%;height:100%';
          if (!c.firstChild || c.firstChild.nodeName !== 'IMG') c.replaceChildren(h('img', { src: a.url, draggable: false }));
        } else if (o.type === 'rect' || o.type === 'ellipse' || o.type === 'highlight' || o.type === 'whiteout' || o.type === 'redact') {
          c.className = 'c'; c.replaceChildren();
          const s = c.style; s.cssText = 'width:100%;height:100%;box-sizing:border-box';
          if (o.type === 'rect' || o.type === 'ellipse') { s.border = o.sw * z + 'px solid ' + o.stroke; s.background = o.fill || 'transparent'; if (o.type === 'ellipse') s.borderRadius = '50%'; }
          else if (o.type === 'highlight') { s.background = rgba(o.color, 0.42); s.mixBlendMode = 'multiply'; }
          else if (o.type === 'whiteout') s.background = o.color;
          else { s.background = '#000'; s.outline = '1px dashed rgba(255,255,255,.6)'; s.outlineOffset = '-3px'; }
        } else if (o.strokes) {
          c.className = 'c'; c.style.cssText = 'width:100%;height:100%';
          const NS = 'http://www.w3.org/2000/svg', svg = document.createElementNS(NS, 'svg');
          svg.setAttribute('viewBox', '0 0 ' + o.w * z + ' ' + o.h * z); svg.setAttribute('preserveAspectRatio', 'none');
          const P = (p) => [(p[0] - o.x) * z, (p[1] - o.y) * z];
          const mk = (d) => { const e = document.createElementNS(NS, 'path'); e.setAttribute('d', d); e.setAttribute('fill', 'none'); e.setAttribute('stroke', o.color); e.setAttribute('stroke-width', o.sw * z); e.setAttribute('stroke-linecap', 'round'); e.setAttribute('stroke-linejoin', 'round'); svg.append(e); };
          o.strokes.forEach((s) => { if (!s.length) return; mk(s.map((p, i) => (i ? 'L' : 'M') + P(p).join(' ')).join(' ')); });
          if (o.type === 'arrow') { const hd = arrowHead(o.strokes[0], o.sw); if (hd) hd.forEach((s) => mk('M' + P(s[0]).join(' ') + 'L' + P(s[1]).join(' '))); }
          c.replaceChildren(svg);
        }
      }
      function arrowHead(s, sw) {
        const a = s[0], b = s[s.length - 1], dx = b[0] - a[0], dy = b[1] - a[1], len = Math.hypot(dx, dy); if (len < 1) return null;
        const ux = dx / len, uy = dy / len, hl = Math.min(len * 0.5, 9 + sw * 2.5), ang = 0.45;
        const r = (t) => [b[0] - hl * (ux * Math.cos(t) - uy * Math.sin(t)), b[1] - hl * (ux * Math.sin(t) + uy * Math.cos(t))];
        return [[b, r(ang)], [b, r(-ang)]];
      }

      // ---- moving / resizing ----
      function startDrag(o, e, handle) {
        const page = o.page, start = pt(e, page), orig = clone(o), snap = snapshot();
        let moved = false;
        const move = (ev) => {
          const p = pt(ev, page), dx = p.x - start.x, dy = p.y - start.y;
          if (!moved) { if (Math.hypot(dx, dy) < 2) return; moved = true; commitUndo(snap); }
          if (!handle) {
            if (o.strokes) { o.strokes = orig.strokes.map((s) => s.map((q) => [q[0] + dx, q[1] + dy])); fitBox(o); }
            else { o.x = orig.x + dx; o.y = orig.y + dy; }
          } else {
            let x0 = orig.x, y0 = orig.y, x1 = orig.x + orig.w, y1 = orig.y + orig.h;
            if (handle.includes('w')) x0 += dx; else x1 += dx;
            if (handle.includes('n')) y0 += dy; else y1 += dy;
            if (o.type === 'image' || o.type === 'text' || ev.shiftKey) {
              const ar = orig.w / orig.h; let nw = Math.abs(x1 - x0), nh = nw / ar;
              if (handle.includes('n')) y0 = y1 - nh; else y1 = y0 + nh;
              if (handle.includes('w')) x0 = x1 - nw;
            }
            if (x1 - x0 < 6) { if (handle.includes('w')) x0 = x1 - 6; else x1 = x0 + 6; }
            if (y1 - y0 < 6 && o.type !== 'text') { if (handle.includes('n')) y0 = y1 - 6; else y1 = y0 + 6; }
            if (o.type === 'text') { o.size = Math.max(5, orig.size * (x1 - x0) / orig.w); o.x = x0; o.y = y0; }
            else if (o.strokes) { const sx = (x1 - x0) / orig.w, sy = (y1 - y0) / orig.h; o.strokes = orig.strokes.map((s) => s.map((q) => [x0 + (q[0] - orig.x) * sx, y0 + (q[1] - orig.y) * sy])); fitBox(o); }
            else { o.x = x0; o.y = y0; o.w = x1 - x0; o.h = y1 - y0; }
          }
          renderObj(o);
        };
        const up = () => { window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', up); };
        window.addEventListener('pointermove', move); window.addEventListener('pointerup', up);
      }

      // ---- text editing ----
      function startEdit(o, selectAll) {
        if (S.editing === o.id) return;
        finishEdit();
        const el = ensureEl(o), c = el.firstChild;
        S.editing = o.id; S.editSnap = snapshot(); S.editOrig = o.text;
        try { c.contentEditable = 'plaintext-only'; } catch (_) { }
        if (c.contentEditable !== 'plaintext-only') c.contentEditable = 'true';
        c.spellcheck = false;
        c.focus();
        const sel = window.getSelection(), r = document.createRange(); r.selectNodeContents(c); if (!selectAll) r.collapse(false); sel.removeAllRanges(); sel.addRange(r);
        const blur = () => { c.removeEventListener('blur', blur); finishEdit(); };
        c.addEventListener('blur', blur);
        c.addEventListener('input', () => { o.w = c.offsetWidth / S.zoom; o.h = c.offsetHeight / S.zoom; });
        c.addEventListener('keydown', (ev) => { if (ev.key === 'Escape') { ev.preventDefault(); c.blur(); } ev.stopPropagation(); });
        el.classList.add('sel');
      }
      function finishEdit(silent) {
        if (!S.editing) return;
        const id = S.editing; S.editing = null;
        const o = byId(id), el = els.get(id); if (!o || !el) return;
        const c = el.firstChild; c.contentEditable = 'false'; window.getSelection().removeAllRanges();
        const txt = c.innerText.replace(/\n$/, '').replace(/ /g, ' ');
        if (!txt.trim()) { removeObj(id); if (S.undo.length && S.newTextSnap === S.undo[S.undo.length - 1]) { S.undo.pop(); updUndo(); } return; }
        if (txt !== S.editOrig) { if (S.newTextSnap !== S.undo[S.undo.length - 1]) commitUndo(S.editSnap); o.text = txt; }
        S.newTextSnap = null;
        renderObj(o);
      }

      // ---- creation on page ----
      function pt(e, page) {
        const r = S.pages[page].el.getBoundingClientRect();
        return { x: (e.clientX - r.left) / S.zoom, y: (e.clientY - r.top) / S.zoom };
      }
      function onOvDown(e, i) {
        if (e.button !== 0) return;
        const tool = S.tool, p = pt(e, i);
        if (tool === 'select') { select(null); return; }
        if (tool === 'edittext') return;
        if (tool === 'place' && S.placing) {
          const a = S.placing.asset, w = S.placing.width, hh = w * a.h / a.w;
          before();
          addObj({ type: 'image', page: i, asset: a.id, x: p.x - w / 2, y: p.y - hh / 2, w, h: hh });
          S.placing = null; S.tool = 'select'; applyToolUI(); return;
        }
        if (tool === 'text' || tool === 'date') {
          e.preventDefault();
          const D = S.D.text; const snap = snapshot();
          const o = { type: 'text', page: i, x: p.x, y: p.y - D.size * 0.6, text: tool === 'date' ? new Date().toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' }) : '', font: D.font, size: D.size, color: D.color, b: D.b, i: D.i, w: 0, h: 0 };
          commitUndo(snap); S.newTextSnap = snap;
          addObj(o);
          if (tool === 'date') { S.newTextSnap = null; S.tool = 'select'; applyToolUI(); } else startEdit(o);
          return;
        }
        if (tool === 'check' || tool === 'cross') {
          before(); const D = S.D.line, s = 8;
          const strokes = tool === 'check' ? [[[p.x - s, p.y + 1], [p.x - s * 0.3, p.y + s * 0.8], [p.x + s, p.y - s * 0.9]]] : [[[p.x - s * 0.8, p.y - s * 0.8], [p.x + s * 0.8, p.y + s * 0.8]], [[p.x + s * 0.8, p.y - s * 0.8], [p.x - s * 0.8, p.y + s * 0.8]]];
          const o = { type: 'draw', page: i, strokes, color: D.color === '#e5322d' && false ? D.color : '#111111', sw: 2.4, x: 0, y: 0, w: 0, h: 0 }; fitBox(o); addObj(o);
          S.tool = 'select'; applyToolUI(); return;
        }
        if (!DRAG_TOOLS.has(tool)) return;
        e.preventDefault();
        const snap = snapshot(), ov = S.pages[i].ov;
        const D = S.D;
        let o;
        if (tool === 'rect' || tool === 'ellipse') o = { type: tool, page: i, x: p.x, y: p.y, w: 0, h: 0, stroke: D.shape.stroke, fill: D.shape.fill, sw: D.shape.sw };
        else if (tool === 'highlight') o = { type: 'highlight', page: i, x: p.x, y: p.y, w: 0, h: 0, color: D.hl.color };
        else if (tool === 'whiteout') o = { type: 'whiteout', page: i, x: p.x, y: p.y, w: 0, h: 0, color: D.whiteout.color };
        else if (tool === 'redact') o = { type: 'redact', page: i, x: p.x, y: p.y, w: 0, h: 0 };
        else o = { type: tool, page: i, strokes: [[[p.x, p.y], [p.x, p.y]]], color: D.line.color, sw: D.line.sw, x: 0, y: 0, w: 0, h: 0 };
        if (tool === 'draw') o.strokes = [[[p.x, p.y]]];
        if (o.strokes) fitBox(o);
        addObj(o, true);
        const move = (ev) => {
          const q = pt(ev, i);
          if (o.strokes) {
            if (tool === 'draw') { const s = o.strokes[0], l = s[s.length - 1]; if (Math.hypot(q[0] - l[0], q[1] - l[1]) < 1.2) { } else s.push([q.x, q.y]); }
            else {
              let qx = q.x, qy = q.y;
              if (ev.shiftKey) { const dx = qx - p.x, dy = qy - p.y, a = Math.round(Math.atan2(dy, dx) / (Math.PI / 4)) * (Math.PI / 4), L2 = Math.hypot(dx, dy); qx = p.x + L2 * Math.cos(a); qy = p.y + L2 * Math.sin(a); }
              o.strokes[0][1] = [qx, qy];
            }
            fitBox(o);
          } else { o.x = Math.min(p.x, q.x); o.y = Math.min(p.y, q.y); o.w = Math.abs(q.x - p.x); o.h = Math.abs(q.y - p.y); }
          renderObj(o);
        };
        const up = () => {
          window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', up);
          let keep = true;
          if (o.strokes) { if (tool === 'draw') { if (o.strokes[0].length === 1) o.strokes[0].push([o.strokes[0][0][0] + 0.01, o.strokes[0][0][1]]); fitBox(o); } else { const s = o.strokes[0]; keep = Math.hypot(s[1][0] - s[0][0], s[1][1] - s[0][1]) > 4; } }
          else keep = o.w > 4 && o.h > 4;
          if (!keep) { removeObj(o.id); return; }
          commitUndo(snap); renderObj(o);
          if (tool === 'rect' || tool === 'ellipse' || tool === 'line' || tool === 'arrow') { S.tool = 'select'; applyToolUI(); select(o.id); }
        };
        window.addEventListener('pointermove', move); window.addEventListener('pointerup', up);
      }

      // ---- edit existing text ----
      async function showTextBoxes(i) {
        const pg = S.pages[i]; if (!pg || !pg.el) return;
        clearTextBoxes(i);
        if (S.tool !== 'edittext') return;
        if (!pg.tc) pg.tc = await pg.proxy.getTextContent();
        if (S.tool !== 'edittext') return;
        const layer = h('div', { class: 'tl', style: { position: 'absolute', inset: 0 } }); pg.tl = layer;
        const vp = pg.proxy.getViewport({ scale: 1 });
        pg.tc.items.forEach((it) => {
          if (!it.str || !it.str.trim() || pg.used && pg.used.has(it)) return;
          const t = pdfjsLib.Util.transform(vp.transform, it.transform);
          if (Math.abs(t[1]) > 0.05 || Math.abs(t[2]) > 0.05 && Math.abs(t[0]) < 0.05) return; // skip rotated text
          const size = Math.hypot(t[2], t[3]), x = t[4], base = t[5], w = it.width, top = base - size * 0.92, hh = size * 1.18;
          const b = h('div', { class: 'tbox', style: { left: x * S.zoom + 'px', top: top * S.zoom + 'px', width: w * S.zoom + 'px', height: hh * S.zoom + 'px' } });
          b.dataset.k = 1;
          b.addEventListener('pointerdown', (e) => { e.stopPropagation(); e.preventDefault(); convertText(i, it, { x, base, size, w, top, hh }); b.remove(); });
          b._geo = { x, top, w, hh }; layer.append(b);
        });
        pg.ov.append(layer);
      }
      function clearTextBoxes(i) { const pg = S.pages[i]; if (pg && pg.tl) { pg.tl.remove(); pg.tl = null; } }
      function convertText(i, it, g) {
        const pg = S.pages[i];
        (pg.used = pg.used || new Set()).add(it);
        // sample background colour
        let bg = '#ffffff';
        try {
          const dpr = pg.dpr || 1, ctx = pg.cv.getContext('2d'); const sx = Math.max(0, Math.round((g.x - 2) * S.zoom * dpr)), sy = Math.round((g.top + g.hh / 2) * S.zoom * dpr);
          const d = ctx.getImageData(sx, sy, 1, 1).data; if (d[3] > 0) bg = '#' + [d[0], d[1], d[2]].map((v) => v.toString(16).padStart(2, '0')).join('');
        } catch (_) { }
        let nm = ''; try { const fo = pg.proxy.commonObjs.has(it.fontName) ? pg.proxy.commonObjs.get(it.fontName) : null; nm = (fo && fo.name) || ''; } catch (_) { }
        nm += ' ' + ((pg.tc.styles[it.fontName] || {}).fontFamily || '');
        const font = /courier|mono|consolas|menlo/i.test(nm) ? 'Courier' : (/times|serif|georgia|garamond|minion|palat|cambria|book/i.test(nm) && !/sans/i.test(nm)) ? 'Times' : 'Helvetica';
        const snap = snapshot(); commitUndo(snap);
        addObj({ type: 'whiteout', page: i, x: g.x - 1.5, y: g.top - 0.5, w: g.w + 3, h: g.hh + 1, color: bg }, true);
        const D = S.D.text;
        const o = addObj({ type: 'text', page: i, x: g.x, y: g.base - BASE[font] * g.size, text: it.str, font, size: Math.round(g.size * 10) / 10, color: '#000000', b: /bold|black|heavy|demi/i.test(nm), i: /italic|oblique/i.test(nm), w: 0, h: 0 });
        S.newTextSnap = null; S.tool = 'select'; applyToolUI(); select(o.id);
        startEdit(o, true);
      }

      // ============ properties bar ============
      function renderProps() {
        const o = S.sel ? byId(S.sel) : null;
        const tool = TOOLS.find((t) => t[0] === S.tool);
        let kind = o ? (o.type === 'text' ? 'text' : o.type === 'rect' || o.type === 'ellipse' ? 'shape' : o.strokes ? 'line' : o.type === 'highlight' ? 'hl' : o.type === 'whiteout' ? 'whiteout' : null) : KIND[S.tool];
        const kids = [];
        const set = (k, v) => {
          if (o) { if (S.propSnap !== S.sel + k) { before(); S.propSnap = S.sel + k; setTimeout(() => (S.propSnap = null), 600); } o[k] = v; if (o.type === 'text' || o.strokes) fitBox(o); renderObj(o); }
          S.D[kind][k] = v;
        };
        const cur = (k) => (o ? o[k] : S.D[kind][k]);
        const color = (lbl, k, none) => h('label', null, lbl, h('input', { type: 'color', value: cur(k) || '#ffffff', oninput: (e) => set(k, e.target.value) }), none ? h('label', { class: 'chk small' }, h('input', { type: 'checkbox', checked: !cur(k), onchange: (e) => { set(k, e.target.checked ? '' : '#ffffff'); renderProps(); } }), 'none') : null);
        const num = (lbl, k, min, max, step) => h('label', null, lbl, h('input', { type: 'number', min, max, step: step || 1, value: cur(k), oninput: (e) => { const v = parseFloat(e.target.value); if (v >= min && v <= max) set(k, v); } }));
        if (kind === 'text') {
          kids.push(h('label', null, 'Font', h('select', { onchange: (e) => set('font', e.target.value) }, Object.keys(FONT_CSS).map((f) => h('option', { value: f, selected: f === cur('font') }, f === 'Times' ? 'Times (serif)' : f === 'Courier' ? 'Courier (mono)' : 'Helvetica (sans)')))),
            num('Size', 'size', 4, 200, 1),
            h('button', { class: 'tb' + (cur('b') ? ' on' : ''), onclick: () => { set('b', !cur('b')); renderProps(); } }, h('b', null, 'B')),
            h('button', { class: 'tb' + (cur('i') ? ' on' : ''), onclick: () => { set('i', !cur('i')); renderProps(); } }, h('i', null, 'I')), color('Colour', 'color'));
        } else if (kind === 'shape') kids.push(color('Line', 'stroke'), color('Fill', 'fill', true), num('Width', 'sw', 0.5, 30, 0.5));
        else if (kind === 'line') kids.push(color('Colour', 'color'), num('Width', 'sw', 0.5, 30, 0.5));
        else if (kind === 'hl' || kind === 'whiteout') kids.push(color('Colour', 'color'));
        if (o) kids.push(h('span', { class: 'sep' }),
          h('button', { class: 'tb', title: 'Duplicate (Ctrl/⌘+D)', onclick: dup }, '⧉ Duplicate'),
          h('button', { class: 'tb', onclick: () => { before(); S.objs.push(S.objs.splice(S.objs.indexOf(o), 1)[0]); els.get(o.id) && els.get(o.id).parentNode.append(els.get(o.id)); } }, '⬆ Front'),
          h('button', { class: 'tb', onclick: del }, '🗑 Delete'));
        if (!o && tool && tool[3]) kids.unshift(h('span', { class: 'muted' }, tool[3]));
        propsRow.replaceChildren(...kids);
      }
      function del() { if (!S.sel) return; before(); removeObj(S.sel); }
      function dup() { const o = S.sel && byId(S.sel); if (!o) return; before(); const c = clone(o); delete c.id; if (c.strokes) c.strokes = c.strokes.map((s) => s.map((q) => [q[0] + 12, q[1] + 12])); c.x += 12; c.y += 12; addObj(c); }

      // ============ keyboard ============
      document.addEventListener('keydown', (e) => {
        if (main.hidden || !main.offsetParent) return;
        const t = e.target, typing = t && (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName));
        const mod = e.ctrlKey || e.metaKey;
        if (typing) return;
        if (mod && e.key.toLowerCase() === 'z') { e.preventDefault(); e.shiftKey ? redo() : undo(); }
        else if (mod && e.key.toLowerCase() === 'y') { e.preventDefault(); redo(); }
        else if (mod && e.key.toLowerCase() === 'd') { e.preventDefault(); dup(); }
        else if ((e.key === 'Delete' || e.key === 'Backspace') && S.sel) { e.preventDefault(); del(); }
        else if (e.key === 'Escape') { if (S.tool !== 'select') chooseTool('select'); else select(null); }
        else if (S.sel && e.key.startsWith('Arrow')) {
          e.preventDefault(); const o = byId(S.sel), d = e.shiftKey ? 10 : 1, dx = e.key === 'ArrowLeft' ? -d : e.key === 'ArrowRight' ? d : 0, dy = e.key === 'ArrowUp' ? -d : e.key === 'ArrowDown' ? d : 0;
          if (o.strokes) { o.strokes = o.strokes.map((s) => s.map((q) => [q[0] + dx, q[1] + dy])); fitBox(o); } else { o.x += dx; o.y += dy; } renderObj(o); S.dirty = true;
        } else if ((e.key === '+' || e.key === '=') && mod) { e.preventDefault(); setZoom(S.zoom * 1.2); }
        else if (e.key === '-' && mod) { e.preventDefault(); setZoom(S.zoom / 1.2); }
      });

      // ============ export ============
      const hexRgb = (hx) => U.pdf.hex(hx);
      function dataBytes(url) { const b = atob(url.split(',')[1]), u = new Uint8Array(b.length); for (let i = 0; i < b.length; i++) u[i] = b.charCodeAt(i); return u; }

      async function build(opts) {
        const doc = await U.pdf.load(S.bytes);
        const pages = doc.getPages(), warn = [];
        // form values
        if (S.fields.length) {
          const form = doc.getForm(), all = form.getFields();
          for (const [name, val] of S.fieldVals) {
            if (S.fieldInit && JSON.stringify(S.fieldInit.get(name)) === JSON.stringify(val)) continue;
            const f = all.find((x) => x.getName() === name); if (!f) continue;
            try {
              if (f instanceof L.PDFTextField) { f.setText(val || undefined); if (f.isMultiline()) { const m = /([\d.]+)\s+Tf/.exec(f.acroField.getDefaultAppearance() || ''); const sz = m ? +m[1] : 0; if (!sz || sz > 30) f.setFontSize(11); } }
              else if (f instanceof L.PDFCheckBox) val ? f.check() : f.uncheck();
              else if (f instanceof L.PDFRadioGroup) { if (val) f.select(val); }
              else if (f instanceof L.PDFDropdown) { if (val) f.select(val); else f.clear(); }
              else if (f instanceof L.PDFOptionList) { f.clear(); if (val && val.length) f.select(val); }
            } catch (e) { warn.push('Field "' + name + '": ' + e.message); }
          }
        }
        const fonts = {};
        const getFont = async (fam, b, i) => { const k = fam + b + i; return fonts[k] || (fonts[k] = await doc.embedFont(L.StandardFonts[STD[fam][(b ? 1 : 0) + (i ? 2 : 0)]])); };
        const redactPages = new Set();
        for (const o of S.objs) {
          const pg = pages[o.page], bx = U.pdf.box(pg), k = bx.vw / S.pages[o.page].vw;
          const V = (X, Y) => U.pdf.visToPdf(bx, X * k, bx.vh - Y * k);
          const rot = L.degrees(bx.rot);
          const rectAt = () => { const [x, y] = V(o.x, o.y + o.h); return { x, y, width: o.w * k, height: o.h * k, rotate: rot }; };
          if (o.type === 'text') {
            const font = await getFont(o.font, o.b, o.i), size = o.size * k, lines = o.text.split('\n');
            if (!U.pdf.canEncode(font, o.text)) { // render as image so any language works
              const cvs = document.createElement('canvas'), sc = 3; cvs.width = Math.ceil(o.w * sc) + 4; cvs.height = Math.ceil(o.h * sc) + 4;
              const c = cvs.getContext('2d'); c.fillStyle = o.color; c.textBaseline = 'alphabetic';
              c.font = (o.i ? 'italic ' : '') + (o.b ? 'bold ' : '') + o.size * sc + 'px ' + FONT_CSS[o.font];
              lines.forEach((ln, li) => c.fillText(ln, 0, (BASE[o.font] + li * 1.2) * o.size * sc));
              const img = await doc.embedPng(await U.canvasBytes(cvs, 'image/png'));
              const [x, y] = V(o.x, o.y + cvs.height / sc); pg.drawImage(img, { x, y, width: cvs.width / sc * k, height: cvs.height / sc * k, rotate: rot });
              continue;
            }
            lines.forEach((ln, li) => { if (!ln) return; const [x, y] = V(o.x, o.y + (BASE[o.font] + li * 1.2) * o.size); pg.drawText(ln, { x, y, size, font, color: hexRgb(o.color), rotate: rot }); });
          } else if (o.type === 'image') {
            const a = S.assets.get(o.asset), img = a.type === 'jpeg' ? await doc.embedJpg(dataBytes(a.url)) : await doc.embedPng(dataBytes(a.url));
            pg.drawImage(img, rectAt());
          } else if (o.type === 'rect') {
            pg.drawRectangle(Object.assign(rectAt(), { color: o.fill ? hexRgb(o.fill) : undefined, borderColor: hexRgb(o.stroke), borderWidth: o.sw * k }));
          } else if (o.type === 'ellipse') {
            const [x, y] = V(o.x + o.w / 2, o.y + o.h / 2);
            pg.drawEllipse({ x, y, xScale: o.w / 2 * k, yScale: o.h / 2 * k, rotate: rot, color: o.fill ? hexRgb(o.fill) : undefined, borderColor: hexRgb(o.stroke), borderWidth: o.sw * k });
          } else if (o.type === 'highlight') pg.drawRectangle(Object.assign(rectAt(), { color: hexRgb(o.color), opacity: 0.4, blendMode: L.BlendMode ? L.BlendMode.Multiply : undefined }));
          else if (o.type === 'whiteout') pg.drawRectangle(Object.assign(rectAt(), { color: hexRgb(o.color) }));
          else if (o.type === 'redact') { pg.drawRectangle(Object.assign(rectAt(), { color: L.rgb(0, 0, 0) })); redactPages.add(o.page); }
          else if (o.strokes) {
            const seg = (a, b) => { const [x1, y1] = V(a[0], a[1]), [x2, y2] = V(b[0], b[1]); pg.drawLine({ start: { x: x1, y: y1 }, end: { x: x2, y: y2 }, thickness: o.sw * k, color: hexRgb(o.color), lineCap: L.LineCapStyle ? L.LineCapStyle.Round : undefined }); };
            o.strokes.forEach((s) => { for (let q = 1; q < s.length; q++) seg(s[q - 1], s[q]); });
            if (o.type === 'arrow') { const hd = arrowHead(o.strokes[0], o.sw); if (hd) hd.forEach((s) => seg(s[0], s[1])); }
          }
        }
        if (redactPages.size) { try { doc.getForm().flatten(); } catch (_) { } }
        else if (opts.flatten) { try { doc.getForm().flatten(); } catch (e) { warn.push('Could not flatten: ' + e.message); } }
        U.pdf.finish(doc);
        let bytes = await U.pdf.save(doc, { updateFieldAppearances: true });
        if (redactPages.size) bytes = await rasterisePages(bytes, redactPages);
        return { bytes, warn, redacted: redactPages.size };
      }

      async function rasterisePages(bytes, set) {
        const pdf = await U.pdfjsLoad(bytes), src = await U.pdf.load(bytes), out = await L.PDFDocument.create();
        const keepIdx = [...Array(src.getPageCount()).keys()].filter((i) => !set.has(i));
        const copied = keepIdx.length ? await out.copyPages(src, keepIdx) : [];
        const cmap = new Map(keepIdx.map((v, i) => [v, copied[i]]));
        for (let i = 0; i < src.getPageCount(); i++) {
          if (!set.has(i)) { out.addPage(cmap.get(i)); continue; }
          await U.progress(i / src.getPageCount(), 'Flattening redacted page ' + (i + 1));
          const pg = await pdf.getPage(i + 1), vp = pg.getViewport({ scale: 1 });
          const cv = await U.renderPage(pdf, i + 1, 150 / 72);
          const img = await out.embedJpg(await U.canvasBytes(cv, 'image/jpeg', 0.9));
          out.addPage([vp.width, vp.height]).drawImage(img, { x: 0, y: 0, width: vp.width, height: vp.height });
          cv.width = cv.height = 0;
        }
        try { const t = src.getTitle(); if (t) out.setTitle(t); } catch (_) { }
        U.pdf.finish(out);
        return U.pdf.save(out);
      }

      async function download() {
        finishEdit();
        U.busy('Building your PDF…'); await U.nextFrame();
        try {
          const r = await build({ flatten: flatChk.checked });
          const name = U.baseName(S.name).replace(/_edited$/, '') + '_edited.pdf';
          U.download(r.bytes, name, 'application/pdf');
          U.lastPdf = { name, bytes: r.bytes };
          S.dirty = false;
          U.busyEnd();
          if (r.redacted) U.toast(r.redacted + ' page(s) with redactions were flattened to images so the covered content is permanently removed.', 'ok');
          else U.toast('Downloaded ' + name + ' (' + U.fmtBytes(r.bytes.length) + ')', 'ok');
          r.warn.forEach((w) => U.toast(w, 'err'));
        } catch (e) { U.error(e, 'Could not build PDF'); }
      }

      function closeDoc() {
        if (S.dirty && !confirm('You have unsaved changes. Close this PDF anyway?')) return;
        if (S.pdf) { try { S.pdf.destroy(); } catch (_) { } }
        S.pdf = null; S.pages = []; S.objs = []; S.dirty = false; els.clear(); pagesBox.replaceChildren(); io.disconnect();
        main.hidden = true; empty.hidden = false; refreshLast();
      }
      function refreshLast() {
        const d = empty.querySelector('#edLast'); d.replaceChildren();
        if (U.lastPdf) d.append('or ', h('a', { href: '#', onclick: (e) => { e.preventDefault(); open(U.lastPdf.bytes.slice(), U.lastPdf.name); } }, 'open the last result: ' + U.lastPdf.name));
      }
      refreshLast();
      U.dirty = () => S.dirty && !!S.pdf;
      window.addEventListener('hashchange', () => { if (location.hash === '#editor' || location.hash === '#sign') refreshLast(); });
      // drag-and-drop a PDF onto the editor
      root.addEventListener('dragover', (e) => e.preventDefault());
      root.addEventListener('drop', async (e) => { e.preventDefault(); const f = e.dataTransfer.files[0]; if (f && /\.pdf$/i.test(f.name) && !(S.dirty && !confirm('Replace the current document? Unsaved changes will be lost.'))) open(await U.readBytes(f), f.name); });

      const api = {
        open,
        intent(kind) {
          if (!S.pdf) { S.pendingIntent = kind; return; }
          if (kind === 'sign') chooseTool('sign');
        },
        _S: S, _build: build,
      };
      updUndo();
      return api;
    },
  });
})();
