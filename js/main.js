/* Router, navigation and home screen */
(function () {
  const h = U.h;
  const nav = document.getElementById('nav'), main = document.getElementById('main'), sidebar = document.getElementById('sidebar');

  // alias entries (shortcuts into the editor)
  U.register({ id: 'sign', group: 'Edit', icon: '✍️', title: 'Sign PDF', desc: 'Draw, type or upload a signature', alias: 'editor', intent: 'sign' });

  // desired sidebar order
  const GROUPS = ['Edit', 'Organise', 'Convert', 'Optimise', 'Stamp & secure'];
  const ORDER = ['editor', 'sign', 'merge', 'split', 'extract', 'organise', 'img2pdf', 'word2pdf', 'pdf2img', 'pdf2text', 'compress', 'compimg', 'watermark', 'pagenum', 'metadata'];
  U.tools.editor.group = 'Edit';

  function buildNav() {
    nav.replaceChildren();
    GROUPS.forEach((g) => {
      const ids = ORDER.filter((id) => U.tools[id] && U.tools[id].group === g);
      if (!ids.length) return;
      nav.append(h('div', { class: 'grp' }, g));
      ids.forEach((id) => nav.append(h('a', { href: '#' + id, 'data-id': id, onclick: () => sidebar.classList.remove('open') }, h('span', { class: 'i' }, U.tools[id].icon), U.tools[id].title)));
    });
  }

  const home = h('section', { class: 'tool', id: 't-home' },
    h('div', { class: 'hero' }, h('h1', null, 'Every PDF tool you need. Private by design.'),
      h('p', { class: 'sub' }, 'Edit, fill, sign, merge, split, convert and compress PDFs — all inside your browser. Your files are never uploaded anywhere.')),
    h('div', { class: 'cards', id: 'homeCards' }));

  function ensure(id) {
    const t = U.tools[id];
    if (U.inst[id]) return U.inst[id];
    const el = h('section', { class: 'tool' + (t.wide ? ' wide' : ''), id: 't-' + id });
    main.append(el);
    let api;
    try { api = t.render(el); } catch (e) { console.error(e); el.textContent = 'Failed to load tool: ' + e.message; }
    U.inst[id] = { el, api };
    return U.inst[id];
  }

  U.show = (id) => {
    let intent = null;
    if (U.tools[id] && U.tools[id].alias) { intent = U.tools[id].intent; id = U.tools[id].alias; }
    document.querySelectorAll('.tool').forEach((n) => n.classList.remove('on'));
    document.querySelectorAll('#nav a').forEach((a) => a.classList.toggle('on', a.dataset.id === (intent ? 'sign' : id) || (!intent && a.dataset.id === id)));
    if (!U.tools[id]) { home.classList.add('on'); document.title = 'UltimatePDF — free private PDF toolkit'; return; }
    const inst = ensure(id);
    inst.el.classList.add('on');
    document.title = U.tools[id].title + ' · UltimatePDF';
    if (id === 'editor' && inst.api) {
      if (U.pendingEditor) { const p = U.pendingEditor; U.pendingEditor = null; inst.api.open(p.bytes, p.name); }
      if (intent && inst.api.intent) inst.api.intent(intent);
    }
    main.scrollTop = 0;
  };

  function route() {
    let id = location.hash.replace('#', '') || 'home';
    const was = document.querySelector('#nav a.on');
    U.show(id === 'home' ? '' : id);
  }

  main.append(home);
  buildNav();
  const cards = document.getElementById('homeCards');
  ORDER.filter((id) => U.tools[id]).forEach((id) => {
    const t = U.tools[id];
    cards.append(h('a', { class: 'tcard', href: '#' + id }, h('div', { class: 'ic' }, t.icon), h('b', null, t.title), h('span', null, t.desc)));
  });
  document.getElementById('menuBtn').addEventListener('click', () => sidebar.classList.toggle('open'));
  window.addEventListener('hashchange', route);
  window.addEventListener('beforeunload', (e) => { if (U.dirty && U.dirty()) { e.preventDefault(); e.returnValue = ''; } });
  // drop a file anywhere on the home page -> open in editor
  window.addEventListener('dragover', (e) => e.preventDefault());
  window.addEventListener('drop', (e) => {
    if (!home.classList.contains('on')) return; e.preventDefault();
    const f = e.dataTransfer.files[0];
    if (f && /\.pdf$/i.test(f.name)) f.arrayBuffer().then((b) => U.openInEditor(new Uint8Array(b), f.name));
  });
  route();
})();
