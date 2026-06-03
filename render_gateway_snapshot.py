#!/usr/bin/env python3
import argparse
import json
import sys
from pathlib import Path

from gateway_native_artifacts_lib import build_snapshot, load_json, validate_canonical_config


def main():
    parser = argparse.ArgumentParser(description="Render a human-readable gateway canonical JSON into a published snapshot JSON.")
    parser.add_argument(
        "--canonical",
        default="gateway-config.canonical.json",
        help="Path to the canonical source-of-intent JSON file.",
    )
    parser.add_argument(
        "--output",
        default="gateway-config.snapshot.json",
        help="Path to the rendered snapshot JSON file.",
    )
    args = parser.parse_args()

    config, canonical_path = load_json(args.canonical)
    validation = validate_canonical_config(config)
    if validation["errors"]:
        for item in validation["errors"]:
            print(f"validation_error={item}", file=sys.stderr)
        raise SystemExit(1)
    for item in validation["warnings"]:
        print(f"validation_warning={item}", file=sys.stderr)
    output_path = Path(args.output).resolve()

    snapshot = build_snapshot(config, canonical_path.name)

    with output_path.open("w", encoding="utf-8") as handle:
        json.dump(snapshot, handle, ensure_ascii=False, indent=2)
        handle.write("\n")

    print(output_path)


if __name__ == "__main__":
    main()
