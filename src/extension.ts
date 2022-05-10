import { EOL } from 'os';
import { join, relative, sep } from 'path';
import * as cp from 'child_process';

import * as minimatch from 'minimatch'; // Only needed for githubValiator
import * as vscode from 'vscode';

let statusBarItem: vscode.StatusBarItem;
let channel: vscode.OutputChannel;

function updateStatus(active: vscode.TextEditor | undefined) {
  console.log(active);
  if (active) {
    statusBarItem.text = '$(loading~spin) Owner: running...';
    statusBarItem.show();
    setTimeout(() => {
      try {
        codeownershipValidator(active.document.uri.fsPath).then((owner) => {
          if (
            active.document.uri.fsPath ===
            vscode.window.activeTextEditor?.document.uri.fsPath
          ) {
            if (owner && owner.teamName !== 'Unowned') {
              statusBarItem.text = `$(account) Owner: ${owner.teamName}`;
            } else {
              statusBarItem.text = `$(warning) Owner: Unowned`;
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

  const disposable = vscode.commands.registerCommand(
    'ownership-vscode.validate',
    () => {
      // TODO: do something for real
      vscode.window.showInformationMessage(
        'Hello World from ownership-vscode!',
      );
    },
  );

  statusBarItem = vscode.window.createStatusBarItem(
    vscode.StatusBarAlignment.Left,
  );

  vscode.window.onDidChangeActiveTextEditor(updateStatus);
  updateStatus(vscode.window.activeTextEditor);

  context.subscriptions.push(disposable);

  log('info', 'Exension activated');
}

type Owner = {
  filepath: string;
  teamName: string;
  teamConfig: string;
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

/**
 * Checks for file ownership by looking at the existing `.github/CODEOWNERS` file
 * @param filepath path of the file to check
 * @returns an {@link Owner Owner} object or `undefined` if no owner can be determined
 */
const githubValidator: Validator = async (filepath) => {
  const config = vscode.Uri.parse(
    join(
      vscode.workspace.workspaceFolders?.[0]?.uri.fsPath || '',
      '.github',
      'CODEOWNERS',
    ),
  );

  const rel = `${sep}${relative(
    vscode.workspace.workspaceFolders?.[0]?.uri.fsPath || '',
    filepath,
  )}`;

  const doc = await vscode.workspace.openTextDocument(config);

  const codeowners = doc.getText().split(EOL);

  for (const line of codeowners) {
    const [pattern, owner] = line.split(' ');

    if (minimatch(rel, pattern)) {
      return {
        filepath,
        teamName: owner,
        teamConfig: config.fsPath,
      };
    }
  }

  return undefined;
};

const codeownershipValidator: Validator = async (filepath) => {
  const output = runCommand(
    process.cwd(),
    `bin/codeownership for_file ${filepath} --json`,
  );

  try {
    const obj = JSON.parse(output);

    if (typeof obj.team_name !== 'string') {
      log('warning', 'Missing expected property `team_name` in command output');
    }
    if (typeof obj.team_yml !== 'string') {
      log('warning', 'Missing expected property `team_yml` in command output');
    }

    if (typeof obj.team_name === 'string' && typeof obj.team_yml === 'string') {
      return {
        filepath,
        teamName: obj.team_name,
        teamConfig: obj.team_yml,
      };
    }
  } catch {
    log('error', 'Error parsing command output');
  }
  return undefined;
};

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
