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
import { fileURLToPath } from 'url';
import { regenerateSitemap } from './update-sitemap.mjs';
import { commitAndPush, rollback, syncBeforeGenerate } from './git-publish.mjs';
import { buildArticleHTML, sanitizeText } from './article-template.mjs';
import { rebuildBlog } from './rebuild-blog.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = path.resolve(__dirname, '..');
const BLOG_DIR = path.join(PROJECT_ROOT, 'app', 'blog');
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
    ? existingArticles.map((a, i) => `${i + 1}. ${a.title} (/blog/${a.slug}.html)`).join('\n')
    : '(brak – to będzie pierwszy artykuł)';

  const keywordSection = targetKeyword
    ? `FRAZA KLUCZOWA: "${targetKeyword}"\nNapisz artykuł odpowiadający na intencję tej frazy. Wpleć ją w tytuł i treść naturalnie (max 3-4 razy). Jeśli fraza zawiera rok lub go sugeruje – użyj ${currentYear}.`
    : `TEMAT: Wybierz temat, ktory odpowiada na KONKRETNE PYTANIE zadawane w wyszukiwarce przez osobe rozwazajaca prace kierowcy w Bialymstoku — takie, ktore ktos faktycznie wpisuje w Google.

ZASADY DOBORU TEMATU (obowiazkowe):
- Temat MUSI zawierac fraze lokalna ("Bialystok") albo nazwe platformy (Bolt / Uber / FreeNow).
- Temat MUSI dotyczyc jednej z kategorii: zarobki i koszty, wymagania i dokumenty, licencja, rejestracja, wynajem auta, podatki i forma rozliczenia, praca dla obcokrajowcow, praca dorywcza/studencka.
- ZAKAZANE sa tematy ogolnoporadnikowe bez intencji wyszukiwania, np. o obsludze pasazera, motywacji, zarzadzaniu pieniedzmi, porach roku, wyposazeniu auta, budowaniu reputacji. Takie artykuly nie odpowiadaja na zadne realne zapytanie i nie generuja ruchu.
- Tytul ma brzmiec jak odpowiedz na pytanie, a nie jak esej.`;

  const prompt = `Jesteś doświadczonym kierowcą i ekspertem od pracy na platformach Bolt, Uber i FreeNow w Białymstoku. Piszesz poradnik dla ludzi, którzy rozważają tę pracę lub dopiero zaczynają. Twój cel: dać czytelnikowi REALNĄ WARTOŚĆ — odpowiedzieć na jego pytanie lepiej niż jakikolwiek inny artykuł w internecie.

ISTNIEJĄCE ARTYKUŁY – NIE POWTARZAJ TEMATÓW (podany jest tytuł i adres):
${existingList}

STRONY DOCELOWE (oferta i FAQ):
- /praca-kierowca-bolt-bialystok/
- /praca-kierowca-uber-bialystok/
- /praca-kierowca-freenow-bialystok/
- /wynajem-auta-pod-taxi-bialystok/
- /praca-dla-studenta-bialystok/
- /faq/

LINKI WEWNĘTRZNE (obowiązkowe): w treści artykułu umieść 2-3 naturalne linki kontekstowe (<a href="...">) do NAJBARDZIEJ pasujących tematycznie istniejących artykułów (adresy z listy powyżej) lub stron docelowych. Używaj dokładnie podanych adresów, tekst linku ma być opisowy (nie "kliknij tutaj"). Nie linkuj do artykułu, którego dopiero piszesz.

${keywordSection}

TYTUŁ: maksymalnie 60 znaków, z frazą kluczową na początku.

NAJWAŻNIEJSZA ZASADA — WARTOŚĆ DLA CZYTELNIKA:
- Pisz artykuł, który jest NAPRAWDĘ pomocny — tak jakbyś doradzał kumplowi
- 90% treści to praktyczna wiedza, porady, dane, doświadczenie
- CalmDriver Taxi (fleet partner w Białymstoku) możesz wspomnieć MAX 1-2 razy i tylko tam, gdzie to naturalnie pasuje (np. jako opcja wynajmu auta). NIE promuj CalmDriver w każdym akapicie
- NIE pisz w pierwszej osobie liczby mnogiej ("W CalmDriver widzimy"). Pisz w drugiej osobie — zwracaj się do czytelnika: "Jeśli planujesz...", "Warto wiedzieć, że...", "Sprawdź..."
- Zakończ artykuł praktyczną radą lub podsumowaniem, NIE reklamą

GŁOS I STYL:
- Konkretny, rzeczowy, bez lania wody
- Szczerość: mów co jest trudne, gdzie są pułapki, czego nikt nie mówi
- Każde zdanie niesie informację — zero wypełniaczy i ogólników
- Nie używaj: "kompleksowo", "profesjonalnie", "najwyższa jakość", "niezwykle ważny", "od podszewki"
- ZAKAZ znaków "—" (długi myślnik) i "–" (średni myślnik): używaj wyłącznie zwykłego "-". ZAKAZ emoji i symboli graficznych
- Unikaj powtarzalnej struktury — zaskocz czytelnika ciekawym wstępem, nietypowym ujęciem tematu
- Dodaj konkretne przykłady, scenariusze, obliczenia, porównania

ELEMENTY LOKALNE (wpleć 2-3 naturalnie, NIE wszystkie na raz):
- Białystok: centrum (Lipowa, Sienkiewicza), Galeria Biała, Alfacenter, dworzec PKP, lotnisko Krywlany
- Osiedla: Piasta, Antoniuk, Słoneczny Stok, Bojary, Nowe Miasto, Skorupy
- Specyfika: miasto studenckie (UwB, Politechnika), mniejszy rynek niż Warszawa ale mniej konkurencji

DANE (użyj gdzie pasują, NIE wciskaj wszystkich; ceny i warunki podawaj dokładnie tak, jak niżej):
- Zarobki: ok. 40 zł/h na konto po prowizji aplikacji (${currentYear}). Szacunek, nie gwarancja
- Platformy: Bolt (dominujący w Białymstoku), Uber, FreeNow
- Prowizja platform: Bolt ~25%, Uber ~25%, FreeNow ~15-20%
- Własne auto u CalmDriver: 40 zł/tydz. za obsługę rozliczeń, 0% prowizji od obrotu, VAT 8% od obrotu to podatek, nie opłata CalmDriver
- Wynajem auta: Skoda Fabia od 350 zł/tydz., Kia Venga od 400 zł/tydz., Dacia Sandero od 500 zł/tydz.; kaucja zwrotna 1000 zł; ubezpieczenie, serwis i przeglądy w cenie (NIE pisz "OC/AC")
- Oferta studencka: 250 zł za pierwszy tydzień wynajmu, TYLKO dla ucznia, studenta lub doktoranta do 26 lat z ważną legitymacją; od 2. tygodnia zwykły cennik. Zawsze pisz, że 250 zł dotyczy ucznia lub studenta do 26 lat
- Umowa zlecenie bez własnej firmy; do 26 lat uczeń i student nie płaci ZUS, a każdy do 26 lat nie płaci PIT do 85 528 zł przychodu rocznie
- Nie wspominaj o paliwie ani kosztach paliwa
- Rejestracja: 1-2 dni robocze z fleet partnerem, samodzielnie 1-2 tygodnie

STRUKTURA:
- Wstęp (2-3 zdania): konkretna sytuacja, pytanie lub problem czytelnika
- 4-6 sekcji H2 — każda odpowiada na osobne podpytanie
- Mieszaj formaty: akapity, listy punktowane, porównania, przykłady liczbowe
- NIE kończ każdej sekcji odniesieniem do CalmDriver
- Jeśli temat tego wymaga, dodaj też link do /faq/ w treści (jako <a href="/faq/">FAQ</a>)

DŁUGOŚĆ: 900-1300 słów

ZWRÓĆ WYŁĄCZNIE JSON (bez markdown, bez tekstu przed/po):
{
  "title": "...",
  "excerpt": "...",
  "category": "...",
  "readTime": "X min",
  "date": "${today}",
  "body": "...pełny HTML artykułu (tylko tagi h2, p, ul, li, ol, strong, a — bez html/head/body)..."
}

Kategoria musi być JEDNĄ z: Zarobki | Platformy | Wynajem | Porady | Prawo i podatki`;

  const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${GEMINI_API_KEY}`;

  const response = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      contents: [{ parts: [{ text: prompt }] }],
      generationConfig: {
        temperature: 0.85,
        maxOutputTokens: 16384,
        responseMimeType: 'application/json',
        thinkingConfig: { thinkingBudget: 1024 },
      },
    }),
  });

  if (!response.ok) {
    const err = await response.text();
    const error = new Error(`Gemini API ${response.status}: ${err}`);
    error.geminiPermanent = [400, 401, 402, 403].includes(response.status);
    if (response.status === 402) error.message += ' — doładuj kredyty w AI Studio.';
    throw error;
  }

  const data = await response.json();
  const finishReason = data?.candidates?.[0]?.finishReason;
  if (finishReason !== 'STOP') {
    throw new Error(`Ucięta odpowiedź od Gemini (finishReason=${finishReason || 'brak'}).`);
  }
  const text = data?.candidates?.[0]?.content?.parts?.[0]?.text;
  if (!text) throw new Error('Pusta odpowiedź od Gemini API');
  return text;
}

function wait(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function generateWithRetry(generate, parse) {
  const MAX_GENERATION_ATTEMPTS = 3;
  let lastError;
  for (let attempt = 1; attempt <= MAX_GENERATION_ATTEMPTS; attempt++) {
    try {
      return parse(await generate());
    } catch (error) {
      lastError = error;
      if (error.geminiPermanent) throw error;
      if (attempt < MAX_GENERATION_ATTEMPTS) {
        console.warn(`⚠️  Błąd przejściowy Gemini: ${error.message}`);
        console.log(`🔄 Ponawiam generowanie za 20 s (${attempt + 1}/${MAX_GENERATION_ATTEMPTS})...`);
        await wait(20_000);
      }
    }
  }
  throw lastError;
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
    title: sanitizeText(title),
    excerpt: sanitizeText(excerpt),
    category: sanitizeText(category || 'Porady'),
    readTime: readTime || '5 min',
    date: date || new Date().toISOString().split('T')[0],
    body: sanitizeText(body),
  };
}

// ── Publikacja ────────────────────────────────────────────────────────────────

/**
 * Lista plików do commita: nowy artykuł, wszystkie pliki zmienione przez
 * rebuildBlog() (artykuły z odświeżonymi powiązanymi linkami, blog/index.html,
 * articles-index.json), sitemap i ewentualnie kolejka fraz.
 */
function buildPublishFiles(articleRelativePath, rebuiltFiles, includeQueue) {
  const files = new Set([articleRelativePath, ...rebuiltFiles, 'app/blog/index.html', 'app/sitemap.xml', 'scripts/articles-index.json']);
  if (includeQueue) files.add('scripts/articles-queue.json');
  return [...files];
}

// ── Main ──────────────────────────────────────────────────────────────────────

async function main() {
  const today = new Date().toISOString().split('T')[0];
  console.log(`\n📅 ${today} | CalmDriver Blog Generator`);
  try {
    syncBeforeGenerate({ root: PROJECT_ROOT, branch: GIT_BRANCH });
  } catch (error) {
    console.error(`❌ Nie można rozpocząć publikacji: ${error.message}`);
    process.exit(1);
  }

  let createdFiles = [];
  try {
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
      const parsed = await generateWithRetry(
        () => generateArticle(index.articles, nextKeyword?.keyword || null),
        parseGeneratedArticle,
      );

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

    const publishSkippedQueue = () => {
      if (skippedKeywords.length === 0) return;
      const gitEnv = {
        ...process.env,
        GIT_AUTHOR_NAME,
        GIT_AUTHOR_EMAIL,
        GIT_COMMITTER_NAME: GIT_AUTHOR_NAME,
        GIT_COMMITTER_EMAIL: GIT_AUTHOR_EMAIL,
      };
      commitAndPush({ root: PROJECT_ROOT, branch: GIT_BRANCH, files: ['scripts/articles-queue.json'],
        message: `chore(queue): pominięte duplikaty (${skippedKeywords.length})`, env: gitEnv, regenerate: regenerateSitemap });
      console.log('📦 Opublikowano status pominiętych fraz w kolejce.');
    };

    if (!article) {
      console.warn(`⚠️  Nie udało się wygenerować unikalnego artykułu po ${MAX_RETRIES} próbach.`);
      publishSkippedQueue();
      return;
    }

    const slug = slugify(article.title);
    const articlePath = path.join(BLOG_DIR, `${slug}.html`);
    const articleRelativePath = `app/blog/${slug}.html`;

    if (fs.existsSync(articlePath)) {
      console.warn(`⚠️  Plik ${slug}.html już istnieje. Pomijam.`);
      publishSkippedQueue();
      return;
    }

    const indexEntry = { slug, title: article.title, excerpt: article.excerpt, category: article.category, readTime: article.readTime, date: article.date };
    const articleHTML = buildArticleHTML({ ...article, slug }, [...index.articles, indexEntry]);
    createdFiles = [articleRelativePath];
    fs.writeFileSync(articlePath, articleHTML, 'utf-8');
  console.log(`✅ Artykuł zapisany: app/blog/${slug}.html`);
  console.log(`   Tytuł:    ${article.title}`);
  console.log(`   Kategoria: ${article.category} | Czas: ${article.readTime}`);

    index.articles.push(indexEntry);
    saveArticlesIndex(index);

    // Przelicza powiązane linki we wszystkich artykułach i odtwarza blog/index.html
    const rebuiltFiles = rebuildBlog();
  console.log(`📝 Blog przebudowany (zmienionych plików: ${rebuiltFiles.length})`);

    regenerateSitemap();

    const gitEnv = {
      ...process.env,
      GIT_AUTHOR_NAME,
      GIT_AUTHOR_EMAIL,
      GIT_COMMITTER_NAME: GIT_AUTHOR_NAME,
      GIT_COMMITTER_EMAIL: GIT_AUTHOR_EMAIL,
    };

    if (usedKeyword) markKeywordStatus(usedKeyword.keyword, 'done');
    const files = buildPublishFiles(articleRelativePath, rebuiltFiles, Boolean(usedKeyword) || skippedKeywords.length > 0);
    commitAndPush({ root: PROJECT_ROOT, branch: GIT_BRANCH, files,
      message: `feat(blog): ${article.title.substring(0, 72)}`, env: gitEnv, regenerate: regenerateSitemap });
    console.log('🚀 Wypchnięto do GitHub → CI/CD zadeplojuje automatycznie');
    console.log(`🎉 Gotowe! Artykuł "${article.title}" niedługo będzie live.\n`);
  } catch (error) {
    console.error(`❌ Błąd publikacji: ${error.message}`);
    rollback({ root: PROJECT_ROOT, branch: GIT_BRANCH, createdFiles });
    process.exit(1);
  }
}

main();
