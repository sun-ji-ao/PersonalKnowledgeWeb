import { Worker } from 'node:worker_threads';
// A fresh worker bounds even synchronous parser/highlighter work. No file/network access is performed by conversion code.
export function runContentJob(operation, input, context = {}, { timeoutMs } = {}) {
  return new Promise(resolve => {
    const worker = new Worker(new URL('./html-worker.mjs', import.meta.url), { workerData: { operation, input, context }, resourceLimits: { maxOldGenerationSizeMb: 256 }, execArgv: [] });
    let finished = false;
    const finish = async result => { if (finished) return; finished = true; clearTimeout(timer); await worker.terminate(); resolve(result); };
    const failure = (code, message) => ({ schemaVersion: 'notes-html/1', status: 'rejected', htmlSource: null, metadata: {}, diagnostics: [{ code, severity: 'error', blocksPublishing: true, location: null, message }] });
    // Renderer cold-start includes Shiki, JSDOM and Mermaid module initialization.
    const maximum = operation === 'render' ? 30_000 : 10_000;
    const timer = setTimeout(() => finish(failure('TIME_LIMIT', 'Content job exceeded time budget.')), Math.max(1, Math.min(timeoutMs ?? maximum, maximum)));
    worker.once('message', finish);
    worker.once('error', error => finish(failure('WORKER_FAILED', error.message)));
    worker.once('exit', code => { if (!finished) finish(failure('WORKER_FAILED', `Worker exited before returning a result: ${code}`)); });
  });
}
export const convertMarkdown = (bytes, context = {}, limits) => runContentJob('convert', bytes, context, limits);
export const normalizeHtml = (html, context = {}, limits) => runContentJob('normalize', html, context, limits);
export const renderHtml = async (result, limits) => {
  const rendered = await runContentJob('render', result, {}, limits);
  return rendered.htmlSource === null && result?.htmlSource != null
    ? { ...result, htmlRendered: null, renderStatus: 'failed', publishable: false, diagnostics: [...(result.diagnostics || []), ...rendered.diagnostics] }
    : rendered;
};
