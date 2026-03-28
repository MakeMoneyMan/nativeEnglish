$ErrorActionPreference = "Stop"

$projectRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
$devVarsPath = Join-Path $projectRoot ".dev.vars"

if ((-not $env:OPENAI_API_KEY) -and (Test-Path -LiteralPath $devVarsPath)) {
  foreach ($rawLine in Get-Content -LiteralPath $devVarsPath) {
    $line = $rawLine.Trim()

    if ($line.Length -eq 0) {
      continue
    }

    if ($line.StartsWith("#")) {
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
  $env:OPENAI_MODEL = "gpt-4o-mini"
}

if (-not $env:OPENAI_API_BASE_URL) {
  $env:OPENAI_API_BASE_URL = "https://api.chatanywhere.tech"
}

Set-Location -LiteralPath $projectRoot

Write-Host "Local preview: http://127.0.0.1:8788" -ForegroundColor Cyan
Write-Host "Model: $($env:OPENAI_MODEL)" -ForegroundColor Cyan
Write-Host "API base URL: $($env:OPENAI_API_BASE_URL)" -ForegroundColor Cyan

& npx wrangler pages dev ./public --port 8788
