import { FormEvent, KeyboardEvent, useEffect, useState } from 'react';
import api from '@/utils/api';
import {
  clearAuthSession,
  getAuthSession,
  installAuthSession,
  restoreAuthSession,
  revokeRefreshSession,
  subscribeAuthSession,
  type AuthSession,
} from '@/auth/session';
import { createThread, listThreads } from '@/threads/threadClient';
import { createRun, getRun } from '@/runs/runClient';
import type { ThreadSummary } from '@/types/threads';
import superMewMark from '@/assets/images/supermew-mark.png';
import superMewMascot from '@/assets/images/supermew-mascot.webp';

type Theme = 'dark' | 'light';
type Nav = 'chat' | 'history' | 'settings' | 'models' | 'capabilities' | 'evaluations';

interface Message {
  id: string;
  isUser: boolean;
  text: string;
}

export default function App() {
  const [theme, setTheme] = useState<Theme>(
    localStorage.getItem('supermew-theme') === 'light' ? 'light' : 'dark'
  );
  const [session, setSession] = useState<AuthSession | null>(getAuthSession());
  const [authResolved, setAuthResolved] = useState(false);
  const [authMode, setAuthMode] = useState<'login' | 'register'>('login');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [adminCode, setAdminCode] = useState('');
  const [role, setRole] = useState<AuthSession['role']>('user');
  const [authLoading, setAuthLoading] = useState(false);
  const [authNotice, setAuthNotice] = useState('');
  const [nav, setNav] = useState<Nav>('chat');
  const [threads, setThreads] = useState<ThreadSummary[]>([]);
  const [threadId, setThreadId] = useState('');
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState('');
  const [sending, setSending] = useState(false);

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    document.documentElement.style.colorScheme = theme;
    localStorage.setItem('supermew-theme', theme);
  }, [theme]);

  useEffect(() => {
    const unsubscribe = subscribeAuthSession(setSession);
    void restoreAuthSession()
      .catch(() => clearAuthSession())
      .finally(() => setAuthResolved(true));
    return unsubscribe;
  }, []);

  useEffect(() => {
    if (session) void listThreads().then(setThreads).catch(() => undefined);
  }, [session?.username]);

  useEffect(() => {
    const handleUnauthorized = () => clearAuthSession();
    window.addEventListener('unauthorized', handleUnauthorized);
    return () => window.removeEventListener('unauthorized', handleUnauthorized);
  }, []);

  const handleAuth = async (event: FormEvent) => {
    event.preventDefault();
    if (!username.trim() || !password) return;
    setAuthLoading(true);
    setAuthNotice('');
    try {
      const payload =
        authMode === 'login'
          ? { username: username.trim(), password }
          : { username: username.trim(), password, role, admin_code: adminCode || null };
      const response = await api.post<AuthSession>(
        authMode === 'login' ? '/auth/login' : '/auth/register',
        payload
      );
      installAuthSession(response.data);
      setPassword('');
      setAdminCode('');
    } catch (error: unknown) {
      setAuthNotice(error instanceof Error ? error.message : '登录失败，请检查账号和密码');
    } finally {
      setAuthLoading(false);
    }
  };

  const logout = async () => {
    setAuthLoading(true);
    await revokeRefreshSession().catch(() => undefined);
    clearAuthSession();
    setThreads([]);
    setMessages([]);
    setThreadId('');
    setAuthLoading(false);
  };

  const sendMessage = async () => {
    const text = input.trim();
    if (!text || !session || sending) return;
    setSending(true);
    setInput('');
    setMessages((current) => [...current, { id: `u-${Date.now()}`, isUser: true, text }]);
    try {
      let targetThreadId = threadId;
      if (!targetThreadId) {
        const thread = await createThread();
        targetThreadId = thread.thread_id;
        setThreadId(targetThreadId);
        setThreads((current) => [
          {
            thread_id: thread.thread_id,
            title: thread.title || '新对话',
            message_count: thread.message_count,
            updated_at: thread.updated_at,
            version: thread.version,
            thread_status: thread.thread_status,
            active_run_id: thread.active_run_id,
            active_run_status: thread.active_run_status,
          },
          ...current,
        ]);
      }
      const created = await createRun(
        targetThreadId,
        { message: text, idempotency_key: globalThis.crypto?.randomUUID?.() || `${Date.now()}` },
        session.access_token
      );
      let run = created.run;
      while (run.status === 'queued' || run.status === 'pending' || run.status === 'running') {
        await new Promise((resolve) => window.setTimeout(resolve, 750));
        run = await getRun(run.id, session.access_token);
      }
      setMessages((current) => [
        ...current,
        {
          id: `a-${run.id}`,
          isUser: false,
          text:
            run.status === 'succeeded'
              ? '消息已提交并完成处理。'
              : run.error?.message || '运行未完成，请稍后重新连接。',
        },
      ]);
    } catch (error: unknown) {
      setMessages((current) => [
        ...current,
        {
          id: `e-${Date.now()}`,
          isUser: false,
          text: error instanceof Error ? error.message : '发送失败，请稍后重试',
        },
      ]);
    } finally {
      setSending(false);
    }
  };

  const onInputKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault();
      void sendMessage();
    }
  };

  return (
    <div className="app-page">
      <div className="aurora-orb aurora-orb-one" aria-hidden="true" />
      <div className="aurora-orb aurora-orb-two" aria-hidden="true" />
      <div className="app-wrapper">
        <aside className="sidebar">
          <div className="sidebar-header">
            <div className="logo-icon"><img src={superMewMark} className="brand-mark-image" alt="" /></div>
            <div className="brand-copy"><h1>喵喵助手</h1><span>Knowledge Copilot</span></div>
          </div>
          <div className="workspace-switcher">
            <span className="workspace-orb" aria-hidden="true" />
            <span className="workspace-copy">
              <strong>SuperMew 知识空间</strong>
              <small>{session ? `${threads.length} 个对话 · 私有` : '登录后连接私有知识'}</small>
            </span>
            <i className="fa-solid fa-chevron-down" aria-hidden="true" />
          </div>
          <nav className="sidebar-nav" aria-label="主导航">
            <button type="button" className={`nav-btn ${nav === 'chat' ? 'active' : ''}`} onClick={() => setNav('chat')}><i className="fa-regular fa-message" /><span>智能对话</span></button>
            <button type="button" className={`nav-btn ${nav === 'history' ? 'active' : ''}`} onClick={() => setNav('history')}><i className="fa-solid fa-clock-rotate-left" /><span>历史对话</span>{threads.length > 0 && <small className="nav-count">{threads.length}</small>}</button>
            {session?.role === 'admin' && <>
              <button type="button" className={`nav-btn ${nav === 'settings' ? 'active' : ''}`} onClick={() => setNav('settings')}><i className="fa-regular fa-bookmark" /><span>知识库</span></button>
              <button type="button" className={`nav-btn ${nav === 'models' ? 'active' : ''}`} onClick={() => setNav('models')}><i className="fa-solid fa-microchip" /><span>模型中心</span></button>
              <button type="button" className={`nav-btn ${nav === 'capabilities' ? 'active' : ''}`} onClick={() => setNav('capabilities')}><i className="fa-solid fa-puzzle-piece" /><span>Skill / Tool</span></button>
              <button type="button" className={`nav-btn ${nav === 'evaluations' ? 'active' : ''}`} onClick={() => setNav('evaluations')}><i className="fa-solid fa-flask-vial" /><span>RAG 评估</span></button>
            </>}
          </nav>
          <div className="sidebar-bottom">
            <div className="theme-control">
              <span className="theme-control-label">
                <i className={theme === 'light' ? 'fa-regular fa-sun' : 'fa-regular fa-moon'} />
                <span>{theme === 'light' ? '浅色模式' : '深色模式'}</span>
              </span>
              <button
                type="button"
                className="theme-toggle"
                role="switch"
                aria-checked={theme === 'light'}
                aria-label={theme === 'light' ? '切换为深色模式' : '切换为浅色模式'}
                onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')}
              >
                <i className="fa-regular fa-sun theme-toggle-icon theme-toggle-sun" aria-hidden="true" />
                <i className="fa-regular fa-moon theme-toggle-icon theme-toggle-moon" aria-hidden="true" />
                <span className="theme-toggle-thumb" aria-hidden="true" />
              </button>
            </div>
            {session && <div className="user-panel"><span className="user-avatar">{session.username.slice(0, 2).toUpperCase()}</span><span className="user-copy"><strong>{session.username}</strong><small>{session.role === 'admin' ? '管理员' : '普通用户'}</small></span><span className="user-actions"><button type="button" title="退出登录" aria-label="退出登录" onClick={() => void logout()}><i className="fa-solid fa-arrow-right-from-bracket" /></button></span></div>}
          </div>
        </aside>

        <main className="main-content">
          {!authResolved ? (
            <section className="auth-page auth-restore-page" role="status"><div className="auth-panel auth-restore-panel"><span className="auth-mini-logo"><img src={superMewMark} className="brand-mark-image" alt="" /></span><i className="fa-solid fa-spinner fa-spin" /><h1>正在恢复登录状态</h1><p>正在安全连接你的私有知识空间…</p></div></section>
          ) : !session ? (
            <section className="auth-page">
              <div className="auth-showcase">
                <div className="auth-showcase-badge"><i className="fa-solid fa-sparkles" /><span>SuperMew Knowledge Copilot</span></div>
                <h2>让每一份知识<br />都有清晰的回声。</h2>
                <p>混合检索、并行 Agent、证据精排与可追溯引用，汇聚在同一个工作台里。</p>
                <div className="auth-feature-list">
                  <div><i className="fa-solid fa-magnifying-glass-chart" /><span><strong>Hybrid RAG</strong><small>Dense + BM25 + Rerank</small></span></div>
                  <div><i className="fa-solid fa-diagram-project" /><span><strong>并行 Agent</strong><small>复杂问题自动拆解与合成</small></span></div>
                  <div><i className="fa-regular fa-file-lines" /><span><strong>可信引用</strong><small>答案与原始证据一一对齐</small></span></div>
                </div>
              </div>
              <div className="auth-panel">
                <div className="auth-panel-heading"><span className="auth-mini-logo"><img src={superMewMark} className="brand-mark-image" alt="" /></span><div><span className="auth-eyebrow">{authMode === 'login' ? 'Welcome back' : 'Create account'}</span><h1>{authMode === 'login' ? '登录喵喵助手' : '注册喵喵助手'}</h1></div></div>
                <p className="auth-description">{authMode === 'login' ? '进入你的私有知识空间，继续上一次对话。' : '创建账号后即可开始对话和保存历史记录。'}</p>
                {authNotice && <p className="operation-notice" role="status">{authNotice}</p>}
                <form className="auth-form" onSubmit={handleAuth}>
                  <label className="form-field"><span>用户名</span><span className="field-input"><i className="fa-regular fa-user" /><input value={username} onChange={(event) => setUsername(event.target.value)} autoComplete="username" placeholder="请输入用户名" /></span></label>
                  <label className="form-field"><span>密码</span><span className="field-input"><i className="fa-solid fa-lock" /><input value={password} onChange={(event) => setPassword(event.target.value)} type="password" autoComplete={authMode === 'login' ? 'current-password' : 'new-password'} placeholder="请输入密码" /></span></label>
                  {authMode === 'register' && <>
                    <label className="form-field"><span>账号角色</span><span className="field-input"><i className="fa-regular fa-id-badge" /><select value={role} onChange={(event) => setRole(event.target.value as AuthSession['role'])}><option value="user">普通用户</option><option value="admin">管理员</option></select></span></label>
                    {role === 'admin' && <label className="form-field"><span>管理员邀请码</span><span className="field-input"><i className="fa-solid fa-key" /><input value={adminCode} onChange={(event) => setAdminCode(event.target.value)} type="password" placeholder="请输入管理员邀请码" /></span></label>}
                  </>}
                  <button className="auth-submit" type="submit" disabled={authLoading}><span>{authLoading ? '正在连接...' : authMode === 'login' ? '进入工作台' : '创建账号'}</span><i className={authLoading ? 'fa-solid fa-spinner fa-spin' : 'fa-solid fa-arrow-right'} /></button>
                </form>
                <div className="auth-divider"><span>或者</span></div>
                <button className="auth-switch" type="button" onClick={() => setAuthMode(authMode === 'login' ? 'register' : 'login')}>{authMode === 'login' ? '还没有账号？创建一个' : '已有账号？返回登录'}</button>
                <p className="auth-footnote">登录即表示你理解 AI 输出需要经过必要的人工复核。</p>
              </div>
            </section>
          ) : nav === 'chat' || nav === 'history' ? (
            <div className="chat-workspace">
              {nav === 'history' && <aside className="history-sidebar"><div className="history-header"><h2>历史对话</h2></div><div className="history-list">{threads.map((thread) => <button key={thread.thread_id} type="button" className={`history-item ${thread.thread_id === threadId ? 'active' : ''}`} onClick={() => { setThreadId(thread.thread_id); setMessages([]); setNav('chat'); }}><strong>{thread.title || '未命名对话'}</strong></button>)}</div></aside>}
              <section className="chat-area">
                <header className="chat-header"><div className="header-info"><h1>{threadId ? '知识对话' : '新对话'}</h1><span className="header-status-line"><span className="status-dot" /><span>{sending ? '喵喵正在生成' : '喵喵在线'}</span></span></div></header>
                <div className="chat-container">
                  {messages.length === 0 ? <section className="welcome-screen"><img src={superMewMascot} className="welcome-avatar" alt="" /><span className="welcome-eyebrow"><i className="fa-solid fa-sparkles" /> 喵喵已准备好</span><h2>你好，我是喵喵。</h2><p>我会检索知识库、展示处理过程，并把关键结论链接回原始证据。</p></section> :
                    messages.map((message) => <article key={message.id} className="chat-message"><div className="message-bubble">{message.text}</div></article>)}
                </div>
                <div className="chat-input"><textarea className="chat-input-textarea" value={input} onChange={(event) => setInput(event.target.value)} onKeyDown={onInputKeyDown} placeholder="和喵喵说点什么吧..." rows={2} /><button type="button" className="chat-send-button" disabled={!input.trim() || sending} onClick={() => void sendMessage()}><i className={sending ? 'fa-solid fa-spinner fa-spin' : 'fa-solid fa-arrow-up'} /></button></div>
              </section>
            </div>
          ) : (
            <section className="chat-area" style={{ width: '100%', padding: 32 }}><h1>{nav === 'settings' ? '知识库' : nav === 'models' ? '模型中心' : nav === 'capabilities' ? 'Skill / Tool 管理' : 'RAG 评估'}</h1></section>
          )}
        </main>
      </div>
    </div>
  );
}
