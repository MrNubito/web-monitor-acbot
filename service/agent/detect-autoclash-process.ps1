param([Parameter(Mandatory = $true)][string]$ExePath)
$ErrorActionPreference = 'Stop'
. "$PSScriptRoot\autoclash-process.ps1"
$windows = @(Get-AutoClashProcesses $ExePath | Where-Object { $_.MainWindowHandle -ne 0 })
$results = @($windows | ForEach-Object {
  [PSCustomObject]@{ pid = $_.Id; exePath = (Get-AutoClashLongPath $_.Path); title = $_.MainWindowTitle; startedAt = $_.StartTime.ToUniversalTime().ToString('o') }
})
ConvertTo-Json -InputObject $results -Compress
