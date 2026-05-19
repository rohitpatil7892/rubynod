export type ActivityStepKind = 'think' | 'plan' | 'explore' | 'edit' | 'run' | 'search';

export function thinkingLabel(turn: number, mode: string): { step: ActivityStepKind; label: string } {
  if (turn === 0) {
    if (mode === 'plan') return { step: 'plan', label: 'Planning approach…' };
    if (mode === 'debug') return { step: 'think', label: 'Analyzing the issue…' };
    return { step: 'think', label: 'Thinking…' };
  }
  return { step: 'plan', label: 'Planning next move…' };
}

export function describeToolStart(
  name: string,
  args: Record<string, unknown>
): { step: ActivityStepKind; label: string; detail: string } {
  const p = String(args.path ?? args.file ?? '');
  const short = p ? `\`${p}\`` : '';
  switch (name) {
    case 'read_file':
    case 'read_lints':
      return {
        step: 'explore',
        label: `Exploring ${short || 'file'}`,
        detail: p ? `Reading ${p}` : 'Reading file',
      };
    case 'list_dir':
      return {
        step: 'explore',
        label: `Exploring ${short || 'directory'}`,
        detail: `Listing ${args.path ?? '.'}`,
      };
    case 'grep':
      return {
        step: 'search',
        label: 'Searching codebase',
        detail: `Pattern: ${args.pattern ?? ''}`,
      };
    case 'glob':
      return {
        step: 'search',
        label: 'Finding files',
        detail: `Glob: ${args.pattern ?? ''}`,
      };
    case 'codebase_search':
      return {
        step: 'search',
        label: 'Searching codebase',
        detail: String(args.query ?? ''),
      };
    case 'write_file':
      return {
        step: 'edit',
        label: `Edit attempt ${short}`,
        detail: `Writing ${p || 'file'}`,
      };
    case 'search_replace':
      return {
        step: 'edit',
        label: `Edit attempt ${short}`,
        detail: `Patching ${p || 'file'}`,
      };
    case 'run_terminal':
    case 'Shell':
      return {
        step: 'run',
        label: 'Running command',
        detail: String(args.command ?? '').slice(0, 120),
      };
    case 'web_search':
      return {
        step: 'search',
        label: 'Searching the web',
        detail: String(args.query ?? ''),
      };
    default:
      return {
        step: 'explore',
        label: name.replace(/_/g, ' '),
        detail: JSON.stringify(args).slice(0, 100),
      };
  }
}

export function describeToolEnd(name: string, result: string, ok: boolean): string {
  const preview = result.replace(/\s+/g, ' ').trim().slice(0, 160);
  if (!ok) return preview || 'Failed';
  if (name === 'read_file' || name === 'list_dir') return preview ? `Found: ${preview}` : 'Done';
  if (name === 'write_file' || name === 'search_replace') return 'Change applied';
  if (name === 'run_terminal' || name === 'Shell') return preview ? `Output: ${preview}` : 'Command finished';
  return preview || 'Done';
}
