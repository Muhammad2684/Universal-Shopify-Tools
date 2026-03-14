@echo off
powershell -command "Start-Sleep -Seconds 8"
del /f /q "%~dp0UniversalSHTools.exe"
move /y "%~dp0_update_new.exe" "%~dp0UniversalSHTools.exe"
powershell -command "Start-Sleep -Seconds 15"
schtasks /create /tn "USHTRelaunch" /tr "\"%~dp0UniversalSHTools.exe\"" /sc once /st 00:00 /f /ru "%USERNAME%"
schtasks /run /tn "USHTRelaunch"
schtasks /delete /tn "USHTRelaunch" /f
del /f /q "%~dp0_mei_path.txt"