# Distributor Google OAuth setup

irori delegates Drive authentication, refresh and folder APIs to the bundled, checksum-pinned rclone. The remaining external input is an OAuth client owned by the irori distributor. Ordinary users should only choose **Googleアカウントを追加** and consent in their browser.

Do not fall back to rclone's shared client: rclone states that it is being retired during 2026. Use an application-owned client as described in the [rclone Drive guide](https://rclone.org/drive/#making-your-own-client-id).

## Owner's initial device trial

1. Choose or create the irori project in [Google Cloud Console](https://console.cloud.google.com/), and enable **Google Drive API**.
2. Configure **Google Auth platform** branding and audience for the intended testers, using the distributor's real contact details. For an external app still in testing, register the Google accounts that will test it. Follow [Google's consent-screen guide](https://developers.google.com/workspace/guides/configure-oauth-consent).
3. Under **Clients**, create an OAuth client of type **Desktop app**. This uses system-browser/loopback authentication. See [Google's desktop-client instructions](https://developers.google.com/workspace/guides/create-credentials#desktop-app) and [native-app OAuth](https://developers.google.com/identity/protocols/oauth2/native-app).
4. In [irori's repository Actions secrets](https://github.com/DeL-TaiseiOzaki/irori/settings/secrets/actions), set `IRORI_GOOGLE_CLIENT_ID` and `IRORI_GOOGLE_CLIENT_SECRET` to that client's values. These are distributor settings; do not put user access/refresh tokens or service-account credentials there. Client values need not be pasted into chat or committed to source.
5. Run **Verify and package desktop** on the selected commit. The make step passes those secrets only as the host's existing build inputs. Missing values produce an explicitly unconfigured engineering package; partial/invalid values fail without printing their contents. The package test checks the expected configuration status. Values are never sent to the renderer or native terminal/agent environment.
6. Test the exact installer on Windows: choose the workspace's **Drive フォルダを接続**, add an account, complete browser consent, choose a Drive/shared-drive folder and register it. WinFsp is additionally needed for Windows filesystem mounting; the dialog links its official installer and rechecks availability. rclone itself is included. Exercise a second account, cancellation and restart before declaring acceptance.

The implemented scope remains `drive.readonly`. Selecting a folder in irori does not reduce the OAuth account-wide scope. Google categorizes this scope as restricted; production consent/verification and privacy requirements remain separate release gates. Cloud writing requires a later scope/re-consent and durable-upload implementation. See [Drive scopes](https://developers.google.com/workspace/drive/api/guides/api-specific-auth).

## Current boundary

No real Google client was supplied or account consent completed during this implementation. Native rclone tests run the real account controller through the local browser handoff and cancellation with synthetic client configuration; they do not establish successful Google authentication, refresh, shared-drive access or filesystem mounting. The workflow and onboarding code are ready for the owner's client and device trial. Do not mark those external checks complete based on fixtures or the native control test.
