@echo off
setlocal
rem Starts the ClozFlow backend. Works from any folder: paths are relative to
rem this script (web\), not the current directory.
rem Interpreter: %CLOZFLOW_PYTHON% if set, else backend\.venv, else python on PATH.

set "WEB_DIR=%~dp0"
set "BACKEND_DIR=%WEB_DIR%backend"
set "PYTHON=python"
if exist "%BACKEND_DIR%\.venv\Scripts\python.exe" set "PYTHON=%BACKEND_DIR%\.venv\Scripts\python.exe"
if defined CLOZFLOW_PYTHON set "PYTHON=%CLOZFLOW_PYTHON%"

echo Starting ClozFlow Services...

echo Starting Python Backend...
start "ClozFlow Backend" /d "%BACKEND_DIR%" cmd /k ""%PYTHON%" main.py"

echo Backend service is starting up!
echo ------------------------------------------------
echo Python Backend:       http://localhost:8000
echo ------------------------------------------------
endlocal
