// drive.js
// Google 登入 + 雲端硬碟檔案存取(支援共用雲端硬碟 ATK,所有呼叫都帶 supportsAllDrives=true)
(function () {
  const CFG = window.APP_CONFIG;
  const LS_HINT = 'pr_login_hint';   // 此裝置曾登入的帳號(下次免選帳號)
  const LS_TOKEN = 'pr_token';       // 存取權杖(約 1 小時有效),重新開啟 App 時免再登入
  const XLSX_MIME = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
  const FOLDER_MIME = 'application/vnd.google-apps.folder';
  const API = 'https://www.googleapis.com/drive/v3/files';
  const UPLOAD = 'https://www.googleapis.com/upload/drive/v3/files';
  const META_FIELDS = 'id,name,version,modifiedTime,lastModifyingUser(displayName,emailAddress),capabilities(canEdit),webViewLink,parents';

  let tokenClient = null;
  let accessToken = null;
  let tokenExpiry = 0;
  let reauth = null;      // 權杖過期且無法自動更新時,由 App 顯示「繼續」對話框重新取得
  let refreshing = null;

  function lsGet(k) { try { return localStorage.getItem(k); } catch { return null; } }
  function lsSet(k, v) { try { v == null ? localStorage.removeItem(k) : localStorage.setItem(k, v); } catch {} }

  // 還原上次的權杖(未過期才用)
  try {
    const saved = JSON.parse(lsGet(LS_TOKEN) || 'null');
    if (saved && saved.t && saved.exp > Date.now() + 60000) { accessToken = saved.t; tokenExpiry = saved.exp; }
  } catch {}

  // 手機(含釘釘等 App 內建瀏覽器、加到主畫面的 App):Google 彈出視窗登入完常無法把結果傳回原頁面而卡住,
  // 改用整頁導向登入 → 回到本頁網址並在 # 後面帶回權杖
  const LS_REDIRECT = 'pr_oauth_redirect';
  const IS_MOBILE = /Android|iPhone|iPad|iPod|Mobile|DingTalk/i.test(navigator.userAgent) ||
    (navigator.maxTouchPoints > 1 && /Macintosh/.test(navigator.userAgent));
  const redirectUri = () => location.origin + location.pathname;
  let redirectError = '';
  (function handleRedirectReturn() {
    const hs = location.hash.replace(/^#/, '');
    if (!/(^|&)(access_token|error)=/.test(hs)) return;
    const p = new URLSearchParams(hs);
    let saved = null;
    try { saved = JSON.parse(lsGet(LS_REDIRECT) || 'null'); } catch {}
    lsSet(LS_REDIRECT, null);
    if (!saved || p.get('state') !== saved.state) redirectError = '登入驗證失敗,請重新登入';
    else if (p.get('error')) redirectError = p.get('error') === 'access_denied' ? '已取消登入' : '登入失敗:' + p.get('error');
    else {
      accessToken = p.get('access_token');
      tokenExpiry = Date.now() + (Number(p.get('expires_in')) || 3600) * 1000 - 60000;
      lsSet(LS_TOKEN, JSON.stringify({ t: accessToken, exp: tokenExpiry }));
    }
    history.replaceState(null, '', location.pathname + location.search + ((saved && saved.hash) || '#/'));
  })();
  function redirectLogin(prompt) {
    const state = Math.random().toString(36).slice(2) + Date.now().toString(36);
    lsSet(LS_REDIRECT, JSON.stringify({ state, hash: location.hash }));
    const u = new URLSearchParams({
      client_id: CFG.GOOGLE_CLIENT_ID, redirect_uri: redirectUri(), response_type: 'token',
      scope: CFG.DRIVE_SCOPE, include_granted_scopes: 'true', state,
    });
    const hint = lsGet(LS_HINT);
    if (hint) u.set('login_hint', hint);
    if (prompt === undefined && !hint) u.set('prompt', 'select_account');
    location.href = 'https://accounts.google.com/o/oauth2/v2/auth?' + u;
    return new Promise(() => {}); // 頁面即將離開
  }

  function requestToken(prompt) {
    if (IS_MOBILE) return redirectLogin(prompt);
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
        lsSet(LS_TOKEN, JSON.stringify({ t: accessToken, exp: tokenExpiry }));
        resolve(accessToken);
      };
      tokenClient.error_callback = (err) => {
        const e = new Error(err && err.type === 'popup_closed' ? '已關閉登入視窗' : err && err.type === 'popup_failed_to_open' ? '登入視窗被瀏覽器擋住' : '登入失敗');
        e.type = err && err.type;
        reject(e);
      };
      const opts = { prompt: prompt ?? '' };
      const hint = lsGet(LS_HINT);
      if (hint) opts.login_hint = hint;
      tokenClient.requestAccessToken(opts);
    });
  }

  async function ensureToken() {
    if (accessToken && Date.now() < tokenExpiry) return accessToken;
    // 已登入過的裝置:在非點擊情境下開不了登入視窗,改由 App 顯示「繼續」鍵(點擊後自動完成,不需再選帳號)
    if (reauth && lsGet(LS_HINT)) return reauth();
    return requestToken(lsGet(LS_HINT) ? '' : undefined);
  }

  // 使用中若權杖快到期,趁使用者點擊時自動更新(Google 視窗會自動關閉),避免操作到一半要重新登入
  function refreshOnGesture() {
    if (IS_MOBILE) return; // 手機是整頁導向,不能在操作中途自動更新
    if (refreshing || !accessToken || !lsGet(LS_HINT) || tokenExpiry - Date.now() > 10 * 60000) return;
    refreshing = requestToken('').catch(() => {}).finally(() => { refreshing = null; });
  }

  const isSignedIn = () => !!accessToken && Date.now() < tokenExpiry;
  const savedAccount = () => lsGet(LS_HINT);
  const setReauth = (fn) => { reauth = fn; };

  async function api(url, opts = {}, retry = true) {
    await ensureToken();
    const resp = await fetch(url, { ...opts, headers: { ...(opts.headers || {}), Authorization: 'Bearer ' + accessToken } });
    if (resp.status === 401 && retry) {
      accessToken = null;
      tokenExpiry = 0;
      await ensureToken();
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
    lsSet(LS_TOKEN, null);
  }

  const viewLink = (id) => `https://drive.google.com/file/d/${id}/view`;

  window.Drive = { IS_MOBILE, redirectError: () => redirectError, requestToken, isSignedIn, savedAccount, setReauth, refreshOnGesture, ensureToken, findByName, getMeta, download, upload, createFile, ensureFolder, media, trash, whoAmI, signOut, viewLink };
})();
