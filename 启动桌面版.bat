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
echo 正在启动复习资料图书馆（桌面版，完全离线）...
echo 数据目录： %~dp0dist\win-unpacked\library\
start "" "dist\win-unpacked\ReviewLibrary.exe"
