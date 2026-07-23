@echo off
echo Starting ClozFlow Services...

echo Starting WhatsApp Bridge...
start cmd /k "cd whatsapp-bridge && npm start"

echo Starting Python Backend...
start cmd /k "cd backend && python main.py"

echo Both services are starting up!
echo ------------------------------------------------
echo WhatsApp QR endpoint: http://localhost:3001/qr
echo Python Backend:       http://localhost:8000
echo ------------------------------------------------
