' Runs one command line with no visible window and returns its exit code.
'
' The "MarketPulse *" tasks run in the signed-in user's session (InteractiveToken), so a plain
' cmd.exe action opens a console window on every run: a blank window every minute while the market
' is open. Closing one kills that run (0xC000013A, STATUS_CONTROL_C_EXIT), which is where the "^C"
' lines in logs\*.log came from (docs/plans/evidence-clock).
'
' Task action: wscript.exe //B //Nologo E:\BoraTradingTool\scripts\run-hidden.vbs "<command line>"
' The command line must not contain double quotes: WSH arguments cannot carry them.
If WScript.Arguments.Count <> 1 Then WScript.Quit 2
WScript.Quit CreateObject("WScript.Shell").Run(WScript.Arguments(0), 0, True)
