<#
.SYNOPSIS
    Install the llama.cpp server binaries the local model ladder runs on.

.DESCRIPTION
    local-stack/bin/ is git-ignored (CUDA binaries are ~500 MB and machine
    specific), so a fresh clone needs this to rebuild it.

    Pinned to a known-good build. Newer builds usually work, but flag names do
    change between them -- b10405 renamed --no-mmap to --load-mode and the
    speculative decoding flags to --spec-*. If you bump Build, re-run
    `clawd-local doctor` and `clawd-local bench workhorse` afterwards.

.PARAMETER Build
    llama.cpp release tag, e.g. b10405.

.PARAMETER Cuda
    CUDA runtime variant matching your driver. 13.3 needs driver >= 580;
    use 12.4 for older drivers.

.EXAMPLE
    .\scripts\install-llamacpp.ps1
    .\scripts\install-llamacpp.ps1 -Build b10500 -Cuda 12.4
#>
[CmdletBinding()]
param(
    [string]$Build = "b10405",
    [ValidateSet("12.4", "13.3")]
    [string]$Cuda = "13.3"
)

$ErrorActionPreference = "Stop"
$ProgressPreference = "SilentlyContinue"

$stackDir = Join-Path (Split-Path -Parent $PSScriptRoot) "local-stack"
$binDir = Join-Path $stackDir "bin"

Write-Host "Installing llama.cpp $Build (CUDA $Cuda) into $binDir"

if (-not (Test-Path $stackDir)) {
    throw "local-stack not found at $stackDir"
}
New-Item -ItemType Directory -Force -Path $binDir | Out-Null

$base = "https://github.com/ggml-org/llama.cpp/releases/download/$Build"
$main = "llama-$Build-bin-win-cuda-$Cuda-x64.zip"
$cudart = "cudart-llama-bin-win-cuda-$Cuda-x64.zip"

foreach ($asset in @($main, $cudart)) {
    $dest = Join-Path $binDir $asset
    Write-Host "  downloading $asset ..."
    try {
        Invoke-WebRequest -Uri "$base/$asset" -OutFile $dest -TimeoutSec 600
    } catch {
        throw "failed to download $base/$asset : $($_.Exception.Message)`nCheck that build '$Build' exists and publishes a CUDA $Cuda x64 asset."
    }
    Write-Host "  extracting $asset ..."
    Expand-Archive -Path $dest -DestinationPath $binDir -Force
    Remove-Item $dest
}

$server = Join-Path $binDir "llama-server.exe"
if (-not (Test-Path $server)) {
    throw "llama-server.exe missing after extraction - the release layout may have changed"
}

Write-Host ""
& $server --version
Write-Host ""
& $server --list-devices
Write-Host ""
Write-Host "Done. Next:"
Write-Host "  python -m src.local.cli doctor        # check config, GPU, models"
Write-Host "  python -m src.local.cli fetch all     # download model weights (~30 GB)"
