[CmdletBinding()]
param(
    [string]$BuildDirectory = 'target-check/release',
    [ValidateSet('x86', 'x64')][string]$Architecture = 'x64'
)

$ErrorActionPreference = 'Stop'
$repositoryRoot = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
$buildRoot = [IO.Path]::GetFullPath((Join-Path $repositoryRoot $BuildDirectory))
if (-not $buildRoot.StartsWith($repositoryRoot + '\', [StringComparison]::OrdinalIgnoreCase)) {
    throw 'BuildDirectory must be inside the repository.'
}
$generatedDirectory = Join-Path $buildRoot ('nsis/' + $Architecture)
$generatedScript = Join-Path $generatedDirectory 'installer.nsi'
$makensis = Join-Path $env:LOCALAPPDATA 'tauri/NSIS/makensis.exe'
if (-not (Test-Path -LiteralPath $generatedScript) -or -not (Test-Path -LiteralPath $makensis)) {
    throw 'Run npm run build:installer on Windows before running this check.'
}

# Do not install or change the shared WebView runtime during an installer test.
$webviewPaths = @(
    'HKLM:\SOFTWARE\WOW6432Node\Microsoft\EdgeUpdate\Clients\{F3017226-FE2A-4295-8BDF-00C3A9A7E4C5}',
    'HKCU:\SOFTWARE\Microsoft\EdgeUpdate\Clients\{F3017226-FE2A-4295-8BDF-00C3A9A7E4C5}'
)
$webviewInstalled = @($webviewPaths | ForEach-Object {
    Get-ItemProperty -LiteralPath $_ -Name pv -ErrorAction SilentlyContinue
} | Where-Object { $_.pv -and $_.pv -ne '0.0.0.0' }).Count -gt 0
if (-not $webviewInstalled) { throw 'WebView2 must already be installed for this isolated test.' }

$testId = [Guid]::NewGuid().ToString('N')
$product = 'FireflyInstallerTest-' + $testId
$manufacturer = 'FireflyToolboxInstallerTests-' + $testId
$bundleId = 'com.fireflytoolbox.installer-test.' + $testId
$legacyBundleId = 'com.fireflytoolbox.installer-test.legacy.' + $testId
$binaryName = 'firefly-installer-test-' + $testId
$testRoot = Join-Path $repositoryRoot ('target-check/installer-test/' + $testId)
$sourceDirectory = Join-Path $testRoot 'source'
$desktopDirectory = Join-Path $testRoot 'Desktop'
$startMenuDirectory = Join-Path $testRoot 'StartMenu'
$unicodeDirectory = -join ([char[]](0x81EA, 0x5B9A, 0x4E49, 0x5B89, 0x88C5))
$installDirectory = Join-Path $testRoot ($unicodeDirectory + ' files, tools')
$testInstaller = Join-Path $testRoot 'installer-test.exe'
$testBinary = Join-Path $sourceDirectory ($binaryName + '.exe')
$installedBinary = Join-Path $installDirectory ($binaryName + '.exe')
$uninstaller = Join-Path $installDirectory 'uninstall.exe'
$desktopLink = Join-Path $desktopDirectory ($product + '.lnk')
$startMenuLink = Join-Path (Join-Path $startMenuDirectory $product) ($product + '.lnk')
$uninstallKey = 'HKCU:\Software\Microsoft\Windows\CurrentVersion\Uninstall\' + $product
$manufacturerKey = 'HKCU:\Software\' + $manufacturer
$productKey = $manufacturerKey + '\' + $product
$appDataDirectories = @(
    (Join-Path $env:APPDATA $bundleId), (Join-Path $env:LOCALAPPDATA $bundleId),
    (Join-Path $env:APPDATA $legacyBundleId), (Join-Path $env:LOCALAPPDATA $legacyBundleId)
)

function Assert-Condition([bool]$Condition, [string]$Message) {
    if (-not $Condition) { throw $Message }
}

function Invoke-TestProcess([string]$FilePath, [string]$Arguments) {
    $resolved = [IO.Path]::GetFullPath($FilePath)
    Assert-Condition ($resolved.StartsWith($testRoot + '\', [StringComparison]::OrdinalIgnoreCase)) 'Test executable is outside its dedicated directory.'
    $process = Start-Process -FilePath $resolved -ArgumentList $Arguments -WindowStyle Hidden -PassThru
    $null = $process.Handle
    $deadline = [DateTime]::UtcNow.AddSeconds(90)
    while (-not $process.WaitForExit(500)) {
        if ([DateTime]::UtcNow -gt $deadline) {
            $process.Kill()
            throw 'Isolated installer process timed out.'
        }
    }
    Assert-Condition ($process.ExitCode -eq 0) ('Installer exit code: ' + $process.ExitCode)
}

function Invoke-TestUninstall {
    if (Test-Path -LiteralPath $uninstaller) {
        Invoke-TestProcess $uninstaller '/S'
        # NSIS launches an uninstaller copy in TEMP before deleting itself.
        $deadline = [DateTime]::UtcNow.AddSeconds(30)
        while ((Test-Path -LiteralPath $uninstallKey) -or (Test-Path -LiteralPath $installedBinary) -or (Test-Path -LiteralPath $uninstaller)) {
            if ([DateTime]::UtcNow -gt $deadline) { throw 'Uninstall did not finish.' }
            Start-Sleep -Milliseconds 200
        }
    }
}

function ConvertTo-NsisString([string]$Value) { return $Value.Replace('$', '$$') }

foreach ($path in @($uninstallKey, $manufacturerKey) + $appDataDirectories) {
    Assert-Condition (-not (Test-Path -LiteralPath $path)) ('Test namespace already exists: ' + $path)
}
New-Item -ItemType Directory -Path $sourceDirectory,$desktopDirectory,$startMenuDirectory -Force | Out-Null
Copy-Item -LiteralPath (Join-Path $buildRoot 'firefly-toolbox.exe') -Destination $testBinary

$text = [IO.File]::ReadAllText($generatedScript)
foreach ($feature in @('!insertmacro MUI_PAGE_DIRECTORY', '!insertmacro MUI_PAGE_STARTMENU', '!define MUI_FINISHPAGE_SHOWREADME_FUNCTION CreateOrUpdateDesktopShortcut', '!insertmacro MUI_LANGUAGE "SimpChinese"')) {
    Assert-Condition ($text.Contains($feature)) ('Missing installer feature: ' + $feature)
}
$replacements = @{
    MANUFACTURER = $manufacturer
    PRODUCTNAME = $product
    MAINBINARYNAME = $binaryName
    MAINBINARYSRCPATH = $testBinary
    BUNDLEID = $bundleId
    OUTFILE = $testInstaller
    STARTMENUFOLDER = $product
}
foreach ($entry in $replacements.GetEnumerator()) {
    $pattern = '(?m)^!define ' + [regex]::Escape($entry.Key) + ' "[^\r\n]*"\r?$'
    Assert-Condition ([regex]::Matches($text, $pattern).Count -eq 1) ('Unexpected generated definition: ' + $entry.Key)
    $replacementLine = '!define ' + $entry.Key + ' "' + (ConvertTo-NsisString $entry.Value) + '"'
    $text = [regex]::Replace($text, $pattern, [Text.RegularExpressions.MatchEvaluator]{ param($match) $replacementLine })
}
# Exercise the real generated installer logic with uniquely named registry keys
# and redirected shortcut folders; never create shortcuts on the user's desktop.
$text = $text.Replace('$DESKTOP', (ConvertTo-NsisString $desktopDirectory))
$text = $text.Replace('$SMPROGRAMS', (ConvertTo-NsisString $startMenuDirectory))
$hookSource = Join-Path $repositoryRoot 'src-tauri/windows/installer-hooks.nsh'
$testHook = Join-Path $sourceDirectory 'installer-hooks.nsh'
Assert-Condition ($text.Contains($hookSource)) 'Expected the generated installer to include the data-migration hooks.'
$hookText = [IO.File]::ReadAllText($hookSource)
$hookText = $hookText.Replace('$DESKTOP', (ConvertTo-NsisString $desktopDirectory))
$hookText = $hookText.Replace('$SMPROGRAMS', (ConvertTo-NsisString $startMenuDirectory))
[IO.File]::WriteAllText($testHook, $hookText, [Text.UTF8Encoding]::new($true))
$text = $text.Replace($hookSource, $testHook)
foreach ($file in Get-ChildItem -LiteralPath $generatedDirectory -File) {
    if ($file.Name -ne 'installer.nsi') { Copy-Item -LiteralPath $file.FullName -Destination (Join-Path $sourceDirectory $file.Name) }
}
$testScript = Join-Path $sourceDirectory 'installer.nsi'
[IO.File]::WriteAllText($testScript, $text, [Text.UTF8Encoding]::new($true))
& $makensis /V2 ('/DFIREFLY_LEGACY_DATA_DIRECTORY=' + $legacyBundleId) $testScript
if ($LASTEXITCODE -ne 0) { throw 'Unable to compile isolated installer.' }
$expectedHash = (Get-FileHash -LiteralPath $testBinary -Algorithm SHA256).Hash
$version = (Get-Content -LiteralPath (Join-Path $repositoryRoot 'package.json') -Raw -Encoding utf8 | ConvertFrom-Json).version

try {
    foreach ($path in $appDataDirectories) {
        New-Item -ItemType Directory -Path $path | Out-Null
        Set-Content -LiteralPath (Join-Path $path 'installer-test.txt') -Value $testId -Encoding ascii
    }
    Invoke-TestProcess $testInstaller ('/S /D=' + $installDirectory)
    Assert-Condition (Test-Path -LiteralPath $installedBinary) 'Custom install path was not used.'
    Assert-Condition ((Get-FileHash -LiteralPath $installedBinary -Algorithm SHA256).Hash -eq $expectedHash) 'Installed application differs from the built executable.'
    Assert-Condition ((Get-ItemProperty -LiteralPath $uninstallKey).DisplayVersion -eq $version) 'Installed version is incorrect.'
    $shellObject = New-Object -ComObject WScript.Shell
    foreach ($link in @($desktopLink, $startMenuLink)) {
        Assert-Condition (Test-Path -LiteralPath $link) ('Shortcut was not created: ' + $link)
        $target = $shellObject.CreateShortcut($link).TargetPath
        Assert-Condition ($target -eq $installedBinary) ('Shortcut target is incorrect: ' + $target)
    }
    Write-Output 'PASS: Chinese custom path, installed payload, desktop/start menu shortcuts and uninstall registration.'

    $foreignFile = Join-Path $installDirectory 'user-file.txt'
    Set-Content -LiteralPath $foreignFile -Value $testId -Encoding ascii
    Set-ItemProperty -LiteralPath $uninstallKey -Name DisplayVersion -Value '0.0.1'
    Invoke-TestProcess $testInstaller '/S'
    Assert-Condition ((Get-ItemProperty -LiteralPath $uninstallKey).DisplayVersion -eq $version) 'Upgrade did not update the version.'
    Assert-Condition ((Get-FileHash -LiteralPath $installedBinary -Algorithm SHA256).Hash -eq $expectedHash) 'Upgrade did not retain the custom installation path.'
    foreach ($path in $appDataDirectories) {
        Assert-Condition ((Get-Content -LiteralPath (Join-Path $path 'installer-test.txt') -Raw).Trim() -eq $testId) 'Upgrade modified application data.'
    }
    Write-Output 'PASS: Upgrade restores the custom install path and preserves application data.'

    Invoke-TestUninstall
    foreach ($link in @($desktopLink, $startMenuLink)) {
        Assert-Condition (-not (Test-Path -LiteralPath $link)) ('Uninstall left a shortcut: ' + $link)
    }
    Assert-Condition ((Get-Content -LiteralPath $foreignFile -Raw).Trim() -eq $testId) 'Uninstall removed an unrelated file.'
    foreach ($path in $appDataDirectories) {
        Assert-Condition ((Get-Content -LiteralPath (Join-Path $path 'installer-test.txt') -Raw).Trim() -eq $testId) 'Uninstall deleted application data by default.'
    }
    Write-Output 'PASS: Uninstall removes only the installed app, shortcuts and uninstall entry; user files/data remain.'

    # Select the same state that un.ConfirmLeave reads from the GUI checkbox.
    # Only this isolated test copy forces that state; the production installer
    # and its default (unchecked) behavior remain unchanged.
    $clearDataInstaller = Join-Path $testRoot 'installer-clear-data-test.exe'
    $clearText = $text.Replace(
        ('!define OUTFILE "' + (ConvertTo-NsisString $testInstaller) + '"'),
        ('!define OUTFILE "' + (ConvertTo-NsisString $clearDataInstaller) + '"')
    )
    Assert-Condition ($clearText.Contains('SendMessage $DeleteAppDataCheckbox ${BM_GETCHECK} 0 0 $DeleteAppDataCheckboxState')) 'Clear-data checkbox does not supply its checked state.'
    Assert-Condition ([regex]::Matches($clearText, '(?m)^Function un\.onInit\r?$').Count -eq 1) 'Unexpected uninstaller initialization.'
    $clearText = [regex]::Replace($clearText, '(?m)^Function un\.onInit\r?$', ('Function un.onInit' + "`r`n" + '  StrCpy $DeleteAppDataCheckboxState 1'))
    $clearScript = Join-Path $sourceDirectory 'installer-clear-data.nsi'
    [IO.File]::WriteAllText($clearScript, $clearText, [Text.UTF8Encoding]::new($true))
    & $makensis /V2 ('/DFIREFLY_LEGACY_DATA_DIRECTORY=' + $legacyBundleId) $clearScript
    if ($LASTEXITCODE -ne 0) { throw 'Unable to compile isolated clear-data installer.' }
    foreach ($path in $appDataDirectories) {
        $nestedDirectory = Join-Path $path 'nested/profile/storage'
        New-Item -ItemType Directory -Path $nestedDirectory -Force | Out-Null
        Set-Content -LiteralPath (Join-Path $nestedDirectory 'sample-data.txt') -Value $testId -Encoding ascii
    }
    Invoke-TestProcess $clearDataInstaller ('/S /D=' + $installDirectory)
    Invoke-TestUninstall
    $deadline = [DateTime]::UtcNow.AddSeconds(30)
    while (@($appDataDirectories | Where-Object { Test-Path -LiteralPath $_ }).Count) {
        if ([DateTime]::UtcNow -gt $deadline) { throw 'Selected clear-data option did not remove new and legacy AppData directories.' }
        Start-Sleep -Milliseconds 200
    }
    Assert-Condition ((Get-Content -LiteralPath $foreignFile -Raw).Trim() -eq $testId) 'Clear-data uninstall removed an unrelated installation-directory file.'
    Write-Output 'PASS: Selecting clear data removes new and legacy Roaming/Local application directories, including nested data.'
    [ordered]@{ version=$version; architecture=$Architecture; build_directory=$buildRoot; test_directory=$testRoot; custom_path=$true; shortcuts=$true; upgrade=$true; uninstall=$true; data_preserved=$true; clear_data=$true; legacy_data_preserved=$true; legacy_data_cleared=$true } |
        ConvertTo-Json | Set-Content -LiteralPath (Join-Path $testRoot 'verification.json') -Encoding utf8
} finally {
    Invoke-TestUninstall
    foreach ($path in $appDataDirectories) {
        if (Test-Path -LiteralPath $path) {
            Remove-Item -LiteralPath (Join-Path $path 'installer-test.txt') -ErrorAction SilentlyContinue
            Remove-Item -LiteralPath $path
        }
    }
    # Every registry key belongs to this invocation's random test namespace.
    if (Test-Path -LiteralPath $manufacturerKey) { Remove-Item -LiteralPath $manufacturerKey -Recurse }
}
Write-Output ('Installer lifecycle verification completed: ' + $testRoot)
