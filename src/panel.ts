import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
import { SpaiResult } from './runner';
import { parseEdn, EdnMap, ednStr, ednNum, ednKw, ednVec } from './edn';

const COMMAND_DESCRIPTIONS: Record<string, string> = {
    blast: 'Blast Radius',
    who: 'Who Imports This?',
    related: 'Co-Change Partners',
    narrative: 'File Biography',
    drift: 'Architecture Drift',
    shape: 'Module Shape',
    context: 'Symbol Context',
    hotspots: 'Hotspots',
    todos: 'TODOs',
};

// Phase colors for narrative timeline
const PHASE_COLORS: Record<string, string> = {
    created: '#4ec9b0',
    growth: '#569cd6',
    evolve: '#9cdcfe',
    fix: '#f44747',
    refactor: '#dcdcaa',
    split: '#ce9178',
    restructure: '#c586c0',
    tweak: '#6a9955',
};

export const VIEW_TYPE = 'spaiResults';

export class SpaiPanel {
    private panel: vscode.WebviewPanel | null = null;
    private workspaceRoot: string;
    private lastCwd: string = '';

    constructor() {
        this.workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath || '';
    }

    /** Adopt a panel restored by VSCode after reload */
    adoptRestoredPanel(restoredPanel: vscode.WebviewPanel): void {
        this.panel = restoredPanel;
        this.panel.onDidDispose(() => { this.panel = null; });
        this.panel.webview.onDidReceiveMessage((message) => {
            if (message.type === 'openFile') {
                const resolved = this.resolveFilePath(message.path);
                if (!resolved) {
                    vscode.window.showWarningMessage(`Could not find file: ${message.path}`);
                    return;
                }
                const uri = vscode.Uri.file(resolved);
                const options: vscode.TextDocumentShowOptions = {
                    viewColumn: vscode.ViewColumn.One,
                    preserveFocus: false,
                };
                if (message.line) {
                    const line = Math.max(0, message.line - 1);
                    options.selection = new vscode.Range(line, 0, line, 0);
                }
                vscode.window.showTextDocument(uri, options);
            }
        });
        // Show a placeholder until the user runs a command
        this.panel.webview.html = this.wrapHtml(`
            <div class="loading">
                <span>Right-click a file, folder, or symbol to run a spai command.</span>
            </div>
        `);
    }

    showLoading(command: string, args: string[]): void {
        this.ensurePanel(command);
        if (this.panel) {
            this.panel.title = `spai ${command}`;
            this.panel.webview.html = this.buildLoadingHtml(command, args);
            this.panel.reveal(vscode.ViewColumn.Beside, true);
        }
    }

    showResult(result: SpaiResult): void {
        this.lastCwd = result.cwd || this.workspaceRoot;
        this.ensurePanel(result.command);
        if (this.panel) {
            this.panel.title = `spai ${result.command}`;
            this.panel.webview.html = result.success
                ? this.buildResultHtml(result)
                : this.buildErrorHtml(result);
            this.panel.reveal(vscode.ViewColumn.Beside, true);
        }
    }

    private ensurePanel(command: string): void {
        if (!this.panel) {
            this.panel = vscode.window.createWebviewPanel(
                VIEW_TYPE,
                `spai ${command}`,
                { viewColumn: vscode.ViewColumn.Beside, preserveFocus: true },
                { enableScripts: true, retainContextWhenHidden: true },
            );

            this.panel.onDidDispose(() => { this.panel = null; });

            this.panel.webview.onDidReceiveMessage((message) => {
                if (message.type === 'openFile') {
                    const resolved = this.resolveFilePath(message.path);
                    if (!resolved) {
                        vscode.window.showWarningMessage(`Could not find file: ${message.path}`);
                        return;
                    }
                    const uri = vscode.Uri.file(resolved);
                    const options: vscode.TextDocumentShowOptions = {
                        viewColumn: vscode.ViewColumn.One,
                        preserveFocus: false,
                    };
                    if (message.line) {
                        const line = Math.max(0, message.line - 1);
                        options.selection = new vscode.Range(line, 0, line, 0);
                    }
                    vscode.window.showTextDocument(uri, options);
                }
            });
        }
    }

    // ---- Result rendering with command-specific visualizations ----

    private buildResultHtml(result: SpaiResult): string {
        const desc = COMMAND_DESCRIPTIONS[result.command] || result.command;
        const argsDisplay = result.args.map(a => this.shortenPath(a)).join(' ');

        // Try to parse EDN for rich rendering
        let richBody = '';
        try {
            const data = parseEdn(result.output);
            if (data && typeof data === 'object' && !Array.isArray(data)) {
                const map = data as EdnMap;
                switch (result.command) {
                    case 'related':
                        richBody = this.renderRelated(map);
                        break;
                    case 'narrative':
                        richBody = this.renderNarrative(map);
                        break;
                    case 'blast':
                        richBody = this.renderBlast(map);
                        break;
                    case 'drift':
                        richBody = this.renderDrift(map);
                        break;
                    case 'who':
                        richBody = this.renderWho(map);
                        break;
                    case 'shape':
                        richBody = this.renderShape(map);
                        break;
                    case 'hotspots':
                        richBody = this.renderHotspots(map);
                        break;
                    case 'context':
                        richBody = this.renderContext(map);
                        break;
                    case 'todos':
                        richBody = this.renderTodos(map);
                        break;
                }
            }
        } catch {
            // Fall through to raw EDN
        }

        // Extract summary/insight/risk from raw text as fallback
        const summary = this.extractValue(result.output, ':summary');
        const risk = this.extractKeyword(result.output, ':risk');
        const insight = this.extractValue(result.output, ':insight');

        let headerExtra = '';
        if (risk) {
            const riskClass = risk === 'low' ? 'risk-low' : risk === 'medium' ? 'risk-medium' : 'risk-high';
            headerExtra += ` <span class="badge ${riskClass}">${risk.toUpperCase()}</span>`;
        }

        let summaryHtml = '';
        if (summary) {
            summaryHtml = `<div class="summary">${this.escapeHtml(summary)}</div>`;
        }
        if (insight) {
            summaryHtml += `<div class="insight">${this.escapeHtml(insight)}</div>`;
        }

        const body = richBody
            ? `${richBody}
               <details class="raw-toggle"><summary>Raw EDN</summary>
               <pre class="edn">${this.highlightEdn(result.output)}</pre>
               </details>`
            : `<pre class="edn">${this.highlightEdn(result.output)}</pre>`;

        return this.wrapHtml(`
            <div class="header">
                <span class="command">${this.escapeHtml(desc)}</span>
                <span class="args">${this.escapeHtml(argsDisplay)}</span>
                <span class="timing">${result.elapsedMs}ms</span>
                ${headerExtra}
            </div>
            ${summaryHtml}
            ${body}
        `);
    }

    // ---- related: horizontal bar chart of co-change % ----

