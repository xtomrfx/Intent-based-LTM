when RULE_INIT {
    set static::llm_semantic_plugin "/Common/llm_semantic_plugin"
    set static::llm_semantic_extension "llm_semantic_ext"
    set static::llm_semantic_max_payload 65535
    set static::llm_semantic_timeout_ms 3200
    set static::llm_semantic_service_name "f5-ai-gateway"
    set static::llm_semantic_dg_listener_refs "/Common/dg_ai_gateway_listener_refs"
    set static::llm_semantic_dg_listener_settings "/Common/dg_ai_gateway_listener_settings"
    set static::llm_semantic_dg_virtual_keys "/Common/dg_ai_gateway_virtual_keys"
    set static::llm_semantic_dg_virtual_key_pools "/Common/dg_ai_gateway_virtual_key_pools"
    set static::llm_semantic_dg_listener_vk_pool_allowlist "/Common/dg_ai_gateway_listener_vk_pool_allowlist"
    set static::llm_semantic_credential_cooldown_subtable "aito_credential_cooldown"
    set static::llm_semantic_credential_cooldown_seconds 30
    set static::llm_semantic_credential_auth_fail_cooldown_seconds 300
}

when HTTP_REQUEST {
    set llm_semantic_should_handle 0
    set llm_semantic_route_debug_headers 0
    set llm_semantic_path [HTTP::path]
    set llm_semantic_content_type [string tolower [HTTP::header value "Content-Type"]]
    set llm_semantic_request_id [HTTP::header value "x-request-id"]
    set llm_semantic_virtual_name [virtual name]
    set llm_semantic_virtual_name_bare [lindex [split $llm_semantic_virtual_name "/"] end]
    set llm_semantic_listener_ref ""
    set llm_semantic_lookup_value ""
    set llm_semantic_vk_tag ""
    set llm_semantic_vk_kid ""
    set llm_semantic_vk_pool ""
    array set llm_semantic_cfg [list \
        plugin $static::llm_semantic_plugin \
        extension $static::llm_semantic_extension \
        max_payload_bytes $static::llm_semantic_max_payload \
        decision_timeout_ms $static::llm_semantic_timeout_ms \
        default_public_model "" \
        service_name $static::llm_semantic_service_name \
        root_paths "/,/v1" \
        model_paths "/v1/models,/models,/model/list" \
        chat_paths "/v1/chat/completions,/chat/completions" \
        responses_paths "/v1/responses,/responses" \
        northbound_api_mode "OpenAI-compatible" \
        chat_completions_support "full" \
        responses_support "partial" \
        client_auth_type "none" \
    ]

    if { ![catch { class match -value -- $llm_semantic_virtual_name equals $static::llm_semantic_dg_listener_refs } llm_semantic_lookup_value] && $llm_semantic_lookup_value ne "" } {
        set llm_semantic_listener_ref $llm_semantic_lookup_value
    } elseif { $llm_semantic_virtual_name_bare ne "" && ![catch { class match -value -- $llm_semantic_virtual_name_bare equals $static::llm_semantic_dg_listener_refs } llm_semantic_lookup_value] && $llm_semantic_lookup_value ne "" } {
        set llm_semantic_listener_ref $llm_semantic_lookup_value
    }

    foreach llm_semantic_setting_name [array names llm_semantic_cfg] {
        set llm_semantic_lookup_value ""
        if { $llm_semantic_listener_ref ne "" } {
            set llm_semantic_setting_key "${llm_semantic_listener_ref}.${llm_semantic_setting_name}"
            if { ![catch { class match -value -- $llm_semantic_setting_key equals $static::llm_semantic_dg_listener_settings } llm_semantic_lookup_value] && $llm_semantic_lookup_value ne "" } {
                set llm_semantic_cfg($llm_semantic_setting_name) $llm_semantic_lookup_value
                continue
            }
        }
        if { ![catch { class match -value -- $llm_semantic_setting_name equals $static::llm_semantic_dg_listener_settings } llm_semantic_lookup_value] && $llm_semantic_lookup_value ne "" } {
            set llm_semantic_cfg($llm_semantic_setting_name) $llm_semantic_lookup_value
        }
    }

    set llm_semantic_cfg_plugin $llm_semantic_cfg(plugin)
    set llm_semantic_cfg_extension $llm_semantic_cfg(extension)
    set llm_semantic_cfg_max_payload $llm_semantic_cfg(max_payload_bytes)
    set llm_semantic_cfg_timeout_ms $llm_semantic_cfg(decision_timeout_ms)
    set llm_semantic_cfg_default_model $llm_semantic_cfg(default_public_model)
    set llm_semantic_cfg_service_name $llm_semantic_cfg(service_name)
    set llm_semantic_cfg_root_paths [split $llm_semantic_cfg(root_paths) ","]
    set llm_semantic_cfg_model_paths [split $llm_semantic_cfg(model_paths) ","]
    set llm_semantic_cfg_chat_paths [split $llm_semantic_cfg(chat_paths) ","]
    set llm_semantic_cfg_responses_paths [split $llm_semantic_cfg(responses_paths) ","]
    set llm_semantic_cfg_northbound_api_mode $llm_semantic_cfg(northbound_api_mode)
    set llm_semantic_cfg_chat_support $llm_semantic_cfg(chat_completions_support)
    set llm_semantic_cfg_responses_support $llm_semantic_cfg(responses_support)
    set llm_semantic_cfg_client_auth_type [string tolower $llm_semantic_cfg(client_auth_type)]

    set llm_semantic_is_root_path 0
    foreach llm_semantic_candidate_path $llm_semantic_cfg_root_paths {
        set llm_semantic_candidate_path [string trim $llm_semantic_candidate_path]
        if { $llm_semantic_candidate_path ne "" && $llm_semantic_path eq $llm_semantic_candidate_path } {
            set llm_semantic_is_root_path 1
            break
        }
    }

    set llm_semantic_is_model_path 0
    foreach llm_semantic_candidate_path $llm_semantic_cfg_model_paths {
        set llm_semantic_candidate_path [string trim $llm_semantic_candidate_path]
        if { $llm_semantic_candidate_path ne "" && $llm_semantic_path eq $llm_semantic_candidate_path } {
            set llm_semantic_is_model_path 1
            break
        }
    }

    set llm_semantic_is_chat_path 0
    foreach llm_semantic_candidate_path $llm_semantic_cfg_chat_paths {
        set llm_semantic_candidate_path [string trim $llm_semantic_candidate_path]
        if { $llm_semantic_candidate_path ne "" && $llm_semantic_path starts_with $llm_semantic_candidate_path } {
            set llm_semantic_is_chat_path 1
            break
        }
    }

    set llm_semantic_is_responses_path 0
    foreach llm_semantic_candidate_path $llm_semantic_cfg_responses_paths {
        set llm_semantic_candidate_path [string trim $llm_semantic_candidate_path]
        if { $llm_semantic_candidate_path ne "" && $llm_semantic_path starts_with $llm_semantic_candidate_path } {
            set llm_semantic_is_responses_path 1
            break
        }
    }

    STREAM::disable

    if { $llm_semantic_request_id eq "" } {
        set llm_semantic_request_id "irule-[clock clicks]"
    }

        if { [HTTP::method] eq "OPTIONS" && $llm_semantic_is_root_path } {
            HTTP::respond 204 noserver \
                "Allow" "GET, HEAD, OPTIONS" \
                "Content-Length" "0" \
                "X-Gateway-Request-Id" $llm_semantic_request_id
            return
        }

        if { [HTTP::method] eq "OPTIONS" && $llm_semantic_is_model_path } {
            HTTP::respond 204 noserver \
                "Allow" "GET, HEAD, OPTIONS" \
                "Content-Length" "0" \
                "X-Gateway-Request-Id" $llm_semantic_request_id
            return
        }

        if { [HTTP::method] eq "HEAD" && $llm_semantic_is_root_path } {
            HTTP::respond 200 noserver \
                "Content-Type" "application/json; charset=utf-8" \
                "Content-Length" "0" \
                "X-Gateway-Request-Id" $llm_semantic_request_id
            return
        }

        if { [HTTP::method] eq "HEAD" && $llm_semantic_is_model_path } {
            HTTP::respond 200 noserver \
                "Content-Type" "application/json; charset=utf-8" \
                "Content-Length" "0" \
                "X-Gateway-Request-Id" $llm_semantic_request_id
            return
        }

        if { [HTTP::method] eq "GET" && $llm_semantic_is_root_path } {
            set llm_semantic_status_body [string map [list \
                __SERVICE__ $llm_semantic_cfg_service_name \
                __API_MODE__ $llm_semantic_cfg_northbound_api_mode \
                __CHAT_SUPPORT__ $llm_semantic_cfg_chat_support \
                __RESPONSES_SUPPORT__ $llm_semantic_cfg_responses_support \
            ] {{"object":"gateway","status":"ok","service":"__SERVICE__","northbound_api_mode":"__API_MODE__","chat_completions_support":"__CHAT_SUPPORT__","responses_support":"__RESPONSES_SUPPORT__"}}]
            HTTP::respond 200 content $llm_semantic_status_body noserver \
                "Content-Type" "application/json; charset=utf-8" \
                "X-Gateway-Request-Id" $llm_semantic_request_id
            return
        }

    if { [HTTP::method] eq "GET" && $llm_semantic_is_model_path } {
        if { $llm_semantic_cfg_default_model eq "" } {
            set llm_semantic_models_body {{"object":"list","data":[]}}
        } else {
            set llm_semantic_models_body [string map [list __MODEL__ $llm_semantic_cfg_default_model __OWNER__ $llm_semantic_cfg_service_name] {{"object":"list","data":[{"id":"__MODEL__","object":"model","owned_by":"__OWNER__"}]}}]
        }
        HTTP::respond 200 content $llm_semantic_models_body noserver \
            "Content-Type" "application/json; charset=utf-8" \
            "X-Gateway-Request-Id" $llm_semantic_request_id
        return
    }

    if { $llm_semantic_is_model_path } {
        set llm_semantic_method_error_body {{"error":{"message":"Method not allowed for models endpoint.","type":"invalid_request_error","code":"method_not_allowed"}}}
        HTTP::respond 405 content $llm_semantic_method_error_body noserver \
            "Content-Type" "application/json; charset=utf-8" \
            "Allow" "GET, HEAD, OPTIONS" \
            "Connection" "close" \
            "X-Gateway-Request-Id" $llm_semantic_request_id
        return
    }

    if { [HTTP::method] eq "OPTIONS" && ( $llm_semantic_is_chat_path || $llm_semantic_is_responses_path ) } {
        HTTP::respond 204 noserver \
            "Allow" "POST, OPTIONS" \
            "Content-Length" "0" \
            "X-Gateway-Request-Id" $llm_semantic_request_id
        return
    }

    if { ( $llm_semantic_is_chat_path || $llm_semantic_is_responses_path ) && [HTTP::method] ne "POST" } {
        set llm_semantic_method_error_body {{"error":{"message":"Method not allowed for chat or responses endpoint.","type":"invalid_request_error","code":"method_not_allowed"}}}
        HTTP::respond 405 content $llm_semantic_method_error_body noserver \
            "Content-Type" "application/json; charset=utf-8" \
            "Allow" "POST, OPTIONS" \
            "Connection" "close" \
            "X-Gateway-Request-Id" $llm_semantic_request_id
        return
    }

    if { [HTTP::method] eq "POST" && ( $llm_semantic_is_chat_path || $llm_semantic_is_responses_path ) } {
        set llm_semantic_should_handle 1
    }

    if { !$llm_semantic_should_handle } {
        set llm_semantic_not_found_body {{"error":{"message":"Endpoint is not supported by this AI Gateway listener.","type":"invalid_request_error","code":"not_found"}}}
        HTTP::respond 404 content $llm_semantic_not_found_body noserver \
            "Content-Type" "application/json; charset=utf-8" \
            "Connection" "close" \
            "X-Gateway-Request-Id" $llm_semantic_request_id
        return
    }

    if { $llm_semantic_cfg_client_auth_type eq "virtual_key" } {
        set llm_semantic_auth_header [HTTP::header value "Authorization"]
        set llm_semantic_auth_token ""
        set llm_semantic_vk_tag ""
        set llm_semantic_vk_kid ""
        set llm_semantic_vk_secret ""
        set llm_semantic_vk_record ""
        set llm_semantic_vk_state ""
        set llm_semantic_vk_pool ""
        set llm_semantic_vk_pool_record ""
        set llm_semantic_vk_pool_state ""
        set llm_semantic_vk_alg ""
        set llm_semantic_vk_hash ""
        set llm_semantic_vk_listener_pool_key ""
        set llm_semantic_vk_listener_pool_authz ""

        if { ![regexp -nocase {^Bearer[[:space:]]+(.+)$} $llm_semantic_auth_header -> llm_semantic_auth_token] } {
            HTTP::respond 401 content {{"error":{"message":"Missing or invalid Virtual Key Authorization header.","type":"authentication_error","code":"virtual_key_required"}}} noserver \
                "Content-Type" "application/json; charset=utf-8" \
                "Connection" "close" \
                "WWW-Authenticate" "Bearer" \
                "X-Gateway-Request-Id" $llm_semantic_request_id
            return
        }

        if { ![regexp {^sk-aito-([A-Za-z0-9_-]+)\.([A-Za-z0-9_-]+)\.([A-Za-z0-9_-]+)$} $llm_semantic_auth_token -> llm_semantic_vk_tag llm_semantic_vk_kid llm_semantic_vk_secret] } {
            HTTP::respond 401 content {{"error":{"message":"Invalid Virtual Key format.","type":"authentication_error","code":"invalid_virtual_key"}}} noserver \
                "Content-Type" "application/json; charset=utf-8" \
                "Connection" "close" \
                "WWW-Authenticate" "Bearer" \
                "X-Gateway-Request-Id" $llm_semantic_request_id
            return
        }

        if { [catch { class match -value -- $llm_semantic_vk_kid equals $static::llm_semantic_dg_virtual_keys } llm_semantic_vk_record] || $llm_semantic_vk_record eq "" } {
            HTTP::respond 401 content {{"error":{"message":"Virtual Key was not found.","type":"authentication_error","code":"virtual_key_not_found"}}} noserver \
                "Content-Type" "application/json; charset=utf-8" \
                "Connection" "close" \
                "WWW-Authenticate" "Bearer" \
                "X-Gateway-Request-Id" $llm_semantic_request_id
            return
        }

        array unset llm_semantic_vk_meta
        array set llm_semantic_vk_meta [list state "" tag "" pool "" alg "" hash "" desc ""]
        foreach llm_semantic_vk_part [split $llm_semantic_vk_record ","] {
            set llm_semantic_vk_sep [string first "=" $llm_semantic_vk_part]
            if { $llm_semantic_vk_sep > 0 } {
                set llm_semantic_vk_meta([string range $llm_semantic_vk_part 0 [expr {$llm_semantic_vk_sep - 1}]]) [string range $llm_semantic_vk_part [expr {$llm_semantic_vk_sep + 1}] end]
            }
        }

        set llm_semantic_vk_state [string tolower $llm_semantic_vk_meta(state)]
        set llm_semantic_vk_pool $llm_semantic_vk_meta(pool)
        set llm_semantic_vk_alg [string tolower $llm_semantic_vk_meta(alg)]
        set llm_semantic_vk_hash [string tolower [string map [list "sha256:" ""] $llm_semantic_vk_meta(hash)]]

        if { $llm_semantic_vk_state ne "" && $llm_semantic_vk_state ne "enabled" } {
            HTTP::respond 403 content {{"error":{"message":"Virtual Key is disabled.","type":"authentication_error","code":"virtual_key_disabled"}}} noserver \
                "Content-Type" "application/json; charset=utf-8" \
                "Connection" "close" \
                "X-Gateway-Request-Id" $llm_semantic_request_id
            return
        }

        if { $llm_semantic_vk_meta(tag) ne "" && $llm_semantic_vk_meta(tag) ne $llm_semantic_vk_tag } {
            HTTP::respond 401 content {{"error":{"message":"Virtual Key tag mismatch.","type":"authentication_error","code":"virtual_key_tag_mismatch"}}} noserver \
                "Content-Type" "application/json; charset=utf-8" \
                "Connection" "close" \
                "WWW-Authenticate" "Bearer" \
                "X-Gateway-Request-Id" $llm_semantic_request_id
            return
        }

        if { $llm_semantic_vk_alg ne "sha256" || $llm_semantic_vk_hash eq "" } {
            HTTP::respond 401 content {{"error":{"message":"Virtual Key verifier is not available.","type":"authentication_error","code":"virtual_key_verifier_unavailable"}}} noserver \
                "Content-Type" "application/json; charset=utf-8" \
                "Connection" "close" \
                "WWW-Authenticate" "Bearer" \
                "X-Gateway-Request-Id" $llm_semantic_request_id
            return
        }

        if { [catch { binary scan [CRYPTO::hash -alg sha256 $llm_semantic_vk_secret] H* llm_semantic_vk_secret_hash } llm_semantic_vk_hash_error] || [string tolower $llm_semantic_vk_secret_hash] ne $llm_semantic_vk_hash } {
            HTTP::respond 401 content {{"error":{"message":"Virtual Key verification failed.","type":"authentication_error","code":"virtual_key_verification_failed"}}} noserver \
                "Content-Type" "application/json; charset=utf-8" \
                "Connection" "close" \
                "WWW-Authenticate" "Bearer" \
                "X-Gateway-Request-Id" $llm_semantic_request_id
            return
        }

        if { $llm_semantic_vk_pool eq "" || [catch { class match -value -- $llm_semantic_vk_pool equals $static::llm_semantic_dg_virtual_key_pools } llm_semantic_vk_pool_record] || $llm_semantic_vk_pool_record eq "" } {
            HTTP::respond 403 content {{"error":{"message":"Virtual Key Pool was not found.","type":"authorization_error","code":"virtual_key_pool_not_found"}}} noserver \
                "Content-Type" "application/json; charset=utf-8" \
                "Connection" "close" \
                "X-Gateway-Request-Id" $llm_semantic_request_id
            return
        }

        array unset llm_semantic_vk_pool_meta
        array set llm_semantic_vk_pool_meta [list state "" name "" desc ""]
        foreach llm_semantic_vk_pool_part [split $llm_semantic_vk_pool_record ","] {
            set llm_semantic_vk_pool_sep [string first "=" $llm_semantic_vk_pool_part]
            if { $llm_semantic_vk_pool_sep > 0 } {
                set llm_semantic_vk_pool_meta([string range $llm_semantic_vk_pool_part 0 [expr {$llm_semantic_vk_pool_sep - 1}]]) [string range $llm_semantic_vk_pool_part [expr {$llm_semantic_vk_pool_sep + 1}] end]
            }
        }

        set llm_semantic_vk_pool_state [string tolower $llm_semantic_vk_pool_meta(state)]
        if { $llm_semantic_vk_pool_state ne "" && $llm_semantic_vk_pool_state ne "enabled" } {
            HTTP::respond 403 content {{"error":{"message":"Virtual Key Pool is disabled.","type":"authorization_error","code":"virtual_key_pool_disabled"}}} noserver \
                "Content-Type" "application/json; charset=utf-8" \
                "Connection" "close" \
                "X-Gateway-Request-Id" $llm_semantic_request_id
            return
        }

        if { $llm_semantic_listener_ref ne "" && $llm_semantic_vk_pool ne "" } {
            set llm_semantic_vk_listener_pool_key "${llm_semantic_listener_ref}~${llm_semantic_vk_pool}"
        }

        if { $llm_semantic_vk_listener_pool_key eq "" || [catch { class match -value -- $llm_semantic_vk_listener_pool_key equals $static::llm_semantic_dg_listener_vk_pool_allowlist } llm_semantic_vk_listener_pool_authz] || $llm_semantic_vk_listener_pool_authz eq "" } {
            HTTP::respond 403 content {{"error":{"message":"Virtual Key Pool is not authorized for this listener.","type":"authorization_error","code":"virtual_key_pool_forbidden"}}} noserver \
                "Content-Type" "application/json; charset=utf-8" \
                "Connection" "close" \
                "X-Gateway-Request-Id" $llm_semantic_request_id
            return
        }

        HTTP::header remove "Authorization"
    }

    if { [HTTP::header exists "Content-Length"] } {
        set llm_semantic_content_length [HTTP::header value "Content-Length"]
        if { $llm_semantic_content_length > 0 } {
            if { $llm_semantic_content_length > $llm_semantic_cfg_max_payload } {
                HTTP::collect $llm_semantic_cfg_max_payload
            } else {
                HTTP::collect $llm_semantic_content_length
            }
        } else {
            HTTP::collect $llm_semantic_cfg_max_payload
        }
    } else {
        HTTP::collect $llm_semantic_cfg_max_payload
    }
}

