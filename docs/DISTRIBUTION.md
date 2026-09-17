# Website and desktop distribution

Current release work, priorities and completion gates are tracked in [RELEASE-PLAN](RELEASE-PLAN.md), reviewed against checkpoint `ce7234b` and live GitHub publication state.

The end-user journey is: visit the website, choose a native installer, install irori, open a KB, and complete the selected agent's setup. Building the application from a checkout is a developer workflow, not the intended end-user installation flow.

Forge packaging and an unsigned CI pipeline are now implemented; see [commands, package contents and evidence](PACKAGING.md). The MIT license and Windows 11 x64/MacBook M5 Pro arm64 acceptance devices are confirmed in [ADR 002](decisions/002-release-and-workspace.md). On 2026-09-13 the owner explicitly requested the download website be published so they could try Windows, and on 2026-09-16 they requested that the Mac build be downloadable as well. This authorizes the Windows and Apple silicon Mac testing previews below; it does not declare the full service release complete or waive its remaining requirements.

## Implemented website

`website/` is an independent static entry inside the irori repository. It reuses Vite, TypeScript and Zod, with no new dependencies. Its build emits only public website assets into `dist-website/`. It neither embeds Electron nor exposes the desktop HostAPI. Relative asset URLs support a GitHub Pages project subpath or a custom domain. The screenshot is the actual development UI using disposable test content.

```sh
npm run dev:website
npm run build:website
npm run preview:website
# Actual browser smoke on Linux:
xvfb-run -a npm run test:website
```

The Windows x64 and macOS arm64 slots point to the exact CI-tested installers in the current preview tag. The manifest also carries that release's notes URL, so the page's release-evidence link is published from the same source as the installers instead of a separately edited tag. There is no Intel Mac slot: that architecture is out of scope by [ADR 002](decisions/002-release-and-workspace.md), so the manifest, the page and its browser tests describe two platforms rather than carrying a permanently empty third. The page labels the downloads as carrying no distribution signature, describes the one-time System Settings approval a Mac reader needs, notes that Windows 11 and macOS device acceptance is still awaited, links Git setup/support/release evidence and explains the Google connection trial, the Windows WinFsp prerequisite and the Mac mount route. Browser tests exercise the actual manifest plus isolated unavailable/mixed/available fixtures; they do not download fixture URLs.

## Previews kept in step with main

