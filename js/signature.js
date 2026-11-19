/* Signature / initials capture modal. U.signature.get(kind) -> Promise<dataURL|null> */
(function () {
  const h = U.h;
  const FONTS = [
    "'Snell Roundhand','Apple Chancery','Brush Script MT','Segoe Script',cursive",
    "'Segoe Script','Lucida Handwriting','Bradley Hand',cursive",
    "'Bradley Hand','Marker Felt','Comic Sans MS',cursive",
    "'Zapfino','Savoye LET','Lucida Calligraphy',cursive",
    "'Noteworthy','Chalkboard SE','Comic Sans MS',cursive",
    "'Times New Roman',Georgia,serif",
  ];
  const store = (k) => 'updf_' + k;
  const saved = (k) => { try { return JSON.parse(localStorage.getItem(store(k)) || '[]'); } catch (_) { return []; } };
  const setSaved = (k, a) => { try { localStorage.setItem(store(k), JSON.stringify(a.slice(0, 6))); } catch (_) { } };

  function trim(cv) {
    const ctx = cv.getContext('2d');
    const { width: w, height: hgt } = cv;
    const d = ctx.getImageData(0, 0, w, hgt).data;
    let x0 = w, y0 = hgt, x1 = 0, y1 = 0;
    for (let y = 0; y < hgt; y++) for (let x = 0; x < w; x++) if (d[(y * w + x) * 4 + 3] > 12) {
      if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y;
    }
    if (x1 <= x0 || y1 <= y0) return null;
    const pad = 6;
    x0 = Math.max(0, x0 - pad); y0 = Math.max(0, y0 - pad); x1 = Math.min(w - 1, x1 + pad); y1 = Math.min(hgt - 1, y1 + pad);
    const out = document.createElement('canvas');
    out.width = x1 - x0 + 1; out.height = y1 - y0 + 1;
    out.getContext('2d').drawImage(cv, x0, y0, out.width, out.height, 0, 0, out.width, out.height);
    return out.toDataURL('image/png');
  }

  U.signature = {
    trim,
    get(kind) {
      kind = kind || 'signature';
      return new Promise((resolve) => {
        let tab = 'draw', color = '#111111', fontIdx = 0, uploaded = null;
        const body = h('div');
        const close = (v) => { bg.remove(); resolve(v); };
        const pad = h('canvas', { class: 'sigpad', width: 1200, height: 360 });
        const pctx = pad.getContext('2d');
        let drawing = false, last = null, dirty = false;
        const pos = (e) => { const r = pad.getBoundingClientRect(); return [(e.clientX - r.left) * pad.width / r.width, (e.clientY - r.top) * pad.height / r.height]; };
        pad.addEventListener('pointerdown', (e) => { drawing = true; dirty = true; pad.setPointerCapture(e.pointerId); last = pos(e); pctx.fillStyle = color; pctx.beginPath(); pctx.arc(last[0], last[1], 3.2, 0, 7); pctx.fill(); });
        pad.addEventListener('pointermove', (e) => {
          if (!drawing) return;
          const p = pos(e);
          pctx.strokeStyle = color; pctx.lineWidth = 6.4; pctx.lineCap = pctx.lineJoin = 'round';
          pctx.beginPath(); pctx.moveTo(last[0], last[1]);
          pctx.quadraticCurveTo(last[0], last[1], (last[0] + p[0]) / 2, (last[1] + p[1]) / 2); pctx.stroke();
          last = p;
        });
        pad.addEventListener('pointerup', () => { drawing = false; });
        const txt = h('input', { type: 'text', placeholder: kind === 'initials' ? 'Your initials' : 'Type your name', style: { width: '100%', fontSize: '18px' }, oninput: () => paintFonts() });
        const fontsEl = h('div', { class: 'fonts' });
        const paintFonts = () => {
          fontsEl.replaceChildren(...FONTS.map((f, i) => h('button', { class: i === fontIdx ? 'on' : '', style: { fontFamily: f, color }, onclick: () => { fontIdx = i; paintFonts(); } }, txt.value || (kind === 'initials' ? 'AB' : 'Your Name'))));
        };
        const upInput = h('input', { type: 'file', accept: 'image/*', onchange: async (e) => { const f = e.target.files[0]; if (!f) return; const bmp = await createImageBitmap(f); const cv = document.createElement('canvas'); const s = Math.min(1, 900 / bmp.width); cv.width = bmp.width * s; cv.height = bmp.height * s; cv.getContext('2d').drawImage(bmp, 0, 0, cv.width, cv.height); uploaded = cv; prevUp(); } });
        const rmBg = h('input', { type: 'checkbox', checked: true, onchange: () => prevUp() });
        const upPrev = h('div', { style: { marginTop: '10px', background: 'repeating-conic-gradient(#ddd 0 25%,#fff 0 50%) 0 0/16px 16px', minHeight: '80px', textAlign: 'center' } });
        const prevUp = () => {
          if (!uploaded) return;
          const r = processUpload();
          upPrev.replaceChildren(h('img', { src: r, style: { maxHeight: '130px', maxWidth: '100%' } }));
        };
        const processUpload = () => {
          const cv = document.createElement('canvas'); cv.width = uploaded.width; cv.height = uploaded.height;
          const ctx = cv.getContext('2d'); ctx.drawImage(uploaded, 0, 0);
          if (rmBg.checked) {
            const id = ctx.getImageData(0, 0, cv.width, cv.height), d = id.data;
            for (let i = 0; i < d.length; i += 4) {
              const lum = 0.3 * d[i] + 0.59 * d[i + 1] + 0.11 * d[i + 2];
              if (lum > 225) d[i + 3] = 0; else if (lum > 150) d[i + 3] = Math.round(255 * (225 - lum) / 75);
            }
            ctx.putImageData(id, 0, 0);
          }
          return trim(cv) || cv.toDataURL('image/png');
        };
        const savedBox = h('div', { class: 'sigsaved' });
        const paintSaved = () => {
          savedBox.replaceChildren(...saved(kind).map((u, i) => h('button', { title: 'Use this', onclick: () => close(u) },
            h('img', { src: u }),
            h('span', { class: 'x', onclick: (e) => { e.stopPropagation(); const a = saved(kind); a.splice(i, 1); setSaved(kind, a); paintSaved(); } }, '✕'))));
        };
        const colors = ['#111111', '#0b3d91', '#b3261e'].map((c) => h('button', { class: 'btn sm', style: { background: c, width: '26px', height: '26px', padding: 0, borderRadius: '50%' }, onclick: () => { color = c; paintFonts(); } }));
        const saveChk = h('input', { type: 'checkbox', checked: true });
        const show = () => {
          tabs.forEach(([k, b]) => b.classList.toggle('on', k === tab));
          body.replaceChildren(...(
            tab === 'draw' ? [h('div', { class: 'small muted', style: { marginBottom: '6px' } }, 'Draw with mouse, finger or stylus'), pad,
              h('div', { class: 'row', style: { marginTop: '8px' } }, ...colors, h('button', { class: 'btn sm', onclick: () => { pctx.clearRect(0, 0, pad.width, pad.height); dirty = false; } }, 'Clear'))]
              : tab === 'type' ? [txt, fontsEl]
                : [h('div', { class: 'small muted' }, 'Upload a photo of your signature (on white paper works best)'), upInput, h('label', { class: 'chk', style: { marginTop: '8px' } }, rmBg, 'Remove white background'), upPrev]));
          if (tab === 'type') { paintFonts(); setTimeout(() => txt.focus(), 30); }
        };
        const tabs = [['draw', h('button', { onclick: () => { tab = 'draw'; show(); } }, '✍️ Draw')], ['type', h('button', { onclick: () => { tab = 'type'; show(); } }, '⌨️ Type')], ['upload', h('button', { onclick: () => { tab = 'upload'; show(); } }, '🖼 Upload')]];
        const useBtn = h('button', { class: 'btn pri', onclick: () => {
          let url = null;
          if (tab === 'draw') { if (dirty) url = trim(pad); }
          else if (tab === 'type') {
            if (!txt.value.trim()) return U.toast('Type something first', 'err');
            const cv = document.createElement('canvas'); cv.width = 1400; cv.height = 400;
            const c = cv.getContext('2d'); c.fillStyle = color; c.textBaseline = 'middle'; c.font = '200px ' + FONTS[fontIdx];
            let size = 200; while (c.measureText(txt.value).width > 1300 && size > 40) { size -= 10; c.font = size + 'px ' + FONTS[fontIdx]; }
            c.fillText(txt.value, 40, 200);
            url = trim(cv);
          } else if (uploaded) url = processUpload();
          if (!url) return U.toast('Please create a ' + kind + ' first', 'err');
          if (saveChk.checked) { const a = saved(kind).filter((x) => x !== url); a.unshift(url); setSaved(kind, a); }
          close(url);
        } }, 'Use ' + kind);
        const bg = h('div', { class: 'modal-bg', onclick: (e) => { if (e.target === bg) close(null); } },
          h('div', { class: 'modal' },
            h('h2', null, kind === 'initials' ? 'Add your initials' : 'Add your signature'),
            saved(kind).length ? [h('div', { class: 'small muted' }, 'Saved on this device:'), savedBox] : null,
            h('div', { class: 'seg', style: { marginBottom: '12px' } }, tabs.map((t) => t[1])),
            body,
            h('div', { class: 'acts' },
              h('label', { class: 'chk small', style: { marginRight: 'auto' } }, saveChk, 'Remember on this device'),
              h('button', { class: 'btn', onclick: () => close(null) }, 'Cancel'), useBtn)));
        document.body.append(bg);
        paintSaved(); show();
      });
    },
  };
})();
