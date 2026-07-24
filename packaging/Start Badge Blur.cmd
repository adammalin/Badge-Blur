@echo off
setlocal EnableExtensions
title Badge Blur
cd /d "%~dp0"

if not exist "runtime\node.exe" (
  echo.
  echo The package is incomplete.
  echo Keep all files inside the Badge Blur folder together.
  echo.
  pause
  exit /b 1
)

if not exist "scripts\serve.mjs" (
  echo.
  echo The package is incomplete.
  echo Keep all files inside the Badge Blur folder together.
  echo.
  pause
  exit /b 1
)

set "BADGE_REMOVER_PORT=0"
set "BADGE_REMOVER_OPEN_BROWSER=1"
set "BADGE_REMOVER_PREFERRED_BROWSER=edge"

echo.
echo Starting Badge Blur...
echo Images remain on this PC.
echo Keep this window open while using the app.
echo Press Control-C or close this window to stop it.
echo.

"runtime\node.exe" "scripts\serve.mjs"

if errorlevel 1 (
  echo.
  echo Badge Blur stopped with an error.
  pause
)

endlocal
