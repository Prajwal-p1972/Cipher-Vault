# ==============================================================================
# Cipher Vault Orchestration Helper: start-all.ps1
# Opens separate PowerShell windows for Mongo, Backend, AI Service, and Frontend.
# Zero secrets stored inside this script.
# ==============================================================================

$root = Split-Path -Parent $PSScriptRoot

Write-Host "==========================================================" -ForegroundColor Cyan
Write-Host "   Starting Cipher Vault Local Microservices Stack" -ForegroundColor Cyan
Write-Host "==========================================================" -ForegroundColor Cyan

# 1. MongoDB (checks Docker container first, falls back to local mongod)
Write-Host "[1/4] Launching MongoDB..." -ForegroundColor Green
Start-Process powershell -ArgumentList "-NoExit", "-Command", "Write-Host 'MongoDB Instance' -ForegroundColor Green; if (Get-Command docker -ErrorAction SilentlyContinue) { docker start cipher-mongo } else { mongod }"

# 2. Ollama LLM Service
Write-Host "[2/4] Launching Ollama LLM..." -ForegroundColor Green
Start-Process powershell -ArgumentList "-NoExit", "-Command", "Write-Host 'Ollama Service' -ForegroundColor Green; ollama serve"

# 3. AI Service (Python loopback server via run.py)
Write-Host "[3/4] Launching AI Service (python run.py)..." -ForegroundColor Green
$aiPath = Join-Path $root "ai-service"
Start-Process powershell -ArgumentList "-NoExit", "-Command", "Set-Location '$aiPath'; Write-Host 'Cipher Vault AI Service (127.0.0.1:8000)' -ForegroundColor Green; if (Test-Path '.\.venv\Scripts\python.exe') { .\.venv\Scripts\python.exe run.py } else { python run.py }"

# 4. Backend (Node.js API)
Write-Host "[4/5] Launching Backend Server..." -ForegroundColor Green
$backendPath = Join-Path $root "backend"
Start-Process powershell -ArgumentList "-NoExit", "-Command", "Set-Location '$backendPath'; Write-Host 'Cipher Vault Backend API (127.0.0.1:5000)' -ForegroundColor Green; npm run dev"

# 5. Frontend (Vite SPA)
Write-Host "[5/5] Launching Frontend SPA..." -ForegroundColor Green
$frontendPath = Join-Path $root "frontend"
Start-Process powershell -ArgumentList "-NoExit", "-Command", "Set-Location '$frontendPath'; Write-Host 'Cipher Vault Frontend UI (http://localhost:3000)' -ForegroundColor Green; npm run dev"

Write-Host "`nAll services dispatched to background console windows." -ForegroundColor Yellow
Write-Host "Open http://localhost:3000 in your browser." -ForegroundColor Cyan
