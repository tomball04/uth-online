// §33 Project file-count guard. Counts every tracked project file and fails above the 99-file cap.
// Tracked = everything under the project root except the approved generated/external paths below
// (the same paths .gitignore excludes). In a git checkout, `git ls-files` is used when available.
//   node scripts/count-files.mjs          → prints the count and the per-area budget, exits 1 above 99
//   import { countFiles } from '…'        → used by the unit test
import { readdirSync, statSync, existsSync } from 'node:fs';
import { join, relative, sep, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execSync } from 'node:child_process';

export const FILE_CAP = 99;
/** Generated or external artifacts that never count (dependencies, build output, caches, reports, local secrets). */
export const EXCLUDED = ['node_modules', '.git', 'dist', 'test-results', 'playwright-report', 'coverage', '.cache', '.vite', '.turbo', '.env'];
const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

function walk(dir, out) {
  for (const name of readdirSync(dir)) {
    if (EXCLUDED.includes(name) || name.endsWith('.log') || name === '.DS_Store') continue;
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p, out); else out.push(relative(ROOT, p).split(sep).join('/'));
  }
  return out;
}

/** Sorted list of counted files (git's tracked set when this is a git checkout, otherwise a walk of the tree). */
export function trackedFiles(root = ROOT) {
  if (existsSync(join(root, '.git'))) {
    try {
      return execSync('git ls-files', { cwd: root, encoding: 'utf8' }).split('\n').filter(Boolean)
        .filter((f) => !EXCLUDED.some((x) => f === x || f.startsWith(`${x}/`))).sort();
    } catch { /* fall through to the walk */ }
  }
  return walk(root, []).sort();
}

/** Budget areas from the scope addendum §33.2 (advisory; only the 99 total is enforced). */
export const AREAS = [
  ['Frontend and UI', (f) => f.startsWith('src/client/')],
  ['Backend and multiplayer', (f) => f.startsWith('src/server/') || f.startsWith('migrations/')],
  ['Shared game rules', (f) => f.startsWith('src/shared/') && !f.startsWith('src/shared/roast/') && !/cosmetics|avatarSvg|chips|dealers/.test(f)],
  ['Dealer and cosmetic data', (f) => f.startsWith('src/shared/roast/') || /src\/shared\/(cosmetics|avatarSvg|chips|dealers)/.test(f) || f.startsWith('docs/')],
  ['Automated tests', (f) => f.startsWith('tests/')],
  ['Configuration, scripts and documentation', () => true],
];

export function countFiles(root = ROOT) {
  const files = trackedFiles(root);
  const areas = AREAS.map(([name]) => ({ name, files: [] }));
  for (const f of files) areas[AREAS.findIndex(([, test]) => test(f))].files.push(f);
  return { total: files.length, cap: FILE_CAP, ok: files.length <= FILE_CAP, files, areas: areas.map((a) => ({ name: a.name, count: a.files.length })) };
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const r = countFiles();
  for (const a of r.areas) console.log(`  ${String(a.count).padStart(3)}  ${a.name}`);
  console.log(`${r.ok ? 'OK' : 'FAIL'}: ${r.total} tracked project files (cap ${r.cap}).`);
  if (!r.ok) process.exit(1);
}
