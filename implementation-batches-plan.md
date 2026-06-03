# AI Gateway 分批改造计划

## 1. 文档目的

本计划基于当前 `8080` 主链路环境制定，目标是在 **不打断现网验证路径** 的前提下，把当前 AI Gateway 从 demo 级实现逐步收敛为生产级产品形态。

当前基线：

- 数据面主链路：`vs_llm_semantic_demo_8080 -> iRule llm_semantic_route -> ILX::call llm_semantic_plugin -> TMM route/respond`
- 配置散落在 LTM 对象、iRule、`classifier-config.json`、说明文档四层
- 仓库中已经存在更成熟的统一配置模型雏形：`gateway-config.schema.json`

本计划的核心原则：

1. 先收敛配置源，再演进运行时
2. 先确保兼容，再替换旧实现
3. 控制面与数据面职责保持稳定
4. 每一批都必须可验证、可回退、可审计

## 2. 总体分批策略

| 批次 | 主题 | 主要目标 | 是否改动现网主链路 |
| --- | --- | --- | --- |
| Batch 0 | 基线冻结与风险清理 | 固化现状、建立回归和安全基线 | 否 |
| Batch 1 | 统一配置模型 | 建立 Canonical Config 与 Renderer | 否 |
| Batch 2 | iApp 单入口 MVP | 把关键配置收敛到一个入口 | 否 |
| Batch 3 | 运行时去硬编码 | 把散落在 iRule/JSON 的配置收拢出来 | 小幅 |
| Batch 4 | Service Chain 产品化 | 把 pipeline/stage 做成一等对象 | 是 |
| Batch 5 | 发布与运维能力 | 校验、版本、灰度、回滚、审计 | 小幅 |
| Batch 6 | 新运行时切换 | 从旧插件切换到新网关运行时 | 是 |

## 3. 详细分批计划

## 3.1 Batch 0：基线冻结与风险清理

### 目标

在改造前，把当前 `8080` 主链路的对象、配置、行为、风险点固化下来，避免后续“改着改着不知道哪里变了”。

### 主要工作

- 盘点现网对象
  - virtual server
  - pool
  - SSL profile
  - iRule
  - ILX workspace / plugin / extension
- 导出现网配置快照
  - `classifier-config.json`
  - `llm_semantic_route`
  - pool/member/monitor
- 建立最小回归用例集
  - `chat -> local_respond`
  - `bad -> local_respond`
  - `f5 -> route`
  - `responses -> local_respond`
  - 流式与非流式
- 建立现网行为基线
  - northbound headers
  - returned schema
  - tag / route / response 行为
- 处理明显的生产阻塞项
  - 明文密钥清理与轮换
  - 文档与实际运行环境对齐

### 这一批的作用

- 降低后续改造不可控风险
- 给后面每一批提供回归依据
- 先把最明显的生产级风险点控制住

### 交付物

- 环境基线清单
- 配置快照归档
- 回归测试清单
- 已知风险列表

### 验收标准

- 能明确回答 `8080` 上当前有哪些对象、哪些配置文件、哪些业务行为
- 至少有一套可重复执行的冒烟验证脚本或命令清单
- 明文密钥问题进入整改流程

## 3.2 Batch 1：统一配置模型

### 目标

建立统一的 Canonical Config，作为唯一控制面模型；后续所有 UI、iApp、发布动作都只面向这一个配置模型。

### 主要工作

- 以现有 `gateway-config.schema.json` 为基础扩展统一模型
- 新增或正式化以下对象
  - `listener`
  - `northbound_profiles`
  - `southbound_endpoints`
  - `tags`
  - `route_profiles`
  - `response_templates`
  - `service_chain`
  - `secrets`
  - `publish_policy`
- 建立 Renderer，把 Canonical Config 转换成当前 `8080` 运行时可消费的内容
  - 旧 `classifier-config.json`
  - iRule 变量/data-group
  - LTM 对象模板
- 建立静态校验器
  - schema 校验
  - 交叉引用校验
  - 语义校验

