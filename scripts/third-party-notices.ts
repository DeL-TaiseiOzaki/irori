import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import type { Plugin } from 'vite';

// Vite bundles the renderer's packages into dist/, and the package no longer carries their
// directories (forge.config.cjs), so the bundle ships its own notices: one entry for every
// package Rollup loaded a module from, with the licence files that package carries. The
// module graph, not the chunks' rendered modules, is what names a package whose modules
// only re-export another's, such as @milkdown/kit.
export function thirdPartyNotices(fileName = 'third-party-notices.txt'): Plugin {
  return {
    name: 'third-party-notices',
    generateBundle() {
      const directories = new Set<string>();
      // Data a package keeps in a folder of its own, such as pdf.js's fonts and decoders,
      // can carry its own licences there; the folders modules came from, per package.
      const folders = new Map<string, Set<string>>();
      for (const id of this.getModuleIds()) {
        // Virtual modules start with \0; a package's directory is the last node_modules entry.
        const directory = /^[^\0].*\/node_modules\/(@[^/]+\/)?[^@/][^/]*(?=\/)/.exec(id)?.[0];
        if (!directory) continue;
        directories.add(directory);
        const folder = path.dirname(id.replace(/\?.*$/, ''));
        if (folder !== directory)
          folders.set(directory, (folders.get(directory) ?? new Set()).add(folder));
      }
      const licences = (folder: string, prefix = '') =>
        readdirSync(folder, { withFileTypes: true })
          .filter(
            (entry) => entry.isFile() && /^(licen[cs]e|notice|copying)([._-]|$)/i.test(entry.name),
          )
          .map(
            (entry) =>
              `${prefix}${entry.name}:\n\n${readFileSync(path.join(folder, entry.name), 'utf8').trim()}`,
          );
      const entries = [...directories].map((directory) => {
        const { name, version, license } = JSON.parse(
          readFileSync(path.join(directory, 'package.json'), 'utf8'),
        );
        const files = [
          ...licences(directory),
          ...[...(folders.get(directory) ?? [])]
            .sort()
            .flatMap((folder) => licences(folder, `${path.relative(directory, folder)}/`)),
        ];
        const declared = typeof license === 'string' ? license : 'see package.json';
        return [`${name}@${version} (${declared})`, ...files].join('\n\n');
      });
      const header =
        "Third-party notices for irori's renderer bundle\n\n" +
        "The files beside this one were built by Vite from irori's own source, which is MIT\n" +
        'licensed (see LICENSE), and from modules of the packages below. Each entry gives the\n' +
        'package name and version, the licence its package.json declares, and the licence and\n' +
        'notice files it carries.';
      this.emitFile({
        type: 'asset',
        fileName,
        source: [header, ...entries.sort()].join(`\n\n${'='.repeat(72)}\n\n`) + '\n',
      });
    },
  };
}
