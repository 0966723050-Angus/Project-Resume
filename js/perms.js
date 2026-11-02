// perms.js - 各人員權限(存在 Project Resume.xlsx 的「權限」工作表,一列一人)
// 欄位:人員(email) | 殘件/追蹤事項編輯 | 近期工作項目編輯 | 專案管理檢視 | 專案管理編輯 | 設定 | 工時統計(全員);打勾 = ✔
// 依表頭文字對應欄位(新增權限項目後,舊檔案的欄位位置不同也讀得正確)
// 管理者(CFG.ADMINS)固定擁有全部權限,不受此表影響
(function () {
  const SHEET = '權限';
  const KEYS = [
    { key: 'remain', label: '殘件/追蹤事項編輯' },
    { key: 'work', label: '近期工作項目編輯' },
    { key: 'pmView', label: '專案管理檢視' },
    { key: 'pmEdit', label: '專案管理編輯' },
    { key: 'settings', label: '設定' },
    { key: 'hoursAll', label: '工時統計(全員)' },
  ];
  const NS = 'http://schemas.openxmlformats.org/spreadsheetml/2006/main';
  const COLS = 'ABCDEFGHIJ';
  const yes = (v) => /^(✔|☑|✅|v|y|是|true|1)/i.test(String(v ?? '').trim());
  const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  const cell = (ref, text) => (text ? `<c r="${ref}" t="inlineStr"><is><t xml:space="preserve">${esc(text)}</t></is></c>` : '');

  // 回傳 null = 檔案還沒有「權限」工作表
  function read(book) {
    const g = WorkIO.grid(book, SHEET);
    if (!g) return null;
    const colOf = {};
    for (const c of COLS.slice(1)) { const k = KEYS.find((x) => x.label === String(g.get(c + 1) ?? '').trim()); if (k) colOf[k.key] = c; }
    const out = [];
    for (let r = 2; r <= g.lastRow; r++) {
      const email = String(g.get('A' + r) ?? '').trim().toLowerCase();
      if (!email) continue;
      const e = { email };
      KEYS.forEach((k) => { e[k.key] = !!colOf[k.key] && yes(g.get(colOf[k.key] + r)); });
      if (e.pmEdit) e.pmView = true;
      out.push(e);
    }
    return out;
  }

  // 整張重寫「權限」工作表(不存在時新增),直接改 book.files;之後由 book.toBytes() 打包
  function write(book, entries) {
    const head = `<row r="1">${['人員', ...KEYS.map((k) => k.label)].map((t, i) => cell(COLS[i] + 1, t)).join('')}</row>`;
    const body = entries.map((e, i) => {
      const r = i + 2;
      return `<row r="${r}">${cell('A' + r, e.email)}${KEYS.map((k, j) => cell(COLS[j + 1] + r, e[k.key] ? '✔' : '')).join('')}</row>`;
    }).join('');
    const cols = [40, 18, 18, 14, 14, 10, 16].map((w, i) => `<col min="${i + 1}" max="${i + 1}" width="${w}" customWidth="1"/>`).join('');
    const xml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><worksheet xmlns="${NS}">` +
      `<sheetViews><sheetView workbookViewId="0"><pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews>` +
      `<sheetFormatPr defaultRowHeight="20"/><cols>${cols}</cols><sheetData>${head}${body}</sheetData></worksheet>`;
    book.files[WorkIO.ensureSheetPath(book.files, SHEET)] = new TextEncoder().encode(xml);
  }

  window.Perms = { KEYS, read, write };
})();
