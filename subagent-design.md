# AI Gateway Subagent 设计

## 1. 文档目的

本文档面向当前 AI Gateway 项目，给出一版适合现阶段开发进度的 **subagent 设计方案**。

这里的 subagent，不是泛化的“很多 LLM 自由对话”，而是：

- 运行在 **ILX 控制面** 内或由 ILX 编排调用的
- 有明确职责、明确输入输出、明确超时和失败策略的
- 可插拔、可审计、可配置的
- 面向某个 stage 执行的“任务型智能单元”

目标是：

1. 让现有 `classify -> policy -> route/respond` 的链路可以自然升级
2. 为后续 `guardrail / plugin 编排 / prompt build / knowledge inject` 留出扩展位
3. 不破坏当前“ILX 做控制面、TMM/iRule 做数据面”的架构边界

## 2. 设计前提

### 2.1 当前项目现状

当前主链路是：

```text
Client
  -> BIG-IP VS
  -> iRule / TMM 接流量
  -> ILX 做决策
  -> TMM 执行 local respond 或 southbound route
  -> Backend model
```

仓库中已经有两条演进线：

- 旧 runtime：`llm_semantic_route + llm_semantic_plugin + classifier-config.json`
- 新 runtime 雏形：`ai_gateway_plugin.js + gateway-config.schema.json + pipeline`

当前新 runtime 已经具备：

- execution context
- pipeline stage
- operation handler
- trace
- evaluate / validate / activate / rollback 思路

所以 subagent 最合理的切入点，不是重写一套 agent framework，而是：

- **把 subagent 作为 pipeline stage 的智能实现方式**

### 2.2 架构边界

subagent 只能放在控制面。

建议边界如下：

- TMM / iRule：northbound 接入、本地回包、southbound 改写、流量执行
- ILX Orchestrator：执行 pipeline、调度 subagent、合并结果、生成决策
- Subagent：完成单一智能任务，输出结构化结果

不建议把 subagent 放到：

- TMM streaming token path
- iRule 热路径中的字符串处理逻辑
- northbound 长连接逐 token 编排

## 3. 设计目标

### 3.1 需要达到的目标

- 支持一个请求内调用 1 到 3 个受控 subagent
- 每个 subagent 有独立配置、独立超时、独立失败策略
- subagent 输出必须是结构化 JSON
- subagent 结果可以进入 policy、route、set_prompt、audit
- 能与现有 `pipeline` / `stage` 模型对齐
- 能被 UI / iApp 配置

### 3.2 明确不做的事

第一阶段不建议做：

- 自主 agent-to-agent 长对话
- 长期记忆
- token 级别的 agent 协商
- 多轮 planner / executor 循环
- 无上限的工具调用
- 在一次请求里跑 5 个以上 agent

换句话说，第一阶段的 subagent 必须是：

- **可控的**
- **可限流的**
- **可回退的**
- **有上限的**

## 4. 核心设计思路

## 4.1 Subagent 不是主流程，而是 Stage 的实现器

建议不要把主流程定义成：

```text
main agent -> planner agent -> worker agent -> reviewer agent -> another agent ...
```

这类设计在 demo 里很容易看起来“高级”，但对你的项目来说，问题很明显：

- 延迟不可控
- 成本不可控
- 调试困难
- 失败路径复杂
- 不适合 TMM/ILX 这种生产网关架构

更适合你的方式是：

```text
pipeline stage
  -> deterministic handler
  -> or subagent-backed handler
  -> structured output
  -> policy/route executor
```

也就是说：

- pipeline 仍然是主干
- subagent 是 stage 的一种实现方式
- route / respond / egress_transform 仍然由确定性逻辑执行

## 4.2 Subagent 只负责“难以规则化但可结构化”的部分

适合 subagent 的问题，一般满足这几个条件：

1. 纯规则写起来很快失控
2. 需要语言理解
3. 输出可以被约束成 JSON
4. 结果还要再经过 deterministic policy 决策

所以你这个项目里最适合的 subagent，不是 route executor，而是：

- 意图分类
- 安全判定
- prompt 构建
- plugin 选择

## 5. 建议的 Subagent 角色

## 5.1 `intent_classifier_agent`

### 作用

负责把 northbound prompt 分类成业务 tag。

