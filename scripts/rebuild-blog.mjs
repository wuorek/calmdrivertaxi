#!/usr/bin/env node
/**
 * CalmDriver - przebudowa całego bloga.
 *
 * Dla każdego artykułu z articles-index.json wyciąga istniejącą treść
 * (<div class="article-body">), czyści ją i składa plik od nowa przez
 * buildArticleHTML (nowy wygląd + świeże linki "Powiązane artykuły").
 * Na końcu odtwarza blog/index.html.
 *
 * Użycie: node scripts/rebuild-blog.mjs [--dry-run]
 * Bez sieci i bez gita.
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { buildArticleHTML, buildBlogIndexHTML, normalizeDashes, sanitizeText, sentenceCaseTitle } from './article-template.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DEFAULT_ROOT = path.resolve(__dirname, '..');

// Emoji i symbole (U+1F300-1FAFF, U+2600-27BF) oraz selektory wariantów i łączniki ZWJ.
const EMOJI_RE = /[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}\u{FE0F}\u{200D}]+️?[ \t]?/gu;

const RENTAL_URL = '/wynajem-auta-pod-taxi-bialystok/';
const RENTAL_REPLACEMENT = `<p><strong>Nie masz auta?</strong> <a href="${RENTAL_URL}">Wynajem od 350 zł/tydz., kaucja 1000 zł. Uczeń lub student do 26 lat: pierwszy tydzień 250 zł.</a></p>`;

// ── Parsowanie HTML (liczenie zagnieżdżonych <div>) ─────────────────────────

/**
 * Zwraca indeks końca elementu <div> zaczynającego się na pozycji `start`
 * (pozycja tuż za zamykającym </div>) albo -1, jeśli HTML jest niedomknięty.
 */
function findDivEnd(html, start) {
  const tagRe = /<(\/?)div\b[^>]*>/gi;
  tagRe.lastIndex = start;
  let depth = 0;
  let match;
  while ((match = tagRe.exec(html)) !== null) {
    depth += match[1] ? -1 : 1;
    if (depth === 0) return match.index + match[0].length;
  }
  return -1;
}

/** Wyciąga wnętrze <div class="article-body">...</div> (z zagnieżdżonymi div-ami). */
export function extractArticleBody(html) {
  const open = /<div class="article-body">/.exec(html);
  if (!open) return null;
  const end = findDivEnd(html, open.index);
  if (end === -1) return null;
  const inner = html.slice(open.index + open[0].length, end - '</div>'.length);
  return inner.trim();
}

// ── Czyszczenie treści ──────────────────────────────────────────────────────

function stripTags(html) {
  return html.replace(/<[^>]+>/g, '');
}

function removeEmoji(text) {
  return text.replace(EMOJI_RE, '');
}

/** Zamienia stylowane ramki <div data-inline-cta> na zwykły akapit z linkiem. */
function replaceInlineCtas(html) {
  let result = '';
  let pos = 0;
  const startRe = /<div\b[^>]*data-inline-cta[^>]*>/gi;
  let match;
  while ((match = startRe.exec(html)) !== null) {
    const end = findDivEnd(html, match.index);
    if (end === -1) break;
    const block = html.slice(match.index, end);
    result += html.slice(pos, match.index) + inlineCtaToParagraph(block);
    pos = end;
    startRe.lastIndex = end;
  }
  return result + html.slice(pos);
}

function inlineCtaToParagraph(block) {
  const paragraph = /<p\b[^>]*>([\s\S]*?)<\/p>/i.exec(block);
  const text = paragraph ? paragraph[1].trim() : '';

  if (/Nie masz auta\?/.test(text)) return RENTAL_REPLACEMENT;

  const link = /<a\b[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/i.exec(block);
  if (!link) return text ? `<p>${text}</p>` : '';
  const label = removeEmoji(stripTags(link[2])).replace(/\s*[→]\s*$/, '').trim();
  return `<p>${text} <a href="${link[1]}">${label}</a></p>`;
}

/** Każde "250 zł" bez kontekstu studenckiego dostaje dopisek o uczniu/studencie. */
function fixStudentPrice(html) {
  return html.replace(/250 zł/g, (found, offset) => {
    if (html[offset - 1] === '-') return found; // odliczenie w przykładzie liczbowym, nie oferta
    const window = stripTags(html.slice(Math.max(0, offset - 200), offset + 220)).toLowerCase();
    if (/student|uczeń|ucznia|uczni/.test(window)) return found;
    return `${found} dla ucznia lub studenta do 26 lat`;
  });
}

export function cleanBody(html) {
  let out = replaceInlineCtas(html.replace(/\r\n/g, '\n'));
  out = removeEmoji(out);
  out = normalizeDashes(out);
  out = out.replace(/\s*\(OC\/AC(?:\/NNW)?\)/g, '');
  out = out.replace(/OC\/AC(?:\/NNW)?/g, 'ubezpieczenie');
  out = out.replace(/(kaucj[aiąę]\s+)500(\s*zł)/gi, '$11000$2');
  out = fixStudentPrice(out);
  return out;
}

// ── Indeks artykułów ────────────────────────────────────────────────────────

function decodeEntities(text) {
  return text
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&');
}

function firstMatch(html, regex) {
  const match = regex.exec(html);
  return match ? decodeEntities(match[1].trim()) : '';
}

/** Metadane artykułu odczytane z gotowego pliku HTML (stary lub nowy szablon). */
export function readMetadataFromHtml(slug, html) {
  const title = firstMatch(html, /<title>([\s\S]*?)<\/title>/).replace(/\s*\|\s*CalmDriver\s*$/, '');
  const metaDescription = firstMatch(html, /<meta name="description" content="([^"]*)"/);
  const lead = firstMatch(html, /<p class="(?:article-excerpt|article-lead)">([\s\S]*?)<\/p>/);
  const category = firstMatch(html, /<span class="(?:article-cat|tag)">([\s\S]*?)<\/span>/);
  const readTime = firstMatch(html, /<span class="article-time">\s*(\d+ min)/)
    || firstMatch(html, /<span>(\d+ min) czytania<\/span>/);
  const date = firstMatch(html, /"datePublished":\s*"(\d{4}-\d{2}-\d{2})"/);

  const entry = {
    slug,
    title: normalizeDashes(title),
    excerpt: normalizeDashes(lead || metaDescription),
    category: category || 'Porady',
    readTime: readTime || '5 min',
    date: date || new Date().toISOString().split('T')[0],
  };
  if (lead && metaDescription && lead !== metaDescription) {
    entry.metaDescription = normalizeDashes(metaDescription);
  }
  return entry;
}

