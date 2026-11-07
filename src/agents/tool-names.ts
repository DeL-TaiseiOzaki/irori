import type { AgentId } from '../domain/types';

/**
 * A CLI's tool call as a Schema hook hears it (ADR 058): hooks are written for
 * Claude Code, so a call is named and shaped as Claude Code's tool of the same
 * kind would be (`Bash` with `command`, `Write` with `file_path` and `content`,
 * `Edit` with `file_path`, `old_string` and `new_string` …). A matcher is also
 * tried on the CLI's own name, so a hook may name either. A tool without a
 * counterpart keeps its own name and input.
 */
export interface HookTool {
  /** Claude Code's name for the tool. */
  name: string;
  /** The input in Claude Code's shape. */
  input: Record<string, unknown>;
  /** Other names a matcher may give it: `apply_patch` is an edit or a write, as Codex reads it. */
  also?: string[];
}

/**
 * The files a patch in the `apply_patch` format names (`*** Add File:`,
 * `*** Update File:`, `*** Delete File:`, `*** Move to:`), as Codex and
 * OpenCode write it.
 */
export function patchFiles(patch: unknown): string[] {
  if (typeof patch !== 'string') return [];
  const files: string[] = [];
  for (const line of patch.split(/\r?\n/)) {
    const found = /^\*\*\* (?:Add File|Update File|Delete File|Move to): (.+)$/.exec(line.trim());
    if (found && !files.includes(found[1].trim())) files.push(found[1].trim());
  }
  return files;
}

/** An `apply_patch` call as a hook hears it: the patch, and the first file and every file it changes. */
function patchTool(patch: unknown): HookTool {
  const files = patchFiles(patch);
  return {
    name: 'apply_patch',
    input: defined({ file_path: files[0], files, patch }),
    also: ['Edit', 'Write', 'MultiEdit'],
  };
}

const isObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);
const text = (value: unknown) => (typeof value === 'string' ? value : undefined);
const defined = (value: Record<string, unknown>) =>
  Object.fromEntries(Object.entries(value).filter(([, item]) => item !== undefined));

/** One edit of a file in Claude Code's shape: a single one as `Edit`, several as `MultiEdit`. */
function edits(file: unknown, list: { old_string?: string; new_string?: string }[]): HookTool {
  return list.length === 1
    ? { name: 'Edit', input: defined({ file_path: file, ...list[0] }) }
    : { name: 'MultiEdit', input: defined({ file_path: file, edits: list }) };
}

function piTool(tool: string, input: Record<string, unknown>): HookTool {
  switch (tool) {
    case 'bash':
    case 'powershell':
      return {
        name: 'Bash',
        input: defined({ command: input.command, timeout: input.timeout }),
      };
    case 'read':
      return {
        name: 'Read',
        input: defined({ file_path: input.path, offset: input.offset, limit: input.limit }),
      };
    case 'write':
      return { name: 'Write', input: defined({ file_path: input.path, content: input.content }) };
    case 'edit': {
      const list = Array.isArray(input.edits)
        ? input.edits.filter(isObject).map((edit) => ({
            old_string: text(edit.oldText),
            new_string: text(edit.newText),
          }))
        : [{ old_string: text(input.oldText), new_string: text(input.newText) }];
      return edits(input.path, list);
    }
    case 'grep':
      return {
        name: 'Grep',
        input: defined({ pattern: input.pattern, path: input.path, glob: input.glob }),
      };
    case 'find':
      return { name: 'Glob', input: defined({ pattern: input.pattern, path: input.path }) };
    case 'ls':
      return { name: 'LS', input: defined({ path: input.path }) };
    default:
      return { name: tool, input };
  }
}

