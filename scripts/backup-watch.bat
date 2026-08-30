@echo off
REM 행사 중 조별 산출물을 주기적으로 로컬 백업한다.
REM
REM 왜 로컬인가 — 이 저장소는 **공개**다. 시민 산출물을 GitHub Actions
REM 아티팩트로 올리면 누구나 내려받을 수 있다. 그리고 이 DB 는 PITR 이 없어
REM 한 번 지워지면 되돌릴 수단이 백업본뿐이다. 2026-08-29 행사에서 실제로
REM 데이터를 지킨 것은 CI 가 아니라 이 경로였다(서버 스냅샷은 0회였다).
REM
REM 쓰는 법
REM   1) wiki\.env.backup 을 만든다 (gitignore 됨):
REM        HQ_OPERATOR=조성훈
REM        HQ_PASSWORD=0000
REM   2) 이 파일을 더블클릭하거나, 행사 아침에 한 번 띄워 둔다.
REM   3) 5분마다 백업한다. 같은 내용이면 새 파일을 만들지 않는다(체크섬 비교).
REM
REM 산출: 10_작업산출물\2026-08-29_산출물_백업\  (OneDrive 가 오프사이트로 동기화)

setlocal
cd /d "%~dp0.."

if not exist ".env.backup" (
  echo [!] .env.backup 이 없습니다. 아래 두 줄을 담아 wiki\.env.backup 으로 저장하세요:
  echo     HQ_OPERATOR=이름
  echo     HQ_PASSWORD=비번
  pause
  exit /b 2
)
for /f "usebackq tokens=1,* delims==" %%A in (".env.backup") do set "%%A=%%B"

set "NODE_DIR=%USERPROFILE%\tools\node-v20.18.0-win-x64"
if exist "%NODE_DIR%\node.exe" set "PATH=%NODE_DIR%;%PATH%"

echo 백업 감시 시작 - 5분 간격. 중지하려면 이 창을 닫으세요.
:loop
node scripts\backup-0829.mjs
timeout /t 300 /nobreak > nul
goto loop
