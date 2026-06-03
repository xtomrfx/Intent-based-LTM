# AI Gateway 配置易用性改造方案

## 1. 当前环境确认

本次以 `8080` 端口为准，`8081` 视为历史环境，不纳入改造基线。

当前真实运行链路是：

```text
Client
  -> BIG-IP VS: vs_llm_semantic_demo_8080
  -> iRule: llm_semantic_route
  -> ILX RPC: /Common/llm_semantic_plugin + llm_semantic_ext
  -> TMM 本地 respond 或改写后 southbound 转发
  -> Backend LLM
```

确认结果：

- `8080` 的 virtual server 是 `vs_llm_semantic_demo_8080`
- 该 VS 绑定 `http` profile、`stream` profile、`serverssl_deepseek_direct`
- 该 VS 绑定 iRule `llm_semantic_route`
- 该 VS 没有使用 `llm_ai_gw_profile`
- `llm_semantic_route` 通过 `ILX::call` 调用旧插件 `llm_semantic_plugin`
- 旧插件位于 `llm_semantic_ws/extensions/llm_semantic_ext`
- 旧插件读取 `classifier-config.json`
- Linux 主机仅保留测试 chatbot，不承担 southbound adapter

这说明当前 `8080` 路径下，你描述的“ILX 做控制面、TMM 做数据面”是成立的。

## 2. 当前配置散点

当前配置并不在一个入口完成，而是散落在至少 4 层：

### 2.1 LTM / TMM 对象层

- Virtual server
- pool
- server SSL profile
- stream profile
- monitor

### 2.2 iRule 层

`llm_semantic_route` 里硬编码或半硬编码了：

- ILX plugin 名称
- extension 名称
- 超时
- 默认 pool
- 默认 profile
- 默认 public model
- backend host
- backend auth header
- northbound 支持路径
- northbound 本地响应协议封装

### 2.3 ILX 配置层

`classifier-config.json` 中配置了：

- classification provider
- candidate tags
- tag 对应的动作
- respond message
- route profile
- backend endpoint
- route profile 的 system prompt

### 2.4 文档 / 仓库模型层

仓库里已经存在一套更成熟的声明式模型：

- `gateway-config.schema.json`
- `gateway-config.json.example`
- `gateway-pipeline-config.json.example`
- `ai_gateway_plugin.js`

也就是说，代码仓库里其实已经有“面向产品”的配置模型雏形，但 `8080` 运行环境还在使用旧的 `classifier-config.json + iRule` 路径。

## 3. 关键结论

### 3.1 可以做成一个 iApp

可以，而且应该做成一个统一入口。

但建议理解为：

- 用一个 iApp 暴露全部产品化配置
- iApp 生成运行所需对象和配置
- 不要把业务逻辑直接写死在 iApp 模板里

也就是说，**iApp 应该是入口和渲染器，不应该成为新的业务逻辑引擎**。

### 3.2 不建议直接围绕旧 `classifier-config.json` 做产品化

原因很简单：

- 旧模型只够支撑 demo 级的 tag -> respond/route
- schema 能力弱
- service chain 不是一等对象
- northbound / southbound schema 选择能力弱
- 扩展插件编排不清晰
- 配置生命周期能力不足

更合理的做法是：

- 以仓库中已经存在的 `gateway-config.schema.json` 作为统一控制面模型
- 由 iApp 写入统一配置
- 再由渲染层把统一配置下发成当前 `8080` 所需对象

这样后面即使把运行时从旧插件切到新插件，UI 和产品配置模型也不用推倒重来。

### 3.3 `response` 自定义当前是“ILX 决定内容，iRule 负责最终协议回包”

当前 `8080` 真实行为是：

- ILX 根据 tag 决定 `respond` 还是 `route`
- ILX 返回 `message`
- iRule 负责封装 northbound 的 JSON/SSE 响应

所以现在不是“纯 ILX 回答”，也不是“纯 iRule 回答”，而是：

- 内容选择在 ILX
- northbound 协议落地在 iRule/TMM

如果产品目标是高性能、低复杂度、可审计，建议保留：

- **响应协议拼装在 iRule/TMM**

但要把以下内容改成统一配置驱动：

