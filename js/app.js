// app.js - 主流程與 UI(專案履歷 / 殘件項目 / 設定)
(function () {
  const CFG = window.APP_CONFIG;
  const $ = (id) => document.getElementById(id);
  const S = { user: null, fileId: null, meta: null, data: null, folderId: null, ready: false };
  let editing = null; // { type:'resume'|'remain'|'pm'|'sched'|'work', obj, snapshot, isNew, uploads:[] }

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
      // 由登入鍵直接開 Google 視窗;此裝置登入過就不再顯示選帳號畫面
      if (!Drive.isSignedIn()) await Drive.requestToken(Drive.savedAccount() ? '' : undefined);
      S.user = await Drive.whoAmI().catch(() => null);
      if (S.user) $('userLine').textContent = `${S.user.displayName}\n${S.user.emailAddress}`;
      busy(`尋找「${CFG.FILE_NAME}」…`);
      const f = await findResumeFile();
      if (!f) {
        busy('');
        $('welcomeMsg').textContent = `找不到「${CFG.FILE_NAME}」,或帳號 ${S.user ? S.user.emailAddress : ''} 沒有權限。請確認共用雲端硬碟 ATK 的共用設定。`;
        $('signInBtn').textContent = '改用其他帳號登入';
        $('signInBtn').onclick = () => { Drive.signOut(); location.reload(); };
        return;
      }
      S.fileId = f.id;
      await reload();
      // 只允許「設定 → 公司人員」名單中有 E-Mail 的人(管理者除外)
      if (!isAdmin() && !staffOfEmail(myEmail())) {
        S.data = S.meta = S.fileId = null;
        $('welcomeMsg').textContent = `帳號 ${myEmail()} 不在公司人員名單中,無法使用。請聯絡管理者在「設定 → 公司人員」加入您的 E-Mail。`;
        $('signInBtn').textContent = '改用其他帳號登入';
        $('signInBtn').onclick = () => { Drive.signOut(); location.reload(); };
        return;
      }
      S.ready = true;
      applyPerms();
      WorkList.available().then((ok) => { $('navWork').hidden = $('navGantt').hidden = !ok; });
      if (can('pmView')) pmLoad(false, true).then(() => { if (!$('listView').hidden) fillCodeFilter(); }).catch(() => {}); // 專案清單以專案管理檔為準
      route();
    } catch (err) {
      if (err && err.type === 'redirect_stuck') { busy(''); openInBrowser(true); } else toast(errMsg(err), 5000);
    } finally { busy(''); }
  }
  // 釘釘等 App 內建瀏覽器無法完成 Google 登入:引導改用 Chrome/Safari 開啟(Android 可直接叫起 Chrome)
  function openInBrowser(stuck) {
    const url = location.origin + location.pathname + location.hash;
    const btns = [{ label: '取消', value: '' }, { label: '複製網址', value: 'copy' }];
    if (Drive.IS_ANDROID) btns.push({ label: '用 Chrome 開啟', value: 'chrome', cls: 'btn-primary' });
    dialog(stuck ? '無法開啟 Google 登入' : '請改用瀏覽器開啟',
      (stuck ? '這個瀏覽器(例如釘釘內建瀏覽器)擋下了 Google 登入頁。\n' : '釘釘等 App 內建的瀏覽器無法登入 Google。\n') +
      `請點右上角「⋯」→「在瀏覽器中開啟」,或${Drive.IS_ANDROID ? '按「用 Chrome 開啟」' : '複製網址後貼到 Safari / Chrome'}。
(只看分享的專案履歷不需登入,可直接在釘釘中開啟)`, btns)
      .then(async (v) => {
        if (v === 'chrome') location.href = `intent://${location.host}${location.pathname}${location.hash}#Intent;scheme=https;package=com.android.chrome;S.browser_fallback_url=${encodeURIComponent(url)};end`;
        else if (v === 'copy') { try { await navigator.clipboard.writeText(url); toast('已複製網址,請貼到瀏覽器開啟'); } catch { toast(url, 8000); } }
      });
  }

  // 找 Project Resume.xlsx:FILE_ID 優先;依檔名找到多份時,取與附件資料夾同一個上層資料夾的那份
  async function findResumeFile() {
    if (CFG.FILE_ID) { const m = await Drive.getMeta(CFG.FILE_ID).catch(() => null); if (m) return m; } // 讀不到(ID 有誤或沒權限)時改依檔名找
    const files = await Drive.findAllByName(CFG.FILE_NAME);
    if (files.length < 2 || !CFG.UPLOAD_FOLDER_ID) return files[0] || null;
    const home = await Drive.getMeta(CFG.UPLOAD_FOLDER_ID).then((m) => m.parents || []).catch(() => []);
    return files.find((x) => (x.parents || []).some((p) => home.includes(p))) || files[0];
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
  const VIEWS = ['welcome', 'listView', 'resumeView', 'readView', 'remainView', 'remainEditView', 'pmListView', 'pmSumView', 'pmEditView', 'schedView', 'workView', 'ganttView', 'hoursView', 'hoursStatsView', 'hoursSumView', 'settingsView'];
  function showView(id, { title = 'ATK專案履歷', sub = '', back = null, save = false, link = false } = {}) {
    for (const v of VIEWS) $(v).hidden = v !== id;
    setTitle(title, sub);
    $('menuBtn').hidden = !!back;
    $('backBtn').hidden = !back;
    $('backBtn').dataset.to = back || '';
    $('saveBtn').hidden = !save;
    $('linkBtn').hidden = !link;
    $('dingBtn').hidden = !link || !CFG.SHARE_URL || !S.ready; // 發佈:只限登入的同仁(免登入檢視者不顯示)
    $('pmSumBtn').hidden = id !== 'pmListView';
    hideNav();
    for (const a of document.querySelectorAll('[data-nav]')) {
      a.classList.toggle('active', (id === 'listView' && a.dataset.nav === 'list') || (id.startsWith('remain') && a.dataset.nav === 'remain') || (id === 'settingsView' && a.dataset.nav === 'settings') || ((id.startsWith('pm') || id === 'schedView') && a.dataset.nav === 'pm') || (id === 'workView' && a.dataset.nav === 'work') || (id === 'ganttView' && a.dataset.nav === 'gantt') || (id.startsWith('hours') && a.dataset.nav === 'hours'));
    }
    document.body.classList.toggle('wide-main', id === 'ganttView');
    document.body.classList.toggle('full-title', id === 'resumeView'); // 履歷編輯頁:標題可換行完整顯示 // 甘特圖用滿整個寬度
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

  // ---------- 權限:已建立的項目只有管理者與填表人可修改 ----------
  const myEmail = () => String((S.user && S.user.emailAddress) || '').toLowerCase();
  const myName = () => (S.user && (S.user.displayName || S.user.emailAddress)) || '';
  const isAdmin = () => CFG.ADMINS.map((x) => x.toLowerCase()).includes(myEmail());
  // 各項權限(設定 → 權限;存在 Project Resume.xlsx「權限」工作表);管理者固定擁有全部權限
  let permCache = { data: null, list: null };
  function permList() {
    if (permCache.data !== S.data) permCache = { data: S.data, list: (S.data && Perms.read(S.data.book)) || null };
    return permCache.list;
  }
  const isFlag = (key) => !!(Perms.KEYS.find((k) => k.key === key) || {}).flag; // 身分註記(例如免提報工時):管理者不自動擁有
  const hasPerm = (email, key) => (permList() || []).some((p) => p.email === String(email || '').toLowerCase() && p[key]);
  const can = (key) => (isAdmin() && !isFlag(key)) || hasPerm(myEmail(), key);
  // 依權限顯示側邊選單;專案管理「只能檢視」時鎖住表單(body.pm-ro)
  function applyPerms() {
    $('navSettings').hidden = !can('settings');
    $('navPm').hidden = !can('pmView');
    $('addRemain').hidden = !can('remain');
    document.body.classList.toggle('pm-ro', !can('pmEdit'));
    // 側邊選單顯示本帳號目前生效的權限與資料版本(方便確認權限是否已套用)
    const granted = Perms.KEYS.filter((k) => can(k.key)).map((k) => k.label);
    $('permLine').textContent = (isAdmin() ? '管理者(全部權限)' : '權限:' + (granted.join('、') || '一般')) +
      (S.meta ? `
資料:${fileLine().split(' · ')[1] || ''}` : '');
  }
  function pmLock() {
    if (can('pmEdit')) return;
    for (const el of document.querySelectorAll('#pmFields :is(input, select, textarea, button), #pmTracks :is(input, select, textarea, button), #pmClosedBox :is(input, select, textarea, button), #schedHead :is(input, select, textarea, button), #schedItems :is(input, select, textarea, button)')) el.disabled = true;
  }
  const canEditRemain = () => can('remain'); // 殘件/追蹤事項:依「設定 → 權限」,不再看填表人
  const canEdit = (rec) => isAdmin() || (!!rec.authorEmail && String(rec.authorEmail).toLowerCase() === myEmail());
  const authorLine = (rec) => '填表人:' + (rec.author || '(未記錄)');
  function markDirty() { $('saveBtn').classList.toggle('dirty', isDirty()); }

  // ---------- 路由 ----------
  function parseHash() {
    const raw = location.hash.replace(/^#\/?/, '');
    const [path, qs] = raw.split('?');
    return { parts: path.split('/').filter(Boolean).map(decodeURIComponent), q: new URLSearchParams(qs || '') };
  }
  function route() {
    // 分享連結:尚未登入時經由 Apps Script 直接檢視(不需登入)
    if (!S.ready && CFG.SHARE_URL && !Drive.isSignedIn()) {
      const { parts, q } = parseHash();
      if (parts[0] === 'v' && parts[1]) { publicView(parts[1], q.get('k')); return; }
    }
    if (!S.ready) {
      showView('welcome', { title: 'ATK專案履歷' });
      const { parts } = parseHash();
      if (parts[0] === 'v' && parts[1] && !$('welcomeMsg').textContent) $('welcomeMsg').textContent = '登入後將開啟分享的專案履歷。';
      return;
    }
    const { parts, q } = parseHash();
    if (parts[0] === 'v' && parts[1]) viewResume(parts[1]);
    else if (parts[0] === 'r') openResume(parts[1] || 'new');
    else if (parts[0] === 'remain' && parts[1]) openRemain(parts[1], q.get('p'), q.get('from'));
    else if (parts[0] === 'remain') showRemainList(q.get('p'));
    else if (parts[0] === 'settings' && can('settings')) showSettings();
    else if (parts[0] === 'pm' && can('pmView') && parts[1] === 'sum') showPmSum();
    else if (parts[0] === 'pm' && can('pmView')) (parts[1] && !(parts[1] === 'new' && !can('pmEdit')) ? openPm(parts[1], q) : showPmList());
    else if (parts[0] === 'sched' && parts[1] && can('pmView')) openSched(parts[1]);
    else if (parts[0] === 'hours' && parts[1] === 'stats' && can('hoursAll')) showHourStats({ from: q.get('m'), to: q.get('to'), code: q.get('code') });
    else if (parts[0] === 'hours' && parts[1] === 'sum' && can('hoursAll')) showHourSum({ from: q.get('m'), to: q.get('to'), code: q.get('code') });
    else if (parts[0] === 'hours') showHours();
    else if (parts[0] === 'work') WorkList.show('list');
    else if (parts[0] === 'gantt') WorkList.show('gantt');
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
    if (editing && editing.type === 'work') WorkList.discard();
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
  // 專案代號/名稱清單:統一以專案管理檔(project list)為準,依年度、流水號由舊到新(存檔順序;下拉選單顯示時改為由新到舊);
  // 尚未載入或沒有權限讀專案管理檔時,用 Choice 中的清單(管理者載入專案管理檔時會自動同步到 Choice)
  function pmProjects() {
    const m = new Map();
    for (const r of S.pm.data.records) {
      const c = String(r.code || '').trim();
      if (c && !m.get(c)) m.set(c, String(r.name || '').trim());
    }
    return [...m].sort((a, b) => Store.compareCode(a[0], b[0])).map(([code, name]) => ({ code, name }));
  }
  // 人力支援等不需專案管理的專案:另存 Choice「支援專案」欄,一格一個「代號｜名稱」
  const SUP_SEP = '｜';
  function supportList() {
    return (lists().support || []).map((raw) => {
      const [code, ...rest] = String(raw).split(SUP_SEP);
      return { code: code.trim(), name: rest.join(SUP_SEP).trim(), support: true, raw };
    }).filter((p) => p.code || p.name);
  }
  function projList() {
    const base = S.pm && S.pm.data ? pmProjects() : lists().projects;
    const have = new Set(base.map((p) => p.code));
    return [...base, ...supportList().filter((p) => !have.has(p.code))];
  }
  async function syncChoiceProjects() {
    if (!can('pmEdit') || !S.pm || !S.pm.data) return;
    const want = pmProjects();
    const key = (L) => JSON.stringify(L.map((p) => [p.code, p.name]));
    if (!want.length || key(want) === key(lists().projects)) return;
    try {
      await commit('同步專案清單…', (d) => { d.choice.lists.projects = want; d.changed.add('choice'); });
    } catch (err) { toast('專案清單同步失敗:' + errMsg(err), 5000); }
  }
  const newestFirst = (a, b) => Store.compareCode(b, a); // 下拉選單:越新的專案排越上面
  const projDesc = () => projList().slice().sort((a, b) => newestFirst(a.code, b.code));
  function listValues(key) {
    if (key === 'code') return projDesc().filter((p) => p.code).map((p) => ({ value: p.code, label: p.code, sub: p.name }));
    if (key === 'name') return projDesc().filter((p) => p.name).map((p) => ({ value: p.name, label: p.name, sub: p.code }));
    const L = key === 'dept' ? withTech(lists().dept || []) : lists()[key] || []; // 權責區分補「技術」
    return L.map((v) => ({ value: v, label: v }));
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
  // 調整順序:order = 新的完整順序(下拉選單依此順序顯示;專案管理階段的順序也用於逾期判斷)
  async function choiceOrder(key, order) {
    await commit('儲存順序…', (d) => {
      const arr = d.choice.lists[key] || [];
      const rest = arr.filter((v) => !order.includes(v)); // 其他裝置剛加入的項目保留在最後
      d.choice.lists[key] = [...order.filter((v) => arr.includes(v)), ...rest];
      d.changed.add('choice');
    });
  }
  async function choiceStageColor(stage, hex) {
    await commit('儲存顏色…', (d) => {
      const L = d.choice.lists;
      L.pmStageColor = (L.pmStageColor || []).filter((v) => v.slice(0, v.lastIndexOf('=')).trim() !== stage);
      if (hex) L.pmStageColor.push(stage + '=' + hex);
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
  // opts: { title, key(code/name/unit/...), multi, selected:[], selectOnly, items(固定清單:不可新增/編輯) }
  let picker = null;
  function openPicker(opts) {
    return new Promise((resolve) => {
      picker = { ...opts, resolve, editMode: false, sel: new Set(opts.selected || []) };
      $('pickerTitle').textContent = opts.title;
      $('pickerSearch').value = '';
      $('pickerFoot').hidden = !opts.multi;
      $('pickerEdit').textContent = '編輯清單';
      $('pickerEdit').hidden = !!opts.items || listKeyOf(opts.key) === 'project'; // 專案清單在專案管理/設定維護
      renderPicker();
      $('picker').hidden = false;
      document.body.classList.add('noscroll');
      if (!matchMedia('(pointer: coarse)').matches) setTimeout(() => $('pickerSearch').focus(), 0); // 電腦版直接可打字搜尋
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
    const items = (p.items || listValues(p.key)).filter((it) => !kw || (it.label + ' ' + (it.sub || '')).toLowerCase().includes(kw));
    const box = $('pickerList');
    box.innerHTML = '';
    if (!items.length) box.append(h('div', { class: 'empty small' }, kw ? '沒有符合的項目' : '清單是空的,請在下方新增'));
    for (const it of items) {
      const on = p.sel.has(it.value);
      const row = h('div', { class: 'pick-item' + (on ? ' on' : '') },
        p.multi ? h('span', { class: 'check' }, on ? '☑' : '☐') : null,
        h('span', { class: 'pick-text' }, h('b', {}, it.label), it.sub ? h('small', {}, it.sub) : null),
        // 專案清單只能刪除「支援專案」(其餘取自專案管理),且只限管理者
        p.editMode && (listKeyOf(p.key) !== 'project' || (can('settings') && (projList().find((x) => x[p.key] === it.value) || {}).support)) ? h('button', {
          type: 'button', class: 'del-btn', 'aria-label': '刪除', onclick: async (e) => {
            e.stopPropagation();
            const lk = listKeyOf(p.key);
            const item = lk === 'project' ? projList().find((x) => x[p.key] === it.value) : it.value;
            const label = lk === 'project' ? `${item.code} ${item.name}` : item;
            if (!(await confirmYes('刪除選單項目', `確定從清單刪除「${label}」?\n(已填入資料的內容不受影響)`, '刪除', 'btn-danger'))) return;
            try { await (lk === 'project' ? choiceRemove('support', item.raw) : choiceRemove(lk, item)); p.sel.delete(it.value); } catch (err) { toast(errMsg(err), 5000); }
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
    if (p.items) return;
    const lk = listKeyOf(p.key);
    if (lk === 'project') {
      // 專案清單:取自專案管理;人力支援專案只在「設定」新增
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
  // 單選清單:搜尋框按 Enter 選第一筆
  $('pickerSearch').onkeydown = (e) => {
    if (e.key !== 'Enter' || !picker || picker.multi) return;
    e.preventDefault();
    const first = $('pickerList').querySelector('.pick-item');
    if (first) first.click();
  };
  // 手機:專案選擇的原生下拉(寬度窄、名稱擠在一起)改開底部清單 — 一行代號、一行名稱,可搜尋
  // always:電腦版也改開清單(需要關鍵字搜尋時)
  function sheetSelect(sel, title, always = false) {
    if (!always && !(Drive.IS_MOBILE || matchMedia('(pointer: coarse)').matches)) return;
    const open = async (e) => {
      e.preventDefault();
      sel.blur();
      if (picker) return;
      const items = [...sel.options].filter((o) => o.value).map((o) => {
        const t = o.textContent.trim(), i = o.dataset.reopen != null ? -1 : t.indexOf(' '); // 切換項目整行顯示
        return { value: o.value, label: i > 0 ? t.slice(0, i) : t, sub: i > 0 ? t.slice(i + 1) : '' };
      });
      const v = await openPicker({ title, items, selected: [sel.value] });
      if (v == null || v === sel.value) return;
      const reopen = [...sel.options].some((o) => o.value === v && o.dataset.reopen != null);
      sel.value = v;
      sel.dispatchEvent(new Event('change'));
      if (reopen) open(e); // 切換清單範圍的項目(例如「顯示全部專案」):直接在同一個清單重新展開
    };
    sel.dataset.sheet = '1';
    let t0 = null; // 捲動畫面時手指劃過不算點擊
    sel.addEventListener('touchstart', (e) => { const t = e.touches[0]; t0 = [t.clientX, t.clientY]; }, { passive: true });
    sel.addEventListener('touchend', (e) => {
      const t = e.changedTouches[0];
      if (t0 && Math.hypot(t.clientX - t0[0], t.clientY - t0[1]) < 10) open(e); else e.preventDefault();
    });
    sel.addEventListener('mousedown', open);
    sel.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') open(e); });
  }
  sheetSelect($('fCodeSel'), '選擇專案');
  sheetSelect($('rProject'), '選擇專案');
  sheetSelect($('pmPick'), '選取專案');
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
  function fText(label, obj, key, { multi = false, onChange, type = 'text', inputmode, cls } = {}) {
    const el = multi ? h('textarea', { rows: 2, class: cls }) : h('input', { type, inputmode });
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
  function fChips(label, obj, key, options, { onChange } = {}) {
    const box = h('div', { class: 'opt-chips' });
    const render = () => {
      box.innerHTML = '';
      for (const o of options) {
        box.append(h('button', {
          type: 'button', class: (obj[key] === o ? 'on ' : '') + 'chip-' + o.toLowerCase(),
          onclick: () => { obj[key] = obj[key] === o ? '' : o; render(); markDirty(); if (onChange) onChange(obj[key]); },
        }, o));
      }
    };
    render();
    return h('div', { class: 'field' }, h('span', { class: 'flabel' }, label), box);
  }
  function fDate(label, obj, key, { time = false, onChange } = {}) {
    if (time) return fDateTime(label, obj, key, onChange);
    const el = h('input', { type: 'date' });
    el.value = obj[key] || '';
    el.addEventListener('change', () => { obj[key] = el.value; if (onChange) onChange(el.value); markDirty(); });
    el.addEventListener('input', () => { obj[key] = el.value; markDirty(); });
    return field(label, el);
  }

  // 日期 + 時/分(24 小時制;不用原生 datetime-local,避免顯示上午/下午)
  function fDateTime(label, obj, key, onChange, defTime = '08:00') {
    const m = /^(\d{4}-\d{2}-\d{2})(?:T(\d{2}):(\d{2}))?/.exec(obj[key] || '') || [];
    const date = h('input', { type: 'date', class: 'dt-date', 'aria-label': label + '日期' });
    date.value = m[1] || '';
    const mkSel = (n, step, cur, aria) => {
      const sel = h('select', { class: 'dt-sel', 'aria-label': aria });
      const vals = [];
      for (let i = 0; i < n; i += step) vals.push(pad(i));
      if (cur && !vals.includes(cur)) { vals.push(cur); vals.sort(); }
      for (const v of vals) sel.append(h('option', { value: v }, v));
      sel.value = cur || vals[0];
      return sel;
    };
    const [dh, dm] = defTime.split(':');
    const hh = mkSel(24, 1, m[2] || dh, label + '時');
    const mm = mkSel(60, 5, m[3] || dm, label + '分');
    const sync = () => {
      obj[key] = date.value ? `${date.value}T${hh.value}:${mm.value}` : '';
      if (onChange) onChange(obj[key]);
      markDirty();
    };
    for (const el of [date, hh, mm]) el.addEventListener('change', sync);
    date.addEventListener('input', sync);
    return h('div', { class: 'field' }, h('span', { class: 'flabel' }, label),
      h('div', { class: 'dt-row' }, date, hh, h('span', { class: 'dt-colon' }, ':'), mm));
  }

  // 專案代號 ↔ 專案名稱 連動
  function projectPair(obj, after) {
    const findBy = (k, v) => projList().find((p) => p[k] && p[k].toLowerCase() === String(v || '').trim().toLowerCase());
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

  // 作業人員(Excel 欄名仍為「協同作業人員」):清單複選 + 手Key(手Key 名單放後面)
  const splitNames = (s) => String(s || '').split(/[、,，;；\n]+/).map((x) => x.trim()).filter(Boolean);
  // 通知視窗:顯示 ms 毫秒後自動關閉(點一下也可提早關閉)
  function notice(msg, ms) {
    return new Promise((resolve) => {
      const bar = h('div', { class: 'notice-bar' });
      const box = h('div', { class: 'notice-box', role: 'alert' }, h('div', { class: 'notice-icon' }, '🔔'), h('div', { class: 'notice-msg' }, msg), bar);
      const ov = h('div', { class: 'notice-ov' }, box);
      let done = false;
      const close = () => { if (done) return; done = true; clearTimeout(t); ov.remove(); resolve(); };
      const t = setTimeout(close, ms);
      ov.onclick = close;
      document.body.append(ov);
      bar.style.animationDuration = ms + 'ms';
    });
  }
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
    let noticed = false; // 同一張表單只提醒一次
    chips.onclick = async () => {
      if (!noticed && !S.data.resumes.some((r) => r.id === obj.id)) { noticed = true; await notice('填表人如有出席,也須勾選', 1000); }
      const v = await openPicker({ title: '作業人員', key: 'members', multi: true, selected: picked });
      if (v == null) return;
      picked = v;
      render();
      sync();
    };
    manualInp.addEventListener('input', sync);
    render();
    return h('div', { class: 'field' }, h('span', { class: 'flabel' }, '作業人員'), chips, manualInp);
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
    // 1) 設定檔直接指定資料夾 ID(最可靠)
    if (CFG.UPLOAD_FOLDER_ID) return (S.folderId = CFG.UPLOAD_FOLDER_ID);
    // 2) 從已上傳過的檔案找出附件資料夾:其他同仁通常只被分享 Excel 與附件資料夾,
    //    看不到 Excel 的上層資料夾,也搜尋不到「僅知道連結者」可存取的資料夾
    const ids = new Set();
    const scan = (s) => { for (const m of String(s || '').matchAll(/\/d\/([\w-]{20,})/g)) ids.add(m[1]); };
    for (const r of S.data.resumes) { scan(r.images); scan(r.files); }
    for (const r of S.data.remains) scan(r.files);
    for (const id of [...ids].slice(-5).reverse()) {
      try { const m = await Drive.getMeta(id); if (m.parents && m.parents[0]) return (S.folderId = m.parents[0]); } catch {}
    }
    // 3) 在 Excel 所在資料夾下找/建立附件資料夾
    const parent = S.meta && S.meta.parents && S.meta.parents[0];
    if (!parent) throw new Error('找不到附件資料夾,請管理者確認「' + CFG.UPLOAD_FOLDER + '」已共用給你(編輯者)');
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
    // 失敗自動重試一次(免登入檢視時 Apps Script 偶爾會逾時)
    const fetchOnce = () => (S.public ? publicFile(id) : Drive.media(id));
    if (!thumbCache.has(id)) thumbCache.set(id, fetchOnce().catch(fetchOnce).then((b) => URL.createObjectURL(b)));
    img.classList.remove('broken');
    thumbCache.get(id).then((u) => { img.src = u; }).catch(() => { thumbCache.delete(id); img.alt = '無法載入'; img.classList.add('broken'); });
  }
  // 取得圖片檔案(沿用縮圖快取)
  async function imgFile(ln) {
    if (!thumbCache.has(ln.id)) loadThumb(new Image(), ln.id);
    const b = await (await fetch(await thumbCache.get(ln.id))).blob();
    let name = ln.name || 'image';
    if (!/\.\w{2,5}$/.test(name)) name += '.' + ((b.type.split('/')[1] || 'jpg').replace('jpeg', 'jpg'));
    return new File([b], name, { type: b.type || 'image/jpeg' });
  }
  async function imgFiles(list) {
    const out = [];
    for (let i = 0; i < list.length; i++) {
      if (list.length > 1) busy(`讀取圖片 ${i + 1}/${list.length}…`);
      out.push(await imgFile(list[i]));
    }
    busy('');
    return out;
  }
  const canShareFiles = () => !!(navigator.canShare && navigator.share);
  async function downloadImages(list) {
    try {
      const files = await imgFiles(list);
      for (const f of files) {
        const a = h('a', { href: URL.createObjectURL(f), download: f.name });
        document.body.append(a); a.click();
        setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 4000);
        await new Promise((r) => setTimeout(r, 350)); // 連續下載間隔,避免瀏覽器略過
      }
      toast(`已下載 ${files.length} 張圖片`);
    } catch (err) { busy(''); toast('下載失敗:' + errMsg(err), 5000); }
  }
  async function shareImages(list) {
    let files;
    try { files = await imgFiles(list); } catch (err) { busy(''); toast('讀取圖片失敗:' + errMsg(err), 5000); return; }
    if (!canShareFiles() || !navigator.canShare({ files })) { toast('此裝置不支援分享圖片,改為下載'); return downloadImages(list); }
    try { await navigator.share({ files }); } catch (e) { if (e.name !== 'AbortError') toast('分享失敗:' + errMsg(e), 5000); }
  }
  // 圖片欄位的工具列:「選取」可複選後下載/分享;編輯時「刪除」可複選後確認刪除
  function imgTools(box, getLinks, onDelete) {
    const sel = new Set();
    let on = false; // false | 'sel' | 'del'
    const bar = h('div', { class: 'img-tools' });
    const picked = () => getLinks().filter((l) => l.id && sel.has(l.id));
    const paint = () => {
      box.classList.toggle('selecting', !!on);
      box.classList.toggle('deleting', on === 'del');
      box.querySelectorAll('.thumb[data-id]').forEach((t) => t.classList.toggle('picked', sel.has(t.dataset.id)));
      const n = picked().length, all = getLinks().filter((l) => l.id);
      bar.hidden = !all.length;
      bar.innerHTML = '';
      if (!on) {
        bar.append(...[
          h('button', { type: 'button', class: 'btn btn-ghost btn-sm', onclick: () => { on = 'sel'; paint(); } }, '☑ 選取'),
          onDelete ? h('button', { type: 'button', class: 'btn btn-ghost btn-sm', onclick: () => { on = 'del'; paint(); } }, '🗑 刪除') : null,
        ].filter(Boolean));
        return;
      }
      const allOn = n === all.length;
      const allBtn = h('button', { type: 'button', class: 'btn btn-ghost btn-sm', onclick: () => { if (allOn) sel.clear(); else all.forEach((l) => sel.add(l.id)); paint(); } }, allOn ? '取消全選' : '全選');
      if (on === 'del') {
        bar.append(
          allBtn,
          h('button', {
            type: 'button', class: 'btn btn-danger btn-sm', disabled: !n, onclick: async () => {
              const list = picked();
              if (!list.length) return;
              if (!(await confirmYes('刪除圖片', `確定刪除選取的 ${list.length} 張圖片?`, '刪除', 'btn-danger'))) return;
              on = false; sel.clear();
              onDelete(list.map((l) => l.id));
            },
          }, `🗑 刪除${n ? ` (${n})` : ''}`),
          h('button', { type: 'button', class: 'btn btn-ghost btn-sm', onclick: () => { on = false; sel.clear(); paint(); } }, '取消'),
        );
        return;
      }
      bar.append(...[
        allBtn,
        h('button', { type: 'button', class: 'btn btn-primary btn-sm', disabled: !n, onclick: () => downloadImages(picked()) }, `⬇ 下載${n ? ` (${n})` : ''}`),
        canShareFiles() ? h('button', { type: 'button', class: 'btn btn-primary btn-sm', disabled: !n, onclick: () => shareImages(picked()) }, `分享${n ? ` (${n})` : ''}`) : null,
        h('button', { type: 'button', class: 'btn btn-ghost btn-sm', onclick: () => { on = false; sel.clear(); paint(); } }, '完成'),
      ].filter(Boolean));
    };
    // 選取模式時,點縮圖改為勾選(攔截在開啟大圖/移除之前)
    box.addEventListener('click', (e) => {
      if (!on) return;
      const t = e.target.closest('.thumb');
      if (!t) return;
      e.stopPropagation(); e.preventDefault();
      const id = t.dataset.id;
      if (!id) return;
      if (sel.has(id)) sel.delete(id); else sel.add(id);
      paint();
    }, true);
    bar.refresh = () => { const ids = new Set(getLinks().map((l) => l.id)); [...sel].forEach((x) => { if (!ids.has(x)) sel.delete(x); }); paint(); };
    paint();
    return bar;
  }

  // 圖片檢視:可用上一張/下一張按鈕、鍵盤左右鍵或手機左右滑動切換
  const LB = { list: [], idx: 0 };
  function lbShow() {
    const link = LB.list[LB.idx];
    $('lightboxImg').removeAttribute('src');
    loadThumb($('lightboxImg'), link.id);
    const multi = LB.list.length > 1;
    $('lbPrev').hidden = $('lbNext').hidden = $('lbCount').hidden = !multi;
    $('lbCount').textContent = `${LB.idx + 1} / ${LB.list.length}`;
    $('lbShare').hidden = !canShareFiles();
  }
  function lbStep(d) { if (LB.list.length < 2) return; LB.idx = (LB.idx + d + LB.list.length) % LB.list.length; lbShow(); }
  function openLightbox(link, list) {
    LB.list = (list || [link]).filter((l) => l.id);
    LB.idx = Math.max(0, LB.list.findIndex((l) => l.id === link.id));
    lbShow();
    $('lightbox').hidden = false;
  }
  $('lightbox').onclick = (e) => {
    if (e.target.id === 'lbDownload') { downloadImages([LB.list[LB.idx]]); return; }
    if (e.target.id === 'lbShare') { shareImages([LB.list[LB.idx]]); return; }
    if (e.target.closest('.lb-actions')) return;
    if (e.target.closest('.lb-nav')) { e.stopPropagation(); lbStep(e.target.closest('.lb-nav').id === 'lbPrev' ? -1 : 1); return; }
    $('lightbox').hidden = true;
  };
  (() => {
    let x0 = null, y0 = 0;
    $('lightbox').addEventListener('touchstart', (e) => { if (e.touches.length === 1) { x0 = e.touches[0].clientX; y0 = e.touches[0].clientY; } else x0 = null; }, { passive: true });
    $('lightbox').addEventListener('touchend', (e) => {
      if (x0 == null) return;
      const dx = e.changedTouches[0].clientX - x0, dy = e.changedTouches[0].clientY - y0; x0 = null;
      if (Math.abs(dx) > 50 && Math.abs(dx) > Math.abs(dy) * 1.5) { e.preventDefault(); lbStep(dx < 0 ? 1 : -1); }
    });
  })();

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
          box.append(h('div', { class: 'thumb', title: ln.name, 'data-id': ln.id || null, onclick: () => (ln.id ? openLightbox(ln, links) : null) }, img));
        } else {
          box.append(h('div', { class: 'attach' },
            ln.url ? h('a', { href: ln.url, target: '_blank', rel: 'noopener' }, '📎 ' + ln.name) : h('span', {}, '📎 ' + ln.name), remove));
        }
      });
      box.append(h('button', { type: 'button', class: image ? 'thumb add' : 'btn btn-ghost btn-sm', onclick: () => input.click() }, image ? '＋ 圖片' : '＋ 上傳附件'));
      if (tools) tools.refresh();
    };
    const tools = image ? imgTools(box, () => parseLinks(obj[key]), (ids) => {
      obj[key] = joinLinks(parseLinks(obj[key]).filter((l) => !ids.includes(l.id)));
      // 這次剛上傳、尚未存檔的檔案直接移到垃圾桶
      if (editing) for (const id of ids) if (editing.uploads.includes(id)) { editing.uploads = editing.uploads.filter((x) => x !== id); Drive.trash(id).catch(() => {}); }
      render();
      markDirty();
      toast(`已刪除 ${ids.length} 張圖片(存檔後生效)`);
    }) : null;
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
    return h('div', { class: 'field' }, h('div', { class: 'flabel-row' }, h('span', { class: 'flabel' }, label), tools), box, input);
  }

  // ---------- 專案履歷列表 ----------
  const remainCount = (r) => r.problems.filter((p) => p.remain).length;
  function showList() {
    showView('listView', { title: 'ATK專案履歷', sub: fileLine() });
    fillCodeFilter();
    renderList();
  }
  function fillCodeFilter() {
    // 選項顯示「代號 名稱」(履歷中出現過的專案 + 清單中的專案)
    const map = new Map();
    for (const p of projList()) if (p.code) map.set(p.code, p.name || '');
    for (const r of S.data.resumes) if (r.code && !map.get(r.code)) map.set(r.code, r.name || '');
    const sel = $('fCodeSel');
    sel.innerHTML = '';
    sel.append(h('option', { value: '' }, '選擇專案…'));
    for (const [c, n] of [...map.entries()].sort((a, b) => newestFirst(a[0], b[0]))) sel.append(h('option', { value: `${c} ${n}`.trim() }, `${c} ${n}`.trim()));
  }
  function renderList() {
    const code = $('fCode').value.trim().toLowerCase();
    const from = $('fFrom').value, to = $('fTo').value;
    // 首頁不列出已建立的履歷:有查詢條件才顯示結果
    const searching = !!(code || from || to);
    $('listHint').hidden = searching;
    if (!searching) {
      $('resumeList').innerHTML = '';
      $('listEmpty').hidden = true;
      $('listCount').textContent = '';
      return;
    }
    const items = resumeResults();
    const box = $('resumeList');
    box.innerHTML = '';
    for (const r of items) {
      const probs = r.problems.filter((p) => p.problem).length;
      const rc = remainCount(r);
      const mine = canEdit(r);
      box.append(h('a', { class: 'card' + (mine ? '' : ' readonly'), href: (mine ? '#/r/' : '#/v/') + encodeURIComponent(r.id) },
        h('div', { class: 'card-top' },
          h('span', { class: 'date' }, fmtDT(r.start) || '未填日期'),
          r.stage ? h('span', { class: 'chip' }, r.stage) : null,
          r.unit ? h('span', { class: 'chip' }, r.unit) : null,
          h('span', { class: 'author' }, (mine ? '' : '🔒 ') + (r.author || ''))),
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
    $('listCount').textContent = `查詢結果 ${items.length} 份專案履歷`;
  }
  // 目前查詢條件的結果(依作業時間新→舊);沒有查詢條件時為全部
  function resumeResults() {
    const code = $('fCode').value.trim().toLowerCase();
    const from = $('fFrom').value, to = $('fTo').value;
    return S.data.resumes.filter((r) => {
      if (code && !`${r.code || ''} ${r.name || ''}`.toLowerCase().includes(code)) return false;
      const d = String(r.start || '').slice(0, 10);
      if ((from || to) && !d) return false;
      if (from && d < from) return false;
      if (to && d > to) return false;
      return true;
    }).sort((a, b) => String(b.start || '').localeCompare(String(a.start || '')));
  }

  // 上一個 / 下一個:依目前查詢結果的順序切換
  // 頁首「‹ ›」鍵(儲存鍵旁);不在查詢結果中或只有一筆時隱藏
  function renderNav(ids, cur, hrefOf) {
    const i = ids.indexOf(cur);
    const show = i >= 0 && ids.length > 1;
    for (const [id, to, label] of [['prevBtn', ids[i - 1], '上一個'], ['nextBtn', ids[i + 1], '下一個']]) {
      const b = $(id);
      b.hidden = !show;
      b.disabled = to == null;
      b.title = `${label}(${i + 1} / ${ids.length})`;
      b.onclick = () => { if (to != null) go(hrefOf(to)); };
    }
  }
  const hideNav = () => { $('prevBtn').hidden = true; $('nextBtn').hidden = true; };
  const resumeHref = (id) => {
    const r = S.data.resumes.find((x) => x.id === id);
    return (r && canEdit(r) ? '#/r/' : '#/v/') + encodeURIComponent(id);
  };
  const renderResumeNav = (id) => renderNav(resumeResults().map((r) => r.id), id, resumeHref);

  let filterTimer;
  $('fCode').oninput = () => { clearTimeout(filterTimer); filterTimer = setTimeout(renderList, 150); };
  $('fCodeSel').onchange = () => { $('fCode').value = $('fCodeSel').value; $('fCodeSel').value = ''; renderList(); };
  // 作業日期快捷鍵:今天 / 本週(週一~週日)
  const isoOf = (t) => `${t.getFullYear()}-${pad(t.getMonth() + 1)}-${pad(t.getDate())}`;
  $('fToday').onclick = () => { $('fFrom').value = $('fTo').value = todayISO(); renderList(); };
  $('fWeek').onclick = () => {
    const t = new Date();
    const mon = new Date(t.getFullYear(), t.getMonth(), t.getDate() - ((t.getDay() + 6) % 7));
    const sun = new Date(mon.getFullYear(), mon.getMonth(), mon.getDate() + 6);
    $('fFrom').value = isoOf(mon);
    $('fTo').value = isoOf(sun);
    renderList();
  };
  $('fFrom').onchange = renderList;
  $('fTo').onchange = renderList;
  $('fClear').onclick = () => { $('fCode').value = ''; $('fFrom').value = ''; $('fTo').value = ''; renderList(); };
  $('addResume').onclick = () => go('#/r/new');

  // ---------- 專案履歷編輯 ----------
  const blankProblem = () => ({ problem: '', cause: '', temp: '', perm: '', result: '', note: '', remain: '' });
  function resumeTitle(r) {
    const t = [fmtDate(r.start), r.code, r.name].filter(Boolean).join(' ');
    return (t ? t + ' ' : '') + '專案履歷';
  }

  function openResume(id) {
    let obj, isNew = false;
    if (id === 'new') {
      isNew = true;
      obj = { id: Store.newId('PR'), saved: true, code: '', name: '', plant: '', line: '', equip: '', unit: '', stage: '', start: todayISO() + 'T08:30', end: todayISO() + 'T17:30', hours: '', // 工作時間預設 08:30~17:30
      members: '', work: '', images: '', files: '', problems: [], author: myName(), authorEmail: myEmail(), shareKey: newShareKey() };
    } else {
      const r = S.data.resumes.find((x) => x.id === id);
      if (!r) { toast('找不到此專案履歷(可能已被刪除,或請重新載入)', 4000); replaceHash('#/'); showList(); return; }
      // 不是填表人(也不是管理者)→ 唯讀
      if (!canEdit(r)) { replaceHash('#/v/' + encodeURIComponent(id)); viewResume(id); return; }
      obj = clone(r);
      // 不預設問題區塊:完全空白的問題(沒有問題的履歷在 Excel 仍佔一列)不顯示,按「＋ 新增問題」才列出
      obj.problems = obj.problems.filter((p) => p.remain || ['problem', 'cause', 'temp', 'perm', 'result', 'note'].some((k) => String(p[k] || '').trim()));
    }
    editing = { type: 'resume', obj, snapshot: JSON.stringify(obj), isNew, createdHere: isNew, uploads: [] };
    $('deleteResume').hidden = !isAdmin() || isNew;
    showView('resumeView', { title: resumeTitle(obj), sub: authorLine(obj) + (isNew ? '(新增)' : ''), back: '#/', save: true, link: true });
    $('linkBtn').hidden = true; // 編輯頁:不顯示 ‹ › 與複製連結,讓標題完整顯示
    renderResumeForm();
    markDirty();
  }

  function renderResumeForm() {
    const obj = editing.obj;
    const upTitle = () => setTitle(resumeTitle(obj), authorLine(obj));
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
      fText('工作內容', obj, 'work', { multi: true, cls: 'ta-work' }),
      fFiles('圖片', obj, 'images', { image: true, prefix: () => obj.code || obj.name }),
      fFiles('附件', obj, 'files', { prefix: () => obj.code || obj.name }),
    );
    for (const el of [...box.children].slice(-3)) el.classList.add('span2');
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
          renderProblems();
          markDirty();
        },
      }, '刪除');
      box.append(h('div', { class: 'panel problem' },
        h('div', { class: 'panel-title row' }, h('span', {}, `問題 ${i + 1}`),
          p.remain ? h('span', { class: 'badge-remain' }, '已轉殘件') : null, h('span', { class: 'grow' }), del),
        h('div', { class: 'fields' },
          fText('問題描述', p, 'problem', { multi: true }),
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
    if (i >= 0 && !canEdit(d.resumes[i])) throw new Error('只有填表人或管理者可以修改這份專案履歷');
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
    let nHours = 0;
    try {
      await commit('儲存專案履歷…', (d) => { applyResume(d, res); nHours = hoursFromResume(d, res); });
    } catch (err) { toast('儲存失敗:' + errMsg(err), 6000); return false; }
    afterResumeSaved(res);
    toast('✅ 已儲存到雲端硬碟' + (nHours ? `,並為 ${nHours} 位作業人員建立工時紀錄` : ''), nHours ? 4500 : undefined);
    return true;
  }
  function afterResumeSaved(res) {
    editing.isNew = false;
    editing.uploads = [];
    editing.obj = clone(res);
    editing.snapshot = JSON.stringify(editing.obj);
    replaceHash('#/r/' + encodeURIComponent(res.id));
    $('deleteResume').hidden = !isAdmin();
    setTitle(resumeTitle(res), authorLine(res));
    renderResumeForm();
    markDirty();
  }

  $('saveBtn').onclick = () => (editing && editing.type === 'work' ? WorkList.save() : editing && editing.type === 'remain' ? saveRemain() : editing && editing.type === 'pm' ? savePm() : editing && editing.type === 'sched' ? saveSched() : saveResume());

  // 複製連結(尚未儲存時先儲存):剪貼簿同時放「標題 + 連結」文字與超連結格式,
  // 貼到 LINE/Teams/Email 都會看到「日期 專案代號 專案名稱 專案履歷」;連結開啟為唯讀
  // 連結帶「分享碼」:不需登入即可經由 Apps Script 檢視(分享碼不符則拒絕)
  const newShareKey = () => Array.from(crypto.getRandomValues(new Uint8Array(9)), (b) => (b % 36).toString(36)).join('');
  const shareUrl = (r) => location.origin + location.pathname + '#/v/' + encodeURIComponent(r.id) + (r.shareKey ? '?k=' + r.shareKey : '');
  // 舊履歷沒有分享碼時補上(只寫分享碼,不改其他內容)
  async function ensureShareKey(r) {
    if (r.shareKey) return r;
    const key = newShareKey();
    let out = r;
    await commit('產生分享連結…', (d) => {
      const x = d.resumes.find((y) => y.id === r.id);
      if (!x) throw new Error('找不到這份專案履歷,請重新載入');
      x.shareKey = x.shareKey || key;
      if (!x.saved) { x.id = Store.newId('PR'); x.saved = true; }
      d.changed.add('resume');
      out = x;
    });
    return out;
  }
  async function copyLink(r) {
    const url = shareUrl(r);
    const title = resumeTitle(r);
    const text = `${title}\n${url}`;
    try {
      // iPhone/電腦:另附 HTML 超連結,貼到釘釘會變成「標題=連結」;
      // Android 只寫純文字(標題 + 網址):有 HTML 格式時會優先貼上 HTML,網址只剩超連結文字而消失
      if (!/Android/i.test(navigator.userAgent) && window.ClipboardItem && navigator.clipboard.write) {
        await navigator.clipboard.write([new ClipboardItem({
          'text/plain': new Blob([text], { type: 'text/plain' }),
          'text/html': new Blob([`<a href="${esc(url)}">${esc(title)}</a>`], { type: 'text/html' }),
        })]);
      } else await navigator.clipboard.writeText(text);
      toast('🔗 已複製:' + title, 3500);
    } catch {
      // 部分手機瀏覽器在非直接點擊時不允許寫入剪貼簿 → 顯示內容讓使用者再按一次
      const ta = h('textarea', { readonly: true, class: 'link-box', rows: 3 });
      ta.value = text;
      setTimeout(() => ta.select(), 50);
      const btns = [{ label: '關閉', value: false }, { label: '複製', value: 'copy', cls: 'btn-primary' }];
      if (navigator.share) btns.splice(1, 0, { label: '分享…', value: 'share' });
      const act = await dialog('專案履歷連結', ta, btns);
      if (act === 'copy') {
        ta.select();
        try { await navigator.clipboard.writeText(text); } catch { document.execCommand('copy'); }
        toast('🔗 已複製:' + title, 3500);
      } else if (act === 'share') {
        navigator.share({ title, text: title, url }).catch(() => {});
      }
    }
  }
  // 目前這份履歷(需要時先存檔、補分享碼);取消或失敗回傳 null
  async function linkTarget(verb) {
    if (editing && editing.type === 'resume') {
      if (editing.isNew || isDirty()) {
        if (!(await confirmYes(verb, '需要先儲存這份專案履歷,才能產生連結。', '儲存並' + verb.replace(/連結$/, '')))) return null;
        if (!(await saveResume())) return null;
      }
      if (!editing.obj.shareKey) {
        try { const r = await ensureShareKey(editing.obj); afterResumeSaved(r); } catch (err) { toast(errMsg(err), 5000); return null; }
      }
      return editing.obj;
    }
    const { parts } = parseHash();
    if (S.public) return S.public.resume;
    let r = parts[0] === 'v' && S.data.resumes.find((x) => x.id === parts[1]);
    if (!r) return null;
    try { r = await ensureShareKey(r); } catch (err) { toast(errMsg(err), 5000); return null; }
    replaceHash('#/v/' + encodeURIComponent(r.id) + '?k=' + r.shareKey);
    return r;
  }
  $('linkBtn').onclick = async () => {
    const r = await linkTarget('複製連結');
    if (r) copyLink(r);
  };
  // 發佈到釘釘群組:由 Apps Script 呼叫群組機器人,訊息為「標題=連結」(不會出現網址與預覽卡片)
  $('dingBtn').onclick = async () => {
    const r = await linkTarget('發佈連結');
    if (!r) return;
    const title = resumeTitle(r);
    if (!(await confirmYes('發佈到釘釘群組', `由群組機器人發佈:\n${title}`, '發佈'))) return;
    busy('發佈到釘釘…');
    try {
      const q = { a: 'ding', id: r.id, k: r.shareKey };
      // 剛存檔時 Apps Script 可能還讀到舊檔 →「找不到」時等幾秒再試一次
      const j = await gasGet(q, 1).catch(async (err) => {
        if (!/找不到此專案履歷/.test(errMsg(err))) throw err;
        await new Promise((ok) => setTimeout(ok, 4000));
        return gasGet(q, 1);
      });
      if (!j.title) throw new Error('Apps Script 尚未更新為新版本(部署 → 管理部署作業 → 新版本)');
      toast('✅ 已發佈到釘釘群組', 3000);
    }
    catch (err) { toast('發佈失敗:' + errMsg(err), 6000); }
    finally { busy(''); }
  };

  // ---------- 唯讀檢視(分享連結 / 沒有修改權限) ----------
  function roField(label, value, { pre = true } = {}) {
    if (value == null || String(value).trim() === '') return null;
    return h('div', { class: 'ro-field' }, h('div', { class: 'flabel' }, label), h('div', { class: 'ro-val' + (pre ? ' pre' : '') }, String(value)));
  }
  function roFiles(label, text, image) {
    const links = parseLinks(text);
    if (!links.length) return null;
    const box = h('div', { class: image ? 'gallery' : 'attach-list' });
    for (const ln of links) {
      if (image) {
        const img = h('img', { alt: ln.name, loading: 'lazy' });
        loadThumb(img, ln.id);
        box.append(h('div', { class: 'thumb', title: ln.name, 'data-id': ln.id || null, onclick: () => (ln.id ? openLightbox(ln, links) : null) }, img));
      } else {
        const a = ln.url ? h('a', { href: ln.url, target: '_blank', rel: 'noopener' }, '📎 ' + ln.name) : h('span', {}, '📎 ' + ln.name);
        if (S.public && ln.id) a.onclick = (e) => { e.preventDefault(); publicDownload(ln); };
        box.append(h('div', { class: 'attach' }, a));
      }
    }
    const tools = image ? imgTools(box, () => links) : null;
    return h('div', { class: 'ro-field' }, h('div', { class: 'flabel-row' }, h('div', { class: 'flabel' }, label), tools), box);
  }
  // 履歷層級的圖片/附件(免登入檢視時 Apps Script 仍以各問題列回傳 → 合併)
  function resumeFiles(r, key) {
    const lines = [r[key], ...(r.problems || []).map((p) => p[key])].join('\n').split('\n').map((x) => x.trim()).filter(Boolean);
    return [...new Set(lines)].join('\n');
  }
  function viewResume(id) {
    const r = S.data.resumes.find((x) => x.id === id);
    if (!r) { toast('找不到此專案履歷(可能已被刪除,或沒有權限)', 4000); replaceHash('#/'); showList(); return; }
    renderResumeRead(r);
  }
  function renderResumeRead(r) {
    editing = null;
    showView('readView', { title: resumeTitle(r), sub: authorLine(r), back: S.public ? null : '#/', link: true });
    if (S.public) $('menuBtn').hidden = true; else renderResumeNav(r.id);
    $('readNote').textContent = '🔒 唯讀檢視' + (S.public ? '' : canEdit(r) ? '(要修改請從首頁查詢後開啟)' : '');
    const body = $('readBody');
    body.innerHTML = '';
    body.append(h('div', { class: 'panel' }, h('h3', { class: 'panel-title' }, '基本資料'),
      h('div', { class: 'ro-grid' },
        roField('專案代號', r.code), roField('專案名稱', r.name), roField('作業廠區', r.plant), roField('線別', r.line),
        roField('設備名稱', r.equip), roField('單元', r.unit), roField('專案階段', r.stage),
        roField('作業開始時間', fmtDT(r.start)), roField('作業結束時間', fmtDT(r.end)),
        roField('報工時數', r.hours !== '' && r.hours != null ? r.hours + ' 小時' : ''), roField('作業人員', r.members),
        roField('填表人', r.author)),
      roField('工作內容', r.work), roFiles('圖片', resumeFiles(r, 'images'), true), roFiles('附件', resumeFiles(r, 'files'), false)));
    r.problems.forEach((p, i) => {
      const any = ['problem', 'cause', 'temp', 'perm', 'result', 'note'].some((k) => String(p[k] || '').trim());
      if (!any) return;
      body.append(h('div', { class: 'panel problem' },
        h('div', { class: 'panel-title row' }, h('span', {}, `問題 ${i + 1}`), p.remain ? h('span', { class: 'badge-remain' }, '已轉殘件') : null),
        roField('問題描述', p.problem),
        roField('發生原因', p.cause), roField('暫定對策', p.temp), roField('永久對策', p.perm),
        roField('處理結果', p.result), roField('備註', p.note)));
    });
  }

  // ---------- 分享連結免登入檢視(經由 Apps Script) ----------
  async function gasGet(params, tries = 2) {
    const url = CFG.SHARE_URL + '?' + new URLSearchParams(params).toString();
    // 逾時(25 秒)自動重試一次
    const ctl = new AbortController();
    const timer = setTimeout(() => ctl.abort(), 25000);
    let resp;
    try { resp = await fetch(url, { signal: ctl.signal }); } catch (err) {
      if (tries > 1) return gasGet(params, tries - 1);
      throw new Error(err.name === 'AbortError' ? '連線逾時,請稍後再試' : '無法連線');
    } finally { clearTimeout(timer); }
    if (!resp.ok) throw new Error('讀取失敗(' + resp.status + ')');
    const j = await resp.json();
    if (!j.ok) throw new Error(j.error || '讀取失敗');
    return j;
  }
  async function publicView(id, key) {
    busy('讀取專案履歷…(第一次開啟約需數秒)');
    try {
      // 頁面一開啟時已先送出的請求(index.html)可直接沿用,省下載入程式的時間
      const early = window.__shareEarly;
      window.__shareEarly = null;
      let j = null;
      if (early && early.id === id && early.k === (key || '')) j = await early.p.catch(() => null);
      if (!j || !j.ok) j = j && j.error && !/逾時|timeout/i.test(j.error) ? j : await gasGet({ id, k: key || '' }).catch((e) => ({ ok: false, error: errMsg(e) }));
      if (!j.ok) throw new Error(j.error || '讀取失敗');
      j.resume.shareKey = key;
      S.public = { id, key, resume: j.resume };
      renderResumeRead(j.resume);
      $('subLine').textContent = authorLine(j.resume) + ' · 免登入檢視';
    } catch (err) {
      showView('welcome', { title: 'ATK專案履歷' });
      $('welcomeMsg').textContent = '無法開啟分享的專案履歷:' + errMsg(err) + '。可登入後再試。';
    } finally { busy(''); }
  }
  function b64ToBlob(b64, mime) {
    const bin = atob(b64);
    const u8 = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) u8[i] = bin.charCodeAt(i);
    return new Blob([u8], { type: mime || 'application/octet-stream' });
  }
  const publicFile = (fid) => gasGet({ a: 'file', id: S.public.id, k: S.public.key || '', f: fid }).then((j) => b64ToBlob(j.data, j.mime));
  async function publicDownload(ln) {
    busy('下載附件…');
    try {
      const blob = await publicFile(ln.id);
      const a = h('a', { href: URL.createObjectURL(blob), download: ln.name });
      document.body.append(a);
      a.click();
      setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1500);
    } catch (err) { toast(errMsg(err), 5000); } finally { busy(''); }
  }

  // 放棄編輯:這次新建的履歷 → 連同已儲存的內容一起刪除;既有履歷 → 放棄尚未儲存的修改
  $('abandonResume').onclick = async () => {
    const obj = editing.obj;
    const saved = S.data.resumes.some((r) => r.id === obj.id);
    if (editing.createdHere && saved) {
      const rms = S.data.remains.filter((r) => String(r.src || '').startsWith(obj.id + ' '));
      const msg = `這份專案履歷是這次新建立的,放棄編輯會把已儲存到 Excel 的這份履歷一併刪除` +
        (rms.length ? `,並刪除由它轉出的 ${rms.length} 筆殘件項目` : '') + '。\n確定放棄?';
      if (!(await confirmYes('放棄編輯', msg, '放棄並刪除', 'btn-danger'))) return;
      try {
        await commit('刪除專案履歷…', (d) => {
          d.resumes = d.resumes.filter((r) => r.id !== obj.id);
          d.changed.add('resume');
          const before = d.remains.length;
          d.remains = d.remains.filter((r) => !String(r.src || '').startsWith(obj.id + ' '));
          if (d.remains.length !== before) d.changed.add('remain');
        });
      } catch (err) { return toast('放棄失敗:' + errMsg(err), 6000); }
    } else {
      const msg = editing.createdHere ? '確定放棄這份尚未儲存的專案履歷?' : (isDirty() ? '確定放棄尚未儲存的修改?(已儲存的內容不受影響)' : '確定離開編輯?');
      if (!(await confirmYes('放棄編輯', msg, '放棄', 'btn-danger'))) return;
    }
    editing.snapshot = JSON.stringify(editing.obj); // 不再提示未儲存
    await discardEditing();
    toast('已放棄編輯');
    go('#/');
  };

  // 刪除:只有管理者
  $('deleteResume').onclick = async () => {
    const obj = editing.obj;
    if (!isAdmin()) return toast('只有管理者可以刪除專案履歷');
    if (editing.isNew) { editing.snapshot = JSON.stringify(obj); await discardEditing(); go('#/'); return; }
    if (!(await confirmYes('刪除專案履歷', `確定刪除「${resumeTitle(obj)}」?\n(已轉出的殘件項目會保留)`, '刪除', 'btn-danger'))) return;
    try {
      await commit('刪除專案履歷…', (d) => {
        if (!isAdmin()) throw new Error('只有管理者可以刪除專案履歷');
        d.resumes = d.resumes.filter((r) => r.id !== obj.id);
        d.changed.add('resume');
      });
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
            status: 'Open', note: '', files: '', src: `${res.id} #${i + 1}`, author: myName(), authorEmail: myEmail(), editor: myName(), edited: stampNow(),
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
    for (const p of projList()) if (p.code && map.has(p.code) && !map.get(p.code)) map.set(p.code, p.name);
    return [...map.entries()].sort((a, b) => newestFirst(a[0], b[0]));
  }
  // 專案選單:預設只列未結案的專案(還有 Open 事項);選單最後可切換顯示全部(含已結案)
  const RP_ALL = '__all__', RP_OPEN = '__open__';
  const stampNow = () => { const t = new Date(); return `${todayISO()} ${pad(t.getHours())}:${pad(t.getMinutes())}`; };
  function fillRemainProjects(code) {
    const projects = remainProjects();
    const sel = $('rProject');
    sel.innerHTML = '';
    sel.append(h('option', { value: '' }, S.rpAll ? '請選擇專案(全部)…' : '請選擇專案(未結案)…'));
    let shown = 0;
    for (const [c, n] of projects) {
      const rs = S.data.remains.filter((r) => r.code === c);
      const open = rs.filter((r) => (r.status || 'Open') !== 'Close').length;
      if (!S.rpAll && !open && c !== code) continue;
      shown++;
      sel.append(h('option', { value: c }, `${c} ${n}(${open ? 'Open ' + open + ' / ' : '已結案 · '}${rs.length})`));
    }
    if (code && !projects.some(([c]) => c === code)) sel.append(h('option', { value: code }, `${code}(0)`));
    if (!S.rpAll && !shown) sel.append(h('option', { value: '', disabled: true }, '(目前沒有未結案的專案)'));
    sel.append(h('option', { value: S.rpAll ? RP_OPEN : RP_ALL, 'data-reopen': '' }, S.rpAll ? '↩ 只顯示未結案專案' : '📂 顯示全部專案(含已結案)…'));
    sel.value = code;
  }
  function showRemainList(p) {
    const projects = remainProjects();
    let code = p != null ? p : (ssGet(LS_RP) ?? '');
    if (code && !projects.some(([c]) => c === code) && p == null) code = '';
    S.rpAll = false; // 每次進入頁面預設只列未結案專案
    fillRemainProjects(code);
    ssSet(LS_RP, code);
    showView('remainView', { title: '追蹤/殘件事項', sub: fileLine() });
    renderRemainList();
  }
  function currentRemains() {
    const code = $('rProject').value, st = $('rStatus').value;
    if (!code) return [];
    return S.data.remains.filter((r) => r.code === code && (!st || (r.status || 'Open') === st))
      .sort((a, b) => (a.status === 'Close') - (b.status === 'Close') || String(b.date || '').localeCompare(String(a.date || '')));
  }
  function renderRemainList() {
    // 從專案管理切過來時(且仍選同一專案)顯示「返回專案管理」
    $('backToPm').hidden = !(S.pmReturn && S.pmReturn.row && can('pmView') && $('rProject').value === S.pmReturn.code);
    const items = currentRemains();
    const box = $('remainList');
    box.innerHTML = '';
    // 殘件頁不列出全部項目:選擇專案後才顯示
    const chosen = !!$('rProject').value;
    $('remainHint').hidden = chosen;
    $('exportRemain').disabled = !chosen;
    if (!chosen) { $('remainEmpty').hidden = true; $('remainCount').textContent = ''; return; }
    for (const r of items) {
      const st = r.status || 'Open';
      box.append(h('a', { class: 'card' + (st === 'Close' ? ' closed' : '') + (canEditRemain() ? '' : ' readonly'), href: '#/remain/' + encodeURIComponent(r.id) },
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
          r.due ? h('span', { class: isOverdue(r) ? 'overdue' : '' }, '期限 ' + fmtDate(r.due) + (isOverdue(r) ? '(逾期)' : '')) : null,
          r.author ? h('span', { class: 'author' }, (canEditRemain() ? '' : '🔒 ') + '填表 ' + r.author) : null),
        r.editor || r.edited ? h('div', { class: 'card-upd' }, '🕒 最後更新 ' + [r.editor, String(r.edited || '').replace(/-/g, '/')].filter(Boolean).join(' · ')) : null));
    }
    $('remainEmpty').hidden = items.length > 0;
    const open = items.filter((r) => (r.status || 'Open') !== 'Close').length;
    $('remainCount').textContent = `共 ${items.length} 筆,Open ${open} 筆`;
  }
  $('rProject').onchange = () => {
    const v = $('rProject').value;
    if (v === RP_ALL || v === RP_OPEN) { // 切換清單範圍:保留原本的選擇,重新展開讓使用者挑
      S.rpAll = v === RP_ALL;
      fillRemainProjects(ssGet(LS_RP) || '');
      // 手機底部清單由 sheetSelect 自己重新展開;電腦版原生下拉用 showPicker 展開
      if (!$('rProject').dataset.sheet) try { $('rProject').showPicker(); } catch { /* 不支援時使用者再點一次即可 */ }
      return;
    }
    remainProjectChanged();
  };
  $('rClear').onclick = () => { $('rProject').value = ''; remainProjectChanged(); };
  function remainProjectChanged() { ssSet(LS_RP, $('rProject').value); replaceHash('#/remain' + ($('rProject').value ? '?p=' + encodeURIComponent($('rProject').value) : '')); renderRemainList(); }
  $('rStatus').onchange = renderRemainList;
  $('addRemain').onclick = () => go('#/remain/new' + ($('rProject').value ? '?p=' + encodeURIComponent($('rProject').value) : ''));
  $('exportRemain').onclick = async () => {
    const items = currentRemains();
    if (!items.length) return toast('沒有可匯出的殘件項目');
    const code = $('rProject').value;
    const proj = code ? `${code} ${remainProjects().find(([c]) => c === code)?.[1] || ''}`.trim() : '全部專案';
    const st = $('rStatus').value;
    const t = todayISO().replace(/-/g, '');
    const bytes = Exporter.build(items, `${proj} 殘件項目${st ? `(${st})` : ''}`);
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
  // 權責區分清單:沒有「技術」時插在「電控」上面
  const withTech = (L) => {
    if (L.includes('技術')) return L;
    const out = [...L], i = out.indexOf('電控');
    out.splice(i >= 0 ? i : out.length, 0, '技術');
    return out;
  };
  const lineSummary = (r) => { const D = String(r.done || '').split('\n'); return String(r.lines || '').split('\n').map((l, i) => (l || D[i]) ? `${l || '(未填)'}:${D[i] ? (D[i] === '是' ? '已完工' : '未完工') : '—'}` : '').filter(Boolean).join('\n'); };
  const deptList = () => withTech(lists().dept || []);
  // 下拉複選(清單內有核取方塊);以「／」串接,依清單順序,清單外的舊值放後面
  const splitMulti = (s) => String(s || '').split(/[／/、,，;；\n]+/).map((x) => x.trim()).filter(Boolean);
  function fMultiPick(label, obj, key, listKey) {
    const inp = h('input', { type: 'text', readonly: true, placeholder: '請選擇(可複選)' });
    inp.value = splitMulti(obj[key]).join('／');
    const pick = async () => {
      const cur = splitMulti(obj[key]);
      const v = await openPicker({ title: label + '(可複選)', key: listKey, multi: true, selected: cur });
      if (v == null) return;
      const known = new Set(listValues(listKey).map((x) => x.value));
      obj[key] = inp.value = [...v.filter((x) => known.has(x)), ...v.filter((x) => !known.has(x))].join('／');
      markDirty();
    };
    inp.addEventListener('click', pick);
    return field(label, h('div', { class: 'combo' }, inp, h('button', { type: 'button', class: 'combo-btn', 'aria-label': '選擇' + label, onclick: (e) => { e.preventDefault(); pick(); } }, '▾')));
  }
  // 下拉選單(固定選項)
  function fSelect(label, obj, key, options) {
    const sel = h('select', {}, h('option', { value: '' }, '請選擇'), ...options.map((o) => h('option', { value: o }, o)));
    if (obj[key] && !options.includes(obj[key])) sel.append(h('option', { value: obj[key] }, obj[key]));
    sel.value = obj[key] || '';
    sel.addEventListener('change', () => { obj[key] = sel.value; markDirty(); });
    return field(label, sel);
  }
  // 線別(手Key)+ 完工(是/否),可多組;存成換行分隔、逐行對應
  function fLines(obj) {
    const L = String(obj.lines || '').split('\n'), D = String(obj.done || '').split('\n');
    const rows = Array.from({ length: Math.max(1, L.length, D.length) }, (_, i) => ({ line: (L[i] || '').trim(), done: (D[i] || '').trim() }));
    const sync = () => {
      const used = rows.filter((r) => r.line || r.done);
      obj.lines = used.map((r) => r.line).join('\n');
      obj.done = used.map((r) => r.done).join('\n');
      markDirty();
    };
    // 刪除:按「刪除」→ 每組出現核取方塊 → 勾選後按「刪除勾選」
    let delMode = false;
    const marked = new Set();
    const box = h('div', { class: 'line-rows' });
    const tools = h('div', { class: 'line-tools' });
    const render = () => {
      box.innerHTML = '';
      rows.forEach((r) => {
        const inp = h('input', { type: 'text', placeholder: '線別' });
        inp.value = r.line;
        inp.addEventListener('input', () => { r.line = inp.value.replace(/\n/g, ' '); sync(); });
        const fake = { v: r.done };
        const doneF = fSelect('完工', fake, 'v', CFG.DONE_OPTIONS);
        doneF.querySelector('select').addEventListener('change', () => { r.done = fake.v; sync(); });
        let cb = null;
        if (delMode) {
          cb = h('input', { type: 'checkbox', class: 'line-mark', 'aria-label': '勾選刪除' });
          cb.checked = marked.has(r);
          cb.addEventListener('change', () => { cb.checked ? marked.add(r) : marked.delete(r); cb.parentElement.classList.toggle('marked', cb.checked); renderTools(); });
        }
        box.append(h('div', { class: 'pair-row line-row' + (delMode ? ' del-mode' : '') + (marked.has(r) ? ' marked' : '') }, cb, field('線別', inp), doneF));
      });
      renderTools();
    };
    const renderTools = () => {
      tools.innerHTML = '';
      if (!delMode) {
        tools.append(
          h('button', { type: 'button', class: 'btn btn-ghost btn-sm', onclick: () => { rows.push({ line: '', done: '' }); render(); box.lastChild.querySelector('input[type=text]').focus(); } }, '＋ 線別'),
          h('button', { type: 'button', class: 'btn btn-ghost btn-sm', onclick: () => { delMode = true; marked.clear(); render(); } }, '刪除'));
      } else {
        tools.append(
          h('button', {
            type: 'button', class: 'btn btn-danger btn-sm', disabled: marked.size ? null : true, onclick: () => {
              for (let i = rows.length - 1; i >= 0; i--) if (marked.has(rows[i])) rows.splice(i, 1);
              if (!rows.length) rows.push({ line: '', done: '' });
              delMode = false; marked.clear(); sync(); render();
            },
          }, `刪除勾選(${marked.size})`),
          h('button', { type: 'button', class: 'btn btn-ghost btn-sm', onclick: () => { delMode = false; marked.clear(); render(); } }, '取消'));
      }
    };
    render();
    return h('div', { class: 'line-block' }, box, tools);
  }
  // from='sum':由專案彙整頁進入,返回鍵回到彙整頁
  const SUM_HASH = '#/pm/sum';
  function openRemain(id, p, from) {
    let obj, isNew = false;
    if (id === 'new' && !canEditRemain()) { toast('沒有殘件/追蹤事項的編輯權限'); replaceHash('#/remain' + (p ? '?p=' + encodeURIComponent(p) : '')); showRemainList(p); return; }
    if (id === 'new') {
      isNew = true;
      const proj = p ? projList().find((x) => x.code === p) || S.data.remains.find((x) => x.code === p) : null;
      obj = { id: Store.newId('RI'), saved: true, date: todayISO(), code: p || '', name: proj ? proj.name || '' : '', problem: '', cause: '', temp: '', perm: '', ecn: '', dept: '', owner: '', due: '', progress: '', status: 'Open', note: '', files: '', src: '', matDate: '', matStatus: '', lines: '', done: '', author: myName(), authorEmail: myEmail() };
    } else {
      const r = S.data.remains.find((x) => x.id === id);
      if (!r) { toast('找不到此殘件項目(可能已被刪除,或請重新載入)', 4000); replaceHash('#/remain'); showRemainList(); return; }
      if (!canEditRemain()) { viewRemain(r, from); return; }
      obj = clone(r);
    }
    editing = { type: 'remain', obj, snapshot: JSON.stringify(obj), isNew, uploads: [] };
    const back = from === 'sum' ? SUM_HASH : '#/remain' + (obj.code ? '?p=' + encodeURIComponent(obj.code) : '');
    showView('remainEditView', { title: isNew ? '新增殘件' : '殘件項目', sub: [obj.code, obj.name, authorLine(obj)].filter(Boolean).join(' · '), back, save: true });
    renderRemainForm();
    markDirty();
  }
  // 沒有修改權限的殘件 → 唯讀
  function viewRemain(r, from) {
    editing = null;
    showView('readView', { title: '殘件項目', sub: [r.code, r.name, authorLine(r)].filter(Boolean).join(' · '), back: from === 'sum' ? SUM_HASH : '#/remain' + (r.code ? '?p=' + encodeURIComponent(r.code) : '') });
    $('readNote').textContent = '🔒 唯讀檢視(只有填表人或管理者可以修改)';
    const srcId = (/^(\S+)/.exec(r.src || '') || [])[1];
    const srcResume = srcId && S.data.resumes.find((x) => x.id === srcId);
    const body = $('readBody');
    body.innerHTML = '';
    body.append(h('div', { class: 'panel' },
      h('div', { class: 'ro-grid' },
        roField('日期', fmtDate(r.date)), roField('狀態', r.status || 'Open'), roField('專案代號', r.code), roField('專案名稱', r.name),
        roField('ECN', r.ecn), roField('權責區分', r.dept), roField('負責人', r.owner), roField('改善期限', fmtDate(r.due)), roField('物料交期', fmtDate(r.matDate)), roField('物料狀態', r.matStatus), roField('填表人', r.author)),
      roField('線別 / 完工', lineSummary(r)),
      roField('問題描述', r.problem), roField('發生原因', r.cause), roField('暫定對策', r.temp), roField('永久對策', r.perm),
      roField('改善進度及結果', r.progress), roFiles('附件', r.files, false), roField('備註', r.note),
      srcResume ? h('div', { class: 'ro-field' }, h('div', { class: 'flabel' }, '來源'), h('a', { href: '#/v/' + encodeURIComponent(srcResume.id), class: 'src-link' }, resumeTitle(srcResume))) : null));
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
      fMultiPick('權責區分', obj, 'dept', 'dept'),
      fMultiPick('負責人', obj, 'owner', 'owner'),
      fDate('改善期限', obj, 'due'),
      h('div', { class: 'pair-row' }, fDate('物料交期', obj, 'matDate'), fSelect('物料狀態', obj, 'matStatus', CFG.MAT_STATUS_OPTIONS)),
      fLines(obj),
      fText('改善進度及結果', obj, 'progress', { multi: true }),
      fChips('狀態', obj, 'status', CFG.STATUS_OPTIONS),
      fFiles('附件', obj, 'files', { prefix: () => obj.code || obj.name }),
      fText('備註', obj, 'note', { multi: true }),
      obj.src ? h('div', { class: 'field' }, h('span', { class: 'flabel' }, '來源'),
        srcResume ? h('a', { href: (canEdit(srcResume) ? '#/r/' : '#/v/') + encodeURIComponent(srcResume.id), class: 'src-link' }, `${resumeTitle(srcResume)}(${obj.src.split(' ').slice(1).join(' ')})`)
          : h('span', { class: 'hint' }, obj.src)) : null,
    );
  }
  async function saveRemain() {
    const obj = editing.obj;
    if (!String(obj.code || '').trim()) { toast('請填寫專案代號'); return false; }
    if (!String(obj.problem || '').trim()) { toast('請填寫問題描述'); return false; }
    for (const k of ['dept', 'owner']) obj[k] = splitMulti(obj[k]).join('／'); // 複選統一以「／」分隔
    const rec = clone(obj);
    rec.editor = myName();
    rec.edited = stampNow();
    try {
      await commit('儲存殘件項目…', (d) => {
        d.changed.add('remain');
        const L = d.choice.lists;
        if (!(L.dept || []).includes('技術')) { L.dept = withTech(L.dept || []); d.changed.add('choice'); } // 權責區分清單補「技術」
        const i = d.remains.findIndex((r) => r.id === rec.id);
        if (!canEditRemain()) throw new Error('沒有殘件/追蹤事項的編輯權限');
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
    setTitle('殘件項目', [rec.code, rec.name, authorLine(rec)].filter(Boolean).join(' · '));
    if ($('backBtn').dataset.to !== SUM_HASH) $('backBtn').dataset.to = '#/remain?p=' + encodeURIComponent(rec.code);
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
      await commit('刪除殘件項目…', (d) => {
        const old = d.remains.find((r) => r.id === obj.id);
        if (!canEditRemain()) throw new Error('沒有殘件/追蹤事項的編輯權限');
        d.remains = d.remains.filter((r) => r.id !== obj.id);
        d.changed.add('remain');
      });
    } catch (err) { return toast('刪除失敗:' + errMsg(err), 6000); }
    editing = null;
    toast('已刪除');
    go(back);
  };

  // ---------- 專案管理(只有管理者) ----------
  // 資料:Project Management.xlsx(一列 = 一個專案批次);第一次進入時下載,之後每次存檔先下載最新檔再逐格修改
  // quiet:背景載入(登入後先讀,讓各頁的專案下拉選單用專案管理檔的清單),不顯示讀取中畫面
  let pmLoading = null;
  async function pmLoad(force, quiet) {
    if (S.pm && S.pm.data && !force) return;
    if (pmLoading) { if (!quiet) busy('讀取專案管理檔…'); try { return await pmLoading; } finally { if (!quiet) busy(''); } }
    if (!quiet) busy('讀取專案管理檔…');
    pmLoading = (async () => {
      if (!S.pm) {
        let f = null;
        for (const n of CFG.PM.FILE_NAMES) { f = await Drive.findByName(n); if (f) break; }
        if (!f) throw new Error(`找不到「${CFG.PM.FILE_NAMES[0]}」,或此帳號沒有權限`);
        S.pm = { fileId: f.id };
      }
      const { meta, bytes } = await Drive.download(S.pm.fileId);
      S.pm.meta = meta;
      S.pm.data = PmStore.read(bytes);
    })();
    try { await pmLoading; } finally { pmLoading = null; if (!quiet) busy(''); }
    await syncChoiceProjects();
  }
  async function pmCommit(label, op) {
    busy(label);
    try {
      const { bytes } = await Drive.download(S.pm.fileId);
      const out = PmStore.apply(bytes, op);
      busy(label.replace(/…$/, '') + '(上傳中)…');
      S.pm.meta = await Drive.upload(S.pm.fileId, out);
      S.pm.data = PmStore.read(out);
    } finally { busy(''); }
    await syncChoiceProjects();
  }
  const pmFileLine = () => {
    const m = S.pm && S.pm.meta;
    if (!m) return '';
    const d = new Date(m.modifiedTime);
    return `${m.name} · ${d.getMonth() + 1}/${d.getDate()} ${pad(d.getHours())}:${pad(d.getMinutes())} 更新`;
  };
  // 模糊比對:忽略大小寫、空白、底線、連字號;多個關鍵字須全部出現
  const fuzzy = (s) => String(s || '').toLowerCase().replace(/[\s_\-()（）]/g, '');
  function pmMatch(r, q) {
    const hay = fuzzy(`${r.code} ${r.name} ${r.part}`);
    return q.split(/\s+/).filter(Boolean).every((t) => hay.includes(fuzzy(t))) || hay.includes(fuzzy(q));
  }

  async function showPmList() {
    try { await pmLoad(); } catch (err) { toast(errMsg(err), 6000); replaceHash('#/'); showList(); return; }
    showView('pmListView', { title: '專案管理', sub: pmFileLine() });
    fillPmPick();
    renderPmList();
  }
  // 下拉選單:不重複的「代號 名稱」(依年度、流水號由新到舊);選取後以代號查詢
  function fillPmPick() {
    const sel = $('pmPick');
    const seen = new Map();
    for (const r of S.pm.data.records) if (r.code && !seen.has(r.code)) seen.set(r.code, r.name || '');
    const codes = [...seen.keys()].sort(newestFirst);
    sel.innerHTML = '';
    sel.append(h('option', { value: '' }, '📋 從清單選取專案…'), ...codes.map((c) => h('option', { value: c }, `${c} ${seen.get(c)}`)));
    sel.value = seen.has($('pmSearch').value.trim()) ? $('pmSearch').value.trim() : '';
  }
  // 階段顏色:預設清單固定配色,其他依名稱雜湊
  const STAGE_COLORS = ['#64748b', '#2563eb', '#7c3aed', '#c2410c', '#0891b2', '#16a34a', '#db2777', '#0d9488', '#ca8a04', '#4f46e5', '#9f1239', '#475569'];
  // 使用者在「設定 → 專案管理階段」選的顏色:Choice「管理階段顏色」欄,每格「階段=#色碼」
  const stageColorMap = () => {
    const m = {};
    for (const v of (S.data && lists().pmStageColor) || []) {
      const k = v.lastIndexOf('=');
      if (k > 0 && /^#[0-9a-f]{6}$/i.test(v.slice(k + 1).trim())) m[v.slice(0, k).trim()] = v.slice(k + 1).trim();
    }
    return m;
  };
  // 淺色底配黑字,深色底配白字
  const textOn = (hex) => {
    const n = parseInt(hex.slice(1), 16), r = n >> 16, g = (n >> 8) & 255, b = n & 255;
    return 0.299 * r + 0.587 * g + 0.114 * b > 165 ? '#111827' : '#fff';
  };
  function stageColor(s) {
    const pick = stageColorMap()[s];
    if (pick) return pick;
    const i = CFG.CHOICE_DEFAULTS.pmStage.indexOf(s);
    if (i >= 0) return STAGE_COLORS[i % STAGE_COLORS.length];
    let n = 0; for (const ch of String(s)) n = (n * 31 + ch.charCodeAt(0)) >>> 0;
    return STAGE_COLORS[n % STAGE_COLORS.length];
  }
  // 逾期:未結案、需求日期已到(含當天),且階段排在「現地安裝」之前(依階段下拉清單順序;空白視為尚未開始)
  function isNeedLate(r) {
    if (r.closed === '是' || !/^\d{4}-\d\d-\d\d$/.test(r.needDate) || r.needDate > todayISO()) return false;
    let L = lists().pmStage || [];
    if (!L.includes('現地安裝')) L = CFG.CHOICE_DEFAULTS.pmStage;
    if (!r.stage) return true;
    const i = L.indexOf(r.stage);
    return i >= 0 && i < L.indexOf('現地安裝');
  }
  const stageChip = (s) => { const c = stageColor(s); return h('span', { class: 'chip stage-chip', style: `background:${c};border-color:${c};color:${textOn(c)}` }, s); };
  function renderPmList() {
    const q = $('pmSearch').value.trim();
    const openOnly = $('pmOpenOnly').checked;
    const searching = !!q || openOnly;
    $('pmHint').hidden = searching;
    const box = $('pmList');
    box.innerHTML = '';
    if (!searching) { $('pmEmpty').hidden = true; $('pmCount').textContent = ''; return; }
    const items = pmResults();
    for (const r of items) {
      const openTracks = r.tracks.filter((t) => (t.item || t.progress) && t.status !== 'Close').length;
      box.append(h('a', { class: 'card' + (r.closed === '是' ? ' closed' : ''), href: '#/pm/' + r._row },
        h('div', { class: 'card-top' },
          r.stage ? stageChip(r.stage) : null,
          r.closed ? h('span', { class: 'status ' + (r.closed === '是' ? 'st-close' : 'st-open') }, r.closed === '是' ? '已結案' : '未結案') : null,
          h('span', { class: 'author' }, r.year || '')),
        h('div', { class: 'card-title' }, h('span', { class: 'code' }, r.code || '(未填代號)'), ' ', r.name || ''),
        h('div', { class: 'card-sub' }, [r.part && '品號 ' + r.part, r.batch && '批次 ' + r.batch, r.qty && '數量 ' + r.qty].filter(Boolean).join(' · ') || ' '),
        r.needDate ? h('div', { class: 'need-date' + (isNeedLate(r) ? ' late' : '') }, '需求日期 ' + r.needDate.replace(/-/g, '/')) : null,
        r.current ? h('div', { class: 'ptext' }, '現況:' + r.current) : null,
        openTracks ? h('div', { class: 'card-foot' }, h('span', { class: 'warn' }, `追蹤中 ${openTracks} 項`)) : null));
    }
    $('pmEmpty').hidden = items.length > 0;
    $('pmCount').textContent = `查詢結果 ${items.length} 筆`;
  }
  // 目前查詢條件的結果(依專案代號排序);沒有查詢條件時為全部
  function pmResults() {
    const q = $('pmSearch').value.trim();
    const openOnly = $('pmOpenOnly').checked;
    return S.pm.data.records
      .filter((r) => (!q || pmMatch(r, q)) && (!openOnly || r.closed !== '是'))
      .sort((a, b) => Store.compareCode(a.code, b.code) || (Number(a.batch) || 0) - (Number(b.batch) || 0) || a._row - b._row);
  }
  const renderPmNav = (row) => renderNav(pmResults().map((r) => r._row), row, (r) => '#/pm/' + r);
  let pmTimer;
  $('pmSearch').oninput = () => { $('pmPick').value = ''; clearTimeout(pmTimer); pmTimer = setTimeout(renderPmList, 150); };
  $('pmPick').onchange = () => { $('pmSearch').value = $('pmPick').value; renderPmList(); };
  $('pmOpenOnly').onchange = renderPmList;
  $('pmClear').onclick = () => { $('pmSearch').value = ''; $('pmPick').value = ''; $('pmOpenOnly').checked = false; renderPmList(); };
  $('pmAdd').onclick = () => go('#/pm/new');

  // ---------- 專案彙整(與每日 08:30 寄出的專案現況信內容相同) ----------
  // 未結案專案(排除「結案」=是、階段為完工、現況為 Finish/已完工/Pending)的現況、Open 追蹤事項,
  // 以及殘件/追蹤事項頁中狀態不是 Close 的殘件(依專案代號放在該專案下;對不到的列在最後)
  $('pmSumBtn').onclick = () => go('#/pm/sum');
  const pmDone = (r) => /完工|pending/i.test(r.stage || '') || /^\s*(finish(ed)?|已?完工|pending)/i.test(r.current || '');
  const lateDays = (d) => { if (!/^\d{4}-\d\d-\d\d/.test(d || '')) return 0; const n = Math.round((Date.parse(todayISO()) - Date.parse(d.slice(0, 10))) / 86400000); return n > 0 ? n : 0; };
  async function showPmSum() {
    try { await pmLoad(); if (!S.data) await reload(); } catch (err) { toast(errMsg(err), 6000); replaceHash('#/pm'); showPmList(); return; }
    const key = (c) => String(c || '').trim().toUpperCase();
    const projs = S.pm.data.records.filter((r) => (r.code || r.name) && r.closed !== '是' && !pmDone(r))
      .sort((a, b) => Store.compareCode(a.code, b.code) || (Number(a.batch) || 0) - (Number(b.batch) || 0) || a._row - b._row);
    const rems = ((S.data && S.data.remains) || []).filter((x) => !isClosed(x) && (x.problem || x.code))
      .sort((a, b) => Store.compareCode(a.code, b.code) || String(a.due || '9').localeCompare(String(b.due || '9')));
    const byCode = new Map(projs.filter((p) => p.code).map((p) => [key(p.code), []]));
    const others = [];
    for (const x of rems) { const g = byCode.get(key(x.code)); if (g) g.push(x); else others.push(x); }
    const nTracks = projs.reduce((n, p) => n + p.tracks.filter((t) => (t.item || t.progress) && !isClosed(t)).length, 0);
    showView('pmSumView', { title: '專案彙整', sub: `未結案專案 ${projs.length} 個 · 追蹤事項(Open)${nTracks} 項 · 殘件 ${rems.length} 項`, back: '#/pm' });
    const due = (d) => h('div', { class: 'sum-due' }, d ? '期限 ' + fmtDate(d) : '期限 —', lateDays(d) ? h('b', { class: 'sum-late' }, ` 逾期 ${lateDays(d)} 天`) : null);
    const remainItem = (x, withCode) => h('a', { class: 'sum-item sum-link', href: '#/remain/' + encodeURIComponent(x.id) + '?from=sum' },
      withCode ? h('div', { class: 'sum-code' }, `${x.code || '(未填代號)'} ${x.name || ''}`) : null,
      h('div', { class: 'sum-main' }, x.problem || '(未填問題描述)'),
      x.progress ? h('div', { class: 'sum-prog' }, '→ ' + x.progress) : null,
      h('div', { class: 'sum-meta' }, [x.owner, x.dept].filter(Boolean).join(' · ') || ' ', ' ', h('span', { class: 'sum-st' }, x.status || 'Open')),
      due(x.due));
    const box = $('pmSum');
    box.innerHTML = '';
    if (!projs.length) box.append(h('p', { class: 'empty' }, '目前沒有未結案的專案。'));
    for (const p of projs) {
      const tracks = p.tracks.map((t, i) => ({ ...t, _i: i })).filter((t) => (t.item || t.progress) && !isClosed(t));
      const rm = (p.code && byCode.get(key(p.code))) || [];
      box.append(h('div', { class: 'sum-card' },
        h('a', { class: 'sum-head', href: '#/pm/' + p._row + '?from=sum' },
          h('div', { class: 'sum-title' }, h('span', { class: 'code' }, p.code || ''), ' ', p.name || '', p.batch ? h('span', { class: 'sum-batch' }, `(批次${p.batch})`) : null),
          h('div', { class: 'sum-sub' }, p.stage ? stageChip(p.stage) : null, p.needDate ? h('span', { class: 'need-date' + (isNeedLate(p) ? ' late' : '') }, '需求日期 ' + fmtDate(p.needDate)) : null)),
        h('div', { class: 'sum-sec' }, h('div', { class: 'sum-label' }, '現況'), h('div', { class: 'sum-cur' + (p.current ? '' : ' muted') }, p.current || '(未填)')),
        h('div', { class: 'sum-sec' }, h('div', { class: 'sum-label' }, `追蹤事項(Open ${tracks.length} 項)`),
          tracks.length ? tracks.map((t) => h('a', { class: 'sum-item sum-link', href: '#/pm/' + p._row + '?from=sum&t=' + t._i }, h('div', { class: 'sum-main' }, t.item || '(未填事項)'),
            t.progress ? h('div', { class: 'sum-prog' }, '→ ' + t.progress) : null, t.owner ? h('div', { class: 'sum-meta' }, '負責人 ' + t.owner) : null, due(t.due))) : h('div', { class: 'muted' }, '(無 Open 追蹤事項)')),
        rm.length ? h('div', { class: 'sum-sec' }, h('div', { class: 'sum-label' }, `殘件事項(未結案 ${rm.length} 項)`), rm.map((x) => remainItem(x, false))) : null));
    }
    if (others.length) box.append(h('div', { class: 'sum-card' }, h('div', { class: 'sum-head' }, h('div', { class: 'sum-title' }, `其他殘件事項(專案不在上列清單,${others.length} 項)`)),
      h('div', { class: 'sum-sec' }, others.map((x) => remainItem(x, true)))));
    box.onclick = (e) => { if (e.target.closest('a')) S.sumY = window.scrollY; };
    if (S.sumY) { const y = S.sumY; S.sumY = 0; setTimeout(() => window.scrollTo(0, y), 0); }
  }

  const blankTrack = () => ({ item: '', progress: '', owner: '', due: '', status: 'Open' });
  // q:from=sum 由彙整頁進入(返回鍵回彙整頁);t=追蹤事項序號(展開並捲到該事項)
  async function openPm(id, q) {
    const from = q && q.get('from'), ti = q && q.get('t');
    try { await pmLoad(); } catch (err) { toast(errMsg(err), 6000); replaceHash('#/'); showList(); return; }
    let obj, isNew = false;
    if (id === 'new') {
      isNew = true;
      obj = { tracks: [] };
      for (const c of CFG.PM.COLS) obj[c.key] = '';
      obj.closed = '否';
    } else {
      const r = S.pm.data.records.find((x) => x._row === Number(id));
      if (!r) { toast('找不到此列(可能已被刪除或移動,請重新查詢)', 4000); replaceHash('#/pm'); showPmList(); return; }
      obj = clone(r);
      for (const t of obj.tracks) t._loaded = true; // 從 Excel 讀進來的追蹤事項(即使只有狀態)存檔時一律保留
    }
    editing = { type: 'pm', obj, snapshot: JSON.stringify(obj), isNew, uploads: [] };
    $('pmDelete').hidden = isNew || !can('pmEdit');
    showView('pmEditView', { title: pmTitle(obj, isNew), sub: obj.name || '', back: from === 'sum' ? SUM_HASH : '#/pm', save: can('pmEdit') });
    S.pmTrackFilter = 'Open';
    S.pmFoldKeep = false;
    $('pmTrackSec').open = false; // 追蹤事項每次進入先收合
    if (!isNew && from !== 'sum') renderPmNav(obj._row);
    renderPmForm();
    markDirty();
    if (ti != null && ti !== '') {
      $('pmTrackSec').open = true;
      const el = document.querySelector(`#pmTracks [data-ti="${Number(ti)}"]`);
      if (el) setTimeout(() => { el.scrollIntoView({ behavior: 'smooth', block: 'center' }); el.classList.add('flash'); setTimeout(() => el.classList.remove('flash'), 1800); }, 60);
    }
  }
  // 進度項目:日期 + 狀態(未進行/進行中/延遲/已完成)
  function fDateStatus(label, obj, dateKey, stKey) {
    const date = h('input', { type: 'date', 'aria-label': label + '日期' });
    date.value = obj[dateKey] || '';
    const sel = h('select', { class: 'st-sel', 'aria-label': label + '狀態' });
    const opts = ['', ...CFG.PM.PROGRESS_STATUS];
    if (obj[stKey] && !opts.includes(obj[stKey])) opts.push(obj[stKey]);
    for (const o of opts) sel.append(h('option', { value: o }, o || '狀態'));
    sel.value = obj[stKey] || '';
    const paint = () => { sel.dataset.st = sel.value; };
    paint();
    date.addEventListener('change', () => { obj[dateKey] = date.value; markDirty(); });
    date.addEventListener('input', () => { obj[dateKey] = date.value; markDirty(); });
    sel.addEventListener('change', () => { obj[stKey] = sel.value; paint(); markDirty(); });
    return h('div', { class: 'field' }, h('span', { class: 'flabel' }, label), h('div', { class: 'ds-row' }, date, sel));
  }
  $('backToPm').onclick = () => { const r = S.pmReturn; S.pmReturn = null; go(r && r.row ? '#/pm/' + r.row : '#/pm'); };
  // 殘件鍵:顯示此專案代號的殘件筆數,按下切到殘件項目頁(已選好此專案)
  function updatePmRemainBtn() {
    const code = String((editing && editing.obj.code) || '').trim();
    const b = $('pmRemainBtn');
    const list = code ? S.data.remains.filter((r) => r.code === code) : [];
    const open = list.filter((r) => (r.status || 'Open') !== 'Close').length;
    b.disabled = !code;
    b.textContent = code ? `🧩 殘件項目(${open})` : '🧩 殘件項目';
    $('pmSchedBtn').disabled = !code;
    $('pmSchedBtn').title = code ? '' : '請先填專案代號';
  }
  $('pmRemainBtn').onclick = () => {
    const code = String(editing.obj.code || '').trim();
    if (!code) return;
    S.pmReturn = { row: editing.obj._row, code }; // 殘件頁顯示「返回專案管理」
    go('#/remain?p=' + encodeURIComponent(code));
  };
  // 頁首:第一行專案代號、第二行專案名稱(手機寬度不夠時才看得完整)
  const pmTitle = (o, isNew) => (isNew && !o.code ? '新增專案' : o.code || '(未填代號)');

  function renderPmForm() {
    const obj = editing.obj;
    const upTitle = () => { setTitle(pmTitle(obj, editing.isNew), obj.name || ''); updatePmRemainBtn(); };
    // 專案代號 → 帶入專案名稱與年度
    const findName = (code) => {
      const c = String(code || '').trim().toLowerCase();
      if (!c) return '';
      const hit = S.pm.data.records.find((r) => String(r.code).toLowerCase() === c) || projList().find((p) => String(p.code).toLowerCase() === c);
      return hit ? hit.name : '';
    };
    let nameF, yearInp;
    const onCode = (v) => {
      if (!obj.name) { const n = findName(v); if (n) { obj.name = n; nameF.combo.setValue(n); } }
      const y = PmStore.yearFromCode(v);
      if (y && !obj.year) { obj.year = y; yearInp.value = y; }
      upTitle();
    };
    const codeF = fCombo('專案代號', obj, 'code', 'code', {
      onPick: (v) => { const n = findName(v); if (n) { obj.name = n; nameF.combo.setValue(n); } onCode(v); },
      onInput: onCode,
    });
    nameF = fCombo('專案名稱', obj, 'name', 'name', {
      onPick: (v) => { const p = projList().find((x) => x.name === v); if (p && !obj.code) { obj.code = p.code; codeF.combo.setValue(p.code); onCode(p.code); } upTitle(); },
      onInput: upTitle,
    });
    const yearF = fText('年度', obj, 'year', { inputmode: 'numeric' });
    yearInp = yearF.querySelector('input');
    // 可收合區塊(每次進入都先收合);標題列右側顯示摘要
    const fold = (title, sum, ...fields) => h('details', { class: 'panel list-panel pm-sec' },
      h('summary', { class: 'panel-title' }, title, h('span', { class: 'sec-sum' }, sum || '')), h('div', { class: 'fields pm-grid' }, ...fields));
    // 進度:6 個日期項目放在可收合的子區塊,摘要顯示各狀態件數
    const PS = CFG.PM.PROGRESS;
    const progSum = () => {
      const c = {};
      for (const p of PS) if (obj[p.st]) c[obj[p.st]] = (c[obj[p.st]] || 0) + 1;
      return CFG.PM.PROGRESS_STATUS.filter((k) => c[k]).map((k) => `${k} ${c[k]}`).join('・') || '尚未填寫';
    };
    const progBox = h('details', { class: 'pm-prog' },
      h('summary', {}, `進度項目(${PS.length})`, h('span', { class: 'sec-sum', id: 'pmProgSum' }, progSum())),
      h('div', { class: 'fields pm-grid' }, ...PS.map((p) => fDateStatus(p.label, obj, p.date, p.st))));
    progBox.addEventListener('change', () => { $('pmProgSum').textContent = progSum(); });
    const box = $('pmFields');
    // 存檔後重畫時保留各區塊的展開狀態;剛進入時一律收合
    const openState = S.pmFoldKeep ? [...box.querySelectorAll('details')].map((d) => d.open) : [];
    box.innerHTML = '';
    box.append(
      fold('基本資料', [obj.part && '品號 ' + obj.part, obj.batch && '批次 ' + obj.batch].filter(Boolean).join('・'), codeF, nameF, yearF,
        fText('產品品號', obj, 'part'), fText('訂單號碼', obj, 'order', { inputmode: 'numeric' }), fText('客戶單號', obj, 'custNo'),
        fText('批次', obj, 'batch', { inputmode: 'numeric' }), fText('數量', obj, 'qty', { inputmode: 'numeric' }),
        fDate('需求日期', obj, 'needDate')),
      fold('人員', obj.contact ? '客戶 ' + obj.contact : '', fText('客戶聯絡人', obj, 'contact'), fText('設計擔當人員', obj, 'design'), fText('電控擔當人員', obj, 'elec'),
        fText('軟體擔當人員', obj, 'soft'), fText('技術擔當人員', obj, 'tech')),
      // 進度區塊本身不收合:階段、現況、備註直接顯示,只有中間 6 個日期項目收合
      h('div', { class: 'panel' }, h('h3', { class: 'panel-title' }, '進度'),
        h('div', { class: 'fields pm-grid' }, fCombo('階段', obj, 'stage', 'pmStage')),
        progBox,
        h('div', { class: 'fields pm-grid' }, fText('現況', obj, 'current', { multi: true }), fText('備註', obj, 'note', { multi: true }))),
    );
    for (const f of box.querySelectorAll('.pm-grid > .field')) if (f.querySelector('textarea')) f.classList.add('span2');
    [...box.querySelectorAll('details')].forEach((d, i) => { d.open = !!openState[i]; });
    S.pmFoldKeep = true;
    renderPmTracks();
    updatePmRemainBtn();
    const cb = $('pmClosedBox');
    cb.innerHTML = '';
    cb.append(fChips('結案', obj, 'closed', CFG.PM.CLOSED_OPTIONS));
    pmLock();
  }
  const isClosed = (t) => String(t.status || '').toLowerCase() === 'close';
  const TRACK_FILTERS = [['Open', 'Open'], ['Close', 'Close'], ['all', '全部']];
  function renderPmTracks() {
    const obj = editing.obj;
    const filter = S.pmTrackFilter || 'Open';
    $('pmTrackSum').textContent = `追蹤事項(${obj.tracks.filter((t) => !isClosed(t)).length})`;
    // 查詢(依狀態):Open / Close / 全部
    const fb = $('pmTrackFilter');
    fb.innerHTML = '';
    for (const [v, label] of TRACK_FILTERS) {
      const n = v === 'all' ? obj.tracks.length : obj.tracks.filter((t) => (v === 'Close') === isClosed(t)).length;
      fb.append(h('button', { type: 'button', class: filter === v ? 'on' : '', onclick: () => { S.pmTrackFilter = v; renderPmTracks(); } }, `${label} ${n}`));
    }
    const box = $('pmTracks');
    box.innerHTML = '';
    let shown = 0;
    obj.tracks.forEach((t, i) => {
      if (filter === 'Open' && isClosed(t)) return;   // Close 的事項隱藏
      if (filter === 'Close' && !isClosed(t)) return;
      shown++;
      const del = h('button', {
        type: 'button', class: 'link-btn danger', onclick: async () => {
          if (!(await confirmYes('刪除追蹤事項', `確定刪除追蹤事項 ${i + 1}?`, '刪除', 'btn-danger'))) return;
          obj.tracks.splice(i, 1);
          renderPmTracks();
          markDirty();
        },
      }, '刪除');
      box.append(h('div', { class: 'panel problem' + (isClosed(t) ? ' track-closed' : ''), 'data-ti': i },
        h('div', { class: 'panel-title row' }, h('span', {}, `追蹤事項 ${i + 1}`), h('span', { class: 'grow' }), del),
        h('div', { class: 'fields' },
          fText('追蹤確認事項', t, 'item', { multi: true }),
          fText('進度與結果', t, 'progress', { multi: true }),
          fCombo('負責人', t, 'owner', 'owner'),
          fDate('期限', t, 'due'),
          fChips('狀態', t, 'status', CFG.STATUS_OPTIONS, {
            onChange: () => {
              // 改成 Close 時,在「Open」檢視中隱藏
              if (isClosed(t) && filter === 'Open') toast(`追蹤事項 ${i + 1} 已 Close,已隱藏(可切換「Close」或「全部」查看)`, 3500);
              renderPmTracks();
            },
          }))));
    });
    const empty = $('pmTrackEmpty');
    empty.hidden = shown > 0;
    empty.textContent = !obj.tracks.length ? '尚無追蹤事項,按下方「＋ 追蹤事項」新增' : filter === 'Close' ? '沒有已 Close 的追蹤事項' : '沒有 Open 的追蹤事項';
    pmLock();
  }
  $('pmAddTrack').onclick = () => {
    editing.obj.tracks.push(blankTrack());
    if (S.pmTrackFilter === 'Close') S.pmTrackFilter = 'Open'; // 新增的是 Open,切回看得到的檢視
    renderPmTracks();
    markDirty();
    const panels = $('pmTracks').children;
    panels[panels.length - 1].scrollIntoView({ behavior: 'smooth', block: 'start' });
  };

  async function savePm() {
    if (!can('pmEdit')) { toast('沒有專案管理的編輯權限'); return false; }
    const obj = editing.obj;
    if (!String(obj.code || '').trim()) { toast('請填寫專案代號'); return false; }
    const rec = clone(obj);
    // 空白的追蹤事項(只剩預設狀態)不寫入
    // 新增後沒填任何內容的追蹤事項不寫入;原本就有的(例如只有「狀態」)保留
    rec.tracks = rec.tracks.filter((t) => t._loaded || t.item || t.progress || t.due).map(({ _loaded, ...t }) => t);
    try {
      await pmCommit('儲存專案管理…', { type: 'save', rec });
    } catch (err) { toast('儲存失敗:' + errMsg(err), 6000); return false; }
    // 找回存檔後的那一列(新增的在最後一列)
    const saved = editing.isNew ? S.pm.data.records[S.pm.data.records.length - 1]
      : S.pm.data.records.find((x) => x._row === rec._row);
    editing.isNew = false;
    editing.obj = clone(saved);
    for (const t of editing.obj.tracks) t._loaded = true;
    editing.snapshot = JSON.stringify(editing.obj);
    replaceHash('#/pm/' + saved._row);
    renderPmNav(saved._row);
    $('pmDelete').hidden = false;
    setTitle(pmTitle(saved, false), saved.name || '');
    renderPmForm();
    markDirty();
    toast('✅ 已儲存到雲端硬碟');
    return true;
  }
  $('pmDelete').onclick = async () => {
    const obj = editing.obj;
    if (!(await confirmYes('刪除此列', `確定從 Excel 刪除「${[obj.code, obj.name, obj.part && '品號 ' + obj.part].filter(Boolean).join(' ')}」這一列?\n下方各列會往上移。`, '刪除', 'btn-danger'))) return;
    try { await pmCommit('刪除中…', { type: 'delete', rec: obj }); } catch (err) { return toast('刪除失敗:' + errMsg(err), 6000); }
    editing = null;
    toast('已刪除');
    go('#/pm');
  };

  // ---------- 專案 Schedule(長條圖) ----------
  // 資料:Project Management.xlsx 同資料夾的 Project Schedule.json
  //   { colors: { 工作項目: '#RRGGBB' }(各專案共用), schedules: { 專案代號: { title, start, end, sat, sun, items:[{name, days, start}] } } }
  //   sat/sun:假日出勤(週六/週日算上班日);沒勾時長條略過該天,工期也不計入
  async function schedLoad() {
    if (!S.sched) {
      const f = await Drive.findByName(CFG.PM.SCHED_FILE);
      S.sched = { fileId: f ? f.id : null, data: { colors: {}, schedules: {} } };
    }
    if (S.sched.fileId) {
      const { bytes } = await Drive.download(S.sched.fileId);
      S.sched.data = parseSched(bytes);
    }
  }
  function parseSched(bytes) {
    try {
      const d = JSON.parse(new TextDecoder().decode(bytes) || '{}');
      return { colors: d.colors || {}, schedules: d.schedules || {} };
    } catch { throw new Error(`${CFG.PM.SCHED_FILE} 內容格式錯誤`); }
  }
  // 先下載最新檔、套用修改再存回(檔案不存在時在 Project Management.xlsx 同資料夾建立)
  async function schedCommit(label, mutate) {
    busy(label);
    try {
      let data = { colors: {}, schedules: {} };
      if (!S.sched.fileId) { const f = await Drive.findByName(CFG.PM.SCHED_FILE); if (f) S.sched.fileId = f.id; }
      if (S.sched.fileId) data = parseSched((await Drive.download(S.sched.fileId)).bytes);
      mutate(data);
      const blob = new Blob([JSON.stringify(data, null, 1)], { type: 'application/json' });
      if (S.sched.fileId) await Drive.upload(S.sched.fileId, blob, 'application/json');
      else {
        const parent = S.pm && S.pm.meta && S.pm.meta.parents && S.pm.meta.parents[0];
        const f = await Drive.createFile(CFG.PM.SCHED_FILE, blob, 'application/json', parent ? [parent] : undefined);
        S.sched.fileId = f.id;
      }
      S.sched.data = data;
    } finally { busy(''); }
  }
  const addDays = (isoD, n) => { const t = Date.parse(isoD + 'T00:00:00Z'); return isNaN(t) ? '' : new Date(t + n * 86400000).toISOString().slice(0, 10); };

  async function openSched(code) {
    try {
      busy('讀取 Schedule…');
      await pmLoad();
      await schedLoad();
    } catch (err) { busy(''); toast(errMsg(err), 6000); replaceHash('#/pm'); showPmList(); return; } finally { busy(''); }
    const pmRec = S.pm.data.records.find((r) => r.code === code);
    const saved = S.sched.data.schedules[code];
    // 長條圖標題直接用專案名稱(含空格)
    const pmName = String((pmRec && pmRec.name) || '').trim();
    const obj = saved ? clone(saved) : { title: pmName, start: '', end: '', items: [] };
    // 先前版本預設把空格換成「_」:若標題正是那個自動產生的版本,改回專案名稱
    const underscored = pmName.replace(/\s+/g, '_');
    const fixTitle = (o) => { if (o && pmName && o.title === underscored && underscored !== pmName) o.title = pmName; };
    fixTitle(obj);
    obj.code = code;
    if (!obj.items.length) obj.items.push({ name: '', days: '', start: obj.start || '' });
    editing = { type: 'sched', obj, snapshot: JSON.stringify(obj), isNew: !saved, uploads: [] };
    const back = S.schedReturn && S.schedReturn.code === code && S.schedReturn.row ? '#/pm/' + S.schedReturn.row : '#/pm';
    showView('schedView', { title: `${code} Schedule`, sub: pmRec ? pmRec.name : '', back, save: can('pmEdit') });
    $('schedChart').hidden = true;
    for (const d of document.querySelectorAll('.sched-sec')) d.open = false; // 每次進入都先收合
    renderSchedForm();
    // 上次繪製的圖直接顯示(舊資料沒有存圖時,用已存的排程畫)
    const chart = saved && clone(saved.chart || (saved.items && saved.items.length ? saved : null));
    fixTitle(chart);
    if (chart) renderChart(chart);
    markDirty();
    Gantt.prefetch(); // 背景先下載 PDF 字型
  }

  function renderSchedForm() {
    const obj = editing.obj;
    const box = $('schedHead');
    box.innerHTML = '';
    const hint = h('div', { class: 'hint-line' }, Gantt.titleOf(obj));
    const titleF = fText('專案名稱(長條圖標題)', obj, 'title', { onChange: () => { hint.textContent = Gantt.titleOf(obj); } });
    titleF.append(hint);
    titleF.classList.add('span2');
    // 收合時標題列顯示期間摘要
    const upSum = () => { $('schedHeadSum').textContent = (obj.start || obj.end) ? `${fmtDate(obj.start) || '?'} ~ ${fmtDate(obj.end) || '?'}` : ''; };
    upSum();
    // 假日出勤:勾選後該天算上班日;改變時重算各項目的結束日期
    const wk = (key, label) => {
      const cb = h('input', { type: 'checkbox' });
      cb.checked = !!obj[key];
      cb.addEventListener('change', () => { obj[key] = cb.checked; renderSchedItems(); markDirty(); });
      return h('label', { class: 'chk-inline' }, cb, h('span', {}, label));
    };
    const offF = h('div', { class: 'field span2' }, h('span', { class: 'flabel' }, '假日出勤'),
      h('div', { class: 'chk-row' }, wk('sat', '週六'), wk('sun', '週日')),
      h('div', { class: 'hint-line' }, '沒勾選的假日,長條圖空白且不計入工期'));
    box.append(titleF, fDate('長條圖起始日期', obj, 'start', { onChange: upSum }), fDate('長條圖結束日期', obj, 'end', { onChange: upSum }), offF,
      h('div', { class: 'hint-line span2' }, '長條圖以 7 天為一格,週一為每週第一天,日期標在每週一'));
    renderSchedItems();
  }

  function renderSchedItems() {
    const obj = editing.obj;
    const box = $('schedItems');
    box.innerHTML = '';
    $('schedItemSum').textContent = `${obj.items.length} 項`;
    obj.items.forEach((it, i) => {
      // 結束日期:工期/起始日期改變時自動算;也可手動選擇,此時改由工期自動調整(結束 − 起始 + 1 天)
      const endOut = h('input', { type: 'date', class: 'sched-end', 'aria-label': '結束日期' });
      const upEnd = () => { endOut.value = Gantt.endOf(it, obj) || ''; };
      upEnd();
      const days = h('input', { type: 'number', min: '1', step: '1', inputmode: 'numeric', 'aria-label': '工期(天)', placeholder: '天' });
      days.value = it.days ?? '';
      const DAYMS = 86400000;
      const toT = (v) => Date.parse(v + 'T00:00:00Z');
      endOut.addEventListener('change', () => {
        const e = endOut.value;
        if (!e) { upEnd(); return; }
        if (!it.start) {
          // 沒有起始日期:有工期就往回推起始日(只算上班日),沒有工期則從結束日當天開始(1 天)
          const n = Math.max(1, Math.round(Number(it.days)) || 1);
          let t = toT(e), k = Gantt.workDays(e, e, obj) ? 1 : 0;
          while (k < n) { t -= DAYMS; if (Gantt.workDays(new Date(t).toISOString().slice(0, 10), new Date(t).toISOString().slice(0, 10), obj)) k++; }
          it.start = new Date(t).toISOString().slice(0, 10);
          start.value = it.start;
          it.days = String(n);
        } else {
          if (toT(e) < toT(it.start)) { toast('結束日期不能早於起始日期'); upEnd(); return; }
          const n = Gantt.workDays(it.start, e, obj);
          if (n < 1) { toast('起始到結束之間沒有上班日'); upEnd(); return; }
          it.days = String(n);
        }
        days.value = it.days;
        markDirty();
      });
      days.addEventListener('input', () => { it.days = days.value; upEnd(); markDirty(); });
      const start = h('input', { type: 'date', 'aria-label': '起始日期' });
      start.value = it.start || '';
      start.addEventListener('change', () => { it.start = start.value; upEnd(); markDirty(); });
      start.addEventListener('input', () => { it.start = start.value; upEnd(); markDirty(); });
      const nameF = fCombo('工作項目', it, 'name', 'schedItem');
      const handle = h('span', { class: 'drag-handle', title: '拖曳調整順序', 'aria-label': '拖曳調整順序' }, '≡');
      const del = h('button', {
        type: 'button', class: 'del-btn', 'aria-label': '刪除', onclick: async () => {
          if ((it.name || it.days || it.start) && !(await confirmYes('刪除工作項目', `確定刪除「${it.name || '第 ' + (i + 1) + ' 項'}」?`, '刪除', 'btn-danger'))) return;
          obj.items.splice(i, 1);
          renderSchedItems();
          markDirty();
        },
      }, '🗑');
      nameF.querySelector('.flabel').remove();
      const row = h('div', { class: 'sched-row', 'data-i': i },
        h('div', { class: 'sched-top' }, handle, h('span', { class: 'sched-no' }, String(i + 1)), nameF, del),
        h('div', { class: 'sched-dates' },
          h('label', {}, h('span', { class: 'flabel' }, '工期(天)'), days),
          h('label', {}, h('span', { class: 'flabel' }, '起始日期'), start),
          h('label', {}, h('span', { class: 'flabel' }, '結束日期'), endOut)));
      startDrag(handle, row);
      box.append(row);
    });
    pmLock();
  }

  // 拖曳排序(滑鼠與觸控都可):按住 ≡ 上下移動,放開時依位置調整順序
  function startDrag(handle, row) {
    handle.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      const rows = [...$('schedItems').children];
      const from = rows.indexOf(row);
      const gap = row.offsetHeight + 8;
      try { handle.setPointerCapture(e.pointerId); } catch {}
      row.classList.add('dragging');
      const startY = e.clientY;
      // 以開始拖曳時各列的位置判斷(其他列滑動中的位置不準)
      const centers = rows.map((r) => { const rc = r.getBoundingClientRect(); return rc.top + rc.height / 2; });
      let to = from;
      const move = (ev) => {
        const dy = ev.clientY - startY;
        row.style.transform = `translateY(${dy}px)`;
        const mid = centers[from] + dy;
        to = from;
        centers.forEach((c, k) => {
          if (k < from && mid < c) to = Math.min(to, k);
          if (k > from && mid > c) to = Math.max(to, k);
        });
        rows.forEach((r, k) => {
          if (r === row) return;
          const shift = (k >= to && k < from) ? gap : (k <= to && k > from) ? -gap : 0;
          r.style.transform = shift ? `translateY(${shift}px)` : '';
        });
      };
      const up = () => {
        handle.removeEventListener('pointermove', move);
        handle.removeEventListener('pointerup', up);
        handle.removeEventListener('pointercancel', up);
        rows.forEach((r) => { r.style.transform = ''; });
        row.classList.remove('dragging');
        if (to !== from) {
          const items = editing.obj.items;
          const [it] = items.splice(from, 1);
          items.splice(to, 0, it);
          markDirty();
        }
        renderSchedItems();
      };
      handle.addEventListener('pointermove', move);
      handle.addEventListener('pointerup', up);
      handle.addEventListener('pointercancel', up);
    });
  }

  $('schedAdd').onclick = () => {
    const items = editing.obj.items;
    const prev = items[items.length - 1];
    // 新項目的起始日預設接在上一項結束之後
    const o = editing.obj;
    const next = prev && Gantt.endOf(prev, o) ? Gantt.nextWork(addDays(Gantt.endOf(prev, o), 1), o) : (o.start || '');
    items.push({ name: '', days: '', start: next });
    renderSchedItems();
    markDirty();
    const rows = $('schedItems').children;
    rows[rows.length - 1].scrollIntoView({ behavior: 'smooth', block: 'center' });
  };

  const schedData = () => {
    const o = editing.obj;
    return { title: o.title, start: o.start, end: o.end, sat: !!o.sat, sun: !!o.sun, items: o.items.filter((it) => it.name || it.start || it.days) };
  };
  let shownChart = null; // 目前畫面上的圖(換顏色時用它重畫)
  function renderChart(d) {
    shownChart = d;
    const box = $('schedChart');
    box.innerHTML = Gantt.svg(d, S.sched.data.colors) + '<div class="chart-tip">點圖可全螢幕檢視</div>';
    box.hidden = false;
    return box;
  }
  // 繪圖:依目前的設定重新繪製,並把排程與這張圖一起存回雲端(下次進入直接顯示,不用再按繪圖)
  async function drawSched() {
    const d = schedData();
    if (!d.items.length) return toast('請先新增工作項目');
    renderChart(d).scrollIntoView({ behavior: 'smooth', block: 'start' });
    if (can('pmEdit')) await saveSched({ chart: clone(d) }); // 只能檢視:只畫圖不存檔
  }
  $('schedDraw').onclick = drawSched;
  // 點長條圖:全螢幕檢視(手機橫放可放大,可雙指縮放)
  $('schedChart').onclick = () => {
    const svgEl = $('schedChart').querySelector('svg');
    if (!svgEl) return;
    $('chartFullBody').innerHTML = svgEl.outerHTML;
    $('chartFull').hidden = false;
  };
  $('chartFullClose').onclick = () => { $('chartFull').hidden = true; $('chartFullBody').innerHTML = ''; };

  $('schedPdf').onclick = async () => {
    const d = schedData();
    if (!d.items.length) return toast('請先新增工作項目');
    busy('產生 PDF…(第一次需下載中文字型,約 6MB)');
    let bytes;
    try { bytes = await Gantt.pdf(d, S.sched.data.colors); } catch (err) { busy(''); return toast('PDF 產生失敗:' + errMsg(err), 6000); }
    busy('');
    const name = `${Gantt.titleOf(d).replace(/[\\/:*?"<>|]/g, '_')}.pdf`;
    const file = new File([bytes], name, { type: 'application/pdf' });
    if (navigator.canShare && matchMedia('(pointer: coarse)').matches && navigator.canShare({ files: [file] })) {
      try { await navigator.share({ files: [file], title: name }); return; } catch (e) { if (e.name === 'AbortError') return; }
    }
    const a = h('a', { href: URL.createObjectURL(file), download: name });
    document.body.append(a);
    a.click();
    setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1500);
    toast('已匯出 ' + name);
  };

  // 顏色設定:依工作項目(各專案共用),按「儲存顏色」立即存檔
  $('schedColors').onclick = async () => {
    const names = [...new Set([...(lists().schedItem || []), ...editing.obj.items.map((it) => it.name).filter(Boolean)])];
    const colors = { ...S.sched.data.colors };
    const body = h('div', { class: 'color-list' });
    names.forEach((n) => {
      const inp = h('input', { type: 'color', 'aria-label': n + ' 顏色' });
      inp.value = Gantt.colorFor(n, colors);
      colors[n] = inp.value; // 全部項目的顏色都存下來,之後各專案一致
      inp.addEventListener('input', () => { colors[n] = inp.value; });
      body.append(h('label', { class: 'color-row' }, inp, h('span', {}, n)));
    });
    const ok = await dialog('長條圖顏色(各專案通用)', body, [{ label: '取消', value: false }, { label: '儲存顏色', value: true, cls: 'btn-primary' }]);
    if (!ok) return;
    try {
      await schedCommit('儲存顏色…', (d) => { d.colors = { ...d.colors, ...colors }; });
      toast('✅ 顏色已儲存');
      if (!$('schedChart').hidden && shownChart) renderChart(shownChart);
    } catch (err) { toast('儲存失敗:' + errMsg(err), 6000); }
  };

  async function saveSched(opts = {}) {
    if (!can('pmEdit')) { toast('沒有專案管理的編輯權限'); return false; }
    const obj = editing.obj;
    const rec = {
      title: obj.title, start: obj.start, end: obj.end, sat: !!obj.sat, sun: !!obj.sun, updated: new Date().toISOString(),
      items: obj.items.filter((it) => it.name || it.start || it.days).map((it) => ({ name: it.name, days: it.days, start: it.start })),
    };
    try {
      await schedCommit(opts.chart ? '繪圖並儲存…' : '儲存 Schedule…', (d) => {
        // 最後一次繪圖的內容:有重新繪圖就換新,只按儲存則保留上次的圖
        const prev = d.schedules[obj.code];
        const chart = opts.chart || (prev && prev.chart);
        d.schedules[obj.code] = chart ? { ...rec, chart } : rec;
      });
    } catch (err) { toast('儲存失敗:' + errMsg(err), 6000); return false; }
    editing.isNew = false;
    editing.snapshot = JSON.stringify(editing.obj);
    markDirty();
    toast('✅ 已儲存到雲端硬碟');
    return true;
  }

  $('pmSchedBtn').onclick = () => {
    const code = String(editing.obj.code || '').trim();
    if (!code) return;
    S.schedReturn = { row: editing.obj._row, code };
    go('#/sched/' + encodeURIComponent(code));
  };

  // ---------- 工時統計(存在 Project Resume.xlsx「工時」工作表) ----------
  // 一般同仁:看/改自己的紀錄;「工時統計(全員)」權限:看全部、可替他人登錄
  const HR_LS_MONTH = 'pr_hours_month';
  const hoursList = () => (S.data ? Hours.read(S.data.book) : []);
  const curMonth = () => { const t = new Date(); return `${t.getFullYear()}-${pad(t.getMonth() + 1)}`; };
  const staffOfEmail = (email) => staffList().find((x) => x.email && x.email.toLowerCase() === String(email || '').toLowerCase());
  const myStaffName = () => (staffOfEmail(myEmail()) || {}).name || myName();
  const canEditHour = (r) => can('hoursAll') || (!!r.email && r.email === myEmail());
  const hourProj = (code) => projList().find((p) => p.code === code);
  const fmtH = (n) => String(Math.round(n * 10) / 10);
  let hrEdit = null; // 修改中的紀錄 id;null = 新增模式
  let hrSumOpen = false; // 月份統計明細是否展開(預設收合)
  let hrEntries = [];
  // 新的一筆:預設當天 08:30~17:30(day 可指定日期)
  const newEntry = (day = todayISO()) => {
    const start = `${day}T08:30`, end = `${day}T17:30`;
    return { code: '', cat: '', start, end, hours: Hours.diffHours(start, end) ?? '', note: '', auto: true };
  };
  // 報工類別預設:NA- 開頭為「一般」,但 NA-0000011、NA-0000012 為「工程」;其他代號不自動選
  const autoCat = (code) => {
    const c = String(code || '').trim().toUpperCase();
    if (!c.startsWith('NA-')) return '';
    return ['NA-0000011', 'NA-0000012'].includes(c) ? '工程' : '一般';
  };

  // 預設只看本人;管理者與「工時統計(全員)」可切換人員、使用「統計」
  function refreshWho() {
    const who = $('hrWho');
    who.hidden = $('hrStatsBtn').hidden = $('hrOffBtn').hidden = !can('hoursAll');
    if (can('hoursAll')) {
      const cur = who.value;
      const me = myStaffName();
      // 只列公司人員(外包等不在名單的人不列入)
      const names = [...new Set(staffList().map((x) => x.name).filter((n) => n && n !== me))]
        .sort((a, b) => a.localeCompare(b, 'zh-Hant'));
      who.innerHTML = '';
      who.append(h('option', { value: '' }, me + '(本人)'), ...names.map((n) => h('option', { value: n }, n)));
      who.value = names.includes(cur) ? cur : '';
    }
  }
  function showHours() {
    const m = $('hrMonth');
    if (!m.value) m.value = ssGet(HR_LS_MONTH) || curMonth();
    refreshWho();
    showView('hoursView', { title: '工時統計', sub: fileLine() });
    if (!hrEntries.length) resetHourForm(); else renderHourForm($('hrNameInput') && $('hrNameInput').value);
    renderHours();
  }
  function monthHours() {
    const mon = $('hrMonth').value;
    const who = can('hoursAll') ? $('hrWho').value : '';
    const mine = (r) => r.email === myEmail() || (!r.email && r.name === myStaffName());
    return hoursList().filter((r) => String(r.start || '').startsWith(mon) && (who ? r.name === who : mine(r)));
  }
  // 提報狀態:當月上班日(國定假日不算)到昨天為止沒有工時紀錄的日子,每天一個核取方塊;
  // 打勾 = 當天請假(存「請假」工作表),不算未提報;「免提報工時」者不顯示
  let missSeq = 0;
  const md = (d) => +d.slice(5, 7) + '/' + +d.slice(8);
  async function renderMissing(recs) {
    const seq = ++missSeq, mon = $('hrMonth').value;
    const who = can('hoursAll') ? $('hrWho').value : '';
    const name = who || myStaffName();
    const email = who ? ((staffList().find((x) => x.name === who) || {}).email || '') : myEmail();
    const off = new Set((S.data ? Hours.readOff(S.data.book) : []).map((x) => x.date));
    const { days, exact } = await Hours.workdays(mon, todayISO(), off);
    const el = $('hrMissing');
    if (seq !== missSeq || !el) return;
    el.innerHTML = '';
    if (email && hasPerm(email, 'noReport')) { el.hidden = false; el.className = 'hr-missing ok'; el.textContent = '免提報工時'; return; }
    if (!days.length) { el.hidden = true; return; }
    const isMine = (x) => (email ? x.email === email : !x.email && x.name === name);
    const leave = new Set((S.data ? Hours.readLeave(S.data.book) : []).filter(isMine).map((x) => x.date));
    const done = Hours.reportedDays(recs);
    const open = days.filter((d) => !done.has(d)); // 沒有工時紀錄的上班日(含已勾請假)
    const miss = open.filter((d) => !leave.has(d));
    const editable = !who || can('hoursAll');
    el.hidden = false;
    el.className = 'hr-missing' + (miss.length ? '' : ' ok');
    el.title = (exact ? '上班日依行政院人事行政總處行事曆' : '行事曆暫時無法取得,只排除週六日') + ';當天 23:59 前提報都不算未提報';
    const boxes = open.map((d) => {
      const cb = h('input', { type: 'checkbox', disabled: !editable || null, 'aria-label': md(d) + ' 請假' });
      cb.checked = leave.has(d);
      cb.onchange = () => setLeave({ email, name }, d, cb.checked);
      return h('label', { class: 'hr-leave' + (cb.checked ? ' on' : '') }, cb, md(d));
    });
    el.append(h('div', { class: 'hr-miss-line' },
      h('b', {}, miss.length ? `未提報 ${miss.length} 天` : '✅ 已全部提報'), open.length ? h('span', { class: 'hr-miss-sep' }, ':') : null, ...boxes),
      open.length ? h('small', { class: 'hr-miss-note' }, '若當天請假,請於方框打勾') : null);
  }
  // 颱風/特定假日(限工時統計(全員)):以日曆選日期,全員放假、不算未提報(存「公司假日」工作表)
  async function editOffDays() {
    const date = h('input', { type: 'date', class: 'hr-ask-month', 'aria-label': '放假日期' });
    date.value = todayISO();
    const note = h('input', { type: 'text', class: 'hr-ask-month', placeholder: '說明(例如:颱風假)', 'aria-label': '說明' });
    const list = h('div', { class: 'off-list' });
    const draw = () => {
      list.innerHTML = '';
      const rows = (S.data ? Hours.readOff(S.data.book) : []).sort((a, b) => b.date.localeCompare(a.date));
      if (!rows.length) return list.append(h('div', { class: 'empty small' }, '尚未設定'));
      for (const r of rows) list.append(h('div', { class: 'off-item' }, h('b', {}, r.date.replace(/-/g, '/')), h('span', {}, r.note || ''),
        h('button', { type: 'button', class: 'del-btn', 'aria-label': '刪除 ' + r.date, onclick: () => saveOff(r.date, null) }, '✕')));
    };
    const saveOff = async (d, text) => {
      try {
        await commit(text == null ? '刪除假日…' : '設定假日…', (x) => {
          const rows = Hours.readOff(x.book).filter((r) => r.date !== d);
          if (text != null) rows.push({ date: d, note: text, by: myEmail() });
          Hours.writeOff(x.book, rows);
        });
        toast(text == null ? `已刪除 ${d.replace(/-/g, '/')}` : `✅ ${d.replace(/-/g, '/')} 設為全員放假`);
      } catch (err) { toast('儲存失敗:' + errMsg(err), 6000); }
      draw();
      renderHours();
    };
    const add = h('button', { type: 'button', class: 'btn btn-primary btn-sm', onclick: () => {
      if (!date.value) return toast('請選擇日期');
      saveOff(date.value, note.value.trim() || '公司假日');
      note.value = '';
    } }, '＋ 設定');
    draw();
    await dialog('颱風/特定假日', h('div', {},
      h('div', { class: 'hint' }, '設定的日期全員放假,不算未提報(月初通知也排除)。'),
      h('div', { class: 'off-add' }, date, note, add), list), [{ label: '關閉', value: true, cls: 'btn-primary' }]);
  }
  $('hrOffBtn').onclick = editOffDays;
  async function setLeave(who, date, on) {
    try {
      await commit(on ? '登記請假…' : '取消請假…', (d) => {
        const same = (x) => x.date === date && (who.email ? x.email === who.email : !x.email && x.name === who.name);
        const list = Hours.readLeave(d.book).filter((x) => !same(x));
        if (on) list.push({ email: who.email, name: who.name, date });
        Hours.writeLeave(d.book, list);
      });
      toast(on ? `已登記 ${md(date)} 請假` : `已取消 ${md(date)} 請假`);
    } catch (err) { toast('儲存失敗:' + errMsg(err), 6000); }
    renderHours();
  }
  function renderHours() {
    const recs = monthHours().sort((a, b) => String(b.start).localeCompare(String(a.start)));
    const total = recs.reduce((s, r) => s + (Number(r.hours) || 0), 0);
    // 月份統計方塊:標題列(月份合計)永遠顯示,點擊收合/展開明細(預設收合);明細一筆一列,點列可修改
    const sum = $('hrSummary');
    sum.innerHTML = '';
    sum.classList.toggle('open', hrSumOpen && !!recs.length);
    // 標題列:點合計或「展開」切換明細;中間的提報狀態(含請假核取方塊)點擊不會收合
    const toggle = () => { if (recs.length) { hrSumOpen = !hrSumOpen; renderHours(); } };
    sum.append(h('div', { class: 'hr-total' + (recs.length ? ' can-open' : '') },
      h('button', { type: 'button', class: 'hr-total-btn', disabled: !recs.length, 'aria-expanded': String(hrSumOpen), onclick: toggle },
        h('span', {}, `${$('hrMonth').value.replace('-', '/')} 合計`), h('b', {}, fmtH(total) + ' 小時'), h('small', {}, `${recs.length} 筆`)),
      h('div', { id: 'hrMissing', class: 'hr-missing', hidden: true }),
      recs.length ? h('button', { type: 'button', class: 'hr-caret', onclick: toggle }, hrSumOpen ? '▲ 收合' : '▼ 展開') : null));
    renderMissing(recs);
    if (hrSumOpen && recs.length) {
      const catSum = (c) => recs.filter((r) => r.cat === c).reduce((s, r) => s + (Number(r.hours) || 0), 0);
      sum.append(h('div', { class: 'hr-table-wrap' }, h('table', { class: 'hr-table hr-detail' },
        h('thead', {}, h('tr', {}, h('th', {}, '日期'), h('th', {}, '作業項目'), ...Hours.CATS.map((c) => h('th', {}, c)), h('th', {}, '合計'))),
        h('tbody', {}, ...[...recs].reverse().map((r) => {
          const v = Number(r.hours) || 0, ok = canEditHour(r);
          return h('tr', { class: ok ? 'hr-row-edit' : '', title: ok ? '點擊修改' : '', onclick: ok ? () => editHour(r) : null },
            h('td', { class: 'hr-date' }, String(r.start || '').slice(5, 10).replace('-', '/')),
            h('td', {}, h('b', {}, r.code || '(未指定)'), (r.pname || (hourProj(r.code) || {}).name) ? h('small', {}, r.pname || hourProj(r.code).name) : ''),
            ...Hours.CATS.map((c) => h('td', { class: 'num' }, r.cat === c ? fmtH(v) : '')),
            h('td', { class: 'num' }, h('b', {}, fmtH(v))));
        })),
        h('tfoot', {}, h('tr', {}, h('td', { colspan: '2' }, '合計'), ...Hours.CATS.map((c) => h('td', { class: 'num' }, catSum(c) ? fmtH(catSum(c)) : '')),
          h('td', { class: 'num' }, h('b', {}, fmtH(total))))))));
    }
    const box = $('hrList');
    box.innerHTML = '';
    $('hrEmpty').hidden = !!recs.length;
    for (const r of recs) {
      const p = hourProj(r.code);
      const mine = canEditHour(r);
      const sameDay = String(r.end).slice(0, 10) === String(r.start).slice(0, 10);
      box.append(h('div', { class: 'card hr-card' + (mine ? '' : ' readonly') },
        h('div', { class: 'card-top' },
          h('span', { class: 'date' }, fmtDT(r.start) + (r.end ? ' ~ ' + (sameDay ? String(r.end).slice(11) : fmtDT(r.end)) : '')),
          r.cat ? h('span', { class: 'chip' }, r.cat) : null,
          r.resume ? h('span', { class: 'chip' }, '專案履歷') : null,
          h('span', { class: 'author' }, r.name)),
        h('div', { class: 'card-title' }, [r.code, r.pname || (p && p.name)].filter(Boolean).join(' ') || '(未指定作業項目)'),
        r.note ? h('div', { class: 'card-sub' }, r.note) : null,
        h('div', { class: 'card-foot' }, h('b', { class: 'hr-hours' }, fmtH(Number(r.hours) || 0) + ' 小時'),
          mine ? h('span', { class: 'hr-acts' },
            h('button', { type: 'button', class: 'del-btn', 'aria-label': '修改', onclick: () => editHour(r) }, '✏️'),
            h('button', { type: 'button', class: 'del-btn', 'aria-label': '刪除', onclick: () => deleteHour(r) }, '🗑')) : null)));
    }
  }

  // ---- 登錄表單:姓名 + 多筆工時紀錄(＋ 工時紀錄 增加一筆) ----
  function resetHourForm() {
    hrEdit = null;
    hrEntries = [newEntry()];
    renderHourForm();
  }
  function editHour(r) {
    hrEdit = r.id;
    hrEntries = [{ code: r.code, cat: r.cat, start: r.start, end: r.end, hours: r.hours, note: r.note, auto: Hours.diffHours(r.start, r.end) === Number(r.hours) }];
    renderHourForm(r.name);
    $('hrFormPanel').scrollIntoView({ behavior: 'smooth', block: 'start' });
  }
  function renderHourForm(name) {
    $('hrFormTitle').textContent = hrEdit ? '修改工時紀錄' : '登錄工時';
    const nameBox = $('hrName');
    nameBox.innerHTML = '';
    let nameEl;
    if (can('hoursAll')) {
      nameEl = h('select', {});
      // 只列公司人員;修改既有紀錄(例如外包的舊紀錄)時保留該紀錄的姓名
      const names = [...new Set([myStaffName(), ...staffList().map((x) => x.name), hrEdit ? name : ''].filter(Boolean))];
      nameEl.append(...names.map((n) => h('option', { value: n }, n)));
      nameEl.value = names.includes(name) ? name : myStaffName();
    } else {
      nameEl = h('input', { type: 'text', readonly: true });
      nameEl.value = name || myStaffName();
    }
    nameEl.id = 'hrNameInput';
    nameBox.append(field('姓名', nameEl, staffOfEmail(myEmail()) || can('hoursAll') ? null : h('small', { class: 'hint' }, '公司人員中找不到您的 E-Mail,暫以帳號名稱登錄;請管理者在 設定 → 公司人員 加入')));
    const box = $('hrEntries');
    box.innerHTML = '';
    hrEntries.forEach((en, i) => box.append(hourEntryEl(en, i)));
    $('hrAddEntry').hidden = $('hrSameDay').hidden = !!hrEdit;
    $('hrCancel').hidden = !hrEdit;
  }
  function hourEntryEl(en, i) {
    const projSel = h('select', {}, h('option', { value: '' }, '請選擇作業項目…'),
      ...projDesc().filter((p) => p.code).map((p) => h('option', { value: p.code }, `${p.code} ${p.name}`)));
    if (en.code && !hourProj(en.code)) projSel.append(h('option', { value: en.code }, en.code));
    projSel.value = en.code || '';
    projSel.onchange = () => { en.code = projSel.value; const c = autoCat(en.code); if (c) { en.cat = c; catSel.value = c; } };
    sheetSelect(projSel, '選擇作業項目', true); // 電腦/手機都開可輸入關鍵字搜尋的清單
    const catSel = h('select', {}, h('option', { value: '' }, '請選擇…'), ...Hours.CATS.map((c) => h('option', { value: c }, c)));
    catSel.value = en.cat || '';
    catSel.onchange = () => { en.cat = catSel.value; };
    const hrs = h('input', { type: 'number', inputmode: 'decimal', min: '0', step: '0.5' });
    hrs.value = en.hours === '' || en.hours == null ? '' : String(en.hours);
    hrs.oninput = () => { en.hours = hrs.value; en.auto = false; };
    const recalc = () => { const d = Hours.diffHours(en.start, en.end); if (en.auto && d != null) { en.hours = d; hrs.value = String(d); } };
    const note = h('textarea', { rows: 2 });
    note.value = en.note || '';
    note.oninput = () => { en.note = note.value; autoGrow(note); };
    // 結束日期預設與開始日期相同:改開始日期時,結束日期空白、早於開始或原本同一天就跟著改
    let prevDay = String(en.start || '').slice(0, 10);
    const endF = fDateTime('結束時間', en, 'end', recalc, '17:30');
    const startF = fDateTime('開始時間', en, 'start', (v) => {
      const day = String(v || '').slice(0, 10), endDay = String(en.end || '').slice(0, 10);
      if (day && (!endDay || endDay < day || endDay === prevDay)) {
        const ed = endF.querySelector('.dt-date');
        ed.value = day;
        ed.dispatchEvent(new Event('change'));
      }
      prevDay = day;
      recalc();
    }, '08:30');
    const head = h('div', { class: 'hr-entry-head' }, h('b', {}, hrEdit ? '工時紀錄' : `工時紀錄 ${i + 1}`),
      hrEntries.length > 1 ? h('button', { type: 'button', class: 'del-btn', 'aria-label': '移除這筆', onclick: () => { hrEntries.splice(i, 1); renderHourForm($('hrNameInput').value); } }, '✕') : null);
    return h('div', { class: 'hr-entry' }, head, h('div', { class: 'fields' },
      field('作業項目', projSel), field('報工類別', catSel),
      startF, endF,
      field('報工總時數', hrs, h('small', { class: 'hint' }, '依開始/結束時間自動計算(扣除 12:00~13:00 午休),可手動修改')),
      field('備註說明', note)));
  }
  async function saveHours() {
    const name = $('hrNameInput').value.trim();
    if (!name) return toast('請填寫姓名');
    const st = staffList().find((x) => x.name === name);
    const email = !can('hoursAll') || name === myStaffName() ? myEmail() : (st && st.email) || '';
    for (const [i, en] of hrEntries.entries()) {
      const no = hrEntries.length > 1 ? `第 ${i + 1} 筆:` : '';
      if (!en.code) return toast(no + '請選擇作業項目');
      if (!en.cat) return toast(no + '請選擇報工類別');
      if (!en.start || !en.end) return toast(no + '請填寫開始與結束時間');
      if (en.end <= en.start) return toast(no + '結束時間需晚於開始時間');
      if (!(Number(en.hours) > 0)) return toast(no + '請填寫報工總時數');
    }
    const recs = hrEntries.map((en) => ({
      name, email, code: en.code, pname: (hourProj(en.code) || {}).name || '', cat: en.cat,
      start: en.start, end: en.end, hours: Number(en.hours), note: String(en.note || '').trim(), resume: '', by: myEmail(),
    }));
    try {
      await commit('儲存工時…', (d) => {
        const list = Hours.read(d.book);
        if (hrEdit) {
          const i = list.findIndex((x) => x.id === hrEdit);
          if (i < 0) throw new Error('找不到這筆工時紀錄,可能已被刪除,請重新載入');
          if (!canEditHour(list[i])) throw new Error('只能修改自己的工時紀錄');
          list[i] = { ...list[i], ...recs[0], id: hrEdit, resume: list[i].resume, by: list[i].by || myEmail() };
        } else recs.forEach((r) => list.push({ ...r, id: Store.newId('WH') }));
        Hours.write(d.book, list);
      });
    } catch (err) { return toast('儲存失敗:' + errMsg(err), 6000); }
    toast(hrEdit ? '✅ 已更新工時紀錄' : `✅ 已儲存 ${recs.length} 筆工時`);
    const mon = String(recs[0].start).slice(0, 7);
    if (mon !== $('hrMonth').value) { $('hrMonth').value = mon; ssSet(HR_LS_MONTH, mon); }
    resetHourForm();
    refreshWho();
    renderHours();
  }
  async function deleteHour(r) {
    if (!(await confirmYes('刪除工時紀錄', `確定刪除 ${fmtDT(r.start)} ${r.code || ''} ${fmtH(Number(r.hours) || 0)} 小時 這筆紀錄?`, '刪除', 'btn-danger'))) return;
    try {
      await commit('刪除工時…', (d) => {
        const list = Hours.read(d.book);
        const i = list.findIndex((x) => x.id === r.id);
        if (i < 0) return;
        if (!canEditHour(list[i])) throw new Error('只能刪除自己的工時紀錄');
        list.splice(i, 1);
        Hours.write(d.book, list);
      });
    } catch (err) { return toast('刪除失敗:' + errMsg(err), 6000); }
    if (hrEdit === r.id) resetHourForm();
    toast('已刪除');
    renderHours();
  }
  // 專案履歷存檔時:依作業人員逐人建立工時(已建立過的人不重複;時數取履歷的報工時數,類別預設「工程」)
  // 作業人員以姓名或英文姓名比對公司人員,帶入中文姓名與 E-Mail
  function hoursFromResume(d, res) {
    const people = splitNames(res.members);
    if (!people.length || !res.start) return 0;
    const staff = Staff.read(d.book);
    const byName = (n) => staff.find((x) => [x.name, x.ename].some((v) => v && v.trim().toLowerCase() === n.toLowerCase()));
    const list = Hours.read(d.book);
    const have = new Set(list.filter((x) => x.resume === res.id).map((x) => x.name.toLowerCase()));
    const hrs = Number(res.hours) > 0 ? Number(res.hours) : Hours.diffHours(res.start, res.end) || '';
    let n = 0;
    for (const raw of people) {
      const st = byName(raw);
      const name = (st && st.name) || raw;
      if (have.has(name.toLowerCase()) || have.has(raw.toLowerCase())) continue;
      have.add(name.toLowerCase());
      list.push({
        id: Store.newId('WH'), name, email: (st && st.email) || '', code: res.code || '', pname: res.name || '', cat: '工程',
        start: res.start, end: res.end || '', hours: hrs, note: '專案履歷:' + resumeTitle(res).replace(/ 專案履歷$/, ''), resume: res.id, by: myEmail(),
      });
      n++;
    }
    if (n) Hours.write(d.book, list);
    return n;
  }
  // ---- 統計(全員) ----
  const HR_STAT_COLS = [
    { title: '專案代號', w: 14, kind: 'c' }, { title: '專案名稱', w: 34, kind: 'w' }, { title: '報工類別', w: 10, kind: 'c' },
    { title: '費用歸屬', w: 10, kind: 'n' }, { title: '部門', w: 12, kind: 'c' }, { title: '員工代號', w: 12, kind: 'c' },
    { title: '姓名', w: 12, kind: 'c' }, { title: '工時', w: 10, kind: 'n' },
  ];
  // 費用歸屬:設計 = 1、工程 = 2(一般不填)
  const feeOf = (cat) => ({ 設計: 1, 工程: 2 })[cat] || '';
  // 統計範圍:rg = { from: 'YYYY-MM', to: 'YYYY-MM', code: 專案代號(空白=全部) }
  const inRange = (r, rg) => {
    const m = String(r.start || '').slice(0, 7);
    return m >= rg.from && m <= rg.to && (!rg.code || (r.code || '') === rg.code);
  };
  const rangeText = (rg) => (rg.from === rg.to ? rg.from.replace('-', '/') : `${rg.from.replace('-', '/')} ~ ${rg.to.replace('-', '/')}`) + (rg.code ? ` ${rg.code}` : '');
  const rangeHash = (rg) => '#/hours/stats?m=' + rg.from + (rg.to !== rg.from ? '&to=' + rg.to : '') + (rg.code ? '&code=' + encodeURIComponent(rg.code) : '');
  // 有工時紀錄的專案代號(新 → 舊)
  function hourCodes() {
    const m = new Map();
    for (const r of hoursList()) if (r.code && !m.has(r.code)) m.set(r.code, r.pname || (hourProj(r.code) || {}).name || '');
    return [...m.entries()].sort((a, b) => Store.compareCode(b[0], a[0]));
  }
  function fillCodeSel(sel, code) {
    sel.innerHTML = '';
    sel.append(h('option', { value: '' }, '全部專案'));
    for (const [c, n] of hourCodes()) sel.append(h('option', { value: c }, n ? `${c} ${n}` : c));
    if (code && ![...sel.options].some((o) => o.value === code)) sel.append(h('option', { value: code }, code));
    sel.value = code || '';
  }
  function hourStats(rg) {
    const staff = staffList();
    const staffOf = (r) => staff.find((x) => x.name === r.name || (r.email && x.email && x.email.toLowerCase() === r.email));
    const m = new Map();
    for (const r of hoursList()) {
      if (!inRange(r, rg)) continue;
      const k = [r.code, r.cat, r.name].join('\u0001');
      let x = m.get(k);
      if (!x) {
        const st = staffOf(r);
        x = { code: r.code || '', pname: r.pname || (hourProj(r.code) || {}).name || '', cat: r.cat || '', fee: feeOf(r.cat),
          dept: st ? st.dept || '' : '外包', empNo: st ? st.empNo || '' : '', name: r.name || '', hours: 0 };
      }
      x.hours += Number(r.hours) || 0;
      m.set(k, x);
    }
    const catIdx = (c) => { const i = Hours.CATS.indexOf(c); return i < 0 ? 99 : i; };
    return [...m.values()].sort((a, b) => Store.compareCode(b.code, a.code) || catIdx(a.cat) - catIdx(b.cat) ||
      a.dept.localeCompare(b.dept, 'zh-Hant') || a.name.localeCompare(b.name, 'zh-Hant'));
  }
  // 起訖月份:迄月早於起月時自動對調
  const normRange = (from, to, code) => {
    const ok = (x) => /^\d{4}-\d{2}$/.test(x || '');
    if (!ok(from)) from = curMonth();
    if (!ok(to)) to = from;
    if (to < from) [from, to] = [to, from];
    return { from, to, code: code || '' };
  };
  async function askStatsMonth() {
    const mk = () => h('input', { type: 'month', required: true });
    const from = mk(), to = mk();
    from.value = to.value = curMonth(); // 預設當月
    const code = h('select', { 'aria-label': '專案代號' });
    fillCodeSel(code, '');
    const body = h('div', { class: 'hs-ask' },
      h('div', { class: 'field' }, h('span', { class: 'flabel' }, '統計月份(起 ~ 迄)'), h('div', { class: 'hs-range' }, from, h('span', {}, '~'), to)),
      h('div', { class: 'field' }, h('span', { class: 'flabel' }, '專案代號'), code));
    const ok = await dialog('統計工時', body, [{ label: '取消', value: false }, { label: '統計', value: true, cls: 'btn-primary' }]);
    if (ok) go(rangeHash(normRange(from.value, to.value, code.value)));
  }
  const hsRange = () => normRange($('hsFrom').value, $('hsTo').value, $('hsCode').value);
  // 彙整:各專案 工程 / 研發 / 外包 三列 + 合計(外包 = 非公司人員;研發 = 報工類別「設計」;其餘公司人員工時算工程)
  const HM_KINDS = ['工程', '研發', '外包'];
  function showHourSum(q) {
    const rg = normRange(q.from, q.to, q.code);
    showView('hoursSumView', { title: '工時彙整', sub: rangeText(rg), back: rangeHash(rg) });
    const m = new Map();
    for (const r of hourStats(rg)) {
      const k = r.dept === '外包' ? '外包' : r.cat === '設計' ? '研發' : '工程';
      const x = m.get(r.code) || { code: r.code, pname: r.pname, h: { 工程: 0, 研發: 0, 外包: 0 } };
      if (!x.pname && r.pname) x.pname = r.pname;
      x.h[k] += r.hours;
      m.set(r.code, x);
    }
    const list = [...m.values()].sort((a, b) => Store.compareCode(b.code, a.code));
    const sum = (x) => HM_KINDS.reduce((t, k) => t + x.h[k], 0);
    const tot = { 工程: 0, 研發: 0, 外包: 0 };
    list.forEach((x) => HM_KINDS.forEach((k) => { tot[k] += x.h[k]; }));
    const grand = HM_KINDS.reduce((t, k) => t + tot[k], 0);
    $('hmCount').textContent = list.length ? `${rangeText(rg)} 共 ${list.length} 個專案,合計 ${fmtH(grand)} 小時(工程 ${fmtH(tot.工程)}、研發 ${fmtH(tot.研發)}、外包 ${fmtH(tot.外包)})` : '';
    $('hmEmpty').hidden = !!list.length;
    const box = $('hmTable');
    box.innerHTML = '';
    if (!list.length) return;
    const rows = [];
    for (const x of list) {
      HM_KINDS.forEach((k, i) => rows.push(h('tr', { class: i ? '' : 'hm-first' },
        i ? null : h('td', { class: 'hm-proj', rowspan: '3' }, h('b', {}, x.code || '(未填代號)'), x.pname ? h('small', {}, x.pname) : ''),
        h('td', { class: 'hm-cat' }, k),
        h('td', { class: 'num' + (x.h[k] ? '' : ' hm-zero') }, fmtH(x.h[k])),
        i ? null : h('td', { class: 'num hm-total', rowspan: '3' }, fmtH(sum(x))))));
    }
    box.append(h('table', { class: 'hr-table hm-table' },
      h('thead', {}, h('tr', {}, h('th', {}, '專案代號 / 名稱'), h('th', {}, '類別'), h('th', { class: 'num' }, '工時'), h('th', { class: 'num' }, '總時數'))),
      h('tbody', {}, ...rows),
      h('tfoot', {}, ...HM_KINDS.map((k, i) => h('tr', { class: i ? '' : 'hm-first' },
        i ? null : h('td', { rowspan: '3' }, '合計'),
        h('td', { class: 'hm-cat' }, k), h('td', { class: 'num' }, fmtH(tot[k])),
        i ? null : h('td', { class: 'num hm-total', rowspan: '3' }, fmtH(grand)))))));
  }
  function showHourStats(q) {
    const rg = normRange(q.from, q.to, q.code);
    $('hsFrom').value = rg.from;
    $('hsTo').value = rg.to;
    fillCodeSel($('hsCode'), rg.code);
    showView('hoursStatsView', { title: '工時統計(全員)', sub: fileLine(), back: '#/hours' });
    const rows = hourStats(rg);
    const total = rows.reduce((t, r) => t + r.hours, 0);
    $('hsCount').textContent = rows.length ? `${rangeText(rg)} 共 ${new Set(rows.map((r) => r.name)).size} 人、${new Set(rows.map((r) => r.code)).size} 個作業項目,合計 ${fmtH(total)} 小時` : '';
    $('hsEmpty').hidden = !!rows.length;
    $('hsExport').disabled = $('hsErp').disabled = $('hsSum').disabled = !rows.length;
    renderErpDir();
    const box = $('hsTable');
    box.innerHTML = '';
    if (!rows.length) return;
    box.append(h('table', { class: 'hr-table hs-table' },
      // 畫面上 代號/名稱、類別/費用歸屬、姓名/員工代號 各合併一欄(手機不需左右捲動);匯出仍分開
      h('thead', {}, h('tr', {}, h('th', {}, '專案代號 / 名稱'), h('th', {}, '類別/歸屬'), h('th', {}, '部門'), h('th', {}, '姓名/代號'), h('th', { class: 'num' }, '工時'))),
      h('tbody', {}, ...rows.map((r) => h('tr', {}, h('td', {}, h('b', {}, r.code), r.pname ? h('small', {}, r.pname) : ''),
        h('td', {}, r.cat, r.fee ? h('small', {}, '歸屬 ' + r.fee) : ''),
        h('td', { class: r.dept === '外包' ? 'hs-out' : '' }, r.dept), h('td', {}, r.name, r.empNo ? h('small', {}, r.empNo) : ''), h('td', { class: 'num' }, fmtH(r.hours))))),
      h('tfoot', {}, h('tr', {}, h('td', { colspan: '4' }, '合計'), h('td', { class: 'num' }, fmtH(total))))));
  }
  async function saveXlsx(bytes, name) {
    const file = new File([bytes], name, { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
    // 手機(觸控裝置)優先用分享選單,可直接存到「檔案」或傳給別人
    if (navigator.canShare && matchMedia('(pointer: coarse)').matches && navigator.canShare({ files: [file] })) {
      try { await navigator.share({ files: [file], title: name }); return; } catch (e) { if (e.name === 'AbortError') return; }
    }
    const a = h('a', { href: URL.createObjectURL(file), download: name });
    document.body.append(a);
    a.click();
    setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1500);
    toast('已匯出 ' + name);
  }
  // ---- ERP 工時:全公司人員(有員工代號)× 專案 × 費用歸屬 → ERP-WT.xlsx,寫入設定的資料夾 ----
  // 資料夾用瀏覽器的 File System Access(電腦版 Chrome/Edge);資料夾記在本機 IndexedDB,每台電腦各自設定
  const ERP_FILE = 'ERP-WT.xlsx';
  const canPickDir = 'showDirectoryPicker' in window && !/[?&]mock=1&nodir=1/.test(location.search); // nodir:本機測試模擬手機
  function kv(mode, fn) {
    return new Promise((res, rej) => {
      const o = indexedDB.open('pr-local', 1);
      o.onupgradeneeded = () => o.result.createObjectStore('kv');
      o.onerror = () => rej(o.error);
      o.onsuccess = () => {
        const tx = o.result.transaction('kv', mode), req = fn(tx.objectStore('kv'));
        tx.oncomplete = () => res(req.result);
        tx.onerror = () => rej(tx.error);
      };
    });
  }
  const getErpDir = () => kv('readonly', (st) => st.get('erpDir')).catch(() => null);
  // 「ERP工時匯出路徑」方塊(統計頁與設定頁):預設好資料夾後,按「ERP工時」即一鍵寫入,不再詢問
  // ---- 手機匯出的 ERP-WT.xlsx:放在專案履歷檔同層的「ERP工時」資料夾;電腦上的 erp-sync.ps1(排程每 2 分鐘)經 Apps Script 取回並寫入 ERP 資料夾 ----
  const ERP_CLOUD_DIR = 'ERP工時';
  const XLSX_MIME = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
  async function erpCloudFolder() {
    const parent = (S.meta && S.meta.parents && S.meta.parents[0]) || (S.fileId && ((await Drive.getMeta(S.fileId)).parents || [])[0]);
    if (!parent) throw new Error('找不到專案履歷檔所在的資料夾');
    return Drive.ensureFolder(ERP_CLOUD_DIR, parent);
  }
  async function erpCloudPut(bytes) {
    const folder = await erpCloudFolder();
    const f = await Drive.findIn(ERP_FILE, folder);
    if (f) await Drive.upload(f.id, bytes, XLSX_MIME);
    else await Drive.createFile(ERP_FILE, new Blob([bytes], { type: XLSX_MIME }), XLSX_MIME, [folder]);
  }
  async function renderErpDir() {
    const dir = canPickDir ? await getErpDir() : null;
    const perm = dir ? await dir.queryPermission({ mode: 'readwrite' }).catch(() => 'prompt') : '';
    for (const id of ['hsErpDir', 'erpDirBox']) {
      const box = $(id);
      if (!box) continue;
      box.innerHTML = '';
      if (id === 'erpDirBox' && !can('hoursAll')) continue;
      const path = h('input', { type: 'text', readonly: true, class: 'erp-path', 'aria-label': 'ERP工時匯出路徑', placeholder: '尚未設定匯出路徑' });
      path.value = dir ? `${dir.name}\\${ERP_FILE}` : '';
      // 變更/清除匯出路徑只限管理者
      const pick = isAdmin() ? h('button', { type: 'button', class: 'btn btn-ghost btn-sm', onclick: () => pickErpDir().catch(() => {}) }, dir ? '📁 變更' : '📁 選擇資料夾') : null;
      const clear = dir && isAdmin() ? h('button', { type: 'button', class: 'btn btn-danger-ghost btn-sm', onclick: async () => { await kv('readwrite', (st) => st.delete('erpDir')); renderErpDir(); } }, '清除') : null;
      const hint = !canPickDir ? `手機按「🏭 ERP工時」會把 ${ERP_FILE} 存到雲端硬碟「${ERP_CLOUD_DIR}」資料夾,電腦上的同步程式約 2 分鐘內自動寫入 ERP 資料夾(不需開啟網頁)`
        : !dir && !isAdmin() ? '匯出路徑由管理者設定;此電腦尚未設定,按「🏭 ERP工時」會改為下載 ' + ERP_FILE
        : !dir ? '請先選擇 ERP 匯入用的資料夾;之後按「🏭 ERP工時」就會直接寫入(覆寫)該資料夾的 ' + ERP_FILE
          : perm === 'granted' ? '✅ 已預設,按「🏭 ERP工時」即一鍵匯出(覆寫同名檔案)'
            : '已預設;瀏覽器重新開啟後第一次匯出會再詢問一次寫入權限(可選「每次造訪都允許」)';
      box.append(h('div', { class: 'panel erp-dir' }, h('div', { class: 'panel-title' }, 'ERP工時匯出路徑'),
        canPickDir ? h('div', { class: 'erp-path-row' }, path, pick, clear) : null, h('small', { class: 'hint' }, hint)));
    }
  }
  async function pickErpDir() {
    if (!isAdmin()) throw new Error('只有管理者可以設定匯出路徑');
    const dir = await showDirectoryPicker({ id: 'erp-wt', mode: 'readwrite' });
    await kv('readwrite', (st) => st.put(dir, 'erpDir'));
    renderErpDir();
    return dir;
  }
  function erpRows(rg) {
    const m = new Map();
    for (const r of hourStats(rg)) {
      if (![1, 2].includes(r.fee) || !r.empNo) continue; // 只匯出費用歸屬 1(設計)、2(工程);無員工代號者不列入
      const k = [r.code, r.fee, r.empNo].join('');
      const x = m.get(k) || { code: r.code, fee: r.fee, name: r.name, empNo: r.empNo, hours: 0 };
      x.hours += r.hours;
      m.set(k, x);
    }
    // 排序:專案代號(C 欄)為主、費用歸屬為次、員工代號
    return [...m.values()].filter((x) => x.hours > 0).sort((a, b) => a.code.localeCompare(b.code) || a.fee - b.fee || a.empNo.localeCompare(b.empNo));
  }
  async function exportErp() {
    const rg = hsRange();
    if (rg.from !== rg.to) return toast('ERP工時一次只能匯出單一月份,請將起訖設為同一個月', 4500);
    const rows = erpRows(rg);
    if (!rows.length) return toast('這個範圍沒有可匯出的 ERP 工時(需有員工代號,且報工類別為設計/工程)', 4500);
    const skipped = hourStats(rg).filter((r) => !r.fee || !r.empNo).length;
    const note = skipped ? `(${skipped} 筆一般或無員工代號者未列入)` : '';
    const bytes = Exporter.erp(rows, rg.from + '-01');
    if (!canPickDir) { // 手機/不支援選資料夾:先存到雲端硬碟,電腦開啟工時統計頁時自動寫入指定資料夾
      try {
        busy('上傳 ' + ERP_FILE + '…');
        await erpCloudPut(bytes);
        toast(`✅ 已匯出 ${rows.length} 筆到雲端硬碟「${ERP_CLOUD_DIR}/${ERP_FILE}」${note},電腦約 2 分鐘內會自動寫入 ERP 資料夾`, 7000);
      } catch (e) { toast('ERP工時上傳失敗:' + errMsg(e), 6000); } finally { busy(''); }
      return;
    }
    try {
      let dir = await getErpDir();
      if (!dir && !isAdmin()) return saveXlsx(bytes, ERP_FILE); // 非管理者不能設定路徑:改為下載
      if (!dir) dir = await pickErpDir();
      if ((await dir.queryPermission({ mode: 'readwrite' })) !== 'granted' && (await dir.requestPermission({ mode: 'readwrite' })) !== 'granted') return toast('未取得資料夾寫入權限');
      const w = await (await dir.getFileHandle(ERP_FILE, { create: true })).createWritable();
      await w.write(bytes);
      await w.close();
      toast(`✅ 已匯出 ${rows.length} 筆到「${dir.name}」資料夾的 ${ERP_FILE}${note}`, 5000);
      renderErpDir();
    } catch (e) {
      if (e.name === 'AbortError') return;
      toast('ERP工時匯出失敗:' + (e.name === 'NoModificationAllowedError' || e.name === 'InvalidStateError' ? '檔案可能正在 Excel 中開啟,請先關閉' : errMsg(e)), 6000);
    }
  }
  $('hsErp').onclick = exportErp;
  $('hsSum').onclick = () => go(rangeHash(hsRange()).replace('#/hours/stats', '#/hours/sum'));
  $('hrStatsBtn').onclick = askStatsMonth;
  for (const id of ['hsFrom', 'hsTo', 'hsCode']) $(id).onchange = () => { const rg = hsRange(); replaceHash(rangeHash(rg)); showHourStats(rg); };
  $('hsExport').onclick = () => {
    const rg = hsRange();
    // 匯出明細:一筆紀錄一列(月份|日期|姓名|部門|報工類別|專案代號|作業項目|工時|備註說明),依公司人員順序、日期排序
    const staff = staffList();
    const stOf = (r) => staff.findIndex((x) => (r.email && x.email && x.email.toLowerCase() === r.email) || x.name === r.name);
    const recs = hoursList().filter((r) => inRange(r, rg));
    if (!recs.length) return toast('這個範圍沒有工時紀錄');
    const rows = recs.map((r) => {
      const i = stOf(r), st = staff[i];
      return { i: i < 0 ? 1e6 : i, month: +String(r.start).slice(5, 7), date: String(r.start).slice(0, 10), name: r.name || '', dept: st ? st.dept || '' : '外包',
        cat: r.cat || '', code: r.code || '', pname: r.pname || (hourProj(r.code) || {}).name || '', hours: Number(r.hours) || 0, note: r.note || '', start: String(r.start) };
    }).sort((a, b) => a.i - b.i || a.name.localeCompare(b.name, 'zh-Hant') || a.start.localeCompare(b.start));
    const tag = rg.from.replace('-', '') + (rg.to !== rg.from ? '-' + rg.to.replace('-', '') : '') + (rg.code ? '_' + rg.code.replace(/[\\/:*?"<>|]/g, '_') : '');
    saveXlsx(Exporter.detail(rows), `工時統計_${tag}.xlsx`);
  };
  $('hrMonth').onchange = () => { ssSet(HR_LS_MONTH, $('hrMonth').value); renderHours(); };
  $('hrWho').onchange = renderHours;
  $('hrAddEntry').onclick = () => {
    const last = hrEntries[hrEntries.length - 1];
    const en = newEntry();
    // 下一筆沿用上一筆的類別;上一筆在下班(17:30)前結束時,接續其結束時間到當天 17:30,否則用預設時間
    if (last) {
      const day = String(last.start || '').slice(0, 10);
      if (day) Object.assign(en, newEntry(day)); // 與上一筆同一天
      en.cat = last.cat;
      const end = String(last.end || '');
      if (end && end.slice(11, 16) < '17:30') { en.start = end; en.end = end.slice(0, 10) + 'T17:30'; en.hours = Hours.diffHours(en.start, en.end) ?? ''; }
    }
    hrEntries.push(en);
    renderHourForm($('hrNameInput').value);
  };
  // 同昨日:帶入此人前一個有登錄的日子(通常是昨天;週一會帶上週五)的全部紀錄,日期改為今天
  $('hrSameDay').onclick = () => {
    const name = $('hrNameInput').value;
    const today = todayISO();
    const mine = (r) => (name === myStaffName() ? r.email === myEmail() || (!r.email && r.name === name) : r.name === name);
    const past = hoursList().filter((r) => mine(r) && String(r.start || '').slice(0, 10) < today);
    if (!past.length) return toast('找不到 ' + name + ' 之前的工時紀錄');
    const day = past.reduce((m, r) => (r.start.slice(0, 10) > m ? r.start.slice(0, 10) : m), '');
    const shift = (dt) => { // 保留時間,日期平移到今天(跨日的結束時間一起平移)
      if (!dt) return '';
      const n = Math.round((new Date(dt.slice(0, 10)) - new Date(day)) / 864e5);
      const t = new Date(today); t.setDate(t.getDate() + n);
      return `${t.getFullYear()}-${pad(t.getMonth() + 1)}-${pad(t.getDate())}` + dt.slice(10);
    };
    hrEntries = past.filter((r) => r.start.slice(0, 10) === day).sort((a, b) => String(a.start).localeCompare(String(b.start)))
      .map((r) => ({ code: r.code, cat: r.cat, start: shift(r.start), end: shift(r.end), hours: r.hours, note: r.note || '', auto: Hours.diffHours(r.start, r.end) === Number(r.hours) }));
    renderHourForm(name);
    toast(`已帶入 ${day.slice(5).replace('-', '/')} 的 ${hrEntries.length} 筆紀錄(日期為今天),確認後按儲存`);
  };
  $('hrSave').onclick = saveHours;
  $('hrCancel').onclick = () => resetHourForm();
  // 清除:所有工時紀錄回到預設(只留一筆、時間 08:30~17:30),姓名與修改中的狀態保留
  $('hrClear').onclick = () => { hrEntries = [newEntry()]; renderHourForm($('hrNameInput').value); };

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
      h('div', { class: 'hint' }, `專案履歷 ${S.data.resumes.length} 份、殘件 ${S.data.remains.length} 筆`),
      h('div', { class: 'hint' }, `檔案 ID(供分享連結 Apps Script 的 FILE_ID):${S.fileId || ''}`),
      h('div', { class: 'hint' }, CFG.SHARE_URL ? '分享連結:免登入檢視已啟用' : '分享連結:尚未設定 SHARE_URL,開啟連結需登入'));
    renderListEditors();
    renderErpDir();
    renderStaffEditor();
    renderPermEditor();
  }
  function renderListEditors() {
    const box = $('listEditors');
    // 重畫後保持原本展開的面板
    const opened = new Set([...box.querySelectorAll('details[data-key]')].filter((d) => d.open).map((d) => d.dataset.key));
    box.innerHTML = '';
    for (const L of CFG.LISTS) {
      const items = L.key === 'project' ? projDesc().filter((p) => !p.support) : (lists()[L.key] || []);
      if (L.key === 'project') { // 唯讀:取自專案管理檔,在「專案管理」新增/修改
        box.append(h('details', { class: 'panel list-panel' },
          h('summary', { class: 'panel-title' }, `${L.label}`, h('span', { class: 'count' }, String(items.length))),
          h('div', { class: 'hint' }, '取自「專案管理」(Project Managment.xlsx),請在專案管理頁新增或修改'),
          h('div', { class: 'list-items' }, ...items.map((it) => h('div', { class: 'list-item' }, h('span', {}, h('b', {}, it.code), ' ', it.name))))));
        continue;
      }
      if (L.key === 'support') { // 一格「代號｜名稱」,以代號 + 名稱兩欄輸入
        const sup = supportList().sort((a, b) => newestFirst(a.code, b.code));
        const ci = h('input', { type: 'text', placeholder: '專案代號' }), ni = h('input', { type: 'text', placeholder: '專案名稱' });
        box.append(h('details', { class: 'panel list-panel' },
          h('summary', { class: 'panel-title' }, `${L.label}`, h('span', { class: 'count' }, String(sup.length))),
          h('div', { class: 'hint' }, '人力支援等不需建立專案管理的專案;會與專案管理的專案一起出現在各頁的專案下拉選單'),
          h('div', { class: 'list-items' }, ...sup.map((it) => h('div', { class: 'list-item' }, h('span', {}, h('b', {}, it.code), ' ', it.name), h('button', {
            type: 'button', class: 'del-btn', 'aria-label': '刪除', onclick: async () => {
              if (!(await confirmYes('刪除支援專案', `確定刪除「${it.code} ${it.name}」?\n(已填入資料的內容不受影響)`, '刪除', 'btn-danger'))) return;
              try { await choiceRemove('support', it.raw); toast('已刪除'); } catch (err) { toast(errMsg(err), 5000); }
              renderListEditors();
            },
          }, '🗑')))),
          h('div', { class: 'add-row two' }, ci, ni, h('button', {
            type: 'button', class: 'btn btn-primary btn-sm', onclick: async () => {
              const c = ci.value.trim(), n = ni.value.trim();
              if (!c || !n) return toast('請輸入專案代號與專案名稱');
              if (projList().some((x) => x.code.toLowerCase() === c.toLowerCase())) return toast('清單中已有此專案代號');
              try { await choiceAdd('support', c + SUP_SEP + n); toast('已新增'); } catch (err) { return toast(errMsg(err), 5000); }
              renderListEditors();
            },
          }, '＋ 加入'))));
        continue;
      }
      const ul = h('div', { class: 'list-items' + (L.sortable ? ' sortable' : '') });
      const sorter = L.sortable ? makeSorter(L.key, ul) : null;
      items.forEach((it) => {
        const label = L.key === 'project' ? h('span', {}, h('b', {}, it.code || '(無代號)'), ' ', it.name) : h('span', {}, it);
        ul.append(h('div', { class: 'list-item', 'data-val': L.sortable ? it : null },
          sorter && sorter.touch ? h('span', { class: 'drag-handle', 'aria-label': '按住拖曳排序' }, '☰') : null,
          L.key === 'pmStage' ? stageColorInput(it) : null, label, h('button', {
          type: 'button', class: 'del-btn', 'aria-label': '刪除', onclick: async () => {
            const name = L.key === 'project' ? `${it.code} ${it.name}` : it;
            if (!(await confirmYes('刪除選單項目', `確定從「${L.label}」刪除「${name}」?\n(已填入資料的內容不受影響)`, '刪除', 'btn-danger'))) return;
            try { await choiceRemove(L.key, it); toast('已刪除'); } catch (err) { toast(errMsg(err), 5000); }
            renderListEditors();
          },
        }, '🗑')));
      });
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
      box.append(h('details', { class: 'panel list-panel', 'data-key': L.key, open: opened.has(L.key) || null },
        h('summary', { class: 'panel-title' }, `${L.label}`, h('span', { class: 'count' }, String(items.length))),
        sorter ? h('div', { class: 'hint' }, (sorter.touch ? '按住左側 ☰ 上下拖曳調整順序' : '點選項目後,用 ▲▼ 連續點擊移動') + ';下拉選單依此順序顯示' +
          (L.key === 'pmStage' ? ',逾期判斷也依此順序(排在「現地安裝」之前視為未到現場)。點左側色塊可選擇該階段在專案管理卡片上的顏色' : '')) : null,
        sorter ? sorter.bar : null,
        ul, h('div', { class: 'add-row' + (L.key === 'project' ? ' two' : '') }, ...inputs, addBtn)));
    }
  }
  // 專案管理階段顏色:點色塊選色,選定即存檔(專案管理卡片的階段標籤使用此顏色)
  function stageColorInput(stage) {
    const inp = h('input', { type: 'color', class: 'stage-color', title: '選擇「' + stage + '」的顏色', 'aria-label': stage + ' 顏色' });
    inp.value = stageColor(stage);
    inp.addEventListener('change', async () => {
      try { await choiceStageColor(stage, inp.value); toast('✅ 「' + stage + '」顏色已儲存'); } catch (err) { toast('儲存失敗:' + errMsg(err), 5000); inp.value = stageColor(stage); }
    });
    return inp;
  }
  // 清單排序:手機(觸控)按住 ☰ 拖曳;電腦點選項目後用一組 ▲▼ 連續移動。移動後停 0.8 秒才一次存檔
  function makeSorter(key, ul) {
    const touch = matchMedia('(pointer: coarse)').matches;
    const order = () => [...ul.children].map((el) => el.dataset.val).filter((v) => v != null);
    let saved = JSON.stringify(order()), timer = 0, chain = Promise.resolve();
    const status = h('span', { class: 'sort-status' });
    const save = () => {
      clearTimeout(timer);
      timer = setTimeout(() => {
        const o = order();
        if (JSON.stringify(o) === saved) return;
        status.textContent = '儲存中…';
        chain = chain.then(() => choiceOrder(key, o)).then(() => { saved = JSON.stringify(o); status.textContent = '✓ 已儲存'; },
          (err) => { status.textContent = ''; toast('順序儲存失敗:' + errMsg(err), 5000); renderListEditors(); });
      }, touch ? 0 : 800);
    };
    if (touch) {
      // 拖曳:按住 ☰ 上下移動,經過其他項目的中線就交換位置;靠近畫面上下緣時自動捲動
      let drag = null;
      ul.addEventListener('pointerdown', (e) => {
        const hd = e.target.closest('.drag-handle');
        if (!hd) return;
        e.preventDefault();
        const el = hd.closest('.list-item');
        drag = { el, id: e.pointerId, y: e.clientY };
        el.classList.add('dragging');
        hd.setPointerCapture(e.pointerId);
        const tick = () => {
          if (!drag) return;
          const edge = 70, H = window.innerHeight;
          if (drag.y < edge) window.scrollBy(0, -8); else if (drag.y > H - edge) window.scrollBy(0, 8);
          place();
          drag.raf = setTimeout(tick, 16);
        };
        tick();
      });
      const place = () => {
        const { el, y } = drag;
        const prev = el.previousElementSibling, next = el.nextElementSibling;
        if (prev && y < prev.getBoundingClientRect().top + prev.offsetHeight / 2) ul.insertBefore(el, prev);
        else if (next && y > next.getBoundingClientRect().top + next.offsetHeight / 2) ul.insertBefore(next, el);
      };
      ul.addEventListener('pointermove', (e) => { if (drag && e.pointerId === drag.id) { drag.y = e.clientY; place(); } });
      const end = (e) => {
        if (!drag || e.pointerId !== drag.id) return;
        clearTimeout(drag.raf);
        drag.el.classList.remove('dragging');
        drag = null;
        save();
      };
      ul.addEventListener('pointerup', end);
      ul.addEventListener('pointercancel', end);
      return { touch, bar: h('div', { class: 'sort-bar' }, status) };
    }
    // 電腦:點選項目 → ▲▼ 移動
    let sel = null;
    const up = h('button', { type: 'button', class: 'btn btn-ghost btn-sm', title: '上移', disabled: true, onclick: () => mv(-1) }, '▲ 上移');
    const dn = h('button', { type: 'button', class: 'btn btn-ghost btn-sm', title: '下移', disabled: true, onclick: () => mv(1) }, '▼ 下移');
    const sync = () => {
      for (const el of ul.children) el.classList.toggle('selected', el === sel);
      up.disabled = !sel || !sel.previousElementSibling;
      dn.disabled = !sel || !sel.nextElementSibling;
    };
    const mv = (dir) => {
      if (!sel) return;
      if (dir < 0 && sel.previousElementSibling) ul.insertBefore(sel, sel.previousElementSibling);
      else if (dir > 0 && sel.nextElementSibling) ul.insertBefore(sel.nextElementSibling, sel);
      else return;
      sel.scrollIntoView({ block: 'nearest' });
      sync();
      status.textContent = '';
      save();
    };
    ul.addEventListener('click', (e) => {
      if (e.target.closest('button, input')) return;
      const el = e.target.closest('.list-item');
      if (!el) return;
      sel = sel === el ? null : el;
      sync();
    });
    return { touch, bar: h('div', { class: 'sort-bar' }, up, dn, status) };
  }
  // 公司人員:姓名/英文姓名/部門/E-Mail(存在 Excel「公司人員」工作表),可新增、編輯與刪除;只重畫面板內容,保持展開
  const staffList = () => (S.data ? Staff.read(S.data.book) : []);
  function renderStaffEditor() {
    const box = $('staffEditor');
    box.innerHTML = '';
    const count = h('span', { class: 'count' });
    const body = h('div', {});
    const panel = h('details', { class: 'panel list-panel' }, h('summary', { class: 'panel-title' }, '公司人員', count), body);
    const save = (label, fn) => commit(label, (d) => { const list = Staff.read(d.book); fn(list); Staff.write(d.book, list); });
    const same = (p) => (x) => Staff.FIELDS.every((f) => x[f.key] === p[f.key]);
    let editing = null; // 編輯中的那一筆(原始值)
    // 輸入欄位組;回傳 { els, value() };value() 驗證失敗時回傳 null
    const inputsFor = (p, others) => {
      const els = Staff.FIELDS.map((f) => {
        const el = h('input', { type: f.key === 'email' ? 'email' : 'text', placeholder: f.label });
        el.value = (p && p[f.key]) || '';
        return el;
      });
      const value = () => {
        const v = Object.fromEntries(Staff.FIELDS.map((f, i) => [f.key, els[i].value.trim()]));
        v.email = v.email.toLowerCase();
        if (!v.name) return toast('請輸入姓名'), null;
        if (v.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v.email)) return toast('E-Mail 格式不正確'), null;
        if (v.email && others.some((x) => x.email.toLowerCase() === v.email)) return toast('已有相同 E-Mail 的人員'), null;
        if (v.empNo && others.some((x) => x.empNo === v.empNo)) return toast('已有相同員工代號的人員'), null;
        return v;
      };
      return { els, value };
    };
    const draw = () => {
      // 依員工代號排序(沒有代號的排後面,再依姓名)
      const people = staffList().sort((a, b) => (!a.empNo - !b.empNo) || a.empNo.localeCompare(b.empNo, 'en', { numeric: true }) || a.name.localeCompare(b.name, 'zh-Hant'));
      count.textContent = String(people.length);
      const row = (p) => {
        if (editing && same(editing)(p)) {
          const f = inputsFor(p, people.filter((x) => !same(p)(x)));
          return h('div', { class: 'list-item staff-item staff-editing' },
            h('div', { class: 'staff-form' }, ...f.els, h('div', { class: 'staff-btns' },
              h('button', { type: 'button', class: 'btn btn-ghost btn-sm', onclick: () => { editing = null; draw(); } }, '取消'),
              h('button', {
                type: 'button', class: 'btn btn-primary btn-sm', onclick: async () => {
                  const v = f.value();
                  if (!v) return;
                  try { await save('儲存人員…', (list) => { const i = list.findIndex(same(p)); if (i >= 0) list[i] = v; else list.push(v); }); toast('已儲存'); } catch (err) { return toast('儲存失敗:' + errMsg(err), 5000); }
                  editing = null;
                  draw();
                  renderPermEditor();
                },
              }, '儲存'))));
        }
        return h('div', { class: 'list-item staff-item' },
          h('span', {}, p.empNo ? h('span', { class: 'staff-no' }, p.empNo) : '', h('b', {}, p.name || '(未填姓名)'), p.ename ? h('small', {}, p.ename) : '', p.dept ? h('small', {}, p.dept) : '',
            p.email ? h('span', { class: 'staff-mail' }, p.email) : ''),
          h('button', { type: 'button', class: 'del-btn', 'aria-label': '編輯', onclick: () => { editing = p; draw(); } }, '✏️'),
          h('button', {
            type: 'button', class: 'del-btn', 'aria-label': '刪除', onclick: async () => {
              if (!(await confirmYes('刪除人員', `確定刪除「${[p.name, p.dept].filter(Boolean).join(' / ')}」?`, '刪除', 'btn-danger'))) return;
              try { await save('刪除人員…', (list) => { const i = list.findIndex(same(p)); if (i >= 0) list.splice(i, 1); }); toast('已刪除'); } catch (err) { toast('刪除失敗:' + errMsg(err), 5000); }
              draw();
              renderPermEditor();
            },
          }, '🗑'));
      };
      const add = inputsFor(null, people);
      body.innerHTML = '';
      body.append(
        h('div', { class: 'list-items' }, ...(people.length ? people.map(row) : [h('div', { class: 'empty small' }, '尚無人員')])),
        h('div', { class: 'staff-form staff-new' }, ...add.els, h('div', { class: 'staff-btns' }, h('button', {
          type: 'button', class: 'btn btn-primary btn-sm', onclick: async () => {
            const v = add.value();
            if (!v) return;
            try { await save('新增人員…', (list) => { list.push(v); }); toast('已新增'); } catch (err) { return toast('新增失敗:' + errMsg(err), 5000); }
            draw();
            renderPermEditor();
          },
        }, '＋ 加入'))),
        importBox());
    };
    // 批次匯入員工代號:從 Excel 複製「員工代號、姓名」兩欄貼上
    const importBox = () => {
      const ta = h('textarea', { rows: 5, class: 'staff-import', placeholder: 'ATK-0001\t王小明\nATK-0002\t李大華' });
      return h('details', { class: 'staff-import-box' }, h('summary', {}, '批次匯入員工代號'),
        h('div', { class: 'hint' }, '從 Excel 複製「員工代號、姓名」兩欄貼上(每行一人)。同名的人會補上員工代號,名單中沒有的人會新增。'),
        ta, h('div', { class: 'staff-btns' }, h('button', {
          type: 'button', class: 'btn btn-primary btn-sm', onclick: async () => {
            if (!ta.value.trim()) return toast('請先貼上員工代號與姓名');
            let r;
            try { await save('匯入員工代號…', (list) => { r = Staff.importEmpNo(list, ta.value); }); } catch (err) { return toast('匯入失敗:' + errMsg(err), 5000); }
            toast(`✅ 已匯入:更新 ${r.updated} 人、新增 ${r.added} 人` + (r.skipped ? `,略過 ${r.skipped} 行` : ''), 4500);
            draw();
            renderPermEditor();
          },
        }, '匯入')));
    };
    draw();
    box.append(panel);
  }

  // 權限:每位人員以核取方塊指定各項權限;名單 = 專案履歷與 Work List 檔案的雲端硬碟共用人員 + 已設定的人員
  const ROLE_LABELS = { owner: '擁有者', organizer: '擁有者', writer: '編輯者', fileOrganizer: '編輯者', commenter: '留言者', reader: '檢視者' };
  function renderPermEditor() {
    const box = $('permEditor');
    box.innerHTML = '';
    const body = h('div', {}, h('div', { class: 'empty small' }, '展開後載入人員名單…'));
    let draft = null, savedSnap = '';
    const orig = new Map(); // 展開時每人的原始權限;儲存時只寫入有改動的人
    const keyStr = (p) => Perms.KEYS.map((k) => (p[k.key] ? 1 : 0)).join('');
    const remember = () => { orig.clear(); draft.forEach((p) => orig.set(p.email, keyStr(p))); savedSnap = snapOf(draft); };
    // 要寫入的權限(只留有勾選的人);與 savedSnap 比較判斷是否還沒儲存
    const toEntries = (list) => list.filter((p) => Perms.KEYS.some((k) => p[k.key]))
      .map((p) => Object.fromEntries([['email', p.email], ...Perms.KEYS.map((k) => [k.key, !!p[k.key]])]));
    const permEntries = () => toEntries(draft);
    const snapOf = (list) => JSON.stringify(toEntries(list).sort((a, b) => a.email.localeCompare(b.email)));
    const panel = h('details', { class: 'panel list-panel' },
      h('summary', { class: 'panel-title' }, '權限'),
      h('div', { class: 'hint' }, '勾選每位人員可使用的功能;沒有勾選「專案管理檢視」或「設定」的人看不到該頁面。管理者固定擁有全部權限。設定存在 Excel「權限」工作表。'),
      body);
    const renderRows = () => {
      body.innerHTML = '';
      const dirty = snapOf(draft) !== savedSnap;
      body.append(h('div', { class: 'list-items' }, ...draft.map((p) => {
        const admin = CFG.ADMINS.map((x) => x.toLowerCase()).includes(p.email);
        const boxes = Perms.KEYS.map((k) => {
          const cb = h('input', { type: 'checkbox' });
          cb.checked = (admin && !k.flag) || !!p[k.key];
          cb.disabled = admin && !k.flag;
          cb.onchange = () => {
            p[k.key] = cb.checked;
            if (k.key === 'pmEdit' && cb.checked) p.pmView = true; // 能編輯一定看得到
            if (k.key === 'pmView' && !cb.checked) p.pmEdit = false;
            renderRows();
          };
          return h('label', { class: 'perm-cb' }, cb, k.label);
        });
        return h('div', { class: 'list-item perm-row' },
          h('div', { class: 'perm-who' }, h('b', {}, p.who.name || p.email), p.who.ename ? h('span', { class: 'perm-ename' }, p.who.ename) : '',
            h('small', {}, [p.who.name ? p.email : '', admin ? '管理者' : p.role ? ROLE_LABELS[p.role] || p.role : '不在目前共用名單'].filter(Boolean).join('・'))),
          h('div', { class: 'perm-cbs' }, ...boxes));
      })), h('div', { class: 'btn-row perm-save' },
        dirty ? h('span', { class: 'perm-dirty' }, '⚠️ 權限已變更,尚未儲存(按「儲存權限」後才生效)') : null,
        h('button', { type: 'button', class: 'btn btn-primary btn-sm' + (dirty ? ' dirty' : ''), onclick: savePerms }, '儲存權限')));
    };
    // 以雲端最新的權限表為準,只套用這次有改動的人(別人同時改的、或畫面開太久的舊資料都不會被覆蓋)
    async function savePerms() {
      const changed = draft.filter((p) => keyStr(p) !== orig.get(p.email));
      try {
        const merged = await commit('儲存權限…', (d) => {
          const cur = Perms.read(d.book);
          if (!cur) { Perms.write(d.book, permEntries()); return toEntries(draft); } // 第一次建立「權限」工作表
          const map = new Map(cur.map((e) => [e.email, e]));
          for (const p of changed) map.set(p.email, { email: p.email, ...Object.fromEntries(Perms.KEYS.map((k) => [k.key, !!p[k.key]])) });
          const out = toEntries([...map.values()]);
          Perms.write(d.book, out);
          return out;
        });
        const byEmail = new Map(merged.map((e) => [e.email, e]));
        draft.forEach((p) => { const e = byEmail.get(p.email) || {}; Perms.KEYS.forEach((k) => { p[k.key] = !!e[k.key]; }); });
        remember();
        renderRows();
        applyPerms();
        toast('✅ 權限已儲存');
      } catch (err) {
        toast(err.status === 403 ? '儲存失敗:您沒有此檔案的編輯權限' : '儲存失敗:' + errMsg(err), 6000);
      }
    }
    panel.addEventListener('toggle', async () => {
      if (!panel.open || draft) return;
      // 先重新下載檔案,顯示雲端上實際存的權限(避免頁面開太久看到舊資料)
      await reload().catch(() => {});
      const people = [];
      let note = '';
      for (const id of [S.fileId, CFG.WORK.FILE_ID]) {
        try { people.push(...await Drive.permissions(id)); } catch { note = '部分檔案無法取得共用名單'; }
      }
      const saved = permList();
      // 還沒有「權限」工作表:以舊版 Work List 免密碼名單預設「近期工作項目編輯」
      const legacy = saved ? [] : await WorkList.legacyEditors();
      const byEmail = new Map();
      const rank = (r) => (r === 'owner' || r === 'organizer' ? 0 : r === 'writer' || r === 'fileOrganizer' ? 1 : r ? 2 : 3);
      for (const x of people) {
        if (!x.emailAddress) continue;
        const email = x.emailAddress.toLowerCase();
        const cur = byEmail.get(email);
        if (!cur || rank(x.role) < rank(cur.role)) byEmail.set(email, { email, role: x.role });
      }
      for (const p of saved || []) byEmail.set(p.email, { ...(byEmail.get(p.email) || { email: p.email, role: '' }), ...p });
      for (const e of legacy) { const cur = byEmail.get(e) || { email: e, role: '' }; cur.work = true; byEmail.set(e, cur); }
      // 以公司人員名單顯示人名;有 E-Mail 的公司人員也一併列出
      const staff = new Map(staffList().filter((x) => x.email).map((x) => [x.email.toLowerCase(), x]));
      for (const e of staff.keys()) if (!byEmail.has(e)) byEmail.set(e, { email: e, role: '' });
      draft = [...byEmail.values()].map((p) => Object.assign(p, { who: staff.get(p.email) || {} }))
        .sort((a, b) => rank(a.role) - rank(b.role) || (a.who.name || a.email).localeCompare(b.who.name || b.email, 'zh-Hant'));
      remember();
      if (!saved) savedSnap = snapOf([]); // 還沒有「權限」工作表:預設值也要按儲存才會建立
      renderRows();
      if (note) body.prepend(h('div', { class: 'hint' }, note));
    });
    box.append(panel);
  }
  $('reloadBtn').onclick = async () => {
    try { await reload(); toast('已重新載入'); showSettings(); } catch (err) { toast(errMsg(err), 5000); }
  };
  $('openDriveBtn').onclick = () => { if (S.meta && S.meta.webViewLink) window.open(S.meta.webViewLink, '_blank', 'noopener'); };
  const signOut = () => { Drive.signOut(); location.hash = ''; location.reload(); };
  $('signOutBtn').onclick = signOut;
  $('navSignOut').onclick = async () => {
    toggleDrawer(false);
    if (await confirmYes('登出', `確定登出 ${myEmail()}?\n下次開啟需要重新登入。`, '登出', 'btn-danger')) signOut();
  };
  $('signInBtn').onclick = signIn;
  if (Drive.IN_APP) {
    $('welcomeMsg').textContent = '您正在 App 內建瀏覽器(如釘釘)中開啟;若登入沒有反應,請點右上角「⋯」→「在瀏覽器中開啟」。';
    $('welcomeMsg').after(h('button', { type: 'button', class: 'btn btn-ghost wide', onclick: () => openInBrowser(false) }, '🌐 改用瀏覽器開啟'));
  }

  // 權杖過期(約 1 小時)時:顯示「繼續」鍵,點擊後以記住的帳號自動完成登入(不需再選帳號)
  let reauthPending = null;
  Drive.setReauth(() => reauthPending || (reauthPending = new Promise((resolve, reject) => {
    const busyMsg = !$('busy').hidden ? $('busyMsg').textContent : '';
    busy('');
    $('confirmTitle').textContent = '登入已逾時';
    $('confirmMsg').textContent = `請按「繼續」以 ${Drive.savedAccount()} 繼續使用(不需重新選帳號)。` +
      (Drive.IS_MOBILE ? '\n手機會先轉到 Google 頁面再自動回來;目前尚未儲存的修改會遺失,可先按「取消」把內容複製起來。' : '');
    const box = $('confirmBtns');
    box.innerHTML = '';
    const done = () => { $('confirmBox').hidden = true; reauthPending = null; };
    box.append(
      h('button', { type: 'button', class: 'btn btn-ghost', onclick: () => { done(); reject(new Error('已取消登入')); } }, '取消'),
      h('button', {
        type: 'button', class: 'btn btn-primary', onclick: () => {
          // 必須在點擊當下直接開 Google 視窗,否則會被瀏覽器擋住
          Drive.requestToken('').then((t) => { done(); if (busyMsg) busy(busyMsg); resolve(t); }, (e) => { done(); reject(e); });
        },
      }, '繼續'));
    $('confirmBox').hidden = false;
  })));
  // 使用中權杖快到期時,趁點擊自動更新
  document.addEventListener('click', () => { if (S.ready) Drive.refreshOnGesture(); }, true);

  // ---------- 其他 ----------
  document.addEventListener('keydown', (e) => {
    if (!$('lightbox').hidden && (e.key === 'ArrowLeft' || e.key === 'ArrowRight')) { e.preventDefault(); lbStep(e.key === 'ArrowLeft' ? -1 : 1); return; }
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
    try { await reload(); applyPerms(); route(); } catch {}
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
      const ok = editing.type === 'work' ? await WorkList.save() : editing.type === 'remain' ? await saveRemain() : editing.type === 'pm' ? await savePm() : editing.type === 'sched' ? await saveSched() : await saveResume();
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

  // 近期工作項目 / 甘特圖(js/worklist.js)
  WorkList.init({
    h, toast, busy, dialog, confirmYes, errMsg, setTitle, isDirty, markDirty,
    myEmail, can, showView: (id, o) => showView(id, o),
    // 存檔後由 Apps Script 把「已排定」項目同步到 Google 日曆
    calSync: CFG.SHARE_URL ? () => gasGet({ a: 'cal' }, 1) : null,
    // obj:進入編輯時的資料(用來判斷是否有未儲存修改);null = 結束編輯
    setEditing: (obj) => { editing = obj ? { type: 'work', obj, snapshot: JSON.stringify(obj), isNew: false, uploads: [] } : null; markDirty(); },
  });

  route();
  // 此裝置登入過:權杖仍有效就直接進入;已過期則登入畫面顯示「繼續使用 xxx」(一鍵、免選帳號)
  const acct = Drive.savedAccount();
  if (Drive.__reset || Drive.isSignedIn()) signIn();
  else if (acct) {
    $('signInBtn').textContent = `繼續使用 ${acct}`;
    if (!$('welcomeMsg').textContent) $('welcomeMsg').textContent = '此裝置已登入過,按上方按鍵即可繼續(不需重新選帳號)。';
  }
  const rErr = Drive.redirectError && Drive.redirectError();
  if (rErr && !Drive.isSignedIn()) { $('welcomeMsg').textContent = rErr; toast(rErr, 5000); }

  window.__pr = { S, Store, commit, get editing() { return editing; } };
})();
