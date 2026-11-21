<#
.SYNOPSIS
  Build and flatten the JobOps image so it runs under Kiri.

.DESCRIPTION
  Kiri cannot mount images with many overlay layers. The JobOps Dockerfile
  produces ~64 layers, so `docker compose up -d --build` builds successfully
  but the container fails with "mount .../rootfs: No such file or directory".
  This script builds the real Dockerfile with BuildKit, flattens the result to
  a two-layer image, then recreates the job-ops container and waits for it to
  become healthy.

  Paths are resolved relative to this script, so it can be run from anywhere.

.EXAMPLE
  npm run docker:rebuild:kiri

.EXAMPLE
  ./scripts/kiri-rebuild.ps1 -SkipBuild
  Re-flatten the last build without rebuilding from source.
#>
[CmdletBinding()]
param(
  [string] $Image = "ghcr.io/dakheera47/job-ops:latest",
  [string] $Service = "job-ops",
  [switch] $SkipBuild,
  [switch] $NoRecreate
)

$ErrorActionPreference = "Stop"
$repoRoot = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
Set-Location $repoRoot

function Invoke-Docker {
  param([string[]] $DockerArgs)

  & docker @DockerArgs
  if ($LASTEXITCODE -ne 0) {
    throw "docker $($DockerArgs -join ' ') failed with exit code $LASTEXITCODE"
  }
}

# Kiri bundles buildx but may not have registered it with the Docker CLI yet.
if (-not (docker buildx version 2>$null)) {
  $kiriPlugin = Join-Path $env:LOCALAPPDATA "Kiri\bin\cli-plugins\docker-buildx.exe"
  if (-not (Test-Path $kiriPlugin)) {
    throw "BuildKit plugin (buildx) is unavailable and no Kiri plugin was found at $kiriPlugin"
  }
  $pluginDir = Join-Path $env:USERPROFILE ".docker\cli-plugins"
  New-Item -ItemType Directory -Force -Path $pluginDir | Out-Null
  Copy-Item $kiriPlugin (Join-Path $pluginDir "docker-buildx.exe") -Force
  Write-Host "Registered Kiri's buildx plugin in $pluginDir"
}
Invoke-Docker @("buildx", "version")

$sourceTag = "$Image.kiri-build"
if ($SkipBuild) {
  $existing = docker image inspect $sourceTag 2>$null
  if ($LASTEXITCODE -ne 0) {
    throw "Missing $sourceTag - run without -SkipBuild first"
  }
  Write-Host "Using existing build: $sourceTag"
} else {
  Write-Host "Building $sourceTag from Dockerfile..."
  Invoke-Docker @("buildx", "build", "--load", "--target", "production", "-t", $sourceTag, ".")
}

# tmp/ is gitignored; the scratch stage needs only this one generated Dockerfile.
$contextDir = Join-Path $repoRoot "tmp\kiri-flatten"
New-Item -ItemType Directory -Force -Path $contextDir | Out-Null
$flattenDockerfile = @"
FROM scratch
COPY --from=$sourceTag / /
ENV DEBIAN_FRONTEND=noninteractive NODE_ENV=production PORT=3001 PYTHON_PATH=/usr/bin/python3 DATA_DIR=/app/data CODEX_HOME=/app/codex-home PLAYWRIGHT_BROWSERS_PATH=/ms-playwright DISPLAY=:99 NOVNC_PORT=6080 NOVNC_HOST=127.0.0.1 VNC_HOST=127.0.0.1 PATH=/root/.local/bin:/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin
WORKDIR /app/orchestrator
EXPOSE 3001
HEALTHCHECK --interval=30s --timeout=10s --start-period=5s --retries=3 CMD curl -f http://localhost:3001/health || exit 1
ENTRYPOINT ["/app/docker-entrypoint.sh"]
"@
$dockerfilePath = Join-Path $contextDir "Dockerfile"
Set-Content -Path $dockerfilePath -Value $flattenDockerfile -NoNewline

try {
  Write-Host "Flattening to a two-layer image $Image..."
  Invoke-Docker @("buildx", "build", "--load", "-f", $dockerfilePath, "-t", $Image, $contextDir)
} finally {
  Remove-Item $contextDir -Recurse -Force -ErrorAction SilentlyContinue
}

if ($NoRecreate) {
  Write-Host "Skipping container recreate. Start it with: docker compose up -d --force-recreate $Service"
  exit 0
}

Write-Host "Recreating $Service..."
Invoke-Docker @("compose", "up", "-d", "--force-recreate", $Service)

# Wait for health so a crash-looping container does not look like a success.
$deadline = (Get-Date).AddSeconds(180)
do {
  Start-Sleep -Seconds 3
  $state = & docker inspect --format "{{.State.Health.Status}}" $Service 2>$null
  if ($LASTEXITCODE -ne 0 -or -not $state) {
    throw "$Service container was not created"
  }
  if ($state -eq "healthy") { break }
  if ($state -eq "unhealthy") {
    throw "$Service reported unhealthy; see: docker logs $Service"
  }
} while ((Get-Date) -lt $deadline)

if ($state -ne "healthy") {
  throw "Timed out waiting for $Service to become healthy; see: docker logs $Service"
}
Write-Host "$Service is healthy. App: http://localhost:3005"
