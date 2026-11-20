# ==============================================================================
# Cipher Vault Orchestration Helper: start-all.ps1
# Opens separate PowerShell windows for Mongo, Backend, AI Service, and Frontend.
# Zero secrets stored inside this script.
# ==============================================================================

$root = Split-Path -Parent $PSScriptRoot

Write-Host "==========================================================" -ForegroundColor Cyan
Write-Host "   Starting Cipher Vault Local Microservices Stack" -ForegroundColor Cyan
Write-Host "==========================================================" -ForegroundColor Cyan

# Helper to test port instantaneously
function Test-PortOpen($port) {
    try {
        $client = New-Object System.Net.Sockets.TcpClient
        $iar = $client.BeginConnect("127.0.0.1", $port, $null, $null)
        $success = $iar.AsyncWaitHandle.WaitOne(200, $false)
        if ($success -and $client.Connected) {
            $client.EndConnect($iar)
            $client.Close()
            return $true
        }
        $client.Close()
        return $false
    } catch {
        return $false
    }
}

# Helper to find MongoDB
$mongoExe = if (Get-Command mongod -ErrorAction SilentlyContinue) { "mongod" }
             elseif (Test-Path "C:\Program Files\MongoDB\Server\8.2\bin\mongod.exe") { "C:\Program Files\MongoDB\Server\8.2\bin\mongod.exe" }
             elseif (Get-ChildItem "C:\Program Files\MongoDB\Server" -Recurse -Filter "mongod.exe" -ErrorAction SilentlyContinue | Select-Object -First 1 -ExpandProperty FullName) { (Get-ChildItem "C:\Program Files\MongoDB\Server" -Recurse -Filter "mongod.exe" -ErrorAction SilentlyContinue | Select-Object -First 1 -ExpandProperty FullName) }
             else { "mongod" }

# Helper to find Ollama
$ollamaExe = if (Get-Command ollama -ErrorAction SilentlyContinue) { "ollama" }
             elseif (Test-Path "$env:LOCALAPPDATA\Programs\Ollama\ollama.exe") { "$env:LOCALAPPDATA\Programs\Ollama\ollama.exe" }
             else { "ollama" }

# 1. MongoDB
if (Test-PortOpen 27017) {
    Write-Host "[1/5] MongoDB is already running on port 27017." -ForegroundColor Green
} else {
    Write-Host "[1/5] Launching MongoDB..." -ForegroundColor Green
    Start-Process powershell -ArgumentList "-NoExit", "-Command", "Write-Host 'MongoDB Instance' -ForegroundColor Green; if (Get-Service MongoDB -ErrorAction SilentlyContinue) { Start-Service MongoDB } elseif (Get-Command docker -ErrorAction SilentlyContinue) { docker start cipher-mongo } else { & '$mongoExe' }"
}

# 2. Ollama LLM Service
if (Test-PortOpen 11434) {
    Write-Host "[2/5] Ollama is already running on port 11434." -ForegroundColor Green
} else {
    Write-Host "[2/5] Launching Ollama LLM..." -ForegroundColor Green
    Start-Process powershell -ArgumentList "-NoExit", "-Command", "Write-Host 'Ollama Service' -ForegroundColor Green; & '$ollamaExe' serve"
}

# 3. AI Service (Python loopback server via run.py)
if (Test-PortOpen 8000) {
    Write-Host "[3/5] AI Service is already running on port 8000." -ForegroundColor Green
} else {
    Write-Host "[3/5] Launching AI Service (python run.py)..." -ForegroundColor Green
    $aiPath = Join-Path $root "ai-service"
    Start-Process powershell -ArgumentList "-NoExit", "-Command", "Set-Location '$aiPath'; Write-Host 'Cipher Vault AI Service (127.0.0.1:8000)' -ForegroundColor Green; if (Test-Path '.\.venv\Scripts\python.exe') { .\.venv\Scripts\python.exe run.py } else { python run.py }"
}

# 4. Backend (Node.js API)
if (Test-PortOpen 5000) {
    Write-Host "[4/5] Backend is already running on port 5000." -ForegroundColor Green
} else {
    Write-Host "[4/5] Launching Backend Server..." -ForegroundColor Green
    $backendPath = Join-Path $root "backend"
    Start-Process powershell -ArgumentList "-NoExit", "-Command", "Set-Location '$backendPath'; Write-Host 'Cipher Vault Backend API (127.0.0.1:5000)' -ForegroundColor Green; npm run dev"
}

# 5. Frontend (Vite SPA)
if (Test-PortOpen 3000) {
    Write-Host "[5/5] Frontend is already running on port 3000." -ForegroundColor Green
} else {
    Write-Host "[5/5] Launching Frontend SPA..." -ForegroundColor Green
    $frontendPath = Join-Path $root "frontend"
    Start-Process powershell -ArgumentList "-NoExit", "-Command", "Set-Location '$frontendPath'; Write-Host 'Cipher Vault Frontend UI (http://localhost:3000)' -ForegroundColor Green; npm run dev"
}

Write-Host "`nAll services active." -ForegroundColor Yellow
Write-Host "Open http://localhost:3000 in your browser." -ForegroundColor Cyan
