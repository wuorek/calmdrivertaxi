/**
 * CalmDriver - szablony HTML bloga (artykuł i strona główna bloga).
 * Wygląd opiera się na /css/site.css (klasy .article*, .breadcrumb, .related,
 * .cta-box, .post-list). Bez emoji i bez znaków U+2013/U+2014.
 */

import { relatedArticles, landingFor } from './blog-links.mjs';

const SITE_URL = 'https://calmdriver.pl';
const PHONE_DISPLAY = '739 980 388';
const PHONE_LINK = 'tel:+48739980388';

const MONTHS = [
  'stycznia', 'lutego', 'marca', 'kwietnia', 'maja', 'czerwca',
  'lipca', 'sierpnia', 'września', 'października', 'listopada', 'grudnia',
];

// ── Helpery ─────────────────────────────────────────────────────────────────

/** "2026-11-18" -> "18 listopada 2026" */
export function formatDate(isoDate) {
  const [y, m, d] = String(isoDate).split('-');
  return `${parseInt(d, 10)} ${MONTHS[parseInt(m, 10) - 1]} ${y}`;
}

/** Zamienia długie i średnie myślniki na zwykły "-". */
export function normalizeDashes(text) {
  return String(text).replace(/[–—]/g, '-');
}

/** Usuwa emoji i symbole graficzne (U+1F300-1FAFF, U+2600-27BF). */
export function stripEmoji(text) {
  return String(text).replace(/[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}\u{FE0F}\u{200D}]+[ \t]?/gu, '');
}

/** Tekst bez długich myślników i emoji. */
export function sanitizeText(text) {
  return normalizeDashes(stripEmoji(text));
}

/**
 * Tytuł zdaniowo, po polsku: wielka litera tylko na początku zdania i w nazwach własnych.
 * "Ile Naprawdę Zarobił" -> "Ile naprawdę zarobił", "co MUSISZ wiedzieć" -> "co musisz wiedzieć".
 */
