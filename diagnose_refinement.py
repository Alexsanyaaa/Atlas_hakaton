"""Portable entry point for threshold/error diagnostics without pip -e."""
from pathlib import Path
import os,sys
ROOT=Path(__file__).resolve().parent
os.chdir(ROOT)
sys.path.insert(0,str(ROOT/'src'))
if __name__=='__main__':
    from catalog_ai.participant3.diagnostics import main
    main()
