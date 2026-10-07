// app.js - 主流程與 UI(專案履歷 / 殘件項目 / 設定)
(function () {
  const CFG = window.APP_CONFIG;
  const $ = (id) => document.getElementById(id);
  const S = { user: null, fileId: null, meta: null, data: null, folderId: null, ready: false };
  let editing = null; // { type:'resume'|'remain', obj, snapshot, isNew, uploads:[] }

  // ---------- 共用小工具 ----------
  const clone = (o) => JSON.parse(JSON.stringify(o));
  const pad = (n) => String(n).padStart(2, '0');
  const todayISO = () => { const t = new Date(); return `${t.getFullYear()}-${pad(t.getMonth() + 1)}-${pad(t.getDate())}`; };
  const fmtDate = (v) => (String(v || '').match(/^(\d{4})-(\d{2})-(\d{2})/) || []).slice(1).join('/');
  const fmtDT = (v) => { const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/.exec(v || ''); return m ? `${m[1]}/${m[2]}/${m[3]} ${m[4]}:${m[5]}` : String(v || ''); };
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  function h(tag, attrs, ...children) {
    const el = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs || {})) {
      if (v == null || v === false) continue;
      if (k === 'class') el.className = v;
      else if (k === 'text') el.textContent = v;
      else if (k === 'html') el.innerHTML = v;
      else if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
      else el.setAttribute(k, v === true ? '' : v);
    }
    for (const c of children.flat()) if (c != null && c !== false) el.append(c.nodeType ? c : document.createTextNode(String(c)));
    return el;
  }
  function ssGet(k) { try { return sessionStorage.getItem(k); } catch { return null; } }
  function ssSet(k, v) { try { sessionStorage.setItem(k, v); } catch {} }

  let toastTimer;
  function toast(msg, ms = 2600) {
    const t = $('toast');
    t.textContent = msg;
    t.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => t.classList.remove('show'), ms);
  }
  function busy(msg) { $('busy').hidden = !msg; if (msg) $('busyMsg').textContent = msg; }
  // body:字串或 DOM 節點;buttons:[{label, value, cls}]
  function dialog(title, body, buttons) {
    return new Promise((resolve) => {
      $('confirmTitle').textContent = title;
      const m = $('confirmMsg');
      m.innerHTML = '';
      if (body && body.nodeType) m.append(body); else m.textContent = body || '';
      const box = $('confirmBtns');
      box.innerHTML = '';
      for (const b of buttons) {
        box.append(h('button', { type: 'button', class: 'btn ' + (b.cls || 'btn-ghost'), onclick: () => { $('confirmBox').hidden = true; resolve(b.value); } }, b.label));
      }
      $('confirmBox').hidden = false;
    });
  }
  const confirmYes = (title, msg, yes = '確定', cls = 'btn-primary') =>
    dialog(title, msg, [{ label: '取消', value: false }, { label: yes, value: true, cls }]);
  const errMsg = (e) => (e && e.message) || String(e);

  // ---------- 載入 / 寫回 ----------
  async function signIn() {
    try {
      busy('登入 Google…');
      await Drive.ensureToken();
      S.user = await Drive.whoAmI().catch(() => null);
      if (S.user) $('userLine').textContent = `${S.user.displayName}\n${S.user.emailAddress}`;
      busy(`尋找「${CFG.FILE_NAME}」…`);
      const f = await Drive.findByName(CFG.FILE_NAME);
      if (!f) {
        busy('');
        $('welcomeMsg').textContent = `找不到「${CFG.FILE_NAME}」,或帳號 ${S.user ? S.user.emailAddress : ''} 沒有權限。請確認共用雲端硬碟 ATK 的共用設定。`;
        $('signInBtn').textContent = '改用其他帳號登入';
        $('signInBtn').onclick = () => { Drive.signOut(); location.reload(); };
        return;
      }
      S.fileId = f.id;
      await reload();
      S.ready = true;
      route();
    } catch (err) {
      toast(errMsg(err), 5000);
    } finally { busy(''); }
  }

  async function reload() {
    busy('下載資料…');
    try {
      const { meta, bytes } = await Drive.download(S.fileId);
      S.meta = meta;
      S.data = Store.readAll(bytes);
    } finally { busy(''); }
  }

  // 每次寫入都先下載最新檔案,只套用這次的修改再存回(多人同時使用時不會互相覆蓋)
  async function commit(label, mutate) {
    busy(label);
    try {
      const { bytes } = await Drive.download(S.fileId);
      const d = Store.readAll(bytes);
      const result = mutate(d);
      const out = Store.writeAll(d);
      busy(label.replace(/…$/, '') + '(上傳中)…');
      S.meta = await Drive.upload(S.fileId, out);
      S.data = Store.readAll(out);
      return result;
    } finally { busy(''); }
  }

  // ---------- 頁首 / 版面 ----------
  const VIEWS = ['welcome', 'listView', 'resumeView', 'remainView', 'remainEditView', 'settingsView'];
  function showView(id, { title = 'ATK專案履歷', sub = '', back = null, save = false, link = false } = {}) {
    for (const v of VIEWS) $(v).hidden = v !== id;
    setTitle(title, sub);
    $('menuBtn').hidden = !!back;
    $('backBtn').hidden = !back;
    $('backBtn').dataset.to = back || '';
    $('saveBtn').hidden = !save;
    $('linkBtn').hidden = !link;
    for (const a of document.querySelectorAll('[data-nav]')) {
      a.classList.toggle('active', (id === 'listView' && a.dataset.nav === 'list') || (id.startsWith('remain') && a.dataset.nav === 'remain') || (id === 'settingsView' && a.dataset.nav === 'settings'));
    }
    window.scrollTo(0, 0);
  }
  function setTitle(title, sub) {
    $('pageTitle').textContent = title;
    if (sub != null) $('subLine').textContent = sub;
    document.title = title;
  }
  function fileLine() {
    if (!S.meta) return '';
    const d = new Date(S.meta.modifiedTime);
    return `${CFG.FILE_NAME} · ${d.getMonth() + 1}/${d.getDate()} ${pad(d.getHours())}:${pad(d.getMinutes())} 更新`;
  }
  const isDirty = () => !!editing && JSON.stringify(editing.obj) !== editing.snapshot;
  function markDirty() { $('saveBtn').classList.toggle('dirty', isDirty()); }

  // ---------- 路由 ----------
  function parseHash() {
    const raw = location.hash.replace(/^#\/?/, '');
    const [path, qs] = raw.split('?');
    return { parts: path.split('/').filter(Boolean).map(decodeURIComponent), q: new URLSearchParams(qs || '') };
  }
  function route() {
    if (!S.ready) {
      showView('welcome', { title: 'ATK專案履歷' });
      const { parts } = parseHash();
      if (parts[0] === 'r' && parts[1] && parts[1] !== 'new' && !$('welcomeMsg').textContent) $('welcomeMsg').textContent = '登入後將開啟分享的專案履歷。';
      return;
    }
    const { parts, q } = parseHash();
    if (parts[0] === 'r') openResume(parts[1] || 'new');
    else if (parts[0] === 'remain' && parts[1]) openRemain(parts[1], q.get('p'));
    else if (parts[0] === 'remain') showRemainList(q.get('p'));
    else if (parts[0] === 'settings') showSettings();
    else showList();
  }
  let lastHash = location.hash;
  let ignoreHash = false;
  window.addEventListener('hashchange', async () => {
    if (ignoreHash) { ignoreHash = false; lastHash = location.hash; return; }
    toggleDrawer(false);
    if (isDirty()) {
      const target = location.hash;
      ignoreHash = true;
      location.hash = lastHash || '#/';
      if (!(await confirmDiscard())) return;
      await discardEditing();
      location.hash = target;
      return;
    }
    if (editing) await discardEditing();
    lastHash = location.hash;
    route();
  });
  const go = (hash) => { if (location.hash === hash) route(); else location.hash = hash; };
  function replaceHash(hash) { history.replaceState(null, '', hash); lastHash = hash; }

  function confirmDiscard() {
    return dialog('尚未儲存', '目前的修改尚未儲存,離開將會放棄這些修改。', [
      { label: '繼續編輯', value: false },
      { label: '放棄修改', value: true, cls: 'btn-danger' },
    ]);
  }
  // 放棄編輯:把這次上傳但沒存進履歷的檔案移到垃圾桶
  async function discardEditing() {
    const ups = editing ? editing.uploads : [];
    editing = null;
    for (const id of ups) Drive.trash(id).catch(() => {});
  }

  // ---------- 選單 ----------
  function toggleDrawer(open) {
    $('drawer').classList.toggle('open', open);
    $('drawer').setAttribute('aria-hidden', String(!open));
    $('drawerBackdrop').hidden = !open;
  }
  $('menuBtn').onclick = () => toggleDrawer(true);
  $('drawerBackdrop').onclick = () => toggleDrawer(false);
  $('drawer').addEventListener('click', (e) => { if (e.target.closest('[data-nav]')) toggleDrawer(false); });
  $('backBtn').onclick = () => go($('backBtn').dataset.to || '#/');

  // ---------- 清單資料(Choice) ----------
  const lists = () => S.data.choice.lists;
  function listValues(key) {
    if (key === 'code') return lists().projects.filter((p) => p.code).map((p) => ({ value: p.code, label: p.code, sub: p.name }));
    if (key === 'name') return lists().projects.filter((p) => p.name).map((p) => ({ value: p.name, label: p.name, sub: p.code }));
    return (lists()[key] || []).map((v) => ({ value: v, label: v }));
  }
  const listKeyOf = (key) => (key === 'code' || key === 'name' ? 'project' : key);
  async function choiceAdd(key, item) {
    await commit('更新選單…', (d) => {
      const L = d.choice.lists;
      if (key === 'project') {
        const ex = L.projects.find((p) => p.code && p.code === item.code);
        if (ex) ex.name = item.name || ex.name; else L.projects.push(item);
      } else {
        if (!L[key]) L[key] = [];
        if (!L[key].includes(item)) L[key].push(item);
      }
      d.changed.add('choice');
    });
  }
  async function choiceRemove(key, item) {
    await commit('更新選單…', (d) => {
      const L = d.choice.lists;
      if (key === 'project') L.projects = L.projects.filter((p) => !(p.code === item.code && p.name === item.name));
      else L[key] = (L[key] || []).filter((v) => v !== item);
      d.changed.add('choice');
    });
  }

  // ---------- 下拉選單(可新增/刪除項目) ----------
  // opts: { title, key(code/name/unit/...), multi, selected:[], selectOnly }
  let picker = null;
  function openPicker(opts) {
    return new Promise((resolve) => {
      picker = { ...opts, resolve, editMode: false, sel: new Set(opts.selected || []) };
      $('pickerTitle').textContent = opts.title;
      $('pickerSearch').value = '';
      $('pickerFoot').hidden = !opts.multi;
      $('pickerEdit').textContent = '編輯清單';
      renderPicker();
      $('picker').hidden = false;
      document.body.classList.add('noscroll');
    });
  }
  function closePicker(value) {
    if (!picker) return;
    const p = picker;
    picker = null;
    $('picker').hidden = true;
    document.body.classList.remove('noscroll');
    p.resolve(value);
  }
  function renderPicker() {
    const p = picker;
    const kw = $('pickerSearch').value.trim().toLowerCase();
    const items = listValues(p.key).filter((it) => !kw || (it.label + ' ' + (it.sub || '')).toLowerCase().includes(kw));
    const box = $('pickerList');
    box.innerHTML = '';
    if (!items.length) box.append(h('div', { class: 'empty small' }, kw ? '沒有符合的項目' : '清單是空的,請在下方新增'));
    for (const it of items) {
      const on = p.sel.has(it.value);
      const row = h('div', { class: 'pick-item' + (on ? ' on' : '') },
        p.multi ? h('span', { class: 'check' }, on ? '☑' : '☐') : null,
        h('span', { class: 'pick-text' }, h('b', {}, it.label), it.sub ? h('small', {}, it.sub) : null),
        p.editMode ? h('button', {
          type: 'button', class: 'del-btn', 'aria-label': '刪除', onclick: async (e) => {
            e.stopPropagation();
            const lk = listKeyOf(p.key);
            const item = lk === 'project' ? lists().projects.find((x) => x[p.key] === it.value) : it.value;
            const label = lk === 'project' ? `${item.code} ${item.name}` : item;
            if (!(await confirmYes('刪除選單項目', `確定從清單刪除「${label}」?\n(已填入資料的內容不受影響)`, '刪除', 'btn-danger'))) return;
            try { await choiceRemove(lk, item); p.sel.delete(it.value); } catch (err) { toast(errMsg(err), 5000); }
            if (picker === p) renderPicker();
          },
        }, '🗑') : null);
      row.onclick = () => {
        if (p.editMode) return;
        if (p.multi) { on ? p.sel.delete(it.value) : p.sel.add(it.value); renderPicker(); }
        else closePicker(it.value);
      };
      box.append(row);
    }
    // 新增項目
    const add = $('pickerAdd');
    add.innerHTML = '';
    const lk = listKeyOf(p.key);
    if (lk === 'project') {
      const ci = h('input', { type: 'text', placeholder: '專案代號', 'aria-label': '新專案代號' });
      const ni = h('input', { type: 'text', placeholder: '專案名稱', 'aria-label': '新專案名稱' });
      if (kw) (p.key === 'code' ? ci : ni).value = $('pickerSearch').value.trim();
      add.append(ci, ni, h('button', {
        type: 'button', class: 'btn btn-primary btn-sm', onclick: async () => {
          const item = { code: ci.value.trim(), name: ni.value.trim() };
          if (!item.code || !item.name) return toast('請輸入專案代號與專案名稱');
          try { await choiceAdd('project', item); } catch (err) { return toast(errMsg(err), 5000); }
          if (p.multi) { p.sel.add(item[p.key]); renderPicker(); } else closePicker(item[p.key]);
        },
      }, '＋ 加入'));
    } else {
      const inp = h('input', { type: 'text', placeholder: '新增項目', 'aria-label': '新增項目' });
      if (kw) inp.value = $('pickerSearch').value.trim();
      add.append(inp, h('button', {
        type: 'button', class: 'btn btn-primary btn-sm', onclick: async () => {
          const v = inp.value.trim();
          if (!v) return toast('請輸入項目名稱');
          try { await choiceAdd(lk, v); } catch (err) { return toast(errMsg(err), 5000); }
          if (p.multi) { p.sel.add(v); $('pickerSearch').value = ''; renderPicker(); } else closePicker(v);
        },
      }, '＋ 加入'));
    }
  }
  $('pickerSearch').oninput = () => picker && renderPicker();
  $('pickerClose').onclick = () => closePicker(null);
  $('picker').onclick = (e) => { if (e.target === $('picker')) closePicker(null); };
  $('pickerOk').onclick = () => {
    const p = picker;
    const order = listValues(p.key).map((x) => x.value);
    closePicker([...p.sel].sort((a, b) => order.indexOf(a) - order.indexOf(b)));
  };
  $('pickerEdit').onclick = () => {
    picker.editMode = !picker.editMode;
    $('pickerEdit').textContent = picker.editMode ? '完成編輯' : '編輯清單';
    renderPicker();
  };

  // ---------- 表單欄位 ----------
  function autoGrow(ta) { ta.style.height = 'auto'; ta.style.height = Math.min(ta.scrollHeight + 2, 360) + 'px'; }
  function field(label, control, extra) {
    return h('label', { class: 'field' }, h('span', { class: 'flabel' }, label), control, extra || null);
  }
  // 一般文字 / 多行文字
  function fText(label, obj, key, { multi = false, onChange, type = 'text', inputmode } = {}) {
    const el = multi ? h('textarea', { rows: 2 }) : h('input', { type, inputmode });
    el.value = obj[key] ?? '';
    el.addEventListener('input', () => {
      obj[key] = el.value;
      if (multi) autoGrow(el);
      if (onChange) onChange(el.value);
      markDirty();
    });
    if (multi) requestAnimationFrame(() => autoGrow(el));
    return field(label, el);
  }
  // 可手Key + ▾ 下拉(selectOnly:只能從清單選)
  function fCombo(label, obj, key, listKey, { onPick, onInput, selectOnly = false } = {}) {
    const inp = h('input', { type: 'text', readonly: selectOnly || null, placeholder: selectOnly ? '請選擇' : '' });
    inp.value = obj[key] ?? '';
    const pick = async () => {
      const v = await openPicker({ title: label, key: listKey, selected: inp.value ? [inp.value] : [] });
      if (v == null) return;
      inp.value = v;
      obj[key] = v;
      if (onPick) onPick(v);
      markDirty();
    };
    inp.addEventListener('input', () => { obj[key] = inp.value; if (onInput) onInput(inp.value); markDirty(); });
    if (selectOnly) inp.addEventListener('click', pick);
    const wrap = h('div', { class: 'combo' }, inp, h('button', { type: 'button', class: 'combo-btn', 'aria-label': '選擇' + label, onclick: (e) => { e.preventDefault(); pick(); } }, '▾'));
    wrap.setValue = (v) => { inp.value = v ?? ''; };
    const f = field(label, wrap);
    f.combo = wrap;
    return f;
  }
  // 固定選項(按鈕式)
  function fChips(label, obj, key, options) {
    const box = h('div', { class: 'opt-chips' });
    const render = () => {
      box.innerHTML = '';
      for (const o of options) {
        box.append(h('button', {
          type: 'button', class: (obj[key] === o ? 'on ' : '') + 'chip-' + o.toLowerCase(),
          onclick: () => { obj[key] = obj[key] === o ? '' : o; render(); markDirty(); },
        }, o));
      }
    };
    render();
    return h('div', { class: 'field' }, h('span', { class: 'flabel' }, label), box);
  }
  function fDate(label, obj, key, { time = false, onChange } = {}) {
    const el = h('input', { type: time ? 'datetime-local' : 'date' });
    el.value = obj[key] || '';
    el.addEventListener('change', () => { obj[key] = el.value; if (onChange) onChange(el.value); markDirty(); });
    el.addEventListener('input', () => { obj[key] = el.value; markDirty(); });
    return field(label, el);
  }

  // 專案代號 ↔ 專案名稱 連動
  function projectPair(obj, after) {
    const findBy = (k, v) => lists().projects.find((p) => p[k] && p[k].toLowerCase() === String(v || '').trim().toLowerCase());
    let nameF;
    const codeF = fCombo('專案代號', obj, 'code', 'code', {
      onPick: (v) => { const p = findBy('code', v); if (p) { obj.name = p.name; nameF.combo.setValue(p.name); } after && after(); },
      onInput: (v) => { const p = findBy('code', v); if (p && !obj.name) { obj.name = p.name; nameF.combo.setValue(p.name); } after && after(); },
    });
    nameF = fCombo('專案名稱', obj, 'name', 'name', {
      onPick: (v) => { const p = findBy('name', v); if (p) { obj.code = p.code; codeF.combo.setValue(p.code); } after && after(); },
      onInput: () => after && after(),
    });
    return [codeF, nameF];
  }

  // 協同作業人員:清單複選 + 手Key(手Key 名單放後面)
  const splitNames = (s) => String(s || '').split(/[、,，;；\n]+/).map((x) => x.trim()).filter(Boolean);
  function fMembers(obj) {
    const all = splitNames(obj.members);
    const known = new Set(lists().members || []);
    let picked = all.filter((n) => known.has(n));
    let manual = all.filter((n) => !known.has(n));
    const chips = h('div', { class: 'member-chips' });
    const manualInp = h('input', { type: 'text', placeholder: '其他人員(手動輸入,以、分隔)' });
    manualInp.value = manual.join('、');
    const sync = () => { obj.members = [...picked, ...splitNames(manualInp.value)].join('、'); markDirty(); };
    const render = () => {
      chips.innerHTML = '';
      if (!picked.length) chips.append(h('span', { class: 'placeholder' }, '點此從清單選擇(可複選)'));
      for (const n of picked) chips.append(h('span', { class: 'mchip' }, n));
      chips.append(h('span', { class: 'caret' }, '▾'));
    };
    chips.onclick = async () => {
      const v = await openPicker({ title: '協同作業人員', key: 'members', multi: true, selected: picked });
      if (v == null) return;
      picked = v;
      render();
      sync();
    };
    manualInp.addEventListener('input', sync);
    render();
    return h('div', { class: 'field' }, h('span', { class: 'flabel' }, '協同作業人員'), chips, manualInp);
  }

  // ---------- 圖片 / 附件 ----------
  // 儲存格內每行一個檔案:「檔名 https://drive.google.com/file/d/<id>/view」
  function parseLinks(text) {
    return String(text || '').split('\n').map((s) => s.trim()).filter(Boolean).map((line) => {
      const m = /^(.*?)\s*(https?:\/\/\S+)$/.exec(line);
      if (!m) return { name: line, url: '', id: '' };
      const id = (/\/d\/([\w-]+)/.exec(m[2]) || /[?&]id=([\w-]+)/.exec(m[2]) || [])[1] || '';
      return { name: m[1] || '檔案', url: m[2], id };
    });
  }
  const joinLinks = (arr) => arr.map((x) => (x.url ? `${x.name} ${x.url}` : x.name)).join('\n');

  async function uploadFolder() {
    if (S.folderId) return S.folderId;
    const parent = S.meta && S.meta.parents && S.meta.parents[0];
    if (!parent) throw new Error('無法取得 Excel 所在資料夾,請確認雲端硬碟權限');
    S.folderId = await Drive.ensureFolder(CFG.UPLOAD_FOLDER, parent);
    return S.folderId;
  }
  // 手機照片縮到長邊 1600px(JPEG),節省空間與上傳時間
  async function shrinkImage(file) {
    if (!/^image\/(jpeg|png|webp|heic|heif)$/i.test(file.type) || !window.createImageBitmap) return file;
    try {
      const bmp = await createImageBitmap(file);
      const k = Math.min(1, 1600 / Math.max(bmp.width, bmp.height));
      if (k === 1 && file.size < 1.5e6 && /jpeg/.test(file.type)) return file;
      const c = document.createElement('canvas');
      c.width = Math.round(bmp.width * k);
      c.height = Math.round(bmp.height * k);
      c.getContext('2d').drawImage(bmp, 0, 0, c.width, c.height);
      const blob = await new Promise((r) => c.toBlob(r, 'image/jpeg', 0.85));
      return blob ? new File([blob], file.name.replace(/\.\w+$/, '') + '.jpg', { type: 'image/jpeg' }) : file;
    } catch { return file; }
  }
  async function uploadFiles(fileList, isImage, prefix) {
    const out = [];
    const files = [...fileList];
    const folder = await uploadFolder();
    for (let i = 0; i < files.length; i++) {
      busy(`上傳${isImage ? '圖片' : '附件'} ${i + 1}/${files.length}…`);
      const f = isImage ? await shrinkImage(files[i]) : files[i];
      const t = new Date();
      const stamp = `${t.getFullYear()}${pad(t.getMonth() + 1)}${pad(t.getDate())}-${pad(t.getHours())}${pad(t.getMinutes())}${pad(t.getSeconds())}`;
      const name = `${(prefix || '未填代號').replace(/[\\/:*?"<>|]/g, '_')}_${stamp}_${f.name}`;
      const meta = await Drive.createFile(name, f, f.type || 'application/octet-stream', [folder]);
      if (editing) editing.uploads.push(meta.id);
      out.push({ name: f.name, id: meta.id, url: Drive.viewLink(meta.id) });
    }
    busy('');
    return out;
  }

  const thumbCache = new Map();
  function loadThumb(img, id) {
    if (!id) return;
    if (!thumbCache.has(id)) thumbCache.set(id, Drive.media(id).then((b) => URL.createObjectURL(b)));
    thumbCache.get(id).then((u) => { img.src = u; }).catch(() => { thumbCache.delete(id); img.alt = '無法載入'; img.classList.add('broken'); });
  }
  function openLightbox(link) {
    $('lightboxImg').removeAttribute('src');
    loadThumb($('lightboxImg'), link.id);
    $('lightboxLink').href = link.url || '#';
    $('lightbox').hidden = false;
  }
  $('lightbox').onclick = (e) => { if (e.target.id !== 'lightboxLink') $('lightbox').hidden = true; };

  // 檔案欄位(圖片或附件)
  function fFiles(label, obj, key, { image = false, prefix = () => '' } = {}) {
    const box = h('div', { class: image ? 'gallery' : 'attach-list' });
    const input = h('input', { type: 'file', multiple: true, accept: image ? 'image/*' : null, hidden: true });
    const render = () => {
      box.innerHTML = '';
      const links = parseLinks(obj[key]);
      links.forEach((ln, i) => {
        const remove = h('button', {
          type: 'button', class: 'x', 'aria-label': '移除', onclick: async (e) => {
            e.stopPropagation();
            if (!(await confirmYes('移除' + label, `移除「${ln.name}」?`, '移除', 'btn-danger'))) return;
            const arr = parseLinks(obj[key]);
            arr.splice(i, 1);
            obj[key] = joinLinks(arr);
            // 這次剛上傳、尚未存檔的檔案直接移到垃圾桶
            if (editing && editing.uploads.includes(ln.id)) { editing.uploads = editing.uploads.filter((x) => x !== ln.id); Drive.trash(ln.id).catch(() => {}); }
            render();
            markDirty();
          },
        }, '✕');
        if (image) {
          const img = h('img', { alt: ln.name, loading: 'lazy' });
          loadThumb(img, ln.id);
          box.append(h('div', { class: 'thumb', title: ln.name, onclick: () => (ln.id ? openLightbox(ln) : null) }, img, remove));
        } else {
          box.append(h('div', { class: 'attach' },
            ln.url ? h('a', { href: ln.url, target: '_blank', rel: 'noopener' }, '📎 ' + ln.name) : h('span', {}, '📎 ' + ln.name), remove));
        }
      });
      box.append(h('button', { type: 'button', class: image ? 'thumb add' : 'btn btn-ghost btn-sm', onclick: () => input.click() }, image ? '＋ 圖片' : '＋ 上傳附件'));
    };
    input.onchange = async () => {
      if (!input.files.length) return;
      try {
        const added = await uploadFiles(input.files, image, prefix());
        obj[key] = joinLinks([...parseLinks(obj[key]), ...added]);
        render();
        markDirty();
      } catch (err) { busy(''); toast(errMsg(err), 5000); }
      input.value = '';
    };
    render();
    return h('div', { class: 'field' }, h('span', { class: 'flabel' }, label), box, input);
  }

  // ---------- 專案履歷列表 ----------
  const remainCount = (r) => r.problems.filter((p) => p.remain).length;
  function showList() {
    showView('listView', { title: 'ATK專案履歷', sub: fileLine() });
    fillCodeFilter();
    renderList();
  }
  function fillCodeFilter() {
    const codes = [...new Set([...S.data.resumes.map((r) => r.code), ...lists().projects.map((p) => p.code)].filter(Boolean))].sort();
    const sel = $('fCodeSel');
    sel.innerHTML = '';
    sel.append(h('option', { value: '' }, '全部專案'));
    for (const c of codes) sel.append(h('option', { value: c }, c));
  }
  function renderList() {
    const code = $('fCode').value.trim().toLowerCase();
    const from = $('fFrom').value, to = $('fTo').value;
    const items = S.data.resumes.filter((r) => {
      if (code && !String(r.code || '').toLowerCase().includes(code) && !String(r.name || '').toLowerCase().includes(code)) return false;
      const d = String(r.start || '').slice(0, 10);
      if ((from || to) && !d) return false;
      if (from && d < from) return false;
      if (to && d > to) return false;
      return true;
    }).sort((a, b) => String(b.start || '').localeCompare(String(a.start || '')));
    const box = $('resumeList');
    box.innerHTML = '';
    for (const r of items) {
      const probs = r.problems.filter((p) => p.problem).length;
      const rc = remainCount(r);
      box.append(h('a', { class: 'card', href: '#/r/' + encodeURIComponent(r.id) },
        h('div', { class: 'card-top' },
          h('span', { class: 'date' }, fmtDT(r.start) || '未填日期'),
          r.stage ? h('span', { class: 'chip' }, r.stage) : null,
          r.unit ? h('span', { class: 'chip' }, r.unit) : null),
        h('div', { class: 'card-title' }, h('span', { class: 'code' }, r.code || '(未填代號)'), ' ', r.name || ''),
        h('div', { class: 'card-sub' }, [r.plant, r.line, r.equip].filter(Boolean).join(' / ') || ' '),
        r.work ? h('div', { class: 'ptext' }, r.work) : null,
        h('div', { class: 'card-foot' },
          h('span', {}, `問題 ${probs}`),
          rc ? h('span', { class: 'warn' }, `殘件 ${rc}`) : null,
          r.hours !== '' && r.hours != null ? h('span', {}, `報工 ${r.hours} hr`) : null,
          r.members ? h('span', { class: 'members' }, '👥 ' + r.members) : null)));
    }
    $('listEmpty').hidden = items.length > 0;
    $('listCount').textContent = `共 ${items.length} 份專案履歷` + (items.length !== S.data.resumes.length ? `(全部 ${S.data.resumes.length})` : '');
  }
  let filterTimer;
  $('fCode').oninput = () => { clearTimeout(filterTimer); filterTimer = setTimeout(renderList, 150); };
  $('fCodeSel').onchange = () => { $('fCode').value = $('fCodeSel').value; $('fCodeSel').value = ''; renderList(); };
  $('fFrom').onchange = renderList;
  $('fTo').onchange = renderList;
  $('fClear').onclick = () => { $('fCode').value = ''; $('fFrom').value = ''; $('fTo').value = ''; renderList(); };
  $('addResume').onclick = () => go('#/r/new');

  // ---------- 專案履歷編輯 ----------
  const blankProblem = () => ({ problem: '', images: '', files: '', cause: '', temp: '', perm: '', result: '', note: '', remain: '' });
  function resumeTitle(r) {
    const t = [fmtDate(r.start), r.code, r.name].filter(Boolean).join(' ');
    return (t ? t + ' ' : '') + '專案履歷';
  }
  function nowRounded() {
    const t = new Date();
    t.setMinutes(Math.floor(t.getMinutes() / 10) * 10);
    return `${t.getFullYear()}-${pad(t.getMonth() + 1)}-${pad(t.getDate())}T${pad(t.getHours())}:${pad(t.getMinutes())}`;
  }

  function openResume(id) {
    let obj, isNew = false;
    if (id === 'new') {
      isNew = true;
      obj = { id: Store.newId('PR'), saved: true, code: '', name: '', plant: '', line: '', equip: '', unit: '', stage: '', start: nowRounded(), end: '', hours: '', members: '', work: '', problems: [blankProblem()] };
    } else {
      const r = S.data.resumes.find((x) => x.id === id);
      if (!r) { toast('找不到此專案履歷(可能已被刪除,或請重新載入)', 4000); replaceHash('#/'); showList(); return; }
      obj = clone(r);
      if (!obj.problems.length) obj.problems.push(blankProblem());
    }
    editing = { type: 'resume', obj, snapshot: JSON.stringify(obj), isNew, uploads: [] };
    showView('resumeView', { title: resumeTitle(obj), sub: isNew ? '新增專案履歷' : fileLine(), back: '#/', save: true, link: true });
    renderResumeForm();
    markDirty();
  }

  function renderResumeForm() {
    const obj = editing.obj;
    const upTitle = () => setTitle(resumeTitle(obj));
    let hoursAuto = obj.hours === '' || obj.hours == null;
    const hoursF = fText('報工時數', obj, 'hours', { inputmode: 'decimal', onChange: () => { hoursAuto = false; } });
    const hoursInp = hoursF.querySelector('input');
    const calcHours = () => {
      if (!hoursAuto || !obj.start || !obj.end) return;
      const ms = new Date(obj.end) - new Date(obj.start);
      if (!(ms > 0)) return;
      obj.hours = Math.round(ms / 360000) / 10;
      hoursInp.value = obj.hours;
      markDirty();
    };
    const box = $('headFields');
    box.innerHTML = '';
    box.append(
      ...projectPair(obj, upTitle),
      fText('作業廠區', obj, 'plant'),
      fText('線別', obj, 'line'),
      fText('設備名稱', obj, 'equip'),
      fCombo('單元', obj, 'unit', 'unit'),
      fCombo('專案階段', obj, 'stage', 'stage'),
      fDate('作業開始時間', obj, 'start', { time: true, onChange: () => { upTitle(); calcHours(); } }),
      fDate('作業結束時間', obj, 'end', { time: true, onChange: calcHours }),
      hoursF,
      fMembers(obj),
      fText('工作內容', obj, 'work', { multi: true }),
    );
    box.lastChild.classList.add('span2');
    renderProblems();
  }

  function renderProblems() {
    const obj = editing.obj;
    const box = $('problemList');
    box.innerHTML = '';
    obj.problems.forEach((p, i) => {
      const del = h('button', {
        type: 'button', class: 'link-btn danger', onclick: async () => {
          const msg = p.remain ? `問題 ${i + 1} 已轉為殘件;刪除此問題不會刪除殘件項目。確定刪除?` : `確定刪除問題 ${i + 1}?`;
          if (!(await confirmYes('刪除問題', msg, '刪除', 'btn-danger'))) return;
          obj.problems.splice(i, 1);
          if (!obj.problems.length) obj.problems.push(blankProblem());
          renderProblems();
          markDirty();
        },
      }, '刪除');
      const prefix = () => obj.code || obj.name;
      box.append(h('div', { class: 'panel problem' },
        h('div', { class: 'panel-title row' }, h('span', {}, `問題 ${i + 1}`),
          p.remain ? h('span', { class: 'badge-remain' }, '已轉殘件') : null, h('span', { class: 'grow' }), del),
        h('div', { class: 'fields' },
          fText('問題描述', p, 'problem', { multi: true }),
          fFiles('圖片', p, 'images', { image: true, prefix }),
          fFiles('附件', p, 'files', { prefix }),
          fText('發生原因', p, 'cause', { multi: true }),
          fText('暫定對策', p, 'temp', { multi: true }),
          fText('永久對策', p, 'perm', { multi: true }),
          fText('處理結果', p, 'result', { multi: true }),
          fText('備註', p, 'note', { multi: true }))));
    });
  }
  $('addProblem').onclick = () => {
    editing.obj.problems.push(blankProblem());
    renderProblems();
    markDirty();
    const panels = $('problemList').children;
    panels[panels.length - 1].scrollIntoView({ behavior: 'smooth', block: 'start' });
  };

  // 存回:以履歷編號找到檔案中的同一份履歷並取代(新的接在最後)
  function applyResume(d, res) {
    d.changed.add('resume');
    const i = d.resumes.findIndex((r) => r.id === res.id);
    if (i >= 0) d.resumes[i] = res;
    else if (editing && editing.isNew) d.resumes.push(res);
    else throw new Error('雲端上的這份履歷已被刪除或在 Excel 中被修改,無法對應;請重新載入後再編輯');
    if (!res.saved) { res.id = Store.newId('PR'); res.saved = true; }
  }
  async function saveResume() {
    const obj = editing.obj;
    if (!String(obj.code || '').trim() && !String(obj.name || '').trim()) { toast('請填寫專案代號或專案名稱'); return false; }
    if (obj.start && obj.end && obj.end < obj.start) { toast('作業結束時間早於開始時間,請確認'); return false; }
    const res = clone(obj);
    try {
      await commit('儲存專案履歷…', (d) => applyResume(d, res));
    } catch (err) { toast('儲存失敗:' + errMsg(err), 6000); return false; }
    afterResumeSaved(res);
    toast('✅ 已儲存到雲端硬碟');
    return true;
  }
  function afterResumeSaved(res) {
    editing.isNew = false;
    editing.uploads = [];
    editing.obj = clone(res);
    editing.snapshot = JSON.stringify(editing.obj);
    replaceHash('#/r/' + encodeURIComponent(res.id));
    setTitle(resumeTitle(res), fileLine());
    renderResumeForm();
    markDirty();
  }

  $('saveBtn').onclick = () => (editing && editing.type === 'remain' ? saveRemain() : saveResume());

  // 複製連結(尚未儲存時先儲存)
  $('linkBtn').onclick = async () => {
    if (!editing || editing.type !== 'resume') return;
    if (editing.isNew || isDirty()) {
      if (!(await confirmYes('複製連結', '需要先儲存這份專案履歷,才能產生連結。', '儲存並複製'))) return;
      if (!(await saveResume())) return;
    }
    const url = location.origin + location.pathname + '#/r/' + encodeURIComponent(editing.obj.id);
    const title = resumeTitle(editing.obj);
    try {
      await navigator.clipboard.writeText(url);
      toast('🔗 已複製連結');
    } catch {
      // 部分手機瀏覽器在非直接點擊時不允許寫入剪貼簿 → 顯示連結讓使用者再按一次
      const inp = h('input', { type: 'text', readonly: true, class: 'link-box' });
      inp.value = url;
      const body = h('div', {}, h('div', { class: 'hint' }, title), inp);
      setTimeout(() => inp.select(), 50);
      const ok = await dialog('專案履歷連結', body, [{ label: '關閉', value: false }, { label: '複製', value: true, cls: 'btn-primary' }]);
      if (ok) {
        inp.select();
        try { await navigator.clipboard.writeText(url); toast('🔗 已複製連結'); } catch { document.execCommand('copy'); toast('🔗 已複製連結'); }
      }
    }
  };

  $('deleteResume').onclick = async () => {
    const obj = editing.obj;
    if (editing.isNew) { editing.snapshot = JSON.stringify(obj); await discardEditing(); go('#/'); return; }
    if (!(await confirmYes('刪除專案履歷', `確定刪除「${resumeTitle(obj)}」?\n(已轉出的殘件項目會保留)`, '刪除', 'btn-danger'))) return;
    try {
      await commit('刪除專案履歷…', (d) => { d.resumes = d.resumes.filter((r) => r.id !== obj.id); d.changed.add('resume'); });
    } catch (err) { return toast('刪除失敗:' + errMsg(err), 6000); }
    editing = null;
    toast('已刪除');
    go('#/');
  };

  // 殘件:把未處理完的問題轉為殘件項目
  $('toRemain').onclick = async () => {
    const obj = editing.obj;
    if (!String(obj.code || '').trim()) return toast('請先填寫專案代號');
    const cands = obj.problems.map((p, i) => ({ p, i })).filter(({ p }) => String(p.problem || '').trim());
    if (!cands.length) return toast('請先填寫問題描述');
    const checks = [];
    const body = h('div', { class: 'remain-pick' }, h('div', { class: 'hint' }, '勾選要轉為殘件項目的問題(日期、專案、問題描述、原因、對策會自動帶入):'));
    for (const { p, i } of cands) {
      const cb = h('input', { type: 'checkbox' });
      cb.checked = !p.remain && !String(p.result || '').trim();
      if (p.remain) cb.disabled = true;
      checks.push({ cb, i });
      body.append(h('label', { class: 'pick-row' + (p.remain ? ' done' : '') }, cb,
        h('span', {}, h('b', {}, `問題 ${i + 1}`), p.remain ? '(已轉殘件)' : '', h('br'), String(p.problem).slice(0, 80))));
    }
    if (!(await dialog('轉為殘件項目', body, [{ label: '取消', value: false }, { label: '轉為殘件', value: true, cls: 'btn-warn' }]))) return;
    const chosen = checks.filter((c) => c.cb.checked && !c.cb.disabled).map((c) => c.i);
    if (!chosen.length) return toast('沒有勾選任何問題');
    const res = clone(obj);
    let items = [];
    try {
      await commit('轉為殘件項目…', (d) => {
        for (const i of chosen) res.problems[i].remain = 'V';
        applyResume(d, res); // 同時儲存履歷(暫時編號會在這裡換成正式編號)
        items = chosen.map((i) => {
          const p = res.problems[i];
          return {
            id: Store.newId('RI'), saved: true, date: String(res.start || '').slice(0, 10) || todayISO(), code: res.code, name: res.name,
            problem: p.problem, cause: p.cause, temp: p.temp, perm: p.perm, ecn: '', dept: '', owner: '', due: '', progress: '',
            status: 'Open', note: '', files: [p.images, p.files].filter(Boolean).join('\n'), src: `${res.id} #${i + 1}`,
          };
        });
        d.remains.push(...items);
        d.changed.add('remain');
      });
    } catch (err) { return toast('轉殘件失敗:' + errMsg(err), 6000); }
    afterResumeSaved(res);
    const goNow = await dialog('已轉為殘件', `已新增 ${items.length} 筆殘件項目(專案 ${res.code}),履歷也已一併儲存。`, [
      { label: '留在此頁', value: false }, { label: '前往殘件項目', value: true, cls: 'btn-primary' },
    ]);
    if (goNow) go('#/remain?p=' + encodeURIComponent(res.code));
  };

  // ---------- 殘件項目 ----------
  const LS_RP = 'pr_remain_project';
  const isOverdue = (r) => r.status !== 'Close' && r.due && r.due < todayISO();
  function remainProjects() {
    const map = new Map();
    for (const r of S.data.remains) if (r.code && !map.has(r.code)) map.set(r.code, r.name || '');
    for (const p of lists().projects) if (p.code && map.has(p.code) && !map.get(p.code)) map.set(p.code, p.name);
    return [...map.entries()].sort((a, b) => a[0].localeCompare(b[0]));
  }
  function showRemainList(p) {
    const projects = remainProjects();
    let code = p != null ? p : (ssGet(LS_RP) ?? '');
    if (code && !projects.some(([c]) => c === code) && p == null) code = '';
    const sel = $('rProject');
    sel.innerHTML = '';
    sel.append(h('option', { value: '' }, `全部專案(${S.data.remains.length})`));
    for (const [c, n] of projects) {
      const cnt = S.data.remains.filter((r) => r.code === c).length;
      sel.append(h('option', { value: c }, `${c} ${n}(${cnt})`));
    }
    if (code && !projects.some(([c]) => c === code)) sel.append(h('option', { value: code }, `${code}(0)`));
    sel.value = code;
    ssSet(LS_RP, code);
    showView('remainView', { title: '殘件項目', sub: fileLine() });
    renderRemainList();
  }
  function currentRemains() {
    const code = $('rProject').value, st = $('rStatus').value;
    return S.data.remains.filter((r) => (!code || r.code === code) && (!st || (r.status || 'Open') === st))
      .sort((a, b) => (a.status === 'Close') - (b.status === 'Close') || String(b.date || '').localeCompare(String(a.date || '')));
  }
  function renderRemainList() {
    const items = currentRemains();
    const box = $('remainList');
    box.innerHTML = '';
    for (const r of items) {
      const st = r.status || 'Open';
      box.append(h('a', { class: 'card' + (st === 'Close' ? ' closed' : ''), href: '#/remain/' + encodeURIComponent(r.id) },
        h('div', { class: 'card-top' },
          h('span', { class: 'status st-' + st.toLowerCase() }, st),
          h('span', { class: 'date' }, fmtDate(r.date)),
          r.ecn === '是' ? h('span', { class: 'chip ecn' }, 'ECN') : null,
          h('span', { class: 'code small' }, r.code || '')),
        h('div', { class: 'card-title t2' }, r.problem || '(未填問題描述)'),
        r.progress ? h('div', { class: 'ptext' }, '進度:' + r.progress) : null,
        h('div', { class: 'card-foot' },
          r.owner ? h('span', {}, '👤 ' + r.owner) : null,
          r.dept ? h('span', {}, r.dept) : null,
          r.due ? h('span', { class: isOverdue(r) ? 'overdue' : '' }, '期限 ' + fmtDate(r.due) + (isOverdue(r) ? '(逾期)' : '')) : null)));
    }
    $('remainEmpty').hidden = items.length > 0;
    const open = items.filter((r) => (r.status || 'Open') !== 'Close').length;
    $('remainCount').textContent = `共 ${items.length} 筆,Open ${open} 筆`;
  }
  $('rProject').onchange = () => { ssSet(LS_RP, $('rProject').value); replaceHash('#/remain' + ($('rProject').value ? '?p=' + encodeURIComponent($('rProject').value) : '')); renderRemainList(); };
  $('rStatus').onchange = renderRemainList;
  $('addRemain').onclick = () => go('#/remain/new' + ($('rProject').value ? '?p=' + encodeURIComponent($('rProject').value) : ''));
  $('exportRemain').onclick = async () => {
    const items = currentRemains();
    if (!items.length) return toast('沒有可匯出的殘件項目');
    const code = $('rProject').value;
    const proj = code ? `${code} ${remainProjects().find(([c]) => c === code)?.[1] || ''}`.trim() : '全部專案';
    const st = $('rStatus').value;
    const t = todayISO().replace(/-/g, '');
    const bytes = Exporter.build(items, `${proj} 殘件項目${st ? `(${st})` : ''}　匯出日期 ${fmtDate(todayISO())}`);
    const name = `殘件項目_${(code || '全部').replace(/[\\/:*?"<>|]/g, '_')}_${t}.xlsx`;
    const type = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
    const file = new File([bytes], name, { type });
    // 手機(觸控裝置)優先用分享選單,可直接存到「檔案」或傳給別人
    if (navigator.canShare && matchMedia('(pointer: coarse)').matches && navigator.canShare({ files: [file] })) {
      try { await navigator.share({ files: [file], title: name }); return; } catch (e) { if (e.name === 'AbortError') return; }
    }
    const a = h('a', { href: URL.createObjectURL(file), download: name });
    document.body.append(a);
    a.click();
    setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1500);
    toast('已匯出 ' + name);
  };

  // ---------- 殘件編輯 ----------
  function openRemain(id, p) {
    let obj, isNew = false;
    if (id === 'new') {
      isNew = true;
      const proj = p ? lists().projects.find((x) => x.code === p) || S.data.remains.find((x) => x.code === p) : null;
      obj = { id: Store.newId('RI'), saved: true, date: todayISO(), code: p || '', name: proj ? proj.name || '' : '', problem: '', cause: '', temp: '', perm: '', ecn: '', dept: '', owner: '', due: '', progress: '', status: 'Open', note: '', files: '', src: '' };
    } else {
      const r = S.data.remains.find((x) => x.id === id);
      if (!r) { toast('找不到此殘件項目(可能已被刪除,或請重新載入)', 4000); replaceHash('#/remain'); showRemainList(); return; }
      obj = clone(r);
    }
    editing = { type: 'remain', obj, snapshot: JSON.stringify(obj), isNew, uploads: [] };
    const back = '#/remain' + (obj.code ? '?p=' + encodeURIComponent(obj.code) : '');
    showView('remainEditView', { title: isNew ? '新增殘件' : '殘件項目', sub: [obj.code, obj.name].filter(Boolean).join(' '), back, save: true });
    renderRemainForm();
    markDirty();
  }
  function renderRemainForm() {
    const obj = editing.obj;
    const box = $('remainFields');
    box.innerHTML = '';
    const srcId = (/^(\S+)/.exec(obj.src || '') || [])[1];
    const srcResume = srcId && S.data.resumes.find((r) => r.id === srcId);
    box.append(
      fDate('日期', obj, 'date'),
      ...projectPair(obj, () => setTitle($('pageTitle').textContent, [obj.code, obj.name].filter(Boolean).join(' '))),
      fText('問題描述', obj, 'problem', { multi: true }),
      fText('發生原因', obj, 'cause', { multi: true }),
      fText('暫定對策', obj, 'temp', { multi: true }),
      fText('永久對策', obj, 'perm', { multi: true }),
      fChips('ECN', obj, 'ecn', CFG.ECN_OPTIONS),
      fCombo('權責區分', obj, 'dept', 'dept', { selectOnly: true }),
      fCombo('負責人', obj, 'owner', 'owner', { selectOnly: true }),
      fDate('改善期限', obj, 'due'),
      fText('改善進度及結果', obj, 'progress', { multi: true }),
      fChips('狀態', obj, 'status', CFG.STATUS_OPTIONS),
      fFiles('附件', obj, 'files', { prefix: () => obj.code || obj.name }),
      fText('備註', obj, 'note', { multi: true }),
      obj.src ? h('div', { class: 'field' }, h('span', { class: 'flabel' }, '來源'),
        srcResume ? h('a', { href: '#/r/' + encodeURIComponent(srcResume.id), class: 'src-link' }, `${resumeTitle(srcResume)}(${obj.src.split(' ').slice(1).join(' ')})`)
          : h('span', { class: 'hint' }, obj.src)) : null,
    );
  }
  async function saveRemain() {
    const obj = editing.obj;
    if (!String(obj.code || '').trim()) { toast('請填寫專案代號'); return false; }
    if (!String(obj.problem || '').trim()) { toast('請填寫問題描述'); return false; }
    const rec = clone(obj);
    try {
      await commit('儲存殘件項目…', (d) => {
        d.changed.add('remain');
        const i = d.remains.findIndex((r) => r.id === rec.id);
        if (i >= 0) d.remains[i] = rec;
        else if (editing.isNew) d.remains.push(rec);
        else throw new Error('雲端上的這筆殘件已被刪除或在 Excel 中被修改,無法對應;請重新載入後再編輯');
        if (!rec.saved) { rec.id = Store.newId('RI'); rec.saved = true; }
      });
    } catch (err) { toast('儲存失敗:' + errMsg(err), 6000); return false; }
    editing.isNew = false;
    editing.uploads = [];
    editing.obj = clone(rec);
    editing.snapshot = JSON.stringify(editing.obj);
    replaceHash('#/remain/' + encodeURIComponent(rec.id));
    setTitle('殘件項目', [rec.code, rec.name].filter(Boolean).join(' '));
    $('backBtn').dataset.to = '#/remain?p=' + encodeURIComponent(rec.code);
    renderRemainForm(); // 欄位改綁到存檔後的新物件
    markDirty();
    toast('✅ 已儲存到雲端硬碟');
    return true;
  }
  $('deleteRemain').onclick = async () => {
    const obj = editing.obj;
    const back = '#/remain' + (obj.code ? '?p=' + encodeURIComponent(obj.code) : '');
    if (editing.isNew) { editing.snapshot = JSON.stringify(obj); await discardEditing(); go(back); return; }
    if (!(await confirmYes('刪除殘件項目', `確定刪除這筆殘件?\n${String(obj.problem || '').slice(0, 60)}`, '刪除', 'btn-danger'))) return;
    try {
      await commit('刪除殘件項目…', (d) => { d.remains = d.remains.filter((r) => r.id !== obj.id); d.changed.add('remain'); });
    } catch (err) { return toast('刪除失敗:' + errMsg(err), 6000); }
    editing = null;
    toast('已刪除');
    go(back);
  };

  // ---------- 設定 ----------
  function showSettings() {
    showView('settingsView', { title: '設定', sub: fileLine() });
    const m = S.meta || {};
    const who = m.lastModifyingUser ? m.lastModifyingUser.displayName : '';
    $('acctInfo').innerHTML = '';
    $('acctInfo').append(
      h('div', {}, h('b', {}, S.user ? S.user.displayName : ''), ' ', h('span', { class: 'hint' }, S.user ? S.user.emailAddress : '')),
      h('div', { class: 'hint' }, `${CFG.FILE_NAME}:${m.modifiedTime ? new Date(m.modifiedTime).toLocaleString('zh-TW') : ''}${who ? ' 由 ' + who + ' 更新' : ''}` +
        (m.capabilities && m.capabilities.canEdit === false ? '(此帳號只有檢視權限)' : '')),
      h('div', { class: 'hint' }, `專案履歷 ${S.data.resumes.length} 份、殘件 ${S.data.remains.length} 筆`));
    renderListEditors();
  }
  function renderListEditors() {
    const box = $('listEditors');
    box.innerHTML = '';
    for (const L of CFG.LISTS) {
      const items = L.key === 'project' ? lists().projects : (lists()[L.key] || []);
      const ul = h('div', { class: 'list-items' });
      for (const it of items) {
        const label = L.key === 'project' ? h('span', {}, h('b', {}, it.code || '(無代號)'), ' ', it.name) : h('span', {}, it);
        ul.append(h('div', { class: 'list-item' }, label, h('button', {
          type: 'button', class: 'del-btn', 'aria-label': '刪除', onclick: async () => {
            const name = L.key === 'project' ? `${it.code} ${it.name}` : it;
            if (!(await confirmYes('刪除選單項目', `確定從「${L.label}」刪除「${name}」?\n(已填入資料的內容不受影響)`, '刪除', 'btn-danger'))) return;
            try { await choiceRemove(L.key, it); toast('已刪除'); } catch (err) { toast(errMsg(err), 5000); }
            renderListEditors();
          },
        }, '🗑')));
      }
      const inputs = L.key === 'project'
        ? [h('input', { type: 'text', placeholder: '專案代號' }), h('input', { type: 'text', placeholder: '專案名稱' })]
        : [h('input', { type: 'text', placeholder: '新增項目' })];
      const addBtn = h('button', {
        type: 'button', class: 'btn btn-primary btn-sm', onclick: async () => {
          const vals = inputs.map((x) => x.value.trim());
          if (vals.some((v) => !v)) return toast(L.key === 'project' ? '請輸入專案代號與專案名稱' : '請輸入項目名稱');
          try { await choiceAdd(L.key, L.key === 'project' ? { code: vals[0], name: vals[1] } : vals[0]); toast('已新增'); } catch (err) { return toast(errMsg(err), 5000); }
          renderListEditors();
        },
      }, '＋ 加入');
      box.append(h('details', { class: 'panel list-panel', open: L.key !== 'project' || null },
        h('summary', { class: 'panel-title' }, `${L.label}`, h('span', { class: 'count' }, String(items.length))),
        ul, h('div', { class: 'add-row' + (L.key === 'project' ? ' two' : '') }, ...inputs, addBtn)));
    }
  }
  $('reloadBtn').onclick = async () => {
    try { await reload(); toast('已重新載入'); showSettings(); } catch (err) { toast(errMsg(err), 5000); }
  };
  $('openDriveBtn').onclick = () => { if (S.meta && S.meta.webViewLink) window.open(S.meta.webViewLink, '_blank', 'noopener'); };
  $('signOutBtn').onclick = () => { Drive.signOut(); location.hash = ''; location.reload(); };
  $('signInBtn').onclick = signIn;

  // ---------- 其他 ----------
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      if (!$('lightbox').hidden) $('lightbox').hidden = true;
      else if (picker) closePicker(null);
      else toggleDrawer(false);
    }
    if ((e.ctrlKey || e.metaKey) && e.key === 's' && editing) { e.preventDefault(); $('saveBtn').click(); }
  });
  window.addEventListener('beforeunload', (e) => { if (isDirty()) { e.preventDefault(); e.returnValue = ''; } });

  // 回到 App 時(超過 3 分鐘)在列表頁自動重新讀取雲端資料
  let hiddenAt = 0;
  document.addEventListener('visibilitychange', async () => {
    if (document.visibilityState === 'hidden') { hiddenAt = Date.now(); return; }
    if (!S.ready || editing || Date.now() - hiddenAt < 180000) return;
    try { await reload(); route(); } catch {}
  });

  // ---------- 新版偵測:強制重新載入 ----------
  let updatePending = false;
  async function checkForUpdate() {
    if (updatePending || CFG.APP_VERSION.startsWith('__')) return; // 本機開發版不檢查
    let latest;
    try {
      const resp = await fetch('version.json?t=' + Date.now(), { cache: 'no-store' });
      if (!resp.ok) return;
      latest = (await resp.json()).version;
    } catch { return; }
    if (!latest || latest === CFG.APP_VERSION) return;
    updatePending = true;
    while (isDirty()) {
      await dialog('程式已更新', '「ATK專案履歷」有新版本,必須更新後才能繼續使用。\n目前有尚未儲存的修改,將先儲存再更新。', [{ label: '儲存並更新', value: true, cls: 'btn-primary' }]);
      const ok = editing.type === 'remain' ? await saveRemain() : await saveResume();
      if (!ok) toast('儲存未完成,請處理後再按一次「儲存並更新」', 5000);
    }
    toast('程式已更新,正在重新載入…', 3000);
    if (navigator.serviceWorker) navigator.serviceWorker.getRegistration().then((r) => r && r.update()).catch(() => {});
    const url = new URL(location.href);
    url.searchParams.set('u', latest);
    setTimeout(() => location.replace(url.toString()), 600);
  }
  if (new URLSearchParams(location.search).has('u')) {
    const url = new URL(location.href);
    url.searchParams.delete('u');
    history.replaceState(null, '', url.pathname + url.search + url.hash);
  }
  checkForUpdate();
  setInterval(checkForUpdate, CFG.VERSION_CHECK_MINUTES * 60000);
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') checkForUpdate(); });

  if ('serviceWorker' in navigator && location.protocol === 'https:') navigator.serviceWorker.register('sw.js').catch(() => {});

  route();
  // 本機模擬模式自動登入
  if (window.Drive && Drive.__reset) signIn();

  window.__pr = { S, Store, commit, get editing() { return editing; } };
})();
