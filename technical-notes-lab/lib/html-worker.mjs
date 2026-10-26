import { parentPort, workerData } from 'node:worker_threads';
import { convertMarkdownCore, normalizeHtmlCore, collectReferencesCore, rejected } from './html-core.mjs';
try {
  const { operation, input, context } = workerData;
  let result;
  if (operation === 'convert') result = convertMarkdownCore(input, context);
  else if (operation === 'references') result = collectReferencesCore(input);
  else if (operation === 'normalize') result = normalizeHtmlCore(input, context);
  else if (operation === 'render') result = await (await import('./html-render.mjs')).renderHtmlCore(input);
  else result = rejected('INVALID_OPERATION', 'Unknown content operation.');
  parentPort.postMessage(result);
} catch (error) { parentPort.postMessage(rejected('CONVERSION_FAILED', error.message)); }
