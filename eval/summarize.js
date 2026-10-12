// ===== 评测报告生成器：把 results.json 变成给人看的 report.md =====
// promptfoo 跑完把每道题的原始结果（回答原文、是否通过、延迟、token 数）
// 写进 results.json；本脚本按四类题目聚合，算通过率/引用率/延迟/成本，
// 挑出失败用例，渲染成 Markdown 报告。运行方式：node summarize.js
// 汇总 promptfoo results.json → report.md
const fs = require('fs');
const path = require('path');

// qwen-plus 价格假设（元 / 1K tokens）
const PRICE_IN = 0.0008;
const PRICE_OUT = 0.002;

// 输入输出都固定在 eval/ 目录：__dirname 是本文件所在目录
const resultsPath = path.join(__dirname, 'results.json');
const outPath = path.join(__dirname, 'report.md');

// results.json 的外层格式随 promptfoo 版本变过：有时是数组、有时套在
// results.results 里。这里把几种都兼容到，最终都拿到统一的题目结果数组
const parsed = JSON.parse(fs.readFileSync(resultsPath, 'utf8'));
let results;
// stats 是整体统计（含判定模型的 token 消耗），能拿到就顺手留着
let stats = null;
if (Array.isArray(parsed)) {
  results = parsed;
} else if (Array.isArray(parsed?.results?.results)) {
  results = parsed.results.results;
  stats = parsed.results.stats || null;
} else if (Array.isArray(parsed?.results)) {
  results = parsed.results;
} else {
  results = [];
}

// 给一条结果归到四类之一：优先读题目 metadata 里写的 category；
// 老格式没写就从 description 前缀猜（"fact-01 每日餐杂补贴" → fact）
function categoryOf(r) {
  const cat = r.testCase?.metadata?.category;
  if (cat) return cat;
  const d = r.testCase?.description || '';
  const prefix = d.split(/[-\s]/)[0];
  return prefix || 'unknown';
}

// 匹配回答里的 [数字] 引用角标 —— 用它统计"引用率"（回答有没有标出处）
const citationRe = /\[\d+\]/;
// 四类题目的中文名；ORDER 是报告表格里的固定排序（未分类排最后）
const CATEGORY_LABEL = {
  fact: '事实类',
  'out-of-scope': '超范围类',
  adversarial: '对抗类',
  ambiguous: '模糊类',
  unknown: '未分类',
};
const ORDER = ['fact', 'out-of-scope', 'adversarial', 'ambiguous', 'unknown'];

// 按类别聚合的主循环：每类攒一个计数器 —— 题数、通过数、带引用数、
// 延迟列表、token 数、失败用例明细
const byCategory = new Map();
for (const r of results) {
  const cat = categoryOf(r);
  if (!byCategory.has(cat)) {
    byCategory.set(cat, { total: 0, pass: 0, citations: 0, latencies: [], tokens: { prompt: 0, completion: 0 }, fails: [] });
  }
  const agg = byCategory.get(cat);
  agg.total += 1;
  // success 是 promptfoo 给的"本题是否通过（所有断言全过）"标记
  if (r.success) agg.pass += 1;
  const output = String(r.response?.output ?? '');
  if (citationRe.test(output)) agg.citations += 1;
  // 延迟取自 provider 返回的 latencyMs（不同版本字段位置不同，都试试）
  const latency = r.response?.latencyMs ?? r.latencyMs ?? null;
  if (latency != null) agg.latencies.push(latency);
  const tu = r.response?.tokenUsage;
  if (tu) {
    agg.tokens.prompt += tu.prompt || 0;
    agg.tokens.completion += tu.completion || 0;
  }
  // 失败的题单独记一份明细：哪道题、问题是什么、败在哪条断言、回答摘录，
  // 供报告末尾逐条列出
  if (!r.success) {
    const failedComponents = (r.gradingResult?.componentResults || [])
      .filter((c) => c.pass === false)
      .map((c) => `${c.assertion?.type || 'assert'}: ${String(c.reason || '').split('\n')[0].slice(0, 180)}`);
    agg.fails.push({
      description: r.testCase?.description || r.id || '(未命名)',
      question: r.testCase?.vars?.question || '',
      reason: failedComponents.join('；') || r.error || r.failureReason || '断言未通过',
      output: output.slice(0, 300),
    });
  }
}

// 95 分位延迟：排序后取第 95% 位置的值。比平均值更能反映"最卡的那批
// 请求"有多卡 —— 平均值会被大量快请求稀释
function p95(arr) {
  if (arr.length === 0) return null;
  const sorted = [...arr].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * 0.95))];
}

// 毫秒 → "x.x 秒"；没数据（v 为 null）显示 "-"
function fmtMs(v) {
  return v == null ? '-' : `${(v / 1000).toFixed(1)}s`;
}

let provPrompt = 0;
let provCompletion = 0;
let allLatencies = [];
let totalTests = 0;
let totalPass = 0;