### 典型输入

- `prompt_text`
- `northbound_type`
- `path`
- `client_model`
- `tenant`
- candidate tags

### 典型输出

```json
{
  "tag": "f5",
  "confidence": 0.94,
  "reason_codes": ["contains_bigip_terms"]
}
```

### 为什么适合先做

因为你现在已经有 classification 模型和 tag 体系，这个能力本身就是 subagent 的最小形态。

### 对应 stage

- `classify`

## 5.2 `guardrail_agent`

### 作用

负责安全与合规判断。

### 典型输入

- `prompt_text`
- `tenant`
- northbound metadata
- policy context

### 典型输出

```json
{
  "allow": false,
  "risk_level": "high",
  "categories": ["violence", "prompt_injection"],
  "recommended_action": "drop"
}
```

### 适合解决的问题

- 违规内容
- jailbreak / prompt injection
- 数据泄露提示
- tenant 范围外的问题

### 对应 stage

- `guardrail`

## 5.3 `prompt_builder_agent`

### 作用

负责把“业务意图 + 路由目标 + tenant 上下文”整理成最终 route 使用的 prompt/profile override。

### 典型输入

- `prompt_text`
- classification result
- target endpoint
- route profile
- tenant policy

### 典型输出

```json
{
  "system_prompt": "You are an F5 LTM expert...",
  "prompt_vars": {
    "topic": "ltm_pool_monitor",
    "lang": "zh-CN"
  },
  "route_profile": "f5_expert"
}
```

### 为什么需要它

当前 `set_system_prompt` 还比较静态。后续如果你要做更细的 route prompt、多租户 prompt、按标签定制提示词，这个 agent 很适合承担“构造”，而不是让 policy 规则里直接堆大量 prompt 文本。

### 对应 stage

- `set_prompt`

## 5.4 `plugin_selector_agent`

### 作用

负责在多个插件或 service chain 分支之间做语义选择。

### 典型输入

- prompt
- classification result
- enabled plugins
- tenant allowed plugins

### 典型输出

```json
{
  "selected_plugins": ["f5_knowledge", "config_explain"],
  "chain_id": "f5_expert_chain",
  "confidence": 0.87
}
```

### 适用时机

这个 agent 不建议最先做。

它更适合在你已经把 `service_chain` 和 plugin binding 产品化之后，再作为二阶段能力引入。

### 对应 stage

- `policy` 前置辅助
- 或 `plugin_select`

## 5.5 `response_strategy_agent`

### 作用

负责决定本地代答时使用哪种回应策略，而不是直接输出最终 northbound JSON。

### 典型输入

- tag
- risk result
- tenant
- request context

### 典型输出

```json
{
  "response_template": "policy_block_cn",
  "message_key": "blocked_violence",
  "severity": "high"
}
```

### 为什么不是首批

你现在本地 `respond` 已经能由模板化方式解决，大多数场景不需要为“回复一句固定话”引入一个 LLM subagent。

所以这个 agent 最多作为后续扩展，而不是第一阶段重点。

## 6. 哪些能力不应该做成 Subagent

以下能力建议保持 deterministic：

- `authenticate`
- `policy` 最终裁决
- `route` 最终执行
- `local_respond` 最终 northbound 协议封装
- `egress_transform`
- `audit`

原因很直接：

- 它们可规则化
- 对稳定性要求更高
- 出错代价更大
- 不值得引入 LLM 不确定性

正确边界应该是：

- subagent 负责提供“智能建议”
- deterministic engine 负责做“最终执行决策”

## 7. 运行模型

## 7.1 主体角色

### `Gateway Orchestrator`

运行在 ILX 中，负责：

- 构建 execution context
- 按 pipeline 顺序执行 stage
- 调用 subagent
- 做 schema 校验
- 合并 subagent 输出
- 驱动 deterministic operation

### `Subagent Registry`

维护所有可用 subagent 定义，包括：

- agent id
- kind
- endpoint
- input template
- output schema
- timeout
- failure policy
- cache policy

### `Deterministic Executors`

负责：

- route
- local respond
- egress transform
- audit emit

## 7.2 请求内上下文

建议在现有 execution context 基础上扩展：

