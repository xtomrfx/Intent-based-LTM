#!/usr/bin/env python3
import copy
import datetime as dt
import hashlib
import json
import re
from pathlib import Path
from urllib.parse import urlparse


DEFAULT_ILX_SETTINGS = {
    "plugin": "/Common/llm_semantic_plugin",
    "extension": "llm_semantic_ext",
    "service_name": "f5-ai-gateway",
}


def canonical_dump(value):
    return json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(",", ":"))


def checksum_hex(value):
    return hashlib.sha256(canonical_dump(value).encode("utf-8")).hexdigest()


def utc_now():
    return dt.datetime.now(dt.timezone.utc).replace(microsecond=0).isoformat().replace("+00:00", "Z")


def load_json(path):
    resolved = Path(path).resolve()
    with resolved.open("r", encoding="utf-8") as handle:
        return json.load(handle), resolved


def normalize_vs_name(name):
    if not name:
        return ""
    return name if name.startswith("/") else f"/Common/{name}"


def parse_endpoint(endpoint_url):
    parsed = urlparse(endpoint_url or "")
    default_port = 443 if parsed.scheme == "https" else 80
    return {
        "scheme": parsed.scheme or "https",
        "host": parsed.hostname or "",
        "port": parsed.port or default_port,
        "path": parsed.path or "/",
    }


def resolve_local_native_file_paths(config, root_dir):
    native_objects = config.get("nativeObjects") or {}
    local_files = native_objects.get("local_files") or native_objects.get("localFiles") or {}
    ifiles = native_objects.get("ifiles") or {}
    resolved = {}
    base_dir = Path(root_dir).resolve()

    for key in ("classifiers", "backend_targets", "routing_policies", "config_snapshot"):
        configured = local_files.get(key)
        if configured:
            path_value = Path(configured)
            resolved[key] = path_value if path_value.is_absolute() else (base_dir / path_value)
            continue
        if key == "config_snapshot":
            resolved[key] = base_dir / "native" / "ifile_ai_gateway_config_snapshot.json"
            continue
        ifile_name = Path((ifiles.get(key) or f"/Common/ifile_ai_gateway_{key}").split("/")[-1]).name
        resolved[key] = base_dir / "native" / f"{ifile_name}.json"

    return resolved


def get_active_listener_ref(config):
    runtime_ref = (config.get("runtime") or {}).get("listener_ref")
    if runtime_ref:
        return runtime_ref
    listeners = config.get("listeners") or {}
    return next(iter(listeners.keys()), "")


def get_listener(config, listener_ref):
    return copy.deepcopy((config.get("listeners") or {}).get(listener_ref) or {})


def get_policy(config, policy_ref):
    return copy.deepcopy((config.get("routingPolicies") or {}).get(policy_ref) or {})


def get_backend_target(config, backend_target_ref):
    return copy.deepcopy((config.get("backendTargets") or {}).get(backend_target_ref) or {})


def ensure_path_list(value, default_paths):
    if isinstance(value, list):
        items = [str(item).strip() for item in value if str(item).strip()]
        if items:
            return items
    return list(default_paths)


def resolve_listener_runtime_paths(listener):
    runtime_paths = listener.get("runtime_paths") or listener.get("runtimePaths") or {}
    status_block = listener.get("status") or {}
    supported_paths = status_block.get("supported_paths") or status_block.get("supportedPaths") or []
    supported_chat = [path for path in supported_paths if "chat/completions" in str(path)]
    supported_responses = [path for path in supported_paths if "responses" in str(path)]
    return {
        "root_paths": ensure_path_list(runtime_paths.get("root_paths") or runtime_paths.get("rootPaths"), ["/", "/v1"]),
        "model_paths": ensure_path_list(
            runtime_paths.get("model_paths") or runtime_paths.get("modelPaths"),
            ["/v1/models", "/models", "/model/list"],
        ),
        "chat_paths": ensure_path_list(runtime_paths.get("chat_paths") or runtime_paths.get("chatPaths"), supported_chat or ["/v1/chat/completions", "/chat/completions"]),
        "responses_paths": ensure_path_list(
            runtime_paths.get("responses_paths") or runtime_paths.get("responsesPaths"),
            supported_responses or ["/v1/responses", "/responses"],
        ),
    }


def build_summary(config):
    active_listener_ref = get_active_listener_ref(config)
    active_listener = get_listener(config, active_listener_ref)
    active_policy_ref = active_listener.get("policy_ref", "")
    active_classifier_ref = active_listener.get("classifier_ref", "")
    active_policy = get_policy(config, active_policy_ref)
    return {
        "operating_mode": config.get("operatingMode", ""),
        "active_listener_ref": active_listener_ref,
        "active_classifier_ref": active_classifier_ref,
        "active_routing_policy_ref": active_policy_ref,
        "listeners": sorted((config.get("listeners") or {}).keys()),
        "classifiers": sorted((config.get("classifiers") or {}).keys()),
        "backend_targets": sorted((config.get("backendTargets") or {}).keys()),
        "routing_policies": sorted((config.get("routingPolicies") or {}).keys()),
        "local_rule_count": len(config.get("localRules") or []),
        "active_routing_rule_count": len(active_policy.get("rules") or []),
    }


