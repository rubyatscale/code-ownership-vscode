import { EOL } from 'os';
import { join, relative, sep } from 'path';

import * as minimatch from 'minimatch'; // Only needed for githubValiator
import * as vscode from 'vscode';

let statusBarItem: vscode.StatusBarItem;

function updateStatus(active: vscode.TextEditor | undefined) {
  if (active) {
    statusBarItem.text = '$(watch) Owner: running...';
    statusBarItem.show();
    process.nextTick(() => {
      try {
        githubValidator(active.document.uri.fsPath).then((owner) => {
          if (
            active.document.uri.fsPath ===
            vscode.window.activeTextEditor?.document.uri.fsPath
          ) {
            if (owner) {
              statusBarItem.text = `$(account) Owner: ${owner.name}`;
            } else {
              statusBarItem.text = `$(warning) Owner: none`;
            }
            statusBarItem.show();
          }
        });
      } catch {
        if (
          active.document.uri.fsPath ===
          vscode.window.activeTextEditor?.document.uri.fsPath
        ) {
          statusBarItem.text = `$(error) Owner: error checking ownership!`;
          statusBarItem.show();
        }
      }
    });
  } else {
    statusBarItem.hide();
  }
}

export function activate(context: vscode.ExtensionContext) {
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
}

type Owner = {
  filepath: string;
  name: string;
  config: string;
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
        name: `Some Team`,
        config: filepath,
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
        name: owner,
        config: config.fsPath,
      };
    }
  }

  return undefined;
};
