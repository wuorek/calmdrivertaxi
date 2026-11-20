/**
 * CalmDriver - linkowanie wewnętrzne bloga.
 *
 * - relatedArticles(slug, articles, n): n najbardziej podobnych tematycznie artykułów
 * - landingFor(title): strona docelowa (oferta) dopasowana do tematu artykułu
 */

// Słowa bez znaczenia tematycznego (przyimki, spójniki, słowa typu "jak", "czy").
const STOPWORDS = new Set([
  'w', 'i', 'z', 'na', 'do', 'jak', 'ile', 'co', 'za', 'od', 'po', 'się', 'nie', 'jest', 'to',
  'czy', 'oraz', 'lub', 'dla', 'przez', 'przy', 'też', 'już', 'ten', 'ta', 'te', 'tego', 'tej',
  'tym', 'jako', 'bez', 'ale', 'albo', 'tak', 'sie', 'czego', 'gdy', 'kiedy', 'gdzie', 'oraz',
  'twoj', 'twój', 'twoje', 'swoje', 'wszystko', 'naprawde', 'naprawdę', 'realne', 'realnie',
]);

// Słowa obecne w prawie każdym artykule - nie odróżniają tematów.
const GENERIC_WORDS = new Set([
  'białystok', 'białymstoku', 'bialystok', 'bialymstoku', '2026', '2025', '2027',
  'kierowca', 'kierowcy', 'kierowcą', 'kierowcę', 'kierowców', 'kierowce', 'kierowcow',
  'praca', 'pracy', 'pracę', 'prace', 'pracować', 'pracowac', 'pracuj',
  'taxi', 'taksówka', 'taksowka', 'przewodnik', 'poradnik', 'kompletny', 'kompletna',
  'calmdriver', 'zacznij', 'zacząć', 'jakie', 'jaki', 'jaka', 'które', 'ktore', 'wszystko',
  'prawda', 'szczerze', 'krok', 'real', 'nie',
]);

const STEM_LENGTH = 5;

function normalizeWord(word) {
  return word
    .toLowerCase()
    .replace(/[^a-ząćęłńóśźż0-9]/g, '');
}

/**
 * Zamienia tytuł i slug na zbiór "rdzeni" słów (pierwsze 5 liter), żeby różne
 * odmiany ("studenta", "student", "studentów") liczyły się jako to samo słowo.
 */
function topicStems(article) {
  const text = `${article.title || ''} ${(article.slug || '').replace(/-/g, ' ')}`;
  const stems = new Set();
  for (const raw of text.split(/\s+/)) {
    const word = normalizeWord(raw);
    if (word.length < 3) continue;
    if (STOPWORDS.has(word) || GENERIC_WORDS.has(word)) continue;
    stems.add(word.slice(0, STEM_LENGTH));
  }
  return stems;
}

function similarity(a, b, stemsA, stemsB) {
  let score = 0;
  for (const stem of stemsA) {
    if (stemsB.has(stem)) score += 1;
  }
  if (a.category && a.category === b.category) score += 1;
  return score;
}

function compareByScore(x, y) {
  if (y.score !== x.score) return y.score - x.score;
  const byDate = String(y.article.date).localeCompare(String(x.article.date));
  if (byDate !== 0) return byDate;
  return x.article.slug.localeCompare(y.article.slug);
}

/**
 * Dla każdego artykułu zwraca listę n slugów powiązanych, posortowaną od
 * najbardziej podobnego. Po zwykłym rankingu dba o to, żeby każdy artykuł
 * był polecany przez co najmniej jeden inny (osierocone wpisy zastępują
 * najsłabsze polecenie u artykułu najbardziej do nich podobnego).
 */