```json
{
  "request_meta": {},
  "normalized": {},
  "classification": {},
  "guardrail": {},
  "policy": {},
  "routing": {},
  "overrides": {},
  "subagents": {
    "intent_classifier_agent": {
      "status": "ok",
      "latency_ms": 210,
      "output": {}
    }
  },
  "facts": {},
  "trace": {}
}
```

建议新增以下上下文字段：

- `guardrail`
- `facts`
- `subagents`
- `chain_selection`
- `plugin_selection`

## 7.3 串行与并行

### 建议默认模型

默认串行：

```text
normalize
 -> authenticate
 -> classify
 -> guardrail
 -> policy
 -> set_prompt
 -> route
 -> local_respond / invoke_model
 -> egress_transform
 -> audit
```

### 建议可选并行

在性能预算允许时，可以让：

- `intent_classifier_agent`
- `guardrail_agent`

并行执行，然后在 `policy` 阶段汇总。

但这里要满足两个前提：

1. 两者输入基本相同
2. 两者输出彼此独立

如果你当前延迟预算比较紧，第一阶段建议仍然先做串行。

## 7.4 结果合并方式

subagent 输出必须进入固定槽位，而不是自由拼接。

例如：

- `classify` 只能写 `ctx.classification`
- `guardrail` 只能写 `ctx.guardrail`
- `set_prompt` 只能写 `ctx.overrides`
- `plugin_select` 只能写 `ctx.plugin_selection`

这样做的好处是：

- 易于调试
- 易于审计
- 易于 UI 展示
- 易于 schema validate

## 8. 配置模型建议

## 8.1 在 Canonical Config 中新增 `resources.subagents`

建议增加一个统一资源区：

```json
{
  "resources": {
    "subagents": {
      "intent_router_v1": {
        "kind": "classification",
        "endpoint": "intent_cls",
        "timeout_ms": 1200,
        "fail_policy": "fallback_value",
        "fallback_output": {
          "tag": "unknown",
          "confidence": 0.1
        },
        "input_template": "Classify this request into one tag from {{tags}} ...",
        "output_schema": {
          "type": "object"
        }
      }
    }
  }
}
```

## 8.2 建议支持的 Subagent 类型

- `classification`
- `guardrail`
- `prompt_builder`
- `plugin_selector`
- `response_strategy`

### 第一阶段只建议启用前三种

- `classification`
- `guardrail`
- `prompt_builder`

## 8.3 Stage 配置方式

建议 stage 通过 `subagent` 字段引用资源：

```json
{
  "pipeline": [
    { "name": "normalize" },
    { "name": "authenticate" },
    { "name": "classify", "subagent": "intent_router_v1" },
    { "name": "guardrail", "subagent": "safety_v1" },
    { "name": "policy", "rules": [] },
    { "name": "set_prompt", "subagent": "prompt_builder_v1" },
    { "name": "route" },
    { "name": "egress_transform" },
    { "name": "audit" }
  ]
}
```

### 兼容原则

为了兼容现有实现，建议：

- `classify` stage 继续支持旧 `classifier`
- 新增 `subagent`
- 当 `subagent` 存在时优先走 subagent 逻辑

这样不会阻断当前环境。

## 9. 输出契约建议

## 9.1 统一要求

所有 subagent 都必须：

- 返回合法 JSON
- 满足预定义 output schema
- 不允许返回最终 northbound response body
- 不允许直接操作 pool/profile/TMM 对象

## 9.2 各类输出示例

### Classification

```json
{
  "tag": "chat",
  "confidence": 0.83,
  "reason_codes": ["small_talk"]
}
```

### Guardrail

```json
{
  "allow": true,
  "risk_level": "low",
  "categories": [],
  "recommended_action": "allow"
}
```

### Prompt Builder

```json
{
  "system_prompt": "You are an F5 engineering assistant...",
  "route_profile": "f5_expert",
  "prompt_vars": {
    "lang": "zh-CN"
  }
}
```

## 10. 失败策略设计

每个 subagent 必须有独立失败策略。

建议至少支持：

- `fail_open`
- `fail_closed`
- `fallback_value`
- `skip_stage`

### 推荐默认值

- `intent_classifier_agent`：`fallback_value`
- `guardrail_agent`：高风险租户 `fail_closed`，普通租户 `fallback_value`
- `prompt_builder_agent`：`skip_stage`

