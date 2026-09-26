-- Scripture Listener launcher. Built by mac/make-app.sh, which fills in the two paths below.
-- Stays open in the Dock while the app runs; quitting it stops the server.
property projectDir : "__PROJECT_DIR__"
property nodePath : "__NODE_PATH__"
property pageURL : "http://localhost:4000"

on serverUp()
	try
		do shell script "curl -s -o /dev/null -m 2 " & pageURL & "/api/config"
		return true
	on error
		return false
	end try
end serverUp

-- "open -a" needs no macOS automation permission (a "tell application" block would).
on openPage()
	do shell script "open -a 'Google Chrome' " & pageURL
end openPage

on run
	if not serverUp() then
		-- Only the server goes to the background, with all its input/output redirected;
		-- otherwise "do shell script" waits forever for it and the page never opens.
		do shell script "cd " & quoted form of projectDir & "; " & quoted form of nodePath & " " & quoted form of (projectDir & "/server.js") & " < /dev/null > /tmp/scripture-listener.log 2>&1 &"
		-- Up to 2 minutes: on first launch macOS may ask for folder access before the server can start.
		repeat 240 times
			if serverUp() then exit repeat
			delay 0.5
		end repeat
	end if
	if not serverUp() then
		display dialog "Scripture Listener could not start. Details are in /tmp/scripture-listener.log" buttons {"OK"} with icon stop
		quit
		return
	end if
	openPage()
end run

-- Clicking the Dock icon again brings the control page back.
on reopen
	openPage()
end reopen

on quit
	try
		do shell script "pkill -f " & quoted form of (projectDir & "/server.js")
	end try
	continue quit
end quit
