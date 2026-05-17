# SEO Audit — calmdriver.pl

**Date:** 2026-05-17
**Site type:** Single-page landing site — local taxi driver recruitment (Białystok, Poland)
**Scope:** Full technical + on-page audit of `app/index.html`

---

## Executive Summary

The site is a well-designed single-page landing targeting drivers in Białystok. Core on-page basics (title, meta description) are in place, but the site has significant gaps across nearly every other SEO dimension: missing canonical, Open Graph, schema markup, robots.txt, sitemap, hreflang for the bilingual content, favicon, and no content beyond the single landing page. These are all fixable without a redesign.

**Top 5 priorities:**

1. Add canonical tag, robots.txt, and sitemap.xml
2. Add hreflang tags for Polish/English content
3. Add LocalBusiness JSON-LD schema
4. Add Open Graph / Twitter Card meta tags
5. Strengthen the H1 with a keyword

---

## Technical SEO Findings

### 1. No canonical tag

- **Issue:** No `<link rel="canonical">` on the page
- **Impact:** High — without it, Google may treat `http://`, `https://`, `www.`, non-`www.` variants as duplicate pages
- **Evidence:** Grep of `<head>` shows no canonical
- **Fix:** Add to `<head>`: `<link rel="canonical" href="https://calmdriver.pl/" />`
- **Priority:** High

---

### 2. No robots.txt

- **Issue:** No `robots.txt` file in the project
- **Impact:** High — Googlebot crawls without guidance; no sitemap reference
- **Evidence:** `app/` directory contains only `index.html`
- **Fix:** Create `app/robots.txt`:
  ```
  User-agent: *
  Allow: /
  Sitemap: https://calmdriver.pl/sitemap.xml
  ```
- **Priority:** High

---

### 3. No XML sitemap

- **Issue:** No `sitemap.xml`
- **Impact:** Medium — slows discovery and indexation signaling
- **Evidence:** No sitemap file found in project
- **Fix:** Create `app/sitemap.xml` with the single canonical URL:
  ```xml
  <?xml version="1.0" encoding="UTF-8"?>
  <urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
    <url>
      <loc>https://calmdriver.pl/</loc>
      <changefreq>monthly</changefreq>
      <priority>1.0</priority>
    </url>
  </urlset>
  ```
  Submit to Google Search Console.
- **Priority:** High

---

### 4. No hreflang for bilingual content

- **Issue:** The page has Polish and English content toggled via JavaScript (`data-lang-pl` / `data-lang-en`), but no `hreflang` annotations exist
- **Impact:** High — Google cannot reliably determine which language to serve to which audience; duplicate content risk between language variants
- **Evidence:** No `hreflang` attribute found in HTML; language toggle is JS-only
- **Fix (option A — self-referencing, simplest):** Add to `<head>`:
  ```html
  <link rel="alternate" hreflang="pl" href="https://calmdriver.pl/" />
  <link rel="alternate" hreflang="en" href="https://calmdriver.pl/" />
  <link rel="alternate" hreflang="x-default" href="https://calmdriver.pl/" />
  ```
  **Fix (option B — better):** Create separate `/en/` page with English-only content, then point hreflang to each URL.
- **Priority:** High

---

### 5. No favicon

- **Issue:** No `<link rel="icon">` in `<head>`, no favicon file
- **Impact:** Low (SEO), Medium (trust/brand) — browser tab shows blank; minor trust signal
- **Evidence:** No favicon link in head section
- **Fix:** Add a favicon file and `<link rel="icon" href="/favicon.ico">` in `<head>`
- **Priority:** Medium

---

### 6. No HTTPS in nginx config (vhost)

- **Issue:** `nginx/calmdriver.nginx.conf` only configures `listen 80` — no SSL/HTTPS block
- **Impact:** High if HTTPS is not active on server — Google uses HTTPS as a ranking signal
- **Evidence:** `calmdriver.nginx.conf` shows only port 80; however commit history references certbot, so HTTPS may be managed separately
- **Fix:** Verify HTTPS is live on the server (`curl -I https://calmdriver.pl`). If certbot is managing it, ensure HTTP → HTTPS redirect is in place. The vhost in the repo is incomplete documentation even if server-side HTTPS works.
- **Priority:** High (verify)

