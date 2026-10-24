import { mkdir, readdir, readFile, writeFile, copyFile, rm } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
const root = fileURLToPath(new URL('../', import.meta.url));
await rm(join(root, 'lib'), { recursive: true, force: true });
await mkdir(join(root, 'lib'), { recursive: true });
for (const name of await readdir(join(root, 'src'))) {
  if (name === 'client.js') {
    const code = await readFile(join(root, 'src/client.js'), 'utf8');
    const css = await readFile(join(root, 'src/client.css'), 'utf8');
    if (!code.includes("'__ACHIEVEMENT_CSS__'")) throw new Error('Missing client CSS build marker');
    await writeFile(join(root, 'lib/client.js'), code.replace("'__ACHIEVEMENT_CSS__'", JSON.stringify(css)));
  } else if (/\.(mjs|js)$/.test(name)) await copyFile(join(root, 'src', name), join(root, 'lib', name));
}
console.error('dsh-achievement-journal: clean host/client build complete');
