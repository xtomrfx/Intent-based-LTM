#!/usr/bin/env python3
import argparse
import json
import shlex
from pathlib import Path

from gateway_native_artifacts_lib import build_native_artifacts, build_snapshot, load_json
from publish_gateway_native_artifacts import (
    DEFAULT_SSH_TIMEOUT_SECONDS,
    build_records_block,
    parse_data_group_records,
    parse_ifile_source_paths,
    run_ssh,
    utc_now,
)


def load_backup_text(path):
    resolved = Path(path).resolve()
    if not resolved.exists():
        raise FileNotFoundError(f"backup file not found: {resolved}")
    return resolved.read_text(encoding="utf-8")


def parse_backup_data_group(path):
    text = load_backup_text(path).strip()
    if not text:
        return None
    if text.startswith("backup_error="):
        raise RuntimeError(text)
    return parse_data_group_records(text)


def parse_backup_ifile_source(path, object_name):
    text = load_backup_text(path).strip()
    if not text:
        return None
    if text.startswith("backup_error="):
        raise RuntimeError(text)
    parsed = parse_ifile_source_paths(text)
    return parsed.get(object_name)


def build_rollback_plan(canonical_path, backup_dir):
    config, canonical_resolved = load_json(canonical_path)
    artifacts = build_native_artifacts(config, canonical_resolved.name)
    snapshot = build_snapshot(config, canonical_resolved.name)
    backup_root = Path(backup_dir).resolve()

    listener_refs_name = artifacts["data_groups"]["listener_refs"]["name"]
    listener_settings_name = artifacts["data_groups"]["listener_settings"]["name"]
    dg_backups = {
        listener_refs_name: parse_backup_data_group(backup_root / "listener_refs.tmsh.txt"),
        listener_settings_name: parse_backup_data_group(backup_root / "listener_settings.tmsh.txt"),
    }

    ifile_names = {item["name"]: key for key, item in (artifacts.get("ifiles") or {}).items()}
    snapshot_name = ((snapshot.get("config") or {}).get("nativeObjects") or {}).get("ifiles", {}).get("config_snapshot", "")
    if snapshot_name:
        ifile_names[snapshot_name] = "config_snapshot"

    ifile_backups = {}
    for object_name, key in sorted(ifile_names.items()):
        ifile_backups[object_name] = parse_backup_ifile_source(backup_root / f"{key}.tmsh.txt", object_name)

    return {
        "schema": "f5-ai-gateway.rollback-plan/v1",
        "generated_at_utc": utc_now(),
        "canonical": str(canonical_resolved),
        "backup_dir": str(backup_root),
        "data_groups": dg_backups,
        "ifiles": ifile_backups,
    }


def execute_rollback_plan(host, port, rollback_plan, timeout_seconds):
    for object_name, records in sorted((rollback_plan.get("data_groups") or {}).items()):
        if records:
            block = build_records_block(records)
            cmd = f"""
if tmsh list ltm data-group internal {shlex.quote(object_name)} >/dev/null 2>&1; then
  tmsh modify ltm data-group internal {shlex.quote(object_name)} records replace-all-with {{ {block} }}
else
  tmsh create ltm data-group internal {shlex.quote(object_name)} type string records add {{ {block} }}
fi
tmsh save sys config
""".strip()
        else:
            cmd = f"""
if tmsh list ltm data-group internal {shlex.quote(object_name)} >/dev/null 2>&1; then
  tmsh delete ltm data-group internal {shlex.quote(object_name)}
  tmsh save sys config
fi
""".strip()
        run_ssh(host, port, cmd, timeout_seconds=timeout_seconds)

    for object_name, source_path in sorted((rollback_plan.get("ifiles") or {}).items()):
        if source_path:
            cmd = f"""
if tmsh list sys file ifile {shlex.quote(object_name)} >/dev/null 2>&1; then
  tmsh modify sys file ifile {shlex.quote(object_name)} source-path {source_path}
else
  tmsh create sys file ifile {shlex.quote(object_name)} source-path {source_path}
fi
tmsh save sys config
""".strip()
        else:
            cmd = f"""
if tmsh list sys file ifile {shlex.quote(object_name)} >/dev/null 2>&1; then
  tmsh delete sys file ifile {shlex.quote(object_name)}
  tmsh save sys config
fi
""".strip()
        run_ssh(host, port, cmd, timeout_seconds=timeout_seconds)


def main():
    parser = argparse.ArgumentParser(
        description="Restore BIG-IP Data Group and iFile source-path state from publish backups."
    )
    parser.add_argument("--canonical", default="gateway-config.canonical.json", help="Canonical JSON input path.")
    parser.add_argument("--backup-dir", default="publish-backups/latest", help="Backup directory created by publisher.")
    parser.add_argument("--bigip-host", help="BIG-IP SSH host.")
    parser.add_argument("--bigip-port", type=int, default=22, help="BIG-IP SSH port.")
    parser.add_argument(
        "--ssh-timeout-seconds",
        type=int,
        default=DEFAULT_SSH_TIMEOUT_SECONDS,
        help="Timeout used for each individual SSH operation during rollback.",
    )
    parser.add_argument("--show-plan", action="store_true", help="Print the rollback plan JSON and exit.")
    parser.add_argument("--execute", action="store_true", help="Execute the rollback against BIG-IP.")
    parser.add_argument(
        "--output",
        default="publish-backups/latest/rollback-plan.json",
        help="Path to write the rollback plan JSON.",
    )
    args = parser.parse_args()

    rollback_plan = build_rollback_plan(args.canonical, args.backup_dir)
    output_path = Path(args.output).resolve()
    output_path.parent.mkdir(parents=True, exist_ok=True)
    output_path.write_text(json.dumps(rollback_plan, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(f"rollback_plan={output_path}")

    if args.show_plan:
        print(json.dumps(rollback_plan, ensure_ascii=False, indent=2))

    if args.execute:
        if not args.bigip_host:
            raise SystemExit("--execute requires --bigip-host")
        execute_rollback_plan(args.bigip_host, args.bigip_port, rollback_plan, args.ssh_timeout_seconds)
        print(f"rolled_back_bigip={args.bigip_host}:{args.bigip_port}")


if __name__ == "__main__":
    main()