- respond 模板
- 按 tag 的默认文案
- 按 northbound schema 的返回模板
- 可选变量替换

## 4. 面向生产的目标架构

建议目标架构：

```text
Single iApp / Product UI
  -> Canonical Gateway Config
  -> Config Validator / Renderer
  -> BIG-IP runtime artifacts
      - VS / pool / ssl / monitor
      - iRule generated fragments
      - ILX config JSON
      - optional data-group / secret references

Traffic path
  -> TMM/iRule handles ingress + local respond + egress rewrite
  -> ILX executes classification / policy / chain decisions
  -> TMM executes selected route
```

核心原则：

1. 单一配置源
2. 明确控制面/数据面边界
3. northbound 与 southbound schema 显式建模
4. service chain 一等化
5. 秘钥与策略分离
6. 支持校验、发布、回滚、版本审计

## 5. 建议的统一配置模型

建议不要只暴露“字段集合”，而是暴露 6 个逻辑块。

### 5.1 Listener

- VIP
- vport
- northbound allowed schemas
- northbound allowed paths
- timeout / max body / streaming 开关
- client auth / api key policy

### 5.2 Southbound Endpoints

- endpoint name
- provider type
- base URL / path
- model
- auth secret reference
- timeout
- retry / circuit breaker
- connection policy
- 是否接受 client model
- model alias 映射

### 5.3 Tags 与 Classification

- 可配置 tag 列表
- tag 描述
- classifier endpoint 选择
- classification prompt template
- 候选 tag 注入
- rules-first 开关
- fallback tag

### 5.4 Route Profiles / Prompt Profiles

- profile name
- system prompt
- max tokens
- temperature
- schema transform 规则
- route 时使用哪个 endpoint

### 5.5 Local Response Policies

- 哪些 tag 走 `respond`
- chat schema 下返回模板
- responses schema 下返回模板
- SSE / non-streaming 模板
- 文案变量，例如 `{{tag}}`、`{{request_id}}`

### 5.6 Service Chain / Pipeline

建议显式建模：

- `normalize`
- `authenticate`
- `classify`
- `guardrail`
- `policy`
- `set_prompt`
- `route`
- `local_respond`
- `egress_transform`
- `audit`

每个 stage 至少包含：

- `name`
- `enabled`
- `order`
- `config`
- `failure_policy`

这样以后要插入 cache、PII redact、quota、plugin 编排时，不需要重写 UI 和 schema。

## 6. iApp 应暴露的配置项

你列出的内容基本都应该进一个 iApp，但建议按下面方式组织。

### 6.1 基础接入

- VIP
- vport
- SNAT 模式
- server SSL profile
- 证书与 TLS policy

### 6.2 北向协议

- 是否启用 `chat/completions`
- 是否启用 `responses`
- 是否启用流式
- 探活 / 模型发现路径
- 北向 schema profile

### 6.3 南向模型

- 多个 model endpoint
- endpoint 优先级
- 认证方式
- model alias
- health monitor
- timeout / retry / fallback

### 6.4 语义分类

- tag 列表
- 分类 prompt
- 分类规则说明
- classifier endpoint 选择
- 本地 rules-first 开关

### 6.5 路由与 Prompt

- tag -> action 映射
- route profile 选择
- route prompt
- endpoint 选择
- 条件规则
  - tag
  - header
  - path
  - tenant
  - confidence
  - client model
  - prompt regex

### 6.6 本地响应

- tag -> respond message
- northbound schema 下的模板
- SSE 模式模板
- 国际化文案

### 6.7 编排链

- stage 顺序
- stage enable/disable
- 插件绑定
- 默认失败策略

## 7. 生产级实现建议

## 7.1 不要让 iApp 直接控制所有业务判断

iApp 只负责：

- 收集参数
- 生成声明式配置
- 创建或更新 BIG-IP 对象
- 驱动发布和回滚

业务判断应留在：

- ILX pipeline engine
- iRule data-plane executor

## 7.2 统一 Canonical Config

建议直接扩展现有 `gateway-config.schema.json`，新增以下对象：

- `listener`
- `secrets`
- `response_templates`
- `service_chain`

然后让旧 `8080` 运行时通过一个 renderer 转换成：

- `classifier-config.json`
- 生成式 iRule 变量或 data-group
- pool / monitor / profile 对象

