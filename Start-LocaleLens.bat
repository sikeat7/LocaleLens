@echo off
cd /d "%~dp0"
where node >nul 2>nul
if errorlevel 1 (
  echo Install Node.js 22.13 or later from https://nodejs.org, then open this file again.
  pause
  exit /b 1
)
if not exist node_modules (
  call npm ci --include=dev
  if errorlevel 1 goto end
)
call npm run browser:install
if errorlevel 1 goto end
call npm start
:end
pause
