@echo off
setlocal EnableExtensions
title Local Badge Remover
cd /d "%~dp0"

if not exist "runtime\node.exe" (
  echo.
  echo The package is incomplete.
  echo Keep all files inside the Local Badge Remover folder together.
  echo.
  pause
  exit /b 1
)

if not exist "scripts\serve.mjs" (
  echo.
  echo The package is incomplete.
  echo Keep all files inside the Local Badge Remover folder together.
  echo.
  pause
  exit /b 1
)

set "BADGE_REMOVER_PORT=0"
set "BADGE_REMOVER_OPEN_BROWSER=1"
set "BADGE_REMOVER_PREFERRED_BROWSER=edge"

echo.
echo Starting Local Badge Remover...
echo Images remain on this PC.
echo Keep this window open while using the app.
echo Press Control-C or close this window to stop it.
echo.

"runtime\node.exe" "scripts\serve.mjs"

if errorlevel 1 (
  echo.
  echo Local Badge Remover stopped with an error.
  pause
)

endlocal
