@echo off
echo ===================================================
echo   CIPHER VAULT: MASTER BOOT SEQUENCE INITIATED
echo ===================================================

echo [1/5] Starting MongoDB Database...
start "MongoDB" cmd /k "if exist ""C:\Program Files\MongoDB\Server\8.2\bin\mongod.exe"" (""C:\Program Files\MongoDB\Server\8.2\bin\mongod.exe"") else (mongod)"
timeout /t 3 /nobreak > nul

echo [2/5] Starting Local Llama 3 (Ollama)...
start "Ollama Engine" cmd /k "ollama run llama3"
timeout /t 3 /nobreak > nul

echo [3/5] Starting Python AI Microservice...
start "FastAPI AI" cmd /k "cd ai-service && if exist .venv\Scripts\python.exe (.venv\Scripts\python.exe run.py) else (python run.py)"
timeout /t 3 /nobreak > nul

echo [4/5] Starting Node.js Cryptographic Backend...
start "Node Backend" cmd /k "cd backend && npm run dev"
timeout /t 3 /nobreak > nul

echo [5/5] Starting React Frontend...
start "React UI" cmd /k "cd frontend && npm run dev"

echo.
echo All systems are booting in separate windows!
echo If a window instantly crashes and closes, that is the broken service.
echo Wait 10 seconds for everything to initialize, then open your browser.
pause
