-- Source for "Launch aito.app"
-- Rebuild with:
--   osacompile -o "Launch aito.app" "support/Launch aito.applescript"
--
-- Double-click the resulting .app in Finder to launch the full workspace
-- (Terminal + frontend + inference server + browser tab).

on run
	tell application "Finder"
		set projectFolder to container of (path to me as alias) as alias
		set projectPath to POSIX path of projectFolder
	end tell

	set cmd to "cd " & quoted form of projectPath & " && exec ./start.sh"

	tell application "Terminal"
		activate
		do script cmd
	end tell
end run
