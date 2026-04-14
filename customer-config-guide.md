# Customer Configuration Guide

本文档对应当前直连版演示环境。

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

当前实现支持两种 provider 形态：

1. `openai_compatible_chat`
   - ILX 会向分类模型发送标准 chat body
   - 结构类似：

```json
{
  "model": "deepseek-chat",
  "temperature": 0,
  "max_tokens": 32,
  "messages": [
    {
      "role": "system",
      "content": "You are a routing classifier inside an AI gateway..."
    },
    {
      "role": "user",
      "content": "<extracted prompt>"
    }
  ]
}
```

2. `classifier_http`
   - ILX 会向分类服务发送更简单的 HTTP JSON
   - 结构类似：

```json
{
  "text": "<extracted prompt>",
  "candidate_tags": ["chat", "f5", "bad", "unknown"],
  "metadata": {
    "path": "/v1/chat/completions",
    "contentType": "application/json",
    "promptLength": 123
  }
}
```

### classification model 应该如何返回 tag

是的，当前实现就是通过 **约定输出格式** 来拿 tag。

推荐返回格式是紧凑 JSON，例如：

```json
{"tag":"f5","confidence":0.92}
```

当前 ILX 能接受的返回形式有两类：

1. provider 直接返回顶层 JSON：

```json
{"tag":"chat","confidence":0.81}
```

2. OpenAI-compatible model 在 `choices[0].message.content` 中返回 JSON 字符串：

```json
{
  "choices": [
    {
      "message": {
        "content": "{\"tag\":\"f5\",\"confidence\":0.92}"
      }
    }
  ]
}
```

如果模型没有严格返回 JSON，ILX 还会尝试从文本中用正则提取：

- `tag`
- `category`
- `label`

但正式建议仍然是：**让 classification model 按 JSON 输出**。

### 当前默认 prompt 的作用

默认 classification prompt 会明确告诉模型：

- 只能从 `chat / f5 / bad / unknown` 中选一个
- 只返回紧凑 JSON
- `bad` 用于暴力、色情、辱骂、恶意请求
- `f5` 用于 BIG-IP、iRules、LTM、pool、node、monitor、virtual server、ASM、APM、WAF、DNS、GTM 等问题
- `chat` 用于闲聊
- `unknown` 用于不确定或一般能力询问

因此，当前 tag 不是后端分类模型“自由发挥”的，而是：

