#!/usr/bin/env python3
import argparse
import datetime as dt
import hashlib
import json
import os
import re
import shlex
import signal
import subprocess
from pathlib import Path

from gateway_native_artifacts_lib import (
    build_native_artifacts,
    build_snapshot,
    load_json,
    validate_canonical_config,
    write_local_native_files,
)


DEFAULT_SSH_TIMEOUT_SECONDS = 30


def canonical_json_bytes(payload):
    return json.dumps(payload, ensure_ascii=False, sort_keys=True, separators=(",", ":")).encode("utf-8")


def sha256_bytes(payload_bytes):
    return hashlib.sha256(payload_bytes).hexdigest()


def sha256_json(payload):
    return sha256_bytes(canonical_json_bytes(payload))


def sha256_file(path):
    return hashlib.sha256(Path(path).resolve().read_bytes()).hexdigest()


def run_ssh(host, port, remote_cmd, stdin_bytes=None, timeout_seconds=DEFAULT_SSH_TIMEOUT_SECONDS):
    sentinel = "__CODEX_DONE__:"
    wrapped_cmd = f"{remote_cmd}\nstatus=$?\nprintf '\\n{sentinel}%s\\n' \"$status\"\n"
    cmd = [
        "ssh",
        "-q",
        "-o",
        "BatchMode=yes",
        "-o",
        "LogLevel=ERROR",
        "-o",
        "StrictHostKeyChecking=no",
        "-o",
        "UserKnownHostsFile=/dev/null",
        "-o",
        "ConnectTimeout=10",
        "-o",
        "ConnectionAttempts=1",
        "-o",
        "ServerAliveInterval=5",
        "-o",
        "ServerAliveCountMax=2",
        "-p",
        str(port),
        host,
        f"sh -lc {shlex.quote(wrapped_cmd)}",
    ]
    process = subprocess.Popen(
        cmd,
        stdin=subprocess.PIPE if stdin_bytes is not None else None,
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        start_new_session=True,
    )
    try:
        stdout_bytes, stderr_bytes = process.communicate(input=stdin_bytes, timeout=timeout_seconds)
    except subprocess.TimeoutExpired as exc:
        try:
            os.killpg(process.pid, signal.SIGKILL)
        except ProcessLookupError:
            pass
        stdout_bytes, stderr_bytes = process.communicate()
        stdout = ((exc.stdout or b"") + (stdout_bytes or b"")).decode("utf-8", errors="replace")
        stderr = ((exc.stderr or b"") + (stderr_bytes or b"")).decode("utf-8", errors="replace")
        raise RuntimeError(f"ssh command timed out after {timeout_seconds}s: {stderr or stdout}") from exc

    stdout = (stdout_bytes or b"").decode("utf-8", errors="replace")
    stderr = (stderr_bytes or b"").decode("utf-8", errors="replace")

    match = re.search(rf"{re.escape(sentinel)}(\d+)", stdout)
    if not match:
        combined = f"{stdout}\n{stderr}".strip()
        raise RuntimeError(f"ssh failed to return sentinel: {combined}")

    remote_status = int(match.group(1))
    cleaned_stdout = re.sub(rf"\n?{re.escape(sentinel)}\d+\n?$", "", stdout, count=1)
    if remote_status != 0:
        raise RuntimeError(f"remote command failed ({remote_status}): {stderr or cleaned_stdout}")
    return cleaned_stdout, stderr


def upload_via_ssh(host, port, content_bytes, remote_path, timeout_seconds=DEFAULT_SSH_TIMEOUT_SECONDS):
    remote_cmd = f"cat > {shlex.quote(remote_path)}"
    run_ssh(host, port, remote_cmd, stdin_bytes=content_bytes, timeout_seconds=timeout_seconds)


def tmsh_escape(value):
    text = str(value)
    return text.replace("\\", "\\\\").replace("\"", "\\\"")


def build_records_block(records):
    parts = []
    for key, value in sorted(records.items()):
        parts.append(f"\"{tmsh_escape(key)}\" {{ data \"{tmsh_escape(value)}\" }}")
    return " ".join(parts)


