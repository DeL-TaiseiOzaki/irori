import http from 'node:http';
import path from 'node:path';
import type { AddressInfo } from 'node:net';
import { randomBytes } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';

/** What a file tool call should be told before it runs, or nothing. */
export type Notice = (tool: string, input: unknown) => Promise<string | undefined>;

// Pi and OpenCode let a hook of theirs stop a tool call with a reason the model
// reads, and give it no other word in; neither runs irori's code. So each gets
// a script of its own, loaded from irori's data directory and never the KB, that
// asks irori over a loopback URL only that process knows. A notice holds the
// call once; the same call again runs. irori unreachable means no hold.
const ask = `const ask = async (tool, input) => {
  const response = await fetch(process.env.IRORI_PERSON_LINES, {
    method: 'POST',
    body: JSON.stringify({ tool, input }),
    signal: AbortSignal.timeout(15000),
  });
  return (await response.json()).notice;
};
`;
const scripts = {
  pi: `${ask}
export default function (pi) {
  pi.on('tool_call', async (event) => {
    if (event.toolName !== 'edit' && event.toolName !== 'write') return;
    const reason = await ask(event.toolName, event.input).catch(() => undefined);
    if (reason) return { block: true, reason };
  });
}
`,
  opencode: `${ask}
export const IroriPersonLines = async () => ({
  'tool.execute.before': async (input, output) => {
    if (input.tool !== 'edit' && input.tool !== 'write') return;
    const notice = await ask(input.tool, output.args).catch(() => undefined);
    if (notice) throw new Error(notice);
  },
});
`,
};
const held =
  'The call was held this once so that this is known first; the same call again runs it.';

export async function personLinesBridge(
  dataDir: string,
  agent: keyof typeof scripts,
  notice: Notice,
  env: NodeJS.ProcessEnv,
) {
  const file = path.join(dataDir, 'agents', `person-lines-${agent}.js`);
  await mkdir(path.dirname(file), { recursive: true });
  await writeFile(file, scripts[agent]);
  const heard = new Set<string>();
  const token = randomBytes(24).toString('hex');
  const server = http.createServer((request, response) => {
    let body = '';
    request.on('data', (chunk) => {
      body = (body + chunk).slice(0, 1_000_000);
    });
    request.on('end', async () => {
      let text: string | undefined;
      let status = 200;
      try {
        if (request.method !== 'POST' || request.url !== `/${token}`) throw Error('Not found');
        const { tool, input } = JSON.parse(body);
        const key = JSON.stringify([tool, input]);
        if (!heard.has(key)) text = await notice(String(tool), input).catch(() => undefined);
        if (text) heard.add(key);
      } catch {
        status = 404;
      }
      response.writeHead(status, { 'content-type': 'application/json' });
      response.end(JSON.stringify({ notice: text ? `${text} ${held}` : null }));
    });
  });
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  env = {
    ...env,
    IRORI_PERSON_LINES: `http://127.0.0.1:${(server.address() as AddressInfo).port}/${token}`,
  };
  if (agent === 'opencode') {
    // OpenCode reads a plugin from an absolute path named in this variable's
    // JSON, merged after its own files; a value already set is kept.
    const content = JSON.parse(env.OPENCODE_CONFIG_CONTENT ?? '{}');
    env.OPENCODE_CONFIG_CONTENT = JSON.stringify({
      ...content,
      plugin: [...(content.plugin ?? []), file],
    });
  }
  return {
    env,
    args: agent === 'pi' ? ['-e', file] : [],
    close: () => {
      server.closeAllConnections();
      server.close();
    },
  };
}
