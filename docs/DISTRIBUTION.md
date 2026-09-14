# Website and desktop distribution

Current release work, priorities and completion gates are tracked in [RELEASE-PLAN](RELEASE-PLAN.md), reviewed against checkpoint `ce7234b` and live GitHub publication state.

The end-user journey is: visit the website, choose a native installer, install irori, open a KB, and complete the selected agent's setup. Building the application from a checkout is a developer workflow, not the intended end-user installation flow.

Forge packaging and an unsigned CI pipeline are now implemented; see [commands, package contents and evidence](PACKAGING.md). The MIT license and Windows 11 x64/MacBook M5 Pro arm64 acceptance devices are confirmed in [ADR 002](decisions/002-release-and-workspace.md). On 2026-09-13 the owner explicitly requested the download website be published so they could try Windows. This authorizes the Windows testing preview below; it does not declare the full service release complete or waive its remaining requirements.

## Implemented website

`website/` is an independent static entry inside the irori repository. It reuses Vite, TypeScript and Zod, with no new dependencies. Its build emits only public website assets into `dist-website/`. It neither embeds Electron nor exposes the desktop HostAPI. Relative asset URLs support a GitHub Pages project subpath or a custom domain. The screenshot is the actual development UI using disposable test content.

```sh
npm run dev:website
npm run build:website
npm run preview:website
# Actual browser smoke on Linux:
xvfb-run -a npm run test:website
```

The Windows x64 slot points to the exact CI-tested EXE in the current preview tag, `v0.1.5-preview.1`. The manifest also carries that release's notes URL, so the page's release-evidence link is published from the same source as the installer instead of a separately edited tag. Both Mac slots remain unavailable. The page labels the download as unsigned and awaiting Windows 11 device acceptance, links Git setup/support/release evidence and explains the Google connection trial and WinFsp prerequisite. Browser tests exercise the actual manifest plus isolated unavailable/mixed/available fixtures; they do not download fixture URLs.

## Owner-authorized Windows testing preview

Public entry: [irori download website](https://del-taiseiozaki.github.io/irori/). Assets: [Windows testing prerelease 0.1.5](https://github.com/DeL-TaiseiOzaki/irori/releases/tag/v0.1.5-preview.1). [CHECKPOINT](CHECKPOINT.md) records deployed revisions and anonymous browser download/hash checks.

The current published preview is recorded in [0.1.5 preview notes](releases/0.1.5-preview.1.md): application commit `278f5a407e270752057dbe4a10574a9450644934`, native CI run `34853768104`, and the renamed but unmodified EXE of 318,439,424 bytes with SHA-256 `847985f585977d596fb20605caa480c1b88b4dbb98745f8a96bf34e4d9a63491`. Each preview attaches only that EXE, its SHA-256 file and package evidence; internal Squirrel feed files and local user/test data are not published.

The original authorization below described the first published preview. [Preview notes](releases/0.1.2-preview.1.md) identify application commit `b51a54b1f9fb36423edf56ed6a1bec961839e165`, successful native CI run `34761095540`, the exact EXE size/hash and outstanding checks. App version `0.1.2` includes the native terminal, bundled rclone and owner-supplied distributor Google configuration. The EXE is renamed to `irori-0.1.2-windows-x64-Setup.exe` without changing its bytes: 316,222,976 bytes, SHA-256 `b3cb5c71cb8311ad9043ad79e31632254ab8169d0b1e7de1412d41979f5012bd`. Only that EXE, its SHA-256 file and package evidence are attached to the prerelease; internal Squirrel feed files and local user/test data are not published. See [CHECKPOINT](CHECKPOINT.md) for current and historical delivery evidence. Real Google consent/refresh/mounts remain unverified.

The exception is limited to the tested Windows preview channel for the owner's trial, including the requested terminal/rclone and Google configuration follow-ups. The owner registered the Google project/client and repository settings; the agent verified metadata and used those settings for the authorized rebuild. This does not authorize inference, unrelated external account/project changes or a Mac release. All normal general-release gates below still apply. Installation, IME, native CLI accounts and actual GitHub synchronization on Windows 11 await the owner's device trial.

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
