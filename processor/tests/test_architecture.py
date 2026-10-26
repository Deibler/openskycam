"""Keep the processor's CLI, business rules, and persistence adapters separate."""
import ast
from pathlib import Path
import re
import unittest

ROOT = Path(__file__).resolve().parents[1] / 'skyvision_processor'
ALLOWED = {
    'routes': {'handler', 'models'},
    'handler': {'service', 'models', 'utils'},
    'service': {'service', 'db', 'models', 'utils'},
    'db': {'db', 'models', 'utils'},
    'utils': {'utils', 'models'},
    'models': {'models'},
}
SUFFIX = {'routes': 'Route', 'handler': 'Handler', 'service': 'Service', 'db': 'Ops', 'utils': 'Util', 'models': 'model'}
SQL = re.compile(r'^\s*(SELECT\b.*\bFROM\b|INSERT\s+(?:OR\s+\w+\s+)?INTO\b|UPDATE\s+\w+\s+SET\b|DELETE\s+FROM\b)', re.I | re.S)


def violations(relative, source):
    layer, filename = relative.parts[0], relative.name
    if layer not in ALLOWED or filename == '__init__.py':
        return []
    errors = []
    concern = '[A-Z][a-zA-Z0-9]*' if layer == 'db' else '[a-z][a-zA-Z0-9]*'
    if not re.fullmatch(concern + '(Storage|Inference|Shared)' + SUFFIX[layer] + r'\.py', filename):
        errors.append('filename must identify concern, category, and layer')
    tree = ast.parse(source)
    for node in ast.walk(tree):
        if isinstance(node, ast.ImportFrom) and node.level:
            imported = node.module.split('.')[0] if node.level == 2 and node.module else layer
            if imported not in ALLOWED[layer]:
                errors.append(f'{layer} cannot import {imported}')
            base = (ROOT / relative).parent
            for _ in range(node.level - 1):
                base = base.parent
            target = base.joinpath(*(node.module or '').split('.')) if node.module else base
            if not target.is_dir() and not target.with_suffix('.py').is_file():
                errors.append(f'missing relative module: {node.module}')
            elif target.is_dir():
                for alias in node.names:
                    child = target / alias.name
                    if not child.is_dir() and not child.with_suffix('.py').is_file():
                        errors.append(f'missing relative module: {alias.name}')
        if layer != 'db' and isinstance(node, ast.Constant) and isinstance(node.value, str) and SQL.match(node.value):
            errors.append('SQL belongs in db/')
        if layer == 'routes' and isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef, ast.ClassDef, ast.Call, ast.If)):
            errors.append('routes contain registration only')
        if layer not in ('models',) and isinstance(node, ast.ClassDef) and any(getattr(base, 'id', '') in ('TypedDict', 'Protocol') for base in node.bases):
            errors.append('contracts belong in models/')
    return errors


class ArchitectureTests(unittest.TestCase):
    def test_processor_layers_and_naming(self):
        failures = []
        for file in ROOT.rglob('*.py'):
            failures.extend(f'{file.relative_to(ROOT)}: {error}' for error in violations(file.relative_to(ROOT), file.read_text()))
        self.assertEqual([], failures)

    def test_guard_rejects_sql_and_bypassed_layers(self):
        self.assertIn('SQL belongs in db/', violations(Path('service/jobInferenceService.py'), "query = 'SELECT * FROM jobs'"))
        self.assertIn('handler cannot import db', violations(Path('handler/jobInferenceHandler.py'), 'from ..db.JobInferenceOps import read'))
        self.assertIn('routes contain registration only', violations(Path('routes/jobInferenceRoute.py'), 'def handle(): pass'))
        self.assertEqual([], violations(Path('db/JobInferenceOps.py'), "query = 'SELECT * FROM jobs'"))
        self.assertIn('missing relative module: config', violations(Path('service/detectorInferenceService.py'), 'from . import config'))
