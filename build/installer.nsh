; QingyePDF installer additions (electron-builder NSIS include, UTF-8 with BOM).
;  - "附加选项" page: desktop shortcut, and which file types list QingyePDF under "Open with".
;    Registration runs the installed app with --register-file-types (file-associations.cjs), the
;    same per-user entries as Settings → 文件关联. Windows keeps the final choice of default app.
;  - Silent updates keep the existing choices (--refresh-file-types); updating from 0.18 or older,
;    whose installer always associated PDF and Markdown, keeps those two.
;  - Uninstall removes the entries and asks whether to delete user data (default: keep it).

!ifndef BUILD_UNINSTALLER
  !include nsDialogs.nsh
  !include LogicLib.nsh

  Var qyDesktop
  Var qyPdf
  Var qyMd
  Var qyOffice
  Var qyBoxDesktop
  Var qyBoxPdf
  Var qyBoxMd
  Var qyBoxOffice

  Function qyOptionsPage
    ${if} ${isUpdated}
      Abort
    ${endif}
    !insertmacro MUI_HEADER_TEXT "附加选项" "选择是否创建桌面快捷方式，以及要用青页打开的文件类型。"
    nsDialogs::Create 1018
    Pop $0
    ${if} $0 == error
      Abort
    ${endif}
    ${NSD_CreateCheckbox} 0 0 100% 12u "创建桌面快捷方式"
    Pop $qyBoxDesktop
    ${NSD_SetState} $qyBoxDesktop $qyDesktop
    ${NSD_CreateLabel} 0 24u 100% 22u "把青页加入以下文件的“打开方式”。默认应用仍由 Windows 决定，安装后可在 设置 → 文件关联 中随时更改。"
    Pop $0
    ${NSD_CreateCheckbox} 8u 50u 100% 12u "PDF 文档（.pdf）"
    Pop $qyBoxPdf
    ${NSD_SetState} $qyBoxPdf $qyPdf
    ${NSD_CreateCheckbox} 8u 66u 100% 12u "Markdown 文档（.md、.markdown）"
    Pop $qyBoxMd
    ${NSD_SetState} $qyBoxMd $qyMd
    ${NSD_CreateCheckbox} 8u 82u 100% 12u "Office 文档，以 PDF 方式打开（.docx、.xlsx、.pptx 等，原文件不会被修改）"
    Pop $qyBoxOffice
    ${NSD_SetState} $qyBoxOffice $qyOffice
    nsDialogs::Show
  FunctionEnd

  Function qyOptionsLeave
    ${NSD_GetState} $qyBoxDesktop $qyDesktop
    ${NSD_GetState} $qyBoxPdf $qyPdf
    ${NSD_GetState} $qyBoxMd $qyMd
    ${NSD_GetState} $qyBoxOffice $qyOffice
  FunctionEnd
!endif

!macro customInit
  ; Defaults, also used by silent installs (/S) where the page is not shown.
  StrCpy $qyDesktop ${BST_CHECKED}
  StrCpy $qyPdf ${BST_CHECKED}
  StrCpy $qyMd ${BST_CHECKED}
  StrCpy $qyOffice ${BST_UNCHECKED}
!macroend

!macro customPageAfterChangeDir
  Page custom qyOptionsPage qyOptionsLeave
!macroend

!macro customInstall
  ${ifNot} ${isUpdated}
    ${if} $qyDesktop != ${BST_CHECKED}
      WinShell::UninstShortcut "$newDesktopLink"
      Delete "$newDesktopLink"
    ${endif}
    StrCpy $0 ""
    ${if} $qyPdf == ${BST_CHECKED}
      StrCpy $0 "$0,pdf"
    ${endif}
    ${if} $qyMd == ${BST_CHECKED}
      StrCpy $0 "$0,md"
    ${endif}
    ${if} $qyOffice == ${BST_CHECKED}
      StrCpy $0 "$0,office"
    ${endif}
    ${if} $0 != ""
      StrCpy $0 $0 "" 1
      nsExec::Exec '"$appExe" --register-file-types=$0'
      Pop $1
    ${endif}
  ${else}
    ReadRegStr $1 HKCU "Software\QingyePDF\Installer" "Version"
    ${if} $1 == ""
      nsExec::Exec '"$appExe" --register-file-types=pdf,md'
    ${else}
      nsExec::Exec '"$appExe" --refresh-file-types'
    ${endif}
    Pop $1
  ${endif}
  WriteRegStr HKCU "Software\QingyePDF\Installer" "Version" "${VERSION}"
!macroend

!macro customUnInstall
  ${ifNot} ${isUpdated}
    nsExec::Exec '"$INSTDIR\${APP_EXECUTABLE_FILENAME}" --unregister-file-types'
    Pop $0
    DeleteRegKey HKCU "Software\QingyePDF\Installer"
    ${ifNot} ${Silent}
      MessageBox MB_YESNO|MB_ICONQUESTION|MB_DEFBUTTON2 "是否同时删除青页的用户数据？$\r$\n$\r$\n包括设置、最近打开列表、阅读位置、草稿和 Markdown 版本历史。$\r$\n选择“否”会保留这些数据，重新安装后可以继续使用。" IDNO qyKeepUserData
        SetShellVarContext current
        RMDir /r "$APPDATA\${APP_FILENAME}"
        !ifdef APP_PRODUCT_FILENAME
          RMDir /r "$APPDATA\${APP_PRODUCT_FILENAME}"
        !endif
        !ifdef APP_PACKAGE_NAME
          RMDir /r "$APPDATA\${APP_PACKAGE_NAME}"
        !endif
      qyKeepUserData:
    ${endif}
  ${endif}
!macroend
