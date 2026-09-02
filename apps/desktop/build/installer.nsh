; Kill leftover Agentforge.exe (and any old bundled node.exe tree from pre-IPC installs).
!macro customCheckAppRunning
  nsExec::Exec 'taskkill /F /IM Agentforge.exe /T'
!macroend

; Wipe local data + Credential Manager wrap key so a reinstall shows onboarding again.
!macro customUnInstall
  nsExec::Exec 'taskkill /F /IM Agentforge.exe /T'
  RMDir /r "$APPDATA\Agentforge"
  RMDir /r "$APPDATA\@agentforge"
  nsExec::Exec 'cmdkey /delete:Agentforge/wrap-key'
!macroend
