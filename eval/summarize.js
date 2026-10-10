// 汇总 promptfoo results.json → report.md
const fs = require('fs');
const path = require('path');

// qwen-plus 价格假设（元 / 1K tokens）
const PRICE_IN = 0.0008;
const PRICE_OUT = 0.002;

const resultsPath = path.join(__dirname, 'results.json');
const outPath = path.join(__dirname, 'report.md');

const parsed = JSON.parse(fs.readFileSync(resultsPath, 'utf8'));
let results;
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

function categoryOf(r) {
  const cat = r.testCase?.metadata?.category;
  if (cat) return cat;
  const d = r.testCase?.description || '';
  const prefix = d.split(/[-\s]/)[0];
  return prefix || 'unknown';
}

const citationRe = /\[\d+\]/;
const CATEGORY_LABEL = {
  fact: '事实类',
  'out-of-scope': '超范围类',
  adversarial: '对抗类',
  ambiguous: '模糊类',
  unknown: '未分类',
};
const ORDER = ['fact', 'out-of-scope', 'adversarial', 'ambiguous', 'unknown'];

const byCategory = new Map();
for (const r of results) {
  const cat = categoryOf(r);
  if (!byCategory.has(cat)) {
    byCategory.set(cat, { total: 0, pass: 0, citations: 0, latencies: [], tokens: { prompt: 0, completion: 0 }, fails: [] });
  }
  const agg = byCategory.get(cat);
  agg.total += 1;
  if (r.success) agg.pass += 1;
  const output = String(r.response?.output ?? '');
  if (citationRe.test(output)) agg.citations += 1;
  const latency = r.response?.latencyMs ?? r.latencyMs ?? null;
  if (latency != null) agg.latencies.push(latency);
  const tu = r.response?.tokenUsage;
  if (tu) {
    agg.tokens.prompt += tu.prompt || 0;
    agg.tokens.completion += tu.completion || 0;
  }
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

function p95(arr) {
  if (arr.length === 0) return null;
  const sorted = [...arr].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * 0.95))];
}

function fmtMs(v) {
  return v == null ? '-' : `${(v / 1000).toFixed(1)}s`;
}

let provPrompt = 0;
let provCompletion = 0;
let allLatencies = [];
let totalTests = 0;
let totalPass = 0;

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
const gradePrompt = stats?.tokenUsage?.assertions?.prompt ?? 0;
const gradeCompletion = stats?.tokenUsage?.assertions?.completion ?? 0;
const costYuan =
  (provPrompt / 1000) * PRICE_IN +
  (provCompletion / 1000) * PRICE_OUT +
  (gradePrompt / 1000) * PRICE_IN +
  (gradeCompletion / 1000) * PRICE_OUT;

const overallAccuracy = totalTests ? ((totalPass / totalTests) * 100).toFixed(1) : '-';
const overallCitations = [...byCategory.values()].reduce((a, b) => a + b.citations, 0);
const riskCats = byCategory.get('adversarial');
const scopeCats = byCategory.get('out-of-scope');
const hallucinationProxy =
  riskCats && scopeCats ? `${(riskCats.total - riskCats.pass) + (scopeCats.total - scopeCats.pass)}/${riskCats.total + scopeCats.total}` : '-';

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

fs.writeFileSync(outPath, report, 'utf8');
console.log(`report written: ${outPath}`);
console.log(
  `total=${totalTests} pass=${totalPass} accuracy=${overallAccuracy}% cost=¥${costYuan.toFixed(3)} hallucinationRisk=${hallucinationProxy}`,
);
