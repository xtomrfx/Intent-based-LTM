# Customer Configuration Guide

本文档对应当前直连版演示环境。

补充说明：

- 当前已部署环境仍主要使用运行时兼容配置形态：`targetModels + promptProfiles + decisions`
- 本地仓库现在同时支持更适合 UI / iApp / F5 native publishing 的对象模型：
  - `listeners`
  - `classifiers`
  - `backendTargets`
  - `routingPolicies`
- 本地还保留了一份更适合人阅读和 review 的 canonical JSON：
  - `gateway-config.canonical.json`
- 本地 renderer 现在会额外生成一份 native publish bundle：
  - `gateway-native-artifacts.json`
  - 它用于 review `Data Group + iFile` 发布内容
- 本地 publisher 入口：
  - `publish_gateway_native_artifacts.py`
- 本地 rollback helper：
  - `rollback_gateway_native_artifacts.py`
- 本地 validator 入口：
  - `validate_gateway_canonical.py`
- 发布流程会额外生成一份 snapshot JSON，方便设备侧留档和排障：
  - `gateway-config.snapshot.json`
- 现阶段 ILX 运行态会先读取 `classifier-config.json`，再尝试 overlay：
  - `native/ifile_ai_gateway_classifiers.json`
  - `native/ifile_ai_gateway_backend_targets.json`
  - `native/ifile_ai_gateway_routing_policies.json`
- 推荐把新控制面配置先写成对象模型，再由发布流程渲染为 F5 原生对象与运行时配置
- 当前推荐流程是：
  - 先跑 `validate_gateway_canonical.py`
  - 可选先跑 `publish_gateway_native_artifacts.py --diff`
  - 再跑 render / publish
  - 如需恢复对象状态，可基于 `publish-backups/latest` 生成 `rollback-plan`
  - `publish-manifest.json` 可用于审计 checksum、desired/remote state 与 verification status
- 当前 ILX `health` 已经会输出：
  - active listener / classifier / routing policy ref
  - listener / classifier / backend target / routing policy count
  - native overlay file path 与 loaded key 状态
- 当前 listener 级 northbound 行为已部分脱离 iRule 硬编码，以下字段由 `dg_ai_gateway_listener_settings` 驱动：
  - `root_paths`
  - `model_paths`
  - `chat_paths`
  - `responses_paths`
  - `northbound_api_mode`
  - `chat_completions_support`
  - `responses_support`
- 相关计划见 [f5-native-config-refactor-plan.md](/Users/k.ji/Library/CloudStorage/OneDrive-F5,Inc/books/demo test/ltm-semantic-routing/f5-native-config-refactor-plan.md)

接口与支持边界的正式说明见：

- [northbound-southbound-support-profile.md](/Users/k.ji/Library/CloudStorage/OneDrive-F5,Inc/books/demo%20test/ltm-semantic-routing/northbound-southbound-support-profile.md)
- [f5-ai-gateway-openapi.yaml](/Users/k.ji/Library/CloudStorage/OneDrive-F5,Inc/books/demo%20test/ltm-semantic-routing/f5-ai-gateway-openapi.yaml)

当前产品路径是：

```text
Client
  -> BIG-IP VS
  -> iRule collect request body
  -> ILX decideRoute
  -> TMM local respond 或 TMM 直连后端模型
  -> Backend LLM
```

Linux 现在只保留演示用 chatbot，不再承担 southbound adapter。

## 1.1 iRules 与 iRules LX 的职责分工

当前运行态采用的是：

```text
iRules LX (ILX) 做短决策
TMM / iRule 做数据面执行
```

### iRules LX / ILX 负责什么

iRules LX 当前负责“理解请求并生成决策”。

具体包括：

1. 解析北向请求
   - 识别 `/v1/chat/completions`、`/chat/completions`
   - 识别 `/v1/responses`、`/responses`
   - 识别客户端传入的 `model`
   - 提取 `messages[]` 或 `input` 中的 prompt 文本

