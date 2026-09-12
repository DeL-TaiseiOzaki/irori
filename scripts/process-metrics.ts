import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
const exec = promisify(execFile);
export async function processTree(root: number) {
  if (process.platform !== 'linux') return undefined;
  const { stdout } = await exec('ps', ['-eo', 'pid=,ppid=,rss=,comm=']);
  const rows = stdout
    .trim()
    .split('\n')
    .map((line) => {
      const [pid, ppid, rss, ...name] = line.trim().split(/\s+/);
      return { pid: Number(pid), ppid: Number(ppid), rssKiB: Number(rss), name: name.join(' ') };
    });
  const ids = new Set([root]);
  let changed = true;
  while (changed) {
    changed = false;
    for (const row of rows)
      if (ids.has(row.ppid) && !ids.has(row.pid)) {
        ids.add(row.pid);
        changed = true;
      }
  }
  const processes = rows.filter((row) => ids.has(row.pid));
  return { totalRssKiB: processes.reduce((sum, p) => sum + p.rssKiB, 0), processes };
}