when HTTP_REQUEST_DATA {
    if { !$llm_semantic_should_handle } {
        return
    }

    set llm_semantic_payload [HTTP::payload]
    set llm_semantic_payload_compact [string tolower $llm_semantic_payload]
    regsub -all {\s+} $llm_semantic_payload_compact "" llm_semantic_payload_compact
    set llm_semantic_stream 0
    if { [string first "\"stream\":true" $llm_semantic_payload_compact] >= 0 } {
        set llm_semantic_stream 1
    }
    set llm_semantic_upstream_host ""
    set llm_semantic_upstream_path ""
    set llm_semantic_auth_header ""
    set llm_semantic_upstream_body_b64 ""
    set llm_semantic_fallback_pool ""
    set llm_semantic_fallback_profile ""
    set llm_semantic_fallback_upstream_host ""
    set llm_semantic_fallback_upstream_path ""
    set llm_semantic_fallback_auth_header ""
    set llm_semantic_fallback_upstream_body_b64 ""
    set llm_semantic_fallback_backend_ref ""
    set llm_semantic_fallback_used 0
    set llm_semantic_credential_id ""
    set llm_semantic_primary_credential_id ""
    set llm_semantic_fallback_credential_id ""
    set llm_semantic_fallback_credential_auth_header ""
    set llm_semantic_credential_pool_ref ""
    set llm_semantic_credential_cooldown_seconds $static::llm_semantic_credential_cooldown_seconds
    set llm_semantic_primary_pool ""
    set llm_semantic_context_json ""
    if { [info exists llm_semantic_vk_kid] && $llm_semantic_vk_kid ne "" } {
        set llm_semantic_listener_ref_json [string map [list "\\" "\\\\" "\"" "\\\"" "\n" "\\n" "\r" "\\r" "\t" "\\t"] $llm_semantic_listener_ref]
        set llm_semantic_vk_kid_json [string map [list "\\" "\\\\" "\"" "\\\"" "\n" "\\n" "\r" "\\r" "\t" "\\t"] $llm_semantic_vk_kid]
        set llm_semantic_vk_tag_json [string map [list "\\" "\\\\" "\"" "\\\"" "\n" "\\n" "\r" "\\r" "\t" "\\t"] $llm_semantic_vk_tag]
        set llm_semantic_vk_pool_json [string map [list "\\" "\\\\" "\"" "\\\"" "\n" "\\n" "\r" "\\r" "\t" "\\t"] $llm_semantic_vk_pool]
        set llm_semantic_context_json "{\"listener_ref\":\"$llm_semantic_listener_ref_json\",\"virtual_key\":{\"kid\":\"$llm_semantic_vk_kid_json\",\"tag\":\"$llm_semantic_vk_tag_json\",\"pool_ref\":\"$llm_semantic_vk_pool_json\"}}"
    }

    set llm_semantic_rpc_ready 1
    if { [catch { ILX::init $llm_semantic_cfg_plugin $llm_semantic_cfg_extension } llm_semantic_rpc_handle] } {
        log local0.error "semantic decision init failed: $llm_semantic_rpc_handle"
        set llm_semantic_rpc_ready 0
    }

    if { !$llm_semantic_rpc_ready || [catch {
        if { $llm_semantic_context_json ne "" } {
            ILX::call $llm_semantic_rpc_handle -timeout $llm_semantic_cfg_timeout_ms "decideRoute" $llm_semantic_payload $llm_semantic_path $llm_semantic_content_type $llm_semantic_context_json
        } else {
            ILX::call $llm_semantic_rpc_handle -timeout $llm_semantic_cfg_timeout_ms "decideRoute" $llm_semantic_payload $llm_semantic_path $llm_semantic_content_type
        }
    } llm_semantic_result] } {
        if { $llm_semantic_rpc_ready } {
            log local0.error "semantic decision failed: $llm_semantic_result"
        }
        set llm_semantic_action "route"
        set llm_semantic_tag "unknown"
        set llm_semantic_confidence "0"
        set llm_semantic_source "decision_error"
        set llm_semantic_pool ""
        set llm_semantic_profile ""
        set llm_semantic_message ""
        set llm_semantic_public_model ""
    } else {
        set llm_semantic_fields [split $llm_semantic_result "\t"]
        set llm_semantic_action [string tolower [lindex $llm_semantic_fields 0]]
        set llm_semantic_tag [string tolower [lindex $llm_semantic_fields 1]]
        set llm_semantic_confidence [lindex $llm_semantic_fields 2]
        set llm_semantic_source [lindex $llm_semantic_fields 3]
        set llm_semantic_pool [lindex $llm_semantic_fields 4]
        set llm_semantic_profile [lindex $llm_semantic_fields 5]
        set llm_semantic_message [lindex $llm_semantic_fields 6]
        set llm_semantic_public_model [lindex $llm_semantic_fields 7]
        set llm_semantic_upstream_host [lindex $llm_semantic_fields 8]
        set llm_semantic_upstream_path [lindex $llm_semantic_fields 9]
        set llm_semantic_auth_header [lindex $llm_semantic_fields 10]
        set llm_semantic_upstream_body_b64 [lindex $llm_semantic_fields 11]
        set llm_semantic_fallback_pool [lindex $llm_semantic_fields 12]
        set llm_semantic_fallback_profile [lindex $llm_semantic_fields 13]
        set llm_semantic_fallback_upstream_host [lindex $llm_semantic_fields 14]
        set llm_semantic_fallback_upstream_path [lindex $llm_semantic_fields 15]
        set llm_semantic_fallback_auth_header [lindex $llm_semantic_fields 16]
        set llm_semantic_fallback_upstream_body_b64 [lindex $llm_semantic_fields 17]
        set llm_semantic_fallback_backend_ref [lindex $llm_semantic_fields 18]
        set llm_semantic_credential_id [lindex $llm_semantic_fields 19]
        set llm_semantic_fallback_credential_id [lindex $llm_semantic_fields 20]
        set llm_semantic_fallback_credential_auth_header [lindex $llm_semantic_fields 21]
        set llm_semantic_credential_cooldown_seconds [lindex $llm_semantic_fields 22]
        set llm_semantic_credential_pool_ref [lindex $llm_semantic_fields 23]

        if { $llm_semantic_action eq "" } {
            set llm_semantic_action "route"
        }
        if { $llm_semantic_tag eq "" } {
            set llm_semantic_tag "unknown"
        }
        if { $llm_semantic_public_model eq "" } {
            set llm_semantic_public_model $llm_semantic_cfg_default_model
        }
    }

    HTTP::header replace "X-Semantic-Tag" $llm_semantic_tag
    HTTP::header replace "X-Semantic-Action" $llm_semantic_action
    HTTP::header replace "X-Semantic-Confidence" $llm_semantic_confidence
    HTTP::header replace "X-Semantic-Source" $llm_semantic_source
    HTTP::header replace "X-Gateway-Request-Id" $llm_semantic_request_id
    HTTP::header replace "x-request-id" $llm_semantic_request_id

    if { $llm_semantic_action eq "bad_request" } {
        if { $llm_semantic_message eq "" } {
            set llm_semantic_message "Invalid JSON request body."
        }
        set llm_semantic_message_escaped [string map [list "\\" "\\\\" "\"" "\\\"" "\n" "\\n" "\r" "\\r" "\t" "\\t"] $llm_semantic_message]
        set llm_semantic_bad_request_body "{\"error\":{\"message\":\"$llm_semantic_message_escaped\",\"type\":\"invalid_request_error\",\"code\":\"invalid_json\"}}"
        HTTP::respond 400 content $llm_semantic_bad_request_body noserver \
            "Content-Type" "application/json; charset=utf-8" \
            "Connection" "close" \
            "X-Semantic-Tag" $llm_semantic_tag \
            "X-Semantic-Action" $llm_semantic_action \
            "X-Semantic-Confidence" $llm_semantic_confidence \
            "X-Semantic-Source" $llm_semantic_source \
            "X-Gateway-Request-Id" $llm_semantic_request_id
        return
    }

    if { $llm_semantic_action eq "respond" } {
        if { $llm_semantic_message eq "" } {
            set llm_semantic_message "\u8BF7\u6C42\u5DF2\u7531\u7B56\u7565\u62E6\u622A"
        }

        set llm_semantic_created [clock seconds]
        set llm_semantic_message_escaped [string map [list "\\" "\\\\" "\"" "\\\"" "\n" "\\n" "\r" "\\r" "\t" "\\t"] $llm_semantic_message]
        set llm_semantic_model_escaped [string map [list "\\" "\\\\" "\"" "\\\"" "\n" "\\n" "\r" "\\r" "\t" "\\t"] $llm_semantic_public_model]

        if { $llm_semantic_is_responses_path } {
            set llm_semantic_response_id "resp-[clock clicks]"
            set llm_semantic_item_id "msg-[clock clicks]"
            set llm_semantic_response_id_escaped [string map [list "\\" "\\\\" "\"" "\\\""] $llm_semantic_response_id]
            set llm_semantic_item_id_escaped [string map [list "\\" "\\\\" "\"" "\\\""] $llm_semantic_item_id]

            if { $llm_semantic_stream } {
                set llm_semantic_body ""
                append llm_semantic_body "event: response.created\n"
                append llm_semantic_body "data: {\"type\":\"response.created\",\"response\":{\"id\":\"$llm_semantic_response_id_escaped\",\"object\":\"response\",\"model\":\"$llm_semantic_model_escaped\",\"status\":\"in_progress\"}}\n\n"
                append llm_semantic_body "event: response.output_text.delta\n"
                append llm_semantic_body "data: {\"type\":\"response.output_text.delta\",\"response_id\":\"$llm_semantic_response_id_escaped\",\"item_id\":\"$llm_semantic_item_id_escaped\",\"output_index\":0,\"content_index\":0,\"delta\":\"$llm_semantic_message_escaped\"}\n\n"
                append llm_semantic_body "event: response.completed\n"
                append llm_semantic_body "data: {\"type\":\"response.completed\",\"response\":{\"id\":\"$llm_semantic_response_id_escaped\",\"object\":\"response\",\"model\":\"$llm_semantic_model_escaped\",\"status\":\"completed\"}}\n\n"
                append llm_semantic_body "data: \[DONE\]\n\n"
                HTTP::respond 200 content $llm_semantic_body noserver \
                    "Content-Type" "text/event-stream; charset=utf-8" \
                    "Cache-Control" "no-cache" \
                    "Connection" "close" \
                    "X-Semantic-Tag" $llm_semantic_tag \
                    "X-Model-Endpoint" "respond" \
                    "X-Gateway-Request-Id" $llm_semantic_request_id
            } else {
                set llm_semantic_body [string map [list \
                    __RID__ $llm_semantic_response_id_escaped \
                    __IID__ $llm_semantic_item_id_escaped \
                    __CREATED__ $llm_semantic_created \
                    __MODEL__ $llm_semantic_model_escaped \
                    __MESSAGE__ $llm_semantic_message_escaped \
                ] {
{"id":"__RID__","object":"response","created_at":__CREATED__,"status":"completed","model":"__MODEL__","output":[{"id":"__IID__","type":"message","role":"assistant","content":[{"type":"output_text","text":"__MESSAGE__","annotations":[]}]}],"usage":{}}
}]
                HTTP::respond 200 content $llm_semantic_body noserver \
                    "Content-Type" "application/json; charset=utf-8" \
                    "Connection" "close" \
                    "X-Semantic-Tag" $llm_semantic_tag \
                    "X-Model-Endpoint" "respond" \
                    "X-Gateway-Request-Id" $llm_semantic_request_id
            }
            return
        }

        set llm_semantic_chat_id "chatcmpl-[clock clicks]"
        set llm_semantic_chat_id_escaped [string map [list "\\" "\\\\" "\"" "\\\""] $llm_semantic_chat_id]

        if { $llm_semantic_stream } {
            set llm_semantic_body ""
            append llm_semantic_body "data: {\"id\":\"$llm_semantic_chat_id_escaped\",\"object\":\"chat.completion.chunk\",\"created\":$llm_semantic_created,\"model\":\"$llm_semantic_model_escaped\",\"choices\":\[{\"index\":0,\"delta\":{\"role\":\"assistant\",\"content\":\"\"},\"finish_reason\":null}\]}\n\n"
            append llm_semantic_body "data: {\"id\":\"$llm_semantic_chat_id_escaped\",\"object\":\"chat.completion.chunk\",\"created\":$llm_semantic_created,\"model\":\"$llm_semantic_model_escaped\",\"choices\":\[{\"index\":0,\"delta\":{\"content\":\"$llm_semantic_message_escaped\"},\"finish_reason\":null}\]}\n\n"
            append llm_semantic_body "data: {\"id\":\"$llm_semantic_chat_id_escaped\",\"object\":\"chat.completion.chunk\",\"created\":$llm_semantic_created,\"model\":\"$llm_semantic_model_escaped\",\"choices\":\[{\"index\":0,\"delta\":{},\"finish_reason\":\"stop\"}\]}\n\n"
            append llm_semantic_body "data: \[DONE\]\n\n"
            HTTP::respond 200 content $llm_semantic_body noserver \
                "Content-Type" "text/event-stream; charset=utf-8" \
                "Cache-Control" "no-cache" \
                "Connection" "close" \
                "X-Semantic-Tag" $llm_semantic_tag \
                "X-Model-Endpoint" "respond" \
                "X-Gateway-Request-Id" $llm_semantic_request_id
        } else {
            set llm_semantic_body [string map [list \
                __ID__ $llm_semantic_chat_id_escaped \
                __CREATED__ $llm_semantic_created \
                __MODEL__ $llm_semantic_model_escaped \
                __MESSAGE__ $llm_semantic_message_escaped \
            ] {
{"id":"__ID__","object":"chat.completion","created":__CREATED__,"model":"__MODEL__","choices":[{"index":0,"message":{"role":"assistant","content":"__MESSAGE__"},"finish_reason":"stop"}],"usage":{}}
}]
            HTTP::respond 200 content $llm_semantic_body noserver \
                "Content-Type" "application/json; charset=utf-8" \
                "Connection" "close" \
                "X-Semantic-Tag" $llm_semantic_tag \
                "X-Model-Endpoint" "respond" \
                "X-Gateway-Request-Id" $llm_semantic_request_id
        }
        return
    }

    set llm_semantic_primary_pool $llm_semantic_pool
    if { $llm_semantic_credential_id ne "" && $llm_semantic_fallback_credential_id ne "" && $llm_semantic_fallback_credential_auth_header ne "" } {
        set llm_semantic_credential_cooldown_scope $llm_semantic_upstream_host
        if { $llm_semantic_credential_pool_ref ne "" } {
            set llm_semantic_credential_cooldown_scope "${llm_semantic_credential_pool_ref}|${llm_semantic_upstream_host}"
        }
        set llm_semantic_primary_credential_cooldown_key "${llm_semantic_credential_cooldown_scope}|${llm_semantic_credential_id}"
        set llm_semantic_fallback_credential_cooldown_key "${llm_semantic_credential_cooldown_scope}|${llm_semantic_fallback_credential_id}"
        set llm_semantic_primary_credential_cooldown [table lookup -subtable $static::llm_semantic_credential_cooldown_subtable $llm_semantic_primary_credential_cooldown_key]
        set llm_semantic_fallback_credential_cooldown [table lookup -subtable $static::llm_semantic_credential_cooldown_subtable $llm_semantic_fallback_credential_cooldown_key]

        if { $llm_semantic_primary_credential_cooldown ne "" && $llm_semantic_fallback_credential_cooldown eq "" } {
            set llm_semantic_fallback_used 1
            set llm_semantic_auth_header $llm_semantic_fallback_credential_auth_header
            set llm_semantic_primary_credential_id $llm_semantic_credential_id
            set llm_semantic_credential_id $llm_semantic_fallback_credential_id
        }
    }

    if { $llm_semantic_fallback_pool ne "" && $llm_semantic_pool ne "" && $llm_semantic_fallback_pool ne $llm_semantic_pool && $llm_semantic_fallback_upstream_host ne "" && $llm_semantic_fallback_upstream_body_b64 ne "" } {
        if { ![catch { active_members $llm_semantic_pool } llm_semantic_primary_active] && [string is integer -strict $llm_semantic_primary_active] && $llm_semantic_primary_active <= 0 } {
            set llm_semantic_fallback_used 1
            set llm_semantic_pool $llm_semantic_fallback_pool
            if { $llm_semantic_fallback_profile ne "" } {
                set llm_semantic_profile $llm_semantic_fallback_profile
            }
            set llm_semantic_upstream_host $llm_semantic_fallback_upstream_host
            set llm_semantic_upstream_path $llm_semantic_fallback_upstream_path
            set llm_semantic_auth_header $llm_semantic_fallback_auth_header
            set llm_semantic_upstream_body_b64 $llm_semantic_fallback_upstream_body_b64
        }
    }

    if { $llm_semantic_pool eq "" || $llm_semantic_upstream_host eq "" || $llm_semantic_upstream_body_b64 eq "" } {
        set llm_semantic_error_body {{"error":{"message":"Gateway route is not available. Check routing policy and backend target configuration.","type":"gateway_error","code":"route_not_available"}}}
        HTTP::respond 503 content $llm_semantic_error_body noserver \
            "Content-Type" "application/json; charset=utf-8" \
            "Connection" "close" \
            "X-Semantic-Tag" $llm_semantic_tag \
            "X-Semantic-Action" $llm_semantic_action \
            "X-Semantic-Confidence" $llm_semantic_confidence \
            "X-Semantic-Source" $llm_semantic_source \
            "X-Semantic-Fallback" $llm_semantic_fallback_used \
            "X-Gateway-Request-Id" $llm_semantic_request_id
        return
    }

    HTTP::header replace "X-Gateway-Profile" $llm_semantic_profile
    HTTP::header replace "X-Public-Model" $llm_semantic_public_model
    HTTP::header replace "X-Model-Endpoint" $llm_semantic_pool

    if { $llm_semantic_upstream_host ne "" } {
        HTTP::header replace "Host" $llm_semantic_upstream_host
    }
    if { $llm_semantic_auth_header ne "" } {
        HTTP::header replace "Authorization" $llm_semantic_auth_header
    }
    if { $llm_semantic_upstream_path ne "" } {
        HTTP::uri $llm_semantic_upstream_path
    }
    HTTP::header remove "Connection"
    HTTP::header remove "Accept-Encoding"

    if { $llm_semantic_upstream_body_b64 ne "" } {
        set llm_semantic_upstream_body [b64decode $llm_semantic_upstream_body_b64]
        HTTP::payload replace 0 [HTTP::payload length] $llm_semantic_upstream_body
        HTTP::header replace "Content-Type" "application/json"
        HTTP::header replace "Content-Length" [HTTP::payload length]
    }

    set llm_semantic_route_debug_headers 1
        # Preserve OpenAI-compatible upstream response bodies exactly.
        # Model-field rewriting can corrupt tool arguments or structured JSON output.
    pool $llm_semantic_pool
    HTTP::release
}

    when SERVERSSL_CLIENTHELLO_SEND {
        if { [info exists llm_semantic_upstream_host] && $llm_semantic_upstream_host ne "" } {
            set llm_semantic_sni_host_len [string length $llm_semantic_upstream_host]
            set llm_semantic_sni_ext [binary format S1S1S1cS1a* 0 [expr {$llm_semantic_sni_host_len + 5}] [expr {$llm_semantic_sni_host_len + 3}] 0 $llm_semantic_sni_host_len $llm_semantic_upstream_host]
            SSL::extensions insert $llm_semantic_sni_ext
        }
    }

    when LB_FAILED {
        if { ![info exists llm_semantic_should_handle] || !$llm_semantic_should_handle } {
            return
        }

        set llm_semantic_error_body {{"error":{"message":"Gateway route failed before a backend connection was established. Check BIG-IP pool members, data-plane routing, and server-side TLS configuration.","type":"gateway_error","code":"route_connect_failed"}}}
        HTTP::respond 503 content $llm_semantic_error_body noserver \
            "Content-Type" "application/json; charset=utf-8" \
            "Connection" "close" \
            "X-Semantic-Tag" $llm_semantic_tag \
            "X-Semantic-Action" $llm_semantic_action \
            "X-Semantic-Confidence" $llm_semantic_confidence \
            "X-Semantic-Source" $llm_semantic_source \
            "X-Semantic-Fallback" $llm_semantic_fallback_used \
            "X-Gateway-Request-Id" $llm_semantic_request_id
    }

    when HTTP_RESPONSE {
        if { ![info exists llm_semantic_should_handle] || !$llm_semantic_should_handle } {
            return
        }

    if { [info exists llm_semantic_credential_id] && $llm_semantic_credential_id ne "" && [info exists llm_semantic_upstream_host] && $llm_semantic_upstream_host ne "" } {
        set llm_semantic_response_status [HTTP::status]
        if { ![string is integer -strict $llm_semantic_response_status] } {
            set llm_semantic_response_status 0
        }
        set llm_semantic_response_ttl 0
        set llm_semantic_retry_after [HTTP::header value "Retry-After"]
        set llm_semantic_credential_runtime_state "available"
        set llm_semantic_credential_failure_reason ""
        set llm_semantic_credential_cooldown_until_epoch 0
        set llm_semantic_response_credential_scope $llm_semantic_upstream_host
        if { [info exists llm_semantic_credential_pool_ref] && $llm_semantic_credential_pool_ref ne "" } {
            set llm_semantic_response_credential_scope "${llm_semantic_credential_pool_ref}|${llm_semantic_upstream_host}"
        }
        set llm_semantic_response_credential_key "${llm_semantic_response_credential_scope}|${llm_semantic_credential_id}"
        set llm_semantic_response_available_report_key "${llm_semantic_response_credential_key}|available_reported"
        set llm_semantic_credential_runtime_report 1

        if { $llm_semantic_response_status eq "401" || $llm_semantic_response_status eq "403" } {
            set llm_semantic_credential_runtime_state "auth_failed"
            set llm_semantic_response_ttl $static::llm_semantic_credential_auth_fail_cooldown_seconds
            set llm_semantic_credential_failure_reason $llm_semantic_response_status
            set llm_semantic_credential_cooldown_until_epoch [expr {[clock seconds] + $llm_semantic_response_ttl}]
            catch { table delete -subtable $static::llm_semantic_credential_cooldown_subtable $llm_semantic_response_available_report_key }
            table set -subtable $static::llm_semantic_credential_cooldown_subtable $llm_semantic_response_credential_key "auth_failure" $llm_semantic_response_ttl $llm_semantic_response_ttl
        } elseif { $llm_semantic_response_status eq "429" } {
            set llm_semantic_credential_runtime_state "rate_limited"
            set llm_semantic_response_ttl $static::llm_semantic_credential_cooldown_seconds
            if { [info exists llm_semantic_credential_cooldown_seconds] && [string is integer -strict $llm_semantic_credential_cooldown_seconds] && $llm_semantic_credential_cooldown_seconds > 0 } {
                set llm_semantic_response_ttl $llm_semantic_credential_cooldown_seconds
            }
            if { [string is integer -strict $llm_semantic_retry_after] && $llm_semantic_retry_after > 0 } {
                set llm_semantic_response_ttl $llm_semantic_retry_after
                set llm_semantic_credential_failure_reason "Retry-After ${llm_semantic_retry_after}s"
            } else {
                set llm_semantic_credential_failure_reason "429"
            }
            set llm_semantic_credential_cooldown_until_epoch [expr {[clock seconds] + $llm_semantic_response_ttl}]
            catch { table delete -subtable $static::llm_semantic_credential_cooldown_subtable $llm_semantic_response_available_report_key }
            table set -subtable $static::llm_semantic_credential_cooldown_subtable $llm_semantic_response_credential_key "rate_limited" $llm_semantic_response_ttl $llm_semantic_response_ttl
        } elseif { $llm_semantic_response_status >= 400 } {
            set llm_semantic_credential_runtime_state "unknown"
            set llm_semantic_credential_failure_reason $llm_semantic_response_status
            catch { table delete -subtable $static::llm_semantic_credential_cooldown_subtable $llm_semantic_response_available_report_key }
        } elseif { ![info exists llm_semantic_fallback_used] || !$llm_semantic_fallback_used } {
            if { [table lookup -subtable $static::llm_semantic_credential_cooldown_subtable $llm_semantic_response_available_report_key] ne "" } {
                set llm_semantic_credential_runtime_report 0
            } else {
                table set -subtable $static::llm_semantic_credential_cooldown_subtable $llm_semantic_response_available_report_key "available" 30 30
            }
        }

        if { $llm_semantic_credential_runtime_report && [info exists llm_semantic_credential_pool_ref] && $llm_semantic_credential_pool_ref ne "" } {
            set llm_semantic_credential_json_escape_map [list "\\" "\\\\" "\"" "\\\"" "\n" "\\n" "\r" "\\r" "\t" "\\t"]
            set llm_semantic_credential_pool_ref_json [string map $llm_semantic_credential_json_escape_map $llm_semantic_credential_pool_ref]
            set llm_semantic_credential_id_json [string map $llm_semantic_credential_json_escape_map $llm_semantic_credential_id]
            set llm_semantic_primary_credential_id_json [string map $llm_semantic_credential_json_escape_map $llm_semantic_primary_credential_id]
            set llm_semantic_credential_failure_reason_json [string map $llm_semantic_credential_json_escape_map $llm_semantic_credential_failure_reason]
            set llm_semantic_retry_after_json [string map $llm_semantic_credential_json_escape_map $llm_semantic_retry_after]
            set llm_semantic_upstream_host_json [string map $llm_semantic_credential_json_escape_map $llm_semantic_upstream_host]
            set llm_semantic_request_id_json [string map $llm_semantic_credential_json_escape_map $llm_semantic_request_id]
            set llm_semantic_credential_event_json "{\"credential_pool_ref\":\"$llm_semantic_credential_pool_ref_json\",\"credential_id\":\"$llm_semantic_credential_id_json\",\"primary_credential_id\":\"$llm_semantic_primary_credential_id_json\",\"status_code\":$llm_semantic_response_status,\"runtime_state\":\"$llm_semantic_credential_runtime_state\",\"last_failure\":\"$llm_semantic_credential_failure_reason_json\",\"retry_after\":\"$llm_semantic_retry_after_json\",\"cooldown_seconds\":$llm_semantic_response_ttl,\"cooldown_until_epoch\":$llm_semantic_credential_cooldown_until_epoch,\"upstream_host\":\"$llm_semantic_upstream_host_json\",\"fallback_used\":$llm_semantic_fallback_used,\"request_id\":\"$llm_semantic_request_id_json\"}"
            if { ![catch { ILX::init $llm_semantic_cfg_plugin $llm_semantic_cfg_extension } llm_semantic_credential_rpc_handle] } {
                catch { ILX::call $llm_semantic_credential_rpc_handle -timeout 750 "recordCredentialRuntime" $llm_semantic_credential_event_json }
            }
        }
    }

    if { ![info exists llm_semantic_route_debug_headers] || !$llm_semantic_route_debug_headers } {
        return
    }

    if { [info exists llm_semantic_tag] } {
        HTTP::header replace "X-Semantic-Tag" $llm_semantic_tag
    }
    if { [info exists llm_semantic_action] } {
        HTTP::header replace "X-Semantic-Action" $llm_semantic_action
    }
    if { [info exists llm_semantic_confidence] } {
        HTTP::header replace "X-Semantic-Confidence" $llm_semantic_confidence
    }
    if { [info exists llm_semantic_source] } {
        HTTP::header replace "X-Semantic-Source" $llm_semantic_source
    }
    if { [info exists llm_semantic_request_id] } {
        HTTP::header replace "X-Gateway-Request-Id" $llm_semantic_request_id
    }
    if { [info exists llm_semantic_profile] } {
        HTTP::header replace "X-Gateway-Profile" $llm_semantic_profile
    }
    if { [info exists llm_semantic_pool] } {
        HTTP::header replace "X-Model-Endpoint" $llm_semantic_pool
    }
    if { [info exists llm_semantic_public_model] } {
        HTTP::header replace "X-Public-Model" $llm_semantic_public_model
    }
    if { [info exists llm_semantic_fallback_used] } {
        HTTP::header replace "X-Semantic-Fallback" $llm_semantic_fallback_used
    }
    if { [info exists llm_semantic_fallback_used] && $llm_semantic_fallback_used && [info exists llm_semantic_primary_pool] } {
        HTTP::header replace "X-Primary-Model-Endpoint" $llm_semantic_primary_pool
    }
    if { [info exists llm_semantic_credential_id] && $llm_semantic_credential_id ne "" } {
        HTTP::header replace "X-Semantic-Credential" $llm_semantic_credential_id
    }
    if { [info exists llm_semantic_primary_credential_id] && $llm_semantic_primary_credential_id ne "" } {
        HTTP::header replace "X-Primary-Semantic-Credential" $llm_semantic_primary_credential_id
    }
}
