# Interactive Linux VM preview

The development launcher forwards the actual Electron desktop to a browser using Xvfb, x11vnc, websockify and noVNC. File and agent operations still execute on the VM through the normal desktop host. The public download website remains separate.

## Start

Ubuntu/Debian development prerequisites:

```sh
sudo apt-get install xvfb xauth x11vnc websockify openbox
npm run setup:preview
npm run build
npm run preview:vm
```

Root containers omit `sudo`; the launcher explicitly uses Electron's existing root-only `--no-sandbox` development exception. Run the launcher from a terminal and leave it running. It prints the loopback URL and a generated eight-character VNC password. The default browser port is 6080; set `IRORI_PREVIEW_PORT` to choose another unprivileged port before launch. `IRORI_PREVIEW_VNC_PORT` controls the internal VNC port (default 5908).

The browser server and VNC listener bind only to loopback. Forward the browser port privately through VS Code's Ports panel, then open `http://127.0.0.1:6080/` on the local computer and enter the printed password. For plain SSH, create the tunnel on the local computer with `ssh -N -L 6080:127.0.0.1:6080 user@your-vm`, then open the same URL. If VS Code assigns a different local port, use that forwarded address. No VM firewall opening or public port publication is required. See [VS Code port forwarding](https://code.visualstudio.com/docs/remote/ssh#_forwarding-a-port--creating-ssh-tunnel).

Chrome access was confirmed by the user at the 2026-09-13 checkpoint. If the embedded editor browser shows `ERR_CONNECTION_REFUSED`, check the forwarded port and open its displayed address in Chrome. In the observed case the VM server was healthy and Chrome worked; no application restart or public listener was needed.

The noVNC client is pinned to 1.7.0 in an ignored local tools installation and copied into an isolated static web directory. Passwords, logs, native device state and sample KBs remain under ignored `.local/vm-preview/`; the web server serves only its `public/` subdirectory. The password is available in `.local/vm-preview/password` and changes each launch. The launcher uses its own authenticated Xvfb display, preserving other existing VM displays. Upstream: [noVNC](https://github.com/novnc/noVNC), [x11vnc](https://github.com/LibVNC/x11vnc).

## Try the application

Open the saved **irori を試す** workspace. It contains independent personal/team sample KBs and editable Japanese welcome notes. Samples and edits survive restarts; seeding does not overwrite existing notes. This preview uses separate irori device data, while native CLI authentication/configuration still belongs to the VM user.

The 2026-09-13 Git implementation session also created a device-local **Git連携を試す** workspace with **Git・お試しKB**. Open **共有を試す.md → 変更と履歴** to inspect the prepared change, commit and share. Its `origin` is a disposable bare repository on this VM, so sharing this sample does not publish to GitHub. This additional demo and its history live only in ignored preview state; the generic launcher does not recreate them on a fresh checkout. Existing personal/team samples were preserved byte-for-byte when the preview was restarted.

Try rich/source editing, saves, new notes, space switching, four-harness selection, conversation reset and cloud setup diagnostics. Real AI execution uses the installed native CLI and its account. The locally installed OpenCode/Pi test binaries are added to this preview's PATH when available; no provider/model output is mocked. Google consent and cloud mounts still require their outstanding OAuth/native prerequisites.

If direct Japanese IME input does not reach the remote desktop, first click the input destination in irori, then use **日本語入力** in the browser toolbar. Compose/convert text locally and select **入力を送る** to send Unicode keystrokes to the focused VM input. This is a preview input helper, not native-platform IME acceptance.

Closing the browser disconnects the viewer and leaves irori running. To finish, save changes, stop any running agent and close the irori window. The launcher then stops the preview services. Save and stop agents before interrupting the terminal launcher. Restart with `npm run preview:vm`; VM/container shutdown also ends the preview.
