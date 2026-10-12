// ===== 审计日志面板：系统里的"监控回放" =====
// 只读的日志表格，回答"谁、什么时候、从哪个 IP、干了什么"。仅 admin 可用：
// App.tsx 只给 admin 渲染这个 tab，后端 /api/audit 也只对 admin 放行，
// 前后端各拦一道。记录由后端自动写入，前端只负责展示

import { useCallback, useEffect, useState } from 'react';
import { listAudit } from '../api';
import type { AuditEntry } from '../types';

// 后端存的 action 是英文代码（login_fail 这种），这里翻成中文标签。
// Record<string, string> 意思是"键和值都是字符串的字典"
const ACTION_LABELS: Record<string, string> = {
  login: '登录',
  login_fail: '登录失败',
  logout: '退出登录',
  register: '注册',
  document_upload: '上传文档',
  document_delete: '删除文档',
};

// 查上面的映射表；?? 是"左边为 null/undefined 才用右边"—— 查不到
// （后端新增了没配翻译的操作）就原样显示英文，保证表格不空白
function actionLabel(action: string): string {
  return ACTION_LABELS[action] ?? action;
}

// ISO 时间 → 本地化中文格式，和 DocPanel 里的同名函数同一套路
function formatTime(iso: string): string {
  return new Date(iso).toLocaleString('zh-CN', { hour12: false });
}

// detail 的字段随操作类型变化（上传带文件名、登录失败带原因…），没法预先
// 定死类型，后端给的是宽松对象。这里把它的键值对拍平成"键: 值，键: 值"
// 一行文字；没有内容时返回 "—" 占位，比留空白整齐
function formatDetail(detail: Record<string, unknown> | null): string {
  if (!detail || Object.keys(detail).length === 0) return '—';
  return Object.entries(detail)
    .map(([k, v]) => `${k}: ${String(v)}`)
    .join('，');
}

export default function AuditPanel() {
  // 日志列表 + 加载/错误状态，和 DocPanel 同款套路
  const [entries, setEntries] = useState<AuditEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  // 拉取最新日志。useCallback 稳定函数引用 + 下面的 useEffect 挂载时调一次；
  // 头部"刷新"按钮点击时也直接调它
  const refresh = useCallback(async () => {
    setError('');
    try {
      setEntries(await listAudit());
    } catch (err) {
      setError(err instanceof Error ? err.message : '加载审计日志失败');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  return (
    <div className="panel">
      <div className="panel-head">
        <h2>审计日志</h2>
        <button className="btn btn-sm" onClick={() => void refresh()}>
          刷新
        </button>
      </div>

      {error && <div className="panel-error">{error}</div>}

      {loading ? (
        <div className="panel-empty">加载中…</div>
      ) : entries.length === 0 ? (
        <div className="panel-empty">暂无审计记录。</div>
      ) : (
        <table className="table">
          <thead>
            <tr>
              <th>时间</th>
              <th>用户</th>
              <th>操作</th>
              <th>详情</th>
              <th>IP</th>
            </tr>
          </thead>
          <tbody>
            {/* 登录失败的记录整行加警示色（CSS 类 row-warn），异常一眼可见 */}
            {entries.map((e) => (
              <tr key={e.id} className={e.action === 'login_fail' ? 'row-warn' : ''}>
                <td>{formatTime(e.createdAt)}</td>
                {/* ?? ：字段是 null（比如登录失败查不到用户）时显示 "—" 占位 */}
                <td>{e.username ?? '—'}</td>
                <td>
                  <span className={`action-tag action-${e.action}`}>{actionLabel(e.action)}</span>
                </td>
                <td className="cell-detail">{formatDetail(e.detail)}</td>
                <td>{e.ip ?? '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