Assets: [Windows and Mac testing prerelease 0.1.6](https://github.com/DeL-TaiseiOzaki/irori/releases/tag/v0.1.6-preview.1), recorded in [0.1.6 preview.1 notes](releases/0.1.6-preview.1.md).

On 2026-09-17 the owner asked that `main` and the published preview stay in
sync, and gave standing authorization for agents to publish a preview after an
authorized merge. That covers the GitHub prerelease, the website manifest and
Pages deployment, and the anonymous download check. Signing identities,
notarization, a non-preview release, a new platform and account changes still
need their own authorization.

0.1.6 is the catch-up. `main` had moved 16 commits past the published builds,
including KB-declared skills and the hidden-entry classification, and the
bundled third-party notice had changed. Both installers come from one CI run of
the version change. The application version advanced rather than the preview
number, because the update check never offers a newer preview of the version a
reader already runs.

`release.yml` had never run before this release and was corrected first. It now
checks out main's full history: in a depth-1 checkout, the ancestry check could
not see a tested commit behind main's tip and would have rejected it. It also
titles the release from the notes' first heading.

## Owner-authorized Mac testing preview

Assets: [Mac and Windows testing prerelease 0.1.5](https://github.com/DeL-TaiseiOzaki/irori/releases/tag/v0.1.5-preview.2), recorded in [0.1.5 preview.2 notes](releases/0.1.5-preview.2.md).

Every earlier Mac package was unopenable after a browser download. Forge sealed
nothing, so Gatekeeper judged the bundle damaged and offered the reader no way to
continue; see [packaging](PACKAGING.md). The published disk image is now ad-hoc
signed, and both the built bundle and the copy inside the image are verified in
the Mac package job before it launches them. That converts the refusal into the
ordinary unverified-developer dialog, which the reader clears once through System
Settings. It is not a Developer ID signature and carries no notarization ticket,
so that approval step is required and is documented on the page and in the notes.

This preview is Apple silicon only, matching the MacBook M5 Pro acceptance device
in [ADR 002](decisions/002-release-and-workspace.md). Intel Macs are not a
target and the manifest no longer has a slot for them. Installation, the approval step, Japanese input, native CLI accounts,
Git operations and Google mounts on a real Mac remain the owner's device trial.
The application behaviour is the already published 0.1.5; no Windows reinstall is
required.

## Owner-authorized Windows testing preview

Public entry: [irori download website](https://del-taiseiozaki.github.io/irori/). Assets: [Windows testing prerelease 0.1.5](https://github.com/DeL-TaiseiOzaki/irori/releases/tag/v0.1.5-preview.1). [CHECKPOINT](CHECKPOINT.md) records deployed revisions and anonymous browser download/hash checks.

The current published preview is recorded in [0.1.5 preview notes](releases/0.1.5-preview.1.md): application commit `278f5a407e270752057dbe4a10574a9450644934`, native CI run `34853768104`, and the renamed but unmodified EXE of 318,439,424 bytes with SHA-256 `847985f585977d596fb20605caa480c1b88b4dbb98745f8a96bf34e4d9a63491`. Each preview attaches only that EXE, its SHA-256 file and package evidence; internal Squirrel feed files and local user/test data are not published.

The original authorization below described the first published preview. [Preview notes](releases/0.1.2-preview.1.md) identify application commit `b51a54b1f9fb36423edf56ed6a1bec961839e165`, successful native CI run `34761095540`, the exact EXE size/hash and outstanding checks. App version `0.1.2` includes the native terminal, bundled rclone and owner-supplied distributor Google configuration. The EXE is renamed to `irori-0.1.2-windows-x64-Setup.exe` without changing its bytes: 316,222,976 bytes, SHA-256 `b3cb5c71cb8311ad9043ad79e31632254ab8169d0b1e7de1412d41979f5012bd`. Only that EXE, its SHA-256 file and package evidence are attached to the prerelease; internal Squirrel feed files and local user/test data are not published. See [CHECKPOINT](CHECKPOINT.md) for current and historical delivery evidence. Real Google consent/refresh/mounts remain unverified.

The exception is limited to the tested preview channels for the owner's trial, including the requested terminal/rclone and Google configuration follow-ups. The owner registered the Google project/client and repository settings; the agent verified metadata and used those settings for the authorized rebuild. The Mac channel above was authorized separately on 2026-09-16 and is likewise limited to the tested Apple silicon preview. Neither authorizes inference, unrelated external account/project changes, Intel Mac publication or signing identities. All normal general-release gates below still apply. Installation, IME, native CLI accounts and actual GitHub synchronization on Windows 11 await the owner's device trial.

## Publish the page

`.github/workflows/website.yml` is a manually triggered GitHub Pages workflow. Once the website source is committed and pushed to the irori repository, enable **Settings → Pages → Build and deployment → GitHub Actions**, then run **Publish download website** from Actions. That uploads only `dist-website`, not the application, KBs or local test logs. Repository visibility and the account's Pages entitlement must support the intended public audience. The publication outcome and deployed commit/run are recorded in [CHECKPOINT](CHECKPOINT.md).

Use the URL returned by the deployment. A custom domain can be added later. Neither owning a domain nor operating an application server is necessary for this static page. See [GitHub Pages custom workflows](https://docs.github.com/en/pages/getting-started-with-github-pages/using-custom-workflows-with-github-pages).

## General-release installers

For the general-release channel, host the actual signed binaries as release assets, for example on [GitHub Releases](https://docs.github.com/en/repositories/releasing-projects-on-github/about-releases). Source archives generated by GitHub are not native installers. Ensure the release assets are downloadable by the website's intended audience.

Update `website/releases.json` with a real version and the exact HTTPS asset URL and size for each verified platform. Leave unready platforms `null`. A non-null entry enables that platform's download link; no runtime GitHub API request or access token is needed. Keep URLs pinned to a specific release rather than inventing a "latest" filename. Website builds validate the release manifest. Changing it requires rebuilding and publishing the page. Test each published link from a signed-out browser before announcing availability.

Before promoting a platform to general release, complete:

- Packaging that includes the host bundles and required runtime dependencies.
- Windows signing and macOS signing/notarization for the intended channel.
- Native installation, launch, Japanese IME, file paths and real CLI execution tests on the advertised architecture.
- First-run agent detection, install/login guidance and error recovery. The current development app still requires users to install and sign in to the native CLI separately.
- Distribution license selection and third-party notices.

The owner authorized this preview publication explicitly. Signing identities, developer/provider accounts and additional release channels still require their own setup and acceptance. Automatic application updates remain a separate future feature. Website design and hosting do not commit the application to Electron; its provisional host assessment remains in ADR 001.
