' Shortcut "KnightBase (new code)": runs scripts\open-dev.mjs without a console window.
' On error it opens the log (%TEMP%\knightbase-dev.log). ASCII only: wscript reads .vbs as ANSI.
Set sh = CreateObject("WScript.Shell")
Set fso = CreateObject("Scripting.FileSystemObject")
sh.CurrentDirectory = fso.GetParentFolderName(fso.GetParentFolderName(WScript.ScriptFullName))
If sh.Run("node scripts\open-dev.mjs", 0, True) <> 0 Then
  sh.Run "notepad """ & sh.ExpandEnvironmentStrings("%TEMP%") & "\knightbase-dev.log"""
End If
