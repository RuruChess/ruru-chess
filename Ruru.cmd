@echo off
rem Ruru Chess: ξεκινά τον τοπικό server και ανοίγει την εφαρμογή σε δικό της παράθυρο.
chcp 65001 >nul
cd /d "%~dp0"
where node >nul 2>nul || goto nonode
node -e "process.exit(+process.versions.node.split('.')[0] >= 24 ? 0 : 1)" || goto nonode
if not exist node_modules (
  echo Πρώτη εκκίνηση: εγκατάσταση πακέτων...
  call npm install
)
if not exist dist\web\index.html (
  echo Χτίσιμο περιβάλλοντος...
  call npm run build
)
node src\server\main.ts --open
exit /b

:nonode
echo.
echo Το Ruru Chess χρειάζεται το Node.js 24 ή νεότερο (δωρεάν): https://nodejs.org
echo Εγκατάστησέ το (έκδοση LTS) και ξανάνοιξε το Ruru Chess.
echo.
start "" https://nodejs.org/
pause
exit /b 1
