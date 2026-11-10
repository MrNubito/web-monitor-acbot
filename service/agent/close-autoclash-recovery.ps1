param([Parameter(Mandatory = $true)][string]$SnapshotPath)
$ErrorActionPreference = 'Stop'
. "$PSScriptRoot\autoclash-process.ps1"
$snapshot = Get-Content -LiteralPath $SnapshotPath -Raw | ConvertFrom-Json
$targets = @($snapshot.running) + @($snapshot.updaters)

function Get-OriginalProcess($Target) {
  $process = Get-Process -Id $Target.pid -ErrorAction SilentlyContinue
  if (!$process) { return $null }
  if ((Get-AutoClashLongPath $process.Path) -ine $Target.exePath) { return $null }
  if ($process.StartTime.ToUniversalTime().ToString('o') -ne $Target.startedAt) { return $null }
  return $process
}

foreach ($target in $targets) {
  $process = Get-OriginalProcess $target
  if ($process -and $process.MainWindowHandle -ne 0) { [void]$process.CloseMainWindow() }
}
Start-Sleep -Seconds 2
foreach ($target in $targets) {
  $process = Get-OriginalProcess $target
  if ($process) { Stop-Process -Id $process.Id -Force -ErrorAction Stop }
}
Start-Sleep -Seconds 1
foreach ($target in $targets) {
  if (Get-OriginalProcess $target) { throw "AutoClash PID $($target.pid) is still running." }
}
Write-Output "Closed and verified $($targets.Count) AutoClash process(es), including background workers."
