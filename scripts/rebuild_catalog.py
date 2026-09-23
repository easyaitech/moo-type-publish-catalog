#!/usr/bin/env python3
"""Recompute catalog summary and fill missing download / copy fields.

Does not remove videos. Existing Drive view links are kept.
Empty Drive download fields are filled from the file id in the view URL.
"""

from __future__ import annotations

import argparse
import json
from pathlib import Path

from catalog_lib import DEFAULT_CATALOG, load_catalog, recompute, save_catalog


def main() -> None:
    parser = argparse.ArgumentParser(description="Normalize catalog.json and refresh summary.")
    parser.add_argument("--catalog", type=Path, default=DEFAULT_CATALOG)
    args = parser.parse_args()
    catalog = recompute(load_catalog(args.catalog))
    save_catalog(catalog, args.catalog)
    print(json.dumps({"updated_at": catalog["updated_at"], "summary": catalog["summary"]}, ensure_ascii=False))


if __name__ == "__main__":
    main()
