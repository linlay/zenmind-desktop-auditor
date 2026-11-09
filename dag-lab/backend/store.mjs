import { mkdir, readFile, writeFile, rename } from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { template, problem, requireGraph } from '../frontend/core/graph.mjs';
export class Store {
  constructor(directory) { this.directory = directory; this.value = { version: 1, graph: template(), runs: [] }; this.queue = Promise.resolve(); }
  async init() {
    await mkdir(this.directory, { recursive: true, mode: 0o700 });
    try { const bytes = await readFile(path.join(this.directory, 'workspace.json')); if (bytes.length > 20 * 1024 * 1024) throw Error('too large'); const value = JSON.parse(bytes); if (value.version !== 1 || !Array.isArray(value.runs) || !value.graph) throw Error('invalid store'); requireGraph(value.graph, { draft: true }); this.value = value; }
    catch (error) { if (error.code !== 'ENOENT') throw problem('storage_invalid', '工作区数据无法读取，请保留数据文件并检查磁盘或备份。', 500); }
    for (const run of this.value.runs) if (['running', 'cancelling'].includes(run.status)) { run.status = 'interrupted'; run.finishedAt = Date.now(); for (const node of Object.values(run.nodes)) if (['running', 'pending'].includes(node.status)) node.status = node.status === 'running' ? 'interrupted' : 'skipped'; }
    await this.save(); return this;
  }
  save() {
    const bytes = JSON.stringify(this.value); if (Buffer.byteLength(bytes) > 20 * 1024 * 1024) throw problem('storage_full', '运行记录超过 20 MiB，请删除旧记录后重试。', 507);
    const operation = this.queue.then(async () => {
      const target = path.join(this.directory, 'workspace.json'), temp = target + '.' + randomUUID() + '.tmp';
      await writeFile(temp, bytes, { mode: 0o600 });
      // Node rename replaces the file atomically on macOS and Windows; never delete the last valid copy first.
      await rename(temp, target);
    });
    this.queue = operation.catch(() => {}); return operation;
  }
}