### 原则

- 与安全相关的，默认更保守
- 与提示词构造相关的，默认可跳过
- 与路由相关的，默认必须给出可回退结果

## 11. 性能预算建议

这是生产网关，不是离线 agent 平台，所以要先定预算。

建议第一阶段限制：

- 每请求最多 2 个 subagent 调用
- 总 subagent 时间预算不超过 `1500ms - 2500ms`
- 单 agent 超时默认 `600ms - 1200ms`
- 严禁在 streaming token path 中再次调用 subagent

如果超过预算，必须走：

- fallback
- 或 deterministic shortcut

## 12. 可观测性与审计

subagent 必须纳入 trace。

建议 trace 至少记录：

- `request_id`
- `subagent_id`
- `kind`
- `status`
- `latency_ms`
- `fail_policy`
- `output_hash`
- `selected_endpoint`
- `config_version`

### 不建议直接打日志的内容

- 原始 prompt 全文
- 明文 secret
- 下游授权头

如需调试，应采用脱敏或哈希化方式。

## 13. 安全约束

### 13.1 Subagent 必须无长期记忆

第一阶段建议 subagent 全部无长期 memory。

理由：

- 你当前是 gateway，不是多轮会话平台
- memory 会引入数据治理与合规问题
- 调试和回滚复杂度会明显上升

### 13.2 输出必须经 schema 校验

任何 subagent 返回内容，都要先：

1. 解析 JSON
2. 校验 schema
3. 再进入 execution context

如果不通过，直接走失败策略。

### 13.3 不允许 Subagent 直接执行 side effect

subagent 只能产出建议，不允许直接：

- 改 BIG-IP 配置
- 调 pool
- 直接写 northbound response
- 绕过 policy

## 14. 推荐的落地顺序

## Phase A：把现有分类能力升级成标准 Subagent

### 目标

先把现有 classification 从“特殊逻辑”变成标准化 subagent。

### 做法

- 新增 `resources.subagents`
- `classify` stage 支持 `subagent`
- trace 中记录 subagent 信息
- 保留旧 classifier 兼容模式

### 收益

- 风险最低
- 改动最小
- 能快速验证框架可行性

## Phase B：引入 `guardrail_agent`

### 目标

把安全判断从零散规则升级为正式 stage。

### 做法

- 新增 `guardrail` stage
- `policy` 支持读取 `ctx.guardrail`
- 支持 `drop/respond/route` 的差异化策略

### 收益

- 为生产级安全需求铺路
- 给后续租户隔离与合规策略留接口

## Phase C：引入 `prompt_builder_agent`

### 目标

把动态 route prompt 构造做成正式能力。

### 做法

- 新增 `set_prompt` 的 subagent-backed handler
- 保留静态 route profile 兜底

### 收益

- 支持更细粒度的 route prompt
- 让 prompt 逻辑不再散落在 policy 规则里

## Phase D：引入 `plugin_selector_agent`

### 目标

在 service chain / plugin 编排成熟后，再让 agent 决定走哪条链。

### 做法

- 新增 plugin registry
- 新增 chain selection 上下文
- policy 最终裁决仍然 deterministic

### 收益

- 真正支持复杂 plugin/service chain 编排

## 15. 我对当前项目的建议

如果是按你现在的开发进度，我建议：

### 现在就做

- `intent_classifier_agent`
- `guardrail_agent` 的接口预留
- execution context 扩展
- trace / failure policy / schema validate

### 下一阶段做

- `prompt_builder_agent`

### 不建议现在就做

- planner agent
- review agent
- 多 agent 自主协作
- memory agent
- response generation agent

原因不是这些东西没价值，而是：

- 你现在的关键问题还是产品化配置、运行时边界、发布与可观测性
- 在这些没稳之前，上多 agent 自由协作，复杂度会远超收益

## 16. 一句话结论

对这个项目，subagent 最合理的定位不是“另起一套多智能体系统”，而是：

- **把 ILX pipeline 里的部分 stage 智能化**
- **把 route/respond/audit 保持确定性**
- **先做 classification 和 guardrail，再做 prompt builder**

这样既贴合你当前架构，也最容易从 demo 演进到生产级实现。
