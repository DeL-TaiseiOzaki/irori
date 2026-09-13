# Integrated native terminal

The owner requested an embedded terminal with automatic detection of installed shells. The implementation reuses **xterm.js 6.0.0** and its **FitAddon 0.11.0** for rendering/input/resize, **node-pty 1.1.0** for native PTYs/Windows ConPTY, **default-shell** for the OS default, **which** for executable lookup, and the existing **tree-kill** dependency for child cleanup. No terminal emulation, escape-sequence parser or shell protocol is implemented by irori. [node-pty](https://github.com/microsoft/node-pty), [xterm.js](https://xtermjs.org/).

## User flow

Open a KB and choose **ターミナル** in the bottom bar. It starts the first detected shell in that KB's root. Windows discovery includes PowerShell 7, Windows PowerShell, Command Prompt and Git Bash; macOS/Linux discovery starts with the user's default and reads `/etc/shells`. Only executables actually found are offered. Windows Terminal and iTerm are separate terminal frontends; their underlying shells are used inside irori.

The pane retains its original KB when a different note/KB is selected. Its header names that KB; it never silently changes cwd. Stop the process, choose another detected shell and press **開く** to restart. Closing the pane terminates its shell and descendants. Workspace switching is disabled while the pane is open. Normal app closure confirms stopping live terminals/agents; renderer reload/crash stops old terminal sessions. Note/agent workflows do not require opening this pane.

## Boundary and lifecycle

Terminal requests use the existing typed/Zod-validated HostAPI and trusted main-frame checks. The host validates the shell against its discovery list, resolves the registered KB root and creates a random session ID. Command input cannot supply a new executable, cwd or environment through IPC. Once opened by the user, this is an ordinary native shell with the user's permissions; it can run commands and change directories. It is not a KB sandbox or an agent with structured approval prompts.

The frontend loads xterm only on demand. Output is passed solely to xterm, with no raw HTML, external-link handlers, clipboard escape handlers or extra network listener. xterm write callbacks acknowledge consumed characters; node-pty pauses/resumes around bounded outstanding output, following [xterm flow-control guidance](https://xtermjs.org/docs/guides/flowcontrol/). Scrollback is bounded to 3,000 lines and the host caps concurrent sessions at four. Terminal transcripts are not persisted by irori; native shell history/configuration still belongs to the shell. Credential/build configuration variables are removed using the existing process environment helper.

Forge's native-unpack plugin and explicit unpacking of node-pty helpers preserve native binaries outside ASAR. The package smoke runs the actual packaged terminal and writes a Japanese file through keyboard input, using a copied installation outside the checkout. Shell discovery uses default-shell's named export because CJS host bundles must not double-wrap an ESM default export.

## Evidence and remaining acceptance

Native service tests cover shell detection, foreign shell/scope rejection, Japanese/spaced cwd and output-file creation, resizing, large-output backpressure, Ctrl-C, exit, stale input and foreground-child termination. The Electron UI test covers real keyboard input/file bytes, the smaller viewport/footer, stop/reopen and workspace switching. Package CI repeats terminal startup and file creation on Windows x64, macOS arm64 and Linux x64.

Record final run outcomes in [CHECKPOINT](CHECKPOINT.md). CI does not prove hardware IME behavior, all user shell profiles or every native CLI login/model journey. No model inference is part of these terminal tests.
