# Rubynod Code-OSS fork setup (Windows PowerShell)
$ErrorActionPreference = "Stop"
$Root = Split-Path -Parent $PSScriptRoot
$ForkDir = Join-Path $Root "vscode-fork"
$Tag = if ($env:VSCODE_TAG) { $env:VSCODE_TAG } else { "1.99.0" }

if (Test-Path (Join-Path $ForkDir ".git")) {
    Write-Host "Code-OSS fork already exists at $ForkDir"
} else {
    Write-Host "Cloning vscode ($Tag)..."
    git clone --depth 1 --branch $Tag https://github.com/microsoft/vscode.git $ForkDir
}

Copy-Item (Join-Path $Root "product.json") (Join-Path $ForkDir "product.json") -Force
Write-Host "Applied Rubynod product.json"

$ExtSrc = Join-Path $Root "extensions\rubynod-ai-ui"
$ExtDst = Join-Path $ForkDir "extensions\rubynod-ai-ui"
if (-not (Test-Path $ExtDst)) {
    New-Item -ItemType Junction -Path $ExtDst -Target $ExtSrc | Out-Null
    Write-Host "Linked rubynod-ai-ui extension"
}

Write-Host @"

Next steps (Windows):
  cd vscode-fork
  npm install
  npm run compile
  .\scripts\code.bat

AI service (separate terminal):
  npm run dev:ai
"@
