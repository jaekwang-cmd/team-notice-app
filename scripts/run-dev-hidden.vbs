Set WshShell = CreateObject("WScript.Shell")
WshShell.CurrentDirectory = "C:\Users\mj497\team-notice-app"
WshShell.Run "cmd /c npm start > ""C:\Users\mj497\team-notice-app\last-run.log"" 2>&1", 0, False