def validate_canonical_config(config):
    errors = []
    warnings = []

    operating_mode = config.get("operatingMode", "")
    if operating_mode not in ("gateway", "transparent"):
        errors.append("operatingMode must be either 'gateway' or 'transparent'.")

    listeners = config.get("listeners") or {}
    classifiers = config.get("classifiers") or {}
    backend_targets = config.get("backendTargets") or {}
    routing_policies = config.get("routingPolicies") or {}
    local_rules = config.get("localRules") or []

    if not listeners:
        errors.append("At least one listener must be defined in listeners.")
    if not classifiers:
        errors.append("At least one classifier must be defined in classifiers.")
    if not routing_policies:
        errors.append("At least one routing policy must be defined in routingPolicies.")

    runtime_listener_ref = ((config.get("runtime") or {}).get("listener_ref") or "").strip()
    if runtime_listener_ref and runtime_listener_ref not in listeners:
        errors.append(f"runtime.listener_ref '{runtime_listener_ref}' does not exist in listeners.")

    all_candidate_tags = set()
    for classifier_ref, classifier in sorted(classifiers.items()):
        classifier_type = classifier.get("classifier_type", "")
        schema_family = classifier.get("schema_family", "")
        endpoint_url = classifier.get("endpoint_url", "")
        endpoint = parse_endpoint(endpoint_url)
        candidate_tags = classifier.get("candidate_tags") or []
        fallback_tag = classifier.get("fallback_tag", "")

        if classifier_type not in ("classifier_llm", "classifier_nli"):
            errors.append(
                f"classifiers.{classifier_ref}.classifier_type must be 'classifier_llm' or 'classifier_nli'."
            )
        if not schema_family:
            errors.append(f"classifiers.{classifier_ref}.schema_family is required.")
        if not endpoint["host"]:
            errors.append(f"classifiers.{classifier_ref}.endpoint_url must include a valid host.")
        if not candidate_tags:
            errors.append(f"classifiers.{classifier_ref}.candidate_tags must not be empty.")
        if len(candidate_tags) != len(set(candidate_tags)):
            errors.append(f"classifiers.{classifier_ref}.candidate_tags contains duplicates.")
        if fallback_tag and fallback_tag not in candidate_tags:
            errors.append(f"classifiers.{classifier_ref}.fallback_tag must exist in candidate_tags.")

        all_candidate_tags.update(tag for tag in candidate_tags if isinstance(tag, str) and tag)

        if classifier_type == "classifier_llm":
            if not classifier.get("model_id"):
                errors.append(f"classifiers.{classifier_ref}.model_id is required for classifier_llm.")
            if not classifier.get("classifier_prompt"):
                errors.append(f"classifiers.{classifier_ref}.classifier_prompt is required for classifier_llm.")
        if classifier_type == "classifier_nli":
            if not classifier.get("hypothesis_template"):
                errors.append(
                    f"classifiers.{classifier_ref}.hypothesis_template is required for classifier_nli."
                )
            for field_name in ("min_confidence", "min_margin"):
                field_value = classifier.get(field_name)
                if field_value is None:
                    errors.append(f"classifiers.{classifier_ref}.{field_name} is required for classifier_nli.")
                elif not isinstance(field_value, (int, float)):
                    errors.append(f"classifiers.{classifier_ref}.{field_name} must be numeric.")

    for listener_ref, listener in sorted(listeners.items()):
        classifier_ref = listener.get("classifier_ref", "")
        policy_ref = listener.get("policy_ref", "")
        runtime_paths = resolve_listener_runtime_paths(listener)
        if not listener.get("virtual_service"):
            errors.append(f"listeners.{listener_ref}.virtual_service is required.")
        if classifier_ref and classifier_ref not in classifiers:
            errors.append(f"listeners.{listener_ref}.classifier_ref '{classifier_ref}' does not exist.")
        if policy_ref and policy_ref not in routing_policies:
            errors.append(f"listeners.{listener_ref}.policy_ref '{policy_ref}' does not exist.")
        for path_key, path_values in sorted(runtime_paths.items()):
            if not path_values:
                errors.append(f"listeners.{listener_ref}.{path_key} must not be empty.")

    for backend_ref, backend in sorted(backend_targets.items()):
        endpoint = parse_endpoint(backend.get("endpoint_url", ""))
        if not endpoint["host"]:
            errors.append(f"backendTargets.{backend_ref}.endpoint_url must include a valid host.")
        if not backend.get("model_id"):
            errors.append(f"backendTargets.{backend_ref}.model_id is required.")
        if not backend.get("pool_name"):
            errors.append(f"backendTargets.{backend_ref}.pool_name is required.")
        if backend.get("backend_prompt_mode", "append") not in ("append", "rewrite"):
            errors.append(f"backendTargets.{backend_ref}.backend_prompt_mode must be 'append' or 'rewrite'.")

    for policy_ref, policy in sorted(routing_policies.items()):
        policy_type = policy.get("policy_type", "")
        if policy_type not in ("routing", "orchestrator"):
            errors.append(f"routingPolicies.{policy_ref}.policy_type must be 'routing' or 'orchestrator'.")
            continue
        if policy_type == "orchestrator":
            continue

        default_rule = policy.get("default_rule") or {}
        default_action = default_rule.get("action", "")
        if default_action not in ("route", "respond"):
            errors.append(f"routingPolicies.{policy_ref}.default_rule.action must be 'route' or 'respond'.")
        if default_action == "route":
            backend_ref = default_rule.get("backend_target_ref", "")
            if backend_ref not in backend_targets:
                errors.append(
                    f"routingPolicies.{policy_ref}.default_rule.backend_target_ref '{backend_ref}' does not exist."
                )
        if default_action == "respond" and not default_rule.get("response_message"):
            warnings.append(
                f"routingPolicies.{policy_ref}.default_rule uses respond without response_message."
            )

        seen_enabled_tags = set()
        for index, rule in enumerate(policy.get("rules") or []):
            prefix = f"routingPolicies.{policy_ref}.rules[{index}]"
            source_tag = rule.get("source_tag", "")
            action = rule.get("action", "")
            enabled = rule.get("enabled", True)
            if not source_tag:
                errors.append(f"{prefix}.source_tag is required.")
            elif all_candidate_tags and source_tag not in all_candidate_tags:
                errors.append(f"{prefix}.source_tag '{source_tag}' does not exist in classifier candidate_tags.")
            if enabled:
                if source_tag in seen_enabled_tags:
                    errors.append(
                        f"{prefix}.source_tag '{source_tag}' duplicates another enabled rule in the same policy."
                    )
                seen_enabled_tags.add(source_tag)
            if action not in ("route", "respond"):
                errors.append(f"{prefix}.action must be 'route' or 'respond'.")
                continue
            if action == "route":
                backend_ref = rule.get("backend_target_ref", "")
                if backend_ref not in backend_targets:
                    errors.append(f"{prefix}.backend_target_ref '{backend_ref}' does not exist.")
            if action == "respond" and not rule.get("response_message"):
                warnings.append(f"{prefix}.action is respond but response_message is empty.")

    for index, rule in enumerate(local_rules):
        prefix = f"localRules[{index}]"
        pattern = rule.get("pattern", "")
        tag = rule.get("tag", "")
        if not pattern:
            errors.append(f"{prefix}.pattern is required.")
        else:
            try:
                re.compile(pattern)
            except re.error as exc:
                errors.append(f"{prefix}.pattern is not a valid regex: {exc}")
        if all_candidate_tags and tag not in all_candidate_tags:
            errors.append(f"{prefix}.tag '{tag}' does not exist in classifier candidate_tags.")

    return {"errors": errors, "warnings": warnings}


