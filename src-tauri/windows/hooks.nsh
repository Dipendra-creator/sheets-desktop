; Installer hooks: Docs gets its own Start menu entry (the same program,
; started with --docs) and Word documents show the Docs icon.

!macro NSIS_HOOK_POSTINSTALL
  CreateShortcut "$SMPROGRAMS\Docs.lnk" "$INSTDIR\${MAINBINARYNAME}.exe" "--docs" "$INSTDIR\docs.ico" 0 SW_SHOWNORMAL "" "Write and edit Word documents"
  WriteRegStr SHCTX "Software\Classes\Word Document\DefaultIcon" "" "$INSTDIR\docs.ico,0"
!macroend

!macro NSIS_HOOK_POSTUNINSTALL
  Delete "$SMPROGRAMS\Docs.lnk"
  DeleteRegKey SHCTX "Software\Classes\Word Document\DefaultIcon"
!macroend