- 先由 ILX 提取 prompt
- 再通过规则和/或 classification model
- 最终按约定格式收敛成标准 tag

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
  "candidateTags": ["chat", "f5", "bad", "unknown"],
  "provider": {
    "type": "openai_compatible_chat",
    "protocol": "https",
    "hostname": "api.deepseek.com",
    "port": 443,
    "path": "/chat/completions",
    "method": "POST",
    "model": "deepseek-chat",
    "apiKey": "REPLACE_WITH_CLASSIFIER_KEY",
    "systemPrompt": "You are a routing classifier inside an AI gateway. Classify the user input into exactly one tag from: chat, f5, bad, unknown. Return only compact JSON like {\"tag\":\"f5\",\"confidence\":0.92}. Use bad for violence, sexual content, or abusive/harmful requests. Use f5 for BIG-IP, iRule, LTM, pool, node, monitor, virtual server, ASM, APM, WAF, DNS, GTM, or other F5 questions. Use chat for casual conversation. Use unknown when unsure.",
    "headers": {
      "Content-Type": "application/json"
    }
  },
  "decisions": {
    "default": {
      "action": "route",
      "pool": "pool_semantic_demo_default_direct",
      "profile": "general_assistant"
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
        "profile": "f5_expert"
      },
      "unknown": {
        "action": "route",
        "pool": "pool_semantic_demo_default_direct",
        "profile": "general_assistant"
      }
    }
  },
  "backend": {
    "protocol": "https",
    "hostname": "api.deepseek.com",
    "port": 443,
    "path": "/chat/completions",
    "method": "POST",
    "model": "deepseek-chat",
    "apiKey": "REPLACE_WITH_BACKEND_KEY",
    "headers": {
      "Content-Type": "application/json"
    }
  },
  "routeProfiles": {
    "f5_expert": {
      "systemPrompt": "You are an F5 BIG-IP expert. Answer F5 questions accurately with concrete tmsh, iRules, virtual server, pool, node, monitor, and operational guidance when useful. Answer in Chinese unless the user explicitly asks for another language.",
      "maxTokens": 512,
      "temperature": 0.2
    },
    "general_assistant": {
      "systemPrompt": "You are an F5 AI gateway demo assistant. Your primary scope is F5 BIG-IP, iRules, LTM, pool, virtual server, monitor, DNS, ASM, APM, GTM, and closely related network or infrastructure topics. When the user asks what you can do, explain that you mainly support F5-related technical questions and gateway demo scenarios. If the request is outside F5, answer briefly and steer the conversation back to F5 or enterprise infrastructure topics. Answer in Chinese unless the user explicitly asks for another language.",
      "maxTokens": 256,
      "temperature": 0.2
    }
  }
}
```

## 5. 每个字段怎么理解

### 5.1 顶层字段

| 字段 | 说明 |
| --- | --- |
| `mode` | 当前固定使用 `openai_compatible_chat` |
| `timeoutMs` | classifier southbound 调用超时，单位毫秒 |
| `rulesFirst` | 是否先跑内建规则，再调用分类模型 |
| `candidateTags` | 允许分类器输出的 tag 集 |
| `provider` | 分类模型 endpoint 配置 |
| `decisions` | tag -> action / pool / profile / message |
| `backend` | routed 后端模型的 southbound 配置 |
| `routeProfiles` | routed 请求的 system prompt、max tokens、temperature |

### 5.2 `provider`

这是分类模型配置，不是业务模型。

常用字段：

- `hostname`
- `path`
- `model`
- `apiKey`
- `systemPrompt`

要求：

- `candidateTags` 和 `systemPrompt` 里写的 tag 必须一致
- 如果你新增 tag，例如 `billing`，必须同时改：
  - `candidateTags`
  - `systemPrompt`
  - `decisions.tags.billing`

### 5.3 `decisions`

这是 tag 到动作的映射。

动作只有两类：

- `respond`
- `route`

例子：

- `chat`
  - `action=respond`
  - `message=工作时间请不要闲聊`
- `bad`
  - `action=respond`
  - `message=您的请求违规`
- `f5`
  - `action=route`
  - `pool=pool_semantic_demo_big_direct`
  - `profile=f5_expert`

### 5.4 `backend`

这是 routed 请求真正要打到的 southbound 后端。

当前字段含义：

- `hostname`
  - HTTP Host / SNI 所对应的后端主机名
- `path`
  - southbound path
- `model`
  - 实际发给后端的模型名
- `apiKey`
  - backend API key

说明：

- 当前演示环境里，backend key 同时在 `classifier-config.json` 和 iRule fallback 里都配置了一份。
- 原因是当前 BIG-IP ILX 运行路径下，发布目录和 workspace 目录分离，演示环境为了保证直连稳定性，保留了 F5 执行面 fallback。
- 产品化时建议把 backend key 收敛到更正式的 F5 配置对象，不继续写死在 iRule 里。

### 5.5 `routeProfiles`

这是 routed 请求的“角色模板”。

作用：

- 在 routed 请求前，ILX 会把 `routeProfiles.<profile>.systemPrompt` 注入到 southbound request 里
- 然后再把用户原始对话一并发给后端模型

当前默认有两个 profile：

- `f5_expert`
  - 明确要求后端模型以 F5 BIG-IP 专家身份回答
- `general_assistant`
  - 明确要求回答范围以 F5 AI gateway 演示和企业基础设施为主

这就是你问“你支持什么工作”时，不应该直接给出一个完全泛化回答的配置入口。

## 6. F5 执行面要配什么

### 6.1 iRule 静态变量

当前活动 iRule 里有这些关键静态变量：

- `static::llm_semantic_default_pool`
- `static::llm_semantic_default_profile`
- `static::llm_semantic_backend_host`
- `static::llm_semantic_backend_auth`

当前演示环境里：

- `static::llm_semantic_backend_host`
  - `api.deepseek.com`
- `static::llm_semantic_backend_auth`
  - `Bearer <backend key>`

说明：

- 这部分当前是产品实现层配置，不建议普通客户手改。
- 如果要切换到另一个后端域名，除了改 `classifier-config.json.backend.hostname`，也必须同步改这里的 host/auth。

### 6.2 pool

当前 routed pool 是：

- `/Common/pool_semantic_demo_big_direct`
- `/Common/pool_semantic_demo_default_direct`

当前演示里这两个 pool 都指向 DeepSeek 的 southbound 地址。

如果用户要切换到另一个后端：

1. 改 pool member
2. 改 `backend.hostname`
3. 改 `static::llm_semantic_backend_host`
4. 确认 server-ssl profile 的 `server-name`

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
2. 再改 `provider.systemPrompt`
3. 再改 `decisions.tags`
4. 再改 `routeProfiles`
5. 最后确认 `backend` / pool / server-ssl 是否一致

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

当前 routed 响应会带这些调试头：

- `X-Semantic-Tag`
- `X-Semantic-Action`
- `X-Gateway-Profile`
- `X-Model-Endpoint`
- `X-Gateway-Request-Id`
- `X-Public-Model`

当前演示环境还额外回显了：

- `X-Debug-Auth-Len`
- `X-Debug-Upstream-Host`
- `X-Debug-Upstream-Path`

这些头是为了演示和排查保留的。

例子：

- `X-Semantic-Tag: f5`
- `X-Semantic-Action: route`
- `X-Gateway-Profile: f5_expert`
- `X-Debug-Auth-Len: 42`

如果 `X-Debug-Auth-Len` 是 `0`，通常说明 backend auth 没配置进去。

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
