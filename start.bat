@echo off
title AZHARS store (keep this window open)
cd /d "%~dp0"

where node >nul 2>nul
if errorlevel 1 (
  echo.
  echo   Node.js is not installed on this computer yet.
  echo   A download page will open. Install the LTS version, then double-click this file again.
  echo.
  start https://nodejs.org
  pause
  exit /b 1
)

node check.js
if errorlevel 1 (
  pause
  exit /b 1
)

if not exist node_modules (
  echo Setting things up for the first time. This needs internet and takes about a minute...
  call npm install --omit=dev
)

start "" cmd /c "timeout /t 3 >nul & start http://localhost:3000"
node --no-warnings server.js
echo.
echo   The store has stopped. Press any key to close this window.
pause >nul
