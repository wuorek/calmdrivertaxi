#!/usr/bin/env node
/**
 * CalmDriver – Auto FAQ Generator
 * Generuje nowe pytania FAQ przez Gemini REST API i wstrzykuje je do index.html.
 * Aktualizuje też JSON-LD FAQPage schema.
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
const INDEX_PATH = path.join(PROJECT_ROOT, 'app', 'faq', 'index.html');
const QUEUE_PATH = path.join(__dirname, 'faq-queue.json');

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

// ── HTML Parsing ──────────────────────────────────────────────────────────────

function getExistingQuestions(html) {
  const matches = [...html.matchAll(/<span>([^<]+)<\/span>\s*<span class="faq-icon">/g)];
  return matches.map(m => m[1].trim());
}

// ── Duplicate Detection ───────────────────────────────────────────────────────

function isDuplicate(question, existingQuestions) {
  const stopwords = new Set(['w','i','z','na','do','jak','ile','co','za','od','po','się','nie','jest','to','czy','oraz','lub','dla','przez','przy','też','już','ten','ta','te','tego','tej','tym','jako','czy','można','muszę','mam']);
  const tokenize = t => t.toLowerCase()
    .replace(/[^a-ząćęłńóśźż0-9\s]/g, '')
    .split(/\s+/)
    .filter(w => w.length > 2 && !stopwords.has(w));

  const newWords = new Set(tokenize(question));

  return existingQuestions.some(existing => {
    const existWords = new Set(tokenize(existing));
    const intersection = [...newWords].filter(w => existWords.has(w)).length;
    const union = new Set([...newWords, ...existWords]).size;
    return union > 0 && intersection / union >= 0.65;
  });
}

// ── Gemini API ────────────────────────────────────────────────────────────────

async function generateFAQ(existingQuestions, targetKeyword = null) {
  const existingList = existingQuestions.length > 0
    ? existingQuestions.map((q, i) => `${i + 1}. ${q}`).join('\n')
    : '(brak – to będzie pierwsze pytanie)';

  const keywordSection = targetKeyword
    ? `TEMAT/FRAZA: "${targetKeyword}"\nWygeneruj pytanie i odpowiedź odpowiadające na tę intencję.`
    : `TEMAT: Wybierz unikalny temat związany z pracą kierowcy na platformach Bolt/Uber/FreeNow w Białymstoku, którego nie ma na liście powyżej.`;

  const prompt = `Jesteś ekspertem od pracy kierowcy na platformach Bolt, Uber i FreeNow w Białymstoku. Reprezentujesz firmę CalmDriver Taxi – fleet partnera pomagającego kierowcom zacząć zarabiać w Białymstoku.

ISTNIEJĄCE PYTANIA FAQ – NIE POWTARZAJ:
${existingList}

${keywordSection}

ZASADY:
- Pytanie: konkretne, takie jakie wpisałby użytkownik w Google (po polsku, max 80 znaków)
- Odpowiedź PL: 2-4 zdania, konkretne, z liczbami/datami gdy pasuje. Zamiast "skontaktuj się z nami" użyj "zadzwoń do CalmDriver: 739 980 388"
- Odpowiedź EN: wierne tłumaczenie, naturalne po angielsku
- Nie używaj: "kompleksowo", "profesjonalnie", "najwyższa jakość"
- Możesz użyć <strong> dla kluczowych wartości liczbowych

ZWRÓĆ WYŁĄCZNIE JSON (bez markdown, bez tekstu przed/po):
{
  "question_pl": "...",
  "question_en": "...",
  "answer_pl": "...",
  "answer_en": "..."
}`;

  const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${GEMINI_API_KEY}`;

  const response = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      contents: [{ parts: [{ text: prompt }] }],
      generationConfig: { temperature: 0.8, maxOutputTokens: 2048 },
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

function parseGeneratedFAQ(raw) {
  const cleaned = raw
    .replace(/^```(?:json)?\s*\n?/im, '')
    .replace(/\n?```\s*$/im, '')
    .trim();

  let parsed;
  try {
    parsed = JSON.parse(cleaned);
  } catch {
    throw new Error('Niepoprawny JSON od Gemini.\n\nOtrzymano:\n' + cleaned.substring(0, 400));
  }

  const { question_pl, question_en, answer_pl, answer_en } = parsed;
  if (!question_pl || !question_en || !answer_pl || !answer_en) {
    throw new Error('Brakujące pola w odpowiedzi JSON: ' + JSON.stringify(parsed).substring(0, 300));
  }

  return { question_pl, question_en, answer_pl, answer_en };
}

// ── HTML Injection ────────────────────────────────────────────────────────────

const FAQ_ITEM_MARKER = '\n  <!-- FAQ_ITEMS_END -->';

function buildFAQItemHTML({ question_pl, answer_pl }) {
  return `
    <div class="faq-item">
      <button class="faq-question" aria-expanded="false">
        <span>${question_pl}</span>
        <span class="faq-icon">+</span>
      </button>
      <div class="faq-answer" role="region">
        <div class="faq-answer-inner">
          ${answer_pl}
        </div>
      </div>
    </div>
`;
}

function injectFAQItem(html, faq) {
  if (!html.includes(FAQ_ITEM_MARKER)) {
    throw new Error('Nie znaleziono znacznika końca sekcji FAQ w index.html. Sprawdź czy struktura HTML nie uległa zmianie.');
  }
  const newItem = buildFAQItemHTML(faq);
  return html.replace(FAQ_ITEM_MARKER, newItem + FAQ_ITEM_MARKER);
}

// ── JSON-LD Schema Update ─────────────────────────────────────────────────────

function buildSchemaEntry({ question_pl, answer_pl }) {
  // Strip HTML tags from answer for schema
  const cleanAnswer = answer_pl.replace(/<[^>]+>/g, '');
  return {
    '@type': 'Question',
    name: question_pl,
    acceptedAnswer: { '@type': 'Answer', text: cleanAnswer },
  };
}

function updateFAQSchema(html, faq) {
  // Find the FAQPage JSON-LD block
  const schemaRegex = /(<script type="application\/ld\+json">\s*\{[\s\S]*?"@type"\s*:\s*"FAQPage"[\s\S]*?"mainEntity"\s*:\s*\[)([\s\S]*?)(\]\s*\}\s*<\/script>)/;
  const match = html.match(schemaRegex);
  if (!match) {
    console.warn('⚠️  Nie znaleziono FAQPage schema – pomijam aktualizację JSON-LD.');
    return html;
  }

  const newEntry = JSON.stringify(buildSchemaEntry(faq), null, 4)
    .split('\n').map(l => '    ' + l).join('\n');

  return html.replace(schemaRegex, `$1$2,\n${newEntry}\n  $3`);
}

// ── Main ──────────────────────────────────────────────────────────────────────

async function main() {
  const today = new Date().toISOString().split('T')[0];
  console.log(`\n📅 ${today} | CalmDriver FAQ Generator`);

  if (!fs.existsSync(INDEX_PATH)) {
    console.error(`❌ Nie znaleziono pliku: ${INDEX_PATH}`);
    process.exit(1);
  }

  let html = fs.readFileSync(INDEX_PATH, 'utf-8');
  const existingQuestions = getExistingQuestions(html);
  console.log(`ℹ Istniejące pytania FAQ: ${existingQuestions.length}`);

  const MAX_RETRIES = 5;
  const skippedKeywords = [];
  let faq = null;
  let usedKeyword = null;

  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    const nextKeyword = getNextKeyword(skippedKeywords);
    usedKeyword = nextKeyword;

    if (nextKeyword) {
      console.log(`🎯 Fraza z kolejki (priorytet ${nextKeyword.priority}): "${nextKeyword.keyword}"`);
    } else {
      console.log('📝 Kolejka fraz pusta — wybieram temat autonomicznie');
    }

    console.log('🤖 Generuję pytanie FAQ przez Gemini API...');
    let raw;
    try {
      raw = await generateFAQ(existingQuestions, nextKeyword?.keyword || null);
    } catch (err) {
      console.error('❌ Błąd Gemini API:', err.message);
      process.exit(1);
    }

    let parsed;
    try {
      parsed = parseGeneratedFAQ(raw);
    } catch (err) {
      console.error('❌ Błąd parsowania:', err.message);
      process.exit(1);
    }

    if (isDuplicate(parsed.question_pl, existingQuestions)) {
      console.warn(`⚠️  Pytanie "${parsed.question_pl}" zbyt podobne do istniejącego.`);
      if (nextKeyword) {
        markKeywordStatus(nextKeyword.keyword, 'skipped');
        skippedKeywords.push(nextKeyword.keyword);
        console.log(`🔄 Próbuję kolejną frazę (próba ${attempt}/${MAX_RETRIES})...`);
      } else {
        console.log(`🔄 Próbuję ponownie autonomicznie (próba ${attempt}/${MAX_RETRIES})...`);
      }
      faq = null;
      continue;
    }

    faq = parsed;
    break;
  }

  if (!faq) {
    console.warn(`⚠️  Nie udało się wygenerować unikalnego pytania po ${MAX_RETRIES} próbach.`);
    process.exit(0);
  }

  console.log(`✅ Pytanie: "${faq.question_pl}"`);

  // Inject into HTML
  try {
    html = injectFAQItem(html, faq);
    html = updateFAQSchema(html, faq);
  } catch (err) {
    console.error('❌ Błąd wstrzykiwania do HTML:', err.message);
    process.exit(1);
  }

  fs.writeFileSync(INDEX_PATH, html, 'utf-8');
  console.log('📝 faq/index.html zaktualizowany');

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

  const commitMsg = `feat(faq): ${faq.question_pl.substring(0, 72)}`;

  try {
    execSync(`git -C "${PROJECT_ROOT}" pull --rebase --autostash origin ${GIT_BRANCH}`, { stdio: 'pipe' });

    if (usedKeyword) markKeywordStatus(usedKeyword.keyword, 'done');

    execSync(`git -C "${PROJECT_ROOT}" add "app/faq/index.html" "app/sitemap.xml"`, { stdio: 'pipe' });
    if (usedKeyword || skippedKeywords.length > 0) {
      execSync(`git -C "${PROJECT_ROOT}" add "scripts/faq-queue.json"`, { stdio: 'pipe' });
    }
    execSync(`git -C "${PROJECT_ROOT}" commit -m "${commitMsg}"`, { env: gitEnv, stdio: 'pipe' });
    console.log('📦 Commit utworzony');

    execSync(`git -C "${PROJECT_ROOT}" push origin ${GIT_BRANCH}`, { stdio: 'inherit' });
    console.log('🚀 Wypchnięto do GitHub → CI/CD zadeplojuje automatycznie');
    console.log(`🎉 Gotowe! Pytanie "${faq.question_pl}" niedługo będzie live.\n`);

  } catch (err) {
    console.error('❌ Błąd git:', err.message);
    // Rollback HTML
    try {
      execSync(`git -C "${PROJECT_ROOT}" checkout -- app/faq/index.html`, { stdio: 'pipe' });
      console.log('🧹 index.html przywrócony (rollback).');
    } catch {}
    process.exit(1);
  }
}

main();