---

### 7. Render-blocking resources

- **Issue:** GSAP and ScrollTrigger loaded via synchronous `<script>` in `<head>` (no `defer` or `async`)
- **Impact:** Medium — delays First Contentful Paint and LCP
- **Evidence:** Lines 10–11 of `index.html`
- **Fix:** Add `defer` to both script tags:
  ```html
  <script src="https://cdnjs.cloudflare.com/ajax/libs/gsap/3.12.2/gsap.min.js" defer></script>
  <script src="https://cdnjs.cloudflare.com/ajax/libs/gsap/3.12.2/ScrollTrigger.min.js" defer></script>
  ```
- **Priority:** Medium

---

### 8. Google Fonts — no font-display

- **Issue:** Google Fonts loaded via standard `<link>` with no `font-display: swap` instruction; no `<link rel="preload">` for critical font files
- **Impact:** Medium — can cause FOIT (flash of invisible text) and hurt LCP
- **Evidence:** Line 9, standard Google Fonts URL without `&display=swap` already appended... actually `display=swap` IS in the URL (line 9). No preload though.
- **Fix:** Add preload for critical font subset:
  ```html
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />
  ```
  (already has `preconnect` to `fonts.googleapis.com` — add `fonts.gstatic.com` too)
- **Priority:** Low

---

## On-Page SEO Findings

### 9. H1 is generic — missing primary keyword

- **Issue:** H1 text is `"Zarabiaj na swoich zasadach"` (Earn on your own terms) — inspiring copy but zero keyword targeting
- **Impact:** High — H1 is the strongest on-page ranking signal; the primary keyword ("praca kierowca Białystok", "taxi Białystok", "Bolt Uber kierowca") is absent
- **Evidence:** Lines 1254–1265 of `index.html`
- **Fix:** Incorporate the core keyword naturally. Example: `"Zarabiaj jako kierowca w Białymstoku — na swoich zasadach"` or use a subtitle approach with an H1 that leads with location+role
- **Priority:** High

---

### 10. Title tag — good but could be improved

- **Issue:** `"CalmDriver Taxi — Zarabiaj jako kierowca w Białymstoku"` — has keyword and location, 57 chars. Solid.
- **Impact:** Low — acceptable as-is
- **Suggestion:** Consider leading with the keyword before the brand for non-branded searches: `"Praca kierowcy Białystok — Bolt, Uber, FreeNow | CalmDriver"`
- **Priority:** Low

---

### 11. Meta description — good

- **Issue:** Present, 155 chars, includes keywords, platforms, and location. Good.
- **Evidence:** Line 7
- **No action needed.**

---

### 12. No Open Graph / Twitter Card meta tags

- **Issue:** No `og:title`, `og:description`, `og:image`, `og:url`, `twitter:card`, etc.
- **Impact:** Medium — links shared on social/WhatsApp/Messenger render as plain text with no image; reduces CTR from social referrals
- **Evidence:** Grep of head returns no `og:` or `twitter:` tags
- **Fix:** Add to `<head>`:
  ```html
  <meta property="og:type" content="website" />
  <meta property="og:url" content="https://calmdriver.pl/" />
  <meta property="og:title" content="CalmDriver — Praca kierowcy Białystok | Bolt, Uber, FreeNow" />
  <meta property="og:description" content="Zarabiaj na platformach Bolt, Uber i FreeNow w Białymstoku. Własny samochód lub auto z naszej floty. Dołącz teraz." />
  <meta property="og:image" content="https://calmdriver.pl/og-image.jpg" />
  <meta name="twitter:card" content="summary_large_image" />
  ```
- **Priority:** Medium

---

### 13. No structured data (schema markup)