    private renderRelated(data: EdnMap): string {
        const related = ednVec(data, 'related');
        const totalCommits = ednNum(data, 'commits');
        if (!related || related.length === 0) { return ''; }

        const bars = related.map(item => {
            const m = item as EdnMap;
            const file = ednStr(m, 'file') || '?';
            const pct = ednNum(m, 'pct') || 0;
            const commits = ednNum(m, 'commits') || 0;
            const shortFile = this.shortenFilePath(file);
            const barColor = pct >= 50 ? 'var(--vscode-editorWarning-foreground)'
                : pct >= 30 ? 'var(--vscode-textLink-foreground)'
                : 'var(--vscode-descriptionForeground)';

            return `
                <div class="bar-row">
                    <div class="bar-label">
                        <a class="file-link" data-path="${this.escapeHtml(file)}">${this.escapeHtml(shortFile)}</a>
                    </div>
                    <div class="bar-track">
                        <div class="bar-fill" style="width: ${pct}%; background: ${barColor}"></div>
                    </div>
                    <div class="bar-value">${pct}%<span class="bar-detail"> (${commits}/${totalCommits})</span></div>
                </div>`;
        }).join('');

        return `<div class="chart-section">
            <div class="chart-title">Co-change frequency (${totalCommits} commits analyzed)</div>
            ${bars}
        </div>`;
    }

    // ---- narrative: timeline of eras ----

    private renderNarrative(data: EdnMap): string {
        const eras = ednVec(data, 'eras');
        const totalCommits = ednNum(data, 'total-commits');
        const currentLines = ednNum(data, 'current-lines');
        const authors = ednVec(data, 'authors');
        if (!eras || eras.length === 0) { return ''; }

        // Stats bar
        let statsHtml = '<div class="stats-row">';
        if (totalCommits) { statsHtml += `<div class="stat"><span class="stat-num">${totalCommits}</span><span class="stat-label">commits</span></div>`; }
        if (currentLines) { statsHtml += `<div class="stat"><span class="stat-num">${currentLines.toLocaleString()}</span><span class="stat-label">lines</span></div>`; }
        if (authors && authors.length > 0) {
            const authorCount = authors.length;
            statsHtml += `<div class="stat"><span class="stat-num">${authorCount}</span><span class="stat-label">author${authorCount > 1 ? 's' : ''}</span></div>`;
        }
        statsHtml += '</div>';

        // Timeline
        const timelineItems = eras.map(item => {
            const m = item as EdnMap;
            const phase = ednKw(m, 'phase') || 'unknown';
            const commits = ednNum(m, 'commits') || 0;
            const delta = ednNum(m, 'total-delta') || 0;
            const span = ednVec(m, 'span');
            const messages = ednVec(m, 'messages');
            const color = PHASE_COLORS[phase] || '#888';

            const dateStr = span && span.length > 0 ? this.formatDate(String(span[0])) : '';
            const deltaStr = delta > 0 ? `+${delta}` : String(delta);
            const deltaClass = delta > 0 ? 'delta-add' : delta < 0 ? 'delta-remove' : '';

            const messageList = messages
                ? messages.slice(0, 3).map(msg => `<div class="timeline-msg">${this.escapeHtml(String(msg))}</div>`).join('')
                : '';

            return `
                <div class="timeline-item">
                    <div class="timeline-dot" style="background: ${color}"></div>
                    <div class="timeline-content">
                        <div class="timeline-header">
                            <span class="phase-badge" style="background: ${color}">${phase}</span>
                            <span class="timeline-commits">${commits} commit${commits > 1 ? 's' : ''}</span>
                            <span class="timeline-delta ${deltaClass}">${deltaStr} lines</span>
                            <span class="timeline-date">${dateStr}</span>
                        </div>
                        ${messageList}
                    </div>
                </div>`;
        }).join('');

        return `
            ${statsHtml}
            <div class="timeline">
                <div class="timeline-line"></div>
                ${timelineItems}
            </div>`;
    }

    // ---- blast: structured sections ----

    private renderBlast(data: EdnMap): string {
        const definition = data['definition'];
        const callers = ednVec(data, 'callers');
        const tests = ednVec(data, 'tests');
        const importers = ednVec(data, 'importers');

        let html = '';

        // Definition
        if (definition && typeof definition === 'object' && !Array.isArray(definition)) {
            const def = definition as EdnMap;
            const file = ednStr(def, 'file') || '';
            const line = ednNum(def, 'line');
            html += `<div class="blast-section">
                <div class="blast-section-title">Definition</div>
                <a class="file-link" data-path="${this.escapeHtml(file)}" ${line ? `data-line="${line}"` : ''}>${this.escapeHtml(this.shortenFilePath(file))}${line ? ':' + line : ''}</a>
            </div>`;
        }

        // Callers
        if (callers && callers.length > 0) {
            const callerItems = callers.map(c => {
                const m = c as EdnMap;
                const file = ednStr(m, 'file') || '';
                const fn = ednStr(m, 'function') || ednStr(m, 'caller') || '';
                const line = ednNum(m, 'line');
                return `<div class="blast-item">
                    <a class="file-link" data-path="${this.escapeHtml(file)}" ${line ? `data-line="${line}"` : ''}>${this.escapeHtml(this.shortenFilePath(file))}${line ? ':' + line : ''}</a>
                    ${fn ? `<span class="blast-fn">in ${this.escapeHtml(fn)}</span>` : ''}
                </div>`;
            }).join('');
            html += `<div class="blast-section">
                <div class="blast-section-title">Callers <span class="count">${callers.length}</span></div>
                ${callerItems}
            </div>`;
        }

        // Tests
        if (tests && tests.length > 0) {
            const testItems = tests.map(t => {
                const file = typeof t === 'string' ? t : ednStr(t as EdnMap, 'file') || String(t);
                return `<div class="blast-item">
                    <a class="file-link" data-path="${this.escapeHtml(file)}">${this.escapeHtml(this.shortenFilePath(file))}</a>
                </div>`;
            }).join('');
            html += `<div class="blast-section">
                <div class="blast-section-title">Tests <span class="count">${tests.length}</span></div>
                ${testItems}
            </div>`;
        }

        // Importers
        if (importers && importers.length > 0) {
            const importItems = importers.map(i => {
                const file = typeof i === 'string' ? i : ednStr(i as EdnMap, 'file') || String(i);
                return `<div class="blast-item">
                    <a class="file-link" data-path="${this.escapeHtml(file)}">${this.escapeHtml(this.shortenFilePath(file))}</a>
                </div>`;
            }).join('');
            html += `<div class="blast-section">
                <div class="blast-section-title">Importers <span class="count">${importers.length}</span></div>
                ${importItems}
            </div>`;
        }

        return html || ''; // Fall through to raw EDN if nothing rendered
    }

    // ---- drift: architecture health dashboard ----

