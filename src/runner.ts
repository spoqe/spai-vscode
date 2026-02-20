import * as cp from 'child_process';

export interface SpaiResult {
    success: boolean;
    command: string;
    args: string[];
    output: string;
    error?: string;
    elapsedMs: number;
    cwd: string;
}

export class SpaiRunner {
    private pending: cp.ChildProcess | null = null;

    run(
        command: string,
        args: string[],
        binaryPath: string,
        timeout: number,
        cwd: string,
    ): Promise<SpaiResult> {
        if (this.pending) {
            this.pending.kill();
            this.pending = null;
        }

        const startTime = Date.now();

        return new Promise((resolve) => {
            const proc = cp.spawn(binaryPath || 'spai', [command, ...args], {
                timeout,
                cwd,
                env: { ...process.env },
            });
            this.pending = proc;

            let stdout = '';
            let stderr = '';

            proc.stdout?.on('data', (d: Buffer) => { stdout += d.toString(); });
            proc.stderr?.on('data', (d: Buffer) => { stderr += d.toString(); });

            proc.on('error', (err: Error) => {
                this.pending = null;
                resolve({
                    success: false,
                    command,
                    args,
                    output: '',
                    error: `Failed to run spai: ${err.message}. Is spai installed? (typically ~/.local/bin/spai)`,
                    elapsedMs: Date.now() - startTime,
                    cwd,
                });
            });

            proc.on('close', (code: number | null, signal: string | null) => {
                this.pending = null;
                const elapsed = Date.now() - startTime;
                if (signal || code === null) {
                    resolve({
                        success: false,
                        command,
                        args,
                        output: stdout,
                        error: `Timed out after ${Math.round(elapsed / 1000)}s. Try a smaller scope, or increase spai.timeout in settings.`,
                        elapsedMs: elapsed,
                        cwd,
                    });
                    return;
                }
                resolve({
                    success: code === 0,
                    command,
                    args,
                    output: stdout,
                    error: code !== 0 ? (stderr || `Exit code ${code}`) : undefined,
                    elapsedMs: Date.now() - startTime,
                    cwd,
                });
            });
        });
    }

    dispose(): void {
        if (this.pending) {
            this.pending.kill();
            this.pending = null;
        }
    }
}
