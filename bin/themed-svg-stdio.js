#!/usr/bin/env node
import('../dist/src/cli.js')
  .then(async ({ runCliAsync }) => {
    process.exitCode = await runCliAsync(['--stdio', process.argv[2] ?? 'jsonl']);
  })
  .catch((error) => {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  });
