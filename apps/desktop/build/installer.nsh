; Force-kill a leftover Agentforge.exe (and its bundled node.exe tree).
; Default electron-builder "please close it manually" fails when X hides the
; window but the main process is still waiting on the Next child.
!macro customCheckAppRunning
  nsExec::Exec 'taskkill /F /IM Agentforge.exe /T'
!macroend