// 按固定顺序遍历各类，各生成一行 Markdown 表格（| a | b | c | 格式），
// 同时顺手累计全局的 token、延迟、题数、通过数
const rows = [];
for (const cat of ORDER) {
  const agg = byCategory.get(cat);
  if (!agg) continue;
  const accuracy = agg.total ? ((agg.pass / agg.total) * 100).toFixed(0) : '-';
  rows.push(
    `| ${CATEGORY_LABEL[cat] || cat} | ${agg.total} | ${agg.pass} | ${accuracy}% | ${agg.citations}/${agg.total} | ${fmtMs(agg.latencies.length ? agg.latencies.reduce((a, b) => a + b, 0) / agg.latencies.length : null)} |`,
  );
  provPrompt += agg.tokens.prompt;
  provCompletion += agg.tokens.completion;
  allLatencies = allLatencies.concat(agg.latencies);
  totalTests += agg.total;
  totalPass += agg.pass;
}

// 判定（llm-rubric）消耗的 token，与被测系统分开计费
// 当裁判的也是 qwen-plus，同样要花钱 —— 所以总成本 = 被测系统 + 判定两部分
const gradePrompt = stats?.tokenUsage?.assertions?.prompt ?? 0;
const gradeCompletion = stats?.tokenUsage?.assertions?.completion ?? 0;
const costYuan =
  (provPrompt / 1000) * PRICE_IN +
  (provCompletion / 1000) * PRICE_OUT +
  (gradePrompt / 1000) * PRICE_IN +
  (gradeCompletion / 1000) * PRICE_OUT;

// 总体指标：通过率、引用率，以及"编造风险"代理指标 —— 对抗类和超范围类
// 的失败总数。这两类题考的就是"不编造"，它们的失败数近似等于幻觉次数
const overallAccuracy = totalTests ? ((totalPass / totalTests) * 100).toFixed(1) : '-';
const overallCitations = [...byCategory.values()].reduce((a, b) => a + b.citations, 0);
const riskCats = byCategory.get('adversarial');
const scopeCats = byCategory.get('out-of-scope');
const hallucinationProxy =
  riskCats && scopeCats ? `${(riskCats.total - riskCats.pass) + (scopeCats.total - scopeCats.pass)}/${riskCats.total + scopeCats.total}` : '-';

// 失败用例明细：按类别分小节，每条列出题目、败因断言和回答摘录（截断防超长）
const failLines = [];
for (const cat of ORDER) {
  const agg = byCategory.get(cat);
  if (!agg || agg.fails.length === 0) continue;
  failLines.push(`### ${CATEGORY_LABEL[cat] || cat}`);
  for (const f of agg.fails) {
    failLines.push(
      `- **${f.description}**：${f.question}\n  - 失败断言：${f.reason}\n  - 回答摘录：${f.output.replace(/\n/g, ' ').slice(0, 200)}`,
    );
  }
}

// 报告正文：一个 Markdown 模板字符串，${} 占位符填上面算好的各指标数字
const report = `# AI 知识库问答助手 评测报告

- 评测时间：${new Date().toISOString().slice(0, 19).replace('T', ' ')}
- 被测系统：kb-rag（BFF Agent：search_knowledge + Qwen 流式生成，demo 账号）
- 评测框架：promptfoo（自定义 SSE provider），LLM 判定模型：qwen-plus
- 样本量：${totalTests} 题（事实 10 / 超范围 8 / 对抗 7 / 模糊 5）

## 总体指标

| 指标 | 数值 |
| --- | --- |
| 总体通过率 | ${overallAccuracy}%（${totalPass}/${totalTests}） |
| 引用率（含 [n] 标注的回答占比） | ${totalTests ? ((overallCitations / totalTests) * 100).toFixed(0) : '-'}%（${overallCitations}/${totalTests}） |
| 编造风险（对抗+超范围失败数） | ${hallucinationProxy} |
| 平均延迟 | ${fmtMs(allLatencies.length ? allLatencies.reduce((a, b) => a + b, 0) / allLatencies.length : null)} |
| P95 延迟 | ${fmtMs(p95(allLatencies))} |
| Token 消耗 | 被测系统 prompt ${provPrompt} / completion ${provCompletion}；判定 prompt ${gradePrompt} / completion ${gradeCompletion} |
| 预估总成本 | 约 ¥${costYuan.toFixed(3)}（qwen-plus：输入 ¥0.0008/1K、输出 ¥0.002/1K，按公开牌价估算） |

## 分类指标准确率

| 类别 | 题数 | 通过 | 准确率 | 引用数 | 平均延迟 |
| --- | --- | --- | --- | --- | --- |
${rows.join('\n')}

- 事实类：通过 = 关键数字正确 + 带 [n] 引用 + LLM 判定内容忠于知识库。
- 超范围/对抗类：通过 = 不编造、正确拒绝或纠错（LLM 判定）；对抗类失败数可视为潜在幻觉数。
- 模糊类：通过 = 基于知识库合理组织多个知识点，无编造。

## 失败用例明细

${failLines.length > 0 ? failLines.join('\n') : '（全部通过，无失败用例）'}
`;

// 写出 report.md，并在终端打一行摘要（跑完不用打开文件也能瞄一眼结果）
fs.writeFileSync(outPath, report, 'utf8');
console.log(`report written: ${outPath}`);
console.log(
  `total=${totalTests} pass=${totalPass} accuracy=${overallAccuracy}% cost=¥${costYuan.toFixed(3)} hallucinationRisk=${hallucinationProxy}`,
);
