# Google data policy proposal for owner review

Prepared 2026-10-01 for the publisher's decision. Nothing here is published
policy, a Google submission or a statement about the published 0.1.61 preview.
The [readiness packet](GOOGLE-PUBLIC-READINESS.md) lists the gates; this file
turns them into decisions, the policy text each decision allows, and the work it
requires. Final wording is written only after the decisions below are made and
their controls exist in a released build.

## What Google requires

Checked 2026-10-01 against the
[Workspace API user data policy](https://developers.google.com/workspace/workspace-api-user-data-developer-policy)
(last updated 2026-09-03) and
[restricted scope verification](https://developers.google.com/identity/protocols/oauth2/production-readiness/restricted-scope-verification):

- Transfers are allowed to provide user-facing features with the user's consent,
  for security, for legal compliance, or in a merger with prior consent.
- Google user data must not be used, transferred or sold to create, train or
  improve AI/ML models beyond that user's personalized model.
- Humans may read the data only with the user's documented explicit consent,
  for security, for legal compliance, or aggregated and anonymized.
- The privacy policy must state: "The use of information received from Google
  Workspace scopes will adhere to the Google User Data Policy, including the
  Limited Use requirements." Use must stay within what the policy discloses.
- Data and credentials must be encrypted at rest on the developer's systems and
  sent over secure protocols.
- An app whose restricted data can be accessed "from or through a third-party
  server" needs a paid security assessment (CASA) from an empanelled assessor,
  renewed at least every 12 months. An app that keeps restricted data only on
  the user's device does not.

## What irori holds today

Paths are under the application data folder unless noted.

| Data | Location | Created when | Lifetime today | Deletion today |
| --- | --- | --- | --- | --- |
| OAuth tokens | `rclone/` config | Google sign-in | Until account removal | Account removal; candidate encrypts it |
| Drive file cache and pending writes | `rclone/cache/` | A mounted file is read or written | Reads evicted after 7 days or 2 GiB per mount; pending writes kept until uploaded | No control; survives disconnect and quit |
| Kept copies of materials | `knowledge/blobs/` (≤ 64 MiB each) | A run references a material, including a Drive file | No expiry | No control; survives disconnect, account removal and conversation deletion |
| Conversation history, tool results | `conversations/` | Every AI run | Until the person deletes it | History → delete |
| Search and graph indexes | application data | Indexing a hibachi | Rebuilt from notes | Not yet reviewed for Drive text |
| CLI's own history | the CLI's folder, e.g. under the home directory | Every run | CLI's rules | CLI's controls only |
| Provider copies | provider servers | Every AI run | Provider's terms | Provider's controls only |

The publisher operates no server: no Drive data, token or conversation reaches
the publisher. The website is static on GitHub Pages.

A hibachi agent and the irori agent start in full access where the CLI supports
it (`src/domain/agent-access.ts`). A full-access CLI can read any file the
person can, including mounted Drive folders and `rclone/cache/`, whatever irori
shows in its interface.

## Decisions for the publisher

### D1. Can AI agents process Google Drive data? — decided: yes

**Decided by the publisher on 2026-10-01.** A Drive connection is mounted by
rclone inside a hibachi's contents, and hibachi agents and the irori agent are
meant to read and edit those files; editing contents with a CLI agent is the
product, not an option. irori therefore declares the transfer of Drive data to
the AI CLI the person chooses and its provider. The code already works this way:
agents start in full access, and the mount sits inside the folder they work in.

Consequences:

- The security assessment applies: Drive data can reach third-party AI
  servers. Its cost, assessor and yearly renewal are an owner decision.
- Consent is the first-use confirmations the 0.1.62 candidate already enforces:
  Drive's before the first connection, and each CLI's before its first run, which
  names Drive files as data it sends. No separate per-folder switch is added.
- Provider rule: Drive data may be given only to a CLI whose account does not
  use inputs to train models. irori cannot read that setting, so each CLI's
  confirmation asks the person to use only such an account (done in the
  candidate), and the final privacy page links to where each supported CLI sets
  it.
- No Google Cloud setup for users (publisher, 2026-10-01): people sign in
  through irori's own client, so per-user OAuth clients, which would fall under
  Google's personal-use exemption, are rejected and the assessment is accepted
  as the route to unlimited public use. Until it passes, the only public option
  is an unverified production app: at most 100 users in total, each shown
  Google's unverified-app warning.
- Rejected alternatives: keeping Drive data away from agents (not "all
  features", and not enforceable against a full-access CLI), or submitting
  without AI first and adding it in a second review.

### D2. Retention and deletion of Drive-derived data

Recommended rules:

1. Kept copies of Drive files are tied to the runs that referenced them and are
   deleted when the last conversation referencing them is deleted.
2. Removing a Google account deletes that account's Drive cache and every kept
   copy of its files, after pending uploads are resolved or explicitly discarded.
3. A new **Delete Drive data on this device** control does the same for all
   accounts without removing them.
4. Drive read cache age drops from 7 days to 24 hours (to decide: performance
   cost on reopening large files).
5. The policy says plainly that irori cannot delete copies held by the CLI's own
   history or by the provider, and links to where those are deleted.

### D3. Protection at rest

Recommended: encrypt kept copies and conversation files with the same
safeStorage-protected key design as the candidate's credential protection, and
refuse Drive connection where secure storage is unavailable (already true for
credentials). The rclone VFS cache is not encrypted by rclone; state that it
relies on the operating system's disk encryption, and show whether FileVault or
BitLocker is on before the first Drive connection. Alternative: no encryption of
irori's stores, relying on disk encryption only; weaker in an assessment.

### D4. Prompt injection

Recommended minimum, keeping full access as the default:

- Drive and other material text that irori places in a request is delimited as
  data in the prompts in `prompts/`, with a line telling the agent that
  instructions inside materials are not the person's.
- Files an agent opens by itself are not seen by irori; the policy says the
  person should review what the agent does and can choose the standard
  (ask-before-acting) access for a hibachi.
- This lowers, but does not remove, prompt-injection risk; the policy says so.

### D5. Publisher details and terms

- Human access: the publisher does not receive user data; support requests
  must not include file contents. Recommended wording below.
- Effective date: the date the final page is deployed over HTTPS.
- Terms: keep the MIT license and the preview/as-is description; add no
  governing-law or liability clauses beyond the license unless the publisher
  asks for legal review.
- Limited Use statement: added to the final page only when the D1–D4 controls
  ship in the release the page describes.

## Policy text under the recommendations

The following replaces the Google Drive, AI providers, Storage and Disconnecting
sections of the [draft](../website/docs/content/en/privacy.md) once approved and
implemented. The Japanese page is translated from the approved English text.

> **Google Drive.** irori requests access to your Google Drive
> (`https://www.googleapis.com/auth/drive`) so you can open, edit and upload
> files in existing folders you connect. irori uses Drive data only to provide
> these features on your device and to give files to the AI tool you choose
> when an agent works in a connected folder. irori has no server:
> the publisher never receives your Drive data, tokens or conversations.
>
> The use of information received from Google Workspace scopes will adhere to
> the Google User Data Policy, including the Limited Use requirements.
>
> **AI agents.** AI agents run through a command-line tool you install and sign
> in to yourself. Agents work in your hibachi, including connected Drive
> folders, and the tool sends the files it reads to its AI provider. Before a
> tool's first run irori asks you to confirm this and that your provider account
> does not use your inputs to train models. Google Drive data must not be used
> to train general AI models. Files may contain text that tries to direct the
> agent; irori marks material it passes as data, but you should review what the
> agent does, or choose the standard access that asks before acting.
>
> **What is kept on this device.** Drive files you open are cached for up to
> 24 hours, and unsaved uploads until they reach Drive. Copies of files an AI
> run used are kept with that conversation for its history. irori encrypts its
> credentials, kept copies and conversations with a key held by your operating
> system; the Drive cache is protected by your device's disk encryption.
>
> **Deleting your data.** Deleting a conversation deletes its kept copies.
> Removing a Google account, or **Delete Drive data on this device**, deletes that
> account's cache and copies. Revoke irori in your Google Account's third-party
> connections to withdraw access. Copies held by your AI tool's history or its
> provider are deleted through their own controls. The publisher holds no copy,
> so there is nothing further to delete on request; questions go to the contact
> below.

## Assessment cost estimate

Checked 2026-10-01; USD/JPY 157.3 (open.er-api.com, 2026-10-01 00:02 UTC).
Google assigns the tier (assurance level), and the assessment repeats every
12 months. Google's verification itself has no fee. Prices exclude tax and card
fees and must be confirmed with a quote before purchase.

| Lab and plan | USD per app per year | About JPY |
| --- | --- | --- |
| TAC Security Tier 2 Basic (two revalidations) | 675 | 106,000 |
| TAC Security Tier 2 Premium (unlimited revalidations) | 855 | 134,000 |
| TAC Security Tier 2 Enterprise | 1,800 | 283,000 |
| Other Tier 2 labs (third-party survey) | 800–1,500+ | 126,000–236,000+ |
| TAC Security Tier 3 | 4,500 | 708,000 |
| Other Tier 3 labs (third-party survey) | 5,000–8,000+ | 787,000–1,258,000+ |

Sources: [TAC Security CASA FAQ](https://tacsecurity.com/esof-appsec-ada-casa-faqs/),
[Switch Labs provider survey](https://www.switchlabs.dev/post/casa-tier-2-tier-3-security-review-providers-pricing-and-the-cheapest-option),
[CASA Tier 2 overview](https://appdefensealliance.dev/casa/tier-2/tier2-overview).
Tier 2 is a developer-run scan validated by the lab; Tier 3 is a lab-run
penetration test. With no irori server, Tier 2 is the likely assignment, but
that is Google's decision.

## Work each recommendation implies

| Item | Owner of the work | Size |
| --- | --- | --- |
| Training-setting confirmation in each CLI's data-use notice | implementation | Done in the candidate |
| Kept-copy references, deletion with conversations and accounts, delete-all control | implementation | Medium |
| Encryption of kept copies and conversations, migration | implementation | Medium; reuses candidate key design |
| Cache age change and disk-encryption indicator | implementation | Small |
| Prompt delimiting in `prompts/` | implementation | Small |
| Provider training settings per supported CLI, with links | implementation, owner confirms | Small; recheck before submission |
| Assessment quote and schedule | owner | External |
| Final page, HTTPS deployment, Console Branding/Data Access, demo video | owner + implementation | After the above |