def build_snapshot(config, source_name):
    config_copy = copy.deepcopy(config)
    return {
        "schema": "f5-ai-gateway.snapshot/v1",
        "generated_at_utc": utc_now(),
        "source": {
            "canonical_file": source_name,
            "config_sha256": f"sha256:{checksum_hex(config_copy)}",
        },
        "summary": build_summary(config_copy),
        "native_objects": config_copy.get("nativeObjects", {}),
        "config": config_copy,
    }


def build_ifile_document(schema_name, source_name, config_sha, payload_key, payload_value):
    return {
        "schema": schema_name,
        "generated_at_utc": utc_now(),
        "source": {
            "canonical_file": source_name,
            "config_sha256": f"sha256:{config_sha}",
        },
        payload_key: copy.deepcopy(payload_value),
    }


def resolve_default_backend_target(config, listener):
    policy_ref = listener.get("policy_ref", "")
    policy = get_policy(config, policy_ref)
    default_rule = policy.get("default_rule") or {}
    backend_target_ref = default_rule.get("backend_target_ref", "")
    backend_target = get_backend_target(config, backend_target_ref)
    return policy, default_rule, backend_target_ref, backend_target


def resolve_listener_settings(config):
    native_objects = config.get("nativeObjects") or {}
    ilx_settings = DEFAULT_ILX_SETTINGS.copy()
    ilx_settings.update(copy.deepcopy((native_objects.get("ilx") or {})))
    records = {}
    publish_hints = {}

    for listener_ref, listener in sorted((config.get("listeners") or {}).items()):
        advanced = listener.get("advanced") or {}
        runtime_paths = resolve_listener_runtime_paths(listener)
        status_block = listener.get("status") or {}

        records[f"{listener_ref}.plugin"] = ilx_settings["plugin"]
        records[f"{listener_ref}.extension"] = ilx_settings["extension"]
        records[f"{listener_ref}.max_payload_bytes"] = str(advanced.get("max_payload_bytes", 65535))
        records[f"{listener_ref}.decision_timeout_ms"] = str(advanced.get("decision_timeout_ms", 3200))
        records[f"{listener_ref}.service_name"] = ilx_settings["service_name"]
        records[f"{listener_ref}.root_paths"] = ",".join(runtime_paths["root_paths"])
        records[f"{listener_ref}.model_paths"] = ",".join(runtime_paths["model_paths"])
        records[f"{listener_ref}.chat_paths"] = ",".join(runtime_paths["chat_paths"])
        records[f"{listener_ref}.responses_paths"] = ",".join(runtime_paths["responses_paths"])
        records[f"{listener_ref}.northbound_api_mode"] = str(status_block.get("northbound_api_mode", "OpenAI-compatible"))
        records[f"{listener_ref}.chat_completions_support"] = str(status_block.get("chat_completions_support", "full"))
        records[f"{listener_ref}.responses_support"] = str(status_block.get("responses_support", "partial"))

    return records, publish_hints