function readJsonFile(filePath) {
  const raw = fs.readFileSync(filePath, 'utf-8');
  return { data: JSON.parse(raw), eol: raw.includes('\r\n') ? '\r\n' : '\n' };
}

function serializeIndex(data, eol) {
  const json = JSON.stringify(data, null, 2);
  return eol === '\r\n' ? json.replace(/\n/g, '\r\n') : json;
}

// ── Główna funkcja ──────────────────────────────────────────────────────────

/**
 * Przebudowuje wszystkie artykuły i blog/index.html.
 * @returns {string[]} ścieżki zmienionych plików względem korzenia repo
 */
export function rebuildBlog({ dryRun = false, root = DEFAULT_ROOT } = {}) {
  const blogDir = path.join(root, 'app', 'blog');
  const indexPath = path.join(root, 'scripts', 'articles-index.json');
  const changed = [];

  const { data: index, eol } = readJsonFile(indexPath);
  const original = JSON.stringify(index);

  // Artykuły, które mają plik, ale nie ma ich w indeksie (np. dodane ręcznie).
  const known = new Set(index.articles.map(a => a.slug));
  const files = fs.readdirSync(blogDir)
    .filter(name => name.endsWith('.html') && name !== 'index.html')
    .map(name => name.slice(0, -'.html'.length))
    .sort();
  for (const slug of files) {
    if (known.has(slug)) continue;
    const html = fs.readFileSync(path.join(blogDir, `${slug}.html`), 'utf-8');
    index.articles.push(readMetadataFromHtml(slug, html));
    console.log(`+ dodano do indeksu: ${slug}`);
  }

  // Pisownia w metadanych: bez długich myślników.
  for (const article of index.articles) {
    for (const key of ['title', 'excerpt', 'metaDescription']) {
      if (typeof article[key] === 'string') article[key] = sanitizeText(article[key]);
    }
    if (typeof article.title === 'string') {
      article.title = sentenceCaseTitle(article.title);
    }
  }

  const rebuilt = [];
  for (const article of index.articles) {
    const filePath = path.join(blogDir, `${article.slug}.html`);
    if (!fs.existsSync(filePath)) {
      console.warn(`! brak pliku, pomijam: ${article.slug}.html`);
      continue;
    }
    const body = extractArticleBody(fs.readFileSync(filePath, 'utf-8'));
    if (body === null) {
      console.warn(`! nie udało się odczytać treści, pomijam: ${article.slug}.html`);
      continue;
    }
    rebuilt.push({ article, body: cleanBody(body) });
  }

  const allArticles = rebuilt.map(item => item.article);
  for (const { article, body } of rebuilt) {
    const filePath = path.join(blogDir, `${article.slug}.html`);
    const html = buildArticleHTML({ ...article, body }, allArticles);
    if (writeIfChanged(filePath, html, dryRun)) changed.push(`app/blog/${article.slug}.html`);
  }

  const indexHtml = buildBlogIndexHTML(allArticles);
  if (writeIfChanged(path.join(blogDir, 'index.html'), indexHtml, dryRun)) changed.push('app/blog/index.html');

  if (JSON.stringify(index) !== original) {
    if (!dryRun) fs.writeFileSync(indexPath, serializeIndex(index, eol), 'utf-8');
    changed.push('scripts/articles-index.json');
  }

  return changed;
}

function writeIfChanged(filePath, content, dryRun) {
  const current = fs.existsSync(filePath) ? fs.readFileSync(filePath, 'utf-8') : null;
  if (current === content) return false;
  if (!dryRun) fs.writeFileSync(filePath, content, 'utf-8');
  return true;
}

// ── CLI ─────────────────────────────────────────────────────────────────────

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const dryRun = process.argv.includes('--dry-run');
  const changed = rebuildBlog({ dryRun });
  console.log(`${dryRun ? '[dry-run] ' : ''}Zmienione pliki: ${changed.length}`);
  for (const file of changed) console.log(`  ${file}`);
}
