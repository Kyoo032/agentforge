; Kill the running app (and its Chromium helpers) so setup can overwrite files.
; /T ends the process tree. Do not taskkill node.exe by name — that hits Cursor/dev.
; Old pre-IPC installs left a bundled node.exe under resources\web — kill only that path.
!macro killRunningAgentforge
  nsExec::Exec 'taskkill /F /IM "${APP_EXECUTABLE_FILENAME}" /T'
  nsExec::Exec 'taskkill /F /IM Agentforge.exe /T'
  nsExec::Exec 'taskkill /F /IM "Kemenkeu AI.exe" /T'
  nsExec::Exec 'taskkill /F /IM "AIHub Metranet.exe" /T'
  ${If} ${FileExists} "$INSTDIR\resources\web\node.exe"
    nsExec::Exec 'powershell.exe -NoProfile -WindowStyle Hidden -Command "Get-CimInstance Win32_Process | Where-Object { $$_.ExecutablePath -eq [IO.Path]::GetFullPath(''$INSTDIR\resources\web\node.exe'') } | ForEach-Object { Stop-Process -Id $$_.ProcessId -Force -ErrorAction SilentlyContinue }"'
  ${EndIf}
  Sleep 800
!macroend

!macro customCheckAppRunning
  !insertmacro killRunningAgentforge
!macroend

!macro customInit
  !insertmacro killRunningAgentforge
!macroend

; Upgrade must replace binaries only. Wipe desk data only on a real uninstall.
!macro customUnInstall
  !insertmacro killRunningAgentforge
  ${ifNot} ${isUpdated}
    RMDir /r "$APPDATA\${PRODUCT_NAME}"
    RMDir /r "$APPDATA\@agentforge"
    nsExec::Exec 'cmdkey /delete:${PRODUCT_NAME}/wrap-key'
    nsExec::Exec 'cmdkey /delete:Agentforge/wrap-key'
  ${endIf}
!macroend
