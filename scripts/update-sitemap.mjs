/**
 * CalmDriver – Sitemap Updater
 * Regeneruje app/sitemap.xml na podstawie statycznych stron
 * oraz opublikowanych artykułów z articles-index.json.
 *
 * Wywoływany przez generate-article.mjs i generate-faq.mjs po każdej publikacji.
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = path.resolve(__dirname, '..');
const SITEMAP_PATH = path.join(PROJECT_ROOT, 'app', 'sitemap.xml');
const ARTICLES_INDEX_PATH = path.join(__dirname, 'articles-index.json');

const STATIC_PAGES = [
  { loc: 'https://calmdriver.pl/',      priority: '1.0', changefreq: 'monthly',  hreflang: true },
  { loc: 'https://calmdriver.pl/faq/',  priority: '0.8', changefreq: 'weekly',   hreflang: false },
  { loc: 'https://calmdriver.pl/blog/', priority: '0.8', changefreq: 'daily',    hreflang: false },
];

function buildUrlEntry({ loc, priority, changefreq, hreflang, date }) {
  const lastmod = date ? `\n    <lastmod>${date}</lastmod>` : '';
  const hreflangTags = hreflang ? `
    <xhtml:link rel="alternate" hreflang="pl" href="${loc}" />
    <xhtml:link rel="alternate" hreflang="en" href="${loc}" />` : '';
  return `  <url>
    <loc>${loc}</loc>${lastmod}${hreflangTags}
    <changefreq>${changefreq}</changefreq>
    <priority>${priority}</priority>
  </url>`;
}

export function regenerateSitemap() {
  const articles = fs.existsSync(ARTICLES_INDEX_PATH)
    ? JSON.parse(fs.readFileSync(ARTICLES_INDEX_PATH, 'utf-8')).articles
    : [];

  const entries = [
    ...STATIC_PAGES.map(p => buildUrlEntry(p)),
    ...articles
      .sort((a, b) => b.date.localeCompare(a.date))
      .map(a => buildUrlEntry({
        loc: `https://calmdriver.pl/blog/${a.slug}.html`,
        priority: '0.6',
        changefreq: 'monthly',
        date: a.date,
        hreflang: false,
      })),
  ];

  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"
        xmlns:xhtml="http://www.w3.org/1999/xhtml">
${entries.join('\n')}
</urlset>
`;

  fs.writeFileSync(SITEMAP_PATH, xml, 'utf-8');
  console.log(`🗺  sitemap.xml zaktualizowany (${entries.length} URL-i)`);
}

// Allow running standalone: node scripts/update-sitemap.mjs
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  regenerateSitemap();
}