### 这一批的作用

- 把“配置散落四层”的问题先解决掉
- 为后续 iApp/UI 提供稳定 contract
- 为未来从旧插件切到新插件提供兼容层

### 交付物

- Canonical Config schema
- 示例配置
- Renderer
- Validate 工具

### 验收标准

- 同一份 Canonical Config 能生成当前旧运行时所需配置
- Renderer 生成的配置可被现网链路正确加载
- 可以在不改业务代码的前提下只通过配置生成出一个等价环境

## 3.3 Batch 2：iApp 单入口 MVP

### 目标

把用户最常用、最容易改错、目前最分散的配置项收敛到一个 iApp 或统一配置入口中。

### 主要工作

- 设计 iApp 参数模型
- 将以下能力纳入单入口
  - VIP / vport
  - 北向 schema 选择
  - 南向 endpoint 管理
  - tag 管理
  - classification prompt
  - route profile / prompt
  - local response 模板
  - service chain 顺序
- 提供配置预览
  - 逻辑预览
  - 生成配置预览
  - 差异预览
- 提供配置测试入口
  - validate
  - simulate/evaluate

### 这一批的作用

- 先解决“用户到处找配置点”的主要痛点
- 让测试配置场景可以在一个界面完成
- 为 UI 前端定型信息架构和交互流程

### 交付物

- iApp 参数定义
- iApp 模板或前端配置页 MVP
- 配置预览/校验能力

### 验收标准

- 用户无需手工编辑 iRule 和 ILX JSON 即可完成主要配置
- 至少 80% 的 demo 配置场景能通过统一入口完成
- 用户可以预览最终渲染出的关键运行时配置

## 3.4 Batch 3：运行时去硬编码

### 目标

把当前散落在 iRule static 变量和旧 JSON 中的硬编码项，改成统一配置驱动。

### 主要工作

- 清理 iRule 中的硬编码项
  - backend host
  - auth header
  - default pool
  - default profile
  - default public model
  - northbound path 集合
- 把 local response 模板配置化
- 把 northbound / southbound schema 适配参数化
- 将 LTM 相关对象纳入生成范围
  - pool
  - monitor
  - server SSL profile
  - virtual 绑定项
- 建立“生成物”和“手写代码”的边界
  - 哪些文件可生成
  - 哪些代码只能手写

### 这一批的作用

- 减少人工改代码导致的回归
- 把配置改动从“改脚本”变成“改参数”
- 为后续 service chain 扩展腾出空间

### 交付物

- 去硬编码后的 iRule 版本
- 配置生成规则
- LTM 对象渲染模板

### 验收标准

- 新增一个 endpoint、新增一个 tag、新增一个 route profile 不需要手工改 iRule 逻辑
- 关键运行参数都能从统一配置追溯到来源
- 不再允许业务方通过改 iRule static 变量完成日常配置

## 3.5 Batch 4：Service Chain 产品化

### 目标

把 `normalize/authenticate/classify/guardrail/policy/set_prompt/route/local_respond/egress_transform/audit` 做成真正可编排的 stage，而不是代码里的隐式流程。

### 主要工作

- 定义 stage 运行模型
  - `name`
  - `enabled`
  - `order`
  - `config`
  - `failure_policy`
- 定义默认标准链路
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
- 建立 stage 间上下文对象
- 建立插件扩展机制
  - 内建 stage
  - 可插拔 stage
- 为每个 stage 定义可观察性输出

### 这一批的作用

- 把未来的 guardrail、cache、quota、plugin 编排纳入同一架构
- 避免继续在 iRule/ILX 里加 if/else 分支
- 让功能演进具备产品化扩展能力

### 交付物

- Stage 运行框架
- 默认 service chain
- Stage 配置模型
- Stage trace / audit 数据结构

### 验收标准

- 可以通过配置禁用或调整某个 stage，而不是改核心代码
- pipeline 变更有明确的输入、输出、失败策略
- 至少能支持新增一个 guardrail 或 plugin stage 而不破坏主链路