function buildRelatedMap(articles, n) {
  const stems = new Map(articles.map(a => [a.slug, topicStems(a)]));
  const scoreOf = (a, b) => similarity(a, b, stems.get(a.slug), stems.get(b.slug));

  // Ranking per artykuł, z limitem polecen na jeden wpis (zeby kilka "hubow" nie
  // zbieralo wszystkich linkow). Limit ustepuje, gdy brakuje kandydatow.
  const cap = n * 2;
  const load = new Map(articles.map(a => [a.slug, 0]));
  const lists = new Map();
  const ordered = [...articles].sort((a, b) => a.slug.localeCompare(b.slug));
  for (const article of ordered) {
    const ranked = articles
      .filter(other => other.slug !== article.slug)
      .map(other => ({ article: other, score: scoreOf(article, other) }))
      .sort(compareByScore);
    const picked = ranked.filter(entry => load.get(entry.article.slug) < cap).slice(0, n);
    for (const entry of ranked) {
      if (picked.length >= n) break;
      if (!picked.includes(entry)) picked.push(entry);
    }
    picked.sort(compareByScore);
    for (const entry of picked) load.set(entry.article.slug, load.get(entry.article.slug) + 1);
    lists.set(article.slug, picked);
  }

  const incoming = new Map(articles.map(a => [a.slug, 0]));
  const recount = () => {
    for (const slug of incoming.keys()) incoming.set(slug, 0);
    for (const list of lists.values()) {
      for (const entry of list) incoming.set(entry.article.slug, incoming.get(entry.article.slug) + 1);
    }
  };
  recount();

  if (articles.length > n + 1) {
    for (const orphan of articles) {
      if (incoming.get(orphan.slug) > 0) continue;
      const candidates = articles
        .filter(source => source.slug !== orphan.slug)
        .map(source => ({ article: source, score: scoreOf(source, orphan) }))
        .sort(compareByScore);

      for (const { article: source, score } of candidates) {
        const list = lists.get(source.slug);
        const last = list[list.length - 1];
        // Nie wolno stworzyć nowego osieroconego wpisu.
        if (!last || incoming.get(last.article.slug) < 2) continue;
        list[list.length - 1] = { article: orphan, score };
        recount();
        break;
      }
    }
  }

  return lists;
}

/**
 * Zwraca do n artykułów powiązanych z artykułem o danym slugu (nigdy jego samego).
 * Ranking: wspólne słowa tytułu i sluga + bonus za tę samą kategorię, remis -> nowsza data.
 */
export function relatedArticles(slug, articles, n = 3) {
  const lists = buildRelatedMap(articles, n);
  const list = lists.get(slug);
  if (list) return list.map(entry => entry.article);

  // Artykuł spoza listy (np. dopiero generowany): zwykły ranking względem wszystkich.
  const probe = { slug, title: slug.replace(/-/g, ' '), category: '', date: '' };
  const probeStems = topicStems(probe);
  return articles
    .map(other => ({ article: other, score: similarity(probe, other, probeStems, topicStems(other)) }))
    .sort(compareByScore)
    .slice(0, n)
    .map(entry => entry.article);
}

/**
 * Strona docelowa (oferta) dopasowana do tematu artykułu.
 */
export function landingFor(title) {
  const normalized = String(title || '').toLowerCase();
  if (/student|uczni|uczeń|dorabia|dorywcz|weekend/.test(normalized)) {
    return { href: '/praca-dla-studenta-bialystok/', label: 'Praca dla studenta - 250 zł na start' };
  }
  if (/free\s*now|freenow/.test(normalized)) {
    return { href: '/praca-kierowca-freenow-bialystok/', label: 'Zacznij jeździć we FreeNow' };
  }
  if (/uber/.test(normalized)) {
    return { href: '/praca-kierowca-uber-bialystok/', label: 'Zacznij jeździć z Uberem' };
  }
  if (/wynajem|koszt(?:y)? auta|auto/.test(normalized)) {
    return { href: '/wynajem-auta-pod-taxi-bialystok/', label: 'Sprawdź wynajem auta pod taxi' };
  }
  return { href: '/praca-kierowca-bolt-bialystok/', label: 'Zacznij jeździć w Bolt' };
}
