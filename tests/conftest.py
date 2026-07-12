from __future__ import annotations

import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / "src"))
sys.path.insert(0, str(Path(__file__).resolve().parent))

REF_DIR = ROOT / "data" / "ref"
RAW_DIR = ROOT / "data" / "raw"
KEPCO_PATH = RAW_DIR / "kepco_ev_20251231.csv"
