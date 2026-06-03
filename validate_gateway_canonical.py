#!/usr/bin/env python3
import argparse
from pathlib import Path

from gateway_native_artifacts_lib import load_json, validate_canonical_config


def main():
    parser = argparse.ArgumentParser(
        description="Validate the canonical gateway JSON before rendering or publishing native artifacts."
    )
    parser.add_argument(
        "--canonical",
        default="gateway-config.canonical.json",
        help="Path to the canonical source-of-intent JSON file.",
    )
    args = parser.parse_args()

    config, canonical_path = load_json(args.canonical)
    validation = validate_canonical_config(config)
    resolved_path = Path(canonical_path).resolve()

    print(f"canonical={resolved_path}")
    for item in validation["warnings"]:
        print(f"warning={item}")
    for item in validation["errors"]:
        print(f"error={item}")

    if validation["errors"]:
        raise SystemExit(1)
    print("status=ok")


if __name__ == "__main__":
    main()
