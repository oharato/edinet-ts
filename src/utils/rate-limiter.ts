/**
 * EDINET API 用のレートリミッター
 * 
 * API制限を遵守するためのシンプルなキューベースのスロットリング機構を実装します。
 * デフォルトの動作は「1秒間に1リクエスト」です（並列数1）。
 */
export class RateLimiter {
    private queue: (() => Promise<void>)[] = [];
    private activeCount = 0;
    private lastRequestTime = 0;

    constructor(
        private readonly concurrency: number = 1,
        private readonly minIntervalMs: number = 1000 // デフォルト1秒
    ) { }

    /**
     * レート制限に従ってタスクを実行するようにスケジュールします。
     * @param task Promiseを返す関数（API呼び出しなど）
     */
    public async schedule<T>(task: () => Promise<T>): Promise<T> {
        return new Promise<T>((resolve, reject) => {
            const wrappedTask = async () => {
                try {
                    // 必要に応じて実行前の待機を行う

                    const now = Date.now();
                    const nextAllowedTime = this.lastRequestTime + this.minIntervalMs;
                    const waitTime = Math.max(0, nextAllowedTime - now);

                    if (waitTime > 0) {
                        await new Promise(r => setTimeout(r, waitTime));
                    }

                    this.lastRequestTime = Date.now();

                    const result = await task();
                    resolve(result);
                } catch (e) {
                    reject(e);
                } finally {
                    this.activeCount--;
                    this.next();
                }
            };

            this.queue.push(wrappedTask);
            this.next();
        });
    }

    private next() {
        if (this.activeCount < this.concurrency && this.queue.length > 0) {
            this.activeCount++;
            const task = this.queue.shift();
            if (task) {
                task(); // execute without awaiting here
            }
        }
    }
}
