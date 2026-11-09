# ZenMind Desktop Auditor

用于开发验收与能力演示的独立应用集合。正式 Desktop 实现、生成契约与源码回归由 `zenmind-desktop` 维护。

| 应用 | 用途 |
| --- | --- |
| [WebApp Bridge Lab](webapp-bridge-lab/README.md) | 公开 SDK、前后端通道与关联流程验收 |
| [Work Hub](work-hub/README.md) | 完整项目与任务管理网站：增删改查、列表详情、统计图表与 Platform 智能分析 |
| [DAG Lab](dag-lab/README.md) | 浏览器直接访问、Platform 智能体 DAG、分支汇总与运行记录 |

各子项目独立安装依赖、构建并导入 ZIP。安装包位于各自的 `build/`，测试证据位于 `test-output/`；两者以及依赖、环境配置和凭据不提交 Git。真实模型、账号及 Windows/macOS 实机能力按各项目验收指南分别验证。
