// Entry point for `node --test tests/pearl/` (recent Node versions resolve a
// directory argument to its index.js): loads every *.test.js next to this file.
import { readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const files = readdirSync(here).filter((name) => name.endsWith('.test.js')).sort();

for (const name of files) {
    await import(pathToFileURL(join(here, name)).href);
}
