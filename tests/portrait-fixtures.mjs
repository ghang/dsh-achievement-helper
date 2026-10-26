import { createHash } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

export const themes = ['explorer', 'xianxia', 'cyber', 'wuxia', 'fantasy', 'space', 'ocean', 'garden', 'academy', 'steampunk'];
export const styles = ['flat', 'pixel'];
export const labels = { flat: '清爽扁平', pixel: '微像素' };
export const prefix = '/dsh-achievement-helper/api/assets/portraits/';

// Synthetic static RIFF/VP8L headers: these fixtures exercise container,
// routing and packaging contracts, and do not claim to be decoded artwork.
export function tinyWebP(style = 'flat', theme = 'explorer') {
  const data = Buffer.alloc(26);
  data.write('RIFF'); data.writeUInt32LE(18, 4); data.write('WEBP', 8); data.write('VP8L', 12); data.writeUInt32LE(5, 16);
  data[20] = 0x2f; data.writeUInt32LE(3 | (1 << 14), 21);
  data[25] = styles.indexOf(style) * 10 + themes.indexOf(theme);
  return data;
}
export function manifestFor(bytesFor = tinyWebP) {
  const bytesAt = typeof bytesFor === 'function' ? bytesFor : () => bytesFor;
  return { version: 2, styles: Object.fromEntries(styles.map(style => [style, {
    label: labels[style], themes: Object.fromEntries(themes.map(theme => {
      const bytes = bytesAt(style, theme), sha256 = createHash('sha256').update(bytes).digest('hex');
      return [theme, { file: `${theme}.webp`, url: `${prefix}${style}/${theme}.webp?version=${sha256.slice(0, 12)}`, columns: 4, rows: 2, aspect: 1, width: 4, height: 2, bytes: bytes.length, sha256,
        characters: Array.from({ length: 8 }, (_, index) => ({ id: `builtin:${theme}:${index + 1}`, name: `测试伙伴${index + 1}`, icon: 'star', column: index % 4, row: Math.floor(index / 4) })) }];
    })),
  }])) };
}
export async function writeFixtureAssets(assetsDir, bytesFor = tinyWebP) {
  const bytesAt = typeof bytesFor === 'function' ? bytesFor : () => bytesFor;
  for (const style of styles) {
    await mkdir(join(assetsDir, style), { recursive: true });
    for (const theme of themes) await writeFile(join(assetsDir, style, `${theme}.webp`), bytesAt(style, theme));
  }
}