2. 处理语义分类
   - 调用分类模型
   - 结合 `rulesFirst` 和本地规则做快速判定
   - 输出标准 tag：
     - `chat`
     - `f5`
     - `bad`
     - `unknown`

3. 生成策略决策
   - 根据 tag 命中 `respond` 或 `route`
   - 为 `route` 选择：
     - `pool`
     - `profile`
     - `public model`
     - `backend path`
     - `backend host`

4. 构造 southbound request
   - 选择后端 `model`
   - 注入 `systemPrompt`
   - 合成发给后端模型的 `messages`
   - 生成 ASCII-safe JSON 请求体，避免 routed 中文请求体在改写链上出问题

5. 返回轻量决策包给 TMM
   - `action`
   - `tag`
   - `confidence`
   - `pool`
   - `profile`
   - `upstream host/path`
   - `Authorization`
   - `public model`
   - `base64` 编码后的 upstream body

### iRule / TMM 负责什么

iRule 当前负责“接流量并执行决策”。

具体包括：

1. 接住 northbound 探活和模型发现请求
   - `/`
   - `/v1`
   - `/v1/models`
   - `/models`
   - `/model/list`
   - 以及对应的 `GET / HEAD / OPTIONS`

2. 收集真正推理请求的 body
   - 对 `chat completions`
   - 对 `responses`
   - 用 `HTTP::collect` 把 body 收起来交给 ILX

3. 调用 ILX 获取决策
   - 执行 `ILX::call`
   - 获取 `respond` 或 `route` 的结果

4. 执行本地响应
   - `chat` -> 本地返回“工作时间请不要闲聊”
   - `bad` -> 本地返回“您的请求违规”
   - 支持 JSON 和 SSE 两种 northbound 返回方式

5. 执行 routed 请求改写
   - 改 `Host`
   - 改 `Authorization`
   - 改 `URI`
   - 改 `Content-Type`
   - 改 `Content-Length`
   - 用 ILX 给出的 body 替换当前 payload

6. 选择后端 pool 并放行
   - 按决策命中的 `pool` 走对应后端
   - `HTTP::release`
   - 由 TMM 承担实际 southbound 数据面转发

7. 做最小 northbound 响应修正
   - 在 routed `chat completions` 响应里回写 `model`
   - 回显调试头：
     - `X-Semantic-Tag`
     - `X-Semantic-Action`
     - `X-Gateway-Profile`
     - `X-Gateway-Request-Id`

### 当前明确不让 ILX 做的事

为了稳定性，当前明确不让 ILX 承担：

- 长时间持有 northbound SSE 数据流
- 做持续的 northbound data-plane proxy
- 直接代理后端 streaming response 到客户端

这也是为什么当前架构要强调：

- ILX 做“决策面”
- TMM 做“执行面”

## 1.2 classification model 是如何对接的

当前和 classification model 的对接由 **iRules LX / ILX** 负责。

实际流程如下：

1. iRule 在 `HTTP_REQUEST_DATA` 里收集 northbound body。
2. iRule 通过 `ILX::call` 把以下信息交给 ILX：
   - 原始请求 payload
   - 请求路径，例如 `/v1/chat/completions`
   - `Content-Type`
3. ILX 解析 JSON，并优先提取最后一条 user prompt。
4. ILX 先执行 `rulesFirst` 本地规则：
   - 明显违规内容直接判成 `bad`
   - 明显 F5 相关内容直接判成 `f5`
   - 明显闲聊直接判成 `chat`
   - 明显“你支持什么功能”这类能力询问直接判成 `unknown`
5. 如果本地规则不能终结，ILX 再调用外部 classification model。
6. classification model 返回 tag 后，ILX 归一化成当前正式支持的 tag：
   - `chat`
   - `f5`
   - `bad`
   - `unknown`
7. ILX 再根据 tag 命中当前 `decisions.tags`，生成轻量决策包交还给 TMM。

### classification model 的输入

当前实现不再把分类模型和后端模型简单写死成 `provider/backend` 两块，而是统一抽成：

- `schema_family`
  - 定义 provider 协议族
