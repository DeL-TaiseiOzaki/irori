# irori website custom domain

The owner confirmed registration of **irori-ai.com** on 2026-09-30. The static
website remains hosted by GitHub Pages; no application server or registrar
hosting subscription is needed. This change prepares website URLs only and does
not change the desktop release, Google audience or OAuth verification status.

## Cutover state

- Registration: owner-confirmed at XServerドメイン.
- GitHub Pages: custom domain `irori-ai.com` configured. Website PR #147 is
  merged at `cb1846b`; Pages run `36691804740` successfully deployed that source.
- Public DNS: registry and Google resolver confirm `ns1.xdomain.ne.jp` through
  `ns3.xdomain.ne.jp`. Google and Cloudflare return exactly the four GitHub Pages
  A addresses; www points to `del-taiseiozaki.github.io`. No apex AAAA or CAA
  records were returned by Google's resolver. The owner completed the registrar
  changes; this workspace has no connected registrar account.
- HTTP acceptance: homepage and the old GitHub Pages URL return the deployed
  website; the old URL redirects to `http://irori-ai.com/` while HTTPS is pending.
  Anonymous HTTP browser acceptance passed on rerun after a transient document
  503: desktop/mobile, images, current 0.1.61 download targets, both languages,
  canonical metadata and search. Strict HTTPS still rejects the certificate
  hostname; successful HTTP checks do not establish HTTPS readiness.
- Canonical, language alternate, social preview and documentation
  download URLs: deployed for `https://irori-ai.com/`. Local build/browser checks
  and all PR verification/native package jobs passed before merge.
- HTTPS: no certificate reported yet and enforcement is currently false. An
  enable request returned "The certificate does not exist yet". GitHub's health
  result reported `InvalidDNSError` and a CAA `SERVFAIL`, although direct UDP and
  TCP queries to all three authoritative servers returned authoritative
  `NOERROR`; Google and Cloudflare also resolve the records. On 2026-10-01 the
  custom domain was removed and re-added again to restart provisioning after
  that mismatch. Certificate issuance and anonymous HTTPS/browser acceptance
  remain pending; certificate validation is not bypassed.
- Privacy/use-license pages and Google review work remain in draft PR #146;
  those pages are not present in the currently deployed site.

## HTTPS diagnosis for GitHub Support

Rechecked 2026-09-30 17:18–17:28 UTC (2026-10-01 JST), after the remove/re-add
restart. Nothing below has been sent to GitHub; contact GitHub Support only at
the owner's instruction.

- Repository Pages API: `cname: irori-ai.com`, `https_enforced: false`, no
  `https_certificate` object. Both hosts still present GitHub's `*.github.io`
  certificate, so strict HTTPS fails hostname validation. HTTP returns 200 at
  the apex, and `www` redirects to `http://irori-ai.com/`.
