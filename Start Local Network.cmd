@echo off
cd /d "%~dp0"
node service/server.cjs --lan
pause
