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
  enable request returned "The certificate does not exist yet". After DNS was
  repaired, the custom domain was removed/re-added once following GitHub's
  provisioning troubleshooting instructions. Certificate issuance and anonymous
  HTTPS/browser acceptance remain pending; certificate validation is not bypassed.
- Privacy/use-license pages and Google review work remain in draft PR #146;
  those pages are not present in the currently deployed site.

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

The owner supplied the Search Console TXT value; no matching apex TXT was
visible at the latest external check. DNS insertion and the Console verification
result remain pending. Keep the generated value in the registrar/Console flow,
not application configuration.

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
