# F5 AI Gateway Support Profile

## 1. 文档目的

本文档定义当前演示环境下 F5 AI Gateway 的正式接口边界。

目标是给客户、前端 chatbot、agent 和后端模型服务一个统一契约：

- 北向客户端按照本文档接入 F5
- 南向模型服务按照本文档约束被 F5 对接
- 超出本文档范围的行为，不视为当前版本正式支持能力

## 2. 架构边界

当前正式路径：

```text
Client
  -> BIG-IP VS
  -> iRule collect request body
  -> ILX decideRoute
  -> TMM local respond 或 TMM 直连后端模型
  -> Backend LLM
```

说明：

- Linux 仅保留参考 chatbot，不承担 southbound adapter
- F5 是 northbound API 和 southbound model access 的主体
- 第三方客户端应适配 F5 的 northbound contract，而不是反过来要求 F5 无限适配客户端私有行为

### 2.1 iRules LX 与 iRule 的职责清单

当前采用的是：

- iRules LX / ILX 负责决策面
- iRule / TMM 负责执行面

#### iRules LX / ILX

ILX 当前负责：

- 解析 northbound 请求路径和基本 schema
- 提取 prompt 文本
- 调用分类模型
- 应用本地规则和 tag 决策
- 选择 action、pool、profile
- 构造 southbound request body
- 生成后端 `Host`、`Authorization`、`URI`
- 返回轻量决策包给 TMM

ILX 当前不负责：

- 持有 northbound 长连接数据面
- 长时间代理 SSE
- 直接搬运 northbound 到 southbound 的持续 streaming payload

#### iRule / TMM

iRule / TMM 当前负责：

- 接住 probe / model discovery 路径
- `HTTP::collect` 收集推理请求 body
- 通过 `ILX::call` 获取决策
- 对 `chat` / `bad` 做本地 `HTTP::respond`
- 对 routed 请求改写：
  - `Host`
  - `Authorization`
  - `URI`
  - `Content-Type`
  - `Content-Length`
  - payload body
- 选择 southbound pool
- 释放并转发真实数据流
- 对 routed northbound 响应做最小必要修正：
  - `model` 回写
  - 调试头回显

## 3. Northbound Support Profile

### 3.1 正式支持的 northbound 路径

#### 推理请求

- `POST /v1/chat/completions`
- `POST /chat/completions`
- `POST /v1/responses`
- `POST /responses`

#### 探活与模型发现

- `GET /`
- `HEAD /`
- `OPTIONS /`
- `GET /v1`
- `HEAD /v1`
- `OPTIONS /v1`
- `GET /v1/models`
- `HEAD /v1/models`
- `OPTIONS /v1/models`
- `GET /models`
- `HEAD /models`
- `OPTIONS /models`
- `GET /model/list`
- `HEAD /model/list`
- `OPTIONS /model/list`

### 3.2 北向请求格式要求

客户端需要满足以下要求：

- 编码：`application/json; charset=utf-8`
- 文本内容：UTF-8
- 流式模式：SSE
- 模型字段：允许传任意公共模型名，例如 `testmodel`
- 鉴权：`Authorization: Bearer <api-key>` 或兼容的 API key 模式

### 3.3 `chat/completions` 支持范围

当前正式支持：

- 文本对话
- `stream=false`
- `stream=true`
- OpenAI-compatible `messages[]`
- `model`
- `temperature`
- `top_p`
- `presence_penalty`
- `frequency_penalty`
- `max_tokens`
- `stream_options`

当前不作为正式支持范围：

- tools / function calling
- multimodal
- response_format / structured outputs
- 客户端私有扩展字段

### 3.4 `responses` 支持范围

当前正式支持：

- `chat` tag -> F5 本地响应
- `bad` tag -> F5 本地响应

当前边界：

- routed `responses` 还没有做完整 northbound `response` 协议直连适配
- routed 请求当前会返回明确提示，要求改用 `chat completions`

### 3.5 北向响应行为

#### 本地 `respond`

适用于：

- `chat`
- `bad`

特点：

