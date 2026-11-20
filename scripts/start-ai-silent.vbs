Set fso = CreateObject("Scripting.FileSystemObject")
currentDir = fso.GetParentFolderName(WScript.ScriptFullName)
rootDir = fso.GetParentFolderName(currentDir)

Set WshShell = CreateObject("WScript.Shell")
WshShell.CurrentDirectory = rootDir
WshShell.Run "cmd /c start-ai.bat", 0, False
