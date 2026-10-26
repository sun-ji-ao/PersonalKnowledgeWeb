import { readFile, writeFile } from 'node:fs/promises';
import { migrateMarkdownLibrary } from '../lib/html-batch-migration.mjs';
const [sourceRoot,destination,...flags]=process.argv.slice(2);
try {
  const options={sourceRoot,destination};let reportPath;
  for(let i=0;i<flags.length;i++) {if(flags[i]==='--resume') options.resume=true;else if(flags[i]==='--catalog') options.catalog=JSON.parse(await readFile(flags[++i],'utf8'));else if(flags[i]==='--report') reportPath=flags[++i];else throw new Error('Unknown argument');}
  if(!sourceRoot||!destination) throw new Error('Usage: node scripts/html-batch-migrate.mjs SOURCE NEW_DEST [--catalog JSON] [--report JSON] [--resume]');
  let count=0;options.onProgress=()=>{if(++count%20===0) console.error(`Processed ${count} sources`);};
  const report=await migrateMarkdownLibrary(options);if(reportPath) await writeFile(reportPath,JSON.stringify(report,null,2),{flag:'wx'});
  console.log(JSON.stringify({totals:report.totals,htmlNotes:report.htmlNotes,publishedNotes:report.publishedNotes},null,2));
  if(report.totals.failed||report.totals.conflict||report.totals.reviewRequired||report.totals.unresolvedLinks||report.totals.unresolvedResources) process.exitCode=2;
} catch(e) {console.error(e.message);process.exitCode=1;}
