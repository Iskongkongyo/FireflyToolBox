param([switch]$WithAndroidSync, [switch]$BuildOnly)
$ErrorActionPreference = 'Stop'
$repositoryRoot = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
Set-Location -LiteralPath $repositoryRoot
$reviewDirectory = Join-Path $repositoryRoot 'target-check/web-tool-budget-settings/windows'
New-Item -ItemType Directory -Path $reviewDirectory -Force | Out-Null
$config = Get-Content src-tauri/tauri.windows.conf.json -Raw -Encoding UTF8 | ConvertFrom-Json
# Keep the real user's SQLite data and WebView profile out of this test instance.
$config.identifier = 'FireflyToolBox.BudgetSettingsTest'
$config.app.windows[0] | Add-Member -NotePropertyName additionalBrowserArgs -NotePropertyValue '--remote-debugging-port=19351' -Force
$config.app.windows[0] | Add-Member -NotePropertyName dataDirectory -NotePropertyValue (Join-Path $reviewDirectory 'webview-profile') -Force
$configPath = Join-Path $reviewDirectory 'windows-test.conf.json'
$config | ConvertTo-Json -Depth 12 | Set-Content -LiteralPath $configPath -Encoding UTF8
node node_modules/@tauri-apps/cli/tauri.js build --debug --no-bundle --ci --config $configPath
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
Write-Output 'Windows native test application built.'
if (-not $BuildOnly) {
    $nativeTestArgs = @('scripts/test-web-tool-budget-settings-windows.mjs')
    if ($WithAndroidSync) { $nativeTestArgs += '--with-android-sync' }
    node @nativeTestArgs
    exit $LASTEXITCODE
}
