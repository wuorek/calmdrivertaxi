#!/usr/bin/env node
/**
 * CalmDriver – Auto Blog Article Generator
 * Generuje nowy artykuł blogowy przez Gemini REST API, zapisuje jako HTML,
 * aktualizuje blog/index.html i pushuje do GitHub.
 * GitHub Actions automatycznie deployuje po każdym pushu.
 *
 * Zero zewnętrznych dependencji – używa natywnego fetch (Node 18+).
 *
 * Wymagane zmienne środowiskowe:
 *   GEMINI_API_KEY  – klucz API Google AI Studio
 *
 * Opcjonalne:
 *   BOT_GIT_NAME    – nazwa autora commita (domyślnie: CalmDriver Bot)
 *   BOT_GIT_EMAIL   – email autora commita (domyślnie: bot@calmdriver.pl)
 *   GIT_BRANCH      – gałąź docelowa (domyślnie: main)
 */

import fs from 'fs';
import path from 'path';
import { execSync } from 'child_process';
import { fileURLToPath } from 'url';
import { regenerateSitemap } from './update-sitemap.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = path.resolve(__dirname, '..');
const BLOG_DIR = path.join(PROJECT_ROOT, 'app', 'blog');
const BLOG_INDEX_PATH = path.join(BLOG_DIR, 'index.html');
const ARTICLES_INDEX_PATH = path.join(__dirname, 'articles-index.json');
const QUEUE_PATH = path.join(__dirname, 'articles-queue.json');

// ── Config ────────────────────────────────────────────────────────────────────

const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
const GIT_AUTHOR_NAME = process.env.BOT_GIT_NAME || 'CalmDriver Bot';
const GIT_AUTHOR_EMAIL = process.env.BOT_GIT_EMAIL || 'bot@calmdriver.pl';
const GIT_BRANCH = process.env.GIT_BRANCH || 'main';

if (!GEMINI_API_KEY) {
  console.error('❌ Brak GEMINI_API_KEY. Ustaw zmienną środowiskową i spróbuj ponownie.');
  process.exit(1);
}

// ── Keyword Queue ─────────────────────────────────────────────────────────────

function getNextKeyword(skipKeywords = []) {
  if (!fs.existsSync(QUEUE_PATH)) return null;
  const queue = JSON.parse(fs.readFileSync(QUEUE_PATH, 'utf-8'));
  const next = queue.queue
    .filter(k => k.status === 'pending' && !skipKeywords.includes(k.keyword))
    .sort((a, b) => a.priority - b.priority)[0];
  return next || null;
}

function markKeywordStatus(keyword, status = 'done') {
  const queue = JSON.parse(fs.readFileSync(QUEUE_PATH, 'utf-8'));
  const item = queue.queue.find(k => k.keyword === keyword);
  if (item) {
    item.status = status;
    if (status === 'done') item.published_date = new Date().toISOString().split('T')[0];
    if (status === 'skipped') item.skipped_date = new Date().toISOString().split('T')[0];
    fs.writeFileSync(QUEUE_PATH, JSON.stringify(queue, null, 2), 'utf-8');
  }
}

// ── Articles Index ────────────────────────────────────────────────────────────

function getArticlesIndex() {
  if (!fs.existsSync(ARTICLES_INDEX_PATH)) return { articles: [] };
  return JSON.parse(fs.readFileSync(ARTICLES_INDEX_PATH, 'utf-8'));
}

function saveArticlesIndex(index) {
  fs.writeFileSync(ARTICLES_INDEX_PATH, JSON.stringify(index, null, 2), 'utf-8');
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function slugify(title) {
  const pl = {
    'ą':'a','ć':'c','ę':'e','ł':'l','ń':'n','ó':'o','ś':'s','ź':'z','ż':'z',
    'Ą':'a','Ć':'c','Ę':'e','Ł':'l','Ń':'n','Ó':'o','Ś':'s','Ź':'z','Ż':'z',
  };
  return title
    .replace(/[ąćęłńóśźżĄĆĘŁŃÓŚŹŻ]/g, c => pl[c] || c)
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, '')
    .trim()
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .substring(0, 70);
}

function formatDate(isoDate) {
  const [y, m, d] = isoDate.split('-');
  const months = ['sty','lut','mar','kwi','maj','cze','lip','sie','wrz','paź','lis','gru'];
  return `${parseInt(d)} ${months[parseInt(m) - 1]} ${y}`;
}

