param([string]$Executable, [ValidateRange(1, 5)][int]$Runs = 3)
$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = New-Object System.Text.UTF8Encoding($false)
$repositoryRoot = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
Set-Location -LiteralPath $repositoryRoot
if (-not $Executable) { $Executable = Join-Path $repositoryRoot 'target-check/release/firefly-toolbox.exe' }
$Executable = [IO.Path]::GetFullPath($Executable)
$directory = Join-Path $repositoryRoot 'target-check/pc-startup'
New-Item -ItemType Directory -Path $directory -Force | Out-Null
# This intentionally uses the real release profile and cached assets. No tools,
# preferences or read-state are edited. Stop only processes created below.
foreach ($existing in @(Get-Process firefly-toolbox -ErrorAction SilentlyContinue)) {
    if ($existing.Path -eq $Executable) { throw 'The release client is already running. Finish using it before running cold-start checks.' }
}
Add-Type -AssemblyName UIAutomationClient
Add-Type -AssemblyName UIAutomationTypes
Add-Type @'
using System;
using System.Runtime.InteropServices;
public static class FireflyStartupWindows {
  public delegate bool EnumProc(IntPtr window, IntPtr data);
  [DllImport("user32.dll")] static extern bool EnumWindows(EnumProc callback, IntPtr data);
  [DllImport("user32.dll")] static extern uint GetWindowThreadProcessId(IntPtr window, out uint id);
  [DllImport("user32.dll")] public static extern bool IsWindowVisible(IntPtr window);
  [DllImport("user32.dll", EntryPoint="GetWindowLongW")] static extern int GetWindowLong(IntPtr window, int index);
  public static IntPtr MainWindow(uint process) {
    IntPtr found = IntPtr.Zero;
    EnumWindows((window, data) => {
      uint id; GetWindowThreadProcessId(window, out id);
      // Splash is borderless. Wait for the decorated main window to be visible.
      if (id == process && IsWindowVisible(window) && (GetWindowLong(window, -16) & 0x00c00000) == 0x00c00000) {
        found = window; return false;
      }
      return true;
    }, IntPtr.Zero);
    return found;
  }
}
'@
$report = [ordered]@{ executable = $Executable; profile = 'Normal production profile; cache preserved'; launches = @() }
$priorBacktrace = $env:RUST_BACKTRACE
$env:RUST_BACKTRACE = '1'
try {
    for ($attempt = 1; $attempt -le $Runs; $attempt++) {
        $stdout = Join-Path $directory "startup-$attempt-stdout.log"
        $stderr = Join-Path $directory "startup-$attempt-stderr.log"
        # A visible GUI client is the purpose of this check.
        $owned = Start-Process -FilePath $Executable -WorkingDirectory (Split-Path $Executable) -WindowStyle Normal -PassThru -RedirectStandardOutput $stdout -RedirectStandardError $stderr
        $result = [ordered]@{ attempt = $attempt; processId = $owned.Id; passed = $false }
        try {
            $deadline = [DateTime]::UtcNow.AddSeconds(40)
            $rendered = $false
            while ([DateTime]::UtcNow -lt $deadline) {
                $owned.Refresh()
                if ($owned.HasExited) { throw "Release client exited during startup: $($owned.ExitCode)" }
                $window = [FireflyStartupWindows]::MainWindow([uint32]$owned.Id)
                if ($window -ne [IntPtr]::Zero) {
                    $element = [System.Windows.Automation.AutomationElement]::FromHandle($window)
                    $elements = $element.FindAll([System.Windows.Automation.TreeScope]::Descendants, [System.Windows.Automation.Condition]::TrueCondition)
                    $names = @($elements | ForEach-Object { $_.Current.Name })
                    if ($names | Where-Object { $_ -match '无法加载本地工具' }) { throw 'The production catalog reported a loading error.' }
                    $documents = @($elements | Where-Object { $_.Current.ControlType -eq [System.Windows.Automation.ControlType]::Document })
                    if ($documents.Count -gt 0 -and $elements.Count -gt 12 -and $owned.Responding) { $rendered = $true; break }
                }
                Start-Sleep -Milliseconds 250
            }
            if (-not $rendered) { throw 'The release main window or its rendered content never became available.' }
            Start-Sleep -Seconds 1
            $owned.Refresh()
            if ($owned.HasExited -or -not $owned.Responding) { throw 'The release client stopped responding after startup.' }
            if ((Get-Content -LiteralPath $stderr -Raw -Encoding UTF8) -match 'panicked at|state\(\) called before manage\(\)') { throw 'A native startup panic was recorded.' }
            $result.mainVisible = [FireflyStartupWindows]::IsWindowVisible($window)
            $result.rendered = $true
            $result.responding = $true
            $result.accessibleDocuments = $documents.Count
            $result.accessibleElements = $elements.Count
            $result.passed = $true
            Write-Output "PASS: release startup $attempt; main window visible, content rendered, process responsive."
        } catch {
            $result.error = $_.Exception.Message
            if (Test-Path -LiteralPath $stderr) { Get-Content -LiteralPath $stderr -Encoding UTF8 -TotalCount 12 | Write-Output }
            throw
        } finally {
            $owned.Refresh()
            if (-not $owned.HasExited) { Stop-Process -Id $owned.Id -Force; $owned.WaitForExit() }
            $report.launches += $result
            $report | ConvertTo-Json -Depth 6 | Set-Content -LiteralPath (Join-Path $directory 'startup-results.json') -Encoding UTF8
            Start-Sleep -Milliseconds 700
        }
    }
} finally { $env:RUST_BACKTRACE = $priorBacktrace }
