; Ruru Chess — εγκαταστάτης για Windows (Inno Setup 6.5+).
; Χτίζεται από το scripts/make-release.mjs: ένας εγκαταστάτης, με το Stockfish ως επιλογή του οδηγού.
;   ISCC /DAppVersion=3.0.0 /DStageDir=release\ruru\Ruru /DOutputDir=release\ruru installer\Ruru.iss
;   → Ruru-Chess-Setup.exe
; Το AppId είναι του KnightBase: όποιος το είχε αναβαθμίζεται στον ίδιο φάκελο και οι βάσεις του μένουν όπως είναι.
; Εγκατάσταση χωρίς δικαιώματα διαχειριστή (%LOCALAPPDATA%\Programs\Ruru Chess) ή, αν το διαλέξει ο
; χρήστης, για όλους. Οι επιλογές «πρώτης εκκίνησης» και η γλώσσα γράφονται στο preset.json, που
; διαβάζει ο server (src/server/paths.ts → readPreset). Το αρχείο είναι UTF-8 με BOM (ελληνικά).

#ifndef AppVersion
  #define AppVersion "0.0.0"
#endif
; (αριθμητική έκδοση για τα στοιχεία του αρχείου: «1.1.0» όταν η AppVersion είναι «1.1.0 BETA»)
#ifndef AppNumVersion
  #define AppNumVersion "0.0.0"
#endif
#ifndef StageDir
  #define StageDir "..\release\ruru\Ruru"
#endif
#ifndef OutputDir
  #define OutputDir "..\release\ruru"
#endif

