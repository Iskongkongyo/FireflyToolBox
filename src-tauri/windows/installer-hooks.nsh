; Keep the old namespace only as a migration/shortcut-icon backup. Both data
; namespaces are removed only when the user explicitly selects data deletion.
; The override is used by isolated installer tests, never by release builds.
!ifndef FIREFLY_LEGACY_DATA_DIRECTORY
  !define FIREFLY_LEGACY_DATA_DIRECTORY "com.fireflytoolbox.toolbox"
!endif

!macro NSIS_HOOK_POSTINSTALL
  ; Refresh the application ID of existing main shortcuts after the Windows
  ; data namespace changes. Only update shortcuts targeting this installation.
  !insertmacro IsShortcutTarget "$DESKTOP\${PRODUCTNAME}.lnk" "$INSTDIR\${MAINBINARYNAME}.exe"
  Pop $0
  ${If} $0 = 1
    !insertmacro SetLnkAppUserModelId "$DESKTOP\${PRODUCTNAME}.lnk"
  ${EndIf}
  !insertmacro IsShortcutTarget "$SMPROGRAMS\$AppStartMenuFolder\${PRODUCTNAME}.lnk" "$INSTDIR\${MAINBINARYNAME}.exe"
  Pop $0
  ${If} $0 = 1
    !insertmacro SetLnkAppUserModelId "$SMPROGRAMS\$AppStartMenuFolder\${PRODUCTNAME}.lnk"
  ${EndIf}
!macroend

!macro NSIS_HOOK_POSTUNINSTALL
  ${If} $DeleteAppDataCheckboxState = 1
  ${AndIf} $UpdateMode <> 1
    SetShellVarContext current
    RmDir /r "$APPDATA\${FIREFLY_LEGACY_DATA_DIRECTORY}"
    RmDir /r "$LOCALAPPDATA\${FIREFLY_LEGACY_DATA_DIRECTORY}"
  ${EndIf}
!macroend
