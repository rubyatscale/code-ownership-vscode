import { relative, resolve, sep } from 'path';
import * as cp from 'child_process';
import { readFile } from 'fs/promises';
import { existsSync } from 'fs';

import * as yaml from 'js-yaml';
import * as vscode from 'vscode';

let channel: vscode.OutputChannel;

function run(file: string | vscode.Uri | null | undefined) {
  if (!file) {
    if (!vscode.window.activeTextEditor) return;
    run(vscode.window.activeTextEditor.document.uri);
    return;
  }

  const uri = typeof file === 'string' ? vscode.Uri.parse(file) : file;

  for (const worker of workers.values()) {
    if (worker.workspaceHas(uri)) {
      worker.run(uri);
      break;
    }
  }
}

const workers = new Map<string, Worker>();

export function activate(context: vscode.ExtensionContext) {
  channel = vscode.window.createOutputChannel('Code Ownership');
  context.subscriptions.push(channel);

  const statusBarItem = vscode.window.createStatusBarItem(
    vscode.StatusBarAlignment.Left,
  );
  statusBarItem.command = 'code-ownership-vscode.showOwnershipInfo';
  context.subscriptions.push(statusBarItem);

  context.subscriptions.push(
    vscode.commands.registerCommand('code-ownership-vscode.run', run),
  );

  context.subscriptions.push(
    vscode.commands.registerCommand(
      'code-ownership-vscode.showOutputChannel',
      () => {
        channel.show();
      },
    ),
  );

  const statusProvider = new StatusProvider(statusBarItem);
  context.subscriptions.push(statusProvider);

  context.subscriptions.push(
    vscode.commands.registerCommand(
      'code-ownership-vscode.showOwnershipInfo',
      () => {
        if (statusProvider.owner) {
          const filename = statusProvider.owner.filepath
            .split(sep)
            .slice(-1)[0];

          vscode.window
            .showInformationMessage(
              `${filename} is owned by ${statusProvider.owner.teamName}`,
              ...statusProvider.owner.actions.map((action) => ({
                title: action.title,
                action() {
                  vscode.commands.executeCommand('vscode.open', action.uri);
                },
              })),
            )
            .then((x) => x?.action());
        }
      },
    ),
  );

  context.subscriptions.push(
    vscode.window.onDidChangeActiveTextEditor((active) => {
      if (active)
        vscode.commands.executeCommand(
          'code-ownership-vscode.run',
          active.document.uri,
        );
    }),
  );

  context.subscriptions.push(
    vscode.workspace.onDidChangeWorkspaceFolders(({ added, removed }) => {
      for (const add of added) {
        if (workers.has(add.name)) {
          workers.get(add.name)!.dispose();
          workers.delete(add.name);
        }

        workers.set(add.name, new Worker(add, statusProvider));
      }

      for (const remove of removed) {
        if (workers.has(remove.name)) {
          workers.get(remove.name)!.dispose();
          workers.delete(remove.name);
        }
      }
    }),
  );

  vscode.workspace.workspaceFolders?.forEach((folder) => {
    workers.set(folder.name, new Worker(folder, statusProvider));
  });

  vscode.commands.executeCommand('code-ownership-vscode.run');

  log('info', 'Exension activated');
}

type Owner = {
  filepath: string;
  teamName: string;
  teamConfig: string;
  actions: UserAction[];
};

type UserAction = {
  title: string;
  uri: vscode.Uri;
};

async function getSlackChannel(
  teamConfig: string,
): Promise<string | undefined> {
  try {
    const text = (await readFile(teamConfig)).toString();
    const config = yaml.load(text) as any;

    if (typeof config?.slack?.room_for_humans === 'string') {
      const slack = config?.slack?.room_for_humans;
      return slack.startsWith('#') ? slack.slice(1) : slack;
    }

    return undefined;
  } catch {
    return undefined;
  }
}

async function runCommand(
  cwd: string | undefined,
  command: string,
  statusProvider: StatusProvider,
): Promise<string> {
  let stdout: string = '';
  log('info', `command: ${command}`);

  try {
    stdout = await new Promise((res, rej) =>
      cp.exec(command, { cwd }, (err, out, stderr) => {
        if (err) rej(err);
        else if (typeof stderr === 'string' && stderr.length) rej(stderr);
        else res(out.trim());
      }),
    );

    log('info', `stdout: ${stdout}`);
  } catch (ex) {
    statusProvider.status = 'error';
    log('error', ex.message || ex.toString());
  }

  return stdout;
}

function logSpace() {
  channel.appendLine('');
}

function log(level: 'debug' | 'info' | 'warning' | 'error', ...msg: string[]) {
  channel.appendLine(`[${date()}] [${level}] ${msg.join(', ')}`);
}

function date() {
  return (
    new Date().toLocaleString('sv') +
    '.' +
    `000${new Date().getMilliseconds()}`.slice(-3)
  );
}

type Status = 'idle' | 'working' | 'error';

class StatusProvider implements vscode.Disposable {
  constructor(private readonly statusBarItem: vscode.StatusBarItem) {
    this._listener = vscode.window.onDidChangeActiveTextEditor((active) => {
      if (!active) this.statusBarItem.hide();
    });
  }

  private _listener: vscode.Disposable;

  private _status: Status = 'idle';
  private _owner: Owner | undefined = undefined;
  private _isConfigured: boolean | null = null;

