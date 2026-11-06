/**
 * auth-store —— 本地版占位（Plan#83：无后端、无登录）
 *
 * 保持原导出面 `useAuth()` / `User`，让 30+ 处调用点零改动：
 * 恒为已登录，用户是这台机器上的本地身份（用于资产 storageKey 命名空间）。
 */

export interface User {
  id: string;
  email: string;
  username: string;
  nickname?: string;
  avatarUrl?: string;
  role: string;
}

const LOCAL_ID_KEY = 'zeroexo:localUserId';

function localUserId(): string {
  let id = localStorage.getItem(LOCAL_ID_KEY);
  if (!id) {
    id = `local-${Math.random().toString(36).slice(2, 10)}`;
    localStorage.setItem(LOCAL_ID_KEY, id);
  }
  return id;
}

function localUser(): User {
  return { id: localUserId(), email: '', username: '本地用户', role: 'owner' };
}

export function useAuth(): {
  user: User;
  loading: boolean;
  isAuthenticated: boolean;
  logout: () => Promise<void>;
  refresh: () => Promise<void>;
} {
  return {
    user: localUser(),
    loading: false,
    isAuthenticated: true,
    logout: async () => {
      /* 本地版无登出语义 */
    },
    refresh: async () => {
      /* 本地版无会话刷新 */
    },
  };
}

export function getLocalUser(): User {
  return localUser();
}
