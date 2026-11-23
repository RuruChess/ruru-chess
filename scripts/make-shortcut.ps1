# Δημιουργεί (ή ανανεώνει) τη συντόμευση «Ruru Chess» στην επιφάνεια εργασίας, με το εικονίδιο του έργου (Ruru.ico).
# Τα Windows (και η αναζήτησή τους) κρατούν τα εικονίδια ανά διαδρομή αρχείου: η συντόμευση δείχνει σε αντίγραφο του
# εικονιδίου με το hash του στο όνομα (.shortcut\Ruru-<hash>.ico), ώστε ένα νέο εικονίδιο να φαίνεται αμέσως.
# Χρήση: powershell -ExecutionPolicy Bypass -File scripts\make-shortcut.ps1
$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
$ico = Join-Path $root 'Ruru.ico'
if (-not (Test-Path -LiteralPath $ico)) { throw "Λείπει το εικονίδιο $ico" }

$hash = (Get-FileHash -LiteralPath $ico -Algorithm SHA256).Hash.Substring(0, 8).ToLower()
$dir = Join-Path $root '.shortcut'
New-Item -ItemType Directory -Force -Path $dir | Out-Null
$copy = Join-Path $dir "Ruru-$hash.ico"
if (-not (Test-Path -LiteralPath $copy)) { Copy-Item -LiteralPath $ico -Destination $copy }
# τα αντίγραφα παλιών εικονιδίων δεν χρειάζονται πια
Get-ChildItem -LiteralPath $dir -Filter '*.ico' | Where-Object { $_.FullName -ne $copy } | Remove-Item -Force

$desktop = [Environment]::GetFolderPath('Desktop')
$lnk = Join-Path $desktop 'Ruru Chess.lnk'
# παλιές συντομεύσεις (SkakiBase) που δείχνουν σε αρχείο που δεν υπάρχει πια
$old = Join-Path $desktop 'SkakiBase.lnk'
if (Test-Path -LiteralPath $old) { Remove-Item -LiteralPath $old -Force }
$shell = New-Object -ComObject WScript.Shell
$s = $shell.CreateShortcut($lnk)
$s.TargetPath = Join-Path $env:WINDIR 'System32\wscript.exe'
$s.Arguments = '"' + (Join-Path $root 'Ruru.vbs') + '"'
$s.WorkingDirectory = $root
$s.IconLocation = "$copy,0"
$s.Description = 'Ruru Chess — βάση δεδομένων και ανάλυση σκακιού'
$s.Save()

# τα εικονίδια του Explorer και της αναζήτησης ξαναδιαβάζονται
try { Start-Process -FilePath (Join-Path $env:WINDIR 'System32\ie4uinit.exe') -ArgumentList '-show' -Wait -WindowStyle Hidden } catch { }
Write-Output "Συντόμευση: $lnk (εικονίδιο $copy)"
