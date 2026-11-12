// Entry point for `node --test tests/`: recent Node versions resolve a directory
// argument to its index.js instead of scanning it, so this file loads every
// *.test.js next to it. (`node --test "tests/**/*.test.js"` works as well.)
import { readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const files = readdirSync(here).filter((name) => name.endsWith('.test.js')).sort();

for (const name of files) {
    await import(pathToFileURL(join(here, name)).href);
}
