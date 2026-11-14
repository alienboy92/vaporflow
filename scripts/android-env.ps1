# Shared by the Windows Android runner and doctor. No persistent shell changes.
$androidRepoRoot = Split-Path $PSScriptRoot -Parent
$androidProject = Join-Path $androidRepoRoot 'apps/mobile/android'
$androidJavaHome = $null
$androidJavaCandidates = @()
if ($env:JAVA_HOME) { $androidJavaCandidates += $env:JAVA_HOME }
if ($env:ProgramFiles) {
    $androidJavaCandidates += @(Get-ChildItem -LiteralPath (Join-Path $env:ProgramFiles 'Eclipse Adoptium') -Directory -ErrorAction SilentlyContinue | Sort-Object Name -Descending | Select-Object -ExpandProperty FullName)
}
foreach ($candidate in $androidJavaCandidates) {
    $javaExe = Join-Path $candidate 'bin/java.exe'
    if ((Test-Path $javaExe) -and (Test-Path (Join-Path $candidate 'bin/javac.exe'))) {
        $version = (& $javaExe -version 2>&1 | Out-String)
        if ($LASTEXITCODE -eq 0 -and $version -match 'version "17\.') {
            # A trailing backslash would escape the closing quote in GRADLE_OPTS.
            $androidJavaHome = $candidate.TrimEnd([char[]]'\/')
            break
        }
    }
}
if ($androidJavaHome) {
    $env:JAVA_HOME = $androidJavaHome
    $env:Path = "$androidJavaHome/bin;$env:Path"
    # Also select the daemon JDK if a user's Gradle properties choose another one.
    $env:GRADLE_OPTS = "$env:GRADLE_OPTS `"-Dorg.gradle.java.home=$androidJavaHome`""
}

$androidSdk = $env:ANDROID_HOME
if (!$androidSdk) { $androidSdk = $env:ANDROID_SDK_ROOT }
$androidLocalProperties = Join-Path $androidProject 'local.properties'
if (Test-Path $androidLocalProperties) {
    $sdkLine = Get-Content $androidLocalProperties | Where-Object { $_ -match '^sdk\.dir\s*=' } | Select-Object -First 1
    if ($sdkLine) {
        $androidSdk = ($sdkLine -replace '^sdk\.dir\s*=\s*', '').Replace('\:', ':').Replace('\\', '\')
    }
}
if (!$androidSdk -and $env:LOCALAPPDATA) { $androidSdk = Join-Path $env:LOCALAPPDATA 'Android/Sdk' }
if ($androidSdk) {
    $env:ANDROID_HOME = $androidSdk
    $env:ANDROID_SDK_ROOT = $androidSdk
    $env:Path = "$androidSdk/platform-tools;$env:Path"
    $androidSdkManager = Join-Path $androidSdk 'cmdline-tools/12.0/bin/sdkmanager.bat'
    if (Test-Path $androidSdkManager) {
        $env:Path = "$(Split-Path $androidSdkManager);$env:Path"
    }
}
$androidCompileSdk = 34
$androidVariables = Join-Path $androidProject 'variables.gradle'
if (Test-Path $androidVariables) {
    $variablesText = Get-Content $androidVariables -Raw
    if ($variablesText -match 'compileSdkVersion\s*=\s*(\d+)') { $androidCompileSdk = [int]$Matches[1] }
}
# Capacitor 6 uses AGP 8.2.1, whose default Build-Tools version is 34.0.0.
$androidBuildTools = '34.0.0'
if ((Test-Path $androidVariables) -and $variablesText -match "buildToolsVersion\s*=\s*['\`"]([^'\`"]+)['\`"]") {
    $androidBuildTools = $Matches[1]
}