## 3.6 Batch 5：发布与运维能力

### 目标

补齐生产级产品最关键的发布、观测、回滚和审计能力。

### 主要工作

- 配置生命周期
  - draft
  - validate
  - dry-run
  - activate
  - rollback
- 版本化能力
  - config version
  - diff
  - operator comment
- 运维与观测
  - request trace
  - stage trace
  - metrics
  - error taxonomy
- 灰度与安全发布
  - canary
  - staged rollout
  - fast rollback
- 告警与审计
  - 发布审计
  - 请求审计
  - 安全事件记录

### 这一批的作用

- 让它具备生产环境可运维能力
- 让发布行为可追踪、可回退、可复盘
- 降低配置错误扩散到全量流量的风险

### 交付物

- 配置版本中心
- 发布流程
- 审计与指标规范
- 回滚 runbook

### 验收标准

- 每次配置发布都能看到版本号、变更差异、操作人
- 任意一个发布失败都可以快速回滚
- 能从日志中查到一次请求命中了哪些 stage 和 policy

## 3.7 Batch 6：新运行时切换与旧环境退役

### 目标

在前几批稳定后，把 `8080` 主链路逐步从旧 `llm_semantic_plugin + classifier-config.json` 迁移到新网关运行时。

### 主要工作

- 明确新旧运行时能力对齐矩阵
- 做双栈并行验证
  - 旧 runtime
  - 新 runtime
- 做灰度切流
- 保留快速回切方案
- 清理旧对象
  - 旧插件
  - 旧 JSON
  - 旧无主对象

### 这一批的作用

- 正式完成从 demo runtime 到产品 runtime 的切换
- 清理技术债，减少长期双栈维护成本
- 把未来演进统一到一个运行时上

### 交付物

- 新 runtime 上线方案
- 回切方案
- 旧对象退役清单

### 验收标准

- 新 runtime 在主链路上完成功能对齐
- 灰度过程中无不可接受回归
- 旧对象可以下线，不再承担生产职责

## 4. 推荐优先级

如果资源有限，我建议优先级如下：

1. Batch 0
2. Batch 1
3. Batch 2
4. Batch 3
5. Batch 5
6. Batch 4
7. Batch 6

说明：

- `Batch 1-3` 先解决“配置能不能统一收口”的问题
- `Batch 5` 提前于 `Batch 4` 并不矛盾，因为版本与回滚能力越早越好
- `Batch 4` 在控制面模型稳定后做，会更顺
- `Batch 6` 必须放到最后

## 5. 每一批的业务价值

| 批次 | 直接价值 | 间接价值 |
| --- | --- | --- |
| Batch 0 | 降低误改和安全风险 | 给所有后续批次提供基线 |
| Batch 1 | 统一配置源 | 为 UI、发布、运行时切换建立 contract |
| Batch 2 | 单界面完成配置 | 大幅降低测试与操作门槛 |
| Batch 3 | 去掉硬编码 | 降低后续功能演进的代码修改量 |
| Batch 4 | 支持 service chain 与 plugin 编排 | 为未来产品扩展留接口 |
| Batch 5 | 支持生产发布和回滚 | 让产品真正可运维 |
| Batch 6 | 完成产品 runtime 切换 | 降低长期维护成本 |

## 6. 我建议的项目分工

### 控制面/配置面

- 配置模型设计
- schema / validator / renderer
- iApp / UI 配置入口
- 版本与发布流程

### 数据面

- iRule executor
- northbound response template
- egress transform
- route 执行

### 运行时/策略面

- ILX stage engine
- classify / guardrail / policy / set_prompt
- stage trace / audit

### 运维与平台

- secret 管理
- HA / sync / backup
- 观测与告警
- 回滚 runbook

## 7. 建议的阶段出口条件

每一批结束前，建议都满足以下通用条件：

1. 有配置变更说明
2. 有回归验证结果
3. 有失败回滚方案
4. 有运维影响说明
5. 有遗留问题列表

只有满足这些条件，下一批才能开始。
