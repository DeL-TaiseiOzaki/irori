import { readFile, writeFile, mkdir } from 'node:fs/promises';
const reports = {};
for (const file of ['real-agents', 'ui-smoke', 'ui-smoke-real', 'lifecycle-agents']) {
  try {
    const source = JSON.parse(await readFile(`test-results/${file}.json`, 'utf8'));
    const sanitized = JSON.parse(
      JSON.stringify(source, (key, value) =>
        ['fixture', 'pid', 'ppid'].includes(key) ? undefined : value,
      ),
    );
    reports[file] = sanitized;
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
  }
}
await mkdir('docs/measurements', { recursive: true });
await writeFile(
  'docs/measurements/2026-09-12-evidence.json',
  JSON.stringify(
    {
      recordedAt: new Date().toISOString(),
      environment: 'Linux x86_64 / Xvfb; not native platform acceptance',
      reports,
    },
    null,
    2,
  ) + '\n',
);
