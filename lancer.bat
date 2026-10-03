@echo off
chcp 65001 >nul
cd /d "%~dp0"
title ClipStudio

where py >nul 2>nul
if %errorlevel%==0 (
  py -3 lancer.py
  goto fin
)

where python >nul 2>nul
if %errorlevel%==0 (
  python lancer.py
  goto fin
)

echo Python est introuvable.
echo Installez-le depuis https://www.python.org/downloads/ en cochant "Add python.exe to PATH".

:fin
pause
