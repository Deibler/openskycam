/** Enforces the server architecture; runtime modules never import this build-time check. */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(path.join(process.cwd(), 'package.json'));
const ts = require('typescript');
const layers = {
  routes: new Set(['handler', 'models', 'utils']),
  handler: new Set(['service', 'models', 'utils']),
  service: new Set(['service', 'db', 'models', 'utils']),
  db: new Set(['db', 'models', 'utils']),
  utils: new Set(['utils', 'models']),
  models: new Set(['models']),
};
const suffix = {
  routes: 'Route',
  handler: 'Handler',
  service: 'Service',
  db: 'Ops',
  utils: 'Util',
  models: 'model',
};
function layerOf(file) {
  return file.split(/[\\/]/).findLast(part => Object.hasOwn(layers, part));
}
function persistent(type) {
  return /\b(?:D1Database(?:Session)?|D1PreparedStatement|R2Bucket)\b/.test(type);
}

export function inspectSource(file, source, checker) {
  const failures = [];
  const layer = layerOf(file);
  if (!layer) return failures; // index.ts is the explicitly bounded composition root.
  const name = path.basename(file).replace(/(?:\.d)?\.ts$/, '');
  const concern = layer === 'db' ? '[A-Z][a-zA-Z0-9]*' : '[a-z][a-zA-Z0-9]*';
  if (!new RegExp(`^${concern}(Storage|Inference|Shared)${suffix[layer]}$`).test(name))
    failures.push('filename must identify concern, category, and layer');
  const ast = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true);
  // A program's source nodes are required for accurate receiver types (aliases included).
  const tree = checker?.getProgramSource?.(file) ?? ast;
  const fail = (node, message) =>
    failures.push(`${tree.getLineAndCharacterOfPosition(node.getStart(tree)).line + 1}: ${message}`);
  function visit(node) {
    if ((ts.isInterfaceDeclaration(node) || ts.isTypeAliasDeclaration(node)) && layer !== 'models')
      fail(node, 'declare types in models/');
    if (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) {
      const spec = node.moduleSpecifier?.text;
      if (spec?.startsWith('.')) {
        const target = path.resolve(path.dirname(file), spec);
        const importedLayer = layerOf(target);
        if (!importedLayer || !layers[layer].has(importedLayer)) fail(node, `${layer}/ cannot import ${spec}`);
        if (layer === 'routes' && importedLayer === 'utils' && !target.endsWith('/routerSharedUtil'))
          fail(node, 'routes may use only the router utility');
        if (layer === 'models' && ts.isImportDeclaration(node) && !node.importClause?.isTypeOnly)
          fail(node, 'models must use type-only imports');
      }
    }
    if (layer !== 'db') {
      if (
        (ts.isStringLiteralLike(node) || ts.isTemplateHead(node)) &&
        /^\s*(?:SELECT\b[\s\S]*\bFROM\b|INSERT\s+(?:OR\s+\w+\s+)?INTO\b|UPDATE\s+\w+\s+SET\b|DELETE\s+FROM\b|CREATE\s+TABLE\b|WITH\s+\w+[\s\S]*\bSELECT\b)/i.test(
          node.text,
        )
      )
        fail(node, 'SQL belongs exclusively in db/');
      if (ts.isPropertyAccessExpression(node) || ts.isElementAccessExpression(node)) {
        const method = ts.isPropertyAccessExpression(node) ? node.name.text : node.argumentExpression?.text;
        const type = checker ? checker.typeToString(checker.getTypeAtLocation(node.expression)) : '';
        // STORE is the footage store binding (external/store): a Fetcher, so only its name marks it.
        if (persistent(type) || ['prepare', 'withSession', 'batch', 'STORE'].includes(method))
          fail(node, 'persistence methods belong exclusively in db/');
      }
      if (
        ts.isVariableDeclaration(node) &&
        ts.isObjectBindingPattern(node.name) &&
        node.initializer &&
        checker &&
        persistent(checker.typeToString(checker.getTypeAtLocation(node.initializer)))
      )
        fail(node, 'do not extract persistence methods outside db/');
    }
    if (layer === 'service' && ts.isIdentifier(node) && ['Request', 'Response', 'Headers'].includes(node.text))
      fail(node, 'services must use application models, not HTTP objects');
    if (layer === 'handler' && ts.isNewExpression(node) && node.expression.getText(tree) === 'ApplicationError')
      fail(node, 'business failures are raised by services');
    if (
      layer === 'handler' &&
      ts.isPropertyAccessExpression(node) &&
      ['Date.now', 'crypto.randomUUID', 'crypto.subtle'].includes(node.getText(tree))
    )
      fail(node, 'business decisions belong in services');
    if (layer === 'routes') {
      if (
        ts.isFunctionLike(node) ||
        ts.isClassDeclaration(node) ||
        ts.isIfStatement(node) ||
        ts.isSwitchStatement(node)
      )
        fail(node, 'route files contain declarations only');
      if (ts.isCallExpression(node) && node.expression.getText(tree) !== 'route')
        fail(node, 'route files may only register handlers');
    }
    if (ts.isCallExpression(node) && node.expression.kind === ts.SyntaxKind.ImportKeyword)
      fail(node, 'use static imports so layer boundaries can be checked');
    ts.forEachChild(node, visit);
  }
  visit(tree);
  return [...new Set(failures)];
}

export function checkProject(project) {
  const configPath = path.join(root, project, 'tsconfig.json');
  const config = ts.readConfigFile(configPath, ts.sys.readFile);
  const parsed = ts.parseJsonConfigFileContent(config.config, ts.sys, path.dirname(configPath));
  const program = ts.createProgram(parsed.fileNames, parsed.options);
  const checker = program.getTypeChecker();
  checker.getProgramSource = file => program.getSourceFile(file);
  const files = program
    .getSourceFiles()
    .filter(
      f =>
        !f.fileName.includes('/node_modules/') &&
        (f.fileName.startsWith(path.join(root, project, 'src')) || f.fileName.startsWith(path.join(root, 'shared'))),
    );
  const failures = [];
  const graph = new Map();
  for (const file of files) {
    for (const failure of inspectSource(file.fileName, file.text, checker))
      failures.push(`${path.relative(root, file.fileName)}:${failure}`);
    const dependencies = [];
    ts.forEachChild(file, node => {
      if (ts.isImportDeclaration(node) && node.moduleSpecifier.text.startsWith('.')) {
        const resolved = ts.resolveModuleName(node.moduleSpecifier.text, file.fileName, parsed.options, ts.sys)
          .resolvedModule?.resolvedFileName;
        if (resolved) dependencies.push(resolved);
      }
    });
    graph.set(file.fileName, dependencies);
  }
  const done = new Set(),
    active = new Set();
  function walk(file, stack = []) {
    if (active.has(file)) {
      failures.push(`import cycle: ${[...stack, file].map(f => path.relative(root, f)).join(' -> ')}`);
      return;
    }
    if (done.has(file) || !graph.has(file)) return;
    active.add(file);
    for (const next of graph.get(file)) walk(next, [...stack, file]);
    active.delete(file);
    done.add(file);
  }
  for (const file of graph.keys()) walk(file);
  return { failures, count: files.length };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const project = process.argv[2];
  if (!['dashboard', 'worker'].includes(project)) throw new Error('Usage: check-architecture.mjs dashboard|worker');
  const { failures, count } = checkProject(project);
  if (failures.length) {
    console.error(failures.join('\n'));
    process.exitCode = 1;
  } else
    console.log(
      `Architecture: ${project}, ${count} modules; naming, models, layer imports, SQL/R2 placement, and cycles passed.`,
    );
}
