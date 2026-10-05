@echo off
setlocal enabledelayedexpansion
title VICE CITY 3D
cd /d "%~dp0"

echo ==========================================
echo        VICE CITY 3D - AVVIO
echo ==========================================
echo.

rem --- controllo che node sia installato ---
where node >nul 2>&1
if errorlevel 1 (
  echo [ERRORE] Node.js non trovato.
  echo Installalo da https://nodejs.org e riapri questo file.
  echo.
  pause
  exit /b 1
)

rem --- 1. avvia il server in background ---
echo [1/3] Avvio del server locale...
start "VICE3D server" /b node server.js

rem --- 2. aspetta che la porta 8080 risponda davvero ---
echo [2/3] Attesa che il server sia pronto...
set /a TENTATIVI=0
:attendi
timeout /t 1 /nobreak >nul
powershell -NoProfile -Command "try { $c = New-Object Net.Sockets.TcpClient; $c.Connect('127.0.0.1',8080); $c.Close(); exit 0 } catch { exit 1 }" >nul 2>&1
if not errorlevel 1 goto pronto
set /a TENTATIVI+=1
if !TENTATIVI! lss 15 (
  set /a TENTATIVI+=1
  goto attendi
)

echo [ERRORE] Il server non ha risposto entro 30 secondi.
echo Controlla che la porta 8080 sia libera.
echo.
pause
exit /b 1

:pronto
rem --- 3. ora si puo' aprire il browser ---
echo [3/3] Apertura del browser...
start "" "http://localhost:8080/vice3d.html"
echo.
echo ==========================================
echo  Gioco in esecuzione su http://localhost:8080
echo.
echo  COMANDI:  WASD guida | Shift accelera
echo            Spazio drift | F scendi dall'auto
echo            C telecamera | M audio | Esc pausa
echo.
echo  Per chiudere tutto: premi un tasto qui sotto.
echo ==========================================
echo.
pause

rem --- chiusura: uccidi SOLO il server che ascolta su 8080 ---
for /f "tokens=5" %%p in ('netstat -ano ^| findstr ":8080" ^| findstr "LISTENING"') do (
  echo Chiusura del server ^(PID %%p^)...
  taskkill /f /pid %%p >nul 2>&1
)
echo Server chiuso. A presto!
endlocal