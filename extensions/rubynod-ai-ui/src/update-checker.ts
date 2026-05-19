import * as vscode from 'vscode';

interface GitHubRelease {
  tag_name: string;
  html_url: string;
  body?: string;
  assets?: Array<{ name: string; browser_download_url: string }>;
}

interface LatestMeta {
  version?: string;
  extensionVsix?: string;
}

const STORAGE_KEY = 'rubynod.lastNotifiedVersion';

function parseSemver(v: string): [number, number, number] {
  const m = v.replace(/^v/, '').match(/^(\d+)\.(\d+)\.(\d+)/);
  if (!m) return [0, 0, 0];
  return [parseInt(m[1]!, 10), parseInt(m[2]!, 10), parseInt(m[3]!, 10)];
}

function isNewer(latest: string, current: string): boolean {
  const a = parseSemver(latest);
  const b = parseSemver(current);
  for (let i = 0; i < 3; i++) {
    if (a[i]! > b[i]!) return true;
    if (a[i]! < b[i]!) return false;
  }
  return false;
}

export class UpdateChecker implements vscode.Disposable {
  private timer?: ReturnType<typeof setInterval>;
  private disposables: vscode.Disposable[] = [];

  constructor(private readonly extensionVersion: string) {}

  start(context: vscode.ExtensionContext): void {
    const cfg = () => vscode.workspace.getConfiguration('rubynod.update');
    if (!cfg().get<boolean>('enabled', true)) return;

    const run = () => void this.check(context, cfg().get<string>('githubRepo', 'rohitpatil7892/rubynod'));
    run();

    const hours = cfg().get<number>('checkIntervalHours', 12);
    this.timer = setInterval(run, Math.max(1, hours) * 60 * 60 * 1000);

    this.disposables.push(
      vscode.commands.registerCommand('rubynod.checkForUpdates', () => run())
    );
  }

  private async check(context: vscode.ExtensionContext, repo: string): Promise<void> {
    try {
      const latest = await this.fetchLatest(repo);
      if (!latest) return;

      const tag = latest.tag_name;
      if (!isNewer(tag, this.extensionVersion)) return;

      const last = context.globalState.get<string>(STORAGE_KEY);
      if (last === tag) return;

      const vsix =
        latest.assets?.find((a) => a.name.endsWith('.vsix'))?.browser_download_url ??
        (await this.fetchLatestMeta(repo))?.extensionVsix;

      const actionRelease = 'View release';
      const actionDownload = vsix ? 'Download extension' : undefined;
      const actions = [actionRelease, actionDownload].filter(Boolean) as string[];

      const choice = await vscode.window.showInformationMessage(
        `A new version of Rubynod is available: ${tag} (you have v${this.extensionVersion}).`,
        ...actions,
        'Later'
      );

      context.globalState.update(STORAGE_KEY, tag);

      if (choice === actionRelease) {
        await vscode.env.openExternal(vscode.Uri.parse(latest.html_url));
      } else if (choice === actionDownload && vsix) {
        await vscode.env.openExternal(vscode.Uri.parse(vsix));
      }
    } catch {
      // offline or rate-limited — silent
    }
  }

  private async fetchLatest(repo: string): Promise<GitHubRelease | null> {
    const headers: Record<string, string> = { Accept: 'application/vnd.github+json' };
    const token = process.env.GITHUB_TOKEN;
    if (token) headers.Authorization = `Bearer ${token}`;

    const res = await fetch(`https://api.github.com/repos/${repo}/releases/latest`, { headers });
    if (res.status === 404) {
      const tags = await fetch(`https://api.github.com/repos/${repo}/tags`, { headers });
      if (!tags.ok) return null;
      const list = (await tags.json()) as Array<{ name: string }>;
      if (!list[0]) return null;
      return { tag_name: list[0].name, html_url: `https://github.com/${repo}/releases/tag/${list[0].name}` };
    }
    if (!res.ok) return null;
    return (await res.json()) as GitHubRelease;
  }

  private async fetchLatestMeta(repo: string): Promise<LatestMeta | null> {
    const [owner, name] = repo.split('/');
    const url = `https://raw.githubusercontent.com/${owner}/${name}/main/updates/latest.json`;
    try {
      const res = await fetch(url);
      if (!res.ok) return null;
      return (await res.json()) as LatestMeta;
    } catch {
      return null;
    }
  }

  dispose(): void {
    if (this.timer) clearInterval(this.timer);
    for (const d of this.disposables) d.dispose();
  }
}
