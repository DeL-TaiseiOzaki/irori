# Distributor Google OAuth setup

irori delegates Drive authentication, refresh and folder APIs to the bundled, checksum-pinned rclone. Ordinary users should only choose **Googleアカウントを追加** and consent in their browser. On 2026-09-13 the owner reported completing the client setup; both repository secret names and update timestamps were verified without reading their values. Version `0.1.2` is the first candidate built with those settings. [CHECKPOINT](CHECKPOINT.md) records its exact build/publication outcome.

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

The owner registered the distributor settings and reported declaring broader Google Drive permissions for future writing. Declaring scopes in Google Auth Platform does not change the scopes irori requests: the current account controller still sends only `drive.readonly`. Durable uploads and the corresponding scope/re-consent change remain D04 work. No external Google project settings were changed by the agent.

Configured package tests exercise the compiled client through bundled rclone, inspect its local redirect to Google's authorization endpoint, check the requested read-only scope and cancel the attempt. They intercept the browser launch before Google consent and record only booleans, without client values, OAuth URLs or account tokens. Local test credentials are synthetic; CI builds use repository secrets. This verifies packaged browser handoff and cleanup, not Google's acceptance of the client, successful user consent, refresh, shared-drive access or native filesystem mounting. Those steps still require the owner's device trial. Versions `0.1.0` and `0.1.1` remain unconfigured and do not receive new settings automatically.