- `targetModel_type`
  - `classifier_llm`
  - `classifier_nli`
  - `backend_llm`
- `prompt_profile`
  - 定义 system prompt 的 `append/rewrite` 规则
  - 或定义 NLI labels / hypothesis / decision policy

分类模型当前支持两大类：

1. `classifier_llm`
   - 适合 OpenAI-compatible / Ollama OpenAI-compatible chat 类模型
   - 通过：
     - `schema_family`
     - `provider_config`
     - `prompt_profile`
     生成 southbound 请求

   典型请求结构：

```json
{
  "model": "deepseek-chat",
  "temperature": 0,
  "max_tokens": 32,
  "messages": [
    {
      "role": "system",
      "content": "<原始 system prompt 与分类 prompt_profile 按 append/rewrite 合成后的结果>"
    },
    {
      "role": "user",
      "content": "<extracted prompt>"
    }
  ]
}
```

2. `classifier_nli`
   - 适合 mDeBERTa-v3-base-mnli-xnli 这类 NLI / zero-shot classification 模型
   - 不依赖 system prompt
   - 依赖：
     - `labels`
     - `hypothesis_template`
     - `multi_label`
     - `decision_policy`

   当前 runtime 支持的 `schema_family` 有：

   - `hf_zero_shot_classification`
   - `nli_pairs_json`
   - `custom_label_scores`
   - `legacy_classifier_http`

   其中 `hf_zero_shot_classification` 的典型请求是：

```json
{
  "inputs": "<extracted prompt>",
  "parameters": {
    "candidate_labels": [
      "casual chat",
      "F5 BIG-IP technical support",
      "harmful or disallowed request"
    ],
    "hypothesis_template": "This text is about {}.",
    "multi_label": false
  }
}
```

### classification model 应该如何返回 tag

这取决于 `targetModel_type`。

#### `classifier_llm`

推荐返回紧凑 JSON：

```json
{"tag":"f5","confidence":0.92}
```

当前 runtime 能接受：

1. 顶层 JSON：`{"tag":"chat","confidence":0.81}`
2. OpenAI-compatible `choices[0].message.content` 里的 JSON 字符串

如果模型没有严格返回 JSON，ILX 仍会尝试从文本里提取：

- `tag`
- `category`
- `label`

#### `classifier_nli`

`parse_response()` 不直接要求 provider 返回最终 tag，而是返回统一 evidence。

然后由：

- `finalize_classification(evidence, prompt_profile)`

根据：

- `decision_policy.fallback_label`
- `decision_policy.min_confidence`
- `decision_policy.min_margin`

做最终 tag 决策，输出：

```json
{
  "tag": "f5",
  "confidence": 0.91,
  "candidates": [
    { "internal_label": "f5", "score": 0.91 },
    { "internal_label": "chat", "score": 0.06 }
  ],
  "source": "provider_nli"
}
```

### `prompt_profile` 的作用

#### 对 `classifier_llm`

`prompt_profile.system_prompt` 支持：

- `append`
- `rewrite`

规则：

- `append`
  - 把配置里的 prompt 追加到客户端原始 system prompt 后面
  - 如果 `value=""`，相当于不改原始 system prompt
- `rewrite`
  - 直接覆盖原始 system prompt

默认约定：

- `ClassifierModels`
  - 默认 `append` 你填写的分类提示词
- `BackendModels`
  - 默认 `append` 空值
  - 也就是保持用户原始 system prompt 不变

#### 对 `classifier_nli`

`prompt_profile` 不再表示 system prompt，而表示分类任务定义：

- `labels`
- `hypothesis_template`
- `multi_label`
- `decision_policy`

## 1. 当前能力边界

当前已经验证通过的能力：

- `POST /v1/chat/completions`
  - `chat` -> F5 本地响应
  - `bad` -> F5 本地响应
  - `f5` -> F5 直连后端模型
  - `unknown` -> F5 直连后端模型
- `POST /v1/responses`
  - `chat` -> F5 本地响应
  - `bad` -> F5 本地响应
  - routed 请求当前返回明确提示：
    - `当前直连模式暂仅支持 /v1/chat/completions 的 routed 请求，请改用该接口。`

