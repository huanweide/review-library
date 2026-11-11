@echo off
chcp 65001 >nul
cd /d "%~dp0"
rem 清掉沙箱可能注入的变量，避免 Electron 被当成纯 Node 运行
set "ELECTRON_RUN_AS_NODE="
set "NODE_OPTIONS="
if not exist "dist\win-unpacked\ReviewLibrary.exe" (
  echo 未找到桌面版程序。请先执行： npm install ^&^& npm run build:dir
  pause
  exit /b 1
)
rem 版本核对（2026-11-11）：dist 是构建产物，可能停在旧版本。
rem 以前只判 exe 存在就静默启动，用户会以为打开的是最新代码（实测曾静默打开 0.7.0）。
set "WANT="
if exist "VERSION" for /f "usebackq delims=" %%v in ("VERSION") do if not defined WANT set "WANT=%%v"
set "GOT="
if exist "dist\latest.yml" for /f "tokens=2" %%v in ('findstr /b /c:"version:" "dist\latest.yml"') do if not defined GOT set "GOT=%%v"
if defined WANT if defined GOT if not "%GOT%"=="%WANT%" (
  echo.
  echo   [警告] 安装包版本与源码不一致
  echo   源码版本： %WANT%      当前安装包： %GOT%
  echo   你打开的将是旧版，可能看不到「练习」等新功能。
  echo   如需重建，请在项目目录执行： npm install ^&^& npm run build:dir
  echo.
)
if not defined GOT echo   [提示] 未找到 dist\latest.yml，无法核对安装包版本。

echo 正在启动复习资料图书馆（桌面版，完全离线）...
echo 数据目录： %~dp0dist\win-unpacked\library\
start "" "dist\win-unpacked\ReviewLibrary.exe"