## 7.3 把“可配内容”与“运行时协议代码”分离

建议如下边界：

- iRule 负责 northbound 协议接入、本地回包、southbound 改写
- ILX 负责分类、策略求值、chain 决策
- 配置统一由 Canonical Config 驱动

不要再让：

- prompt 一部分在 JSON
- backend auth 一部分在 iRule static 变量
- 路径支持一部分在文档
- tag 规则一部分在代码

## 7.4 秘钥不要明文散落在 iRule 和 JSON 中

当前环境里，API key 已经出现在：

- iRule static 变量
- ILX JSON 配置

这在 demo 可以接受，在生产不可以接受。

建议至少做到：

- iApp 中以 secret 字段录入
- BIG-IP 端落地为受控 secret reference
- 配置导出时脱敏
- 发布审计时不打印明文

理想状态是对接企业 secret manager，而不是让业务方直接维护明文 key。

## 7.5 建立版本化发布能力

生产级必须具备：

- validate
- dry-run
- activate
- rollback
- config version history
- 审计日志

这块仓库里的新插件思路是对的，建议复用，而不是重新设计。

## 8. 对你关心的几个点的明确回答

### 8.1 北向 / 南向 schema 选择

可以做，而且应该成为一等配置。

建议：

- northbound schema 用 profile 表达
- southbound schema 用 endpoint provider type 表达
- transform 规则由 pipeline stage 管理

### 8.2 tag 自定义

可以做，但 tag 不应只是字符串数组。

建议 tag 至少包含：

- `name`
- `description`
- `default_action`
- `default_response_template`
- `default_route_profile`

### 8.3 classification prompt 定义

完全适合暴露到 iApp。

但要注意：

- prompt 需要支持模板变量
- tag 列表自动注入
- 需要 validate，避免 prompt 漏掉合法 tag

### 8.4 route prompt 配置

建议做成独立 `route profile`，不要直接绑死在 tag 上。

这样：

- 一个 tag 可以走多个 profile
- profile 可以被多个 tag 复用
- 更适合生产环境的策略复用

### 8.5 response 内容自定义

从运行效率和可维护性角度，我建议：

- **最终 northbound 回包仍放在 iRule/TMM**
- **文案和模板通过统一配置驱动**

不要把完整 northbound 响应协议组装全部塞回 ILX。

### 8.6 service chain 编排

这是这次设计里最值得提前做对的部分。

建议不要只做“tag -> route”。

建议直接建模成 pipeline：

- normalize
- classify
- policy
- set_prompt
- route
- respond
- egress_transform

未来增加 plugin 时只需要新增 stage 和配置，不需要改 UI 结构。

## 9. 推荐的落地路线

### Phase 1: 统一模型，不改主链路

- 保留 `8080` 的 iRule + ILX 运行方式
- 新建 Canonical Config
- iApp 只写 Canonical Config
- 用 renderer 生成旧运行时配置

这是最稳的一步。

### Phase 2: 收敛散点

- backend host / auth 从 iRule 拿掉
- response template 从硬编码拿掉
- northbound path 支持项参数化
- pool / ssl / monitor 由 iApp 创建

### Phase 3: 建立产品化生命周期

- validate / activate / rollback
- config version
- operator audit
- canary / staged rollout

### Phase 4: 切换新运行时

- 逐步从旧 `llm_semantic_plugin` 迁移到新 `gateway-config` 模型
- 外部 UI 和 iApp 不需要变化

## 10. 我对当前版本的专业判断

现在这套东西已经能证明方向，但还不是生产级产品形态，主要差在：

- 配置源不唯一
- 新旧运行时并存
- 秘钥管理不合格
- service chain 抽象还不完整
- northbound / southbound contract 未完全收敛
- 文档和实际运行环境存在偏差

但好消息是，仓库里已经有了比较好的下一代配置模型雏形。

最合理的产品化路径不是“把旧 demo 继续堆参数”，而是：

- **以统一 schema 做控制面**
- **以 iApp 做唯一入口**
- **以 iRule/TMM + ILX 做稳定运行面**
- **以 renderer 做新旧运行时兼容层**

这条路既能满足当前 demo 演进，也不会把后续产品化架构锁死。
