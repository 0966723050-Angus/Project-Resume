// drive.js
// Google 登入 + 雲端硬碟檔案存取(支援共用雲端硬碟 ATK,所有呼叫都帶 supportsAllDrives=true)
(function () {
  const CFG = window.APP_CONFIG;
  const LS_HINT = 'pr_login_hint';
  const XLSX_MIME = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
  const FOLDER_MIME = 'application/vnd.google-apps.folder';
  const API = 'https://www.googleapis.com/drive/v3/files';
  const UPLOAD = 'https://www.googleapis.com/upload/drive/v3/files';
  const META_FIELDS = 'id,name,version,modifiedTime,lastModifyingUser(displayName,emailAddress),capabilities(canEdit),webViewLink,parents';

  let tokenClient = null;
  let accessToken = null;
  let tokenExpiry = 0;

  function lsGet(k) { try { return localStorage.getItem(k); } catch { return null; } }
  function lsSet(k, v) { try { v == null ? localStorage.removeItem(k) : localStorage.setItem(k, v); } catch {} }

  function requestToken(prompt) {
    return new Promise((resolve, reject) => {
      if (!window.google || !google.accounts || !google.accounts.oauth2) {
        reject(new Error('Google 登入元件尚未載入,請確認網路後重試'));
        return;
      }
      if (!tokenClient) {
        tokenClient = google.accounts.oauth2.initTokenClient({ client_id: CFG.GOOGLE_CLIENT_ID, scope: CFG.DRIVE_SCOPE, callback: () => {} });
      }
      tokenClient.callback = (resp) => {
        if (resp.error) { reject(new Error(resp.error_description || resp.error)); return; }
        accessToken = resp.access_token;
        tokenExpiry = Date.now() + (Number(resp.expires_in) || 3600) * 1000 - 60000;
        resolve(accessToken);
      };
      tokenClient.error_callback = (err) => reject(new Error(err && err.type === 'popup_closed' ? '已關閉登入視窗' : '登入失敗'));
      const opts = { prompt: prompt ?? '' };
      const hint = lsGet(LS_HINT);
      if (hint) opts.login_hint = hint;
      tokenClient.requestAccessToken(opts);
    });
  }

  async function ensureToken() {
    if (accessToken && Date.now() < tokenExpiry) return accessToken;
    return requestToken(accessToken ? '' : undefined);
  }

  async function api(url, opts = {}, retry = true) {
    await ensureToken();
    const resp = await fetch(url, { ...opts, headers: { ...(opts.headers || {}), Authorization: 'Bearer ' + accessToken } });
    if (resp.status === 401 && retry) {
      accessToken = null;
      await requestToken('');
      return api(url, opts, false);
    }
    return resp;
  }

  async function apiError(resp, what) {
    let msg = '';
    try { msg = (await resp.json()).error.message; } catch {}
    const e = new Error(`${what}失敗(${resp.status})${msg ? ':' + msg : ''}`);
    e.status = resp.status;
    return e;
  }
  const q = (s) => s.replace(/\\/g, '\\\\').replace(/'/g, "\\'");

  // 依完整檔名找檔案(最近修改的優先),找不到回傳 null
  async function findByName(name) {
    const query = encodeURIComponent(`name = '${q(name)}' and trashed = false`);
    const resp = await api(`${API}?supportsAllDrives=true&includeItemsFromAllDrives=true&corpora=allDrives&orderBy=modifiedTime desc&pageSize=10` +
      `&fields=${encodeURIComponent('files(' + META_FIELDS + ')')}&q=${query}`);
    if (!resp.ok) throw await apiError(resp, '搜尋檔案');
    const { files = [] } = await resp.json();
    return files[0] || null;
  }

  async function getMeta(fileId) {
    const resp = await api(`${API}/${fileId}?supportsAllDrives=true&fields=${encodeURIComponent(META_FIELDS)}`);
    if (!resp.ok) throw await apiError(resp, '讀取檔案資訊');
    return resp.json();
  }

  async function download(fileId) {
    const meta = await getMeta(fileId);
    const resp = await api(`${API}/${fileId}?alt=media&supportsAllDrives=true`, { cache: 'no-store' });
    if (!resp.ok) throw await apiError(resp, '下載檔案');
    return { meta, bytes: await resp.arrayBuffer() };
  }

  async function upload(fileId, bytes, mime = XLSX_MIME) {
    const resp = await api(`${UPLOAD}/${fileId}?uploadType=media&supportsAllDrives=true&fields=${encodeURIComponent(META_FIELDS)}`,
      { method: 'PATCH', headers: { 'Content-Type': mime }, body: bytes });
    if (!resp.ok) throw await apiError(resp, '儲存檔案');
    return resp.json();
  }

  // 在資料夾建立新檔案(圖片/附件)
  async function createFile(name, blob, mime, parents) {
    const boundary = 'pr' + Math.random().toString(36).slice(2);
    const head = `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n` +
      JSON.stringify({ name, mimeType: mime, parents }) + `\r\n--${boundary}\r\nContent-Type: ${mime}\r\n\r\n`;
    const body = new Blob([head, blob, `\r\n--${boundary}--`]);
    const resp = await api(`${UPLOAD}?uploadType=multipart&supportsAllDrives=true&fields=${encodeURIComponent('id,name,webViewLink,mimeType')}`,
      { method: 'POST', headers: { 'Content-Type': `multipart/related; boundary=${boundary}` }, body });
    if (!resp.ok) throw await apiError(resp, '上傳檔案');
    return resp.json();
  }

  // 找/建立 parent 底下的子資料夾
  async function ensureFolder(name, parentId) {
    const query = encodeURIComponent(`name = '${q(name)}' and mimeType = '${FOLDER_MIME}' and '${parentId}' in parents and trashed = false`);
    const resp = await api(`${API}?supportsAllDrives=true&includeItemsFromAllDrives=true&corpora=allDrives&pageSize=5&fields=files(id)&q=${query}`);
    if (!resp.ok) throw await apiError(resp, '尋找附件資料夾');
    const { files = [] } = await resp.json();
    if (files[0]) return files[0].id;
    const created = await api(`${API}?supportsAllDrives=true&fields=id`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, mimeType: FOLDER_MIME, parents: [parentId] }),
    });
    if (!created.ok) throw await apiError(created, '建立附件資料夾');
    return (await created.json()).id;
  }

  // 讀取檔案內容(顯示圖片縮圖用)
  async function media(fileId) {
    const resp = await api(`${API}/${fileId}?alt=media&supportsAllDrives=true`);
    if (!resp.ok) throw await apiError(resp, '讀取圖片');
    return resp.blob();
  }

  // 移到垃圾桶(取消編輯時清掉剛上傳但未儲存的檔案;非永久刪除)
  async function trash(fileId) {
    const resp = await api(`${API}/${fileId}?supportsAllDrives=true`, {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ trashed: true }),
    });
    return resp.ok;
  }

  async function whoAmI() {
    const resp = await api('https://www.googleapis.com/drive/v3/about?fields=user(displayName,emailAddress)');
    if (!resp.ok) return null;
    const { user } = await resp.json();
    if (user && user.emailAddress) lsSet(LS_HINT, user.emailAddress);
    return user;
  }

  function signOut() {
    if (accessToken && window.google && google.accounts) google.accounts.oauth2.revoke(accessToken, () => {});
    accessToken = null;
    tokenExpiry = 0;
    lsSet(LS_HINT, null);
  }

  const viewLink = (id) => `https://drive.google.com/file/d/${id}/view`;

  window.Drive = { ensureToken, findByName, getMeta, download, upload, createFile, ensureFolder, media, trash, whoAmI, signOut, viewLink };
})();
