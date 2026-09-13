import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile, copyFile, chmod } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { unzipSync } from 'fflate';

const root = fileURLToPath(new URL('../', import.meta.url));
const manifest = JSON.parse(await readFile(new URL('./rclone.json', import.meta.url), 'utf8'));

export async function prepareRclone(platform, arch, destination) {
  const target = `${{ win32: 'windows', darwin: 'osx', linux: 'linux' }[platform]}-${{ x64: 'amd64', arm64: 'arm64' }[arch]}`;
  const sha256 = manifest.checksums[target];
  if (!sha256) throw Error(`No verified rclone download for ${platform}/${arch}`);
  const filename = `rclone-v${manifest.version}-${target}.zip`;
  const cache = path.join(root, '.local', 'downloads', filename);
  let archive = await readFile(cache).catch(() => null);
  const hash = (bytes) => createHash('sha256').update(bytes).digest('hex');
  const url = `https://github.com/rclone/rclone/releases/download/v${manifest.version}/${filename}`;
  if (!archive || hash(archive) !== sha256) {
    const response = await fetch(url, { signal: AbortSignal.timeout(120000) });
    if (!response.ok) throw Error(`rclone download failed (${response.status})`);
    archive = Buffer.from(await response.arrayBuffer());
    if (hash(archive) !== sha256) throw Error('rclone archive checksum mismatch');
    await mkdir(path.dirname(cache), { recursive: true });
    await writeFile(cache, archive);
  }
  const executable = platform === 'win32' ? 'rclone.exe' : 'rclone';
  const entry = `${filename.slice(0, -4)}/${executable}`;
  // Only the exact binary is extracted; archive paths never become destination paths.
  const binary = unzipSync(archive, { filter: (file) => file.name === entry })[entry];
  if (!binary) throw Error('rclone executable missing from verified archive');
  await mkdir(destination, { recursive: true });
  await writeFile(path.join(destination, executable), binary);
  await chmod(path.join(destination, executable), 0o755);
  await copyFile(
    path.join(root, 'assets', 'rclone-LICENSE.txt'),
    path.join(destination, 'LICENSE.txt'),
  );
  await writeFile(
    path.join(destination, 'distribution.json'),
    JSON.stringify(
      { version: manifest.version, url, archiveSha256: sha256, executableSha256: hash(binary) },
      null,
      2,
    ) + '\n',
  );
  return destination;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const target = path.join(root, '.local', 'rclone', `${process.platform}-${process.arch}`);
  await prepareRclone(process.platform, process.arch, target);
  console.log(
    `Prepared verified rclone ${manifest.version} for ${process.platform}/${process.arch}`,
  );
}
