import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
import { SpaiRunner } from './runner';
import { SpaiPanel, VIEW_TYPE } from './panel';

let runner: SpaiRunner;
let panel: SpaiPanel;

export function activate(context: vscode.ExtensionContext): void {
    runner = new SpaiRunner();
    panel = new SpaiPanel();

    // Restore panel content after VSCode reload
    vscode.window.registerWebviewPanelSerializer(VIEW_TYPE, {
        async deserializeWebviewPanel(restoredPanel: vscode.WebviewPanel) {
            panel.adoptRestoredPanel(restoredPanel);
        },
    });

    const workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath || '';

    function getConfig(): { binaryPath: string; timeout: number } {
        const config = vscode.workspace.getConfiguration('spai');
        return {
            binaryPath: config.get<string>('binaryPath', '') || 'spai',
            timeout: config.get<number>('timeout', 30000),
        };
    }

    async function runAndShow(command: string, args: string[]): Promise<void> {
        const config = getConfig();
        panel.showLoading(command, args);
        const result = await runner.run(
            command,
            args,
            config.binaryPath,
            config.timeout,
            workspaceRoot,
        );
        panel.showResult(result);

        if (!result.success && result.error?.includes('Is spai installed?')) {
            const action = await vscode.window.showErrorMessage(
                'spai CLI not found. Install it to use code analysis tools.',
                'Install Instructions',
                'Set Binary Path',
            );
            if (action === 'Install Instructions') {
                vscode.env.openExternal(vscode.Uri.parse(
                    'https://github.com/Semantic-partners/spai#installation',
                ));
            } else if (action === 'Set Binary Path') {
                vscode.commands.executeCommand(
                    'workbench.action.openSettings',
                    'spai.binaryPath',
                );
            }
        }
    }

    function getFilePathFromContext(uri?: vscode.Uri): string | undefined {
        if (uri) { return uri.fsPath; }
        return vscode.window.activeTextEditor?.document.uri.fsPath;
    }

    async function getSymbolFromContext(prompt: string): Promise<{ symbol: string; scopePath: string }> {
        const editor = vscode.window.activeTextEditor;
        let symbol = '';

        if (editor) {
            const wordRange = editor.document.getWordRangeAtPosition(
                editor.selection.active,
                /[:?]?[a-zA-Z_][\w.*+!?-]*(?:\/[\w.*+!?-]+)?/,
            );
            if (wordRange) {
                symbol = editor.document.getText(wordRange).replace(/^[:?]/, '');
            }
        }

        if (!symbol) {
            const input = await vscode.window.showInputBox({
                prompt,
                placeHolder: 'e.g., execute_sparql, PlanContext',
            });
            if (!input) { return { symbol: '', scopePath: '' }; }
            symbol = input;
        }

        const scopePath = editor?.document.uri.fsPath
            ? findProjectRoot(path.dirname(editor.document.uri.fsPath)) || workspaceRoot
            : workspaceRoot;

        return { symbol, scopePath };
    }

    // --- File commands (Explorer context menu) ---

    context.subscriptions.push(
        vscode.commands.registerCommand('spai.who', async (uri?: vscode.Uri) => {
            const filePath = getFilePathFromContext(uri);
            if (!filePath) { return; }
            await runAndShow('who', [filePath]);
        }),

        vscode.commands.registerCommand('spai.related', async (uri?: vscode.Uri) => {
            const filePath = getFilePathFromContext(uri);
            if (!filePath) { return; }
            await runAndShow('related', [filePath]);
        }),

        vscode.commands.registerCommand('spai.narrative', async (uri?: vscode.Uri) => {
            const filePath = getFilePathFromContext(uri);
            if (!filePath) { return; }
            await runAndShow('narrative', [filePath]);
        }),

        // --- Folder commands (Explorer context menu) ---

        vscode.commands.registerCommand('spai.drift', async (uri?: vscode.Uri) => {
            const dirPath = uri?.fsPath;
            if (!dirPath) {
                vscode.window.showWarningMessage('spai drift: right-click a folder in the explorer');
                return;
            }
            await runAndShow('drift', [dirPath]);
        }),

        vscode.commands.registerCommand('spai.shape', async (uri?: vscode.Uri) => {
            const dirPath = uri?.fsPath;
            if (!dirPath) {
                vscode.window.showWarningMessage('spai shape: right-click a folder in the explorer');
                return;
            }
            await runAndShow('shape', [dirPath]);
        }),

        vscode.commands.registerCommand('spai.hotspots', async (uri?: vscode.Uri) => {
            const dirPath = uri?.fsPath;
            if (!dirPath) {
                vscode.window.showWarningMessage('spai hotspots: right-click a folder in the explorer');
                return;
            }
            await runAndShow('hotspots', [dirPath]);
        }),

        vscode.commands.registerCommand('spai.todos', async (uri?: vscode.Uri) => {
            const dirPath = uri?.fsPath;
            if (!dirPath) {
                vscode.window.showWarningMessage('spai todos: right-click a folder in the explorer');
                return;
            }
            await runAndShow('todos', [dirPath]);
        }),

        // --- Symbol commands (Editor context menu) ---

        vscode.commands.registerCommand('spai.blast', async () => {
            const { symbol, scopePath } = await getSymbolFromContext('Symbol name for blast radius analysis');
            if (!symbol) { return; }
            await runAndShow('blast', [symbol, scopePath]);
        }),

        vscode.commands.registerCommand('spai.context', async () => {
            const { symbol, scopePath } = await getSymbolFromContext('Symbol name for context analysis');
            if (!symbol) { return; }
            await runAndShow('context', [symbol, scopePath]);
        }),

        // --- Cleanup ---

        { dispose: () => runner.dispose() },
        { dispose: () => panel.dispose() },
    );
}

/** Walk upward to find nearest project root */
function findProjectRoot(startDir: string): string | null {
    const markers = ['Cargo.toml', 'package.json', 'go.mod', 'pyproject.toml', '.git'];
    let dir = startDir;
    const root = path.parse(dir).root;

    while (dir !== root) {
        for (const marker of markers) {
            if (fs.existsSync(path.join(dir, marker))) {
                return dir;
            }
        }
        dir = path.dirname(dir);
    }
    return null;
}

export function deactivate(): void {
    // cleanup handled by disposables
}
