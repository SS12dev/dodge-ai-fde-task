# Quick-start script for local development (Windows PowerShell)
# Usage: .\start.ps1

$Root = $PSScriptRoot

# Start backend
$backendPy = Join-Path $Root ".venv\Scripts\python.exe"
Start-Process -NoNewWindow $backendPy `
    -ArgumentList "-m", "uvicorn", "app.main:app", "--reload", "--port", "8000" `
    -WorkingDirectory (Join-Path $Root "src\backend")

Write-Host "Backend starting on http://localhost:8000 ..."

# Start frontend
Start-Process -NoNewWindow "npm" `
    -ArgumentList "run", "dev" `
    -WorkingDirectory (Join-Path $Root "src\frontend")

Write-Host "Frontend starting on http://localhost:5173 ..."
Write-Host "Open http://localhost:5173 in your browser."
Write-Host "Press Ctrl+C to stop both servers."

# Keep script alive
try { while ($true) { Start-Sleep 60 } } catch { }