    private renderDrift(data: EdnMap): string {
        const filesAnalyzed = ednNum(data, 'files-analyzed') || 0;
        const filesWithDrift = ednNum(data, 'files-with-drift') || 0;
        const totalHidden = ednNum(data, 'total-hidden-coupling') || 0;
        const totalDead = ednNum(data, 'total-dead-coupling') || 0;
        const driftItems = ednVec(data, 'drift');

        if (!driftItems || driftItems.length === 0) { return ''; }

        // Health score: % of files without drift
        const healthPct = filesAnalyzed > 0 ? Math.round(100 * (filesAnalyzed - filesWithDrift) / filesAnalyzed) : 100;
        const healthColor = healthPct >= 80 ? 'var(--vscode-testing-iconPassed)'
            : healthPct >= 50 ? 'var(--vscode-editorWarning-foreground)'
            : 'var(--vscode-editorError-foreground)';

        // Stats dashboard
        let html = `<div class="drift-dashboard">
            <div class="drift-stats">
                <div class="stat">
                    <span class="stat-num" style="color: ${healthColor}">${healthPct}%</span>
                    <span class="stat-label">healthy</span>
                </div>
                <div class="stat">
                    <span class="stat-num">${filesAnalyzed}</span>
                    <span class="stat-label">files</span>
                </div>
                <div class="stat">
                    <span class="stat-num">${filesWithDrift}</span>
                    <span class="stat-label">with drift</span>
                </div>
                <div class="stat">
                    <span class="stat-num" style="color: var(--vscode-editorWarning-foreground)">${totalHidden}</span>
                    <span class="stat-label">hidden</span>
                </div>
                <div class="stat">
                    <span class="stat-num" style="color: var(--vscode-descriptionForeground)">${totalDead}</span>
                    <span class="stat-label">dead</span>
                </div>
            </div>
        </div>`;

        // Explanation
        html += `<div class="drift-explainer">
            <strong>Hidden coupling</strong> — files that change together in git but don't import each other. The module system doesn't know about this dependency.<br>
            <strong>Dead coupling</strong> — imports that never co-change. Possibly stale, or used too rarely to show in recent history.
        </div>`;

        // File-by-file drift bars
        html += '<div class="drift-files">';
        for (const item of driftItems) {
            const m = item as EdnMap;
            const file = ednStr(m, 'file') || '';
            const hidden = ednVec(m, 'hidden') || [];
            const dead = ednVec(m, 'dead') || [];
            const shortFile = this.shortenFilePath(file);

            // Stacked bar: hidden (warning) + dead (grey)
            const total = hidden.length + dead.length;
            if (total === 0) { continue; }
            const hiddenWidth = Math.max(1, Math.round((hidden.length / Math.max(total, 1)) * 100));
            const deadWidth = 100 - hiddenWidth;

            // Hidden coupling details
            const hiddenFiles = hidden.map(h => {
                const hm = h as EdnMap;
                const hFile = ednStr(hm, 'file') || '';
                const hPct = ednNum(hm, 'pct') || 0;
                return `<span class="drift-dep"><a class="file-link" data-path="${this.escapeHtml(hFile)}">${this.escapeHtml(this.shortenFilePath(hFile))}</a> <span class="drift-pct">${hPct}%</span></span>`;
            }).join('');

            // Dead coupling: just names
            const deadNames = dead.map(d => `<span class="drift-dead-name">${this.escapeHtml(String(d))}</span>`).join('');

            html += `
                <div class="drift-file">
                    <div class="drift-file-header">
                        <a class="file-link" data-path="${this.escapeHtml(file)}">${this.escapeHtml(shortFile)}</a>
                        <span class="drift-counts">
                            ${hidden.length > 0 ? `<span class="drift-hidden-count">${hidden.length} hidden</span>` : ''}
                            ${dead.length > 0 ? `<span class="drift-dead-count">${dead.length} dead</span>` : ''}
                        </span>
                    </div>
                    <div class="drift-bar">
                        ${hidden.length > 0 ? `<div class="drift-bar-hidden" style="width: ${hiddenWidth}%"></div>` : ''}
                        ${dead.length > 0 ? `<div class="drift-bar-dead" style="width: ${deadWidth}%"></div>` : ''}
                    </div>
                    ${hidden.length > 0 ? `<div class="drift-details"><span class="drift-label">Hidden:</span> ${hiddenFiles}</div>` : ''}
                    ${dead.length > 0 ? `<div class="drift-details"><span class="drift-label">Dead:</span> ${deadNames}</div>` : ''}
                </div>`;
        }
        html += '</div>';

        return html;
    }

    // ---- who: reverse dependency list ----

    private renderWho(data: EdnMap): string {
        const file = ednStr(data, 'file') || '';
        // Output shape: {:files [{:file "..." :references [{:line N :text "..."}]}], :dependents N}
        const files = ednVec(data, 'files');
        const count = ednNum(data, 'dependents') || (files ? files.length : 0);

        if (!files || files.length === 0) { return ''; }

        const items = files.map(f => {
            const fm = f as EdnMap;
            const refFile = ednStr(fm, 'file') || '';
            const refs = ednVec(fm, 'references') || [];
            const shortFile = this.shortenFilePath(refFile);

            const refLines = refs.map(r => {
                const rm = r as EdnMap;
                const line = ednNum(rm, 'line');
                const text = ednStr(rm, 'text') || '';
                return `<div class="who-ref">
                    ${line ? `<span class="who-line">:${line}</span>` : ''}
                    <span class="who-text">${this.escapeHtml(text.trim())}</span>
                </div>`;
            }).join('');

            return `<div class="who-item">
                <a class="file-link" data-path="${this.escapeHtml(refFile)}">${this.escapeHtml(shortFile)}</a>
                ${refLines}
            </div>`;
        }).join('');

        return `<div class="who-section">
            <div class="chart-title">${count} file${count !== 1 ? 's' : ''} import <code>${this.escapeHtml(this.shortenFilePath(file))}</code></div>
            ${items}
        </div>`;
    }

    // ---- shape: module structure cards ----

