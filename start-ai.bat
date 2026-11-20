@echo off
title Cipher Vault - Local AI Service
echo ===================================================
echo   CIPHER VAULT: LOCAL AI SERVICE LAUNCHER
echo   (Zero-Knowledge Private Document Analysis)
echo ===================================================
echo.

cd /d "%~dp0"

echo [1/2] Checking and starting Ollama (Llama 3)...
start /min "Ollama Engine" cmd /c "ollama serve"
timeout /t 2 /nobreak > nul

echo [2/2] Starting Python AI Microservice on http://127.0.0.1:8000...
cd ai-service
if exist .venv\Scripts\python.exe (
    start /min "FastAPI AI" .venv\Scripts\python.exe run.py
) else (
    start /min "FastAPI AI" python run.py
)

echo.
echo ===================================================
echo   Local AI Microservice is running in background!
echo   Target: http://127.0.0.1:8000
echo   You can now use document chat on your deployed site.
echo ===================================================
timeout /t 5
