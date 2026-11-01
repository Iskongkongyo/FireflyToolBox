$ErrorActionPreference = 'Stop'
$repositoryRoot = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
Set-Location -LiteralPath $repositoryRoot
$reviewDirectory = Join-Path $repositoryRoot 'target-check/browser-progress-review'
New-Item -ItemType Directory -Path $reviewDirectory -Force | Out-Null
$config = Get-Content src-tauri/tauri.windows.conf.json -Raw -Encoding UTF8 | ConvertFrom-Json
# Elevated WebView2 hosts ignore browser-argument environment overrides.
# Pass the test-only CDP flag through a disposable debug-build configuration.
$config.app.windows[0] | Add-Member -NotePropertyName additionalBrowserArgs -NotePropertyValue '--remote-debugging-port=19347' -Force
$config.app.windows[0] | Add-Member -NotePropertyName dataDirectory -NotePropertyValue (Join-Path $reviewDirectory 'direct-api-profile') -Force
$configPath = Join-Path $reviewDirectory 'windows-test.conf.json'
$config | ConvertTo-Json -Depth 12 | Set-Content -LiteralPath $configPath -Encoding UTF8
node node_modules/@tauri-apps/cli/tauri.js build --debug --no-bundle --ci --config $configPath
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
node scripts/test-browser-progress-windows.mjs
exit $LASTEXITCODE
