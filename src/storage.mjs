import { open } from 'node:fs/promises';
import { dirname } from 'node:path';

// Call only after the file itself has been synced, closed and renamed.
// Windows can reject opening or flushing a directory with EPERM. That does not
// invalidate the completed file replacement; file/rename errors are never here.
export async function syncParentDirectory(file) {
  let directory;
  try { directory = await open(dirname(file), 'r'); await directory.sync(); }
  catch (error) {
    if (!['EINVAL', 'ENOTSUP', 'EISDIR'].includes(error.code)
      && !(process.platform === 'win32' && error.code === 'EPERM')) throw error;
  } finally { await directory?.close(); }
}
