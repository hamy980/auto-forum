@echo off
chcp 65001 >nul
setlocal

:menu
cls
echo ============================================
echo   GPM Forum PM Pipeline - Quick Runner
echo ============================================
echo.
echo   1. Khoi dong browser service
echo   2. Wizard chay campaign (run-quick.js)
echo   3. Chay campaign co san (runner.js)
echo   4. Thu thap inbox (reply-harvest.js)
echo   5. AI reply (ai-reply.js)
echo   6. Send reply (reply-send.js)
echo   7. Reply polling loop (runner-reply.js)
echo   8. Follow-up check (followup-check.js)
echo   9. Liet ke GPM profiles (gpm:list)
echo   10. Xem ket qua campaign (check-results.js)
echo   11. Watch campaign realtime (watch-campaign.js)
echo.
echo   0. Thoat
echo.
set /p choice="Chon lenh (0-10): "

if "%choice%"=="1" goto cmd_browser
if "%choice%"=="2" goto cmd_wizard
if "%choice%"=="3" goto cmd_runner
if "%choice%"=="4" goto cmd_harvest
if "%choice%"=="5" goto cmd_ai
if "%choice%"=="6" goto cmd_send
if "%choice%"=="7" goto cmd_reply
if "%choice%"=="8" goto cmd_followup
if "%choice%"=="9" goto cmd_gpm
if "%choice%"=="10" goto cmd_results
if "%choice%"=="11" goto cmd_watch
if "%choice%"=="0" exit /b
echo Lua chon khong hop le.
pause
goto menu

:cmd_browser
echo.
echo [1] Dang khoi dong browser service...
call npm run browser:start
pause
goto menu

:cmd_wizard
echo.
echo [2] Wizard campaign (se hoi: 1) domain  2) members  3) content  4) profiles)
echo.
node scripts/run-quick.js
pause
goto menu

:cmd_runner
echo.
set /p campaign="Nhap campaign ID (vd: massagevua-greet): "
set /p profile="Profile IDs (Enter = dung tat ca trong campaign): "
set /p resumeopt="Resume? (y/n, mac dinh n): "
if "%profile%"=="" (
  if /i "%resumeopt%"=="y" (
    node scripts/runner.js --campaign %campaign% --resume
  ) else (
    node scripts/runner.js --campaign %campaign%
  )
) else (
  if /i "%resumeopt%"=="y" (
    node scripts/runner.js --campaign %campaign% --profiles %profile% --resume
  ) else (
    node scripts/runner.js --campaign %campaign% --profiles %profile%
  )
)
pause
goto menu

:cmd_harvest
echo.
set /p forum="Forum ID: "
set /p profile="Profile ID: "
node scripts/reply-harvest.js --forum %forum% --profile %profile%
pause
goto menu

:cmd_ai
echo.
set /p forum="Forum ID: "
set /p dryrun="Dry-run? (y/n, mac dinh n): "
if /i "%dryrun%"=="y" (
  node scripts/ai-reply.js --forum %forum% --dry-run
) else (
  node scripts/ai-reply.js --forum %forum%
)
pause
goto menu

:cmd_send
echo.
set /p forum="Forum ID: "
set /p profile="Profile ID: "
set /p url="Conversation URL: "
set /p content="Reply content: "
node scripts/reply-send.js --forum %forum% --profile %profile% --url %url% --content "%content%"
pause
goto menu

:cmd_reply
echo.
set /p forum="Forum ID: "
set /p profile="Profile ID: "
set /p max="Max replies (mac dinh 10): "
set /p ai="Dung AI? (y/n, mac dinh n): "
if "%max%"=="" set max=10
if /i "%ai%"=="y" (
  node scripts/runner-reply.js --forum %forum% --profile %profile% --max-replies %max% --ai
) else (
  node scripts/runner-reply.js --forum %forum% --profile %profile% --max-replies %max%
)
pause
goto menu

:cmd_followup
echo.
set /p forum="Forum ID: "
set /p profile="Profile ID: "
set /p campaign="Campaign ID (Enter = skip): "
set /p dryrun="Dry-run? (y/n, mac dinh n): "
if /i "%dryrun%"=="y" (
  if "%campaign%"=="" (
    node scripts/followup-check.js --forum %forum% --profile %profile% --dry-run
  ) else (
    node scripts/followup-check.js --forum %forum% --profile %profile% --campaign %campaign% --dry-run
  )
) else (
  if "%campaign%"=="" (
    node scripts/followup-check.js --forum %forum% --profile %profile%
  ) else (
    node scripts/followup-check.js --forum %forum% --profile %profile% --campaign %campaign%
  )
)
pause
goto menu

:cmd_gpm
echo.
call npm run gpm:list -- --profiles
pause
goto menu

:cmd_results
echo.
set /p campaign="Campaign ID: "
node scripts/check-results.js --campaign %campaign%
pause
goto menu

:cmd_watch
echo.
set /p campaign="Campaign ID de watch: "
set /p interval="Interval giay (mac dinh 3): "
if "%interval%"=="" set interval=3
echo Watching... (Ctrl+C de thoat)
echo.
node scripts/watch-campaign.js %campaign% %interval%
goto menu