def parse_data_group_records(one_line_output):
    pattern = re.compile(
        r'("([^"\\\\]|\\\\.)+"|[^\s{}]+)\s+\{\s+data\s+("((?:[^"\\\\]|\\\\.)*)"|[^\s{}]+)\s+\}'
    )
    records = {}
    for match in pattern.finditer(one_line_output):
        raw_key = match.group(1)
        raw_value = match.group(3)
        key = raw_key[1:-1] if raw_key.startswith('"') and raw_key.endswith('"') else raw_key
        key = key.replace('\\"', '"').replace("\\\\", "\\")
        if raw_value.startswith('"') and raw_value.endswith('"'):
            value = raw_value[1:-1]
        else:
            value = raw_value
        value = value.replace('\\"', '"').replace("\\\\", "\\")
        records[key] = value
    return records


def maybe_backup_object(host, port, object_cmd, backup_path, timeout_seconds=DEFAULT_SSH_TIMEOUT_SECONDS):
    backup_path.parent.mkdir(parents=True, exist_ok=True)
    try:
        stdout, _stderr = run_ssh(host, port, f"{object_cmd} || true", timeout_seconds=timeout_seconds)
        backup_path.write_text(stdout, encoding="utf-8")
    except RuntimeError as exc:
        backup_path.write_text(f"backup_error={exc}\n", encoding="utf-8")


def parse_ifile_source_paths(one_line_output):
    matches = re.findall(r"sys file ifile ([^\s{]+) \{[^}]*source-path file:([^\s}]+)", one_line_output)
    parsed = {}
    for name, source_path in matches:
        full_name = name if name.startswith("/") else f"/Common/{name}"
        parsed[full_name] = f"file:{source_path}"
    return parsed


def utc_now():
    return dt.datetime.now(dt.timezone.utc).replace(microsecond=0).isoformat().replace("+00:00", "Z")


def resolve_expected_ifile_paths(artifacts, snapshot, remote_native_dir):
    expected = {}
    for item in (artifacts.get("ifiles") or {}).values():
        name = item["name"]
        remote_tmp = f"{remote_native_dir.rstrip('/')}/{name.split('/')[-1]}.json"
        expected[name] = f"file:{remote_tmp}"
    snapshot_name = ((snapshot.get("config") or {}).get("nativeObjects") or {}).get("ifiles", {}).get("config_snapshot", "")
    if snapshot_name:
        remote_tmp = f"{remote_native_dir.rstrip('/')}/{snapshot_name.split('/')[-1]}.json"
        expected[snapshot_name] = f"file:{remote_tmp}"
    return expected


def collect_remote_state(host, port, artifacts, snapshot, timeout_seconds):
    listener_refs_name = artifacts["data_groups"]["listener_refs"]["name"]
    listener_settings_name = artifacts["data_groups"]["listener_settings"]["name"]
    expected_ifile_paths = resolve_expected_ifile_paths(artifacts, snapshot, "/var/placeholder")

    refs_stdout, _ = run_ssh(host, port, f"tmsh list ltm data-group internal {shlex.quote(listener_refs_name)} one-line || true", timeout_seconds=timeout_seconds)
    settings_stdout, _ = run_ssh(
        host, port, f"tmsh list ltm data-group internal {shlex.quote(listener_settings_name)} one-line || true", timeout_seconds=timeout_seconds
    )
    ifile_names = " ".join(shlex.quote(name) for name in sorted(expected_ifile_paths))
    ifiles_stdout, _ = run_ssh(host, port, f"tmsh list sys file ifile {ifile_names} one-line || true", timeout_seconds=timeout_seconds)
    return {
        "data_groups": {
            listener_refs_name: parse_data_group_records(refs_stdout),
            listener_settings_name: parse_data_group_records(settings_stdout),
        },
        "ifiles": parse_ifile_source_paths(ifiles_stdout),
    }