def build_native_artifacts(config, source_name):
    config_copy = copy.deepcopy(config)
    config_sha = checksum_hex(config_copy)
    native_objects = config_copy.get("nativeObjects") or {}
    data_groups = native_objects.get("data_groups") or {}
    ifiles = native_objects.get("ifiles") or {}
    listener_settings_records, publish_hints = resolve_listener_settings(config_copy)

    listener_refs_records = {}
    for listener_ref, listener in sorted((config_copy.get("listeners") or {}).items()):
        virtual_service = listener.get("virtual_service", "")
        if virtual_service:
            listener_refs_records[normalize_vs_name(virtual_service)] = listener_ref
            listener_refs_records[virtual_service] = listener_ref

    artifacts = {
        "schema": "f5-ai-gateway.native-artifacts/v1",
        "generated_at_utc": utc_now(),
        "source": {
            "canonical_file": source_name,
            "config_sha256": f"sha256:{config_sha}",
        },
        "summary": build_summary(config_copy),
        "data_groups": {
            "listener_refs": {
                "name": data_groups.get("listener_refs", "/Common/dg_ai_gateway_listener_refs"),
                "records": listener_refs_records,
            },
            "listener_settings": {
                "name": data_groups.get("listener_settings", "/Common/dg_ai_gateway_listener_settings"),
                "records": listener_settings_records,
                "publish_hints": publish_hints,
            },
        },
        "ifiles": {
            "classifiers": {
                "name": ifiles.get("classifiers", "/Common/ifile_ai_gateway_classifiers"),
                "content": build_ifile_document(
                    "f5-ai-gateway.classifiers/v1",
                    source_name,
                    config_sha,
                    "classifiers",
                    config_copy.get("classifiers") or {},
                ),
            },
            "backend_targets": {
                "name": ifiles.get("backend_targets", "/Common/ifile_ai_gateway_backend_targets"),
                "content": build_ifile_document(
                    "f5-ai-gateway.backend-targets/v1",
                    source_name,
                    config_sha,
                    "backendTargets",
                    config_copy.get("backendTargets") or {},
                ),
            },
            "routing_policies": {
                "name": ifiles.get("routing_policies", "/Common/ifile_ai_gateway_routing_policies"),
                "content": build_ifile_document(
                    "f5-ai-gateway.routing-policies/v1",
                    source_name,
                    config_sha,
                    "routingPolicies",
                    config_copy.get("routingPolicies") or {},
                ),
            },
        },
    }

    return artifacts


def write_local_native_files(config, artifacts, snapshot, root_dir):
    file_map = resolve_local_native_file_paths(config, root_dir)
    outputs = {}

    for key in ("classifiers", "backend_targets", "routing_policies"):
        target_path = file_map[key]
        target_path.parent.mkdir(parents=True, exist_ok=True)
        target_path.write_text(json.dumps(artifacts["ifiles"][key]["content"], ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
        outputs[key] = str(target_path)

    snapshot_path = file_map["config_snapshot"]
    snapshot_path.parent.mkdir(parents=True, exist_ok=True)
    snapshot_path.write_text(json.dumps(snapshot, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    outputs["config_snapshot"] = str(snapshot_path)
    return outputs
