"""Portable launch entry: run from any directory after installing requirements."""
from pathlib import Path
import os
import sys

ROOT = Path(__file__).resolve().parent
os.chdir(ROOT)
sys.path.insert(0, str(ROOT/'src'))

if __name__ == '__main__':
    from catalog_ai.training.demo import main
    main()