- Pages health, three completed polls 20 s apart: apex and `www` both report
  `dns_resolves: false`, `is_valid: false`, `InvalidDNSError` ("Domain's DNS
  record could not be retrieved") and `caa_error: Dnsruby::ServFail`. Earlier
  `202 {}` responses were checks in progress, not results.
- Authoritative servers `ns1` (157.112.147.232), `ns2` (35.75.232.118) and `ns3`
  (162.43.113.246) `.xdomain.ne.jp` were queried directly for A, AAAA, CAA, TXT,
  HTTPS, DS, DNSKEY, SOA and NS at the apex, `www`, `_acme-challenge` names and
  the GitHub Pages challenge name. Plain UDP, TCP, EDNS with DO, mixed-case
  names and RD all returned authoritative `NOERROR`/`NXDOMAIN`; no `SERVFAIL`,
  `REFUSED`, truncation or timeout. The nameservers have no AAAA records, and
  the zone is unsigned (no DS at `.com`), so no DNSSEC validation applies.
- Recursive resolvers (Google, Cloudflare, NextDNS DoH): apex returns exactly
  the four Pages A records, no AAAA, empty CAA with SOA
  `ns1.xdomain.ne.jp. root.xdomain.ne.jp. 0 10800 3600 604800 3600`; `www` is a
  CNAME to `del-taiseiozaki.github.io`. These checks ran from Japan.
- Outside Japan: [Let's Debug](https://letsdebug.net/) HTTP-01 tests, which
  include CAA checks and a Let's Encrypt staging attempt, returned OK for
  `irori-ai.com` (test 3186491) and `www.irori-ai.com` (test 3186492).

The certificate authority's view is therefore healthy; only GitHub's own DNS
health check fails. Leave the configuration unchanged until about 24 hours
after the 2026-09-30 DNS change, the propagation time GitHub documents. If the
certificate is still absent then, the owner can send the message below from
<https://support.github.com/contact> or move the zone to another DNS host
(for example Cloudflare, DNS-only, same records) as a fallback that avoids the
current nameservers.

```text
Subject: Pages HTTPS certificate not issued for irori-ai.com (health: InvalidDNSError / Dnsruby::ServFail)

Repository: DeL-TaiseiOzaki/irori (Pages via GitHub Actions)
Custom domain: irori-ai.com (www.irori-ai.com CNAME -> del-taiseiozaki.github.io)

The custom domain has been configured since 2026-09-30 and was removed and
re-added on 2026-10-01 (JST) as the documentation suggests. No certificate has
been issued and "Enforce HTTPS" is unavailable. The Pages health API reports
dns_resolves: false, InvalidDNSError and caa_error: Dnsruby::ServFail for both
the apex and www.

We cannot reproduce a DNS failure:
- Authoritative ns1/ns2/ns3.xdomain.ne.jp answer A/AAAA/CAA/TXT/SOA over UDP
  and TCP, with and without EDNS/DO, with NOERROR (aa=1). No DNSSEC.
- Google, Cloudflare and NextDNS resolvers return the four Pages A records
  (185.199.108-111.153), no AAAA, empty CAA; www is a CNAME to
  del-taiseiozaki.github.io.
- Let's Debug HTTP-01 checks (including CAA and a Let's Encrypt staging
  attempt) pass for both hosts (tests 3186491 and 3186492).
- HTTP is served correctly by Pages at http://irori-ai.com/.

Could you check why the Pages DNS health check fails for this domain and
retry certificate provisioning?
```

## GitHub and registrar steps

1. The owner can verify `irori-ai.com` in their GitHub account Settings → Pages
   before cutover. GitHub generates a TXT hostname/value; add exactly those
   values at the registrar and retain the record after verification. The token
   is account-specific and cannot be invented from the domain name.
2. At cutover, configure repository Pages with custom domain `irori-ai.com`
   **before** adding the hosting DNS records. This site's Actions deployment
   does not require a CNAME file in the repository. The old GitHub Pages URL
   redirects to the new domain, so coordinate the DNS change with this setting.
3. Add the following records to the authoritative DNS provider. For
   XServerドメイン, the apex Host field is empty (the domain itself); use the
   existing/default TTL and priority 0 where the form requires a value.

   | Host | Type | Value |
   | --- | --- | --- |
   | empty / apex | A | `185.199.108.153` |
   | empty / apex | A | `185.199.109.153` |
   | empty / apex | A | `185.199.110.153` |
   | empty / apex | A | `185.199.111.153` |
   | `www` | CNAME | `del-taiseiozaki.github.io` |

   The CNAME value contains no `https://` and no `/irori` path. If apex A or
   `www` records already exist, inspect and replace only conflicting web-hosting
   records; retain unrelated mail/TXT records. Confirm the domain uses the DNS
   provider whose records were edited. XServer's domain DNS service uses
   `ns1.xdomain.ne.jp`, `ns2.xdomain.ne.jp`, `ns3.xdomain.ne.jp`.
4. Merge/deploy the verified website cutover change. Confirm DNS answers, GitHub
   certificate issuance and HTTPS enforcement before announcing the new URL.
   Check both language documentation paths, images, search, download targets,
   canonical/alternate URLs and the old-site/www redirects from outside the account.
   DNS and certificates can take up to 24 hours according to GitHub's guide.

If cutover fails, restore the prior Pages custom-domain setting and deploy the
prior website commit while investigating. Do not declare the domain live from
registration or a successful local build alone.

## Google ownership verification after site activation

The owner added the Search Console TXT record. A fresh Google DNS response
returns the exact supplied value at the apex, and on 2026-10-01 the owner
reported that Search Console accepted it and opened the Domain Property.
Retain the record in DNS, not application configuration.

The Google Cloud project Owner opens Search Console, adds **Domain Property**
`irori-ai.com` (not a URL-prefix property), and adds the generated
`google-site-verification=...` TXT record at the apex. Verify that property before
using the domain in OAuth Branding. The future site inputs are:

- Authorized domain: `irori-ai.com`.
- Homepage: `https://irori-ai.com/`.
- Privacy: `https://irori-ai.com/docs/en/privacy/` after the page is finalized and
  deployed; it does not exist in the current published documentation.
- Terms: `https://irori-ai.com/docs/en/terms/` after finalization and deployment.

Domain verification is not Google restricted-scope approval. Keep the existing
Desktop OAuth client and its loopback flow; adding a website domain does not
require converting it to a Web OAuth client.

## Primary references

- [GitHub Pages custom-domain setup](https://docs.github.com/en/pages/configuring-a-custom-domain-for-your-github-pages-site/managing-a-custom-domain-for-your-github-pages-site)
- [GitHub account domain verification](https://docs.github.com/en/pages/configuring-a-custom-domain-for-your-github-pages-site/verifying-your-custom-domain-for-github-pages)
- [XServer domain DNS records](https://www.xdomain.ne.jp/manual/man_domain_dns_setting.php)
- [Google domain verification](https://support.google.com/cloud/answer/13804266?hl=en)