- 由 TMM 直接返回
- 不暴露后端模型
- 支持 JSON 和 SSE

#### Routed

适用于：

- `f5`
- `unknown`

特点：

- F5 直连后端模型
- 北向 `model` 会回写为客户端原始 `public model`
- routed 响应头会回显调试信息

### 3.6 北向调试头

当前 routed 响应会回显：

- `X-Semantic-Tag`
- `X-Semantic-Action`
- `X-Semantic-Confidence`
- `X-Semantic-Source`
- `X-Gateway-Request-Id`
- `X-Gateway-Profile`
- `X-Model-Endpoint`
- `X-Public-Model`

### 3.7 北向客户端兼容原则

F5 当前定义的是 northbound standard contract，而不是第三方 UI 私有行为兼容层。

因此：

- 客户端只要符合本文档定义的 northbound profile，应可以接入
- 第三方客户端如果额外发私有探活、title generation、tag generation、summary 等请求，不保证默认支持
- 当前已对常见探活路径做了兼容接住，但不承诺无限扩展第三方私有行为

## 4. Semantic Routing Contract

### 4.1 当前正式 tag

- `chat`
- `f5`
- `bad`
- `unknown`

### 4.2 当前正式动作

- `respond`
- `route`

### 4.3 当前正式语义行为

- `chat` -> 本地回复：`工作时间请不要闲聊`
- `bad` -> 本地回复：`您的请求违规`
- `f5` -> routed 到 F5 专家 profile
- `unknown` -> routed 到通用 F5 网关助手 profile

## 5. Southbound Support Profile

### 5.1 当前正式支持的后端模式

当前 F5 直连支持的 southbound 模式是：

- `POST /chat/completions`
- `POST /v1/chat/completions`
- OpenAI-compatible 或 OpenAI-like chat endpoint
- UTF-8 JSON
- `stream=false`
- `stream=true`

### 5.2 后端必须满足的条件

后端模型服务需要满足：

- 接收 JSON chat-completions 风格请求
- 返回 JSON 或 SSE
- 支持 UTF-8
- 支持 bearer token 鉴权或可由 F5 注入自定义鉴权头

### 5.3 F5 当前会向后端改写的字段

F5 在 routed 请求里当前会改写：

- `Host`
- `Authorization`
- `URI`
- `Content-Type`
- `Content-Length`
- `model`
- `messages`
- `system prompt`
- `max_tokens`
- `temperature`

### 5.4 route profile

当前内建两个 route profile：

- `f5_expert`
- `general_assistant`

它们用于 southbound request 注入不同的 `systemPrompt`、`maxTokens` 和 `temperature`。

### 5.5 当前 southbound 不支持范围

以下能力当前不列为正式支持：

- tools / function calling
- multimodal
- 任意 provider 的私有 streaming event
- 需要复杂 northbound response transform 的后端

## 6. 客户端接入建议

### 6.1 推荐接入方式

- 优先使用 `POST /v1/chat/completions`
- 或使用别名 `POST /chat/completions`
- 使用 UTF-8 JSON
- 使用标准 OpenAI SSE 处理流式返回

### 6.2 不推荐的方式

- 依赖第三方客户端私有 title/tag/summary 接口
- 假定网关会自动兼容任意私有探活路径
- 依赖客户端私有的编码容错行为

## 7. 当前已知边界

- `responses` routed 仍未做完整 northbound 直连转换
- 第三方客户端如果自身存在 UTF-8 流式桥接问题，F5 不默认为其做 client-specific workaround
- 当前标准路线是：客户端适配 F5 northbound contract，而不是 F5 无限适配各种 UI 的私有行为

## 8. 推荐对外表述

建议统一这样描述：

> F5 AI Gateway 当前定义并实现了明确的 northbound API support profile。  
> 客户端只要符合该 northbound contract，即可稳定接入。  
> 对常见第三方客户端，可以提供已验证配置模板；但不承诺无限兼容其私有扩展行为。  
> southbound 当前正式支持 OpenAI-compatible / OpenAI-like chat-completions 类模型接口。
