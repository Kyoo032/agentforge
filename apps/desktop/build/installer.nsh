; Kill the running app (and its Chromium helpers) so setup can overwrite files.
; /T ends the process tree. Do not taskkill node.exe by name — that hits Cursor/dev.
; Old pre-IPC installs left a bundled node.exe under resources\web — kill only that path.
; Legacy exe names: the product was DPSBuddy until the Nultron rename (same appId, so Nultron installs
; over it as an upgrade) and Agentforge before that. An old copy still running would lock its files.
!macro killRunningApp
  nsExec::Exec 'taskkill /F /IM "${APP_EXECUTABLE_FILENAME}" /T'
  nsExec::Exec 'taskkill /F /IM DPSBuddy.exe /T'
  nsExec::Exec 'taskkill /F /IM Agentforge.exe /T'
  nsExec::Exec 'taskkill /F /IM "Kemenkeu AI.exe" /T'
  nsExec::Exec 'taskkill /F /IM "AIHub Metranet.exe" /T'
  ${If} ${FileExists} "$INSTDIR\resources\web\node.exe"
    nsExec::Exec 'powershell.exe -NoProfile -WindowStyle Hidden -Command "Get-CimInstance Win32_Process | Where-Object { $$_.ExecutablePath -eq [IO.Path]::GetFullPath(''$INSTDIR\resources\web\node.exe'') } | ForEach-Object { Stop-Process -Id $$_.ProcessId -Force -ErrorAction SilentlyContinue }"'
  ${EndIf}
  Sleep 800
!macroend

!macro customCheckAppRunning
  !insertmacro killRunningApp
!macroend

!macro customInit
  !insertmacro killRunningApp
!macroend

; Upgrade must replace binaries only. Wipe desk data only on a real uninstall.
; The DPSBuddy and Agentforge names below are legacy desks and keychain entries from before the Nultron
; rename. Nultron never migrated DPSBuddy data, so an upgrade leaves that folder behind; a real uninstall
; is the one place it is cleaned up, next to the current desk.
!macro customUnInstall
  !insertmacro killRunningApp
  ${ifNot} ${isUpdated}
    RMDir /r "$APPDATA\${PRODUCT_NAME}"
    RMDir /r "$APPDATA\DPSBuddy"
    RMDir /r "$APPDATA\Agentforge"
    RMDir /r "$APPDATA\@agentforge"
    nsExec::Exec 'cmdkey /delete:${PRODUCT_NAME}/wrap-key'
    nsExec::Exec 'cmdkey /delete:DPSBuddy/wrap-key'
    nsExec::Exec 'cmdkey /delete:Agentforge/wrap-key'
  ${endIf}
!macroend