- **Issue:** No JSON-LD schema detected in static HTML
- **Impact:** High — LocalBusiness schema enables rich results in Google (address, phone, hours, reviews); missing a major trust and visibility opportunity
- **Note:** Schema injected by CMS plugins may not appear in static HTML — verify with [Google Rich Results Test](https://search.google.com/test/rich-results). If confirmed absent, add manually.
- **Fix:** Add to `<head>` or before `</body>`:
  ```html
  <script type="application/ld+json">
  {
    "@context": "https://schema.org",
    "@type": "LocalBusiness",
    "name": "CalmDriver Taxi",
    "url": "https://calmdriver.pl",
    "telephone": "+48739980388",
    "email": "calmdrivertaxi@gmail.com",
    "address": {
      "@type": "PostalAddress",
      "addressLocality": "Białystok",
      "addressCountry": "PL"
    },
    "description": "Praca kierowcy na platformach Bolt, Uber i FreeNow w Białymstoku. Wynajem aut z floty.",
    "areaServed": "Białystok"
  }
  </script>
  ```
- **Priority:** High

---

### 14. Image alt text — unverifiable, likely missing

- **Issue:** No `<img>` tags with `alt=` found in grep — decorative icons are emoji/SVG-based, which is fine, but any real images should have alt text
- **Impact:** Medium — alt text contributes to keyword context and accessibility
- **Evidence:** Grep for `alt=` returned nothing
- **Fix:** Audit any images present (especially in the rental/fleet section) and add descriptive alt text
- **Priority:** Medium

---

## Content Findings

### 15. Single-page site — very thin topical footprint

- **Issue:** The entire site is one landing page. There is no blog, no FAQ page, no city/neighborhood pages, no comparison pages
- **Impact:** High — single pages rank for 1–3 keywords at most; competitors with content can outrank on informational queries ("jak zostać kierowcą Bolt Białystok", "ile zarabia kierowca Uber", etc.)
- **Fix:** Consider adding:
  - A blog or guides section ("Jak zacząć pracę jako kierowca Bolt/Uber")
  - An FAQ page (structured with `FAQPage` schema)
  - A dedicated page for fleet/rental
- **Priority:** Medium (long-term)

---

### 16. Bilingual JS toggle — SEO risk

- **Issue:** Polish/English content is on the same URL, toggled by JavaScript. Google indexes the page once. It will likely index whichever language it encounters first in the DOM (Polish, since `data-lang-pl` spans appear first). English content is functionally invisible to search engines.
- **Impact:** Medium — English content gets no indexation; potential keyword stuffing if Google sees both language blocks simultaneously
- **Fix:** If English SEO matters, create a separate `/en/` route. If it's only for human visitors, the current approach is acceptable but English content will not rank.
- **Priority:** Medium

---

### 17. E-E-A-T signals are weak

- **Issue:** No author names, no business registration info, no reviews/testimonials with schema, no "About" page
- **Impact:** Medium — for a service business asking people to trust you with their livelihood, trust signals matter
- **Fix:** Add testimonials section with `Review` schema, link to social profiles, add company details to footer
- **Priority:** Medium

---

## Prioritized Action Plan

### Critical (do first)

1. Add `<link rel="canonical" href="https://calmdriver.pl/" />` to `<head>`
2. Create `robots.txt` with sitemap reference
3. Create `sitemap.xml` and submit to Google Search Console
4. Add `LocalBusiness` JSON-LD schema
5. Verify HTTPS is active and HTTP redirects to HTTPS

### High impact

6. Rework H1 to include primary keyword (kierowca + Białystok)
7. Add hreflang annotations for PL/EN content
8. Add Open Graph + Twitter Card meta tags

### Quick wins

9. Add `favicon.ico` + `<link rel="icon">`
10. Add `defer` to GSAP script tags
11. Add `<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />`

### Long-term

12. Create FAQ page with `FAQPage` schema
13. Add driver testimonials with `Review` schema
14. Consider separate `/en/` URL for English content
15. Start a content/blog section targeting informational queries
