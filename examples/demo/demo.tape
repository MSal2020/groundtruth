# VHS tape for the groundtruth README GIF.
#   1. install VHS:  https://github.com/charmbracelet/vhs  (brew install vhs)
#   2. build:        npm run build
#   3. render:       vhs examples/demo/demo.tape   ->   examples/demo/groundtruth-demo.gif
#
# Run from the repo root.

Output examples/demo/groundtruth-demo.gif

Set Shell bash
Set FontSize 20
Set Width 1180
Set Height 820
Set Padding 26
Set Margin 18
Set BorderRadius 10
Set WindowBar Colorful
Set Theme "Catppuccin Mocha"
Set TypingSpeed 55ms

# --- stage the scenario silently ---
Hide
Type "source examples/demo/gif-prepare.sh"
Enter
Type "clear"
Enter
Show

Sleep 700ms

# the AI agent reports success
Type "agent"
Enter
Sleep 2.8s

# ...and groundtruth checks whether that's actually true
Type "gt"
Enter
Sleep 6.5s
