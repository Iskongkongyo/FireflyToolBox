param([ValidateSet('cancel','probe','save')][string]$Action, [string]$PathsFile)
$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = New-Object System.Text.UTF8Encoding($false)
Add-Type -AssemblyName UIAutomationClient
Add-Type -AssemblyName UIAutomationTypes
$request = Get-Content -LiteralPath $PathsFile -Raw -Encoding UTF8 | ConvertFrom-Json
$title = New-Object System.Windows.Automation.PropertyCondition([System.Windows.Automation.AutomationElement]::NameProperty, $request.title)
$condition = $title
if ($request.processId) {
    $pickerProcess = New-Object System.Windows.Automation.PropertyCondition([System.Windows.Automation.AutomationElement]::ProcessIdProperty, [int]$request.processId)
    $condition = New-Object System.Windows.Automation.AndCondition($title, $pickerProcess)
}
$dialog = [System.Windows.Automation.AutomationElement]::RootElement.FindFirst([System.Windows.Automation.TreeScope]::Children, $condition)
if (-not $dialog -and $request.processId) {
    # Some Windows versions expose an owned modal under its application window
    # in the automation tree. Keep the search within the owned process.
    $owners = [System.Windows.Automation.AutomationElement]::RootElement.FindAll([System.Windows.Automation.TreeScope]::Children, $pickerProcess)
    foreach ($owner in $owners) {
        $dialog = $owner.FindFirst([System.Windows.Automation.TreeScope]::Descendants, $condition)
        if ($dialog) { break }
    }
}
if (-not $dialog) { @{found=$false} | ConvertTo-Json -Compress; exit 0 }
if ($Action -eq 'cancel') { $dialog.GetCurrentPattern([System.Windows.Automation.WindowPattern]::Pattern).Close() }
if ($Action -eq 'save') {
    if (-not $request.processId -or -not $request.path) { throw 'Saving requires the owned process ID and output path.' }
    $nodes = $dialog.FindAll([System.Windows.Automation.TreeScope]::Descendants, [System.Windows.Automation.Condition]::TrueCondition)
    $edit = $null
    $save = $null
    foreach ($node in $nodes) {
        if ($node.Current.AutomationId -eq '1001' -and $node.Current.ClassName -eq 'Edit') { $edit = $node }
        if ($node.Current.AutomationId -eq '1' -and $node.Current.ClassName -eq 'Button') { $save = $node }
    }
    if (-not $edit -or -not $save) { @{found=$true; saved=$false} | ConvertTo-Json -Compress; exit 0 }
    Add-Type @'
using System;
using System.Runtime.InteropServices;
public static class FireflyPickerMessages {
  [DllImport("user32.dll", CharSet=CharSet.Unicode)] public static extern IntPtr SendMessageW(IntPtr hwnd, uint message, IntPtr wparam, string value);
  [DllImport("user32.dll")] public static extern bool PostMessage(IntPtr hwnd, uint message, IntPtr wparam, IntPtr lparam);
}
'@
    [void][FireflyPickerMessages]::SendMessageW([IntPtr]$edit.Current.NativeWindowHandle, 12, [IntPtr]::Zero, $request.path)
    [void][FireflyPickerMessages]::PostMessage([IntPtr]$save.Current.NativeWindowHandle, 245, [IntPtr]::Zero, [IntPtr]::Zero)
    @{found=$true; saved=$true} | ConvertTo-Json -Compress
    exit 0
}
@{found=$true} | ConvertTo-Json -Compress