function hermesTool(tool: string, input: Record<string, unknown>): HookTool {
  switch (tool) {
    case 'terminal':
      return { name: 'Bash', input: defined({ command: input.command, timeout: input.timeout }) };
    case 'read_file':
      return {
        name: 'Read',
        input: defined({ file_path: input.path, offset: input.offset, limit: input.limit }),
      };
    case 'write_file':
      return { name: 'Write', input: defined({ file_path: input.path, content: input.content }) };
    case 'patch':
      return {
        name: 'Edit',
        input: defined({
          file_path: input.path,
          old_string: input.old_string,
          new_string: input.new_string,
          replace_all: input.replace_all,
          patch: input.patch,
        }),
      };
    case 'search_files':
      return input.target === 'files'
        ? { name: 'Glob', input: defined({ pattern: input.pattern, path: input.path }) }
        : {
            name: 'Grep',
            input: defined({ pattern: input.pattern, path: input.path, glob: input.file_glob }),
          };
    case 'web_search':
      return { name: 'WebSearch', input: defined({ query: input.query }) };
    case 'web_extract':
      return {
        name: 'WebFetch',
        input: defined({ url: Array.isArray(input.urls) ? input.urls[0] : input.urls }),
      };
    case 'delegate_task':
      return { name: 'Task', input };
    default:
      return { name: tool, input };
  }
}

function antigravityTool(tool: string, input: Record<string, unknown>): HookTool {
  switch (tool) {
    case 'run_command':
      return { name: 'Bash', input: defined({ command: input.CommandLine }) };
    case 'view_file':
      return {
        name: 'Read',
        input: defined({ file_path: input.AbsolutePath, offset: input.StartLine }),
      };
    case 'write_to_file':
      return {
        name: 'Write',
        input: defined({ file_path: input.TargetFile, content: input.CodeContent }),
      };
    case 'replace_file_content':
      return {
        name: 'Edit',
        input: defined({
          file_path: input.TargetFile,
          old_string: input.TargetContent,
          new_string: input.ReplacementContent,
          replace_all: input.AllowMultiple,
        }),
      };
    case 'multi_replace_file_content':
      return edits(
        input.TargetFile,
        (Array.isArray(input.ReplacementChunks) ? input.ReplacementChunks : [])
          .filter(isObject)
          .map((chunk) => ({
            old_string: text(chunk.TargetContent),
            new_string: text(chunk.ReplacementContent),
          })),
      );
    case 'list_dir':
      return { name: 'LS', input: defined({ path: input.DirectoryPath }) };
    case 'find_by_name':
      return {
        name: 'Glob',
        input: defined({ pattern: input.Pattern, path: input.SearchDirectory }),
      };
    case 'grep_search':
      return {
        name: 'Grep',
        input: defined({ pattern: input.Query, path: input.SearchPath, glob: input.Includes }),
      };
    case 'search_web':
      return { name: 'WebSearch', input: defined({ query: input.query }) };
    case 'read_url_content':
      return { name: 'WebFetch', input: defined({ url: input.Url }) };
    case 'invoke_subagent':
      return { name: 'Task', input };
    default:
      return { name: tool, input };
  }
}

function openCodeTool(tool: string, input: Record<string, unknown>): HookTool {
  switch (tool) {
    case 'bash':
      return {
        name: 'Bash',
        input: defined({ command: input.command, timeout: input.timeout, workdir: input.workdir }),
      };
    case 'read':
      return {
        name: 'Read',
        input: defined({ file_path: input.filePath, offset: input.offset, limit: input.limit }),
      };
    case 'write':
      return {
        name: 'Write',
        input: defined({ file_path: input.filePath, content: input.content }),
      };
    case 'edit':
      return {
        name: 'Edit',
        input: defined({
          file_path: input.filePath,
          old_string: input.oldString,
          new_string: input.newString,
          replace_all: input.replaceAll,
        }),
      };
    case 'apply_patch':
      return patchTool(input.patchText);
    case 'glob':
      return { name: 'Glob', input: defined({ pattern: input.pattern, path: input.path }) };
    case 'grep':
      return {
        name: 'Grep',
        input: defined({ pattern: input.pattern, path: input.path, glob: input.include }),
      };
    case 'webfetch':
      return { name: 'WebFetch', input: defined({ url: input.url }) };
    case 'websearch':
      return { name: 'WebSearch', input };
    case 'task':
      return {
        name: 'Task',
        input: defined({
          description: input.description,
          prompt: input.prompt,
          subagent_type: input.subagent_type,
        }),
      };
    case 'todowrite':
      return { name: 'TodoWrite', input };
    case 'skill':
      return { name: 'Skill', input };
    default:
      return { name: tool, input };
  }
}