const TITLE_KEEP = /^(Bolt|Bolta|Bolcie|Uber|Ubera|Uberze|FreeNow|Free|Now|CalmDriver|CalmDrivera|Białystok|Białymstoku|Białegostoku|Marek|Marka|Polska|Polsce|Polski|Ukrainy|Ukrainiec|Jagiellonii|Google|Android|Kia|Dacia|Skoda|Fabia|Venga|Sandero|Toyota|Prius|Corolla|UwB|PB|ZUS|PIT|VAT|OC|AC|NNW|UE|PKP|PKS|FAQ|GPS|SMS|BLIK|II|III|Ty|Ci|Cię|Ciebie|Tobie|Tobą|Twój|Twoja|Twoje|Twojego|Twojej|Twoim|Twoją|Twoich|Twoimi|Twoja)$/;
export function sentenceCaseTitle(title) {
  let start = true;
  return title.split(/(\s+)/).map(tok => {
    if (/^\s+$/.test(tok)) return tok;
    const m = tok.match(/^([^\p{L}\d]*)([\p{L}\d][\p{L}\d\-/'’]*)(.*)$/u);
    let out = tok;
    if (m) {
      const [, pre, word, post] = m;
      const isStart = start || /["„(]/.test(pre);
      if (word.length >= 3 && /^\p{Lu}+$/u.test(word) && !TITLE_KEEP.test(word)) {
        out = pre + (isStart ? word.charAt(0) + word.slice(1).toLowerCase() : word.toLowerCase()) + post;
      } else if (!isStart && /^\p{Lu}(\p{Ll}|$)/u.test(word) && !TITLE_KEEP.test(word.split(/[-/]/)[0])) {
        out = pre + word.charAt(0).toLowerCase() + word.slice(1) + post;
      }
    }
    start = /[?!.]$/.test(tok);
    return out;
  }).join('');
}

/** Escapuje tekst do HTML, nie psując już istniejących encji (&amp;, &quot; itd.). */
export function escapeHtml(text) {
  return sanitizeText(text)
    .replace(/&(?!(?:[a-zA-Z]+|#\d+|#x[0-9a-fA-F]+);)/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function jsonLd(data) {
  const json = JSON.stringify(data, null, 2).replace(/</g, '\\u003c');
  const indented = json.split('\n').map(line => `  ${line}`).join('\n');
  return `  <script type="application/ld+json">\n${indented}\n  </script>`;
}

function articleUrl(slug) {
  return `${SITE_URL}/blog/${slug}.html`;
}

// ── Wspólne elementy strony ─────────────────────────────────────────────────

const NAV_LINKS = [
  { href: '/praca-kierowca-bolt-bialystok/', label: 'Praca kierowca' },
  { href: '/praca-dla-studenta-bialystok/', label: 'Dla studenta' },
  { href: '/wynajem-auta-pod-taxi-bialystok/', label: 'Wynajem auta' },
  { href: '/blog/', label: 'Blog' },
  { href: '/faq/', label: 'FAQ' },
];

export function headLinks() {
  return `  <link rel="icon" type="image/svg+xml" href="/favicon.svg" />
  <link rel="alternate icon" href="/favicon.svg" type="image/svg+xml" />
  <link rel="preconnect" href="https://fonts.googleapis.com" />
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />
  <link href="https://fonts.googleapis.com/css2?family=Archivo:wght@700;800;900&family=Inter:wght@400;500;600&display=swap" rel="stylesheet" />
  <link rel="stylesheet" href="/css/site.css" />`;
}

export function siteHeader() {
  const nav = NAV_LINKS.map(link => {
    const current = link.href === '/blog/' ? ' aria-current="page"' : '';
    return `        <a href="${link.href}"${current}>${link.label}</a>`;
  }).join('\n');
  const mobile = NAV_LINKS.map(link => `      <a href="${link.href}">${link.label}</a>`).join('\n');

  return `<header class="site-header" id="home">
  <div class="container">
    <div class="header-inner">
      <a href="/" class="logo"><span class="logo-mark"></span>CalmDriver</a>

      <nav class="site-nav" aria-label="Menu główne">
${nav}
      </nav>

      <div class="header-actions">
        <a href="${PHONE_LINK}" class="header-phone">${PHONE_DISPLAY}</a>
        <button type="button" class="menu-btn" id="menu-btn" aria-label="Menu" aria-expanded="false" aria-controls="mobile-menu">
          <svg width="20" height="20" viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><path d="M2 5h16M2 10h16M2 15h16"></path></svg>
        </button>
      </div>
    </div>

    <div class="mobile-menu" id="mobile-menu">
${mobile}
      <a href="${PHONE_LINK}">${PHONE_DISPLAY}</a>
    </div>
  </div>
</header>`;
}

export function siteFooter() {
  return `<footer class="site-footer">
  <div class="container">
    <div class="footer-inner">
      <div class="footer-brand">
        <div class="footer-logo"><span class="logo-mark"></span>CalmDriver</div>
        <p>Partner flotowy Bolt, Uber i FreeNow.<br />ul. Antoniukowska, Białystok</p>
      </div>
      <div class="footer-col">
        <a href="/praca-kierowca-bolt-bialystok/">Praca kierowca Bolt</a>
        <a href="/praca-kierowca-uber-bialystok/">Praca kierowca Uber</a>
        <a href="/praca-kierowca-freenow-bialystok/">Praca kierowca FreeNow</a>
        <a href="/praca-dla-studenta-bialystok/">Praca dla studenta</a>
      </div>
      <div class="footer-col">
        <a href="/wynajem-auta-pod-taxi-bialystok/">Wynajem auta pod taxi</a>
        <a href="/taxi-bialystok/">Taxi Białystok</a>
        <a href="/blog/">Blog</a>
        <a href="/faq/">FAQ</a>
      </div>
      <div class="footer-col">
        <a href="${PHONE_LINK}" class="strong">${PHONE_DISPLAY}</a>
        <a href="mailto:calmdrivertaxi@gmail.com">calmdrivertaxi@gmail.com</a>
      </div>
    </div>
    <div class="footer-copy">&copy; 2026 CalmDriver Taxi</div>
  </div>
</footer>`;
}

export function stickyCta() {
  return `<div class="sticky-cta">
  <a href="${PHONE_LINK}" class="call">Zadzwoń</a>
  <a href="/#contact">Napisz</a>
</div>`;
}

// TODO: przenieść do site.css (elementy używane wewnątrz treści artykułów).
const ARTICLE_EXTRA_CSS = '';

// TODO: przenieść do site.css (nagłówek strony głównej bloga).
const BLOG_INDEX_EXTRA_CSS = '';

// ── Artykuł ─────────────────────────────────────────────────────────────────

function relatedBlock(article, allArticles) {
  const related = relatedArticles(article.slug, allArticles, 3);
  const landing = landingFor(article.title);

  const items = related.map(item =>
    `      <li><a href="/blog/${item.slug}.html">${escapeHtml(item.title)}</a></li>`
  );
  items.push(`      <li><a href="${landing.href}">${escapeHtml(landing.label)}</a></li>`);
  items.push('      <li><a href="/faq/">FAQ - najczęściej zadawane pytania</a></li>');

  return `<!-- related:start -->
    <section class="related">
      <h2>Powiązane artykuły</h2>
      <ul>
${items.join('\n')}
      </ul>
    </section>
    <!-- related:end -->`;
}

function asideBlock(article) {
  const landing = landingFor(article.title);
  const links = [
    landing,
    { href: '/praca-dla-studenta-bialystok/', label: 'Praca dla studenta Białystok' },
    { href: '/wynajem-auta-pod-taxi-bialystok/', label: 'Wynajem auta pod taxi' },
    { href: '/faq/', label: 'FAQ' },
  ];
  const seen = new Set();
  const unique = links.filter(link => {
    if (seen.has(link.href)) return false;
    seen.add(link.href);
    return true;
  });

  // Etykieta strony studenckiej z "250 zł" nie pasuje do bocznej listy - używamy neutralnej.
  const items = unique.map(link => {
    const label = link.href === '/praca-dla-studenta-bialystok/' ? 'Praca dla studenta Białystok' : link.label;
    return `        <a href="${link.href}">${escapeHtml(label)}</a>`;
  }).join('\n');

  return `<aside class="article-aside">
    <div class="aside-block">
      <div class="aside-title">Chcesz zacząć?</div>
      <p>Rejestrujemy w Bolt, Uber i FreeNow. 0% prowizji od obrotu przy własnym aucie.</p>
      <a href="${PHONE_LINK}" class="btn btn-primary">Zadzwoń: ${PHONE_DISPLAY}</a>
    </div>
    <div class="aside-block">
      <div class="aside-title">W tym temacie</div>
      <div class="aside-links">
${items}
      </div>
    </div>
  </aside>`;
}

function studentOfferBox() {
  return `<aside class="cta-box">
      <div class="cta-box-price">
        <strong>250 zł</strong>
        <span>1. tydzień auta</span>
      </div>
      <div class="cta-box-body">
        <strong>Dla ucznia i studenta do 26 lat</strong>
        <p>Potem od 350 zł/tydz. Na zleceniu bez ZUS i bez PIT.</p>
        <a href="/praca-dla-studenta-bialystok/">Praca dla studenta - warunki</a>
      </div>
    </aside>`;
}

export function buildArticleHTML(article, allArticles = []) {
  const { slug, category, readTime, date, body } = article;
  const title = escapeHtml(article.title);
  const excerpt = escapeHtml(article.excerpt);
  const description = escapeHtml(article.metaDescription || article.excerpt);
  const url = articleUrl(slug);
  const articles = allArticles.some(a => a.slug === slug) ? allArticles : [...allArticles, article];

  const articleJsonLd = jsonLd({
    '@context': 'https://schema.org',
    '@type': 'Article',
    headline: sanitizeText(article.title),
    description: sanitizeText(article.metaDescription || article.excerpt),
    datePublished: date,
    author: { '@type': 'Organization', name: 'CalmDriver Taxi', url: SITE_URL },
    publisher: { '@type': 'Organization', name: 'CalmDriver Taxi', url: SITE_URL },
    image: `${SITE_URL}/og-image.jpg`,
    mainEntityOfPage: { '@type': 'WebPage', '@id': url },
  });

  const breadcrumbJsonLd = jsonLd({
    '@context': 'https://schema.org',
    '@type': 'BreadcrumbList',
    itemListElement: [
      { '@type': 'ListItem', position: 1, name: 'Strona główna', item: `${SITE_URL}/` },
      { '@type': 'ListItem', position: 2, name: 'Blog', item: `${SITE_URL}/blog/` },
      { '@type': 'ListItem', position: 3, name: sanitizeText(article.title), item: url },
    ],
  });

  return `<!DOCTYPE html>
<html lang="pl">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>${title} | CalmDriver</title>
  <meta name="description" content="${description}" />
  <link rel="canonical" href="${url}" />
  <!-- Open Graph -->
  <meta property="og:type" content="article" />
  <meta property="og:url" content="${url}" />
  <meta property="og:title" content="${title}" />
  <meta property="og:description" content="${description}" />
  <meta property="og:image" content="${SITE_URL}/og-image.jpg" />
  <meta property="og:locale" content="pl_PL" />
  <meta property="article:published_time" content="${date}" />
  <!-- Twitter Card -->
  <meta name="twitter:card" content="summary_large_image" />
  <meta name="twitter:title" content="${title}" />
  <meta name="twitter:description" content="${description}" />
  <meta name="twitter:image" content="${SITE_URL}/og-image.jpg" />
${headLinks()}
${ARTICLE_EXTRA_CSS}
${articleJsonLd}
${breadcrumbJsonLd}
</head>
<body>

<!-- NAGLOWEK -->
${siteHeader()}

<main>
<div class="container article-layout">

  <article class="article">
    <nav class="breadcrumb" aria-label="Ścieżka nawigacji"><a href="/">Strona główna</a> &rsaquo; <a href="/blog/">Blog</a> &rsaquo; ${escapeHtml(category)}</nav>

    <div class="article-meta">
      <span class="tag">${escapeHtml(category)}</span>
      <span>${escapeHtml(readTime)} czytania</span>
      <span>${formatDate(date)}</span>
    </div>

    <h1>${title}</h1>
    <p class="article-lead">${excerpt}</p>

    <div class="article-body">
${body}
    </div>

    ${studentOfferBox()}

    ${relatedBlock(article, articles)}
  </article>

  ${asideBlock(article)}

</div>
</main>

<!-- STOPKA -->
${siteFooter()}

<!-- PRZYKLEJONY PASEK CTA (TELEFON) -->
${stickyCta()}

<script src="/js/site.js"></script>
</body>
</html>
`;
}

// ── Strona główna bloga ─────────────────────────────────────────────────────

/** Grupuje artykuły po kategoriach; kategoria z najnowszym wpisem jest pierwsza. */
function groupByCategory(articles) {
  const sorted = [...articles].sort((a, b) => String(b.date).localeCompare(String(a.date)));
  const groups = new Map();
  for (const article of sorted) {
    const key = article.category || 'Porady';
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(article);
  }
  return [...groups.entries()];
}

function blogPostItem(article) {
  return `      <li>
        <div>
          <a class="post-title" href="/blog/${article.slug}.html">${escapeHtml(article.title)}</a>
          <p class="post-excerpt">${escapeHtml(article.excerpt)}</p>
        </div>
        <span class="post-tag">${formatDate(article.date)} · ${escapeHtml(article.readTime)}</span>
      </li>`;
}

export function buildBlogIndexHTML(articles) {
  const description = 'Porady dla kierowców Bolt, Uber i FreeNow w Białymstoku. Dowiedz się, ile możesz zarobić, jak zacząć i jak wybrać najlepszą platformę.';
  const url = `${SITE_URL}/blog/`;

  const sections = groupByCategory(articles).map(([category, items]) => `<section class="container section">
  <div class="section-head">
    <h2 class="section-title">${escapeHtml(category)}</h2>
  </div>
  <ul class="post-list">
${items.map(blogPostItem).join('\n')}
  </ul>
</section>`).join('\n\n');

  const body = articles.length > 0
    ? sections
    : `<section class="container section">
  <p class="section-lead">Pierwsze artykuły pojawią się wkrótce.</p>
  <p class="section-note"><a href="/">Wróć na stronę główną</a></p>
</section>`;

  const blogJsonLd = jsonLd({
    '@context': 'https://schema.org',
    '@type': 'Blog',
    name: 'Blog CalmDriver Taxi Białystok',
    url,
    description,
  });

  return `<!DOCTYPE html>
<html lang="pl">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>Blog - CalmDriver Taxi Białystok</title>
  <meta name="description" content="${description}" />
  <link rel="canonical" href="${url}" />
  <!-- Open Graph -->
  <meta property="og:type" content="website" />
  <meta property="og:url" content="${url}" />
  <meta property="og:title" content="Blog - Porady dla kierowców | CalmDriver Taxi Białystok" />
  <meta property="og:description" content="${description}" />
  <meta property="og:image" content="${SITE_URL}/og-image.jpg" />
  <meta property="og:locale" content="pl_PL" />
${headLinks()}
${BLOG_INDEX_EXTRA_CSS}
${blogJsonLd}
</head>
<body>

<!-- NAGLOWEK -->
${siteHeader()}

<main>

<section class="container page-intro">
  <nav class="breadcrumb" aria-label="Ścieżka nawigacji"><a href="/">Strona główna</a> &rsaquo; Blog</nav>
  <h1 class="section-title">Porady dla kierowców Bolt, Uber i FreeNow</h1>
  <p class="section-lead">Zarobki, wynajem auta, formalności i pierwsze kroki w Białymstoku - wszystko, co warto wiedzieć, zanim zaczniesz jeździć.</p>
</section>

<!-- BLOG_CARDS_START -->
${body}
<!-- BLOG_CARDS_END -->

</main>

<!-- STOPKA -->
${siteFooter()}

<!-- PRZYKLEJONY PASEK CTA (TELEFON) -->
${stickyCta()}

<script src="/js/site.js"></script>
</body>
</html>
`;
}
