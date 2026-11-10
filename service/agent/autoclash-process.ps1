Add-Type -TypeDefinition @"
using System;
using System.Text;
using System.Runtime.InteropServices;
public static class AutoClashPath {
  [DllImport("kernel32.dll", CharSet = CharSet.Unicode)]
  public static extern uint GetLongPathName(string path, StringBuilder buffer, uint size);
}
"@

function Get-AutoClashLongPath([string]$Value) {
  if ([string]::IsNullOrWhiteSpace($Value)) { return "" }
  $full = [IO.Path]::GetFullPath($Value)
  $buffer = New-Object Text.StringBuilder 32768
  if ([AutoClashPath]::GetLongPathName($full, $buffer, 32768) -gt 0) { return $buffer.ToString() }
  return $full
}

function Test-AutoClashExecutableName([string]$Name) {
  return $Name -match '(?i)(AutoClash|ACBot).*\.exe$' -and $Name -notmatch '(?i)update|setup|installer|helper|crash'
}

function Test-AutoClashWindowIdentity([string]$ActualProcessName, [string]$ActualTitle, [string]$ExpectedProcessName, [string]$ExpectedTitle) {
  if ($ActualTitle -match '(?i)activation|^Updating (AutoClash|ACBot)|^Update Available') { return $false }
  if ($ActualProcessName -like "$ExpectedProcessName*" -or $ActualTitle -like "*$ExpectedTitle*") { return $true }
  # Retain the old default settings while accepting the renamed application.
  if ($ExpectedProcessName -match '^(?i:AutoClash|ACBot)' -or $ExpectedTitle -match '^(?i:AutoClash|ACBot)') {
    return $ActualProcessName -match '^(?i:AutoClash|ACBot)' -or $ActualTitle -match '^(?i:AutoClash|ACBot)\b'
  }
  return $false
}

function Get-AutoClashProcesses([string]$TargetPath) {
  $root = Get-AutoClashLongPath ([IO.Path]::GetDirectoryName($TargetPath))
  @(Get-Process | Where-Object {
    $processPath = Get-AutoClashLongPath $_.Path
    $name = [IO.Path]::GetFileName($processPath)
    $processPath -and ([IO.Path]::GetDirectoryName($processPath) -ieq $root) -and
      (Test-AutoClashExecutableName $name)
  })
}
