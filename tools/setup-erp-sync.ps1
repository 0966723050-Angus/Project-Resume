# 安裝「ATK ERP工時同步」排程(每 2 分鐘執行 erp-sync.vbs,隱藏視窗)。在 ERP 資料夾按右鍵「用 PowerShell 執行」即可,不需系統管理員。
# 執行結果(含錯誤訊息)記在同資料夾的 setup-erp-sync.log
$dir = Split-Path -Parent $MyInvocation.MyCommand.Path
$log = Join-Path $dir 'setup-erp-sync.log'
Start-Transcript -Path $log -Force | Out-Null
try {
  if (-not (Test-Path (Join-Path $dir 'erp-sync.key'))) { throw '找不到 erp-sync.key(內容為 Apps Script 的 ERP_KEY)' }
  $action = New-ScheduledTaskAction -Execute 'wscript.exe' -Argument ('"' + (Join-Path $dir 'erp-sync.vbs') + '"') -WorkingDirectory $dir
  $trigger = New-ScheduledTaskTrigger -Once -At (Get-Date).AddMinutes(1) -RepetitionInterval (New-TimeSpan -Minutes 2)
  $settings = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -StartWhenAvailable -ExecutionTimeLimit (New-TimeSpan -Minutes 5) -MultipleInstances IgnoreNew
  Register-ScheduledTask -TaskName 'ATK ERP Sync' -Description 'ERP-WT.xlsx from Google Drive (ERP工時) to ERP folder' -Action $action -Trigger $trigger -Settings $settings -Force -ErrorAction Stop | Out-Null
  Write-Host 'OK: 已建立排程「ATK ERP Sync」,每 2 分鐘檢查一次;同步紀錄在 erp-sync.log' -ForegroundColor Green
} catch {
  Write-Host ('失敗:' + $_.Exception.Message) -ForegroundColor Red
  Write-Host '(錯誤已記在 setup-erp-sync.log)'
}
Stop-Transcript | Out-Null
Read-Host '按 Enter 結束'
