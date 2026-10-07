// mock-drive.js — 僅供本機測試(localhost 且網址帶 ?mock=1 才載入):
// 以 _test/Project Resume.xlsx 模擬雲端硬碟,存檔內容保存在 localStorage,上傳的圖片/附件存在記憶體。
(function () {
  const LS = 'pr_mock_xlsx';
  const files = {};
  let seq = 1;
  const b64 = (u8) => { let s = ''; for (let i = 0; i < u8.length; i += 0x8000) s += String.fromCharCode(...u8.subarray(i, i + 0x8000)); return btoa(s); };
  const unb64 = (s) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));
  let version = 1;
  const meta = () => ({
    id: 'xlsx1', name: 'Project Resume.xlsx', version: String(version), modifiedTime: new Date().toISOString(),
    lastModifyingUser: { displayName: '測試者' }, capabilities: { canEdit: true }, webViewLink: '#', parents: ['folder0'],
  });
  async function bytes() {
    const saved = localStorage.getItem(LS);
    if (saved) return unb64(saved).buffer;
    return (await fetch('_test/Project%20Resume.xlsx', { cache: 'no-store' })).arrayBuffer();
  }
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  window.Drive = {
    async ensureToken() { return 'mock'; },
    async whoAmI() { return { displayName: '測試者', emailAddress: 'test@example.com' }; },
    signOut() {},
    async findByName() { return meta(); },
    async getMeta() { return meta(); },
    async download() { await wait(120); return { meta: meta(), bytes: await bytes() }; },
    async upload(id, data) { await wait(150); localStorage.setItem(LS, b64(new Uint8Array(data))); version++; return meta(); },
    async ensureFolder() { return 'folder1'; },
    async createFile(name, blob, mime) { await wait(100); const id = 'mock' + (seq++); files[id] = blob; return { id, name, mimeType: mime, webViewLink: '#' }; },
    async media(id) { if (!files[id]) throw new Error('找不到檔案'); return files[id]; },
    async trash(id) { delete files[id]; return true; },
    viewLink: (id) => `https://drive.google.com/file/d/${id}/view`,
    __reset() { localStorage.removeItem(LS); },
  };
})();
