# 安裝「ATK ERP工時同步」排程(每 2 分鐘執行 erp-sync.vbs,隱藏視窗)。在 ERP 資料夾按右鍵「用 PowerShell 執行」即可,不需系統管理員。
$dir = Split-Path -Parent $MyInvocation.MyCommand.Path
if (-not (Test-Path (Join-Path $dir 'erp-sync.key'))) { Write-Host '請先建立 erp-sync.key(內容為 Apps Script 的 ERP_KEY)' -ForegroundColor Yellow; Read-Host '按 Enter 結束'; exit 1 }
$action = New-ScheduledTaskAction -Execute 'wscript.exe' -Argument ('"' + (Join-Path $dir 'erp-sync.vbs') + '"') -WorkingDirectory $dir
$trigger = New-ScheduledTaskTrigger -Once -At (Get-Date).AddMinutes(1) -RepetitionInterval (New-TimeSpan -Minutes 2)
$settings = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -StartWhenAvailable -ExecutionTimeLimit (New-TimeSpan -Minutes 5) -MultipleInstances IgnoreNew
Register-ScheduledTask -TaskName 'ATK ERP工時同步' -Description '把手機匯出的 ERP-WT.xlsx(雲端硬碟 ERP工時)寫入 ERP 資料夾' -Action $action -Trigger $trigger -Settings $settings -Force | Out-Null
Write-Host '✅ 已建立排程「ATK ERP工時同步」,每 2 分鐘檢查一次;紀錄在 erp-sync.log' -ForegroundColor Green
Read-Host '按 Enter 結束'
