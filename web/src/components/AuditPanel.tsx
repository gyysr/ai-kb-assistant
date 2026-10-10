import { useCallback, useEffect, useState } from 'react';
import { listAudit } from '../api';
import type { AuditEntry } from '../types';

const ACTION_LABELS: Record<string, string> = {
  login: '登录',
  login_fail: '登录失败',
  logout: '退出登录',
  register: '注册',
  document_upload: '上传文档',
  document_delete: '删除文档',
};

function actionLabel(action: string): string {
  return ACTION_LABELS[action] ?? action;
}

function formatTime(iso: string): string {
  return new Date(iso).toLocaleString('zh-CN', { hour12: false });
}

function formatDetail(detail: Record<string, unknown> | null): string {
  if (!detail || Object.keys(detail).length === 0) return '—';
  return Object.entries(detail)
    .map(([k, v]) => `${k}: ${String(v)}`)
    .join('，');
}

export default function AuditPanel() {
  const [entries, setEntries] = useState<AuditEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

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
            {entries.map((e) => (
              <tr key={e.id} className={e.action === 'login_fail' ? 'row-warn' : ''}>
                <td>{formatTime(e.createdAt)}</td>
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
