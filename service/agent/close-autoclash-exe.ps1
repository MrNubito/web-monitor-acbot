param(
  [Parameter(Mandatory = $true)]
  [string]$ExePath
)

$ErrorActionPreference = "Stop"

. "$PSScriptRoot\autoclash-process.ps1"
$matches = @(Get-AutoClashProcesses $ExePath)

if ($matches.Count -eq 0) {
  Write-Output "No running AutoClash exe found."
  exit 0
}

foreach ($match in $matches) {
  $process = Get-Process -Id $match.Id -ErrorAction SilentlyContinue
  if ($process -and $process.MainWindowHandle -ne 0) {
    [void]$process.CloseMainWindow()
  }
}

Start-Sleep -Seconds 2

$forced = 0
foreach ($match in $matches) {
  $process = Get-Process -Id $match.Id -ErrorAction SilentlyContinue
  if ($process) {
    Stop-Process -Id $match.Id -Force -ErrorAction SilentlyContinue
    $forced++
  }
}

if ($forced -gt 0) {
  Write-Output "Closed $($matches.Count) AutoClash process(es). Forced remaining: $forced."
} else {
  Write-Output "Closed $($matches.Count) AutoClash process(es)."
}
