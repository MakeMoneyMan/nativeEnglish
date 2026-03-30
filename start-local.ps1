param(
  [switch]$Remote
)

$ErrorActionPreference = "Stop"

$projectRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
$devVarsPath = Join-Path $projectRoot ".dev.vars"

if ((-not $env:OPENAI_API_KEY) -and (Test-Path -LiteralPath $devVarsPath)) {
  foreach ($rawLine in Get-Content -LiteralPath $devVarsPath) {
    $line = $rawLine.Trim()

    if ($line.Length -eq 0 -or $line.StartsWith("#")) {
      continue
    }

    $parts = $line -split "=", 2
    if ($parts.Length -ne 2) {
      continue
    }

    [System.Environment]::SetEnvironmentVariable($parts[0], $parts[1], "Process")
  }
}

if (-not $env:OPENAI_API_KEY) {
  throw "Please set OPENAI_API_KEY in the current shell or in .dev.vars."
}

if (-not $env:OPENAI_MODEL) {
  $env:OPENAI_MODEL = "glm-4-flash"
}

if (-not $env:OPENAI_API_BASE_URL) {
  $env:OPENAI_API_BASE_URL = "https://open.bigmodel.cn/api/paas"
}

if (-not $env:OPENAI_CHAT_COMPLETIONS_PATH) {
  $env:OPENAI_CHAT_COMPLETIONS_PATH = "/v4/chat/completions"
}

Set-Location -LiteralPath $projectRoot

Write-Host "Building React app..." -ForegroundColor Cyan
& npm run build
if ($LASTEXITCODE -ne 0) {
  throw "React build failed."
}

Write-Host "Local preview: http://127.0.0.1:8788" -ForegroundColor Cyan
Write-Host "Model: $($env:OPENAI_MODEL)" -ForegroundColor Cyan
Write-Host "API base URL: $($env:OPENAI_API_BASE_URL)" -ForegroundColor Cyan
Write-Host "Chat path: $($env:OPENAI_CHAT_COMPLETIONS_PATH)" -ForegroundColor Cyan

if ($Remote) {
  Write-Host "Mode: remote dev (reads remote Cloudflare bindings/data)" -ForegroundColor Yellow
  & npx wrangler dev --remote --port 8788
} else {
  Write-Host "Mode: local dev (uses local D1 data and local migrations)" -ForegroundColor Yellow
  & npx wrangler dev --port 8788
}
