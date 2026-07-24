Unicode True
SetCompressor /SOLID lzma
SetCompressorDictSize 64

!include "MUI2.nsh"

!ifndef VERSION
  !error "VERSION must be supplied with /DVERSION=x.y.z"
!endif
!ifndef STAGE_DIR
  !error "STAGE_DIR must be supplied"
!endif
!ifndef OUTPUT_DIR
  !error "OUTPUT_DIR must be supplied"
!endif

!define APP_NAME "Badge Blur"
!define APP_KEY "Software\Badge Blur"
!define UNINSTALL_KEY \
  "Software\Microsoft\Windows\CurrentVersion\Uninstall\Badge Blur"
!define INSTALLER_FILE \
  "${OUTPUT_DIR}\Badge-Blur-Windows-x64-Setup-v${VERSION}.exe"

Name "${APP_NAME}"
OutFile "${INSTALLER_FILE}"
InstallDir "$LOCALAPPDATA\Programs\Badge Blur"
InstallDirRegKey HKCU "${APP_KEY}" "InstallDir"
RequestExecutionLevel user
BrandingText "Badge Blur local-only installer"
ShowInstDetails show
ShowUninstDetails show

!define MUI_ABORTWARNING
!define MUI_ICON "${STAGE_DIR}\BadgeBlur.ico"
!define MUI_UNICON "${STAGE_DIR}\BadgeBlur.ico"
!define MUI_FINISHPAGE_RUN "$INSTDIR\Badge Blur.exe"
!define MUI_FINISHPAGE_RUN_TEXT "Launch Badge Blur"

!insertmacro MUI_PAGE_WELCOME
!insertmacro MUI_PAGE_DIRECTORY
!insertmacro MUI_PAGE_COMPONENTS
!insertmacro MUI_PAGE_INSTFILES
!insertmacro MUI_PAGE_FINISH

!insertmacro MUI_UNPAGE_WELCOME
!insertmacro MUI_UNPAGE_CONFIRM
!insertmacro MUI_UNPAGE_INSTFILES
!insertmacro MUI_UNPAGE_FINISH

!insertmacro MUI_LANGUAGE "English"

Section "Badge Blur application" CoreSection
  SectionIn RO
  SetShellVarContext current
  SetOutPath "$INSTDIR"
  File /r "${STAGE_DIR}\*"

  WriteUninstaller "$INSTDIR\Uninstall Badge Blur.exe"
  WriteRegStr HKCU "${APP_KEY}" "InstallDir" "$INSTDIR"

  WriteRegStr HKCU "${UNINSTALL_KEY}" "DisplayName" "Badge Blur"
  WriteRegStr HKCU "${UNINSTALL_KEY}" "DisplayVersion" "${VERSION}"
  WriteRegStr HKCU "${UNINSTALL_KEY}" \
    "DisplayIcon" "$INSTDIR\Badge Blur.exe"
  WriteRegStr HKCU "${UNINSTALL_KEY}" \
    "InstallLocation" "$INSTDIR"
  WriteRegStr HKCU "${UNINSTALL_KEY}" \
    "UninstallString" '"$INSTDIR\Uninstall Badge Blur.exe"'
  WriteRegStr HKCU "${UNINSTALL_KEY}" \
    "QuietUninstallString" '"$INSTDIR\Uninstall Badge Blur.exe" /S'
  WriteRegDWORD HKCU "${UNINSTALL_KEY}" "NoModify" 1
  WriteRegDWORD HKCU "${UNINSTALL_KEY}" "NoRepair" 1

  CreateDirectory "$SMPROGRAMS\Badge Blur"
  CreateShortcut \
    "$SMPROGRAMS\Badge Blur\Badge Blur.lnk" \
    "$INSTDIR\Badge Blur.exe" \
    "" \
    "$INSTDIR\BadgeBlur.ico"
  CreateShortcut \
    "$SMPROGRAMS\Badge Blur\Uninstall Badge Blur.lnk" \
    "$INSTDIR\Uninstall Badge Blur.exe"
SectionEnd

Section "Desktop shortcut" DesktopSection
  SetShellVarContext current
  CreateShortcut \
    "$DESKTOP\Badge Blur.lnk" \
    "$INSTDIR\Badge Blur.exe" \
    "" \
    "$INSTDIR\BadgeBlur.ico"
SectionEnd

Section "Uninstall"
  SetShellVarContext current
  IfFileExists "$INSTDIR\Badge Blur.exe" 0 +3
  ExecWait '"$INSTDIR\Badge Blur.exe" --quit'
  Sleep 1200

  Delete "$DESKTOP\Badge Blur.lnk"
  Delete "$SMPROGRAMS\Badge Blur\Badge Blur.lnk"
  Delete "$SMPROGRAMS\Badge Blur\Uninstall Badge Blur.lnk"
  RMDir "$SMPROGRAMS\Badge Blur"

  DeleteRegKey HKCU "${UNINSTALL_KEY}"
  DeleteRegKey HKCU "${APP_KEY}"
  RMDir /r "$INSTDIR"
SectionEnd

LangString DESC_CoreSection ${LANG_ENGLISH} \
  "The private local Badge Blur application, models, and image-processing runtime."
LangString DESC_DesktopSection ${LANG_ENGLISH} \
  "Add a Badge Blur shortcut to the current user's Desktop."

!insertmacro MUI_FUNCTION_DESCRIPTION_BEGIN
  !insertmacro MUI_DESCRIPTION_TEXT ${CoreSection} $(DESC_CoreSection)
  !insertmacro MUI_DESCRIPTION_TEXT ${DesktopSection} $(DESC_DesktopSection)
!insertmacro MUI_FUNCTION_DESCRIPTION_END
