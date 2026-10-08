// ATK專案履歷 - 全域設定
window.APP_CONFIG = {
  // 與「ATK部門週報」共用同一個 Google Cloud 專案(worklist050)的憑證,
  // 已授權來源 https://0966723050-angus.github.io
  GOOGLE_CLIENT_ID: '873968217418-q5t3i90e4pf04kbd4l6vbpjib13etb7o.apps.googleusercontent.com',
  DRIVE_SCOPE: 'https://www.googleapis.com/auth/drive',

  // 共用雲端硬碟「ATK」上的檔案;誰能開由雲端硬碟共用設定決定
  FILE_NAME: 'Project Resume.xlsx',
  // 圖片/附件上傳到與 Excel 同一資料夾下的此子資料夾(不存在時自動建立)
  UPLOAD_FOLDER: 'Project Resume 附件',

  // 「Project Resume」工作表:一列 = 一個問題;同一份履歷的多個問題共用「履歷編號」
  // kind:c 置中 / w 換行文字 / dt 日期時間 / d 日期 / n 數字;head = 只寫在履歷的第一列(避免加總重複)
  RESUME_SHEET: 'Project Resume',
  RESUME_COLS: [
    { key: 'code', title: '專案代號', kind: 'c' },
    { key: 'name', title: '專案名稱', kind: 'w' },
    { key: 'plant', title: '作業廠區', kind: 'c' },
    { key: 'line', title: '線別', kind: 'c' },
    { key: 'equip', title: '設備名稱', kind: 'c' },
    { key: 'unit', title: '單元', kind: 'c' },
    { key: 'stage', title: '專案階段', kind: 'c' },
    { key: 'start', title: '作業開始時間', kind: 'dt' },
    { key: 'end', title: '作業結束時間', kind: 'dt' },
    { key: 'hours', title: '報工時數', kind: 'n', head: true },
    { key: 'members', title: '協同作業人員', kind: 'c' },
    { key: 'work', title: '工作內容', kind: 'w', head: true },
    { key: 'problem', title: '問題描述', kind: 'w', prob: true },
    { key: 'images', title: '圖片', kind: 'w', head: true },   // 整份履歷共用(放在工作內容下方),只寫第一列
    { key: 'files', title: '附件', kind: 'w', head: true },
    { key: 'cause', title: '發生原因', kind: 'w', prob: true },
    { key: 'temp', title: '暫定對策', kind: 'w', prob: true },
    { key: 'perm', title: '永久對策', kind: 'w', prob: true },
    { key: 'result', title: '處理結果', kind: 'w', prob: true },
    { key: 'note', title: '備註', kind: 'w', prob: true },
    { key: 'id', title: '履歷編號', kind: 'c' },
    { key: 'remain', title: '轉殘件', kind: 'c', prob: true },
    { key: 'author', title: '填表人', kind: 'c' },
    { key: 'authorEmail', title: '填表人Email', kind: 'c' },
    { key: 'shareKey', title: '分享碼', kind: 'c' },
  ],

  // 「Remain Item」工作表
  REMAIN_SHEET: 'Remain Item',
  REMAIN_COLS: [
    { key: 'date', title: '日期', kind: 'd' },
    { key: 'code', title: '專案代號', kind: 'c' },
    { key: 'name', title: '專案名稱', kind: 'w' },
    { key: 'problem', title: '問題描述', kind: 'w' },
    { key: 'cause', title: '發生原因', kind: 'w' },
    { key: 'temp', title: '暫定對策', kind: 'w' },
    { key: 'perm', title: '永久對策', kind: 'w' },
    { key: 'ecn', title: 'ECN', kind: 'c' },
    { key: 'dept', title: '權責區分', kind: 'c' },
    { key: 'owner', title: '負責人', kind: 'c' },
    { key: 'due', title: '改善期限', kind: 'd' },
    { key: 'progress', title: '改善進度與結果', alt: ['改善進度及結果'], kind: 'w' },
    { key: 'status', title: '狀態', kind: 'c' },
    { key: 'note', title: '備註', kind: 'w' },
    { key: 'files', title: '附件', kind: 'w' },
    { key: 'src', title: '來源履歷', kind: 'c' },
    { key: 'id', title: '殘件編號', kind: 'c' },
    { key: 'author', title: '填表人', kind: 'c' },
    { key: 'authorEmail', title: '填表人Email', kind: 'c' },
  ],

  // 已建立的專案履歷/殘件:只有管理者與填表人可修改(其他人唯讀)
  ADMINS: ['0966723050@atk.com.tw'],

  // 「Choice」工作表:下拉選單預設值(標題 → 清單代號)
  CHOICE_SHEET: 'Choice',
  CHOICE_COLS: { '專案代號': 'code', '專案名稱': 'name', '階段': 'stage', '協同人員': 'members', '負責人': 'owner', '權責區分': 'dept', '狀態': 'status', '單元': 'unit' },
  // 設定頁可編輯的清單(專案代號/名稱成對編輯)
  LISTS: [
    { key: 'project', label: '專案代號 / 專案名稱' },
    { key: 'unit', label: '單元' },
    { key: 'stage', label: '專案階段' },
    { key: 'members', label: '協同作業人員' },
    { key: 'owner', label: '負責人' },
    { key: 'dept', label: '權責區分' },
  ],
  ECN_OPTIONS: ['是', '否'],
  STATUS_OPTIONS: ['Open', 'Close'],

  // 分享連結免登入檢視:Google Apps Script 網頁應用程式網址(gas/Code.gs,以管理者身分讀取 Excel,
  // 只回傳連結指定、且分享碼相符的那份履歷)。留空時,開啟分享連結仍需登入。
  SHARE_URL: 'https://script.google.com/macros/s/AKfycbyPQkBbKbckdbW-BET5B_k0BhDBteMu_oT5VUBgVW0ExJ5_JRlEDD6f6AA8ZuNM3aDOvA/exec',

  // 程式版本(部署時由 GitHub Actions 換成 commit 代碼);與網站上的 version.json 不同時強制重新載入
  APP_VERSION: '__BUILD_VERSION__',
  VERSION_CHECK_MINUTES: 5,
};
