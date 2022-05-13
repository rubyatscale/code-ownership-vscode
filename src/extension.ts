import { relative, resolve, sep } from 'path';
import * as cp from 'child_process';
import { readFile } from 'fs/promises';

import * as yaml from 'js-yaml';
import * as vscode from 'vscode';

let ranWithError = false;
let statusBarItem: vscode.StatusBarItem;
let channel: vscode.OutputChannel;
let owner: Owner | undefined = undefined;

function rootWorkspace(): vscode.WorkspaceFolder | undefined {
  const count = vscode.workspace.workspaceFolders?.length || 0;
  if (count === 1) {
    return vscode.workspace.workspaceFolders?.[0];
  } else {
    log('warning', `Detected ${count} workspaces, but currently requires 1.`);
    return undefined;
  }
}

function updateStatus(active: vscode.TextEditor | undefined) {
  if (ranWithError) {
    statusBarItem.text = '$(error) Owner: Error!';
    statusBarItem.tooltip = `See "${channel.name}" output channel for details`;
    statusBarItem.show();
  } else if (active) {
    statusBarItem.text = '$(loading~spin) Owner: running...';
    statusBarItem.tooltip = undefined;
    statusBarItem.show();
    setTimeout(() => {
      try {
        codeownershipValidator(active.document.uri.fsPath).then((result) => {
          owner = result;
          log('debug', `owner: ${JSON.stringify(owner)}`);
          if (
            active.document.uri.fsPath ===
            vscode.window.activeTextEditor?.document.uri.fsPath
          ) {
            if (result) {
              statusBarItem.text = `$(account) Owner: ${result.teamName}`;
            } else {
              statusBarItem.text = `$(warning) Owner: none`;
            }
            statusBarItem.show();
          }
        });
      } catch (ex) {
        log('error', ex.message || ex.toString());

        if (
          active.document.uri.fsPath ===
          vscode.window.activeTextEditor?.document.uri.fsPath
        ) {
          statusBarItem.text = `$(error) Owner: error checking ownership!`;
          statusBarItem.show();
        }
      }
    }, 50);
  } else {
    statusBarItem.hide();
  }
}

export function activate(context: vscode.ExtensionContext) {
  channel = vscode.window.createOutputChannel('Code Ownership');
  context.subscriptions.push(channel);

  context.subscriptions.push(
    vscode.commands.registerCommand(
      'code-ownership-vscode.showOwnershipInfo',
      () => {
        if (owner) {
          const filename = owner.filepath.split(sep).slice(-1)[0];

          vscode.window
            .showInformationMessage(
              `${filename} is owned by ${owner.teamName}`,
              ...owner.actions.map((action) => ({
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

  const disposable = vscode.commands.registerCommand(
    'code-ownership-vscode.validate',
    () => {
      // TODO: do something for real
      vscode.window.showInformationMessage(
        'Hello World from code-ownership-vscode!',
      );
    },
  );

  statusBarItem = vscode.window.createStatusBarItem(
    vscode.StatusBarAlignment.Left,
  );
  statusBarItem.command = 'code-ownership-vscode.showOwnershipInfo';

  vscode.window.onDidChangeActiveTextEditor(updateStatus);
  updateStatus(vscode.window.activeTextEditor);

  context.subscriptions.push(disposable);

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

type Validator = (filepath: string) => Promise<Owner | undefined>;

/**
 * Returns randomly mocked ownership data (useful for testing?)
 * @param filepath path of the file to check
 * @returns an {@link Owner Owner} object or `undefined` if no owner can be determined
 */
const mockValidator: Validator = (filepath) => {
  const ms = Math.random() * 1000;
  const noOwner = Math.random() > 0.5;
  const isError = Math.random() > 0.99;

  return new Promise((res, rej) =>
    setTimeout(() => {
      if (isError) rej();

      if (noOwner) res(undefined);

      res({
        filepath,
        teamName: `Some Team`,
        teamConfig: filepath,
        actions: [],
      });
    }, ms),
  );
};

const codeownershipValidator: Validator = async (filepath) => {
  // bin/codeownership currenlty wants relative paths
  const cwd = rootWorkspace()?.uri.fsPath;
  const relativePath = relative(cwd || process.cwd(), filepath);

  logSpace();
  log('debug', `cwd: ${cwd}`);
  log('debug', `workspace: ${rootWorkspace()?.uri.fsPath}`);
  log('debug', `file path: ${filepath}`);
  log('debug', `relative path: ${relativePath}`);

  try {
    const output = runCommand(
      cwd,
      `bin/codeownership for_file "${relativePath}" --json`,
    );

    const obj = JSON.parse(output);

    if (typeof obj.team_name !== 'string') {
      log('warning', 'Missing expected property `team_name` in command output');
    }
    if (typeof obj.team_yml !== 'string') {
      log('warning', 'Missing expected property `team_yml` in command output');
    }

    if (
      typeof obj.team_name === 'string' &&
      typeof obj.team_yml === 'string' &&
      obj.team_name !== 'Unowned'
    ) {
      const teamConfig = resolve(
        rootWorkspace()?.uri.fsPath || '',
        obj.team_yml,
      );

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

      return {
        filepath,
        teamName: obj.team_name,
        teamConfig,
        actions,
      };
    }
    ranWithError = false;
  } catch {
    ranWithError = true;
    log('error', 'Error parsing command output');
  }
  return undefined;
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

function runCommand(
  cwd: string | undefined,
  command: string,
  stdin?: string,
): string {
  let stdout: string = '';
  log('info', `command: ${command}`);

  try {
    stdout = cp
      .execSync(command, {
        cwd,
        input: stdin,
      })
      .toString()
      .trim();

    log('info', `stdout: ${stdout}`);
    ranWithError = false;
  } catch (ex) {
    ranWithError = true;
    log('error', ex.message);
  }

  return stdout;
}

function logSpace() {
  channel.appendLine('');
}

function log(level: 'debug' | 'info' | 'warning' | 'error', msg: string) {
  channel.appendLine(`[${date()}] [${level}] ${msg}`);
}

function date() {
  return (
    new Date().toLocaleString('sv') +
    '.' +
    `000${new Date().getMilliseconds()}`.slice(-3)
  );
}
