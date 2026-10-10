import { useCallback, useEffect, useRef, useState } from 'react';
import { deleteDocument, listDocuments, uploadDocument } from '../api';
import type { AuthUser, DocumentInfo } from '../types';

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

function formatTime(iso: string): string {
  return new Date(iso).toLocaleString('zh-CN', { hour12: false });
}

export default function DocPanel({ user }: { user: AuthUser }) {
  const [docs, setDocs] = useState<DocumentInfo[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [uploading, setUploading] = useState(false);
  const [notice, setNotice] = useState('');
  const fileRef = useRef<HTMLInputElement>(null);

  const isAdmin = user.role === 'admin';

  const refresh = useCallback(async () => {
    setError('');
    try {
      setDocs(await listDocuments());
    } catch (err) {
      setError(err instanceof Error ? err.message : '加载文档列表失败');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const onUpload = async (file: File) => {
    setUploading(true);
    setError('');
    setNotice('');
    try {
      const r = await uploadDocument(file);
      setNotice(`已上传「${r.filename}」，切分为 ${r.chunkCount} 段`);
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : '上传失败');
    } finally {
      setUploading(false);
      if (fileRef.current) fileRef.current.value = '';
    }
  };

  const onDelete = async (doc: DocumentInfo) => {
    if (!window.confirm(`确定删除文档「${doc.filename}」吗？其 ${doc.chunkCount} 个分段也会一并删除，不可恢复。`)) {
      return;
    }
    setError('');
    setNotice('');
    try {
      await deleteDocument(doc.id);
      setNotice(`已删除「${doc.filename}」`);
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : '删除失败');
    }
  };

  return (
    <div className="panel">
      <div className="panel-head">
        <h2>文档管理</h2>
        {isAdmin && (
          <div className="upload-bar">
            <input
              ref={fileRef}
              type="file"
              accept=".pdf,.md,.markdown,.txt"
              disabled={uploading}
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) void onUpload(f);
              }}
            />
            {uploading && <span className="uploading">解析并入库中…</span>}
          </div>
        )}
      </div>

      {error && <div className="panel-error">{error}</div>}
      {notice && <div className="panel-notice">{notice}</div>}

      {loading ? (
        <div className="panel-empty">加载中…</div>
      ) : docs.length === 0 ? (
        <div className="panel-empty">知识库还没有文档{isAdmin ? '，用上方按钮上传 PDF 或 Markdown' : ''}。</div>
      ) : (
        <table className="table">
          <thead>
            <tr>
              <th>文件名</th>
              <th>类型</th>
              <th>大小</th>
              <th>分段数</th>
              <th>上传时间</th>
              {isAdmin && <th>操作</th>}
            </tr>
          </thead>
          <tbody>
            {docs.map((d) => (
              <tr key={d.id}>
                <td className="cell-name" title={d.filename}>{d.filename}</td>
                <td>{d.fileType.replace('.', '').toUpperCase()}</td>
                <td>{formatSize(d.fileSize)}</td>
                <td>{d.chunkCount}</td>
                <td>{formatTime(d.createdAt)}</td>
                {isAdmin && (
                  <td>
                    <button className="btn btn-danger btn-sm" onClick={() => void onDelete(d)}>
                      删除
                    </button>
                  </td>
                )}
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
