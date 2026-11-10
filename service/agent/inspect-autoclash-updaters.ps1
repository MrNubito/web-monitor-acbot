$ErrorActionPreference = 'Stop'
. "$PSScriptRoot\autoclash-process.ps1"
Add-Type -AssemblyName UIAutomationClient
Add-Type -AssemblyName UIAutomationTypes
Add-Type -TypeDefinition @"
using System;
using System.Runtime.InteropServices;
public static class AutoClashArguments {
  [DllImport("shell32.dll", CharSet = CharSet.Unicode)]
  static extern IntPtr CommandLineToArgvW(string command, out int count);
  [DllImport("kernel32.dll")] static extern IntPtr LocalFree(IntPtr pointer);
  public static string[] Parse(string command) {
    int count;
    IntPtr pointer = CommandLineToArgvW(command, out count);
    if (pointer == IntPtr.Zero) return new string[0];
    try {
      string[] values = new string[count];
      for (int i = 0; i < count; i++) values[i] = Marshal.PtrToStringUni(Marshal.ReadIntPtr(pointer, i * IntPtr.Size));
      return values;
    } finally { LocalFree(pointer); }
  }
}
"@

$running = @()
$updaters = @()
foreach ($item in @(Get-CimInstance Win32_Process -Filter "Name LIKE 'AutoClash%.exe' OR Name LIKE 'ACBot%.exe'")) {
  $exe = Get-AutoClashLongPath $item.ExecutablePath
  if (!$exe) { continue }
  $process = Get-Process -Id $item.ProcessId -ErrorAction SilentlyContinue
  if (!$process) { continue }
  $startedAt = $process.StartTime.ToUniversalTime().ToString('o')
  if ($item.Name -match '(?i)^(AutoClash|ACBot)_update_.*\.exe$') {
    $arguments = @([AutoClashArguments]::Parse($item.CommandLine) | Select-Object -Skip 1)
    if ($arguments.Count -lt 5 -or $arguments[0] -ne '--self-update') { continue }
    $target = Get-AutoClashLongPath $arguments[1]
    $text = ''
    if ($process.MainWindowHandle -ne 0) {
      try {
        $window = [System.Windows.Automation.AutomationElement]::FromHandle($process.MainWindowHandle)
        $elements = $window.FindAll([System.Windows.Automation.TreeScope]::Descendants, [System.Windows.Automation.Condition]::TrueCondition)
        $text = (@($window.Current.Name) + @($elements | ForEach-Object { $_.Current.Name })) -join "`n"
      } catch { $text = '' }
    }
    $updaters += [PSCustomObject]@{
      pid = $process.Id; exePath = $exe; startedAt = $startedAt; targetExe = $target
      arguments = $arguments; text = $text
      blocked = [bool]($text -match '(?i)could not replace old executable|being used by another process|sharing violation|WinError\s*32')
    }
  } elseif ($item.Name -notmatch '(?i)update|setup|installer|helper|crash') {
    $running += [PSCustomObject]@{
      pid = $process.Id; exePath = $exe; startedAt = $startedAt
      hasWindow = [bool]($process.MainWindowHandle -ne 0)
    }
  }
}
ConvertTo-Json -InputObject ([PSCustomObject]@{ running = @($running); updaters = @($updaters) }) -Depth 6 -Compress