function isDuplicate(newTitle, existingArticles) {
  const stopwords = new Set(['w','i','z','na','do','jak','ile','co','za','od','po','się','nie','jest','to','czy','oraz','lub','dla','przez','przy','też','już','ten','ta','te','tego','tej','tym','jako','białystok','białymstoku']);
  const tokenize = t => t.toLowerCase()
    .replace(/[^a-ząćęłńóśźż0-9\s]/g, '')
    .split(/\s+/)
    .filter(w => w.length > 2 && !stopwords.has(w));

  const newWords = new Set(tokenize(newTitle));

  return existingArticles.some(a => {
    const existWords = new Set(tokenize(a.title));
    const intersection = [...newWords].filter(w => existWords.has(w)).length;
    const union = new Set([...newWords, ...existWords]).size;
    return union > 0 && intersection / union >= 0.65;
  });
}

// ── Gemini API ────────────────────────────────────────────────────────────────

async function generateArticle(existingArticles, targetKeyword = null) {
  const today = new Date().toISOString().split('T')[0];
  const currentYear = new Date().getFullYear();

  const existingList = existingArticles.length > 0
    ? existingArticles.map((a, i) => `${i + 1}. ${a.title}`).join('\n')
    : '(brak – to będzie pierwszy artykuł)';

  const keywordSection = targetKeyword
    ? `FRAZA KLUCZOWA: "${targetKeyword}"\nNapisz artykuł odpowiadający na intencję tej frazy. Wpleć ją w tytuł i treść naturalnie (max 3-4 razy). Jeśli fraza zawiera rok lub go sugeruje – użyj ${currentYear}.`
    : `TEMAT: Wybierz unikalny temat związany z pracą kierowcy na platformach Bolt/Uber/FreeNow w Białymstoku, którego jeszcze nie ma na liście powyżej.`;

  const prompt = `Jesteś ekspertem od pracy kierowcy na platformach Bolt, Uber i FreeNow w Białymstoku. Piszesz dla firmy CalmDriver Taxi – fleet partnera pomagającego kierowcom zacząć zarabiać w Białymstoku. Piszesz szczerze i konkretnie dla potencjalnych kierowców.

ISTNIEJĄCE ARTYKUŁY – NIE POWTARZAJ TEMATÓW:
${existingList}

${keywordSection}

GŁOS I STYL:
- Pierwsza osoba liczby mnogiej: "W CalmDriver widzimy...", "Nasi kierowcy zarabiają...", "Regularnie pomagamy..."
- Szczerość: mów co jest trudne, ile naprawdę można zarobić, gdzie są pułapki
- Każde zdanie niesie konkretną informację – zero wypełniaczy
- Nie używaj: "kompleksowo", "profesjonalnie", "najwyższa jakość", "niezwykle ważny"

OBOWIĄZKOWE ELEMENTY LOKALNE (wpleć 2-3 naturalnie):
- Białostockie realia: centrum, Galeria Biała, Alfacenter, dworzec PKP, lotnisko Krywlany
- Białostockie osiedla: Piasta, Antoniuk, Słoneczny Stok, Bojary, Nowe Miasto, Skorupy
- Białostocki rynek pracy i specyfika – miasto studenckie, UwB, PB

KONKRETNE DANE:
- Zarobki kierowcy w Białymstoku ${currentYear}: 18-28 zł/h netto na start, 25-38 zł/h dla doświadczonych
- Wynajem auta w CalmDriver: 700 zł/tydzień standard, 550 zł/tydzień dla studentów
- Platformy: Bolt (dominujący w Białymstoku), Uber, FreeNow
- Rejestracja na platformach: 1-2 dni robocze z pomocą CalmDriver

STRUKTURA ARTYKUŁU:
- Wstęp (2-3 zdania): konkretna sytuacja którą czytelnik rozpozna
- 4-5 sekcji H2 z praktyczną wiedzą
- Listy punktowane z **pogrubionymi kluczowymi danymi**
- Zakończenie z CTA: "Zadzwoń do CalmDriver: 739 980 388 lub napisz na calmdrivertaxi@gmail.com"

DŁUGOŚĆ: 800-1100 słów

ZWRÓĆ WYŁĄCZNIE JSON (bez markdown, bez tekstu przed/po):
{
  "title": "...",
  "excerpt": "...",
  "category": "...",
  "readTime": "X min",
  "date": "${today}",
  "body": "...pełny HTML artykułu (tylko tagi h2, p, ul, li, strong, a — bez html/head/body)..."
}

Kategoria musi być JEDNĄ z: Zarobki | Platformy | Wynajem | Porady | Prawo i podatki`;

  const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${GEMINI_API_KEY}`;

  const response = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      contents: [{ parts: [{ text: prompt }] }],
      generationConfig: { temperature: 0.85, maxOutputTokens: 8192 },
    }),
  });

  if (!response.ok) {
    const err = await response.text();
    throw new Error(`Gemini API ${response.status}: ${err}`);
  }

  const data = await response.json();
  const text = data?.candidates?.[0]?.content?.parts?.[0]?.text;
  if (!text) throw new Error('Pusta odpowiedź od Gemini API');
  return text;
}

function parseGeneratedArticle(raw) {
  const cleaned = raw
    .replace(/^```(?:json)?\s*\n?/im, '')
    .replace(/\n?```\s*$/im, '')
    .trim();

  let parsed;
  try {
    parsed = JSON.parse(cleaned);
  } catch {
    throw new Error('Niepoprawny JSON od Gemini.\n\nOtrzymano:\n' + cleaned.substring(0, 500));
  }

  const { title, excerpt, category, readTime, date, body } = parsed;
  if (!title || !excerpt || !body) {
    throw new Error('Brakujące pola w odpowiedzi: ' + JSON.stringify(parsed).substring(0, 300));
  }

  return {
    title,
    excerpt,
    category: category || 'Porady',
    readTime: readTime || '5 min',
    date: date || new Date().toISOString().split('T')[0],
    body,
  };
}

// ── Article HTML Builder ──────────────────────────────────────────────────────

function buildArticleHTML(article, slug) {
  const { title, excerpt, category, readTime, date, body } = article;
  const formattedDate = formatDate(date);
  const canonicalUrl = `https://calmdriver.pl/blog/${slug}.html`;

  return `<!DOCTYPE html>
<html lang="pl">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>${title} — CalmDriver Taxi Białystok</title>
  <meta name="description" content="${excerpt}" />
  <link rel="canonical" href="${canonicalUrl}" />
  <link rel="icon" type="image/svg+xml" href="/favicon.svg" />
  <meta property="og:type" content="article" />
  <meta property="og:url" content="${canonicalUrl}" />
  <meta property="og:title" content="${title}" />
  <meta property="og:description" content="${excerpt}" />
  <meta property="og:image" content="https://calmdriver.pl/og-image.jpg" />
  <link rel="preconnect" href="https://fonts.googleapis.com" />
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />
  <link href="https://fonts.googleapis.com/css2?family=Inter:wght@300;400;500;600;700;800&family=Space+Grotesk:wght@500;700;800&display=swap" rel="stylesheet" />
  <script type="application/ld+json">
  {
    "@context": "https://schema.org",
    "@type": "Article",
    "headline": "${title.replace(/"/g, '\\"')}",
    "description": "${excerpt.replace(/"/g, '\\"')}",
    "datePublished": "${date}",
    "publisher": {
      "@type": "Organization",
      "name": "CalmDriver Taxi",
      "url": "https://calmdriver.pl"
    }
  }
  </script>
  <style>
    *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
    :root {
      --bg: #07070d; --surface: #0e0e18; --card: #13131f;
      --border: #1f1f35; --border2: #2a2a45;
      --gold: #f5c518; --gold2: #ffd84d; --gold-dim: rgba(245,197,24,0.12);
      --green: #00d4a0; --text: #f0f0fa; --muted: #7070a0; --muted2: #9090b8;
      --radius: 16px;
    }
    html { scroll-behavior: smooth; }
    body {
      font-family: 'Inter', sans-serif;
      background: var(--bg); color: var(--text);
      overflow-x: hidden; line-height: 1.6;
    }
    nav {
      position: sticky; top: 0; z-index: 100;
      padding: 0 clamp(20px, 5vw, 80px); height: 70px;
      display: flex; align-items: center; justify-content: space-between;
      background: rgba(7,7,13,0.95); backdrop-filter: blur(20px);
      border-bottom: 1px solid var(--border);
    }
    .nav-logo { display: flex; align-items: center; gap: 10px; text-decoration: none; }
    .nav-logo-icon { width: 36px; height: 36px; background: var(--gold); border-radius: 9px; display: flex; align-items: center; justify-content: center; font-size: 17px; }
    .nav-logo-text { font-family: 'Space Grotesk', sans-serif; font-weight: 800; font-size: 1.1rem; color: var(--text); }
    .nav-logo-text span { color: var(--gold); }
    .nav-right { display: flex; align-items: center; gap: 20px; }
    .nav-right a { color: var(--muted2); text-decoration: none; font-size: 0.875rem; font-weight: 500; transition: color 0.2s; }
    .nav-right a:hover { color: var(--text); }
    .nav-cta { padding: 8px 20px; background: var(--gold); color: #000 !important; border-radius: 8px; font-weight: 700; font-size: 0.85rem; }
    .nav-cta:hover { background: var(--gold2) !important; }

    .article-wrap {
      max-width: 740px; margin: 0 auto;
      padding: 60px clamp(20px, 5vw, 40px) 100px;
    }
    .article-back {
      display: inline-flex; align-items: center; gap: 6px;
      color: var(--muted2); text-decoration: none; font-size: 0.875rem; font-weight: 500;
      margin-bottom: 40px; transition: color 0.2s;
    }
    .article-back:hover { color: var(--gold); }
    .article-meta {
      display: flex; align-items: center; gap: 10px; flex-wrap: wrap;
      margin-bottom: 20px;
    }
    .article-cat {
      font-size: 0.7rem; font-weight: 700; text-transform: uppercase; letter-spacing: 1.2px;
      color: var(--gold); background: var(--gold-dim);
      border: 1px solid rgba(245,197,24,0.2); border-radius: 6px; padding: 3px 10px;
    }
    .article-time { font-size: 0.78rem; color: var(--muted); font-weight: 500; }
    .article-date { font-size: 0.78rem; color: var(--muted); }
    .article-title {
      font-family: 'Space Grotesk', sans-serif;
      font-size: clamp(1.7rem, 4vw, 2.6rem);
      font-weight: 800; letter-spacing: -1.5px; line-height: 1.15;
      margin-bottom: 20px;
    }
    .article-excerpt {
      font-size: 1.1rem; color: var(--muted2); line-height: 1.75;
      padding-bottom: 36px; border-bottom: 1px solid var(--border);
      margin-bottom: 44px;
    }
    .article-body h2 {
      font-family: 'Space Grotesk', sans-serif;
      font-size: 1.4rem; font-weight: 700; letter-spacing: -0.5px;
      color: var(--text); margin: 44px 0 16px;
      padding-left: 16px; border-left: 3px solid var(--gold);
    }
    .article-body p { color: var(--muted2); line-height: 1.8; margin-bottom: 18px; font-size: 1rem; }
    .article-body p:last-child { margin-bottom: 0; }
    .article-body strong { color: var(--text); font-weight: 600; }
    .article-body ul, .article-body ol { color: var(--muted2); padding-left: 20px; margin-bottom: 18px; }
    .article-body li { margin-bottom: 8px; line-height: 1.75; font-size: 1rem; }
    .article-body a { color: var(--gold); text-decoration: none; font-weight: 500; }
    .article-body a:hover { text-decoration: underline; }

    .article-cta {
      margin-top: 60px; padding: 36px;
      background: var(--card); border: 1px solid var(--border); border-radius: var(--radius);
      text-align: center;
    }
    .article-cta h3 {
      font-family: 'Space Grotesk', sans-serif;
      font-size: 1.3rem; font-weight: 800; margin-bottom: 10px;
    }
    .article-cta h3 span { color: var(--gold); }
    .article-cta p { color: var(--muted2); margin-bottom: 24px; font-size: 0.95rem; }
    .article-cta a {
      display: inline-block; padding: 14px 32px;
      background: var(--gold); color: #000;
      font-weight: 800; font-size: 0.95rem; border-radius: 10px;
      text-decoration: none; transition: background 0.2s, transform 0.2s;
    }
    .article-cta a:hover { background: var(--gold2); transform: translateY(-1px); }

    footer {
      border-top: 1px solid var(--border);
      padding: 32px clamp(20px, 5vw, 80px);
      display: flex; flex-wrap: wrap;
      align-items: center; justify-content: space-between; gap: 16px;
    }
    .footer-logo { display: flex; align-items: center; gap: 8px; text-decoration: none; }
    .footer-logo-icon { width: 30px; height: 30px; background: var(--gold); border-radius: 7px; display: flex; align-items: center; justify-content: center; font-size: 14px; }
    .footer-logo-text { font-family: 'Space Grotesk', sans-serif; font-weight: 800; font-size: 0.95rem; color: var(--text); }
    .footer-logo-text span { color: var(--gold); }
    .footer-copy { color: var(--muted); font-size: 0.8rem; }
    .footer-links { display: flex; gap: 20px; flex-wrap: wrap; }
    .footer-links a { color: var(--muted2); text-decoration: none; font-size: 0.82rem; font-weight: 500; transition: color 0.2s; }
    .footer-links a:hover { color: var(--gold); }

    @media (max-width: 600px) { .nav-right a:not(.nav-cta) { display: none; } }
  </style>
</head>
<body>

<nav>
  <a href="/" class="nav-logo">
    <div class="nav-logo-icon">🚕</div>
    <div class="nav-logo-text">Calm<span>Driver</span></div>
  </a>
  <div class="nav-right">
    <a href="/blog/">← Blog</a>
    <a href="/">Strona główna</a>
    <a href="/#contact" class="nav-cta">Dołącz teraz</a>
  </div>
</nav>

<article class="article-wrap">
  <a href="/blog/" class="article-back">← Wszystkie artykuły</a>

  <div class="article-meta">
    <span class="article-cat">${category}</span>
    <span class="article-time">${readTime} czytania</span>
    <span class="article-date">${formattedDate}</span>
  </div>

  <h1 class="article-title">${title}</h1>
  <p class="article-excerpt">${excerpt}</p>

  <div class="article-body">
    ${body}
  </div>

  <div class="article-cta">
    <h3>Gotowy żeby <span>zacząć zarabiać?</span></h3>
    <p>Skontaktuj się z CalmDriver — pomożemy Ci przejść rejestrację i ruszyć z pierwszymi zleceniami w Białymstoku.</p>
    <a href="/#contact">Dołącz do CalmDriver →</a>
  </div>
</article>

<footer>
  <a href="/" class="footer-logo">
    <div class="footer-logo-icon">🚕</div>
    <div class="footer-logo-text">Calm<span>Driver</span> Taxi</div>
  </a>
  <div class="footer-copy">© 2025 CalmDriver Taxi · Białystok</div>
  <div class="footer-links">
    <a href="/blog/">Blog</a>
    <a href="/">Strona główna</a>
    <a href="/#contact">Kontakt</a>
    <a href="tel:+48739980388">📞 739 980 388</a>
  </div>
</footer>

</body>
</html>`;
}

