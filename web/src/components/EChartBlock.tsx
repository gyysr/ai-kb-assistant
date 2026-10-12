// ===== 图表块：把模型输出的 ```echarts JSON 渲染成 ECharts 交互图表 =====
// 这个文件通过 React.lazy 按需加载（见 ChatMessage.tsx），所以 echarts 的
// 560KB 不进主包，只在回答里真出现图表时才下载
import { memo, useEffect, useMemo, useRef } from 'react';
// echarts 6 按需引入：只 import 用到的图表类型和组件，最终包体积比
// `import * as echarts from 'echarts'`（全家桶）小一大半
import * as echarts from 'echarts/core';
import { BarChart, LineChart, PieChart } from 'echarts/charts';
import {
  DatasetComponent,
  GridComponent,
  LegendComponent,
  // legend.type:'scroll'（可滚动的图例）需要单独注册这个组件，漏了会白屏不报错
  LegendScrollComponent,
  TitleComponent,
  TooltipComponent,
} from 'echarts/components';
import { CanvasRenderer } from 'echarts/renderers';
import type { EChartsCoreOption } from 'echarts/core';

// "注册"上面挑出来的模块 —— use() 一次，之后 init() 才认这些图表类型
echarts.use([
  BarChart,
  LineChart,
  PieChart,
  DatasetComponent,
  GridComponent,
  LegendComponent,
  LegendScrollComponent,
  TitleComponent,
  TooltipComponent,
  CanvasRenderer,
]);

// 暗色主题：统一配色、坐标轴颜色、tooltip 样式，图表风格跟页面 UI 一致
const KB_CHART_THEME = {
  color: ['#6366f1', '#22d3ee', '#a78bfa', '#34d399', '#fbbf24', '#f472b6'],
  backgroundColor: 'transparent',
  textStyle: { color: '#94a3b8' },
  title: {
    textStyle: { color: '#f1f5f9' },
    subtextStyle: { color: '#64748b' },
  },
  legend: { textStyle: { color: '#94a3b8' } },
  categoryAxis: {
    axisLine: { lineStyle: { color: '#334155' } },
    axisLabel: { color: '#94a3b8' },
    splitLine: { lineStyle: { color: '#1e293b' } },
  },
  valueAxis: {
    axisLine: { lineStyle: { color: '#334155' } },
    axisLabel: { color: '#94a3b8' },
    splitLine: { lineStyle: { color: '#1e293b' } },
  },
  tooltip: {
    backgroundColor: 'rgba(15, 23, 42, 0.95)',
    borderColor: '#334155',
    textStyle: { color: '#e2e8f0' },
  },
};

