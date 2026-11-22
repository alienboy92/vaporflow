param(
    [switch]$Doctor, [switch]$PrepareOnly,
    [string]$Target
)

. "$PSScriptRoot/android-env.ps1"

# @capacitor-mlkit/barcode-scanning ships an empty plugin manifest, so the app
# must declare android.permission.CAMERA itself. apps/mobile/android is fully
# generated (git-ignored; recreated by `cap add android`), so the declaration
# is re-applied idempotently on every run of this script.
function Ensure-CameraPermission {
    $manifest = Join-Path $androidProject 'app/src/main/AndroidManifest.xml'
    if (!(Test-Path $manifest)) { return }
    $content = Get-Content $manifest -Raw
    if ($content -match 'android\.permission\.CAMERA') { return }
    $patched = $content -replace '(<uses-permission android:name="android\.permission\.INTERNET"\s*/>)', "`$1`r`n    <uses-permission android:name=`"android.permission.CAMERA`" />"
    if ($patched -eq $content) {
        Write-Host "WARN Could not patch $manifest - add <uses-permission android:name=`"android.permission.CAMERA`" /> manually."
        return
    }
    Set-Content -Path $manifest -Value $patched -Encoding utf8 -NoNewline
    Write-Host 'PATCH Added android.permission.CAMERA to the app manifest (required by @capacitor-mlkit/barcode-scanning).'
}
Ensure-CameraPermission

$moduleFile = Join-Path $androidProject 'app/build.gradle'
if (!(Test-Path $moduleFile)) { throw 'Generate the Android project with cap add android first.' }
$signingImport = "apply from: '../../release-signing.gradle'"
if (![IO.File]::ReadAllText($moduleFile).Contains($signingImport)) {
    [IO.File]::AppendAllText($moduleFile, [Environment]::NewLine + $signingImport + [Environment]::NewLine)
}
if ($PrepareOnly) { exit 0 }
$androidChecksPassed = $true
function Write-AndroidCheck([bool]$Passed, [string]$Name, [string]$Detail, [string]$Fix) {
    if ($Passed) { Write-Host "PASS $Name - $Detail" }
    else {
        Write-Host "FAIL $Name - $Detail"
        Write-Host "     Fix: $Fix"
        $script:androidChecksPassed = $false
    }
}

Write-AndroidCheck ([bool]$androidJavaHome) 'Java 17 JDK' "$androidJavaHome" 'winget install --id EclipseAdoptium.Temurin.17.JDK --exact; for a custom location set JAVA_HOME to a JDK 17 directory.'
$sdkExists = $androidSdk -and (Test-Path $androidSdk)
Write-AndroidCheck ([bool]$sdkExists) 'ANDROID_HOME' "$androidSdk (resolved for this process)" 'Install the Android SDK; set ANDROID_HOME or sdk.dir in apps/mobile/android/local.properties.'
Write-AndroidCheck (Test-Path $androidVariables) 'Android project' "$androidProject" 'pnpm --filter @vaporflow/mobile exec cap add android'
$manifestFile = Join-Path $androidProject 'app/src/main/AndroidManifest.xml'
$manifestHasCamera = (Test-Path $manifestFile) -and ((Get-Content $manifestFile -Raw) -match 'android\.permission\.CAMERA')
Write-AndroidCheck $manifestHasCamera 'Camera permission (manifest)' "$manifestFile" 'After cap add android, re-run scripts/android.ps1 - it patches the manifest automatically.'
if ($sdkExists) {
    $platformInstalled = (Test-Path "$androidSdk/platforms/android-$androidCompileSdk/android.jar") -and (Test-Path "$androidSdk/platforms/android-$androidCompileSdk/package.xml")
    $buildToolsInstalled = (Test-Path "$androidSdk/build-tools/$androidBuildTools/aapt2.exe") -and (Test-Path "$androidSdk/build-tools/$androidBuildTools/package.xml")
    Write-AndroidCheck $platformInstalled "SDK Platform $androidCompileSdk" "$androidSdk/platforms/android-$androidCompileSdk" ". ./scripts/android-env.ps1; sdkmanager --sdk_root=`"$androidSdk`" `"platforms;android-$androidCompileSdk`" (install Command-line Tools 12.0 first; see README)"
    Write-AndroidCheck $buildToolsInstalled "Build-Tools $androidBuildTools" "$androidSdk/build-tools/$androidBuildTools" ". ./scripts/android-env.ps1; sdkmanager --sdk_root=`"$androidSdk`" `"build-tools;$androidBuildTools`" (install Command-line Tools 12.0 first; see README)"
} else {
    Write-AndroidCheck $false 'SDK Platform' 'SDK directory unavailable' 'Configure the Android SDK first.'
    Write-AndroidCheck $false 'Build-Tools' 'SDK directory unavailable' 'Configure the Android SDK first.'
}
$adb = if ($androidSdk) { Join-Path $androidSdk 'platform-tools/adb.exe' } else { '' }
if ($adb -and (Test-Path $adb)) {
    $devices = & $adb devices 2>&1
    $adbExit = $LASTEXITCODE
    $devices | ForEach-Object { Write-Host $_ }
    $connected = @($devices | ForEach-Object { if ("$_" -match '^(\S+)\s+device$') { $Matches[1] } })
    $deviceReady = $adbExit -eq 0 -and $connected.Count -gt 0
    if ($Target) { $deviceReady = $deviceReady -and $connected -contains $Target }
    Write-AndroidCheck $deviceReady 'adb devices' "Authorized devices: $($connected -join ', ')" 'Connect/unlock the phone, enable USB debugging, and accept Allow USB debugging. Check the requested -Target serial.'
} else {
    Write-AndroidCheck $false 'adb devices' 'adb.exe missing' 'Install platform-tools with sdkmanager.'
}
if (!$androidChecksPassed) { exit 1 }
if ($Doctor) { exit 0 }

& pnpm --filter '@vaporflow/mobile' build
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
& pnpm --filter '@vaporflow/mobile' exec cap sync android
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
$capArguments = @('--filter', '@vaporflow/mobile', 'exec', 'cap', 'run', 'android')
if ($Target) { $capArguments += @('--target', $Target) }
& pnpm @capArguments
exit $LASTEXITCODE
