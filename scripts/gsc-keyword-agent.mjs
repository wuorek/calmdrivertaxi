#!/usr/bin/env node
/**
 * CalmDriver – GSC Keyword Agent
 * Pobiera frazy z Google Search Console i uzupełnia articles-queue.json
 * oraz faq-queue.json o nowe okazje (impressions > 20, pozycja 6-30).
 *
 * JEDNORAZOWA KONFIGURACJA:
 * 1. Wejdź na https://console.cloud.google.com/
 * 2. Utwórz projekt → włącz "Google Search Console API"
 * 3. Utwórz Service Account → pobierz klucz JSON
 * 4. W Google Search Console → Ustawienia → Użytkownicy → dodaj email service account
 * 5. Zapisz plik klucza jako: /opt/calmdriver/gsc-service-account.json
 *
 * Uruchom raz w tygodniu (np. w niedzielę o 7:00):
 * 0 7 * * 0 cd /opt/calmdriver && node scripts/gsc-keyword-agent.mjs >> /opt/calmdriver/gsc-agent.log 2>&1
 *
 * Wymagane zmienne środowiskowe (.env):
 *   GSC_SERVICE_ACCOUNT_PATH  – ścieżka do pliku klucza JSON
 *   GSC_SITE_URL              – adres strony w GSC (np. sc-domain:calmdriver.pl)
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ARTICLES_QUEUE_PATH = path.join(__dirname, 'articles-queue.json');
const FAQ_QUEUE_PATH = path.join(__dirname, 'faq-queue.json');

const SERVICE_ACCOUNT_PATH = process.env.GSC_SERVICE_ACCOUNT_PATH
  || '/opt/calmdriver/gsc-service-account.json';
const SITE_URL = process.env.GSC_SITE_URL
  || 'sc-domain:calmdriver.pl';

// ── Klasyfikacja frazy: artykuł czy FAQ? ──────────────────────────────────────
//
// FAQ = pytanie (czy, jak, ile, co, kiedy, gdzie, dlaczego, czy można)
// Artykuł = wszystko inne (informacyjne, porównawcze, lokalne)

function classifyKeyword(keyword) {
  const kw = keyword.toLowerCase();
  const faqTriggers = /^(czy|jak|ile|co|kiedy|gdzie|dlaczego|po co|na czym|czym|kto|jakie|jaki|jaka|jak długo|jak szybko)/;
  return faqTriggers.test(kw) ? 'faq' : 'article';
}

// ── Auth – Service Account JWT ────────────────────────────────────────────────

function base64url(buf) {
  return Buffer.from(buf).toString('base64')
    .replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '');
}

async function getAccessToken(serviceAccount) {
  const now = Math.floor(Date.now() / 1000);
  const header = base64url(JSON.stringify({ alg: 'RS256', typ: 'JWT' }));
  const payload = base64url(JSON.stringify({
    iss: serviceAccount.client_email,
    scope: 'https://www.googleapis.com/auth/webmasters.readonly',
    aud: 'https://oauth2.googleapis.com/token',
    exp: now + 3600,
    iat: now,
  }));

  const { createSign } = await import('crypto');
  const sign = createSign('RSA-SHA256');
  sign.update(`${header}.${payload}`);
  const signature = base64url(sign.sign(serviceAccount.private_key));
  const jwt = `${header}.${payload}.${signature}`;

  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: `grant_type=urn%3Aietf%3Aparams%3Aoauth%3Agrant-type%3Ajwt-bearer&assertion=${jwt}`,
  });
  const data = await res.json();
  if (!data.access_token) throw new Error(`Auth failed: ${JSON.stringify(data)}`);
  return data.access_token;
}

// ── GSC API ───────────────────────────────────────────────────────────────────

async function fetchSearchConsoleData(token) {
  const endDate = new Date();
  const startDate = new Date();
  startDate.setDate(startDate.getDate() - 90); // ostatnie 90 dni

  const body = {
    startDate: startDate.toISOString().split('T')[0],
    endDate: endDate.toISOString().split('T')[0],
    dimensions: ['query'],
    rowLimit: 500,
    dimensionFilterGroups: [{
      filters: [{
        dimension: 'country',
        operator: 'equals',
        expression: 'pol',
      }],
    }],
  };

  const res = await fetch(
    `https://searchconsole.googleapis.com/webmasters/v3/sites/${encodeURIComponent(SITE_URL)}/searchAnalytics/query`,
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
    }
  );

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`GSC API ${res.status}: ${err}`);
  }

  return res.json();
}

// ── Filtrowanie okazji ────────────────────────────────────────────────────────

function findOpportunities(rows) {
  return rows
    .filter(row =>
      row.impressions > 20 &&
      row.position >= 6 &&
      row.position <= 30
    )
    .sort((a, b) => (b.impressions / b.position) - (a.impressions / a.position))
    .slice(0, 40)
    .map(row => ({
      keyword: row.keys[0],
      impressions: Math.round(row.impressions),
      position: Math.round(row.position * 10) / 10,
      clicks: row.clicks,
      type: classifyKeyword(row.keys[0]),
    }));
}

// ── Aktualizacja kolejki ──────────────────────────────────────────────────────

function updateQueue(queuePath, opportunities) {
  const queue = JSON.parse(fs.readFileSync(queuePath, 'utf-8'));
  const existingKeywords = new Set(queue.queue.map(k => k.keyword.toLowerCase()));

  let added = 0;
  for (const opp of opportunities) {
    const kw = opp.keyword.toLowerCase();
    if (existingKeywords.has(kw)) continue;

    const priority = opp.position <= 10 ? 1 : opp.position <= 20 ? 2 : 3;

    queue.queue.push({
      keyword: opp.keyword,
      priority,
      status: 'pending',
      source: 'gsc',
      gsc_impressions: opp.impressions,
      gsc_position: opp.position,
      added_date: new Date().toISOString().split('T')[0],
    });

    existingKeywords.add(kw);
    added++;
  }

  queue.queue.sort((a, b) => {
    if (a.status !== b.status) return a.status === 'pending' ? -1 : 1;
    return a.priority - b.priority;
  });

  queue._last_gsc_update = new Date().toISOString();
  fs.writeFileSync(queuePath, JSON.stringify(queue, null, 2), 'utf-8');
  return added;
}

// ── Main ──────────────────────────────────────────────────────────────────────

async function main() {
  console.log('\n🔍 GSC Keyword Agent uruchomiony — CalmDriver');
  console.log(`   Site: ${SITE_URL}`);

  if (!fs.existsSync(SERVICE_ACCOUNT_PATH)) {
    console.error(`❌ Brak pliku service account: ${SERVICE_ACCOUNT_PATH}`);
    console.error('   Przeczytaj instrukcję na górze tego pliku.');
    process.exit(1);
  }

  const serviceAccount = JSON.parse(fs.readFileSync(SERVICE_ACCOUNT_PATH, 'utf-8'));

  console.log('🔑 Autentykacja...');
  const token = await getAccessToken(serviceAccount);

  console.log('📊 Pobieranie danych z GSC (ostatnie 90 dni, Polska)...');
  const data = await fetchSearchConsoleData(token);
  const rows = data.rows || [];
  console.log(`   Pobrano ${rows.length} fraz`);

  const opportunities = findOpportunities(rows);
  const articleOpps = opportunities.filter(o => o.type === 'article');
  const faqOpps = opportunities.filter(o => o.type === 'faq');

  console.log(`💡 Znaleziono ${opportunities.length} okazji → ${articleOpps.length} artykuły, ${faqOpps.length} FAQ`);

  if (opportunities.length > 0) {
    console.log('\n   Top 5 okazji:');
    opportunities.slice(0, 5).forEach(o => {
      console.log(`   • [${o.type.toUpperCase()}] "${o.keyword}" — poz. ${o.position}, ${o.impressions} impressions`);
    });
  }

  const addedArticles = updateQueue(ARTICLES_QUEUE_PATH, articleOpps);
  const addedFaq = updateQueue(FAQ_QUEUE_PATH, faqOpps);

  console.log(`\n✅ Dodano do kolejki: ${addedArticles} artykułów, ${addedFaq} FAQ`);

  const aq = JSON.parse(fs.readFileSync(ARTICLES_QUEUE_PATH, 'utf-8'));
  const fq = JSON.parse(fs.readFileSync(FAQ_QUEUE_PATH, 'utf-8'));
  const aPending = aq.queue.filter(k => k.status === 'pending').length;
  const fPending = fq.queue.filter(k => k.status === 'pending').length;

  console.log(`📋 Kolejka artykułów: ${aPending} pending`);
  console.log(`📋 Kolejka FAQ: ${fPending} pending`);
  console.log(`   Następny artykuł: "${aq.queue.find(k => k.status === 'pending')?.keyword}"`);
  console.log(`   Następne FAQ: "${fq.queue.find(k => k.status === 'pending')?.keyword}"\n`);
}

main().catch(err => {
  console.error('❌ Błąd:', err.message);
  process.exit(1);
});