def build_diff_report(artifacts, snapshot, listener_settings_records, remote_native_dir, remote_state):
    listener_refs_name = artifacts["data_groups"]["listener_refs"]["name"]
    listener_settings_name = artifacts["data_groups"]["listener_settings"]["name"]
    expected_ifile_paths = resolve_expected_ifile_paths(artifacts, snapshot, remote_native_dir)

    diff = {
        "data_groups": {},
        "ifiles": {},
    }

    expected_refs = artifacts["data_groups"]["listener_refs"]["records"]
    actual_refs = (remote_state.get("data_groups") or {}).get(listener_refs_name, {})
    for key in sorted(set(expected_refs) | set(actual_refs)):
        if expected_refs.get(key) != actual_refs.get(key):
            diff["data_groups"].setdefault(listener_refs_name, []).append(
                {"key": key, "current": actual_refs.get(key), "desired": expected_refs.get(key)}
            )

    actual_settings = (remote_state.get("data_groups") or {}).get(listener_settings_name, {})
    for key in sorted(set(listener_settings_records) | set(actual_settings)):
        if listener_settings_records.get(key) != actual_settings.get(key):
            diff["data_groups"].setdefault(listener_settings_name, []).append(
                {"key": key, "current": actual_settings.get(key), "desired": listener_settings_records.get(key)}
            )

    actual_ifiles = remote_state.get("ifiles") or {}
    for name in sorted(set(expected_ifile_paths) | set(actual_ifiles)):
        if expected_ifile_paths.get(name) != actual_ifiles.get(name):
            diff["ifiles"][name] = {
                "current": actual_ifiles.get(name),
                "desired": expected_ifile_paths.get(name),
            }

    diff["changed_object_count"] = sum(len(v) for v in diff["data_groups"].values()) + len(diff["ifiles"])
    return diff


