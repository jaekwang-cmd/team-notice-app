; Preserve credentials from an existing installation before its resources are replaced.
; They remain in the same user's existing profile and are never uploaded.
!macro customInit
  IfFileExists "$APPDATA\스케줄 캘린더\private-config.json" ledger_config_done
  IfFileExists "$INSTDIR\resources\config\config.json" 0 ledger_config_default
  CreateDirectory "$APPDATA\스케줄 캘린더"
  CopyFiles /SILENT "$INSTDIR\resources\config\config.json" "$APPDATA\스케줄 캘린더\private-config.json"
  Goto ledger_config_done
  ledger_config_default:
  IfFileExists "$LOCALAPPDATA\Programs\team-notice-app\resources\config\config.json" 0 ledger_config_done
  CreateDirectory "$APPDATA\스케줄 캘린더"
  CopyFiles /SILENT "$LOCALAPPDATA\Programs\team-notice-app\resources\config\config.json" "$APPDATA\스케줄 캘린더\private-config.json"
  ledger_config_done:
!macroend