  get status(): Status {
    return this._status;
  }
  set status(value: Status) {
    this._status = value;
    this.update();
  }

  get owner(): Owner | undefined {
    return this._owner;
  }
  set owner(value: Owner | undefined) {
    this._owner = value;
    this.update();
  }

  get isConfigured(): boolean | null {
    return this._isConfigured;
  }
  set isConfigured(value: boolean | null) {
    this._isConfigured = value;
    this.update();
  }

  private update() {
    if (this.status === 'error') {
      this.statusBarItem.command = 'code-ownership-vscode.showOutputChannel';
    } else {
      this.statusBarItem.command = 'code-ownership-vscode.showOwnershipInfo';
    }

    if (this.status === 'error') {
      this.statusBarItem.text = '$(error) Owner: Error!';
      this.statusBarItem.tooltip = `See "${channel.name}" output channel for details`;
      this.statusBarItem.show();
    } else if (this.status === 'working') {
      this.statusBarItem.text = '$(loading~spin) Owner: running...';
      this.statusBarItem.tooltip = undefined;
      this.statusBarItem.show();
    } else if (this.status === 'idle') {
      if (this.owner) {
        this.statusBarItem.text = `$(account) Owner: ${this.owner.teamName}`;
        this.statusBarItem.tooltip = undefined;
        this.statusBarItem.show();
      } else if (this.isConfigured === false) {
        this.statusBarItem.text = `$(info) Ownership: not configured`;
        this.statusBarItem.tooltip = 'This workspace is not configured for code ownership';
        this.statusBarItem.show();
      } else {
        this.statusBarItem.text = `$(warning) Owner: none`;
        this.statusBarItem.tooltip = 'This file has no assigned team ownership';
        this.statusBarItem.show();
      }
    }
  }

  dispose() {
    this._listener.dispose();
  }
}

class Worker implements vscode.Disposable {
  private isConfigured: boolean | null = null;

  constructor(
    private readonly workspace: vscode.WorkspaceFolder,
    private readonly statusProvider: StatusProvider,
  ) {
    this.checkConfiguration();
  }

  private async checkConfiguration(): Promise<void> {
    const binaryPath = resolve(this.workspace.uri.fsPath, 'bin/codeownership');
    this.isConfigured = existsSync(binaryPath);
    this.statusProvider.isConfigured = this.isConfigured;

    if (!this.isConfigured) {
      log('info', `No code ownership binary found in workspace: ${this.workspace.name}`);
    } else {
      log('info', `Code ownership binary found in workspace: ${this.workspace.name}`);
    }
  }

  workspaceHas(file: vscode.Uri): boolean {
    return file.fsPath.startsWith(this.workspace.uri.fsPath);
  }

  async run(file: vscode.Uri): Promise<void> {
    if (!this.workspaceHas(file)) return;

    if (this.isConfigured === null) {
      await this.checkConfiguration();
    }

    if (!this.isConfigured) {
      this.statusProvider.owner = undefined;
      this.statusProvider.status = 'idle';
      return;
    }

    this.statusProvider.status = 'working';
    await new Promise((r) => setTimeout(r, 50));

    const cwd = this.workspace.uri.fsPath;
    const relativePath = relative(cwd, file.fsPath);

    logSpace();
    log('info', `Checking ownership for ${relativePath}`);
    log('debug', `cwd: ${cwd}`);
    log('debug', `workspace: ${this.workspace.uri.fsPath}`);
    log('debug', `file path: ${file.fsPath}`);

    // Run ownership check
    const output = await runCommand(
      cwd,
      `bin/codeownership for_file "${relativePath}" --json`,
      this.statusProvider,
    );

    if (!output) {
      log('info', 'Code ownership check returned no output');
      this.statusProvider.owner = undefined;
      this.statusProvider.status = 'idle';
      return;
    }

    try {
      const obj = JSON.parse(output);

      if (!obj.team_name) {
        log('info', 'No team name found in ownership data');
        this.statusProvider.owner = undefined;
        this.statusProvider.status = 'idle';
        return;
      }

      if (!obj.team_yml) {
        log('info', 'No team config file found in ownership data');
        this.statusProvider.owner = undefined;
        this.statusProvider.status = 'idle';
        return;
      }

      if (obj.team_name === 'Unowned') {
        log('info', 'File is explicitly unowned');
        this.statusProvider.owner = undefined;
        this.statusProvider.status = 'idle';
        return;
      }

      const teamConfig = resolve(this.workspace.uri.fsPath, obj.team_yml);
      const actions: UserAction[] = [];

      const slackChannel = await getSlackChannel(teamConfig);
      if (slackChannel) {
        actions.push({
          title: `Slack: #${slackChannel}`,
          uri: vscode.Uri.parse(
            `https://slack.com/app_redirect?channel=${slackChannel}`,
          ),
        });
      }

      actions.push({
        title: 'View team config',
        uri: vscode.Uri.parse(teamConfig),
      });

      this.statusProvider.owner = {
        filepath: file.fsPath,
        teamName: obj.team_name,
        teamConfig,
        actions,
      };
      this.statusProvider.status = 'idle';
    } catch (error) {
      log('info', `Invalid ownership data format: ${error.message}`);
      this.statusProvider.owner = undefined;
      this.statusProvider.status = 'idle';
    }
  }

  dispose() {
    // TODO
  }
}