// ── Blog Index Regeneration ───────────────────────────────────────────────────

function buildBlogCard(article) {
  const { title, excerpt, category, readTime, date, slug } = article;
  const formattedDate = formatDate(date);
  return `    <a href="/blog/${slug}.html" class="blog-card">
      <div class="blog-card-body">
        <div class="blog-card-meta">
          <span class="blog-card-cat">${category}</span>
          <span class="blog-card-time">${readTime} czytania</span>
          <span class="blog-card-date">${formattedDate}</span>
        </div>
        <h2>${title}</h2>
        <p>${excerpt}</p>
      </div>
      <div class="blog-card-footer">Czytaj artykuł →</div>
    </a>`;
}

function regenerateBlogIndex(articles) {
  let html = fs.readFileSync(BLOG_INDEX_PATH, 'utf-8');

  const sorted = [...articles].sort((a, b) => b.date.localeCompare(a.date));

  const cardsHTML = sorted.length > 0
    ? `  <div class="blog-grid">\n${sorted.map(buildBlogCard).join('\n')}\n  </div>`
    : `  <div class="blog-empty">
    <p>Pierwsze artykuły pojawią się wkrótce.</p>
    <a href="/">← Wróć na stronę główną</a>
  </div>`;

  html = html.replace(
    /<!-- BLOG_CARDS_START -->[\s\S]*?<!-- BLOG_CARDS_END -->/,
    `<!-- BLOG_CARDS_START -->\n${cardsHTML}\n  <!-- BLOG_CARDS_END -->`
  );

  fs.writeFileSync(BLOG_INDEX_PATH, html, 'utf-8');
}

