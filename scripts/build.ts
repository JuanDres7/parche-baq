import { cpSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { stripTypeScriptTypes } from 'node:module';
import { createHash } from 'node:crypto';

const demo = process.argv.includes('--static');

mkdirSync('dist', { recursive: true });
cpSync('public', 'dist', { recursive: true });
for (const filename of readdirSync('src/client')) {
  if (!filename.endsWith('.ts')) continue;
  const source = readFileSync(`src/client/${filename}`, 'utf8');
  const output = stripTypeScriptTypes(source, { mode: 'strip' });
  writeFileSync(`dist/${filename.replace(/\.ts$/, '.js')}`, output);
}
// A fresh HTML page must load its matching modules even when an older worker controls the tab.
const hash = createHash('sha256');
for (const entry of readdirSync('dist', { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
  if (entry.isFile()) hash.update(entry.name).update(readFileSync(`dist/${entry.name}`));
}
const version = hash.digest('hex').slice(0, 12);
const release = `assets-${version}`;
for (const entry of readdirSync('dist', { withFileTypes: true })) {
  if (entry.isDirectory() && entry.name.startsWith('assets-') && entry.name !== release) {
    rmSync(`dist/${entry.name}`, { recursive: true, force: true });
  }
}
mkdirSync(`dist/${release}`, { recursive: true });
const modules = readdirSync('src/client').filter(file => file.endsWith('.ts')).map(file => file.replace(/\.ts$/, '.js'));
const files = [...modules, 'styles.css', 'icon.svg', 'icon-192.png', 'icon-512.png', 'icon-maskable.png', 'app.webmanifest'];
for (const file of files) cpSync(`dist/${file}`, `dist/${release}/${file}`);

function assetURLs(source: string) {
  return source.replace(/(["'])\/([\w.-]+)(?:\?v=[\w-]+)?\1/g, (original, quote, file) =>
    files.includes(file) ? `${quote}/${release}/${file}${quote}` : original);
}
for (const file of ['index.html', 'sw.js']) {
  let source = readFileSync(`public/${file}`, 'utf8').replace('__CACHE_VERSION__', version);
  if (demo && file === 'index.html') {
    source = source.replace('window.PARCHE_DEMO = false;', 'window.PARCHE_DEMO = true;');
  }
  writeFileSync(`dist/${file}`, assetURLs(source));
}
writeFileSync(`dist/${release}/app.webmanifest`, assetURLs(readFileSync('public/app.webmanifest', 'utf8')));
console.log(demo ? 'Parche compilado en dist/ (demo estática)' : 'Parche compilado en dist/');
