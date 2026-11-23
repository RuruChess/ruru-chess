' Ruru Chess: εκκίνηση χωρίς παράθυρο κονσόλας (για τη συντόμευση στην επιφάνεια εργασίας)
Set fso = CreateObject("Scripting.FileSystemObject")
Set sh = CreateObject("WScript.Shell")
dir = fso.GetParentFolderName(WScript.ScriptFullName)
sh.CurrentDirectory = dir
' χωρίς Node.js ή χωρίς χτισμένο περιβάλλον: το Ruru.cmd δείχνει τι χρειάζεται
If sh.Run("cmd /c where node >nul 2>nul", 0, True) <> 0 Or Not fso.FileExists(dir & "\dist\web\index.html") Then
  sh.Run "cmd /c """ & dir & "\Ruru.cmd""", 1, False
Else
  sh.Run "node src\server\main.ts --open", 0, False
End If