// ── Main ──────────────────────────────────────────────────────────────────────

async function main() {
  const today = new Date().toISOString().split('T')[0];
  console.log(`\n📅 ${today} | CalmDriver Blog Generator`);

  const index = getArticlesIndex();
  console.log(`ℹ Opublikowane artykuły: ${index.articles.length}`);

  const MAX_RETRIES = 5;
  const skippedKeywords = [];
  let article = null;
  let usedKeyword = null;

  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    const nextKeyword = getNextKeyword(skippedKeywords);
    usedKeyword = nextKeyword;

    if (nextKeyword) {
      console.log(`🎯 Fraza z kolejki (priorytet ${nextKeyword.priority}): "${nextKeyword.keyword}"`);
    } else {
      console.log('📝 Kolejka fraz pusta — wybieram temat autonomicznie');
    }

    console.log('🤖 Generuję artykuł przez Gemini API...');
    let raw;
    try {
      raw = await generateArticle(index.articles, nextKeyword?.keyword || null);
    } catch (err) {
      console.error('❌ Błąd Gemini API:', err.message);
      process.exit(1);
    }

    let parsed;
    try {
      parsed = parseGeneratedArticle(raw);
    } catch (err) {
      console.error('❌ Błąd parsowania:', err.message);
      process.exit(1);
    }

    if (isDuplicate(parsed.title, index.articles)) {
      console.warn(`⚠️  Artykuł "${parsed.title}" zbyt podobny do istniejącego.`);
      if (nextKeyword) {
        markKeywordStatus(nextKeyword.keyword, 'skipped');
        skippedKeywords.push(nextKeyword.keyword);
        console.log(`🔄 Próbuję kolejną frazę (próba ${attempt}/${MAX_RETRIES})...`);
      } else {
        console.log(`🔄 Próbuję ponownie autonomicznie (próba ${attempt}/${MAX_RETRIES})...`);
      }
      article = null;
      continue;
    }

    article = parsed;
    break;
  }

  if (!article) {
    console.warn(`⚠️  Nie udało się wygenerować unikalnego artykułu po ${MAX_RETRIES} próbach.`);
    process.exit(0);
  }

  const slug = slugify(article.title);
  const articlePath = path.join(BLOG_DIR, `${slug}.html`);

  if (fs.existsSync(articlePath)) {
    console.warn(`⚠️  Plik ${slug}.html już istnieje. Pomijam.`);
    process.exit(0);
  }

  // Write article HTML
  const articleHTML = buildArticleHTML(article, slug);
  fs.writeFileSync(articlePath, articleHTML, 'utf-8');
  console.log(`✅ Artykuł zapisany: app/blog/${slug}.html`);
  console.log(`   Tytuł:    ${article.title}`);
  console.log(`   Kategoria: ${article.category} | Czas: ${article.readTime}`);

  // Update articles index
  index.articles.push({ slug, title: article.title, excerpt: article.excerpt, category: article.category, readTime: article.readTime, date: article.date });
  saveArticlesIndex(index);

  // Regenerate blog index
  regenerateBlogIndex(index.articles);
  console.log('📝 blog/index.html zaktualizowany');

  // Regenerate sitemap
  regenerateSitemap();

  // Git commit & push
  const gitEnv = {
    ...process.env,
    GIT_AUTHOR_NAME,
    GIT_AUTHOR_EMAIL,
    GIT_COMMITTER_NAME: GIT_AUTHOR_NAME,
    GIT_COMMITTER_EMAIL: GIT_AUTHOR_EMAIL,
  };

  const commitMsg = `feat(blog): ${article.title.substring(0, 72)}`;

  try {
    execSync(`git -C "${PROJECT_ROOT}" pull --rebase --autostash origin ${GIT_BRANCH}`, { stdio: 'pipe' });

    if (usedKeyword) markKeywordStatus(usedKeyword.keyword, 'done');

    execSync(`git -C "${PROJECT_ROOT}" add "app/blog/${slug}.html" "app/blog/index.html" "app/sitemap.xml" "scripts/articles-index.json"`, { stdio: 'pipe' });
    if (usedKeyword || skippedKeywords.length > 0) {
      execSync(`git -C "${PROJECT_ROOT}" add "scripts/articles-queue.json"`, { stdio: 'pipe' });
    }
    execSync(`git -C "${PROJECT_ROOT}" commit -m "${commitMsg}"`, { env: gitEnv, stdio: 'pipe' });
    console.log('📦 Commit utworzony');

    execSync(`git -C "${PROJECT_ROOT}" push origin ${GIT_BRANCH}`, { stdio: 'inherit' });
    console.log('🚀 Wypchnięto do GitHub → CI/CD zadeplojuje automatycznie');
    console.log(`🎉 Gotowe! Artykuł "${article.title}" niedługo będzie live.\n`);

  } catch (err) {
    console.error('❌ Błąd git:', err.message);
    // Rollback
    try {
      fs.unlinkSync(articlePath);
      console.log('🧹 Plik artykułu usunięty (rollback).');
    } catch {}
    process.exit(1);
  }
}

main();