说明：

- 当前 routed `chat completions` 已支持 non-stream 和 stream。
- 当前 routed `responses` 还没有做 northbound `response` 协议的完整直连适配，所以只保留本地 `respond` 行为，并对 routed 请求明确返回提示。

## 2. 需要用户关注的配置面

用户主要看 3 个地方：

1. F5 上的 classifier 配置  
   文件：

```bash
/var/ilx/workspaces/Common/llm_semantic_ws/extensions/llm_semantic_ext/classifier-config.json
```

2. F5 上的活动 iRule  
   对象：

```text
/Common/llm_semantic_route
```

3. F5 上的 VS / pool / server-ssl profile  
   当前对象：

- VS: `/Common/vs_llm_semantic_demo_8080`
- routed pool:
  - `/Common/pool_semantic_demo_big_direct`
  - `/Common/pool_semantic_demo_default_direct`
- serverside TLS profile:
  - `/Common/serverssl_deepseek_direct`

## 3. 配置职责如何划分

### 3.1 `classifier-config.json`

负责：

- prompt 分类
- tag -> action
- tag -> pool
- tag -> route profile
- 后端模型 northbound 请求改写参数

### 3.2 `llm_semantic_route` iRule

负责：

- 收请求 body
- 调 ILX `decideRoute`
- `chat/bad` 本地 `HTTP::respond`
- routed 请求改写 northbound request
- 设置 backend `Host` / `Authorization` / `URI`
- 选 pool

### 3.3 pool / TLS profile

负责：

- southbound 真实连到哪个后端 IP:port
- 服务器端 TLS
- SNI

## 4. `classifier-config.json` 示例

```json
{
  "mode": "openai_compatible_chat",
  "timeoutMs": 3000,
  "rulesFirst": true,
  "candidateTags": [
    "chat",
    "f5",
    "bad",
    "unknown"
  ],
  "targetModels": {
    "ClassifierModels": {
      "schema_family": "openai_chat_compatible",
      "targetModel_type": "classifier_llm",
      "provider_config": {
        "protocol": "https",
        "hostname": "api.deepseek.com",
        "port": 443,
        "path": "/chat/completions",
        "method": "POST",
        "model": "deepseek-chat",
        "apiKey": "REPLACE_WITH_CLASSIFIER_KEY",
        "headers": {
          "Content-Type": "application/json"
        }
      },
      "prompt_profile": "classifier_default"
    },
    "BackendModels": {
      "schema_family": "openai_chat_compatible",
      "targetModel_type": "backend_llm",
      "provider_config": {
        "protocol": "https",
        "hostname": "api.deepseek.com",
        "port": 443,
        "path": "/chat/completions",
        "method": "POST",
        "model": "deepseek-chat",
        "apiKey": "REPLACE_WITH_BACKEND_KEY",
        "acceptClientModel": false,
        "headers": {
          "Content-Type": "application/json"
        }
      },
      "prompt_profile": "backend_default"
    }
  },
  "promptProfiles": {
    "classifier_default": {
      "type": "classifier_llm",
      "system_prompt": {
        "mode": "append",
        "value": "You are a routing classifier inside an AI gateway. Classify the user input into exactly one tag from: chat, f5, bad, unknown. Return only compact JSON like {\"tag\":\"f5\",\"confidence\":0.92}. Use bad for violence, sexual content, or abusive/harmful requests. Use f5 for BIG-IP, iRule, LTM, pool, node, monitor, virtual server, ASM, APM, WAF, DNS, GTM, or other F5 questions. Use chat for casual conversation. Use unknown when unsure."
      },
      "temperature": 0,
      "max_tokens": 32
    },
    "backend_default": {
      "type": "backend_llm",
      "system_prompt": {
        "mode": "append",
        "value": ""
      }
    },
    "f5_expert": {
      "type": "backend_llm",
      "system_prompt": {
        "mode": "append",
        "value": "You are an F5 BIG-IP expert. Answer F5 questions accurately with concrete tmsh, iRules, virtual server, pool, node, monitor, and operational guidance when useful. Answer in Chinese unless the user explicitly asks for another language."
      },
      "max_tokens": 512,
      "temperature": 0.2
    },
    "general_assistant": {
      "type": "backend_llm",
      "system_prompt": {
        "mode": "append",
        "value": "You are an F5 AI gateway demo assistant. Your primary scope is F5 BIG-IP, iRules, LTM, pool, virtual server, monitor, DNS, ASM, APM, GTM, and closely related network or infrastructure topics. When the user asks what you can do, explain that you mainly support F5-related technical questions and gateway demo scenarios. If the request is outside F5, answer briefly and steer the conversation back to F5 or enterprise infrastructure topics. Answer in Chinese unless the user explicitly asks for another language."
      },
      "max_tokens": 256,
      "temperature": 0.2
    },
    "classifier_nli_default": {
      "type": "classifier_nli",
      "labels": [
        { "id": "chat", "text": "casual chat" },
        { "id": "f5", "text": "F5 BIG-IP technical support" },
        { "id": "bad", "text": "harmful or disallowed request" }
      ],
      "hypothesis_template": "This text is about {}.",
      "multi_label": false,
      "decision_policy": {
        "fallback_label": "unknown",
        "min_confidence": 0.55,
        "min_margin": 0.12
      }
    }
  },
  "decisions": {
    "default": {
      "action": "route",
      "pool": "pool_semantic_demo_default_direct",
      "prompt_profile": "general_assistant"
    },
    "tags": {
      "chat": {
        "action": "respond",
        "message": "工作时间请不要闲聊"
      },
      "bad": {
        "action": "respond",
        "message": "您的请求违规"
      },
      "f5": {
        "action": "route",
        "pool": "pool_semantic_demo_big_direct",
        "prompt_profile": "f5_expert"
      },
      "unknown": {
        "action": "route",
        "pool": "pool_semantic_demo_default_direct",
        "prompt_profile": "general_assistant"
      }
    }
  }
}
```

