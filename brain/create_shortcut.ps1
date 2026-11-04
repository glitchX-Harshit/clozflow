$WshShell = New-Object -comObject WScript.Shell
$DesktopPath = [Environment]::GetFolderPath("Desktop")
$Shortcut = $WshShell.CreateShortcut("$DesktopPath\Clozflow Brain.lnk")
$Shortcut.TargetPath = "pythonw.exe"
$BrainRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
$Shortcut.Arguments = "`"$(Join-Path $BrainRoot 'start_clozflow_gui.py')`""
$Shortcut.WorkingDirectory = $BrainRoot
$Shortcut.Description = "Start Clozflow Enterprise Brain"
$Shortcut.IconLocation = "python.exe"
$Shortcut.Save()
