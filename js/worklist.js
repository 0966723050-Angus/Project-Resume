// worklist.js - 近期工作項目 / 甘特圖(資料:共用雲端硬碟上的 Work List.xlsm)
// 由 app.js 呼叫 WorkList.init(ctx) 注入共用的 UI 工具;編輯狀態透過 ctx.setEditing 交給 app.js 的「未儲存」保護
(function () {
  const W = window.APP_CONFIG.WORK;
  const STATUS_OPTIONS = ['已排定', '暫定', '待安排', '未進行', '完工'];
  const $ = (id) => document.getElementById(id);
  let C = null; // ctx

  // D 是 app.js 判斷「有沒有未儲存修改」的比對對象,只放資料
  const D = { rows: [], archive: [], roster: { hw: [], sw: [] } };
  let bytes = null;       // 最後一次下載 / 儲存的檔案內容
  let meta = null;
  let permissions = [];   // 「權限」工作表:{ email, noPassword }
  let loaded = false;
  let loading = null;
  let editMode = false;
  let access = null;      // 是否能讀取 Work List.xlsm(Promise<boolean>)

  const splitNames = (s) => String(s || '').split(/[,，、;；]+/).map((n) => n.trim()).filter(Boolean);
  const fmtDate = (iso) => (iso ? iso.replace(/-/g, '/') : '-');
  const maxRows = () => W.MAX_ROW - W.MIN_ROW + 1;
  const skipPassword = () => !!C.myEmail() && permissions.some((p) => p.email === C.myEmail() && p.noPassword);
  const pad = (n) => String(n).padStart(2, '0');

  function recalcDuration(row) {
    const s = WorkIO.isoDateToSerial(row.start), e = WorkIO.isoDateToSerial(row.end);
    row.duration = s != null && e != null ? e - s + 1 : null;
  }
  // 依計畫開始日期由近到遠;沒日期的排最後(穩定排序)
  function sortByStart(list) {
    list.sort((a, b) => {
      if (!a.start && !b.start) return 0;
      if (!a.start) return 1;
      if (!b.start) return -1;
      return a.start < b.start ? -1 : a.start > b.start ? 1 : 0;
    });
  }
  function badgeOf(status) {
    const s = (status || '').trim();
    if (s === '已排定' || s === '已確定') return { cls: 'confirmed', label: s };
    if (s === '暫定') return { cls: 'tentative', label: s };
    return { cls: 'pending', label: s || '未設定' };
  }
  function namesFromData(key) {
    const set = new Set();
    [...D.rows, ...D.archive].forEach((r) => splitNames(r[key]).forEach((n) => set.add(n)));
    return [...set].sort((a, b) => a.localeCompare(b));
  }

  // ---------- 載入 ----------
  function apply(b, m) {
    bytes = b;
    if (m) meta = m;
    const p = WorkIO.parse(b);
    D.rows = p.rows;
    D.archive = p.archive;
    permissions = p.permissions;
    // 仍留在 List 的「完工」項目改歸入資料庫(下次儲存時才寫回雲端)
    D.rows = D.rows.filter((r) => { if (r.status !== '完工') return true; D.archive.push({ ...r, closed: '' }); return false; });
    sortByStart(D.rows);
    // 還沒有「人員」工作表時,先用現有資料出現過的人名當作初始名單
    D.roster = p.roster || { hw: namesFromData('hw'), sw: namesFromData('sw') };
    loaded = true;
  }
  async function load(quiet) {
    if (loading) return loading;
    if (!quiet) C.busy('讀取 近期工作項目…');
    loading = (async () => {
      try {
        const r = await Drive.download(W.FILE_ID);
        apply(r.bytes, r.meta);
      } catch (err) {
        if (err.status === 403 || err.status === 404) throw new Error(`此帳號沒有「${W.FILE_NAME}」的存取權限,請洽檔案擁有者`);
        throw err;
      }
    })();
    try { await loading; } finally { loading = null; if (!quiet) C.busy(''); }
  }
  // 是否能開啟 Work List.xlsm(決定側邊選單要不要顯示)
  function available() {
    if (!access) access = Drive.getMeta(W.FILE_ID).then(() => true, () => false);
    return access;
  }

  function statusText() {
    if (!meta) return W.FILE_NAME;
    const d = new Date(meta.modifiedTime);
    return `共 ${D.rows.length} 筆 · ${d.getMonth() + 1}/${d.getDate()} ${pad(d.getHours())}:${pad(d.getMinutes())} 更新`;
  }

  // ---------- 頁面 ----------
  let tab = 'list';
  async function show(which) {
    tab = which;
    const isList = which === 'list';
    C.showView(isList ? 'workView' : 'ganttView', { title: isList ? '近期工作項目' : '工作項目甘特圖', sub: statusText(), save: isList && editMode });
    if (!loaded) {
      try { await load(); } catch (err) { C.toast(C.errMsg(err), 6000); $('wlStatus').textContent = '載入失敗:' + C.errMsg(err); return; }
      if (tab !== which) return;
      C.setTitle(isList ? '近期工作項目' : '工作項目甘特圖', statusText());
    }
    if (isList) renderList(); else renderGantt();
  }
  async function refresh() {
    if (editMode) {
      if (C.isDirty() && !(await C.confirmYes('更新資料', '目前正在編輯中,更新資料會放棄未儲存的變更,確定要繼續嗎?', '放棄並更新', 'btn-danger'))) return;
      C.setEditing(null);
      leaveEdit();
    }
    try { await load(); C.toast('資料已更新'); } catch (err) { C.toast(C.errMsg(err), 6000); return; }
    show(tab);
  }

  // ---------- 工作項目清單 ----------
  function renderList() {
    $('wlStatus').textContent = editMode ? `編輯中 · 共 ${D.rows.length} 筆(上限 ${maxRows()} 筆)` : statusText();
    $('wlEdit').hidden = editMode;
    $('wlCancel').hidden = !editMode;
    $('wlSearchDone').hidden = !editMode;
    $('wlRefresh').hidden = editMode;
    $('wlAdd').hidden = !editMode || D.rows.length >= maxRows();
    $('wlEmpty').hidden = D.rows.length > 0;
    const box = $('wlList');
    box.innerHTML = '';
    for (const row of D.rows) box.append(editMode ? editCard(row) : viewCard(row));
  }

  function viewCard(row) {
    const h = C.h;
    const b = badgeOf(row.status);
    const people = [row.hw && `硬體:${row.hw}`, row.sw && `軟體/電控:${row.sw}`].filter(Boolean).join('　');
    const f = (label, value, cls) => h('div', { class: 'wl-f' + (cls ? ' ' + cls : '') }, h('span', { class: 'wl-fl' }, label), h('span', { class: 'wl-fv' }, value));
    return h('div', { class: 'card wl-card' },
      h('div', { class: 'wl-head' }, h('span', { class: 'wl-name' }, row.item || '(未命名項目)'), h('span', { class: 'wl-badge ' + b.cls }, b.label)),
      h('div', { class: 'wl-grid' },
        f('計畫開始', fmtDate(row.start)), f('計畫結束', fmtDate(row.end)),
        f('工時(天)', row.duration ?? '-'), f('狀態', row.status || '-'),
        people && f('作業人員', people, 'full'),
        row.plan && f('預計工作', row.plan, 'full pre'),
        row.note && f('備註', row.note, 'full')));
  }

  function editCard(row) {
    const h = C.h;
    const changed = () => C.markDirty();
    const fld = (label, input, cls) => h('div', { class: 'field' + (cls ? ' ' + cls : '') }, h('span', { class: 'flabel' }, label), input);
    const text = (key, ph) => h('input', { type: 'text', value: row[key] || '', placeholder: ph || '', oninput: (e) => { row[key] = e.target.value; changed(); } });
    const dur = h('input', { type: 'text', value: row.duration ?? '', disabled: true });
    const date = (key) => h('input', { type: 'date', value: row[key] || '', oninput: (e) => { row[key] = e.target.value; recalcDuration(row); dur.value = row.duration ?? ''; changed(); } });
    const sel = h('select', { class: 'wl-select' }, h('option', { value: '' }, '(未設定)'), ...STATUS_OPTIONS.map((s) => h('option', { value: s }, s)));
    sel.value = row.status || '';
    sel.onchange = async () => {
      if (sel.value === '完工') {
        sel.value = row.status || '';
        if (await C.confirmYes('結案', `「${row.item || '(未命名項目)'}」已完工,是否要結案並移至資料庫?`, '結案')) archiveRow(row);
        return;
      }
      row.status = sel.value;
      changed();
    };
    const plan = h('textarea', { rows: 3, placeholder: '預計進行的工作內容', oninput: (e) => { row.plan = e.target.value; changed(); } });
    plan.value = row.plan || '';
    return h('div', { class: 'panel wl-edit' },
      h('div', { class: 'fields wl-fields' },
        fld('工作項目', text('item', '工作項目名稱'), 'span2'),
        fld('計畫開始時間', date('start')), fld('計畫結束時間', date('end')),
        fld('工時(天,自動計算)', dur), fld('狀態', sel),
        peopleField(row, 'hw', '硬體作業人員'), peopleField(row, 'sw', '軟體/電控作業人員'),
        fld('預計工作', plan, 'span2'), fld('備註', text('note'), 'span2')),
      h('div', { class: 'wl-actions' }, h('button', {
        type: 'button', class: 'btn btn-ghost btn-sm', onclick: () => {
          Object.assign(row, { item: '', start: '', end: '', duration: null, status: '', hw: '', sw: '', note: '', plan: '' });
          changed();
          renderList();
        },
      }, '清除此列')));
  }

  // ---------- 人員下拉(可複選,仍可手動輸入;名單存於「人員」工作表) ----------
  function renamePerson(key, oldName, newName) {
    [...D.rows, ...D.archive].forEach((r) => {
      const names = splitNames(r[key]);
      if (names.includes(oldName)) r[key] = [...new Set(names.map((n) => (n === oldName ? newName : n)))].join(',');
    });
  }
  function closePanels() { document.querySelectorAll('.wl-people-panel').forEach((p) => { p.hidden = true; }); }
  document.addEventListener('click', closePanels);

  function peopleField(row, key, label) {
    const h = C.h;
    const input = h('input', { type: 'text', value: row[key] || '', placeholder: '可手動輸入,或按 ▾ 勾選', oninput: () => { row[key] = input.value; C.markDirty(); } });
    const panel = h('div', { class: 'wl-people-panel', hidden: true, onclick: (e) => e.stopPropagation() });
    const setSelected = (names, options) => { input.value = options.filter((n) => names.includes(n)).join(','); row[key] = input.value; C.markDirty(); };

    function renderPanel() {
      const current = splitNames(input.value);
      const list = D.roster[key];
      const options = [...new Set([...list, ...current])]; // 欄位中有、名單沒有的人名也列出,方便取消勾選
      const listEl = h('div', { class: 'wl-people-list' });
      if (!options.length) listEl.append(h('div', { class: 'wl-people-empty' }, '名單是空的,請在下方新增人員'));
      for (const name of options) {
        const inRoster = list.includes(name);
        const cb = h('input', { type: 'checkbox' });
        cb.checked = current.includes(name);
        cb.onchange = () => { const names = splitNames(input.value).filter((n) => n !== name); if (cb.checked) names.push(name); setSelected(names, options); };
        listEl.append(h('div', { class: 'wl-people-opt' }, h('label', {}, cb, h('span', {}, name)),
          inRoster && h('button', {
            type: 'button', class: 'wl-people-act', 'aria-label': '改名', onclick: async () => {
              const next = ((await promptText('人員改名', `將「${name}」改名為(會同步更新所有項目與資料庫):`, name)) || '').trim();
              if (!next || next === name) return;
              if (/[,，、;；]/.test(next)) { C.toast('人名不可包含逗號或分號'); return; }
              D.roster[key] = [...new Set(D.roster[key].map((n) => (n === name ? next : n)))];
              renamePerson(key, name, next);
              C.markDirty();
              renderList();
              C.toast(`已將「${name}」改名為「${next}」,按「儲存」寫回雲端`, 4000);
            },
          }, '✎'),
          inRoster && h('button', {
            type: 'button', class: 'wl-people-act', 'aria-label': '從名單移除', onclick: () => { D.roster[key] = D.roster[key].filter((n) => n !== name); C.markDirty(); renderPanel(); },
          }, '✕')));
      }
      const addInput = h('input', { type: 'text', placeholder: '新增人員(可用逗號一次多筆)' });
      const addNames = () => {
        const added = splitNames(addInput.value);
        if (!added.length) return;
        added.forEach((n) => { if (!D.roster[key].includes(n)) D.roster[key].push(n); });
        setSelected([...splitNames(input.value), ...added], [...new Set([...D.roster[key], ...splitNames(input.value)])]);
        renderPanel();
        panel.querySelector('.wl-people-add input').focus();
      };
      addInput.onkeydown = (e) => { if (e.key === 'Enter') { e.preventDefault(); addNames(); } };
      panel.innerHTML = '';
      panel.append(listEl, h('div', { class: 'wl-people-add' }, addInput, h('button', { type: 'button', class: 'btn btn-primary btn-sm', onclick: addNames }, '＋')));
    }

    const toggle = h('button', {
      type: 'button', class: 'wl-people-toggle', 'aria-label': '勾選人員', onclick: (e) => {
        e.stopPropagation();
        const willOpen = panel.hidden;
        closePanels();
        if (willOpen) { renderPanel(); panel.hidden = false; }
      },
    }, '▾');
    return h('div', { class: 'field wl-people' }, h('span', { class: 'flabel' }, label), h('div', { class: 'wl-people-wrap' }, input, toggle), panel);
  }

  function promptText(title, msg, value) {
    const h = C.h;
    const inp = h('input', { type: 'text', class: 'link-box', value: value || '' });
    inp.onkeydown = (e) => { if (e.key === 'Enter') { e.preventDefault(); document.querySelector('#confirmBtns .btn-primary').click(); } };
    const p = C.dialog(title, h('div', {}, msg, inp), [{ label: '取消', value: false }, { label: '確定', value: true, cls: 'btn-primary' }]);
    setTimeout(() => { inp.focus(); inp.select(); }, 50);
    return p.then((ok) => (ok ? inp.value : null));
  }

  function archiveRow(row) {
    const idx = D.rows.indexOf(row);
    if (idx >= 0) D.rows.splice(idx, 1);
    recalcDuration(row);
    D.archive.push({ item: row.item, start: row.start, end: row.end, duration: row.duration, status: '完工', hw: row.hw, sw: row.sw, note: row.note, plan: row.plan, closed: WorkGantt.toISO(WorkGantt.todayUTC()) });
    C.markDirty();
    renderList();
    C.toast('已結案並移至資料庫,請按右上「儲存」寫回雲端', 4000);
  }

  // ---------- 編輯模式 ----------
  async function askPassword() {
    const h = C.h;
    let err = '';
    for (;;) {
      const inp = h('input', { type: 'password', class: 'link-box', autocomplete: 'off', placeholder: '密碼' });
      inp.onkeydown = (e) => { if (e.key === 'Enter') { e.preventDefault(); document.querySelector('#confirmBtns .btn-primary').click(); } };
      const p = C.dialog('輸入編輯密碼', h('div', {}, '請輸入密碼以解鎖工作項目編輯', inp, err && h('div', { class: 'wl-err' }, err)),
        [{ label: '取消', value: false }, { label: '確認', value: true, cls: 'btn-primary' }]);
      setTimeout(() => inp.focus(), 50);
      if (!(await p)) return false;
      if ((await C.sha256(inp.value)) === W.EDIT_PASSWORD_HASH) return true;
      err = '密碼錯誤,請再試一次';
    }
  }
  async function startEdit() {
    if (editMode || !loaded) return;
    if (!skipPassword() && !(await askPassword())) return;
    editMode = true;
    C.setEditing(D);
    $('saveBtn').hidden = false;
    renderList();
  }
  // 結束編輯;discard 時從最後一次下載的檔案還原資料
  function leaveEdit(discard = true) {
    if (!editMode) return;
    editMode = false;
    if (discard && bytes) apply(bytes);
    closePanels();
    if (!$('workView').hidden) { $('saveBtn').hidden = true; renderList(); }
  }
  async function cancelEdit() {
    if (C.isDirty() && !(await C.confirmYes('取消編輯', '確定要放棄未儲存的變更嗎?', '放棄修改', 'btn-danger'))) return;
    C.setEditing(null);
    leaveEdit();
  }
  function addRow() {
    if (D.rows.length >= maxRows()) { C.toast(`已達最大筆數上限(${maxRows()} 筆)`); return; }
    D.rows.push({ row: null, item: '', start: '', end: '', duration: null, status: '', hw: '', sw: '', note: '', plan: '' });
    sortByStart(D.rows);
    C.markDirty();
    renderList();
    const last = $('wlList').lastElementChild;
    if (last) { last.scrollIntoView({ behavior: 'smooth', block: 'center' }); const i = last.querySelector('input'); if (i) i.focus({ preventScroll: true }); }
  }

  // ---------- 查詢已結案 ----------
  function searchDone() {
    const h = C.h;
    const input = h('input', { type: 'search', class: 'link-box', placeholder: '搜尋已結案項目(項目名稱、人員、備註)', autocomplete: 'off' });
    const results = h('div', { class: 'wl-done' });
    const render = () => {
      const kw = input.value.trim().toLowerCase();
      const list = D.archive
        .filter((a) => !kw || [a.item, a.hw, a.sw, a.note, a.plan, a.start, a.end].some((v) => String(v || '').toLowerCase().includes(kw)))
        .sort((a, b) => String(b.end || b.closed || '').localeCompare(String(a.end || a.closed || '')));
      results.innerHTML = '';
      if (!list.length) { results.append(h('div', { class: 'empty small' }, D.archive.length ? '找不到符合的已結案項目' : '資料庫目前沒有已結案項目')); return; }
      for (const a of list) {
        const people = [a.hw, a.sw].filter(Boolean).join(' / ');
        results.append(h('div', { class: 'wl-done-item' },
          h('div', { class: 'wl-done-name' }, a.item || '(未命名項目)',
            h('small', {}, `${fmtDate(a.start)} ~ ${fmtDate(a.end)}${a.closed ? `・結案 ${fmtDate(a.closed)}` : ''}${people ? `・${people}` : ''}`)),
          h('button', { type: 'button', class: 'btn btn-primary btn-sm', onclick: () => { if (restore(a)) document.querySelector('#confirmBtns button').click(); } }, '叫出編輯')));
      }
    };
    input.oninput = render;
    render();
    C.dialog('查詢已結案項目', h('div', { class: 'wl-done-box' }, h('div', { class: 'hint' }, '點「叫出編輯」可把項目移回編輯清單修改。'), input, results), [{ label: '關閉', value: null }]);
    setTimeout(() => input.focus(), 50);
  }
  function restore(entry) {
    if (D.rows.length >= maxRows()) { C.toast(`編輯清單已達上限(${maxRows()} 筆),請先結案或清除其他項目`, 4000); return false; }
    const idx = D.archive.indexOf(entry);
    if (idx >= 0) D.archive.splice(idx, 1);
    // 保留「完工」與結案日期:不改狀態,儲存時仍回資料庫;改成其他狀態則恢復為進行中
    D.rows.push({ ...entry, row: null });
    sortByStart(D.rows);
    C.markDirty();
    renderList();
    C.toast(`已叫出「${entry.item || '未命名項目'}」,狀態改成其他值即恢復為進行中;維持「完工」則儲存後仍回資料庫`, 5000);
    return true;
  }

  // ---------- 儲存 ----------
  async function save() {
    const today = WorkGantt.toISO(WorkGantt.todayUTC());
    const archiveOut = [...D.archive, ...D.rows.filter((r) => r.status === '完工').map((r) => {
      recalcDuration(r);
      return { item: r.item, start: r.start, end: r.end, duration: r.duration, status: '完工', hw: r.hw, sw: r.sw, note: r.note, plan: r.plan, closed: r.closed || today };
    })];
    const clean = D.rows.filter((r) => r.status !== '完工' && ((r.item && r.item.trim()) || r.status || r.start || r.end)).map((r) => ({ ...r }));
    sortByStart(clean);
    clean.forEach((r, i) => { r.row = W.MIN_ROW + i; }); // 依排序後順序重新指定 Excel 列號
    C.busy('儲存 近期工作項目…');
    try {
      const latest = await Drive.download(W.FILE_ID); // 以雲端最新版為底(保留其他工作表的變更)
      const out = WorkIO.buildPatched(latest.bytes, clean, archiveOut, D.roster);
      C.busy('儲存 近期工作項目(上傳中)…');
      meta = await Drive.upload(W.FILE_ID, out, WorkIO.MIME);
      editMode = false;
      apply(out);
      C.setEditing(null);
      $('saveBtn').hidden = true;
      C.setTitle('近期工作項目', statusText());
      renderList();
      C.toast('✅ 已儲存至雲端硬碟');
      return true;
    } catch (err) {
      C.toast(err.status === 403 ? '儲存失敗:您的帳號只有檢視權限,請聯絡檔案擁有者升級為編輯者' : '儲存失敗:' + C.errMsg(err), 6000);
      return false;
    } finally { C.busy(''); }
  }

  // ---------- 甘特圖 ----------
  let range = WorkGantt.defaultRange();
  let zoom = WorkGantt.DEFAULT_ZOOM_INDEX;
  const ganttEls = () => ({ labels: $('wlGanttLabels'), header: $('wlGanttHeader'), svg: $('wlGanttSvg'), scroll: $('wlGanttScroll'), headerScroll: $('wlGanttHeaderScroll'), tooltip: $('wlTip') });
  function syncInputs() { $('wlStart').value = WorkGantt.toISO(range.start); $('wlEnd').value = WorkGantt.toISO(range.end); }
  function renderGantt() {
    syncInputs();
    // 進行中項目一律列出;已結案只在與檢視區間重疊時列出(斜線長條)
    const rs = WorkGantt.toISO(range.start), re = WorkGantt.toISO(range.end);
    const done = [...D.archive, ...D.rows.filter((r) => r.status === '完工')]
      .filter((a) => a.start && a.end && a.end >= rs && a.start <= re)
      .sort((a, b) => (a.start < b.start ? -1 : a.start > b.start ? 1 : 0))
      .map((a) => ({ ...a, archived: true }));
    WorkGantt.render(ganttEls(), [...D.rows.filter((r) => r.status !== '完工'), ...done], range, zoom);
    $('wlZoomOut').disabled = zoom <= 0;
    $('wlZoomIn').disabled = zoom >= WorkGantt.ZOOM_STEPS.length - 1;
  }
  function bindGantt() {
    $('wlZoomIn').onclick = () => { zoom = Math.min(WorkGantt.ZOOM_STEPS.length - 1, zoom + 1); renderGantt(); };
    $('wlZoomOut').onclick = () => { zoom = Math.max(0, zoom - 1); renderGantt(); };
    $('wlStart').onchange = () => {
      if (!$('wlStart').value) return;
      const s = WorkGantt.parseISO($('wlStart').value);
      if (s > range.end) range.end = s;
      range.start = s;
      renderGantt();
    };
    $('wlEnd').onchange = () => {
      if (!$('wlEnd').value) return;
      const e = WorkGantt.parseISO($('wlEnd').value);
      if (e < range.start) range.start = e;
      range.end = e;
      renderGantt();
    };
    $('wlWeek').onclick = () => { range = WorkGantt.currentWeekRange(); renderGantt(); };
    $('wlTwoMonth').onclick = () => { range = WorkGantt.defaultRange(); renderGantt(); };
    $('wlGanttRefresh').onclick = refresh;
    let t;
    window.addEventListener('resize', () => { clearTimeout(t); t = setTimeout(() => { if (!$('ganttView').hidden && loaded) renderGantt(); }, 200); });
  }

  // ---------- 設定:編輯免密碼 ----------
  const ROLE_LABELS = { owner: '擁有者', organizer: '擁有者', writer: '編輯者', fileOrganizer: '編輯者', commenter: '留言者', reader: '檢視者' };
  function renderSettings(box) {
    const h = C.h;
    const body = h('div', {}, h('div', { class: 'empty small' }, '展開後載入共用人員名單…'));
    let draft = null;
    const panel = h('details', { class: 'panel list-panel' },
      h('summary', { class: 'panel-title' }, '近期工作項目:編輯免密碼'),
      h('div', { class: 'hint' }, `勾選的人員進入工作項目編輯時不需輸入密碼。名單為「${W.FILE_NAME}」目前的雲端硬碟共用人員,設定存在該檔的「權限」工作表。`),
      body);
    const renderRows = () => {
      body.innerHTML = '';
      body.append(h('div', { class: 'list-items' }, ...draft.map((p) => {
        const cb = h('input', { type: 'checkbox', class: 'wl-perm-cb' });
        cb.checked = p.noPassword;
        cb.onchange = () => { p.noPassword = cb.checked; };
        return h('label', { class: 'list-item wl-perm' }, h('span', {}, p.email, h('small', {}, p.role ? ROLE_LABELS[p.role] || p.role : '不在目前共用名單')), cb, '免密碼');
      })), h('div', { class: 'btn-row wl-perm-save' }, h('button', { type: 'button', class: 'btn btn-primary btn-sm', onclick: savePerms }, '儲存權限')));
    };
    async function savePerms() {
      C.busy('儲存權限…');
      try {
        const latest = await Drive.download(W.FILE_ID); // 以雲端最新版為底,只改寫「權限」工作表
        const entries = draft.map((p) => ({ email: p.email, noPassword: p.noPassword }));
        const out = WorkIO.buildPermissions(latest.bytes, entries);
        meta = await Drive.upload(W.FILE_ID, out, WorkIO.MIME);
        if (!editMode) apply(out); else permissions = entries;
        C.toast('✅ 權限已儲存');
      } catch (err) {
        C.toast(err.status === 403 ? '儲存失敗:您沒有此檔案的編輯權限' : '儲存失敗:' + C.errMsg(err), 6000);
      } finally { C.busy(''); }
    }
    panel.addEventListener('toggle', async () => {
      if (!panel.open || draft) return;
      let people = [];
      let note = '';
      try {
        if (!loaded) await load(true);
        people = await Drive.permissions(W.FILE_ID);
      } catch (err) {
        if (!loaded) { body.innerHTML = ''; body.append(h('div', { class: 'empty small' }, '載入失敗:' + C.errMsg(err))); return; }
        note = '無法取得共用名單,僅顯示已設定的人員';
      }
      const byEmail = new Map();
      people.filter((p) => p.emailAddress).forEach((p) => byEmail.set(p.emailAddress.toLowerCase(), { email: p.emailAddress.toLowerCase(), role: p.role, noPassword: false }));
      permissions.forEach((p) => { const cur = byEmail.get(p.email) || { email: p.email, role: '', noPassword: false }; cur.noPassword = p.noPassword; byEmail.set(p.email, cur); });
      const rank = (r) => (r === 'owner' ? 0 : r === 'writer' || r === 'fileOrganizer' || r === 'organizer' ? 1 : 2);
      draft = [...byEmail.values()].sort((a, b) => rank(a.role) - rank(b.role) || a.email.localeCompare(b.email));
      renderRows();
      if (note) body.prepend(h('div', { class: 'hint' }, note));
    });
    box.append(panel);
  }

  function init(ctx) {
    C = ctx;
    $('wlEdit').onclick = startEdit;
    $('wlCancel').onclick = cancelEdit;
    $('wlAdd').onclick = addRow;
    $('wlSearchDone').onclick = searchDone;
    $('wlRefresh').onclick = refresh;
    bindGantt();
  }

  window.WorkList = { init, show, save, available, renderSettings, discard: () => leaveEdit(true), isEditing: () => editMode };
})();
