import test from 'node:test';
import assert from 'node:assert/strict';
import { readdir, readFile } from 'node:fs/promises';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const apiDirectory = fileURLToPath(new URL('../api/', import.meta.url));

async function listTypeScriptFiles(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const nestedFiles = await Promise.all(entries.map(async entry => {
    const fullPath = join(directory, entry.name);
    if (entry.isDirectory()) return listTypeScriptFiles(fullPath);
    return entry.isFile() && entry.name.endsWith('.ts') ? [fullPath] : [];
  }));
  return nestedFiles.flat();
}

test('los módulos API no emiten imports runtime directos a archivos .ts', async () => {
  const files = await listTypeScriptFiles(apiDirectory);
  const invalidImports = [];
  const importPattern = /\b(?:from\s*|import\s*\(\s*|import\s*)['"]([^'"]+)['"]/g;

  for (const file of files) {
    const source = await readFile(file, 'utf8');
    for (const match of source.matchAll(importPattern)) {
      const specifier = match[1];
      if (specifier.startsWith('.') && specifier.endsWith('.ts')) {
        invalidImports.push(`${relative(apiDirectory, file)} -> ${specifier}`);
      }
    }
  }

  assert.deepEqual(invalidImports, [],
    'usa specifiers .js para imports locales de TypeScript desde el backend API');
});