    private renderShape(data: EdnMap): string {
        const language = ednKw(data, 'language') || 'unknown';
        const files = ednVec(data, 'files');
        if (!files || files.length === 0) { return ''; }

        // Stats
        let totalFns = 0;
        let totalTypes = 0;
        let totalImpls = 0;
        for (const f of files) {
            const m = f as EdnMap;
            const fns = ednVec(m, 'functions');
            const types = ednVec(m, 'types');
            const impls = ednVec(m, 'impls');
            totalFns += fns ? fns.length : 0;
            totalTypes += types ? types.length : 0;
            totalImpls += impls ? impls.length : 0;
        }

        let html = `<div class="stats-row">
            <div class="stat"><span class="stat-num">${files.length}</span><span class="stat-label">files</span></div>
            <div class="stat"><span class="stat-num">${totalFns}</span><span class="stat-label">functions</span></div>
            <div class="stat"><span class="stat-num">${totalTypes}</span><span class="stat-label">types</span></div>
            ${totalImpls > 0 ? `<div class="stat"><span class="stat-num">${totalImpls}</span><span class="stat-label">impls</span></div>` : ''}
            <div class="stat"><span class="stat-num shape-lang">${language}</span><span class="stat-label">language</span></div>
        </div>`;

        // File cards
        html += '<div class="shape-files">';
        for (const f of files) {
            const m = f as EdnMap;
            const file = ednStr(m, 'file') || '';
            const fns = ednVec(m, 'functions') || [];
            const types = ednVec(m, 'types') || [];
            const impls = ednVec(m, 'impls') || [];

            const typeItems = types.map(t => {
                const tm = t as EdnMap;
                const name = ednStr(tm, 'name') || String(t);
                const kind = ednKw(tm, 'kind') || '';
                const line = ednNum(tm, 'line');
                return `<a class="shape-type file-link" data-path="${this.escapeHtml(file)}" ${line ? `data-line="${line}"` : ''}><span class="shape-kind">${this.escapeHtml(kind)}</span> ${this.escapeHtml(name)}</a>`;
            }).join('');

            const fnItems = fns.map(fn => {
                const fm = fn as EdnMap;
                const name = ednStr(fm, 'name') || String(fn);
                const line = ednNum(fm, 'line');
                return `<a class="shape-fn file-link" data-path="${this.escapeHtml(file)}" ${line ? `data-line="${line}"` : ''}>${this.escapeHtml(name)}</a>`;
            }).join('');

            const implItems = impls.map(imp => {
                const im = imp as EdnMap;
                const name = ednStr(im, 'name') || String(imp);
                const line = ednNum(im, 'line');
                return `<a class="shape-impl file-link" data-path="${this.escapeHtml(file)}" ${line ? `data-line="${line}"` : ''}>${this.escapeHtml(name)}</a>`;
            }).join('');

            html += `
                <div class="shape-file">
                    <div class="shape-file-header">
                        <a class="file-link" data-path="${this.escapeHtml(file)}">${this.escapeHtml(file)}</a>
                        <span class="shape-counts">
                            ${fns.length > 0 ? `<span class="shape-fn-count">${fns.length} fn</span>` : ''}
                            ${types.length > 0 ? `<span class="shape-type-count">${types.length} type${types.length > 1 ? 's' : ''}</span>` : ''}
                            ${impls.length > 0 ? `<span class="shape-impl-count">${impls.length} impl</span>` : ''}
                        </span>
                    </div>
                    ${typeItems ? `<div class="shape-section">${typeItems}</div>` : ''}
                    ${fnItems ? `<div class="shape-section">${fnItems}</div>` : ''}
                    ${implItems ? `<div class="shape-section"><span class="shape-section-label">impl</span> ${implItems}</div>` : ''}
                </div>`;
        }
        html += '</div>';

        return html;
    }

    // ---- hotspots: bar list + treemap tabs ----

    private renderHotspots(data: EdnMap): string {
        const hotspots = ednVec(data, 'hotspots');
        if (!hotspots || hotspots.length === 0) { return ''; }

        // Hotspot files are relative to :path — prepend it for project-root-relative paths
        const basePath = ednStr(data, 'path') || '';
        const fullPath = (file: string) => basePath && !file.startsWith(basePath) ? basePath + '/' + file : file;

        const maxLines = Math.max(...hotspots.map(h => ednNum(h as EdnMap, 'lines') || 0));
        let totalLines = 0;
        for (const h of hotspots) { totalLines += ednNum(h as EdnMap, 'lines') || 0; }

        // Bar list (existing)
        const bars = hotspots.map((item, i) => {
            const m = item as EdnMap;
            const file = fullPath(ednStr(m, 'file') || '');
            const lines = ednNum(m, 'lines') || 0;
            const pct = maxLines > 0 ? Math.round((lines / maxLines) * 100) : 0;
            const barColor = lines >= 1000 ? 'var(--vscode-editorError-foreground)'
                : lines >= 500 ? 'var(--vscode-editorWarning-foreground)'
                : 'var(--vscode-textLink-foreground)';

            return `
                <div class="bar-row">
                    <div class="bar-rank">${i + 1}</div>
                    <div class="bar-label">
                        <a class="file-link" data-path="${this.escapeHtml(file)}">${this.escapeHtml(file)}</a>
                    </div>
                    <div class="bar-track">
                        <div class="bar-fill" style="width: ${pct}%; background: ${barColor}"></div>
                    </div>
                    <div class="bar-value">${lines.toLocaleString()}<span class="bar-detail"> lines</span></div>
                </div>`;
        }).join('');

        // Treemap data as JSON for inline script
        const treemapData = hotspots.map(item => {
            const m = item as EdnMap;
            return {
                file: fullPath(ednStr(m, 'file') || ''),
                lines: ednNum(m, 'lines') || 0,
            };
        });

        return `
            <div class="chart-title">Top ${hotspots.length} files by size (${totalLines.toLocaleString()} lines total)</div>
            <div class="tab-bar">
                <button class="tab active" data-tab="treemap">Chart</button>
                <button class="tab" data-tab="list">List</button>
            </div>
            <div class="tab-content active" id="tab-treemap">
                <div class="treemap" id="treemap-container"></div>
            </div>
            <div class="tab-content" id="tab-list">
                <div class="chart-section">${bars}</div>
            </div>
            <script>
            (function() {
                // Tab switching
                document.querySelectorAll('.tab').forEach(btn => {
                    btn.addEventListener('click', () => {
                        document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
                        document.querySelectorAll('.tab-content').forEach(t => t.classList.remove('active'));
                        btn.classList.add('active');
                        document.getElementById('tab-' + btn.dataset.tab).classList.add('active');
                    });
                });

                // Squarified treemap layout
                const data = ${JSON.stringify(treemapData)};
                const container = document.getElementById('treemap-container');
                const W = container.clientWidth;
                const H = Math.max(300, Math.min(500, W * 0.6));
                container.style.height = H + 'px';

                const total = data.reduce((s, d) => s + d.lines, 0);
                const items = data.map(d => ({ ...d, area: (d.lines / total) * W * H })).sort((a, b) => b.area - a.area);

                function layoutRow(items, rect) {
                    const sum = items.reduce((s, d) => s + d.area, 0);
                    const isHoriz = rect.w >= rect.h;
                    const side = isHoriz ? rect.h : rect.w;
                    const rowLen = sum / side;
                    let pos = 0;
                    items.forEach(item => {
                        const len = item.area / rowLen;
                        if (isHoriz) {
                            item.x = rect.x; item.y = rect.y + pos;
                            item.w = rowLen; item.h = len;
                        } else {
                            item.x = rect.x + pos; item.y = rect.y;
                            item.w = len; item.h = rowLen;
                        }
                        pos += len;
                    });
                    if (isHoriz) {
                        return { x: rect.x + rowLen, y: rect.y, w: rect.w - rowLen, h: rect.h };
                    }
                    return { x: rect.x, y: rect.y + rowLen, w: rect.w, h: rect.h - rowLen };
                }

                function worstRatio(row, side) {
                    const sum = row.reduce((s, d) => s + d.area, 0);
                    const rowLen = sum / side;
                    let worst = 0;
                    for (const d of row) {
                        const len = d.area / rowLen;
                        const r = Math.max(rowLen / len, len / rowLen);
                        if (r > worst) worst = r;
                    }
                    return worst;
                }

                function squarify(items, rect) {
                    if (items.length === 0) return;
                    if (items.length === 1) { layoutRow(items, rect); return; }
                    const side = Math.min(rect.w, rect.h);
                    let row = [items[0]];
                    let best = worstRatio(row, side);
                    let i = 1;
                    while (i < items.length) {
                        const test = [...row, items[i]];
                        const w = worstRatio(test, side);
                        if (w <= best) { row = test; best = w; i++; }
                        else break;
                    }
                    const remaining = layoutRow(row, rect);
                    squarify(items.slice(i), remaining);
                }

                squarify(items, { x: 0, y: 0, w: W, h: H });

                // Color by severity
                function color(lines) {
                    if (lines >= 1000) return 'rgba(244, 71, 71, 0.65)';
                    if (lines >= 500) return 'rgba(204, 160, 50, 0.55)';
                    return 'rgba(86, 156, 214, 0.4)';
                }

                // Tooltip element
                const tip = document.createElement('div');
                tip.className = 'treemap-tooltip';
                container.appendChild(tip);

                // Render
                items.forEach(item => {
                    const el = document.createElement('div');
                    el.className = 'treemap-cell';
                    el.style.cssText = 'position:absolute;' +
                        'left:' + item.x + 'px;top:' + item.y + 'px;' +
                        'width:' + (item.w - 2) + 'px;height:' + (item.h - 2) + 'px;' +
                        'background:' + color(item.lines) + ';';

                    const name = item.file.split('/').pop().replace(/\\.[^.]+$/, '');
                    const showLines = item.w > 50 && item.h > 28;
                    el.innerHTML = '<span class="treemap-name">' + name + '</span>' +
                        (showLines ? '<span class="treemap-lines">' + item.lines.toLocaleString() + '</span>' : '');

                    // Click to open file
                    el.addEventListener('click', () => {
                        window.__vscode.postMessage({ type: 'openFile', path: item.file });
                    });

                    // Tooltip on hover
                    el.addEventListener('mouseenter', (e) => {
                        tip.textContent = item.file + ' \\u2014 ' + item.lines.toLocaleString() + ' lines';
                        tip.style.display = 'block';
                    });
                    el.addEventListener('mousemove', (e) => {
                        tip.style.left = (e.offsetX + 12) + 'px';
                        tip.style.top = (e.offsetY + 12) + 'px';
                    });
                    el.addEventListener('mouseleave', () => { tip.style.display = 'none'; });

                    container.appendChild(el);
                });
            })();
            </script>`;
    }

