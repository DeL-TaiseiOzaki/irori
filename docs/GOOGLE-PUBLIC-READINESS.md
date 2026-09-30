# Public Google Drive readiness

Reviewed 2026-09-30. This is a preparation packet, not approval to claim general
Google availability. The latest published preview is 0.1.61; the 0.1.62 candidate
adds credential protection and data-use confirmations. Google OAuth audience
and verification settings have not been changed. The owner configured DNS and
the implementation configured/deployed GitHub Pages for the registered domain;
HTTPS and Google Domain Property verification remain pending.

Owner-confirmed facts, 2026-09-30: publisher **Taisei Ozaki**, public contact
**taisei.ozaki.lab@gmail.com**, Google audience **External**, publishing status
**Testing**, and registration of **irori-ai.com**. Project ID and verification
status have not been supplied. These are the owner's reported settings, not a Console
inspection. The implementation and native checks passed in
[PR #146 CI 36680214393](https://github.com/DeL-TaiseiOzaki/irori/actions/runs/36680214393)
at source `2d596ed`; the PR remains draft and no preview has been published.

The owner registered `irori-ai.com` at XServerドメイン and configured its domain
nameservers plus the four GitHub Pages A records and www CNAME. Website-only
[PR #147](https://github.com/DeL-TaiseiOzaki/irori/pull/147) is merged; Pages run
`36691804740` deployed it. HTTP browser acceptance passed on rerun after a
transient document 503. GitHub reports no certificate yet and strict HTTPS fails
hostname validation; HTTPS enforcement remains pending. The owner supplied the
Google Domain Property TXT value and added the record; a fresh Google DNS
response matches it. No Console success has been reported.
[PR #148](https://github.com/DeL-TaiseiOzaki/irori/pull/148)
records cutover evidence. This application candidate remains separate and draft.

## Preserve the current features

`src/cloud/accounts.ts` requests `scope: 'drive'`, meaning
`https://www.googleapis.com/auth/drive`. Folder listing, existing My Drive/shared
drive trees, mounted reads and edits, durable uploads and local CLI access are
the current behavior. Folder selection and read-only connection settings do not
reduce the account-wide grant. The previous `drive.readonly` documentation
described an older implementation.

Keep the existing application-owned Desktop OAuth client and rclone integration
while seeking restricted-scope verification. `drive.file` limits access to
individually authorized files; replacing the scope does not preserve arbitrary
existing folder-tree access. See Google's [Drive scope reference](https://developers.google.com/workspace/drive/api/guides/api-specific-auth).

Testing normally limits access to listed test users and expires Drive refresh
tokens after seven days. Moving an unverified app to production is not equivalent
to scope approval: the unverified warning and lifetime user cap remain relevant.
See [Audience settings](https://support.google.com/cloud/answer/15549945?hl=en).

## Data-flow inventory

| Path | Data and destination | Current control / remaining evidence |
| --- | --- | --- |
| Browser → Google → bundled rclone | Desktop OAuth grant, access/refresh tokens | System-browser loopback flow; real Google consent/refresh still needs device acceptance. |
| Google ↔ rclone ↔ connected folder | Names, IDs, file bytes, changes | Selected folder working root; full VFS cache, 2 GiB / 7 days per mount; pending writes can persist. |
| rclone credential configuration | Tokens and application client settings on the device | Candidate encrypts native rclone config; random key protected by OS safeStorage. Insecure/unavailable key storage is refused before account creation. |
| Files → provenance / conversation records | Retained source copies, requests and tool results | Device-local ordinary files; retention is independent of VFS cache limits and disconnection. |
| Files/context → native CLI → providers/tools | Instructions, selected context and files the configured CLI reads | Candidate first-use disclosure per CLI; provider endpoints, MCP/tools, retention/training and actual transfer controls remain to be qualified. |
| Terminal / routine programs | Accessible files and external services chosen by programs | Separate candidate first-use disclosure; no universal network restriction. |
| Git / updates / website | Selected repositories, release requests, ordinary page requests | User-configured Git remote; GitHub downloads and GitHub Pages hosting. |

The publisher must approve this inventory against intended product behavior.
There is no irori application backend in these paths, but external AI processing
must still be declared. Google explicitly includes the capability to access
restricted data through third-party servers in its [security assessment criteria](https://developers.google.com/identity/protocols/oauth2/production-readiness/restricted-scope-verification).
Do not claim a desktop-only exemption while keeping those features.

## Console values to prepare

| Field | Value / remaining action |
| --- | --- |
| App name | irori |
| Publisher | Taisei Ozaki |
| User support / developer contact | taisei.ozaki.lab@gmail.com; support dropdown must offer the signed-in Google account or an eligible managed group. |
| Audience | External (owner-reported current value). |
| Publishing status | Testing (owner-reported current value); move to production at the verification stage, without claiming unlimited approved access. |
| Scope | `https://www.googleapis.com/auth/drive` |
| Authorized domain | `irori-ai.com` after DNS Domain Property verification. |
| Homepage | `https://irori-ai.com/` after deployment. |
| Privacy | `https://irori-ai.com/docs/en/privacy/` after final policy review/deployment. |
| Terms | `https://irori-ai.com/docs/en/terms/` after final review/deployment. |

The domain URLs are intended deployment targets, not confirmed live links. Use
the existing GitHub Pages hosting; buying a separate web-hosting service is unnecessary for this static
site. At cutover, update the documented canonical/alternate/sitemap and download
site URLs, configure Pages and DNS, verify HTTPS and retest both locale paths.
Do not point OAuth Branding to a domain that has not been acquired and verified.

### Registration and DNS handoff

The owner has registered `irori-ai.com` at XServerドメイン. Use its domain DNS
settings and confirm the authoritative nameservers before acceptance. There is no connected registrar account or payment capability in
this workspace; the implementation has performed only read-only registry, DNS
and Pages lookups. Registration was completed by the owner. Do not request
account passwords or payment details in chat.

Use `irori-ai.com` for these steps:

1. Verify it in the owner's GitHub account Settings → Pages using GitHub's
   generated TXT record. Keep that record. Then set the repository Pages custom
   domain before adding the hosting DNS records.
2. Point the apex domain to GitHub Pages with four A records:
   `185.199.108.153`, `185.199.109.153`, `185.199.110.153`,
   `185.199.111.153`. An optional `www` CNAME points to
   `del-taiseiozaki.github.io` without a repository path. Use GitHub's
   [custom-domain instructions](https://docs.github.com/en/pages/configuring-a-custom-domain-for-your-github-pages-site/managing-a-custom-domain-for-your-github-pages-site)
   and [ownership verification](https://docs.github.com/en/pages/configuring-a-custom-domain-for-your-github-pages-site/verifying-your-custom-domain-for-github-pages).
   This site's Actions deployment does not require a CNAME file.
3. In Google Search Console, the Cloud project Owner adds the root domain as a
   Domain Property and adds its generated TXT record at the registrar. Verify
   that property before using the domain in OAuth Branding.
4. Update the site's canonical, alternate, sitemap and download URLs, deploy,
   enable/check HTTPS and rerun both-language website checks. DNS and certificate
   issuance may take time; use the real verification results, not a presumed
   activation date.

## Ordered owner and implementation steps

1. **Owner: supply public identity and existing settings.** Confirm publisher
   name, public privacy/support email, owned domain, project ID, External/Internal
   audience, Testing/In production state and verification status. Do not send
   client secrets or user tokens. Preserve the current project/client unless a
   verified incompatibility requires replacement.
2. **Implementation + owner: finalize and deploy the website.** Review the
   bilingual [privacy draft](../website/docs/content/en/privacy.md) and
   [use/license draft](../website/docs/content/en/terms.md); replace draft identity
   notices only after approval. Publish accessible homepage, privacy and terms
   URLs on the same owned domain. The current github.io project path does not
   provide ownership of github.io. Follow [domain verification](https://support.google.com/cloud/answer/13804266?hl=en)
   and verify a DNS Domain Property using a Google account that is a project
   Owner. URL-prefix/site verification is not sufficient under the current
   domain-verification help. DNS and hosting
   changes need the actual domain and account access.
3. **Implementation + owner: close the data-handling gaps below.** Decide supported
   AI account/provider configurations and document actual recipients, retention,
   human-access and training policies. Validate encrypted storage, deletion and
   prompt-injection controls against the real product. The small candidate
   changes alone do not complete this work.
4. **Owner in Google Auth Platform: prepare Branding and Data Access.** Use the
   reviewed site/contact information, current product mark and exact `drive`
   scope. Set the intended external production audience using Google's current
   instructions. Production switching can precede scope approval but must not be
   advertised as unlimited verified access.
5. **Owner + implementation: record an English demonstration.** Use an isolated
   test account and non-sensitive Drive data. Show homepage/privacy/terms, in-app
   notice, Google consent with exact requested permissions, choosing an existing
   nested folder, reading/editing/uploading, explicit AI transfer and controls,
   disconnecting, account removal and Google's revocation page. Demonstrate
   actual behavior and remaining limitations; hide tokens/private content. Supply
   the required review-accessible video URL and test instructions. See
   [verification submission](https://support.google.com/cloud/answer/13461325?hl=en).
6. **Owner: verify and publish Branding, then request restricted Data Access
   verification in Verification Center.** Attach scope
   justification, video and this data-flow inventory. Answer follow-up requests;
   undertake the assessment Google requires before claiming verification. Google
   determines applicable assessment requirements; do not commission or promise
   a paid assessment without the owner's approval. See [security assessment](https://support.google.com/cloud/answer/13465431?hl=en).
7. **Implementation + owner: release and accept.** After approved merge and native
   packaging checks, publish the candidate; test a non-test-user account on
   Windows/macOS, cancel/retry, refresh, shared drives, uploads and Google
   revocation. Workspace administrators can independently restrict applications.

## Scope justification draft

irori is a desktop note-editing and knowledge workspace. Users attach existing
Google Drive folders, including shared-drive folders, then browse their existing
trees, open materials, edit files and upload changes from the application's UI.
The current implementation delegates these operations to a folder-rooted rclone
mount. It needs read/write access to pre-existing files that were not created by
irori. A per-file grant does not implement this existing folder workflow. irori
does not request this permission merely for a possible future feature. Users can
disconnect folders and remove accounts. Optional native CLI agents can process
connected materials; their third-party data paths are separately disclosed and
must be included in review, with qualified providers and controls.

This is a technical justification draft, not evidence that Google accepts the
scope or that optional processing already meets policy.

## Remaining gates before an honest full-feature submission

The following are gaps inferred from source behavior against the
[Workspace user-data policy](https://developers.google.com/workspace/workspace-api-user-data-developer-policy),
last updated 2026-09-03. Confirm their resolution with the reviewer; none is
waived by a privacy notice or blanket user agreement.

- Credential encryption covers rclone config only. Cached Drive files, retained
  provenance and conversation/tool data remain ordinary files. Determine and
  enforce adequate at-rest protection for all relevant data, including external
  systems, backups and portable copies.
- First-use confirmation is remembered per purpose. It does not establish
  granular approval of every agentic invocation, destination or data transfer.
  Existing native tool permissions vary by CLI and access mode.
- Arbitrary CLI/provider/tool settings do not prove Limited Use compliance.
  Qualify supported configurations; Google-derived data must not train general
  models. The current code cannot establish downstream policy compliance.
- Review retained copies, cache-header constraints and deletion on request.
  Disconnect, uninstall and conversation deletion do not erase every copy;
  there is no complete product-level erasure control.
- Provide actual prompt-injection protection for retrieved files and agent tools.
  Existing filesystem/IPC boundaries alone do not demonstrate this.
- Obtain consistent macOS signing/keychain behavior and clean-device evidence.
  Preview ad-hoc signing is not a stable publisher identity or notarization.

These gates may require a broader implementation than the requested minimal
patch. Agree on their design and the Google review outcome before expanding the
candidate. Do not silently remove AI/Drive capabilities and call all features
public.
