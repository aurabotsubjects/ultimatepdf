/* UltimatePDF core: helpers, UI components, registry */
(function () {
  const U = (window.U = { tools: {}, order: [], inst: {}, lastPdf: null });

  pdfjsLib.GlobalWorkerOptions.workerSrc = 'lib/pdfjs/pdf.worker.min.js';

  // ---------- DOM helper ----------
  U.h = function (tag, attrs, ...kids) {
    const e = document.createElement(tag);
    if (attrs) for (const k in attrs) {
      const v = attrs[k];
      if (v == null || v === false) continue;
      if (k === 'class') e.className = v;
      else if (k === 'style' && typeof v === 'object') Object.assign(e.style, v);
      else if (k.startsWith('on')) e.addEventListener(k.slice(2), v);
      else if (k === 'html') e.innerHTML = v;
      else if (k in e && k !== 'list') { try { e[k] = v; } catch (_) { e.setAttribute(k, v); } }
      else e.setAttribute(k, v === true ? '' : v);
    }
    const add = (c) => {
      if (c == null || c === false) return;
      if (Array.isArray(c)) c.forEach(add);
      else e.append(c.nodeType ? c : document.createTextNode(c));
    };
    kids.forEach(add);
    return e;
  };
  const h = U.h;
  U.$ = (s, r = document) => r.querySelector(s);

  // ---------- formatting ----------
  U.fmtBytes = (n) => {
    if (n < 1024) return n + ' B';
    if (n < 1048576) return (n / 1024).toFixed(1) + ' KB';
    return (n / 1048576).toFixed(2) + ' MB';
  };
  U.baseName = (n) => n.replace(/\.[^.]+$/, '');
  U.sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  U.nextFrame = () => new Promise((r) => requestAnimationFrame(() => setTimeout(r, 0)));

  // ---------- toasts / busy ----------
  U.toast = (msg, type) => {
    const t = h('div', { class: 'toast ' + (type || '') }, msg);
    document.getElementById('toasts').append(t);
    setTimeout(() => t.remove(), type === 'err' ? 7000 : 3200);
  };
  U.error = (e, ctx) => {
    console.error(e);
    U.busyEnd();
    U.toast((ctx ? ctx + ': ' : '') + (e && e.message ? e.message : e), 'err');
  };
  let busyDepth = 0;
  U.busy = (msg) => {
    busyDepth++;
    document.getElementById('busy').hidden = false;
    document.getElementById('busyMsg').textContent = msg || 'Working…';
    document.getElementById('busyBar').style.width = '0%';
  };
  U.progress = async (frac, msg) => {
    if (msg) document.getElementById('busyMsg').textContent = msg;
    document.getElementById('busyBar').style.width = Math.round(frac * 100) + '%';
    await U.nextFrame();
  };
  U.busyEnd = () => {
    busyDepth = 0;
    document.getElementById('busy').hidden = true;
  };
  // wrap an async action with busy + error handling
  U.run = async (msg, fn) => {
    U.busy(msg);
    await U.nextFrame();
    try { return await fn(); } catch (e) { U.error(e); } finally { U.busyEnd(); }
  };

  // ---------- files ----------
  U.readBytes = async (file) => new Uint8Array(await file.arrayBuffer());
  U.download = (data, name, mime) => {
    const blob = data instanceof Blob ? data : new Blob([data], { type: mime || 'application/octet-stream' });
    const a = h('a', { href: URL.createObjectURL(blob), download: name });
    document.body.append(a);
    a.click();
    setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 4000);
  };
  U.zip = async (files, onProg) => {
    const z = new JSZip();
    files.forEach((f) => z.file(f.name, f.bytes));
    return z.generateAsync({ type: 'blob', compression: 'DEFLATE', compressionOptions: { level: 3 } }, onProg && ((m) => onProg(m.percent / 100)));
  };
  U.canvasBlob = (cv, type, q) => new Promise((res) => cv.toBlob(res, type, q));
  U.canvasBytes = async (cv, type, q) => new Uint8Array(await (await U.canvasBlob(cv, type, q)).arrayBuffer());

  // ---------- page ranges ("1-3, 5, 8-") -> zero based indices ----------
  U.parseRanges = (str, max) => {
    str = (str || '').trim().toLowerCase();
    if (!str || str === 'all') return Array.from({ length: max }, (_, i) => i);
    const out = [];
    for (let part of str.split(/[,;\s]+/)) {
      if (!part) continue;
      if (part === 'even') { for (let i = 2; i <= max; i += 2) out.push(i - 1); continue; }
      if (part === 'odd') { for (let i = 1; i <= max; i += 2) out.push(i - 1); continue; }
      part = part.replace(/last/g, String(max));
      const m = part.match(/^(\d*)(?:-(\d*))?$/);
      if (!m || (m[1] === '' && m[2] == null)) throw new Error('Cannot understand page range "' + part + '"');
      let a, b;
      if (m[2] === undefined) a = b = +m[1];
      else { a = m[1] === '' ? 1 : +m[1]; b = m[2] === '' ? max : +m[2]; }
      if (a < 1 || b < 1 || a > max || b > max) throw new Error('Page range "' + part + '" is outside 1–' + max);
      if (a <= b) for (let i = a; i <= b; i++) out.push(i - 1);
      else for (let i = a; i >= b; i--) out.push(i - 1);
    }
    if (!out.length) throw new Error('No pages selected');
    return out;
  };
  // indices -> compact "1-3,5"
  U.compactRanges = (idx) => {
    const s = [...new Set(idx)].sort((a, b) => a - b);
    const parts = [];
    for (let i = 0; i < s.length;) {
      let j = i;
      while (j + 1 < s.length && s[j + 1] === s[j] + 1) j++;
      parts.push(j > i ? s[i] + 1 + '-' + (s[j] + 1) : '' + (s[i] + 1));
      i = j + 1;
    }
    return parts.join(',');
  };

  // ---------- pdf.js ----------
  U.pdfjsLoad = async (bytes) => {
    const task = pdfjsLib.getDocument({
      data: bytes.slice(),
      cMapUrl: 'lib/pdfjs/cmaps/', cMapPacked: true,
      standardFontDataUrl: 'lib/pdfjs/standard_fonts/',
    });
    task.onPassword = (cb, reason) => {
      const p = window.prompt(reason === 2 ? 'Wrong password. Try again:' : 'This PDF is password protected. Enter the password:');
      if (p == null) task.destroy(); else cb(p);
    };
    return task.promise;
  };
  U.renderPage = async (doc, pageNo, scale, opts) => {
    const page = await doc.getPage(pageNo);
    const vp = page.getViewport({ scale });
    const cv = document.createElement('canvas');
    cv.width = Math.ceil(vp.width); cv.height = Math.ceil(vp.height);
    const ctx = cv.getContext('2d');
    ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, cv.width, cv.height);
    await page.render(Object.assign({ canvasContext: ctx, viewport: vp }, opts || {})).promise;
    return cv;
  };
  // lazily rendered thumbnail inside container
  let io;
  U.lazyThumb = (container, doc, pageNo, width) => {
    if (!io) io = new IntersectionObserver((ents) => {
      ents.forEach((en) => {
        if (!en.isIntersecting) return;
        io.unobserve(en.target);
        en.target._go();
      });
    }, { rootMargin: '300px' });
    container._go = async () => {
      try {
        const page = await doc.getPage(pageNo);
        const base = page.getViewport({ scale: 1 });
        const scale = (width * (window.devicePixelRatio > 1 ? 1.5 : 1)) / base.width;
        const cv = await U.renderPage(doc, pageNo, scale);
        container.replaceChildren(cv);
      } catch (e) { container.textContent = '⚠'; }
    };
    io.observe(container);
  };

  // ---------- components ----------
  // dropzone -> calls onFiles(File[])
  U.dropzone = ({ accept, multiple, onFiles, title, subtitle, icon }) => {
    const input = h('input', { type: 'file', accept: accept || '', multiple: !!multiple, hidden: true });
    const z = h('div', { class: 'drop', tabindex: 0 },
      h('div', { class: 'big' }, icon || '📄'),
      h('b', null, title || (multiple ? 'Drop files here or click to choose' : 'Drop a file here or click to choose')),
      subtitle || '', input);
    const pick = (files) => {
      files = [...files];
      if (accept) {
        const exts = accept.split(',').map((s) => s.trim().toLowerCase());
        files = files.filter((f) => exts.some((a) => a.startsWith('.') ? f.name.toLowerCase().endsWith(a) : a.endsWith('/*') ? f.type.startsWith(a.slice(0, -1)) : f.type === a));
      }
      if (!files.length) return U.toast('That file type is not supported here', 'err');
      onFiles(multiple ? files : [files[0]]);
    };
    z.addEventListener('click', () => input.click());
    z.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') input.click(); });
    input.addEventListener('click', (e) => e.stopPropagation());
    input.addEventListener('change', () => { if (input.files.length) pick(input.files); input.value = ''; });
    ['dragenter', 'dragover'].forEach((ev) => z.addEventListener(ev, (e) => { e.preventDefault(); z.classList.add('over'); }));
    ['dragleave', 'drop'].forEach((ev) => z.addEventListener(ev, (e) => { e.preventDefault(); z.classList.remove('over'); }));
    z.addEventListener('drop', (e) => { if (e.dataTransfer.files.length) pick(e.dataTransfer.files); });
    return z;
  };

  // single PDF input: shows dropzone, then a file card. onLoad({name,bytes,pdf,numPages,size}), onClear()
  U.singlePdf = ({ onLoad, onClear, title }) => {
    const root = h('div');
    let cur = null;
    const showDrop = () => {
      cur = null;
      const kids = [U.dropzone({
        accept: '.pdf,application/pdf', title: title || 'Drop a PDF here or click to choose', icon: '📄',
        onFiles: async ([f]) => load(f.name, await U.readBytes(f)),
      })];
      if (U.lastPdf) kids.push(h('div', { class: 'hint' }, 'or ',
        h('a', { href: '#', onclick: (e) => { e.preventDefault(); load(U.lastPdf.name, U.lastPdf.bytes.slice()); } },
          'use the last result: ' + U.lastPdf.name)));
      root.replaceChildren(...kids);
      onClear && onClear();
    };
    const load = async (name, bytes) => {
      U.busy('Reading PDF…');
      try {
        const pdf = await U.pdfjsLoad(bytes);
        cur = { name, bytes, pdf, numPages: pdf.numPages, size: bytes.length };
        root.replaceChildren(h('div', { class: 'card fileinfo' },
          h('div', null, h('div', { class: 'nm' }, name), h('div', { class: 'meta' }, pdf.numPages + ' page' + (pdf.numPages > 1 ? 's' : '') + ' · ' + U.fmtBytes(bytes.length))),
          h('button', { class: 'btn sm', onclick: showDrop }, 'Change file')));
        U.busyEnd();
        await onLoad(cur);
      } catch (e) { U.error(e, 'Could not open PDF'); showDrop(); }
    };
    showDrop();
    root.load = load;
    root.refresh = () => { if (!cur) showDrop(); };
    return root;
  };

  // sortable list of items. items: [{id,name,meta,thumb(el),...}] ; returns controller
  U.sortList = ({ items, onChange, extra }) => {
    const root = h('div', { class: 'list' });
    let dragIdx = null;
    const render = () => {
      root.replaceChildren(...items.map((it, i) => {
        const row = h('div', { class: 'li', draggable: true },
          h('span', { class: 'grab', title: 'Drag to reorder' }, '⠿'),
          h('div', { class: 'th' }, it.thumb || ''),
          h('div', { class: 'nm' }, it.name, h('div', { class: 'meta' }, it.meta || '')),
          extra ? extra(it, i) : null,
          h('button', { class: 'btn sm', disabled: i === 0, onclick: () => move(i, i - 1), title: 'Move up' }, '↑'),
          h('button', { class: 'btn sm', disabled: i === items.length - 1, onclick: () => move(i, i + 1), title: 'Move down' }, '↓'),
          h('button', { class: 'btn sm', onclick: () => { items.splice(i, 1); render(); onChange && onChange(); }, title: 'Remove' }, '✕'));
        row.addEventListener('dragstart', (e) => { dragIdx = i; row.classList.add('drag'); e.dataTransfer.effectAllowed = 'move'; });
        row.addEventListener('dragend', () => row.classList.remove('drag'));
        row.addEventListener('dragover', (e) => { if (dragIdx != null) e.preventDefault(); });
        row.addEventListener('drop', (e) => { if (dragIdx == null) return; e.preventDefault(); e.stopPropagation(); move(dragIdx, i); dragIdx = null; });
        return row;
      }));
    };
    const move = (a, b) => {
      if (b < 0 || b >= items.length) return;
      items.splice(b, 0, items.splice(a, 1)[0]);
      render(); onChange && onChange();
    };
    render();
    root.render = render;
    return root;
  };

  // results: files=[{name,bytes,mime}] ; shows download buttons etc
  U.showResults = (container, files, opts) => {
    opts = opts || {};
    const pdfs = files.filter((f) => /\.pdf$/i.test(f.name));
    if (pdfs.length) U.lastPdf = { name: pdfs[0].name, bytes: pdfs[0].bytes };
    const total = files.reduce((s, f) => s + f.bytes.length, 0);
    const card = h('div', { class: 'card' },
      h('h3', null, '✅ ' + (opts.title || 'Done') + (files.length > 1 ? ' — ' + files.length + ' files' : '')),
      opts.summary ? h('div', { class: 'note' }, opts.summary) : null,
      files.slice(0, 200).map((f) => h('div', { class: 'res' },
        h('div', null, h('b', null, f.name), ' ', h('span', { class: 'muted small' }, U.fmtBytes(f.bytes.length))),
        h('div', { class: 'row' },
          /\.pdf$/i.test(f.name) && !opts.noEditor ? h('button', { class: 'btn sm', onclick: () => U.openInEditor(f.bytes, f.name) }, '✏️ Open in editor') : null,
          h('button', { class: 'btn sm pri', onclick: () => U.download(f.bytes, f.name, f.mime) }, '⬇ Download')))),
      files.length > 1 ? h('div', { style: { marginTop: '12px' } },
        h('button', { class: 'btn pri', onclick: () => U.run('Zipping…', async () => U.download(await U.zip(files, (p) => U.progress(p)), (opts.zipName || 'ultimatepdf-files') + '.zip')) },
          '⬇ Download all as ZIP (' + U.fmtBytes(total) + ')')) : null);
    container.replaceChildren(card);
    card.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  };

  // ---------- registry ----------
  U.register = (t) => { U.tools[t.id] = t; U.order.push(t.id); };
  U.openInEditor = (bytes, name) => {
    U.pendingEditor = { bytes, name };
    location.hash = '#editor';
    U.show('editor');
  };
})();
