@echo off
setlocal
cd /d "%~dp0"

echo Starting Morphus Dev Converter from this repo...
echo.
echo If this window says the port is already in use, close the packaged Morphus Converter first.
echo.

npm run dev:converter

echo.
echo Morphus Dev Converter stopped.
pause
