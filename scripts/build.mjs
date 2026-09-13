import { build, context } from 'esbuild';
import { copyFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const watch = process.argv.includes('--watch');
const minify = process.argv.includes('--minify');
const extensionOnly = process.argv.includes('--extension');
const webviewOnly = process.argv.includes('--webview');

const extension = {
  entryPoints: [join(root, 'src/extension.ts')],
  bundle: true,
  outfile: join(root, 'dist/extension.js'),
  external: ['vscode', 'node-pty'],
  format: 'cjs',
  platform: 'node',
  target: 'node18',
  treeShaking: true,
  legalComments: 'none',
  minify,
};

const webview = {
  entryPoints: [join(root, 'src/webview/main.ts')],
  bundle: true,
  outfile: join(root, 'dist/webview.js'),
  format: 'iife',
  platform: 'browser',
  target: 'es2022',
  treeShaking: true,
  legalComments: 'none',
  minify,
};

const targets = extensionOnly ? [extension] : webviewOnly ? [webview] : [extension, webview];

function copyTerminalCss() {
  mkdirSync(join(root, 'dist'), { recursive: true });
  copyFileSync(
    join(root, 'node_modules/@xterm/xterm/css/xterm.css'),
    join(root, 'dist/xterm.css'),
  );
}

if (watch) {
  console.log('[watch] build started');
  const contexts = await Promise.all(targets.map((options) => context(options)));
  await Promise.all(contexts.map((buildContext) => buildContext.rebuild()));
  await Promise.all(contexts.map((buildContext) => buildContext.watch()));
  copyTerminalCss();
  console.log('[watch] build finished');

  const close = async () => {
    await Promise.all(contexts.map((buildContext) => buildContext.dispose()));
    process.exit(0);
  };
  process.once('SIGINT', close);
  process.once('SIGTERM', close);
  await new Promise(() => {});
} else {
  await Promise.all(targets.map((options) => build(options)));
  copyTerminalCss();
}
