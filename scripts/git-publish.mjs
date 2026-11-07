import fs from 'fs';
import path from 'path';
import { execFileSync } from 'child_process';

function git(root, args, options = {}) {
  return execFileSync('git', args, { cwd: root, encoding: 'utf8', stdio: 'pipe', ...options });
}

function outputOf(error) {
  return [error.stdout, error.stderr, error.message].filter(Boolean).join('\n');
}

function hasRebase(root) {
  return fs.existsSync(path.join(root, '.git', 'rebase-merge'))
    || fs.existsSync(path.join(root, '.git', 'rebase-apply'));
}

function hasMerge(root) {
  return fs.existsSync(path.join(root, '.git', 'MERGE_HEAD'));
}

function hasConflictMarkers(file) {
  const content = fs.readFileSync(file, 'utf8');
  return /^(?:<<<<<<< |>>>>>>> )|^=======\r?$/m.test(content);
}

function validateSitemap(file) {
  const content = fs.readFileSync(file, 'utf8').trim();
  const openingUrls = (content.match(/<url>/g) || []).length;
  const closingUrls = (content.match(/<\/url>/g) || []).length;
  return content.startsWith('<?xml')
    && content.endsWith('</urlset>')
    && openingUrls > 0
    && openingUrls === closingUrls;
}

function relativeFiles(files) {
  return [...new Set(files.map(file => file.replace(/\\/g, '/')))];
}

export function syncBeforeGenerate({ root, branch }) {
  if (hasRebase(root) || hasMerge(root)) {
    throw new Error('trwa rebase lub merge — przerwano, napraw ręcznie');
  }

  const status = git(root, ['status', '--porcelain', '--untracked-files=no']).trim();
  if (status) {
    throw new Error(`drzewo robocze brudne — przerwano, napraw ręcznie:\n${status}`);
  }

  git(root, ['pull', '--rebase', 'origin', branch], { stdio: 'inherit' });
}

export function assertPublishable({ root, files }) {
  const relative = relativeFiles(files);
  for (const file of relative) {
    const fullPath = path.resolve(root, file);
    if (!fs.existsSync(fullPath)) throw new Error(`brak pliku do publikacji: ${file}`);
    if (hasConflictMarkers(fullPath)) {
      throw new Error(`znaleziono znaczniki konfliktu Git w pliku: ${file}`);
    }
  }

  if (relative.includes('app/sitemap.xml')
    && !validateSitemap(path.join(root, 'app', 'sitemap.xml'))) {
    throw new Error('niepoprawna sitemap.xml — przerwano publikację');
  }

}

function resolveSitemapConflict({ root, files, regenerate }) {
  const conflicts = git(root, ['diff', '--name-only', '--diff-filter=U'])
    .trim().split(/\r?\n/).filter(Boolean);
  if (conflicts.length !== 1 || conflicts[0] !== 'app/sitemap.xml') return false;

  regenerate();
  git(root, ['add', 'app/sitemap.xml']);
  git(root, ['-c', 'core.editor=true', 'rebase', '--continue'], { stdio: 'inherit' });
  assertPublishable({ root, files });
  return true;
}

export function commitAndPush({ root, branch, files, message, env, regenerate }) {
  const relative = relativeFiles(files);
  git(root, ['add', '--', ...relative]);
  assertPublishable({ root, files: relative });
  git(root, ['commit', '-m', message], { env: { ...process.env, ...env }, stdio: 'inherit' });
  console.log('📦 Commit utworzony');

  try {
    git(root, ['push', 'origin', branch]);
  } catch (pushError) {
    const details = outputOf(pushError);
    if (!/non-fast-forward|fetch first|rejected/i.test(details)) throw pushError;

    console.warn('⚠️  Remote zmienił się podczas generowania — synchronizuję i ponawiam push.');
    try {
      git(root, ['pull', '--rebase', 'origin', branch], { stdio: 'inherit' });
    } catch (rebaseError) {
      if (!hasRebase(root) || !resolveSitemapConflict({ root, files: relative, regenerate })) {
        if (hasRebase(root)) git(root, ['rebase', '--abort'], { stdio: 'inherit' });
        throw rebaseError;
      }
    }
    git(root, ['push', 'origin', branch]);
  }
}

export function rollback({ root, branch, createdFiles = [] }) {
  try {
    if (hasRebase(root)) {
      git(root, ['rebase', '--abort'], { stdio: 'inherit' });
      console.log('🧹 Przerwano rebase (rollback).');
    }

    const ahead = git(root, ['rev-list', '--count', `origin/${branch}..HEAD`]).trim();
    if (Number(ahead) > 0) {
      git(root, ['reset', '--hard', `origin/${branch}`], { stdio: 'inherit' });
      console.log('🧹 Przywrócono HEAD do origin (rollback).');
    } else {
      git(root, ['reset', '--hard', 'HEAD'], { stdio: 'inherit' });
      console.log('🧹 Przywrócono indeks i śledzone pliki (rollback).');
    }
  } catch (error) {
    console.error(`⚠️  Rollback Git nie powiódł się: ${outputOf(error)}`);
  }

  for (const file of createdFiles) {
    try {
      fs.rmSync(path.resolve(root, file), { force: true });
      console.log(`🧹 Usunięto nowy plik: ${file}`);
    } catch (error) {
      console.error(`⚠️  Nie udało się usunąć ${file}: ${error.message}`);
    }
  }
}