/** Codex names its calls for hooks itself, much as Claude Code does; a patch is read for its files. */
function codexTool(tool: string, input: Record<string, unknown>): HookTool {
  if (tool === 'apply_patch') return patchTool(input.command);
  return { name: tool, input };
}

/** The call as a Schema hook hears it. */
export function hookTool(agent: AgentId, tool: string, input: unknown): HookTool {
  const value = isObject(input) ? input : {};
  if (agent === 'pi') return piTool(tool, value);
  if (agent === 'hermes') return hermesTool(tool, value);
  if (agent === 'antigravity') return antigravityTool(tool, value);
  if (agent === 'opencode') return openCodeTool(tool, value);
  if (agent === 'codex') return codexTool(tool, value);
  return { name: tool, input: value };
}

/**
 * A hook's replacement input (Claude Code's shape) as the CLI's own, for the
 * tools whose fields map one to one; undefined when it does not map.
 */
export function cliToolInput(
  agent: AgentId,
  tool: string,
  original: unknown,
  replaced: Record<string, unknown>,
): Record<string, unknown> | undefined {
  const base = isObject(original) ? original : {};
  if (agent === 'pi') {
    if (tool === 'bash' || tool === 'powershell')
      return defined({ ...base, command: replaced.command ?? base.command });
    if (tool === 'write')
      return defined({
        ...base,
        path: replaced.file_path ?? base.path,
        content: replaced.content ?? base.content,
      });
    if (tool === 'read')
      return defined({
        ...base,
        path: replaced.file_path ?? base.path,
        offset: replaced.offset ?? base.offset,
        limit: replaced.limit ?? base.limit,
      });
    if (tool === 'edit') {
      const list = Array.isArray(replaced.edits)
        ? replaced.edits.filter(isObject)
        : [{ old_string: replaced.old_string, new_string: replaced.new_string }];
      return defined({
        ...base,
        path: replaced.file_path ?? base.path,
        edits: list.map((edit) => ({ oldText: edit.old_string, newText: edit.new_string })),
      });
    }
    return undefined;
  }
  if (agent === 'opencode') {
    if (tool === 'bash') return defined({ ...base, command: replaced.command ?? base.command });
    if (tool === 'write')
      return defined({
        ...base,
        filePath: replaced.file_path ?? base.filePath,
        content: replaced.content ?? base.content,
      });
    if (tool === 'read') return defined({ ...base, filePath: replaced.file_path ?? base.filePath });
    if (tool === 'edit')
      return defined({
        ...base,
        filePath: replaced.file_path ?? base.filePath,
        oldString: replaced.old_string ?? base.oldString,
        newString: replaced.new_string ?? base.newString,
      });
    if (tool === 'apply_patch' && typeof replaced.patch === 'string')
      return { ...base, patchText: replaced.patch };
    return undefined;
  }
  if (agent === 'codex') {
    // Codex takes its own tool's input back, as it gave it.
    if (tool === 'apply_patch')
      return typeof replaced.patch === 'string' ? { command: replaced.patch } : undefined;
    return replaced;
  }
  if (agent === 'antigravity') {
    // The CLI merges the replacement into the call's arguments, key by key.
    if (tool === 'run_command' && typeof replaced.command === 'string')
      return { CommandLine: replaced.command };
    if (tool === 'write_to_file')
      return defined({ TargetFile: replaced.file_path, CodeContent: replaced.content });
    if (tool === 'view_file') return defined({ AbsolutePath: replaced.file_path });
    if (tool === 'replace_file_content')
      return defined({
        TargetFile: replaced.file_path,
        TargetContent: replaced.old_string,
        ReplacementContent: replaced.new_string,
      });
    return undefined;
  }
  return undefined;
}
