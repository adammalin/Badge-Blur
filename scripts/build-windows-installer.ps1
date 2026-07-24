param(
  [string]$OutputDirectory = "",
  [string]$StageDirectory = ""
)

$ErrorActionPreference = "Stop"
$ProjectRoot = Split-Path -Parent $PSScriptRoot
$Package = Get-Content (Join-Path $ProjectRoot "package.json") -Raw |
  ConvertFrom-Json
$Version = $Package.version

if (-not $OutputDirectory) {
  $OutputDirectory = Join-Path $ProjectRoot "releases"
}
if (-not $StageDirectory) {
  $StageDirectory = Join-Path $env:RUNNER_TEMP "badge-blur-windows-stage"
}

$OutputDirectory = [IO.Path]::GetFullPath($OutputDirectory)
$StageDirectory = [IO.Path]::GetFullPath($StageDirectory)

if (Test-Path $StageDirectory) {
  Remove-Item -LiteralPath $StageDirectory -Recurse -Force
}
New-Item -ItemType Directory -Path $StageDirectory | Out-Null
New-Item -ItemType Directory -Path $OutputDirectory -Force | Out-Null
New-Item -ItemType Directory -Path (Join-Path $StageDirectory "runtime") |
  Out-Null
New-Item -ItemType Directory -Path (Join-Path $StageDirectory "scripts") |
  Out-Null

Copy-Item (Join-Path $ProjectRoot "dist") `
  (Join-Path $StageDirectory "dist") -Recurse
Copy-Item (Join-Path $ProjectRoot "demo-test-images") `
  (Join-Path $StageDirectory "demo-test-images") -Recurse
Copy-Item (Join-Path $ProjectRoot "scripts/serve.mjs") `
  (Join-Path $StageDirectory "scripts/serve.mjs")
Copy-Item (Join-Path $ProjectRoot "scripts/image-runtime.mjs") `
  (Join-Path $StageDirectory "scripts/image-runtime.mjs")
Copy-Item (Join-Path $ProjectRoot "packaging/package.json") `
  (Join-Path $StageDirectory "package.json")
Copy-Item (Join-Path $ProjectRoot "packaging/package-lock.json") `
  (Join-Path $StageDirectory "package-lock.json")
Copy-Item (Join-Path $ProjectRoot "packaging/README-Windows.txt") `
  (Join-Path $StageDirectory "README.txt")
Copy-Item (Join-Path $ProjectRoot "THIRD_PARTY_NOTICES.md") `
  (Join-Path $StageDirectory "THIRD_PARTY_NOTICES.md")
Copy-Item (Join-Path $ProjectRoot "packaging/assets/BadgeBlur.ico") `
  (Join-Path $StageDirectory "BadgeBlur.ico")

$NodeCommand = Get-Command node.exe
Copy-Item $NodeCommand.Source (Join-Path $StageDirectory "runtime/node.exe")

Push-Location $StageDirectory
try {
  npm ci --omit=dev --include=optional
  if ($LASTEXITCODE -ne 0) {
    throw "Windows runtime dependency installation failed."
  }
}
finally {
  Pop-Location
}

$CompilerCandidates = @(
  (Join-Path $env:WINDIR "Microsoft.NET\Framework64\v4.0.30319\csc.exe"),
  (Join-Path $env:WINDIR "Microsoft.NET\Framework\v4.0.30319\csc.exe")
)
$Compiler = $CompilerCandidates |
  Where-Object { Test-Path $_ } |
  Select-Object -First 1
if (-not $Compiler) {
  throw "The Windows C# compiler was not found."
}

$LauncherSource = Join-Path $ProjectRoot `
  "packaging/windows-launcher/BadgeBlurLauncher.cs"
$LauncherOutput = Join-Path $StageDirectory "Badge Blur.exe"
& $Compiler `
  /nologo `
  /target:winexe `
  /platform:x64 `
  /optimize+ `
  "/win32icon:$(Join-Path $StageDirectory 'BadgeBlur.ico')" `
  /reference:System.dll `
  /reference:System.Drawing.dll `
  /reference:System.Windows.Forms.dll `
  "/out:$LauncherOutput" `
  $LauncherSource
if ($LASTEXITCODE -ne 0) {
  throw "Badge Blur native Windows launcher compilation failed."
}

$MakeNsis = Get-Command makensis.exe -ErrorAction SilentlyContinue
if (-not $MakeNsis) {
  $NsisPath = Join-Path ${env:ProgramFiles(x86)} "NSIS\makensis.exe"
  if (Test-Path $NsisPath) {
    $MakeNsis = Get-Item $NsisPath
  }
}
if (-not $MakeNsis) {
  throw "NSIS was not found. Install NSIS before building the installer."
}

$InstallerScript = Join-Path $ProjectRoot "packaging/windows-installer.nsi"
& $MakeNsis.Source `
  "/DVERSION=$Version" `
  "/DSTAGE_DIR=$StageDirectory" `
  "/DOUTPUT_DIR=$OutputDirectory" `
  $InstallerScript
if ($LASTEXITCODE -ne 0) {
  throw "NSIS failed to build the Badge Blur installer."
}

$InstallerName = "Badge-Blur-Windows-x64-Setup-v$Version.exe"
$InstallerPath = Join-Path $OutputDirectory $InstallerName
if (-not (Test-Path $InstallerPath)) {
  throw "The expected installer was not created: $InstallerPath"
}

$Hash = (Get-FileHash -Algorithm SHA256 $InstallerPath).Hash.ToLowerInvariant()
$ChecksumPath = "$InstallerPath.sha256"
"$Hash  $InstallerName" | Set-Content -NoNewline $ChecksumPath

Write-Host ""
Write-Host "Created:"
Write-Host $InstallerPath
Write-Host $ChecksumPath
