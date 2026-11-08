# erp-sync.ps1 — 把手機在「工時統計」匯出的 ERP-WT.xlsx(雲端硬碟「ERP工時」資料夾)寫入本機 ERP 資料夾
# 由工作排程器每 2 分鐘執行(erp-sync.vbs 隱藏視窗啟動)。金鑰放在同資料夾的 erp-sync.key(Apps Script 的 ERP_KEY),不要放進版本庫。
# 規則:雲端檔比本機 ERP-WT.xlsx 新才寫入(電腦上直接匯出或手動修改過的較新檔不會被蓋掉);Excel 開著檔案時下次再寫。
$ErrorActionPreference = 'Stop'
$dir = Split-Path -Parent $MyInvocation.MyCommand.Path
$target = Join-Path $dir 'ERP-WT.xlsx'
$logFile = Join-Path $dir 'erp-sync.log'
$url = 'https://script.google.com/macros/s/AKfycbyPQkBbKbckdbW-BET5B_k0BhDBteMu_oT5VUBgVW0ExJ5_JRlEDD6f6AA8ZuNM3aDOvA/exec'
function Log($m) {
  $line = (Get-Date -Format 'yyyy-MM-dd HH:mm:ss') + ' ' + $m
  if ((Test-Path $logFile) -and (Get-Item $logFile).Length -gt 200KB) { Get-Content $logFile -Tail 200 | Set-Content $logFile -Encoding UTF8 }
  Add-Content -Path $logFile -Value $line -Encoding UTF8
}
try {
  [Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
  $key = (Get-Content (Join-Path $dir 'erp-sync.key') -Raw).Trim()
  $since = if (Test-Path $target) { (Get-Item $target).LastWriteTimeUtc.ToString('yyyy-MM-ddTHH:mm:ss.fffZ') } else { '' }
  $body = @{ a = 'erp'; key = $key; since = $since } | ConvertTo-Json -Compress
  $r = Invoke-RestMethod -Uri $url -Method Post -Body ([Text.Encoding]::UTF8.GetBytes($body)) -ContentType 'application/json; charset=utf-8' -TimeoutSec 90
  if (-not $r.ok) { Log ('錯誤:' + $r.error); exit 1 }
  if (-not $r.b64) { exit 0 }
  $tmp = $target + '.tmp'
  [IO.File]::WriteAllBytes($tmp, [Convert]::FromBase64String($r.b64))
  try {
    Move-Item -LiteralPath $tmp -Destination $target -Force
  } catch {
    Remove-Item -LiteralPath $tmp -Force -ErrorAction SilentlyContinue
    Log '寫入失敗(ERP-WT.xlsx 可能正在 Excel 中開啟),下次再試'
    exit 1
  }
  (Get-Item $target).LastWriteTimeUtc = [DateTime]::Parse($r.modified).ToUniversalTime()
  Log ('已寫入手機匯出的 ERP-WT.xlsx(雲端修改時間 ' + $r.modified + ')')
} catch {
  Log ('錯誤:' + $_.Exception.Message)
  exit 1
}
