"""Import validation - ensures all imports resolve correctly.

Attempts to import all Python modules in scripts/ to catch broken imports
before they cause runtime errors.
"""
from __future__ import annotations

import sys
import importlib.util
from pathlib import Path

# Add scripts to path
ROOT = Path(__file__).resolve().parent.parent.parent
sys.path.insert(0, str(ROOT / 'scripts'))


def check_imports() -> bool:
    """Check all Python scripts can be imported."""
    scripts_dir = ROOT / 'scripts'
    failures = []
    checked = []

    for py_file in scripts_dir.rglob('*.py'):
        if py_file.name.startswith('__'):
            continue

        # Build module name from relative path
        rel_path = py_file.relative_to(ROOT)
        module_name = str(rel_path.with_suffix('')).replace('\\', '.').replace('/', '.')

        try:
            spec = importlib.util.spec_from_file_location(module_name, py_file)
            if spec and spec.loader:
                module = importlib.util.module_from_spec(spec)
                # Register in sys.modules before exec (needed for dataclasses, etc.)
                sys.modules[module_name] = module
                spec.loader.exec_module(module)
                print(f"OK {module_name}")
                checked.append(module_name)
        except Exception as e:
            print(f"FAIL {module_name}: {e}")
            failures.append((module_name, str(e)))

    if failures:
        print(f"\n{len(failures)} import failures:")
        for name, error in failures:
            print(f"  {name}: {error}")
        return False

    print(f"\nAll imports valid ({len(checked)}/{len(checked)} files)")
    return True


if __name__ == "__main__":
    success = check_imports()
    sys.exit(0 if success else 1)
