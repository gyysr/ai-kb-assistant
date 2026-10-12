import { memo, useEffect, useMemo, useRef } from 'react';
import * as echarts from 'echarts/core';
import { BarChart, LineChart, PieChart } from 'echarts/charts';
import {
  DatasetComponent,
  GridComponent,
  LegendComponent,
  TitleComponent,
  TooltipComponent,
} from 'echarts/components';
import { CanvasRenderer } from 'echarts/renderers';
import type { EChartsCoreOption } from 'echarts/core';

echarts.use([
  BarChart,
  LineChart,
  PieChart,
  DatasetComponent,
  GridComponent,
  LegendComponent,
  TitleComponent,
  TooltipComponent,
  CanvasRenderer,
]);

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

// 宽容解析：允许模型包一层 `const option = {...};` 或在 JSON 前后带少量说明文字
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

function ChartInner({ option }: { option: EChartsCoreOption }) {
  const ref = useRef<HTMLDivElement>(null);
  const chartRef = useRef<echarts.ECharts | null>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const chart = echarts.init(el, KB_CHART_THEME as never);
    chartRef.current = chart;
    const ro = new ResizeObserver(() => chart.resize());
    ro.observe(el);
    return () => {
      ro.disconnect();
      chart.dispose();
      chartRef.current = null;
    };
  }, []);

  useEffect(() => {
    chartRef.current?.setOption(option, { notMerge: true });
  }, [option]);

  return <div className="md-chart-canvas" ref={ref} />;
}

const ChartInnerMemo = memo(ChartInner);

export default function EChartBlock({ raw, closed }: { raw: string; closed: boolean }) {
  const option = useMemo(() => parseOption(raw), [raw]);

  if (!option) {
    if (!closed) {
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
