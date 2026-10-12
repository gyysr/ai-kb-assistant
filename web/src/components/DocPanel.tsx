// ===== 文档管理面板：知识库的"入库窗口" =====
// admin 在这里上传/删除文档，所有用户都能浏览列表。上传的文件会被后端
// 切成小段（chunk）向量化存进 pgvector，之后聊天时按内容相似度被检索出来。
// 权限差异：上传条和删除按钮只有 admin 能看到（后端还会再拦一道，
// 前端隐藏只是体验层）

import { useCallback, useEffect, useRef, useState } from 'react';
import { deleteDocument, listDocuments, uploadDocument } from '../api';
import type { AuthUser, DocumentInfo } from '../types';

// 字节数转成 B/KB/MB 的人类可读格式，纯展示工具
function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

// 后端存的是 ISO 格式时间（如 2025-01-01T08:30:00Z），转成本地化
// 的中文 24 小时制给人看
function formatTime(iso: string): string {
  return new Date(iso).toLocaleString('zh-CN', { hour12: false });
}

// user 是 App 传进来的当前登录用户，本组件用它判断能不能显示上传/删除
export default function DocPanel({ user }: { user: AuthUser }) {
  // 文档列表数据；loading 控制首屏"加载中…"占位
  const [docs, setDocs] = useState<DocumentInfo[]>([]);
  const [loading, setLoading] = useState(true);
  // 错误横幅（红）和成功横幅（绿）的文案，空串 = 不显示
  const [error, setError] = useState('');
  const [uploading, setUploading] = useState(false);
  const [notice, setNotice] = useState('');
  // useRef 是组件的"储物格"：存一个跨渲染不丢失的引用。这里指向文件
  // 选择框 <input type="file">，上传结束后要手动清空它的选择
  const fileRef = useRef<HTMLInputElement>(null);

  // 登录后角色不会再变，直接算一次即可，没必要放进 state
  const isAdmin = user.role === 'admin';

  // 拉取最新文档列表。useCallback 把函数缓存住、保持引用稳定 —— 否则下面
  // useEffect 的依赖每轮渲染都变，会无限重复请求
  const refresh = useCallback(async () => {
    setError('');
    try {
      setDocs(await listDocuments());
    } catch (err) {
      setError(err instanceof Error ? err.message : '加载文档列表失败');
    } finally {
      // 首次加载结束后永远置 false（之后的刷新不回到"加载中"状态）
      setLoading(false);
    }
  }, []);

  // 组件首次挂载时加载一次列表。App 切 tab 只是隐藏/显示面板、不卸载组件，
  // 所以切来切去不会重复请求
  useEffect(() => {
    void refresh();
  }, [refresh]);

  // 上传一个文件。上传走 FormData 而不是 JSON：文件是二进制数据，JSON
  // 塞不下，FormData 是浏览器为"表单带文件"专门设计的格式（api.ts 里组装）。
  // "进度"体现为 uploading 状态：上传期间禁用选择框并显示"解析并入库中…"
  const onUpload = async (file: File) => {
    setUploading(true);
    setError('');
    setNotice('');
    try {
      const r = await uploadDocument(file);
      setNotice(`已上传「${r.filename}」，切分为 ${r.chunkCount} 段`);
      // 上传成功立刻刷新列表：让用户马上看到新文档，而不是等手动刷新
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : '上传失败');
    } finally {
      setUploading(false);
      // 清空文件选择框的值：不清的话，下次选同一个文件不会触发 onChange
      if (fileRef.current) fileRef.current.value = '';
    }
  };

  // 删除文档。先弹 confirm 二次确认 —— 删除会把文档连同它切出的全部分段
  // 从向量库里清掉，不可恢复，值得让用户再想一下
  const onDelete = async (doc: DocumentInfo) => {
    // 用户点了"取消"就直接返回，什么都不做
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
        {/* 上传条只有 admin 可见（普通用户整块不渲染） */}
        {isAdmin && (
          <div className="upload-bar">
            {/* accept 限制文件选择框只能选 PDF/Markdown/TXT；
                选中文件即触发上传，不需要额外的"确定"按钮 */}
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
            {/* 每行一个文档。key 用文档 id：React 靠它认出行与行的对应关系，
                删掉一行时才能精准更新而不是整表重画 */}
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
