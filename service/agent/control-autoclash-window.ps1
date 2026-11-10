param(
  [Parameter(Mandatory = $true)]
  [ValidateSet("start", "pause", "stop", "stats", "show", "hide")]
  [string]$Action,
  [string]$ProcessName = "AutoClash-1.5.3",
  [string]$WindowTitle = "AutoClash Pro",
  [string]$ExePath = "",
  [int]$StatsX = 78,
  [int]$StatsY = 399,
  [int]$ControlButtonBottomOffset = 32,
  [switch]$RestoreMinimized
)

Add-Type -TypeDefinition @"
using System;
using System.Runtime.InteropServices;

public static class Win32Control {
  [DllImport("user32.dll")]
  public static extern bool GetWindowRect(IntPtr hWnd, out RECT lpRect);

  [DllImport("user32.dll")]
  public static extern bool GetClientRect(IntPtr hWnd, out RECT lpRect);

  [DllImport("user32.dll")]
  public static extern bool ClientToScreen(IntPtr hWnd, ref POINT lpPoint);

  [DllImport("user32.dll")]
  public static extern bool IsIconic(IntPtr hWnd);

  [DllImport("user32.dll")]
  public static extern bool ShowWindow(IntPtr hWnd, int nCmdShow);

  [DllImport("user32.dll")]
  public static extern bool SetWindowPos(IntPtr hWnd, IntPtr hWndInsertAfter, int X, int Y, int cx, int cy, uint uFlags);

  [DllImport("user32.dll")]
  public static extern bool SetForegroundWindow(IntPtr hWnd);

  [DllImport("user32.dll")]
  public static extern bool SetCursorPos(int X, int Y);

  [DllImport("user32.dll")]
  public static extern IntPtr WindowFromPoint(POINT point);

  [DllImport("user32.dll")]
  public static extern IntPtr GetAncestor(IntPtr hWnd, uint gaFlags);

  [DllImport("user32.dll")]
  public static extern void mouse_event(uint dwFlags, uint dx, uint dy, uint dwData, UIntPtr dwExtraInfo);

  [StructLayout(LayoutKind.Sequential)]
  public struct RECT {
    public int Left;
    public int Top;
    public int Right;
    public int Bottom;
  }

  [StructLayout(LayoutKind.Sequential)]
  public struct POINT {
    public int X;
    public int Y;
  }
}
"@

$SW_HIDE = 0
$SW_RESTORE = 9
$SW_MINIMIZE = 6
$MOUSEEVENTF_LEFTDOWN = 0x0002
$MOUSEEVENTF_LEFTUP = 0x0004
$HWND_TOPMOST = [IntPtr](-1)
$HWND_NOTOPMOST = [IntPtr](-2)
$SWP_NOMOVE = 0x0002
$SWP_NOSIZE = 0x0001
$SWP_SHOWWINDOW = 0x0040
$GA_ROOT = 2

. "$PSScriptRoot\autoclash-process.ps1"

