// mock-drive.js — 僅供本機測試(localhost 且網址帶 ?mock=1 才載入):
// 以 _test/ 內的 xlsx 模擬雲端硬碟(Project Resume / Project Managment),存檔內容保存在 localStorage,上傳的圖片/附件存在記憶體。
(function () {
  const SRC = {
    xlsx1: { name: 'Project Resume.xlsx', url: '_test/Project%20Resume.xlsx', ls: 'pr_mock_xlsx' },
    pm1: { name: 'Project Managment.xlsx', url: '_test/Project%20Managment.xlsx', ls: 'pr_mock_pm' },
  };
  const files = {};
  const version = { xlsx1: 1, pm1: 1 };
  let seq = 1;
  const b64 = (u8) => { let s = ''; for (let i = 0; i < u8.length; i += 0x8000) s += String.fromCharCode(...u8.subarray(i, i + 0x8000)); return btoa(s); };
  const unb64 = (s) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));
  const meta = (id) => ({
    id, name: SRC[id].name, version: String(version[id]), modifiedTime: new Date().toISOString(),
    lastModifyingUser: { displayName: '測試者' }, capabilities: { canEdit: true }, webViewLink: '#', parents: ['folder0'],
  });
  async function bytes(id) {
    const saved = localStorage.getItem(SRC[id].ls);
    if (saved) return unb64(saved).buffer;
    return (await fetch(SRC[id].url, { cache: 'no-store' })).arrayBuffer();
  }
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  const idOf = (id) => (SRC[id] ? id : 'xlsx1');
  // 程式建立的文字檔(例如 Project Schedule.json)存在 localStorage
  const LS_FILES = 'pr_mock_files';
  const created = () => { try { return JSON.parse(localStorage.getItem(LS_FILES) || '{}'); } catch { return {}; } };
  const saveCreated = (o) => localStorage.setItem(LS_FILES, JSON.stringify(o));
  const cMeta = (id, f) => ({ id, name: f.name, version: String(f.v || 1), modifiedTime: new Date().toISOString(), parents: ['folder0'], webViewLink: '#' });
  window.Drive = {
    async ensureToken() { return 'mock'; },
    async requestToken() { return 'mock'; },
    isSignedIn: () => true,
    savedAccount: () => 'test@example.com',
    setReauth() {},
    refreshOnGesture() {},
    async whoAmI() { const u = localStorage.getItem('pr_mock_user'); return u ? JSON.parse(u) : { displayName: '測試者', emailAddress: 'test@example.com' }; },
    signOut() {},
    async findByName(name) {
      const id = Object.keys(SRC).find((k) => SRC[k].name === name);
      if (id) return meta(id);
      const c = created(); const cid = Object.keys(c).find((k) => c[k].name === name);
      return cid ? cMeta(cid, c[cid]) : null;
    },
    async getMeta(id) { return meta(idOf(id)); },
    async download(id) {
      const c = created()[id];
      if (c) { await wait(80); return { meta: cMeta(id, c), bytes: unb64(c.b64).buffer }; }
      id = idOf(id); await wait(120); return { meta: meta(id), bytes: await bytes(id) };
    },
    async upload(id, data) {
      const all = created();
      if (all[id]) { const u8 = data instanceof Blob ? new Uint8Array(await data.arrayBuffer()) : new Uint8Array(data); all[id].b64 = b64(u8); all[id].v = (all[id].v || 1) + 1; saveCreated(all); return cMeta(id, all[id]); }
      id = idOf(id); await wait(150); localStorage.setItem(SRC[id].ls, b64(new Uint8Array(data))); version[id]++; return meta(id);
    },
    async ensureFolder() { return 'folder1'; },
    async createFile(name, blob, mime) {
      await wait(100);
      if (/json|text/.test(mime || '')) {
        const all = created(); const id = 'mockf' + Date.now();
        all[id] = { name, b64: b64(new Uint8Array(await blob.arrayBuffer())), v: 1 }; saveCreated(all);
        return { id, name, mimeType: mime, webViewLink: '#' };
      }
      const id = 'mock' + (seq++); files[id] = blob; return { id, name, mimeType: mime, webViewLink: '#' };
    },
    async media(id) { if (!files[id]) throw new Error('找不到檔案'); return files[id]; },
    async trash(id) { delete files[id]; return true; },
    viewLink: (id) => `https://drive.google.com/file/d/${id}/view`,
    __reset() { for (const s of Object.values(SRC)) localStorage.removeItem(s.ls); localStorage.removeItem(LS_FILES); },
  };
})();