def write_json_file(path, payload):
    resolved = Path(path).resolve()
    resolved.parent.mkdir(parents=True, exist_ok=True)
    resolved.write_text(json.dumps(payload, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    return resolved


def build_publish_manifest(canonical_path, artifacts_path, snapshot_path, backup_dir, host, port, diff_report, verification=None):
    verification = verification or {}
    return {
        "schema": "f5-ai-gateway.publish-manifest/v1",
        "generated_at_utc": utc_now(),
        "target": {
            "bigip_host": host or "",
            "bigip_port": port or 0,
        },
        "inputs": {
            "canonical": str(Path(canonical_path).resolve()),
            "artifacts": str(Path(artifacts_path).resolve()),
            "snapshot": str(Path(snapshot_path).resolve()),
            "backup_dir": str(Path(backup_dir).resolve()),
            "canonical_sha256": f"sha256:{sha256_file(canonical_path)}",
            "artifacts_sha256": f"sha256:{sha256_file(artifacts_path)}",
            "snapshot_sha256": f"sha256:{sha256_file(snapshot_path)}",
        },
        "diff": diff_report,
        "desired_state": verification.get("desired_state") or {},
        "remote_state": verification.get("remote_state") or {},
        "verification": {
            "mode": verification.get("mode", ""),
            "status": verification.get("status", ""),
            "changed_object_count": diff_report.get("changed_object_count", 0),
            "listener_refs_verified": verification.get("listener_refs_verified"),
            "listener_settings_verified": verification.get("listener_settings_verified"),
            "ifiles_verified": verification.get("ifiles_verified"),
            "notes": verification.get("notes") or [],
            "rollback_plan": verification.get("rollback_plan", ""),
        },
    }


def summarize_expected_state(artifacts, listener_settings_records, expected_ifile_paths):
    listener_refs_records = artifacts["data_groups"]["listener_refs"]["records"]
    return {
        "listener_refs": {
            "object": artifacts["data_groups"]["listener_refs"]["name"],
            "record_count": len(listener_refs_records),
            "records_sha256": f"sha256:{sha256_json(listener_refs_records)}",
        },
        "listener_settings": {
            "object": artifacts["data_groups"]["listener_settings"]["name"],
            "record_count": len(listener_settings_records),
            "records_sha256": f"sha256:{sha256_json(listener_settings_records)}",
        },
        "ifiles": {
            name: {
                "source_path": expected_source,
                "source_path_sha256": f"sha256:{sha256_json({'source_path': expected_source})}",
            }
            for name, expected_source in sorted(expected_ifile_paths.items())
        },
    }


def summarize_remote_state(artifacts, remote_state):
    listener_refs_name = artifacts["data_groups"]["listener_refs"]["name"]
    listener_settings_name = artifacts["data_groups"]["listener_settings"]["name"]
    refs = (remote_state.get("data_groups") or {}).get(listener_refs_name, {})
    settings = (remote_state.get("data_groups") or {}).get(listener_settings_name, {})
    ifiles = remote_state.get("ifiles") or {}
    return {
        "listener_refs": {
            "object": listener_refs_name,
            "record_count": len(refs),
            "records_sha256": f"sha256:{sha256_json(refs)}",
        },
        "listener_settings": {
            "object": listener_settings_name,
            "record_count": len(settings),
            "records_sha256": f"sha256:{sha256_json(settings)}",
        },
        "ifiles": {
            name: {
                "source_path": current_source,
                "source_path_sha256": f"sha256:{sha256_json({'source_path': current_source})}",
            }
            for name, current_source in sorted(ifiles.items())
        },
    }


def verify_listener_data_groups(host, port, artifacts, expected_listener_settings_records):
    listener_refs_name = artifacts["data_groups"]["listener_refs"]["name"]
    listener_settings_name = artifacts["data_groups"]["listener_settings"]["name"]
    refs_stdout, _ = run_ssh(host, port, f"tmsh list ltm data-group internal {shlex.quote(listener_refs_name)} one-line")
    settings_stdout, _ = run_ssh(host, port, f"tmsh list ltm data-group internal {shlex.quote(listener_settings_name)} one-line")
    actual_refs = parse_data_group_records(refs_stdout)
    actual_settings = parse_data_group_records(settings_stdout)
    expected_refs = artifacts["data_groups"]["listener_refs"]["records"]

    for key, value in expected_refs.items():
        if actual_refs.get(key) != value:
            raise RuntimeError(
                f"listener_refs verification failed for key '{key}': expected '{value}', got '{actual_refs.get(key, '')}'"
            )
    for key, value in expected_listener_settings_records.items():
        if actual_settings.get(key) != value:
            raise RuntimeError(
                f"listener_settings verification failed for key '{key}': expected '{value}', got '{actual_settings.get(key, '')}'"
            )


def verify_ifile_source_paths(host, port, expected_ifile_paths):
    listed_names = " ".join(shlex.quote(name) for name in sorted(expected_ifile_paths))
    stdout, _ = run_ssh(host, port, f"tmsh list sys file ifile {listed_names} one-line")
    actual = parse_ifile_source_paths(stdout)
    for name, expected_source in sorted(expected_ifile_paths.items()):
        if actual.get(name) != expected_source:
            raise RuntimeError(
                f"iFile verification failed for '{name}': expected '{expected_source}', got '{actual.get(name, '')}'"
            )


def render_outputs(canonical_path, artifacts_path, snapshot_path):
    config, canonical_resolved = load_json(canonical_path)
    validation = validate_canonical_config(config)
    if validation["errors"]:
        for item in validation["errors"]:
            print(f"validation_error={item}")
        raise SystemExit(1)
    for item in validation["warnings"]:
        print(f"validation_warning={item}")
    artifacts = build_native_artifacts(config, canonical_resolved.name)
    snapshot = build_snapshot(config, canonical_resolved.name)

    artifacts_resolved = Path(artifacts_path).resolve()
    snapshot_resolved = Path(snapshot_path).resolve()

    artifacts_resolved.write_text(json.dumps(artifacts, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    snapshot_resolved.write_text(json.dumps(snapshot, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    write_local_native_files(config, artifacts, snapshot, canonical_resolved.parent)
    return config, artifacts, snapshot, artifacts_resolved, snapshot_resolved


def resolve_listener_settings_records(artifacts, existing_records):
    records = dict(artifacts["data_groups"]["listener_settings"]["records"])
    publish_hints = artifacts["data_groups"]["listener_settings"].get("publish_hints") or {}

    for key, hint in sorted(publish_hints.items()):
        if hint.get("strategy") == "bearer_from_env":
            env_name = hint.get("env_name", "")
            env_value = os.environ.get(env_name, "")
            if env_value:
                records[key] = env_value if env_value.startswith("Bearer ") else f"Bearer {env_value}"
                continue
            if hint.get("preserve_existing_if_missing") and key in existing_records:
                records[key] = existing_records[key]
                continue
    return records


def publish_to_bigip(host, port, config, artifacts, snapshot, backup_dir, remote_native_dir, ssh_timeout_seconds):
    backup_root = Path(backup_dir).resolve()

    listener_refs_name = artifacts["data_groups"]["listener_refs"]["name"]
    listener_settings_name = artifacts["data_groups"]["listener_settings"]["name"]

    maybe_backup_object(
        host,
        port,
        f"tmsh list ltm data-group internal {shlex.quote(listener_refs_name)} one-line",
        backup_root / "listener_refs.tmsh.txt",
        timeout_seconds=ssh_timeout_seconds,
    )
    maybe_backup_object(
        host,
        port,
        f"tmsh list ltm data-group internal {shlex.quote(listener_settings_name)} one-line",
        backup_root / "listener_settings.tmsh.txt",
        timeout_seconds=ssh_timeout_seconds,
    )

    existing_listener_settings_stdout, _ = run_ssh(
        host, port, f"tmsh list ltm data-group internal {shlex.quote(listener_settings_name)} one-line || true", timeout_seconds=ssh_timeout_seconds
    )
    existing_listener_settings = parse_data_group_records(existing_listener_settings_stdout)

    listener_refs_block = build_records_block(artifacts["data_groups"]["listener_refs"]["records"])
    listener_settings_records = resolve_listener_settings_records(artifacts, existing_listener_settings)
    listener_settings_block = build_records_block(listener_settings_records)

    dg_script = f"""
if tmsh list ltm data-group internal {shlex.quote(listener_refs_name)} >/dev/null 2>&1; then
  tmsh modify ltm data-group internal {shlex.quote(listener_refs_name)} records replace-all-with {{ {listener_refs_block} }}
else
  tmsh create ltm data-group internal {shlex.quote(listener_refs_name)} type string records add {{ {listener_refs_block} }}
fi
if tmsh list ltm data-group internal {shlex.quote(listener_settings_name)} >/dev/null 2>&1; then
  tmsh modify ltm data-group internal {shlex.quote(listener_settings_name)} records replace-all-with {{ {listener_settings_block} }}
else
  tmsh create ltm data-group internal {shlex.quote(listener_settings_name)} type string records add {{ {listener_settings_block} }}
fi
tmsh save sys config
""".strip()
    run_ssh(host, port, dg_script, timeout_seconds=ssh_timeout_seconds)

    ifiles = artifacts["ifiles"]
    expected_ifile_paths = {}
    for key, item in sorted(ifiles.items()):
        name = item["name"]
        backup_path = backup_root / f"{key}.tmsh.txt"
        maybe_backup_object(
            host,
            port,
            f"tmsh list sys file ifile {shlex.quote(name)} one-line",
            backup_path,
            timeout_seconds=ssh_timeout_seconds,
        )
        remote_tmp = f"{remote_native_dir.rstrip('/')}/{name.split('/')[-1]}.json"
        run_ssh(host, port, f"mkdir -p {shlex.quote(remote_native_dir)}", timeout_seconds=ssh_timeout_seconds)
        upload_via_ssh(
            host,
            port,
            (json.dumps(item["content"], ensure_ascii=False, indent=2) + "\n").encode("utf-8"),
            remote_tmp,
            timeout_seconds=ssh_timeout_seconds,
        )
        cmd = f"""
if tmsh list sys file ifile {shlex.quote(name)} >/dev/null 2>&1; then
  tmsh modify sys file ifile {shlex.quote(name)} source-path file:{remote_tmp}
else
  tmsh create sys file ifile {shlex.quote(name)} source-path file:{remote_tmp}
fi
tmsh save sys config
""".strip()
        run_ssh(host, port, cmd, timeout_seconds=ssh_timeout_seconds)
        expected_ifile_paths[name] = f"file:{remote_tmp}"

    snapshot_name = ((snapshot.get("config") or {}).get("nativeObjects") or {}).get("ifiles", {}).get("config_snapshot", "")
    if snapshot_name:
        backup_path = backup_root / "config_snapshot.tmsh.txt"
        maybe_backup_object(
            host,
            port,
            f"tmsh list sys file ifile {shlex.quote(snapshot_name)} one-line",
            backup_path,
            timeout_seconds=ssh_timeout_seconds,
        )
        remote_tmp = f"{remote_native_dir.rstrip('/')}/{snapshot_name.split('/')[-1]}.json"
        run_ssh(host, port, f"mkdir -p {shlex.quote(remote_native_dir)}", timeout_seconds=ssh_timeout_seconds)
        upload_via_ssh(
            host,
            port,
            (json.dumps(snapshot, ensure_ascii=False, indent=2) + "\n").encode("utf-8"),
            remote_tmp,
            timeout_seconds=ssh_timeout_seconds,
        )
        cmd = f"""
if tmsh list sys file ifile {shlex.quote(snapshot_name)} >/dev/null 2>&1; then
  tmsh modify sys file ifile {shlex.quote(snapshot_name)} source-path file:{remote_tmp}
else
  tmsh create sys file ifile {shlex.quote(snapshot_name)} source-path file:{remote_tmp}
fi
tmsh save sys config
""".strip()
        run_ssh(host, port, cmd, timeout_seconds=ssh_timeout_seconds)
        expected_ifile_paths[snapshot_name] = f"file:{remote_tmp}"

    verify_listener_data_groups(host, port, artifacts, listener_settings_records)
    verify_ifile_source_paths(host, port, expected_ifile_paths)
    return {
        "listener_settings_records": listener_settings_records,
        "expected_ifile_paths": expected_ifile_paths,
    }


def main():
    parser = argparse.ArgumentParser(
        description="Render canonical gateway JSON and optionally publish Data Group/iFile artifacts to BIG-IP."
    )
    parser.add_argument("--canonical", default="gateway-config.canonical.json", help="Canonical JSON input path.")
    parser.add_argument(
        "--artifacts-output",
        default="gateway-native-artifacts.json",
        help="Rendered native artifacts JSON output path.",
    )
    parser.add_argument(
        "--snapshot-output",
        default="gateway-config.snapshot.json",
        help="Rendered snapshot JSON output path.",
    )
    parser.add_argument("--bigip-host", help="BIG-IP SSH host.")
    parser.add_argument("--bigip-port", type=int, default=22, help="BIG-IP SSH port.")
    parser.add_argument(
        "--ssh-timeout-seconds",
        type=int,
        default=DEFAULT_SSH_TIMEOUT_SECONDS,
        help="Timeout used for each individual SSH operation during publish and verify.",
    )
    parser.add_argument(
        "--backup-dir",
        default="publish-backups/latest",
        help="Local directory used to store pre-publish BIG-IP object listings.",
    )
    parser.add_argument(
        "--remote-native-dir",
        default="/var/ilx/workspaces/Common/llm_semantic_ws/extensions/llm_semantic_ext/native",
        help="Remote directory used as the persistent source-path backing files for BIG-IP iFiles.",
    )
    parser.add_argument("--publish", action="store_true", help="Publish rendered artifacts to BIG-IP.")
    parser.add_argument("--diff", action="store_true", help="Read remote BIG-IP object state and emit a diff report without publishing.")
    parser.add_argument(
        "--manifest-output",
        default="publish-backups/latest/publish-manifest.json",
        help="Path to the publish manifest or diff manifest JSON output.",
    )
    parser.add_argument(
        "--diff-output",
        default="publish-backups/latest/publish-diff.json",
        help="Path to the rendered remote-vs-desired diff JSON output.",
    )
    args = parser.parse_args()

    _config, artifacts, snapshot, artifacts_path, snapshot_path = render_outputs(
        args.canonical, args.artifacts_output, args.snapshot_output
    )
    print(f"rendered_artifacts={artifacts_path}")
    print(f"rendered_snapshot={snapshot_path}")

    if args.diff:
        if not args.bigip_host:
            raise SystemExit("--diff requires --bigip-host")
        existing_listener_settings_stdout, _ = run_ssh(
            args.bigip_host,
            args.bigip_port,
            f"tmsh list ltm data-group internal {shlex.quote(artifacts['data_groups']['listener_settings']['name'])} one-line || true",
            timeout_seconds=args.ssh_timeout_seconds,
        )
        existing_listener_settings = parse_data_group_records(existing_listener_settings_stdout)
        desired_listener_settings = resolve_listener_settings_records(artifacts, existing_listener_settings)
        remote_state = collect_remote_state(args.bigip_host, args.bigip_port, artifacts, snapshot, args.ssh_timeout_seconds)
        diff_report = build_diff_report(
            artifacts,
            snapshot,
            desired_listener_settings,
            args.remote_native_dir,
            remote_state,
        )
        desired_state = summarize_expected_state(
            artifacts,
            desired_listener_settings,
            resolve_expected_ifile_paths(artifacts, snapshot, args.remote_native_dir),
        )
        remote_summary = summarize_remote_state(artifacts, remote_state)
        diff_path = write_json_file(args.diff_output, diff_report)
        manifest = build_publish_manifest(
            args.canonical,
            artifacts_path,
            snapshot_path,
            args.backup_dir,
            args.bigip_host,
            args.bigip_port,
            diff_report,
            verification={
                "mode": "diff_only",
                "status": "in_sync" if diff_report.get("changed_object_count", 0) == 0 else "drift_detected",
                "desired_state": desired_state,
                "remote_state": remote_summary,
                "notes": ["No remote objects were modified in diff mode."],
            },
        )
        manifest_path = write_json_file(args.manifest_output, manifest)
        print(f"diff_output={diff_path}")
        print(f"manifest_output={manifest_path}")

    if args.publish:
        if not args.bigip_host:
            raise SystemExit("--publish requires --bigip-host")
        publish_result = publish_to_bigip(
            args.bigip_host,
            args.bigip_port,
            _config,
            artifacts,
            snapshot,
            args.backup_dir,
            args.remote_native_dir,
            args.ssh_timeout_seconds,
        )
        remote_state = collect_remote_state(args.bigip_host, args.bigip_port, artifacts, snapshot, args.ssh_timeout_seconds)
        diff_report = build_diff_report(
            artifacts,
            snapshot,
            publish_result["listener_settings_records"],
            args.remote_native_dir,
            remote_state,
        )
        desired_state = summarize_expected_state(
            artifacts,
            publish_result["listener_settings_records"],
            publish_result["expected_ifile_paths"],
        )
        remote_summary = summarize_remote_state(artifacts, remote_state)
        diff_path = write_json_file(args.diff_output, diff_report)
        manifest = build_publish_manifest(
            args.canonical,
            artifacts_path,
            snapshot_path,
            args.backup_dir,
            args.bigip_host,
            args.bigip_port,
            diff_report,
            verification={
                "mode": "publish",
                "status": "verified" if diff_report.get("changed_object_count", 0) == 0 else "verification_failed",
                "listener_settings_records_count": len(publish_result["listener_settings_records"]),
                "ifile_count": len(publish_result["expected_ifile_paths"]),
                "listener_refs_verified": diff_report.get("changed_object_count", 0) == 0,
                "listener_settings_verified": diff_report.get("changed_object_count", 0) == 0,
                "ifiles_verified": diff_report.get("changed_object_count", 0) == 0,
                "desired_state": desired_state,
                "remote_state": remote_summary,
                "notes": ["Publish mode completed object verification after remote updates."],
            },
        )
        manifest_path = write_json_file(args.manifest_output, manifest)
        print(f"published_bigip={args.bigip_host}:{args.bigip_port}")
        print(f"backup_dir={Path(args.backup_dir).resolve()}")
        print(f"diff_output={diff_path}")
        print(f"manifest_output={manifest_path}")


if __name__ == "__main__":
    main()