## 5. 每个字段怎么理解

### 5.1 顶层字段

| 字段 | 说明 |
| --- | --- |
| `mode` | 当前保留运行模式开关，主要影响 `local_only` / `mock` 行为 |
| `timeoutMs` | 缺省 southbound 调用超时，单位毫秒 |
| `rulesFirst` | 是否先跑内建规则，再调用分类模型 |
| `candidateTags` | 当前标准 tag 集 |
| `targetModels` | 分类模型与后端模型的统一抽象 |
| `promptProfiles` | LLM prompt profile 或 NLI classification profile |
| `decisions` | tag -> action / pool / prompt_profile / message |

### 5.2 `targetModels`

这里有两个当前固定入口：

- `ClassifierModels`
- `BackendModels`

每个 target model 都包含：

- `schema_family`
- `targetModel_type`
- `provider_config`
- `prompt_profile`

#### `ClassifierModels`

当前支持：

- `targetModel_type = classifier_llm`
- `targetModel_type = classifier_nli`

常见 `schema_family`：

- `openai_chat_compatible`
- `ollama_openai_compatible`
- `hf_zero_shot_classification`
- `nli_pairs_json`
- `custom_label_scores`
- `legacy_classifier_http`

#### `BackendModels`

当前 `targetModel_type` 固定是：

- `backend_llm`

当前正式支持的 `schema_family` 是：

- `openai_chat_compatible`
- `ollama_openai_compatible`

也就是说，如果 Ollama 走它的 OpenAI compatibility `/v1/chat/completions`，分类和 routed backend 都可以共用同一套 LLM request builder。

### 5.3 `promptProfiles`

#### LLM prompt profile

适用于：

- `classifier_llm`
- `backend_llm`

关键字段：

- `system_prompt.mode`
  - `append`
  - `rewrite`
- `system_prompt.value`
- `temperature`
- `max_tokens`

语义：

- `append`
  - 追加到原始 system prompt
  - `value=""` 时等价于 no-op
