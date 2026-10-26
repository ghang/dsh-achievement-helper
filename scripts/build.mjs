import { mkdir, readdir, readFile, writeFile, copyFile, rm } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import { createPortraitAssets, PORTRAIT_STYLE_IDS } from '../src/portrait-assets.mjs';
const root = fileURLToPath(new URL('../', import.meta.url));
const portraits = await createPortraitAssets();
const verified = await portraits.verifyAll();
await rm(join(root, 'lib'), { recursive: true, force: true });
await mkdir(join(root, 'lib'), { recursive: true });
for (const name of await readdir(join(root, 'src'))) {
  if (name === 'client.js') {
    const code = await readFile(join(root, 'src/client.js'), 'utf8');
    const css = await readFile(join(root, 'src/client.css'), 'utf8');
    for (const marker of ["'__ACHIEVEMENT_CSS__'", "'__ACHIEVEMENT_PORTRAITS__'"]) if (code.split(marker).length !== 2) throw new Error(`Missing or repeated client build marker: ${marker}`);
    await writeFile(join(root, 'lib/client.js'), code.replace("'__ACHIEVEMENT_CSS__'", JSON.stringify(css)).replace("'__ACHIEVEMENT_PORTRAITS__'", JSON.stringify(portraits.manifest)));
  } else if (/\.(mjs|js|css)$/.test(name)) await copyFile(join(root, 'src', name), join(root, 'lib', name));
}
await mkdir(join(root, 'lib/assets/portraits'), { recursive: true });
for (const style of PORTRAIT_STYLE_IDS) await mkdir(join(root, 'lib/assets/portraits', style), { recursive: true });
for (const { file } of verified.assets) await copyFile(join(root, 'assets/portraits', file), join(root, 'lib/assets/portraits', file));
await writeFile(join(root, 'lib/portrait-manifest.json'), JSON.stringify(portraits.metadata, null, 2) + '\n');
await (await createPortraitAssets({ manifestFile: join(root, 'lib/portrait-manifest.json'), assetsDir: join(root, 'lib/assets/portraits') })).verifyAll();
console.error(`dsh-achievement-helper: clean host/client build complete; ${verified.assets.length} portrait sheets / ${verified.totalBytes} bytes`);
