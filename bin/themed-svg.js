#!/usr/bin/env node
import('../dist/src/cli.js')
  .then(({ runCli }) => {
    process.exitCode = runCli();
  })
  .catch((error) => {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  });