function Get-TargetWindow {
  $hasExePath = ![string]::IsNullOrWhiteSpace($ExePath)
  $candidates = if ($hasExePath) { Get-AutoClashProcesses $ExePath } else { Get-Process }
  $matches = $candidates |
    Where-Object {
      if ($_.MainWindowHandle -eq 0) {
        return $false
      }

      if ($_.MainWindowTitle -match '(?i)activation|^Updating (AutoClash|ACBot)|^Update Available') { return $false }

      if ($hasExePath) {
        return $true
      }

      return Test-AutoClashWindowIdentity $_.ProcessName $_.MainWindowTitle $ProcessName $WindowTitle
    } |
    Sort-Object -Property @{ Expression = { $_.MainWindowTitle.Length }; Descending = $true }

  if (!$matches) {
    $available = Get-Process |
      Where-Object { $_.MainWindowHandle -ne 0 -and ($_.ProcessName -match '(?i)AutoClash|ACBot' -or $_.MainWindowTitle -match '(?i)AutoClash|ACBot') } |
      ForEach-Object { "PID=$($_.Id) Title='$($_.MainWindowTitle)' Path='$($_.Path)'" }
    throw "No AutoClash window found. ProcessName=$ProcessName WindowTitle=$WindowTitle ExePath=$ExePath`nAvailable:`n$($available -join "`n")"
  }

  return $matches[0]
}

function Invoke-Click {
  param(
    [IntPtr]$Handle,
    [int]$RelativeX,
    [int]$RelativeY
  )

  $point = New-Object Win32Control+POINT
  $point.X = $RelativeX
  $point.Y = $RelativeY
  [Win32Control]::ClientToScreen($Handle, [ref]$point) | Out-Null

  $windowAtPoint = [Win32Control]::WindowFromPoint($point)
  $rootAtPoint = [Win32Control]::GetAncestor($windowAtPoint, $GA_ROOT)
  if ($rootAtPoint -ne $Handle) {
    throw "Click point is not over the AutoClash window. Point=$($point.X),$($point.Y)"
  }

  $x = $point.X
  $y = $point.Y
  [Win32Control]::SetCursorPos($x, $y) | Out-Null
  Start-Sleep -Milliseconds 80
  [Win32Control]::mouse_event($MOUSEEVENTF_LEFTDOWN, 0, 0, 0, [UIntPtr]::Zero)
  Start-Sleep -Milliseconds 80
  [Win32Control]::mouse_event($MOUSEEVENTF_LEFTUP, 0, 0, 0, [UIntPtr]::Zero)
}

function Invoke-ReliableClick {
  param(
    [IntPtr]$Handle,
    [hashtable]$Point
  )

  $offsets = @(0, -8, 8, -14, 14)
  $lastError = $null

  foreach ($offset in $offsets) {
    try {
      Invoke-Click -Handle $Handle -RelativeX $Point.X -RelativeY ($Point.Y + $offset)
      return @{
        X = $Point.X
        Y = $Point.Y + $offset
      }
    } catch {
      $lastError = $_
      Start-Sleep -Milliseconds 120
    }
  }

  throw $lastError
}

function Get-ControlButtonPoint {
  param(
    [IntPtr]$Handle,
    [string]$Button
  )

  $rect = New-Object Win32Control+RECT
  [Win32Control]::GetClientRect($Handle, [ref]$rect) | Out-Null
  $height = $rect.Bottom - $rect.Top
  if ($height -le 0) {
    throw "AutoClash window has invalid height: $height"
  }

  $xByButton = @{
    start = 31
    pause = 78
    stop = 124
  }

  return @{
    X = $xByButton[$Button]
    Y = [Math]::Max(0, $height - $ControlButtonBottomOffset)
  }
}

$target = Get-TargetWindow
$handle = $target.MainWindowHandle
$wasMinimized = [Win32Control]::IsIconic($handle)

if ($Action -eq "hide") {
  [Win32Control]::ShowWindow($handle, $SW_MINIMIZE) | Out-Null
  Write-Output "AutoClash minimized"
  exit 0
}

[Win32Control]::ShowWindow($handle, $SW_RESTORE) | Out-Null
Start-Sleep -Milliseconds 200
[Win32Control]::SetWindowPos($handle, $HWND_TOPMOST, 0, 0, 0, 0, $SWP_NOMOVE -bor $SWP_NOSIZE -bor $SWP_SHOWWINDOW) | Out-Null
Start-Sleep -Milliseconds 150
[Win32Control]::SetForegroundWindow($handle) | Out-Null
Start-Sleep -Milliseconds 450

if ($Action -eq "show") {
  Write-Output "AutoClash shown"
  exit 0
}

if ($Action -in @("start", "pause", "stop")) {
  $point = Get-ControlButtonPoint -Handle $handle -Button $Action
} else {
  $point = @{ X = $StatsX; Y = $StatsY }
}

try {
  $clickedPoint = Invoke-ReliableClick -Handle $handle -Point $point
  Start-Sleep -Milliseconds 250
} finally {
  if ($wasMinimized -and $RestoreMinimized) {
    [Win32Control]::ShowWindow($handle, $SW_MINIMIZE) | Out-Null
  } else {
    [Win32Control]::SetWindowPos($handle, $HWND_NOTOPMOST, 0, 0, 0, 0, $SWP_NOMOVE -bor $SWP_NOSIZE -bor $SWP_SHOWWINDOW) | Out-Null
  }
}

Write-Output "AutoClash action executed: $Action at $($clickedPoint.X),$($clickedPoint.Y)"
