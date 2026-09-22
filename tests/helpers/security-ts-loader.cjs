'use strict';
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { webcrypto } = require('node:crypto');
const Babel = require('@babel/standalone');
const root = path.resolve(__dirname, '../..');

// Execute production handlers unchanged apart from TypeScript/import removal.
// All remote dependencies must be explicitly supplied by the test.
module.exports = function load(file, globals = {}, names) {
  const code = Babel.transform(fs.readFileSync(path.join(root, file), 'utf8'), {
    filename: file,
    presets: ['typescript'],
    plugins: [() => ({ visitor: {
      ImportDeclaration(p) { p.remove(); },
      ExportNamedDeclaration(p) {
        if (p.node.declaration) p.replaceWith(p.node.declaration);
        else p.remove();
      },
      Program: { exit(p) {
        if (names) p.node.body = p.node.body.filter(n => n.type === 'FunctionDeclaration' && names.includes(n.id.name));
      } },
    } })],
  }).code;
  let handler;
  const context = {
    console, Request, Response, URL, URLSearchParams, TextEncoder, Uint8Array,
    atob, btoa, crypto: webcrypto, AbortSignal,
    Deno: { env: { get: () => 'synthetic-test-value' }, serve: fn => { handler = fn; } },
    serve: fn => { handler = fn; },
    ...globals,
  };
  vm.createContext(context);
  vm.runInContext(code, context);
  return { context, handler };
};