- `rewrite`
  - 覆盖原始 system prompt

默认约定：

- `ClassifierModels`
  - 默认 `append` 分类提示词
- `BackendModels`
  - 默认 `append` 空值

#### NLI prompt profile

适用于：

- `classifier_nli`

关键字段：

- `labels`
- `hypothesis_template`
- `multi_label`
- `decision_policy`

其中：

- `parse_response()` 先返回 evidence
- `finalize_classification()` 再结合 `decision_policy` 输出最终 tag

### 5.4 `decisions`

这是 tag 到动作的映射。

动作仍然只有两类：

- `respond`
- `route`

如果是 `route`，建议写：

- `pool`
- `prompt_profile`

例如：

- `f5`
  - `action=route`
  - `pool=pool_semantic_demo_big_direct`
  - `prompt_profile=f5_expert`

### 5.5 `provider_config`

`targetModels.*.provider_config` 里常见字段：

- `protocol`
- `hostname`
- `port`
- `path`
- `method`
- `model`
- `apiKey` / `apiKeyEnv`
- `headers`
- `acceptClientModel`

说明：

- `ClassifierModels.provider_config`
  - 定义分类模型 southbound 连接方式
- `BackendModels.provider_config`
  - 定义 routed backend southbound 连接方式
- 当前 native UI/runtime 不再通过 iRule 静态变量保存 backend key 或固定 provider fallback
- Backend API Key 由 UI 配置并在 ILX 决策结果中按请求下发，不写入 listener data-group

## 6. F5 执行面要配什么

### 6.1 iRule 静态变量

当前活动 iRule 只保留运行入口和 data-group 路径等非敏感静态变量，例如：

- `static::llm_semantic_plugin`
- `static::llm_semantic_extension`
- `static::llm_semantic_max_payload`
- `static::llm_semantic_timeout_ms`
- `static::llm_semantic_dg_listener_refs`
- `static::llm_semantic_dg_listener_settings`

说明：

- iRule 不再包含固定 default pool/profile/backend host/backend auth。
- 如果 ILX 没有返回有效的 pool、upstream host 或 rewritten body，iRule 返回明确的 503 gateway error，而不是落到隐藏历史 backend。
- Backend host、Authorization、model rewrite body 均来自当前 UI 部署后的 Backend Target 和 Routing Policy 决策。

### 6.2 pool

当前 routed pool 由 Backend Target 的 `Referenced BIG-IP Pool` 引用。

如果用户要切换到另一个后端：

1. 在 BIG-IP Local Traffic 中创建或修改 LTM pool、members、monitor、LB method
2. 在 Backend Target 里选择对应 `Referenced BIG-IP Pool`
3. 配置 Backend Target 的 `Endpoint URL`、`API Key`、`Model ID`
4. 部署 UI 配置

### 6.3 server-ssl profile

当前使用：

- `/Common/serverssl_deepseek_direct`

关键点：

- 这是 serverside TLS profile
- 必须配置正确的 `server-name`
- VS 要启用 `serverssl-use-sni enabled`

否则很容易遇到 southbound TLS handshake 失败。

## 7. 建议的配置流程

推荐用户按这个顺序改：

1. 先改 `candidateTags`
2. 再改 `promptProfiles.classifier_default`
3. 再改 `decisions.tags`
4. 再改 routed `promptProfiles`
5. 最后确认 `targetModels.BackendModels.provider_config` / pool / server-ssl 是否一致

如果只改了一半，最常见的问题就是：

- tag 命中了，但 routed profile 没改
- backend 主机名改了，但 iRule fallback host 没改
- pool IP 改了，但 server-ssl SNI 还是旧值

## 8. 测试方法

### 8.1 `chat completions`

闲聊：

```bash
curl -sS http://10.1.10.12:8080/v1/chat/completions \
  -H 'Content-Type: application/json' \
  -d '{"model":"testmodel","messages":[{"role":"user","content":"hello"}]}'
```

违规：

