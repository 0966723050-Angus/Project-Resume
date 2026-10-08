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
  CHOICE_COLS: { '專案代號': 'code', '專案名稱': 'name', '階段': 'stage', '協同人員': 'members', '負責人': 'owner', '權責區分': 'dept', '狀態': 'status', '單元': 'unit', '管理階段': 'pmStage', '排程工作項目': 'schedItem' },
  // Choice 中沒有該欄時的預設清單(第一次新增/刪除時自動建立欄位)
  CHOICE_DEFAULTS: {
    pmStage: ['尚未進行', '設計', '採購', '加工', '工廠組立', '現地安裝', '出貨', '完工', '驗收', '保固內', '保固外'],
    schedItem: ['PO Recived', 'Kick-off meeting', '設備設計及圖面繪制', '長交期物料採購', '電控及軟體設計', '部品採購', '設備組裝',
      'HP升溫測試 & 調試', '機台運轉測試 & Debug', 'IAT', '清潔', '包裝 & 裝箱', 'Shipping'],
  },
  // 設定頁可編輯的清單(專案代號/名稱成對編輯)
  LISTS: [
    { key: 'project', label: '專案代號 / 專案名稱' },
    { key: 'unit', label: '單元' },
    { key: 'stage', label: '專案階段' },
    { key: 'members', label: '協同作業人員' },
    { key: 'owner', label: '負責人' },
    { key: 'dept', label: '權責區分' },
    { key: 'pmStage', label: '專案管理階段' },
    { key: 'schedItem', label: 'Schedule 工作項目' },
  ],
  ECN_OPTIONS: ['是', '否'],
  STATUS_OPTIONS: ['Open', 'Close'],

  // 「專案管理」(只有管理者可見/可編輯):共用雲端硬碟 ATK 的 Project Management.xlsx,一列 = 一個專案批次
  PM: {
    FILE_NAMES: ['Project Management.xlsx', 'Project Managment.xlsx'], // 依序尋找(檔名拼法兩種都接受)
    SHEET: 'project list',
    // kind:n 數字 / d 日期 / t 文字 / m 多行文字
    COLS: [
      { key: 'year', title: '年度', kind: 'n' },
      { key: 'code', title: '專案代號', kind: 't' },
      { key: 'name', title: '專案名稱', kind: 't' },
      { key: 'part', title: '產品品號', kind: 't' },
      { key: 'order', title: '訂單號碼', kind: 'n' },
      { key: 'custNo', title: '客戶單號', kind: 'n' },
      { key: 'batch', title: '批次', kind: 'n' },
      { key: 'qty', title: '數量', kind: 'n' },
      { key: 'needDate', title: '需求日期', kind: 'd' },
      { key: 'contact', title: '客戶聯絡人', kind: 't' },
      { key: 'design', title: '設計擔當人員', kind: 't' },
      { key: 'elec', title: '電控擔當人員', kind: 't' },
      { key: 'soft', title: '軟體擔當人員', kind: 't' },
      { key: 'tech', title: '技術擔當人員', kind: 't' },
      { key: 'stage', title: '階段', kind: 't' },
      { key: 'bom', title: '裝置構成表', kind: 'd' },
      { key: 'longLead', title: '長交期物料', kind: 'd' },
      { key: 'drawing', title: '圖面提交', kind: 'd' },
      { key: 'mo', title: '製令開立', kind: 'd' },
      { key: 'purchase', title: '採購狀況', kind: 'd' },
      { key: 'current', title: '現況', kind: 'm' },
      { key: 'note', title: '備註', kind: 'm' },
      { key: 'closed', title: '結案', kind: 't' },
      // 進度各項目的狀態(Excel 原本沒有這些欄;第一次存檔時接在最後一欄之後新增,標題放在對應項目旁說明)
      { key: 'bomSt', title: '裝置構成表狀態', kind: 't', extra: 'bom' },
      { key: 'longLeadSt', title: '長交期物料狀態', kind: 't', extra: 'longLead' },
      { key: 'drawingSt', title: '圖面提交狀態', kind: 't', extra: 'drawing' },
      { key: 'moSt', title: '製令開立狀態', kind: 't', extra: 'mo' },
      { key: 'purchaseSt', title: '採購狀況狀態', kind: 't', extra: 'purchase' },
      { key: 'site', title: '現地施工', kind: 'd', extra: 'mo' },          // Excel 原本沒有,日期格式比照「製令開立」
      { key: 'siteSt', title: '現地施工狀態', kind: 't', extra: 'site' },
    ],
    // 進度區塊:日期 + 狀態
    PROGRESS: [
      { label: '裝置構成表', date: 'bom', st: 'bomSt' },
      { label: '長交期物料', date: 'longLead', st: 'longLeadSt' },
      { label: '圖面提交', date: 'drawing', st: 'drawingSt' },
      { label: '製令開立', date: 'mo', st: 'moSt' },
      { label: '採購狀況', date: 'purchase', st: 'purchaseSt' },
      { label: '現地施工', date: 'site', st: 'siteSt' },
    ],
    PROGRESS_STATUS: ['未進行', '進行中', '延遲', '已完成'],
    // 追蹤事項:第 1 組在原本的「追蹤確認事項/進度與結果/期限/狀態」欄;第 2 組起標題加編號(追蹤確認事項2…),
    // 從 EXTRA_START 欄開始往右新增(AB~AD 為表內既有輔助欄,不使用)
    TRACK: [
      { key: 'item', title: '追蹤確認事項', kind: 'm' },
      { key: 'progress', title: '進度與結果', kind: 'm' },
      { key: 'due', title: '期限', kind: 'd' },
      { key: 'status', title: '狀態', kind: 't' },
    ],
    EXTRA_START: 31, // AE
    CLOSED_OPTIONS: ['是', '否'],
    // Schedule:各專案的排程與共用顏色存在 Project Management.xlsx 同資料夾的此檔(依專案代號)
    SCHED_FILE: 'Project Schedule.json',
  },

  // 分享連結免登入檢視:Google Apps Script 網頁應用程式網址(gas/Code.gs,以管理者身分讀取 Excel,
  // 只回傳連結指定、且分享碼相符的那份履歷)。留空時,開啟分享連結仍需登入。
  SHARE_URL: 'https://script.google.com/macros/s/AKfycbyPQkBbKbckdbW-BET5B_k0BhDBteMu_oT5VUBgVW0ExJ5_JRlEDD6f6AA8ZuNM3aDOvA/exec',

  // 程式版本(部署時由 GitHub Actions 換成 commit 代碼);與網站上的 version.json 不同時強制重新載入
  APP_VERSION: '__BUILD_VERSION__',
  VERSION_CHECK_MINUTES: 5,
};
