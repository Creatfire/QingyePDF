!include "common.nsh"
!include "extractAppPackage.nsh"

# https://github.com/electron-userland/electron-builder/issues/3972#issuecomment-505171582
CRCCheck off
WindowIcon Off
AutoCloseWindow True
RequestExecutionLevel ${REQUEST_EXECUTION_LEVEL}

Function .onInit
  !ifndef SPLASH_IMAGE
    SetSilent silent
  !endif

  !insertmacro check64BitAndSetRegView
FunctionEnd

Function .onGUIInit
  InitPluginsDir

  !ifdef SPLASH_IMAGE
    File /oname=$PLUGINSDIR\splash.bmp "${SPLASH_IMAGE}"
    BgImage::SetBg $PLUGINSDIR\splash.bmp
    BgImage::Redraw
  !endif
FunctionEnd

Section
  !ifdef SPLASH_IMAGE
    HideWindow
  !endif

  ; Cache is per user, architecture and exact package hash. No elevated execution.
  SetShellVarContext current
  StrCpy $R1 "${APP_64_HASH}" 16
  StrCpy $INSTDIR "$LOCALAPPDATA\QingyePDF\runtime\${VERSION}-x64-$R1"
  System::Call 'kernel32::CreateMutex(p 0, i 0, t "Local\QingyePDF-$R1") p.r2'
  System::Call 'kernel32::WaitForSingleObject(p r2, i 60000) i.r3'
  ${If} $3 != 0
  ${AndIf} $3 != 128
    MessageBox MB_OK "Qingye PDF is preparing its runtime. Please try again."
    SetErrorLevel 1
    Quit
  ${EndIf}
  IfFileExists "$INSTDIR\.ready" 0 extract_runtime
  IfFileExists "$INSTDIR\${APP_EXECUTABLE_FILENAME}" 0 extract_runtime
  IfFileExists "$INSTDIR\resources\app.asar" 0 extract_runtime
  IfFileExists "$INSTDIR\resources\backend\QingyeWorker.exe" 0 extract_runtime
  IfFileExists "$INSTDIR\resources\pandoc\pandoc.exe" runtime_ready extract_runtime
  extract_runtime:
  SetOutPath $INSTDIR

  !ifdef APP_DIR_64
    !ifdef APP_DIR_ARM64
      !ifdef APP_DIR_32
        ${if} ${IsNativeARM64}
          File /r "${APP_DIR_ARM64}\*.*"
        ${elseif} ${RunningX64}
          File /r "${APP_DIR_64}\*.*"
        ${else}
          File /r "${APP_DIR_32}\*.*"
        ${endIf}
      !else
        ${if} ${IsNativeARM64}
          File /r "${APP_DIR_ARM64}\*.*"
        ${else}
          File /r "${APP_DIR_64}\*.*"
        {endIf}
      !endif
    !else
      !ifdef APP_DIR_32
        ${if} ${RunningX64}
          File /r "${APP_DIR_64}\*.*"
        ${else}
          File /r "${APP_DIR_32}\*.*"
        ${endIf}
      !else
        File /r "${APP_DIR_64}\*.*"
      !endif
    !endif
  !else
    !ifdef APP_DIR_32
      File /r "${APP_DIR_32}\*.*"
    !else
      !insertmacro extractEmbeddedAppPackage
    !endif
  !endif

  FileOpen $4 "$INSTDIR\.ready" w
  FileWrite $4 "${APP_64_HASH}"
  FileClose $4
  runtime_ready:
  System::Call 'kernel32::ReleaseMutex(p r2)'
  System::Call 'kernel32::CloseHandle(p r2)'
  SetOutPath $EXEDIR
  System::Call 'Kernel32::SetEnvironmentVariable(t, t)i ("PORTABLE_EXECUTABLE_DIR", "$EXEDIR").r0' 
  System::Call 'Kernel32::SetEnvironmentVariable(t, t)i ("PORTABLE_EXECUTABLE_FILE", "$EXEPATH").r0'
  System::Call 'Kernel32::SetEnvironmentVariable(t, t)i ("PORTABLE_EXECUTABLE_APP_FILENAME", "${APP_FILENAME}").r0'
  ${StdUtils.GetAllParameters} $R0 0

  !ifdef SPLASH_IMAGE
    BgImage::Destroy
  !endif

	ExecWait "$INSTDIR\${APP_EXECUTABLE_FILENAME} $R0" $0
  SetErrorLevel $0

  SetOutPath $EXEDIR
	; Runtime is retained for subsequent launches.
SectionEnd
