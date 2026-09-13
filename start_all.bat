@echo off
echo Starting ClozFlow Services...

echo Starting Python Backend...
start cmd /k "cd backend && python main.py"

echo Backend service is starting up!
echo ------------------------------------------------
echo Python Backend:       http://localhost:8000
echo ------------------------------------------------