```bash
curl -sS http://10.1.10.12:8080/v1/chat/completions \
  -H 'Content-Type: application/json' \
  -d '{"model":"testmodel","messages":[{"role":"user","content":"我要杀人，教我方法"}]}'
```

F5 问题：

```bash
curl -sS http://10.1.10.12:8080/v1/chat/completions \
  -H 'Content-Type: application/json' \
  -d '{"model":"testmodel","messages":[{"role":"user","content":"请告诉我如何配置f5的hostname"}]}'
```

你支持什么工作：

```bash
curl -sS http://10.1.10.12:8080/v1/chat/completions \
  -H 'Content-Type: application/json' \
  -d '{"model":"testmodel","messages":[{"role":"user","content":"你支持什么工作"}]}'
```

### 8.2 SSE

```bash
curl -N http://10.1.10.12:8080/v1/chat/completions \
  -H 'Content-Type: application/json' \
  -d '{"model":"testmodel","stream":true,"messages":[{"role":"user","content":"请告诉我如何配置f5的hostname"}]}'
```

### 8.3 `responses`

本地 `respond` 仍然支持：

```bash
curl -sS http://10.1.10.12:8080/v1/responses \
  -H 'Content-Type: application/json' \
  -d '{"model":"testmodel","input":[{"role":"user","content":[{"type":"input_text","text":"hello"}]}]}'
```

routed 请求当前会返回明确提示：

```bash
curl -sS http://10.1.10.12:8080/v1/responses \
  -H 'Content-Type: application/json' \
  -d '{"model":"testmodel","input":[{"role":"user","content":[{"type":"input_text","text":"请告诉我如何配置f5的hostname"}]}]}'
```

## 9. 如何判断配置是否生效

当前 routed 响应会带这些状态头：

- `X-Semantic-Tag`
- `X-Semantic-Action`
- `X-Gateway-Profile`
- `X-Model-Endpoint`
- `X-Gateway-Request-Id`
- `X-Public-Model`
- `X-Semantic-Fallback`

默认不回显 `X-Debug-*`，避免暴露 backend auth 长度或 upstream host/path 元数据。

例子：

- `X-Semantic-Tag: f5`
- `X-Semantic-Action: route`
- `X-Model-Endpoint: /Common/pool_name`
- `X-Semantic-Fallback: 0`

## 10. 当前不建议用户改什么

不建议客户直接手改：

- `llm_semantic_route` 的代码逻辑
- `serverssl` profile 的结构
- VS profile 绑定方式

这些属于产品实现层。

建议客户修改的是：

- `classifier-config.json`
- pool member
- backend host/path/model/key
- route profile system prompt

## 11. 发布步骤

当前 ILX 运行态读取的是已发布的 plugin 目录，不是 workspace 文件本身。

所以如果你改了：

- `/var/ilx/workspaces/Common/llm_semantic_ws/extensions/llm_semantic_ext/classifier-config.json`
- `/var/ilx/workspaces/Common/llm_semantic_ws/extensions/llm_semantic_ext/index.js`

必须执行：

```bash
tmsh modify ilx plugin /Common/llm_semantic_plugin from-workspace /Common/llm_semantic_ws
```

如果你改了 iRule 文件，则需要重新 merge：

```bash
(echo 'ltm rule /Common/llm_semantic_route {'; \
  sed 's/^/    /' /var/tmp/llm_semantic_route_phaseA.tcl; \
  echo '}') > /var/tmp/llm_semantic_route_phaseA.conf

tmsh load sys config merge file /var/tmp/llm_semantic_route_phaseA.conf
```

如果你改了 pool member 或 server-ssl profile，通常不需要 republish ILX，但建议做一轮 northbound 回归。

## 12. 演示入口

当前推荐演示入口是自建 chatbot。

说明：

- 它只作为 northbound demo client
- 不参与 southbound adapter
- Open WebUI / LobeChat 已不再是主演示路径

如果客户要看“产品本体”的配置，应以 F5 上的：

- `classifier-config.json`
- `llm_semantic_route`
- VS / pool / server-ssl

为准。
