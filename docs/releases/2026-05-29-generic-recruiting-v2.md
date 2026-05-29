# Release: 通用招聘项目工作台正式替换

发布日期：2026-05-29

## 发布类型

正式线上替换。`/recruiting/` 不再只是乐享AI单项目工作台，而是通用招聘项目工作台。

## 核心变化

- 数据层升级到 v2：`workspace` 团队空间、`requisition` 招聘项目、`candidate` 候选人总库、`application` 项目投递关系。
- 所有历史候选人迁入默认项目：`乐享AI / AI 产品经理实习生`。
- 现有筛选记录、人工判断、面邀记录、确认邮件、Outlook/Teams 日程、面试记录、Offer 记录和时间线继续保留。
- 旧候选人 API 保持兼容：现有筛选、面邀、面评、Offer 链路继续通过 `/api/candidates` 系列接口运行。
- 新增招聘项目接口：项目列表、创建项目、更新项目、切换当前项目。
- 正式首页替换为通用项目视角：项目工作台、候选人总库、导入与来源、项目设置、操作日志。

## 数据迁移策略

- 首次启动读取旧 `data/recruiting.json` 时自动迁移到 schema v2。
- 迁移前会在 `data/` 下生成 `recruiting.pre-v2-<timestamp>.json` 备份。
- 迁移是幂等的：重复读取不会重复创建默认项目，也不会重复创建 application。
- 默认项目 ID：`req_lexiang_ai_pm_intern`。

## 验证结果

- 本地构建：`npm run build` 通过。
- 自测链路：`npm run self-test` 通过。
- 迁移校验：legacy 42 位候选人迁移为 42 个总库档案和 42 个默认项目投递关系。
- API 校验：`/api/requisitions`、`/api/candidates`、`/api/candidate-library`、`/api/health` 正常。
- 新项目校验：新建项目后项目候选人池为空，切回默认项目后候选人池恢复 42。
- UI 校验：桌面、390px、320px 检查均无横向溢出，首页展示“招聘项目工作台”“当前招聘项目”“项目候选人池”“候选人总库”。

## 回滚方式

如果上线后发现异常：

1. `git revert` 本次发布提交并重新发布。
2. 停止服务后，用 `data/recruiting.pre-v2-<timestamp>.json` 覆盖 `data/recruiting.json`。
3. 重启 PM2 服务并检查 `/recruiting/`、`/api/security/status` 和候选人详情。

## 已知边界

- v1 不做复杂团队权限隔离，仍复用现有账号体系。
- 新建项目可用，但高级能力如字段映射模板、跨项目候选人合并、项目模板市场暂不包含在本次发布。
- 飞书、Outlook、手工上传默认写入当前招聘项目；没有传 `requisitionId` 时使用当前项目。
