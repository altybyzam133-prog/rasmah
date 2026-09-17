@echo off
chcp 65001 >nul
cd /d "%~dp0"
title رسمة / Rasmah

echo.
echo   ====================================
echo    رسمة / Rasmah  —  استوديو التصميم
echo   ====================================
echo.

where node >nul 2>nul
if errorlevel 1 (
  echo   [!] Node.js غير مثبّت. ثبّته من https://nodejs.org ثم أعد المحاولة.
  echo       Node.js is not installed. Install it from https://nodejs.org
  pause
  exit /b 1
)

if not exist "node_modules" (
  echo   - تثبيت الحزم / installing packages ...
  call npm install || (echo   [!] فشل npm install & pause & exit /b 1)
)

if not exist "public\vendor\fabric.min.js" (
  echo   - تنزيل مكتبات المحرّر والخطوط / fetching editor libraries ...
  call npm run fetch-vendor
)

echo   - تجهيز القوالب / seeding templates ...
call npm run seed

echo.
echo   يفتح المتصفح على http://127.0.0.1:3000
echo   لإيقاف الخادم: أغلق هذه النافذة أو اضغط Ctrl + C
echo.

start "" http://127.0.0.1:3000
node server.js

pause