    // ---- context: symbol usages grouped by enclosing function ----

    private renderContext(data: EdnMap): string {
        const symbol = ednStr(data, 'symbol') || '';
        const count = ednNum(data, 'count') || 0;
        const matches = ednVec(data, 'matches');
        const summary = ednVec(data, 'summary');

        if (!matches || matches.length === 0) { return ''; }

        // Summary: function -> count as bar chart
        let summaryHtml = '';
        if (summary && summary.length > 0) {
            const maxCount = Math.max(...summary.map(s => {
                return Array.isArray(s) ? (Number(s[1]) || 0) : 0;
            }));

            const summaryBars = summary.map(s => {
                if (!Array.isArray(s) || s.length < 2) { return ''; }
                const fn = String(s[0]);
                const n = Number(s[1]) || 0;
                const pct = maxCount > 0 ? Math.round((n / maxCount) * 100) : 0;
                return `
                    <div class="bar-row">
                        <div class="bar-label"><code>${this.escapeHtml(fn)}</code></div>
                        <div class="bar-track">
                            <div class="bar-fill" style="width: ${pct}%; background: var(--vscode-textLink-foreground)"></div>
                        </div>
                        <div class="bar-value">${n}</div>
                    </div>`;
            }).join('');

            summaryHtml = `<div class="chart-section">
                <div class="chart-title">Callers of <code>${this.escapeHtml(symbol)}</code></div>
                ${summaryBars}
            </div>`;
        }

        // Full match list
        const matchItems = matches.map(m => {
            const mm = m as EdnMap;
            const file = ednStr(mm, 'file') || '';
            const line = ednNum(mm, 'line');
            const text = ednStr(mm, 'text') || '';
            const inFn = ednStr(mm, 'in');

            return `<div class="ctx-match">
                <div class="ctx-location">
                    <a class="file-link" data-path="${this.escapeHtml(file)}" ${line ? `data-line="${line}"` : ''}>${this.escapeHtml(this.shortenFilePath(file))}${line ? ':' + line : ''}</a>
                    ${inFn ? `<span class="ctx-fn">in <strong>${this.escapeHtml(inFn)}</strong></span>` : ''}
                </div>
                ${text ? `<div class="ctx-text">${this.escapeHtml(text.trim())}</div>` : ''}
            </div>`;
        }).join('');

        return `
            ${summaryHtml}
            <div class="ctx-section">
                <div class="chart-title">${count} usage${count !== 1 ? 's' : ''}</div>
                ${matchItems}
            </div>`;
    }

    // ---- todos: categorized TODO/FIXME/HACK list ----

    private renderTodos(data: EdnMap): string {
        const total = ednNum(data, 'total') || 0;
        const byCategory = data['by-category'] as EdnMap | undefined;
        const items = ednVec(data, 'items');

        if (!items || items.length === 0) {
            return `<div class="chart-title">No TODOs found</div>`;
        }

        // Category badges
        const CATEGORY_COLORS: Record<string, string> = {
            todo: 'var(--vscode-textLink-foreground)',
            fixme: 'var(--vscode-editorError-foreground)',
            hack: 'var(--vscode-editorWarning-foreground)',
            xxx: 'var(--vscode-editorWarning-foreground)',
        };

        let statsHtml = `<div class="stats-row">
            <div class="stat"><span class="stat-num">${total}</span><span class="stat-label">total</span></div>`;
        if (byCategory) {
            for (const [cat, count] of Object.entries(byCategory)) {
                const color = CATEGORY_COLORS[cat] || 'var(--vscode-descriptionForeground)';
                const n = typeof count === 'number' ? count : 0;
                statsHtml += `<div class="stat"><span class="stat-num" style="color: ${color}">${n}</span><span class="stat-label">${cat.toUpperCase()}</span></div>`;
            }
        }
        statsHtml += '</div>';

        // Group items by file
        const byFile = new Map<string, typeof items>();
        for (const item of items) {
            const m = item as EdnMap;
            const file = ednStr(m, 'file') || '';
            if (!byFile.has(file)) { byFile.set(file, []); }
            byFile.get(file)!.push(item);
        }

        let listHtml = '<div class="todo-files">';
        for (const [file, fileItems] of byFile) {
            const shortFile = this.shortenFilePath(file);
            const itemsHtml = fileItems.map(item => {
                const m = item as EdnMap;
                const line = ednNum(m, 'line');
                const text = ednStr(m, 'text') || '';
                const cat = ednKw(m, 'category') || 'todo';
                const color = CATEGORY_COLORS[cat] || 'var(--vscode-descriptionForeground)';

                return `<div class="todo-item">
                    <span class="todo-badge" style="background: ${color}">${cat.toUpperCase()}</span>
                    <a class="file-link" data-path="${this.escapeHtml(file)}" ${line ? `data-line="${line}"` : ''}>${line || ''}</a>
                    <span class="todo-text">${this.escapeHtml(text.replace(/^\/\/\s*(?:TODO|FIXME|HACK|XXX):?\s*/i, ''))}</span>
                </div>`;
            }).join('');

            listHtml += `<div class="todo-file">
                <div class="todo-file-header">
                    <a class="file-link" data-path="${this.escapeHtml(file)}">${this.escapeHtml(shortFile)}</a>
                    <span class="todo-file-count">${fileItems.length}</span>
                </div>
                ${itemsHtml}
            </div>`;
        }
        listHtml += '</div>';

        return `${statsHtml}${listHtml}`;
    }

