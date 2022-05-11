import { relative, resolve, sep } from 'path';
import * as cp from 'child_process';
import { readFile } from 'fs/promises';

import * as yaml from 'js-yaml';
import * as vscode from 'vscode';

let statusBarItem: vscode.StatusBarItem;
let channel: vscode.OutputChannel;
let owner: Owner | undefined = undefined;

function updateStatus(active: vscode.TextEditor | undefined) {
  if (active) {
    statusBarItem.text = '$(loading~spin) Owner: running...';
    statusBarItem.show();
    setTimeout(() => {
      try {
        codeownershipValidator(active.document.uri.fsPath).then((result) => {
          owner = result;
          log('debug', JSON.stringify(owner));
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
          const { teamConfig, slack } = owner;

          const items: { title: string; action: () => void }[] = [];

          if (slack) {
            items.push({
              title: `Slack: #${slack}`,
              action() {
                const uri = vscode.Uri.parse(
                  `https://slack.com/app_redirect?channel=${slack}`,
                );
                vscode.commands.executeCommand('vscode.open', uri);
              },
            });
          }

          items.push({
            title: 'View team config',
            action() {
              const uri = vscode.Uri.parse(teamConfig);
              vscode.commands.executeCommand('vscode.open', uri);
            },
          });

          vscode.window
            .showInformationMessage(
              `${filename} is owned by ${owner.teamName}`,
              ...items,
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
  slack?: string;
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
      });
    }, ms),
  );
};

const codeownershipValidator: Validator = async (filepath) => {
  // bin/codeownership currenlty wants relative paths
  const relativePath = relative(process.cwd(), filepath);

  const output = runCommand(
    process.cwd(),
    `bin/codeownership for_file "${relativePath}" --json`,
  );

  try {
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
        vscode.workspace.workspaceFolders?.[0]?.uri.fsPath || '',
        obj.team_yml,
      );

      return {
        filepath,
        teamName: obj.team_name,
        teamConfig,
        slack: await getSlackHandle(teamConfig),
      };
    }
  } catch {
    log('error', 'Error parsing command output');
  }
  return undefined;
};

async function getSlackHandle(teamConfig: string): Promise<string | undefined> {
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

function runCommand(cwd: string, command: string, stdin?: string): string {
  let stdout: string = '';
  log('info', `command: ${command}`);

  stdout = cp
    .execSync(command, {
      cwd,
      input: stdin,
    })
    .toString()
    .trim();

  log('info', `stdout: ${stdout}`);

  return stdout;
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
