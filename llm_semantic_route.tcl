when RULE_INIT {
    set static::llm_semantic_plugin "/Common/llm_semantic_plugin"
    set static::llm_semantic_extension "llm_semantic_ext"
    set static::llm_semantic_max_payload 65535
    set static::llm_semantic_timeout_ms 3200
    set static::llm_semantic_default_pool "pool_semantic_demo_default_direct"
    set static::llm_semantic_default_profile "general_assistant"
    set static::llm_semantic_default_model "gateway-demo"
    set static::llm_semantic_backend_host "api.deepseek.com"
    set static::llm_semantic_backend_auth "Bearer sk-c8463675a35543889717cb4c62c20ae4"
    set static::llm_semantic_backend_model "deepseek-chat"
}

when HTTP_REQUEST {
    set llm_semantic_should_handle 0
    set llm_semantic_route_debug_headers 0
    set llm_semantic_enable_model_rewrite 0
    set llm_semantic_path [HTTP::path]
    set llm_semantic_content_type [string tolower [HTTP::header value "Content-Type"]]
    set llm_semantic_request_id [HTTP::header value "x-request-id"]

    STREAM::disable

    if { $llm_semantic_request_id eq "" } {
        set llm_semantic_request_id "irule-[clock clicks]"
    }

        if { [HTTP::method] eq "OPTIONS" && ( $llm_semantic_path eq "/" || $llm_semantic_path eq "/v1" || $llm_semantic_path eq "/v1/models" || $llm_semantic_path eq "/models" || $llm_semantic_path eq "/model/list" ) } {
            HTTP::respond 204 noserver \
                "Allow" "GET, HEAD, OPTIONS, POST" \
                "Content-Length" "0" \
                "X-Gateway-Request-Id" $llm_semantic_request_id
            return
        }

        if { [HTTP::method] eq "HEAD" && ( $llm_semantic_path eq "/" || $llm_semantic_path eq "/v1" ) } {
            HTTP::respond 200 noserver \
                "Content-Type" "application/json" \
                "Content-Length" "0" \
                "X-Gateway-Request-Id" $llm_semantic_request_id
            return
        }

        if { [HTTP::method] eq "HEAD" && ( $llm_semantic_path eq "/v1/models" || $llm_semantic_path eq "/models" || $llm_semantic_path eq "/model/list" ) } {
            HTTP::respond 200 noserver \
                "Content-Type" "application/json" \
                "Content-Length" "0" \
                "X-Gateway-Request-Id" $llm_semantic_request_id
            return
        }

        if { [HTTP::method] eq "GET" && ( $llm_semantic_path eq "/" || $llm_semantic_path eq "/v1" ) } {
            HTTP::respond 200 content {{"object":"gateway","status":"ok","service":"f5-ai-gateway"}} noserver \
                "Content-Type" "application/json" \
                "X-Gateway-Request-Id" $llm_semantic_request_id
            return
        }

    if { [HTTP::method] eq "GET" && ( $llm_semantic_path eq "/v1/models" || $llm_semantic_path eq "/models" || $llm_semantic_path eq "/model/list" ) } {
        HTTP::respond 200 content {{"object":"list","data":[{"id":"testmodel","object":"model","owned_by":"f5-ai-gateway"}]}} noserver \
            "Content-Type" "application/json" \
            "X-Gateway-Request-Id" $llm_semantic_request_id
        return
    }

    if { [HTTP::method] eq "POST" && ( $llm_semantic_path starts_with "/v1/chat/completions" || $llm_semantic_path starts_with "/chat/completions" || $llm_semantic_path starts_with "/v1/responses" || $llm_semantic_path starts_with "/responses" ) } {
        set llm_semantic_should_handle 1
    }

    if { !$llm_semantic_should_handle } {
        return
    }

    if { [HTTP::header exists "Content-Length"] } {
        set llm_semantic_content_length [HTTP::header value "Content-Length"]
        if { $llm_semantic_content_length > 0 } {
            if { $llm_semantic_content_length > $static::llm_semantic_max_payload } {
                HTTP::collect $static::llm_semantic_max_payload
            } else {
                HTTP::collect $llm_semantic_content_length
            }
        } else {
            HTTP::collect $static::llm_semantic_max_payload
        }
    } else {
        HTTP::collect $static::llm_semantic_max_payload
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
    set llm_semantic_rpc_handle [ILX::init $static::llm_semantic_plugin $static::llm_semantic_extension]

    if { [catch { ILX::call $llm_semantic_rpc_handle -timeout $static::llm_semantic_timeout_ms "decideRoute" $llm_semantic_payload $llm_semantic_path $llm_semantic_content_type } llm_semantic_result] } {
        log local0.error "semantic decision failed: $llm_semantic_result"
        set llm_semantic_action "route"
        set llm_semantic_tag "unknown"
        set llm_semantic_confidence "0"
        set llm_semantic_source "decision_error"
        set llm_semantic_pool $static::llm_semantic_default_pool
        set llm_semantic_profile $static::llm_semantic_default_profile
        set llm_semantic_message ""
        set llm_semantic_public_model $static::llm_semantic_default_model
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

        if { $llm_semantic_action eq "" } {
            set llm_semantic_action "route"
        }
        if { $llm_semantic_tag eq "" } {
            set llm_semantic_tag "unknown"
        }
        if { $llm_semantic_pool eq "" } {
            set llm_semantic_pool $static::llm_semantic_default_pool
        }
        if { $llm_semantic_profile eq "" } {
            set llm_semantic_profile $static::llm_semantic_default_profile
        }
        if { $llm_semantic_public_model eq "" } {
            set llm_semantic_public_model $static::llm_semantic_default_model
        }
    }

    HTTP::header replace "X-Semantic-Tag" $llm_semantic_tag
    HTTP::header replace "X-Semantic-Action" $llm_semantic_action
    HTTP::header replace "X-Semantic-Confidence" $llm_semantic_confidence
    HTTP::header replace "X-Semantic-Source" $llm_semantic_source
    HTTP::header replace "X-Gateway-Request-Id" $llm_semantic_request_id
    HTTP::header replace "x-request-id" $llm_semantic_request_id

    if { $llm_semantic_action eq "respond" } {
        if { $llm_semantic_message eq "" } {
            set llm_semantic_message "\u8BF7\u6C42\u5DF2\u7531\u7B56\u7565\u62E6\u622A"
        }

        set llm_semantic_created [clock seconds]
        set llm_semantic_message_escaped [string map [list "\\" "\\\\" "\"" "\\\"" "\n" "\\n" "\r" "\\r" "\t" "\\t"] $llm_semantic_message]
        set llm_semantic_model_escaped [string map [list "\\" "\\\\" "\"" "\\\"" "\n" "\\n" "\r" "\\r" "\t" "\\t"] $llm_semantic_public_model]

        if { $llm_semantic_path starts_with "/v1/responses" || $llm_semantic_path starts_with "/responses" } {
            set llm_semantic_response_id "resp-[clock clicks]"
            set llm_semantic_item_id "msg-[clock clicks]"
            set llm_semantic_response_id_escaped [string map [list "\\" "\\\\" "\"" "\\\""] $llm_semantic_response_id]
            set llm_semantic_item_id_escaped [string map [list "\\" "\\\\" "\"" "\\\""] $llm_semantic_item_id]

            if { $llm_semantic_stream } {
                set llm_semantic_body [string map [list \
                    __RID__ $llm_semantic_response_id_escaped \
                    __IID__ $llm_semantic_item_id_escaped \
                    __MODEL__ $llm_semantic_model_escaped \
                    __MESSAGE__ $llm_semantic_message_escaped \
                ] {
event: response.created
data: {"type":"response.created","response":{"id":"__RID__","object":"response","model":"__MODEL__","status":"in_progress"}}

event: response.output_text.delta
data: {"type":"response.output_text.delta","response_id":"__RID__","item_id":"__IID__","output_index":0,"content_index":0,"delta":"__MESSAGE__"}

event: response.completed
data: {"type":"response.completed","response":{"id":"__RID__","object":"response","model":"__MODEL__","status":"completed"}}

data: [DONE]

}]
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
                    "Content-Type" "application/json" \
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
            set llm_semantic_body [string map [list \
                __ID__ $llm_semantic_chat_id_escaped \
                __CREATED__ $llm_semantic_created \
                __MODEL__ $llm_semantic_model_escaped \
                __MESSAGE__ $llm_semantic_message_escaped \
            ] {
data: {"id":"__ID__","object":"chat.completion.chunk","created":__CREATED__,"model":"__MODEL__","choices":[{"index":0,"delta":{"role":"assistant","content":""},"finish_reason":null}]}

data: {"id":"__ID__","object":"chat.completion.chunk","created":__CREATED__,"model":"__MODEL__","choices":[{"index":0,"delta":{"content":"__MESSAGE__"},"finish_reason":null}]}

data: {"id":"__ID__","object":"chat.completion.chunk","created":__CREATED__,"model":"__MODEL__","choices":[{"index":0,"delta":{},"finish_reason":"stop"}]}

data: [DONE]

}]
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
                "Content-Type" "application/json" \
                "Connection" "close" \
                "X-Semantic-Tag" $llm_semantic_tag \
                "X-Model-Endpoint" "respond" \
                "X-Gateway-Request-Id" $llm_semantic_request_id
        }
        return
    }

    HTTP::header replace "X-Gateway-Profile" $llm_semantic_profile
    HTTP::header replace "X-Public-Model" $llm_semantic_public_model
    HTTP::header replace "X-Model-Endpoint" $llm_semantic_pool

    if { $llm_semantic_upstream_host ne "" } {
        HTTP::header replace "Host" $llm_semantic_upstream_host
    }
    if { $llm_semantic_auth_header eq "" && [info exists static::llm_semantic_backend_auth] && $static::llm_semantic_backend_auth ne "" && $llm_semantic_upstream_host eq $static::llm_semantic_backend_host } {
        set llm_semantic_auth_header $static::llm_semantic_backend_auth
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
        if { ( $llm_semantic_path starts_with "/v1/chat/completions" || $llm_semantic_path starts_with "/chat/completions" ) && $llm_semantic_public_model ne "" && $llm_semantic_public_model ne $static::llm_semantic_backend_model } {
            set llm_semantic_enable_model_rewrite 1
        }
    pool $llm_semantic_pool
    HTTP::release
}

when HTTP_RESPONSE {
    if { ![info exists llm_semantic_should_handle] || !$llm_semantic_should_handle } {
        return
    }

    if { ![info exists llm_semantic_route_debug_headers] || !$llm_semantic_route_debug_headers } {
        return
    }

    if { [info exists llm_semantic_enable_model_rewrite] && $llm_semantic_enable_model_rewrite } {
        STREAM::expression [string map [list "%%BACKEND%%" $static::llm_semantic_backend_model "%%PUBLIC%%" $llm_semantic_public_model] {@"model":"%%BACKEND%%"@"model":"%%PUBLIC%%"@}]
        STREAM::enable
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
    if { [info exists llm_semantic_auth_header] } {
        HTTP::header replace "X-Debug-Auth-Len" [string length $llm_semantic_auth_header]
    }
    if { [info exists llm_semantic_upstream_host] } {
        HTTP::header replace "X-Debug-Upstream-Host" $llm_semantic_upstream_host
    }
    if { [info exists llm_semantic_upstream_path] } {
        HTTP::header replace "X-Debug-Upstream-Path" $llm_semantic_upstream_path
    }
}
