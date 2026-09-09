import { readFileSync, writeFileSync } from 'node:fs';
import { basename, dirname, extname, join } from 'node:path';
import { createInterface } from 'node:readline';
import { fileURLToPath } from 'node:url';
import { processStdioRequest, STDIO_PROTOCOL_VERSION } from './protocol.js';
import { transformSvg } from './transform.js';
import type { OutputMode, Palette, ThemedSvgManifest, TransformOptions } from './types.js';

interface Arguments {
  input: string;
  output?: string;
  manifest?: string;
  mode: OutputMode;
  preset?: string;
  palette?: string;
  lightPalette?: string;
  darkPalette?: string;
  lightOutput?: string;
  darkOutput?: string;
  help: boolean;
  version: boolean;
  stdio?: 'json' | 'jsonl';
}

function help(): void {
  process.stdout.write(`Usage: themed-svg --manifest manifest.json [options] <input.svg>

Structurally bind semantic theme tokens to explicitly selected SVG targets.

Options:
  -o, --output <file>         Output path (stdout by default)
  -m, --manifest <file>       Version 1 explicit-binding manifest
  --mode <mode>               host (default), standalone-adaptive, fixed, paired-fixed
  --preset <name>             Preset for fixed/host fallback
  --palette <file>            Shared runtime JSON palette
  --light-palette <file>      Runtime light-mode JSON palette
  --dark-palette <file>       Runtime dark-mode JSON palette
  --light-output <file>       paired-fixed light output path
  --dark-output <file>        paired-fixed dark output path
  --stdio <json|jsonl>        Version 1 editor protocol over stdin/stdout
  -v, --version               Show package version
  -h, --help                  Show help

Exit codes: 0 success, 1 usage/runtime failure, 2 transform diagnostics.
`);
}

function parse(argv: string[]): Arguments {
  const result: Arguments = {
    input: '',
    mode: 'host',
    help: false,
    version: false,
  };
  const positional: string[] = [];
  for (let index = 0; index < argv.length; index++) {
    const argument = argv[index]!;
    const value = (): string => {
      const next = argv[++index];
      if (!next) throw new Error(`${argument} requires a value`);
      return next;
    };
    switch (argument) {
      case '-h': case '--help': result.help = true; break;
      case '-v': case '--version': result.version = true; break;
      case '-o': case '--output': result.output = value(); break;
      case '-m': case '--manifest': result.manifest = value(); break;
      case '--mode': result.mode = value() as OutputMode; break;
      case '--preset': result.preset = value(); break;
      case '--palette': result.palette = value(); break;
      case '--light-palette': result.lightPalette = value(); break;
      case '--dark-palette': result.darkPalette = value(); break;
      case '--light-output': result.lightOutput = value(); break;
      case '--dark-output': result.darkOutput = value(); break;
      case '--stdio': result.stdio = value() as 'json' | 'jsonl'; break;
      default:
        if (argument.startsWith('-')) throw new Error(`Unknown option: ${argument}`);
        positional.push(argument);
    }
  }
  if (positional.length > 1) throw new Error('Only one input SVG may be supplied.');
  result.input = positional[0] ?? '';
  return result;
}

function pairedName(input: string, variant: 'light' | 'dark'): string {
  const extension = extname(input);
  return join(dirname(input), `${basename(input, extension)}.${variant}${extension || '.svg'}`);
}

function readPalette(path: string | undefined): Palette | undefined {
  return path ? JSON.parse(readFileSync(path, 'utf8')) as Palette : undefined;
}

function packageVersion(): string {
  const packagePath = fileURLToPath(new URL('../../package.json', import.meta.url));
  return (JSON.parse(readFileSync(packagePath, 'utf8')) as { version: string }).version;
}

function invalidJsonResponse(message: string): object {
  return {
    protocolVersion: STDIO_PROTOCOL_VERSION,
    ok: false,
    diagnostics: [{
      code: 'invalid-request',
      severity: 'error',
      message,
      source: { kind: 'request' },
    }],
  };
}

function runStdio(format: 'json' | 'jsonl'): number {
  const source = readFileSync(0, 'utf8');
  if (format === 'json') {
    try {
      process.stdout.write(`${JSON.stringify(processStdioRequest(JSON.parse(source)))}\n`);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      process.stdout.write(`${JSON.stringify(invalidJsonResponse(`Invalid JSON: ${message}`))}\n`);
    }
    return 0;
  }
  for (const line of source.split(/\r?\n/)) {
    if (!line.trim()) continue;
    try {
      process.stdout.write(`${JSON.stringify(processStdioRequest(JSON.parse(line)))}\n`);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      process.stdout.write(`${JSON.stringify(invalidJsonResponse(`Invalid JSONL record: ${message}`))}\n`);
    }
  }
  return 0;
}

async function runJsonlStream(): Promise<number> {
  const lines = createInterface({ input: process.stdin, crlfDelay: Infinity });
  for await (const line of lines) {
    if (!line.trim()) continue;
    try {
      process.stdout.write(`${JSON.stringify(processStdioRequest(JSON.parse(line)))}\n`);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      process.stdout.write(`${JSON.stringify(invalidJsonResponse(`Invalid JSONL record: ${message}`))}\n`);
    }
  }
  return 0;
}

export function runCli(argv = process.argv.slice(2)): number {
  const args = parse(argv);
  if (args.version) {
    process.stdout.write(`${packageVersion()}\n`);
    return 0;
  }
  if (args.stdio) {
    if (args.stdio !== 'json' && args.stdio !== 'jsonl') {
      throw new Error('--stdio must be json or jsonl');
    }
    return runStdio(args.stdio);
  }
  if (args.help || !args.input || !args.manifest) {
    help();
    return args.help ? 0 : 1;
  }
  if (!['fixed', 'standalone-adaptive', 'host', 'paired-fixed'].includes(args.mode)) {
    throw new Error(`Unknown mode: ${args.mode}`);
  }
  if (args.mode !== 'paired-fixed' && (args.lightOutput || args.darkOutput)) {
    throw new Error('--light-output and --dark-output require --mode paired-fixed');
  }

  const svg = readFileSync(args.input, 'utf8');
  const manifest = JSON.parse(readFileSync(args.manifest, 'utf8')) as ThemedSvgManifest;
  const options: TransformOptions = { mode: args.mode };
  if (args.preset) options.preset = args.preset;
  const palette = readPalette(args.palette);
  const lightPalette = readPalette(args.lightPalette);
  const darkPalette = readPalette(args.darkPalette);
  if (palette) options.palette = palette;
  if (lightPalette) options.lightPalette = lightPalette;
  if (darkPalette) options.darkPalette = darkPalette;

  const result = transformSvg(svg, manifest, options);
  for (const diagnostic of result.diagnostics) {
    process.stderr.write(`${diagnostic.severity}: ${diagnostic.code}: ${diagnostic.message}\n`);
  }
  if (result.diagnostics.some(({ severity }) => severity === 'error')) return 2;
  if (args.mode === 'paired-fixed') {
    writeFileSync(args.lightOutput ?? pairedName(args.input, 'light'), result.lightSvg!, 'utf8');
    writeFileSync(args.darkOutput ?? pairedName(args.input, 'dark'), result.darkSvg!, 'utf8');
  } else if (args.output) {
    writeFileSync(args.output, result.svg!, 'utf8');
  } else {
    process.stdout.write(result.svg!);
  }
  return 0;
}

export async function runCliAsync(argv = process.argv.slice(2)): Promise<number> {
  const args = parse(argv);
  if (args.stdio === 'jsonl') return await runJsonlStream();
  return runCli(argv);
}