    // ---- Utilities ----

    private buildLoadingHtml(command: string, args: string[]): string {
        const desc = COMMAND_DESCRIPTIONS[command] || command;
        const argsDisplay = args.map(a => this.shortenPath(a)).join(' ');
        return this.wrapHtml(`
            <div class="header">
                <span class="command">${this.escapeHtml(desc)}</span>
                <span class="args">${this.escapeHtml(argsDisplay)}</span>
            </div>
            <div class="loading">
                <div class="spinner"></div>
                <span>Running spai ${this.escapeHtml(command)}...</span>
            </div>
        `);
    }

    private buildErrorHtml(result: SpaiResult): string {
        const desc = COMMAND_DESCRIPTIONS[result.command] || result.command;
        return this.wrapHtml(`
            <div class="header">
                <span class="command">${this.escapeHtml(desc)}</span>
                <span class="timing">${result.elapsedMs}ms</span>
                <span class="badge risk-high">ERROR</span>
            </div>
            <pre class="error">${this.escapeHtml(result.error || 'Unknown error')}</pre>
        `);
    }

    private highlightEdn(edn: string): string {
        let html = this.escapeHtml(edn);

        html = html.replace(
            /&quot;((?:\.?\/)?(?:[\w.-]+\/)*[\w.-]+\.(?:rs|ts|tsx|js|jsx|edn|toml|json|md|yml|yaml|sql|sparql|py|sh|go|rb|java|kt|swift|c|cpp|h|hpp|css|scss|html|vue|svelte))&quot;/g,
            (_match, filePath) => {
                return `&quot;<a class="file-link" data-path="${filePath}">${filePath}</a>&quot;`;
            },
        );

        html = html.replace(
            /(?<=\s|^)((?:\.\/|\/)[^\s,\])"]+\.(?:rs|ts|tsx|js|edn|toml|md|go|py|rb|java))/gm,
            (filePath) => {
                return `<a class="file-link" data-path="${filePath}">${filePath}</a>`;
            },
        );

        html = html.replace(
            /(:[a-zA-Z][\w.*+!?-]*(?:\/[\w.*+!?-]+)?)/g,
            '<span class="kw">$1</span>',
        );

        html = html.replace(
            /(?<=[\s\[({,])(\d+(?:\.\d+)?)/g,
            '<span class="num">$1</span>',
        );

        html = html.replace(
            /(&quot;(?:[^&]|&(?!quot;))*?&quot;)/g,
            (match) => {
                if (match.includes('file-link')) { return match; }
                return `<span class="str">${match}</span>`;
            },
        );

        return html;
    }

    private extractValue(edn: string, key: string): string | null {
        const regex = new RegExp(key + '\\s+"([^"]*(?:\\\\"[^"]*)*)"');
        const match = edn.match(regex);
        return match ? match[1].replace(/\\"/g, '"') : null;
    }

    private extractKeyword(edn: string, key: string): string | null {
        const regex = new RegExp(key + '\\s+:(\\w+)');
        const match = edn.match(regex);
        return match ? match[1] : null;
    }

    private formatDate(isoDate: string): string {
        try {
            const d = new Date(isoDate);
            return d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
        } catch {
            return isoDate.slice(0, 10);
        }
    }

    /** Try to resolve a file path from spai output to an absolute path that exists on disk */
    private resolveFilePath(filePath: string): string | null {
        // Strategy 1: already absolute and exists
        if (path.isAbsolute(filePath) && fs.existsSync(filePath)) {
            return filePath;
        }

        // Strategy 2: relative to the cwd spai ran in
        if (this.lastCwd) {
            const fromCwd = path.resolve(this.lastCwd, filePath);
            if (fs.existsSync(fromCwd)) { return fromCwd; }
        }

        // Strategy 3: relative to workspace root
        if (this.workspaceRoot) {
            const fromRoot = path.resolve(this.workspaceRoot, filePath);
            if (fs.existsSync(fromRoot)) { return fromRoot; }
        }

        // Strategy 4: strip leading / and treat as relative (spai sometimes outputs /src/foo.rs)
        if (filePath.startsWith('/')) {
            const stripped = filePath.slice(1);
            if (this.lastCwd) {
                const fromCwd = path.resolve(this.lastCwd, stripped);
                if (fs.existsSync(fromCwd)) { return fromCwd; }
            }
            if (this.workspaceRoot) {
                const fromRoot = path.resolve(this.workspaceRoot, stripped);
                if (fs.existsSync(fromRoot)) { return fromRoot; }
            }
        }

        // Strategy 5: search up — the path might be relative to a parent of cwd
        // e.g., cwd is spoqe-memory/spoqe-core, path is spoqe-core/src/foo.rs
        const searchRoots = [this.lastCwd, this.workspaceRoot].filter(Boolean);
        for (const root of searchRoots) {
            let dir = root;
            const stopAt = path.parse(dir).root;
            while (dir !== stopAt) {
                const candidate = path.resolve(dir, filePath.replace(/^\//, ''));
                if (fs.existsSync(candidate)) { return candidate; }
                dir = path.dirname(dir);
            }
        }

        return null;
    }

    private shortenFilePath(file: string): string {
        if (this.workspaceRoot && file.startsWith(this.workspaceRoot)) {
            return file.slice(this.workspaceRoot.length + 1);
        }
        return file;
    }

    private shortenPath(p: string): string {
        if (this.workspaceRoot && p.startsWith(this.workspaceRoot)) {
            return p.slice(this.workspaceRoot.length + 1);
        }
        const parts = p.split('/');
        if (parts.length > 3) {
            return '.../' + parts.slice(-2).join('/');
        }
        return p;
    }

    private escapeHtml(text: string): string {
        return text
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;');
    }

    private wrapHtml(body: string): string {
        return `<!DOCTYPE html>
<html>
<head>
<meta charset="UTF-8">
<style>
    body {
        font-family: var(--vscode-editor-font-family, monospace);
        font-size: var(--vscode-editor-font-size, 13px);
        line-height: var(--vscode-editor-line-height, 1.5);
        padding: 12px 16px;
        color: var(--vscode-foreground);
        background: var(--vscode-editor-background);
        margin: 0;
    }
    .header {
        display: flex;
        align-items: center;
        gap: 10px;
        padding-bottom: 8px;
        margin-bottom: 12px;
        border-bottom: 1px solid var(--vscode-panel-border);
        flex-wrap: wrap;
    }
    .command { font-size: 1.15em; font-weight: 600; }
    .args { color: var(--vscode-descriptionForeground); font-size: 0.9em; }
    .timing { color: var(--vscode-descriptionForeground); font-size: 0.85em; margin-left: auto; }
    .badge {
        font-size: 0.75em; font-weight: 700; padding: 2px 8px;
        border-radius: 3px; text-transform: uppercase; letter-spacing: 0.5px;
    }
    .risk-low { background: var(--vscode-testing-iconPassed); color: var(--vscode-editor-background); }
    .risk-medium { background: var(--vscode-editorWarning-foreground); color: var(--vscode-editor-background); }
    .risk-high { background: var(--vscode-editorError-foreground); color: var(--vscode-editor-background); }

    .summary, .insight {
        padding: 6px 10px; margin-bottom: 10px;
        border-left: 3px solid var(--vscode-textLink-foreground);
        font-style: italic;
        background: var(--vscode-textBlockQuote-background, transparent);
    }
    .insight { border-left-color: var(--vscode-editorWarning-foreground); }

    /* Bar chart (related) */
    .chart-section { margin-bottom: 16px; }
    .chart-title { font-weight: 600; margin-bottom: 8px; color: var(--vscode-descriptionForeground); }
    .bar-row { display: flex; align-items: center; gap: 8px; margin-bottom: 4px; }
    .bar-label { width: 220px; min-width: 220px; text-align: right; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-size: 0.9em; }
    .bar-track { flex: 1; height: 16px; background: var(--vscode-editor-inactiveSelectionBackground, #333); border-radius: 2px; overflow: hidden; }
    .bar-fill { height: 100%; border-radius: 2px; transition: width 0.3s ease; }
    .bar-value { width: 90px; min-width: 90px; font-size: 0.85em; color: var(--vscode-descriptionForeground); }
    .bar-detail { font-size: 0.85em; opacity: 0.7; }

    /* Timeline (narrative) */
    .stats-row { display: flex; gap: 24px; margin-bottom: 16px; }
    .stat { display: flex; flex-direction: column; align-items: center; }
    .stat-num { font-size: 1.4em; font-weight: 700; color: var(--vscode-textLink-foreground); }
    .stat-label { font-size: 0.8em; color: var(--vscode-descriptionForeground); }
    .timeline { position: relative; padding-left: 24px; }
    .timeline-line { position: absolute; left: 7px; top: 0; bottom: 0; width: 2px; background: var(--vscode-panel-border); }
    .timeline-item { position: relative; margin-bottom: 12px; }
    .timeline-dot { position: absolute; left: -20px; top: 4px; width: 10px; height: 10px; border-radius: 50%; }
    .timeline-content { padding-left: 4px; }
    .timeline-header { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
    .phase-badge {
        font-size: 0.75em; font-weight: 700; padding: 1px 6px; border-radius: 3px;
        color: var(--vscode-editor-background); text-transform: uppercase;
    }
    .timeline-commits { font-size: 0.85em; color: var(--vscode-descriptionForeground); }
    .timeline-delta { font-size: 0.85em; }
    .delta-add { color: var(--vscode-testing-iconPassed, #4ec9b0); }
    .delta-remove { color: var(--vscode-editorError-foreground, #f44747); }
    .timeline-date { font-size: 0.8em; color: var(--vscode-descriptionForeground); margin-left: auto; }
    .timeline-msg { font-size: 0.85em; color: var(--vscode-descriptionForeground); margin-top: 2px; padding-left: 2px; }

    /* Blast sections */
    .blast-section { margin-bottom: 14px; }
    .blast-section-title { font-weight: 600; margin-bottom: 4px; border-bottom: 1px solid var(--vscode-panel-border); padding-bottom: 2px; }
    .blast-section-title .count { font-weight: 400; color: var(--vscode-descriptionForeground); font-size: 0.85em; }
    .blast-item { margin: 2px 0; padding-left: 8px; }
    .blast-fn { color: var(--vscode-descriptionForeground); font-size: 0.9em; }

    /* Drift dashboard */
    .drift-explainer {
        font-size: 0.85em; color: var(--vscode-descriptionForeground);
        margin-bottom: 14px; padding: 8px 10px;
        border: 1px solid var(--vscode-panel-border); border-radius: 4px;
        background: var(--vscode-textBlockQuote-background, transparent);
        line-height: 1.6;
    }
    .drift-dashboard { margin-bottom: 16px; }
    .drift-stats { display: flex; gap: 24px; margin-bottom: 16px; }
    .drift-files { display: flex; flex-direction: column; gap: 12px; }
    .drift-file { border: 1px solid var(--vscode-panel-border); border-radius: 4px; padding: 8px 10px; }
    .drift-file-header { display: flex; align-items: center; justify-content: space-between; margin-bottom: 4px; }
    .drift-counts { display: flex; gap: 8px; font-size: 0.8em; }
    .drift-hidden-count { color: var(--vscode-editorWarning-foreground); font-weight: 600; }
    .drift-dead-count { color: var(--vscode-descriptionForeground); }
    .drift-bar { display: flex; height: 6px; border-radius: 3px; overflow: hidden; margin-bottom: 6px; }
    .drift-bar-hidden { background: var(--vscode-editorWarning-foreground); }
    .drift-bar-dead { background: var(--vscode-editor-inactiveSelectionBackground, #444); }
    .drift-details { font-size: 0.85em; margin-top: 2px; display: flex; flex-wrap: wrap; gap: 4px; align-items: baseline; }
    .drift-label { font-weight: 600; color: var(--vscode-descriptionForeground); margin-right: 4px; }
    .drift-dep { white-space: nowrap; }
    .drift-pct { color: var(--vscode-descriptionForeground); font-size: 0.85em; }
    .drift-dead-name { color: var(--vscode-descriptionForeground); font-size: 0.9em; }
    .drift-dead-name::after { content: ','; margin-right: 3px; }
    .drift-dead-name:last-child::after { content: ''; }

    /* Who imports */
    .who-section { margin-bottom: 16px; }
    .who-item { margin: 8px 0; padding-left: 8px; border-left: 2px solid var(--vscode-panel-border); }
    .who-ref { font-size: 0.85em; margin-top: 2px; display: flex; gap: 6px; }
    .who-line { color: var(--vscode-descriptionForeground); min-width: 35px; }
    .who-text { color: var(--vscode-descriptionForeground); font-family: var(--vscode-editor-font-family); }

    /* Shape module cards */
    .shape-files { display: flex; flex-direction: column; gap: 10px; }
    .shape-file { border: 1px solid var(--vscode-panel-border); border-radius: 4px; padding: 8px 10px; }
    .shape-file-header { display: flex; align-items: center; justify-content: space-between; margin-bottom: 6px; font-weight: 600; }
    .shape-counts { display: flex; gap: 8px; font-size: 0.8em; font-weight: 400; }
    .shape-fn-count { color: var(--vscode-textLink-foreground); }
    .shape-type-count { color: var(--vscode-symbolIcon-classForeground, #ee9d28); }
    .shape-impl-count { color: var(--vscode-symbolIcon-interfaceForeground, #75beff); }
    .shape-section { display: flex; flex-wrap: wrap; gap: 4px 8px; margin-bottom: 4px; }
    .shape-section-label { font-size: 0.8em; font-weight: 600; color: var(--vscode-descriptionForeground); margin-right: 2px; }
    .shape-fn.file-link { font-size: 0.85em; color: var(--vscode-textLink-foreground); text-decoration: none; }
    .shape-fn.file-link:hover { text-decoration: underline; }
    .shape-fn::before { content: 'fn '; font-size: 0.8em; color: var(--vscode-descriptionForeground); }
    .shape-type.file-link { font-size: 0.85em; color: var(--vscode-symbolIcon-classForeground, #ee9d28); text-decoration: none; }
    .shape-type.file-link:hover { text-decoration: underline; }
    .shape-kind { font-size: 0.75em; color: var(--vscode-descriptionForeground); font-weight: 400; }
    .shape-impl.file-link { font-size: 0.85em; color: var(--vscode-symbolIcon-interfaceForeground, #75beff); text-decoration: none; }
    .shape-impl.file-link:hover { text-decoration: underline; }
    .shape-lang { font-size: 0.9em; text-transform: capitalize; }

    /* Tabs */
    .tab-bar { display: flex; gap: 0; margin-bottom: 12px; border-bottom: 1px solid var(--vscode-panel-border); }
    .tab {
        background: none; border: none; color: var(--vscode-descriptionForeground);
        padding: 6px 14px; cursor: pointer; font-size: 0.85em; font-family: inherit;
        border-bottom: 2px solid transparent; margin-bottom: -1px;
    }
    .tab:hover { color: var(--vscode-foreground); }
    .tab.active { color: var(--vscode-textLink-foreground); border-bottom-color: var(--vscode-textLink-foreground); }
    .tab-content { display: none; }
    .tab-content.active { display: block; }

    /* Hotspots */
    .bar-rank { width: 20px; min-width: 20px; text-align: right; color: var(--vscode-descriptionForeground); font-size: 0.85em; }

    /* Treemap */
    .treemap { position: relative; border-radius: 4px; overflow: hidden; }
    .treemap-cell {
        position: absolute; border-radius: 2px; margin: 1px; overflow: hidden;
        display: flex; flex-direction: column; justify-content: center; align-items: center;
        cursor: pointer; transition: filter 0.15s;
        border: 1px solid var(--vscode-panel-border);
    }
    .treemap-cell:hover { filter: brightness(1.3); }
    .treemap-name {
        font-size: 0.8em; font-weight: 600; color: var(--vscode-foreground);
        overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
        max-width: 90%; text-align: center; padding: 0 4px;
    }
    .treemap-lines { font-size: 0.7em; color: var(--vscode-descriptionForeground); }
    .treemap-tooltip {
        display: none; position: absolute; z-index: 10; pointer-events: none;
        background: var(--vscode-editorHoverWidget-background, #252526);
        border: 1px solid var(--vscode-editorHoverWidget-border, #454545);
        color: var(--vscode-foreground); padding: 4px 8px; border-radius: 3px;
        font-size: 0.8em; white-space: nowrap;
    }

    /* Context */
    .ctx-section { margin-top: 12px; }
    .ctx-match { margin: 6px 0; padding-left: 8px; border-left: 2px solid var(--vscode-panel-border); }
    .ctx-location { display: flex; align-items: baseline; gap: 8px; }
    .ctx-fn { font-size: 0.85em; color: var(--vscode-descriptionForeground); }
    .ctx-text { font-size: 0.85em; color: var(--vscode-descriptionForeground); font-family: var(--vscode-editor-font-family); margin-top: 2px; }

    /* TODOs */
    .todo-files { display: flex; flex-direction: column; gap: 10px; }
    .todo-file { border: 1px solid var(--vscode-panel-border); border-radius: 4px; padding: 8px 10px; }
    .todo-file-header { display: flex; align-items: center; justify-content: space-between; margin-bottom: 6px; font-weight: 600; }
    .todo-file-count { font-size: 0.8em; font-weight: 400; color: var(--vscode-descriptionForeground); }
    .todo-item { display: flex; align-items: baseline; gap: 6px; margin: 3px 0; }
    .todo-badge { font-size: 0.65em; font-weight: 700; padding: 1px 5px; border-radius: 2px; color: var(--vscode-editor-background); white-space: nowrap; }
    .todo-text { font-size: 0.85em; color: var(--vscode-foreground); }

    /* Raw EDN toggle */
    details.raw-toggle { margin-top: 16px; border-top: 1px solid var(--vscode-panel-border); padding-top: 8px; }
    details.raw-toggle summary { cursor: pointer; color: var(--vscode-descriptionForeground); font-size: 0.85em; }

    pre.edn { white-space: pre-wrap; word-wrap: break-word; margin: 0; padding: 0; }
    pre.error { color: var(--vscode-editorError-foreground); white-space: pre-wrap; }
    .kw { color: var(--vscode-symbolIcon-keywordForeground, #569cd6); }
    .str { color: var(--vscode-debugTokenExpression-string, #ce9178); }
    .num { color: var(--vscode-debugTokenExpression-number, #b5cea8); }
    .file-link { color: var(--vscode-textLink-foreground); text-decoration: underline; cursor: pointer; }
    .file-link:hover { color: var(--vscode-textLink-activeForeground); }
    .loading { display: flex; align-items: center; gap: 10px; padding: 20px 0; color: var(--vscode-descriptionForeground); }
    .spinner {
        width: 16px; height: 16px;
        border: 2px solid var(--vscode-descriptionForeground);
        border-top-color: var(--vscode-textLink-foreground);
        border-radius: 50%; animation: spin 0.8s linear infinite;
    }
    @keyframes spin { to { transform: rotate(360deg); } }
</style>
</head>
<body>
    <script>window.__vscode = acquireVsCodeApi();</script>
    ${body}
    <script>
        const vscode = window.__vscode;
        document.addEventListener('click', (e) => {
            const link = e.target.closest('.file-link');
            if (link) {
                e.preventDefault();
                vscode.postMessage({
                    type: 'openFile',
                    path: link.dataset.path,
                    line: link.dataset.line ? parseInt(link.dataset.line, 10) : undefined,
                });
            }
        });
    </script>
</body>
</html>`;
    }

    dispose(): void {
        this.panel?.dispose();
        this.panel = null;
    }
}