[Setup]
AppId={{7B7FB69F-78B2-433D-B9F8-E473B110255B}
AppName=Ruru Chess
AppVersion={#AppVersion}
AppPublisher=Ruru Chess
#ifdef AppURL
AppPublisherURL={#AppURL}
AppSupportURL={#AppURL}
AppUpdatesURL={#AppURL}
#endif
VersionInfoVersion={#AppNumVersion}
VersionInfoProductName=Ruru Chess
VersionInfoDescription=Ruru Chess Setup
DefaultDirName={autopf}\Ruru Chess
DisableProgramGroupPage=yes
PrivilegesRequired=lowest
PrivilegesRequiredOverridesAllowed=dialog
ArchitecturesAllowed=x64compatible
ArchitecturesInstallIn64BitMode=x64compatible
MinVersion=10.0
OutputDir={#OutputDir}
OutputBaseFilename=Ruru-Chess-Setup
SetupIconFile=..\Ruru.ico
UninstallDisplayIcon={app}\Ruru.exe
UninstallDisplayName=Ruru Chess
Compression=lzma2/ultra64
SolidCompression=yes
WizardStyle=modern
ShowLanguageDialog=auto
CloseApplications=yes
RestartApplications=no

[Languages]
Name: "en"; MessagesFile: "compiler:Default.isl"
Name: "el"; MessagesFile: "compiler:Default.isl,Greek.isl"

[CustomMessages]
en.GroupEngine=Analysis engine, downloaded on first start:
el.GroupEngine=Μηχανή ανάλυσης, λήψη στην πρώτη εκκίνηση:
en.TaskStockfish=Stockfish (~80 MB, GPLv3)
el.TaskStockfish=Stockfish (~80 MB, GPLv3)

[Tasks]
Name: "stockfish"; Description: "{cm:TaskStockfish}"; GroupDescription: "{cm:GroupEngine}"
Name: "desktopicon"; Description: "{cm:CreateDesktopIcon}"; GroupDescription: "{cm:AdditionalIcons}"

[InstallDelete]
; ο κώδικας της προηγούμενης έκδοσης φεύγει ολόκληρος (όχι ξεχασμένα αρχεία)
Type: filesandordirs; Name: "{app}\src"
Type: filesandordirs; Name: "{app}\dist"
Type: filesandordirs; Name: "{app}\public"
Type: filesandordirs; Name: "{app}\node_modules"
Type: filesandordirs; Name: "{app}\electron"
Type: filesandordirs; Name: "{app}\resources"
Type: filesandordirs; Name: "{app}\locales"
Type: files; Name: "{app}\preset.json"
Type: filesandordirs; Name: "{app}\reference"
; η ίδια εφαρμογή με το παλιό όνομα: φεύγουν το exe και οι συντομεύσεις της (όχι οι βάσεις)
Type: files; Name: "{app}\KnightBase.exe"
Type: files; Name: "{autoprograms}\KnightBase.lnk"
Type: files; Name: "{autodesktop}\KnightBase.lnk"

[Files]
Source: "{#StageDir}\*"; DestDir: "{app}"; Flags: ignoreversion recursesubdirs createallsubdirs

[Icons]
Name: "{autoprograms}\Ruru Chess"; Filename: "{app}\Ruru.exe"; AppUserModelID: "com.ruruchess.ruru"
Name: "{autodesktop}\Ruru Chess"; Filename: "{app}\Ruru.exe"; AppUserModelID: "com.ruruchess.ruru"; Tasks: desktopicon

[Run]
Filename: "{app}\Ruru.exe"; Description: "{cm:LaunchProgram,Ruru Chess}"; Flags: nowait postinstall skipifsilent

[UninstallDelete]
; οι βάσεις και οι ρυθμίσεις (Έγγραφα\Ruru ή Έγγραφα\KnightBase) μένουν
Type: files; Name: "{app}\preset.json"

[Code]
// Επιλογές της πρώτης εκκίνησης για τον server: γλώσσα και μηχανή
procedure WritePreset;
var
  Json: String;
begin
  Json := '"language": "' + ActiveLanguage + '"';
  if WizardIsTaskSelected('stockfish') then
    Json := Json + ', "engine": "stockfish"';
  SaveStringToFile(ExpandConstant('{app}\preset.json'), '{' + Json + '}' + #13#10, False);
end;

procedure CurStepChanged(CurStep: TSetupStep);
begin
  if CurStep = ssPostInstall then
    WritePreset;
end;

// Η εφαρμογή μπορεί να τρέχει (Ruru.exe / παλιό RuruChess.exe / electron.exe / node.exe του φακέλου της): κλείνουν πριν την απεγκατάσταση
function InitializeUninstall: Boolean;
var
  ResultCode: Integer;
begin
  Exec('powershell.exe', '-NoProfile -NonInteractive -Command "Get-Process Ruru,RuruChess,electron,node -ErrorAction SilentlyContinue | Where-Object { $_.Path -eq ''' +
    ExpandConstant('{app}\Ruru.exe') + ''' -or $_.Path -eq ''' +
    ExpandConstant('{app}\electron\runtime\RuruChess.exe') + ''' -or $_.Path -eq ''' +
    ExpandConstant('{app}\electron\runtime\electron.exe') + ''' -or $_.Path -eq ''' +
    ExpandConstant('{app}\node\node.exe') + ''' } | Stop-Process -Force"', '', SW_HIDE, ewWaitUntilTerminated, ResultCode);
  Result := True;
end;

// Μετά: σβήνει τα προφίλ της εφαρμογής (%LOCALAPPDATA%\Ruru\electron και τυχόν παλιό browser),
// εκτός αν τα χρησιμοποιεί ακόμη άλλο αντίγραφο (π.χ. φορητό)
procedure CurUninstallStepChanged(CurUninstallStep: TUninstallStep);
var
  ResultCode: Integer;
begin
  if CurUninstallStep = usPostUninstall then
    Exec('powershell.exe', '-NoProfile -NonInteractive -Command "foreach ($n in ''Ruru'',''KnightBase'') { $d = Join-Path $env:LOCALAPPDATA $n; ' +
      '$b = Join-Path $d ''browser''; if ((Test-Path -LiteralPath $b) -and -not (Get-CimInstance Win32_Process | Where-Object { $_.Name -eq ''msedge.exe'' -and $_.CommandLine -like (''*'' + $b + ''*'') })) { Remove-Item -LiteralPath $b -Recurse -Force -ErrorAction SilentlyContinue }; ' +
      '$e = Join-Path $d ''electron''; if ((Test-Path -LiteralPath $e) -and -not (Get-CimInstance Win32_Process | Where-Object { $_.Name -eq ''Ruru.exe'' -or (($_.Name -eq ''RuruChess.exe'' -or $_.Name -eq ''electron.exe'') -and $_.CommandLine -like ''*electron*main.cjs*'') })) { Remove-Item -LiteralPath $e -Recurse -Force -ErrorAction SilentlyContinue }; ' +
      'if ((Test-Path -LiteralPath $d) -and -not (Get-ChildItem -LiteralPath $d -Force -ErrorAction SilentlyContinue)) { Remove-Item -LiteralPath $d -Force -ErrorAction SilentlyContinue } }"',
      '', SW_HIDE, ewWaitUntilTerminated, ResultCode);
end;