// 宽容解析：允许模型包一层 `const option = {...};` 或在 JSON 前后带少量说明文字。
// 做法：从第一个 { 或 [ 开始截到最后的 } 或 ]，把中间的当 JSON 解析
function parseOption(raw: string): EChartsCoreOption | null {
  const start = raw.search(/[{[]/);
  if (start < 0) return null;
  const tail = raw.slice(start);
  const end = Math.max(tail.lastIndexOf('}'), tail.lastIndexOf(']'));
  if (end < 0) return null;
  try {
    return JSON.parse(tail.slice(0, end + 1)) as EChartsCoreOption;
  } catch {
    return null;
  }
}

// 模型生成的 option 布局不可控（legend 常被压到 x 轴上），这里强制一套防重叠布局：
// legend 固定顶部（横排可滚动），grid.top 预留 标题+图例 高度，containLabel 防轴标签溢出。
// 为什么"模型写的值会被覆盖"：实测模型会随手写 legend.top:'80%' 之类导致
// 图例叠在折线上，与其教模型排版不如前端统一接管布局
function normalizeLayout(option: EChartsCoreOption): EChartsCoreOption {
  const o = { ...(option as Record<string, unknown>) };
  const hasTitle = o.title != null && o.title !== '';
  const series = Array.isArray(o.series) ? (o.series as Record<string, unknown>[]) : [];
  const hasPie = series.some((s) => s?.type === 'pie');

  // 图例：删掉模型给的上下左右定位，强制放顶部居中；
  // 图例太多时 type:'scroll' 会变成可滚动的一行，而不是挤爆宽度
  const legend = { ...((o.legend as Record<string, unknown>) ?? {}) };
  delete legend.top;
  delete legend.bottom;
  delete legend.left;
  delete legend.right;
  legend.type = 'scroll';
  legend.top = hasTitle ? 32 : 6;
  legend.left = 'center';
  o.legend = legend;

  // 绘图区：containLabel:true = 计算尺寸时把轴标签算进去，长标签不再被裁掉；
  // top 按有没有标题、是不是饼图分档预留，避免标题/图例压住图形
  o.grid = {
    left: 12,
    right: 12,
    bottom: 8,
    containLabel: true,
    top: hasPie ? 46 : hasTitle ? 66 : 42,
  };

  if (hasPie) {
    // 饼图：圆心下移避开顶部图例。注意展开顺序 —— 预设值写在前面、
    // ...s 写在后面，所以模型已显式设置的 center/radius 会覆盖预设
    o.series = series.map((s) =>
      s?.type === 'pie' ? { center: ['50%', '58%'], radius: '62%', ...s } : s,
    );
  }
  return o as EChartsCoreOption;
}

// 真正挂载图表的组件。拆成独立组件 + memo 的原因：
// 流式期间 option 引用每次都变，若不 memo，文本 delta 也会引发图表重渲染
function ChartInner({ option }: { option: EChartsCoreOption }) {
  const ref = useRef<HTMLDivElement>(null);
  const chartRef = useRef<echarts.ECharts | null>(null);

  // 挂载期初始化（只在组件出现/消失时跑一次）
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const chart = echarts.init(el, KB_CHART_THEME as never);
    chartRef.current = chart;
    // 容器尺寸变化（如窗口缩放、侧栏开合）时自动重绘，防止 canvas 拉伸模糊
    const ro = new ResizeObserver(() => chart.resize());
    ro.observe(el);
    // 卸载时的清理：不 dispose 会内存泄漏（canvas 和事件监听都留在内存里）
    return () => {
      ro.disconnect();
      chart.dispose();
      chartRef.current = null;
    };
  }, []);

  // option 变化时重设。notMerge:true = 完全替换旧配置而不是合并，
  // 避免旧系列的残留数据"幽灵"般留在图上
  useEffect(() => {
    chartRef.current?.setOption(normalizeLayout(option), { notMerge: true });
  }, [option]);

  return <div className="md-chart-canvas" ref={ref} />;
}

// memo：option 引用不变就跳过重渲染（option 来自 useMemo，流式期间稳定）
const ChartInnerMemo = memo(ChartInner);

// 对外入口。raw = ```echarts 围栏里的原始文本，closed = 流是否已到收尾围栏
export default function EChartBlock({ raw, closed }: { raw: string; closed: boolean }) {
  // useMemo：raw 不变就不重复解析（流式期间 raw 一直在变，每来一个字解析一次
  // 也可以接受，但 memo 掉更省）
  const option = useMemo(() => parseOption(raw), [raw]);

  if (!option) {
    if (!closed) {
      // JSON 还不完整（流没走完，最后一个 } 还没到）：显示"生成中"占位符
      return <div className="md-chart md-chart-pending">图表生成中…</div>;
    }
    // 流已结束但 JSON 仍解析失败：回退为普通代码块，便于排查模型输出
    return (
      <div className="md-code">
        <div className="md-code-lang">echarts（JSON 解析失败，原文如下）</div>
        <pre>
          <code>{raw}</code>
        </pre>
      </div>
    );
  }
  return (
    <div className="md-chart">
      <ChartInnerMemo option={option} />
    </div>
  );
}
