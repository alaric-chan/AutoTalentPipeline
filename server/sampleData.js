export const sampleResumeText = `张婧仪
北京某大学 工业设计 本科
邮箱：jingyi@example.com 手机：13800000000

项目经历：
1. AI知识库助手：使用 ChatGPT 和 DeepSeek 辅助完成用户问题聚类、知识库清洗和答案质量评测。了解 RAG 基本流程，参与过召回结果标注和错误案例分析。
2. Agent Workflow 原型：在 Dify 中配置过简单 Workflow，完成需求调研、竞品分析和交互原型设计。

技能与特点：
- 重度使用 Claude / ChatGPT 做资料整理、PRD 草稿和竞品分析。
- 对 Agent、MCP、Context Engineering 保持关注。
- 可北京线下实习，每周 5 天，预计可连续实习 4 个月，最早 6 月 3 日到岗。`;

export function sampleMessage() {
  return {
    id: 'mock-message-001',
    subject: '超级智能体实习申请-张婧仪-北京某大学-4个月',
    from: {
      emailAddress: {
        name: '张婧仪',
        address: 'jingyi@example.com'
      }
    },
    receivedDateTime: new Date().toISOString(),
    hasAttachments: true,
    bodyPreview: '您好，投递联想乐享AI团队实习岗位，附件为我的简历。'
  };
}
