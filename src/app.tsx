/**
 * App - 应用根(路由 + 布局装配 + 鉴权守卫)
 *
 * P0.3 重构:
 * - 加载期间(authInitialized=false)显示全屏 Loading,不渲染任何路由
 * - 未认证时仅允许访问 auth 路由,其他路由重定向到 auth/login
 * - 已认证时访问 auth 路由重定向到 home
 *
 * 布局:
 * - home/canvas/assets:顶部栏 + 侧边栏 + 主内容
 * - editor:编辑器自带 TopBar(无顶部栏/侧边栏)
 * - auth:认证页独立布局(无顶部栏/侧边栏)
 *
 * 移动端 NAV 统一:
 * - 主页/画布/素材/提示词 共享一个 MobileNavButton(右上角触发) + MobileNavDrawer
 * - 画布编辑页(EditorPage) 仍走自己的 TopBar,但 TopBar 内部使用同一套 MobileNavDrawer
 * - 按钮统一放右上角,解决主页原本没有显示按钮的问题
 */

import { useEffect, useRef, useState } from 'react';
import { useTheme } from '@zeroexo/plugin-theme';
import { useTranslation } from 'react-i18next';
import { App as AntdApp, message } from 'antd';
import {
  AppLayout,
  AntdThemeProvider,
  MobileNavButton,
  MobileNavDrawer,
  type NavRouteItem,
} from '@/shared/components/index.js';
import { AppSidebar, AppTopBar } from '@/features/app-sidebar/index.js';
import { useIsMobile } from '@/shared/hooks/use-media-query.js';
import { EditorPage } from '@/pages/editor/editor-canvas/editor-page.js';
import { AssetLibraryPage } from '@/features/asset-library/index.js';
import { useAuth } from '@/features/auth/auth-store.js';
import { ErrorBoundary } from '@/shared/components/index.js';
import { CanvasPage } from '@/pages/home/canvas-page.js';
import { AppearanceDialog, LanguageDialog } from '@/shared/components/index.js';
import { RootGate } from '@/platform/RootGate.js';
import { DataRootRecoverGate } from '@/platform/DataRootRecoverGate.js';
import { dataRootState } from '@/platform/fs.js';
import {
  PROJECTS_LIST_PATH,
  setWatchTarget,
  shouldDeferExternalReload,
  shouldForceReloadAfterSkips,
  startExternalWatcher,
  stopExternalWatcher,
} from '@/platform/watcher.js';
import { OPEN_SERVICE_CENTER_EVENT } from '@/features/service-center/service-center-events.js';
import { publishCurrentProject } from '@/platform/current-project.js';
import { publishMcpRequiredManifest } from '@/platform/mcp-manifest.js';
import { purgeOrphanGuides } from '@/entities/guide-purge.js';
import { OnboardingGuide, isOnboardingDone, markOnboardingDone } from '@/features/onboarding/onboarding-guide.js';
import { useComfyuiAutoConnect } from '@/features/canvas-tabs/comfyui-auto-connect.js';

type Route =
  | { name: 'canvas'; canvasId?: string }
  | { name: 'editor'; canvasId: string }
  | { name: 'assets'; defaultGroup?: string; defaultChild?: string; focusId?: string }
  ;

/**
 * 本地版路由（Plan#83，约定：UI 壳不动，仅删页面）：
 *   #/                     → 画布列表（**首页**）
 *   #/canvas/<canvasId>    → 画布列表（指定 id）
 *   #/editor/<canvasId>    → 编辑器
 *   #/assets?group=&child=&focus= → 我的资产
 * 主页（门户）、公共提示词、法律页、登录页、协作邀请页、canvas-v2 均已移除。
 */
function parseHash(hash: string): Route {
  const path = hash.replace(/^#/, '').replace(/^\//, '');
  if (!path) return { name: 'canvas' };
  const parts = path.split('/');
  // 提取基础路径和查询参数
  const firstPart = parts[0] ?? '';
  const qsIndex = firstPart.indexOf('?');
  const basePath = qsIndex >= 0 ? firstPart.substring(0, qsIndex) : firstPart;
  const searchParams = qsIndex >= 0 ? new URLSearchParams(firstPart.substring(qsIndex + 1)) : new URLSearchParams();
  switch (basePath) {
    case 'canvas':
      return parts[1] ? { name: 'canvas', canvasId: decodeURIComponent(parts[1]) } : { name: 'canvas' };
    case 'editor':
      return parts[1] ? { name: 'editor', canvasId: decodeURIComponent(parts[1]) } : { name: 'canvas' };
    case 'assets':
      // 支持查询参数 ?group=prompt&child=favorite&focus=<id>
      return {
        name: 'assets',
        defaultGroup: searchParams.get('group') || undefined,
        defaultChild: searchParams.get('child') || undefined,
        focusId: searchParams.get('focus') || undefined,
      };
    default:
      return { name: 'canvas' };
  }
}

function serializeRoute(route: Route): string {
  switch (route.name) {
    case 'canvas':
      return route.canvasId ? `#/canvas/${encodeURIComponent(route.canvasId)}` : '#/canvas';
    case 'editor':
      return `#/editor/${encodeURIComponent(route.canvasId)}`;
    case 'assets': {
      const qp: string[] = [];
      if (route.defaultGroup) qp.push(`group=${encodeURIComponent(route.defaultGroup)}`);
      if (route.defaultChild) qp.push(`child=${encodeURIComponent(route.defaultChild)}`);
      if (route.focusId) qp.push(`focus=${encodeURIComponent(route.focusId)}`);
      return qp.length > 0 ? `#/assets?${qp.join('&')}` : '#/assets';
    }
    default:
      return '#/canvas';
  }
}


/** 初始路由：本地版无协作邀请链接（/c/<code>），直接读 hash */
function resolveInitialRoute(): Route {
  return parseHash(window.location.hash);
}

// 静态 message（import { message } from 'antd'）同样下移到顶栏之下，
// 与 <AntdApp message={{ top }}> 保持一致，避免 toast 盖住顶栏按钮（2026-11-16 用户反馈）
message.config({ top: 64, maxCount: 3 });

export function App(): React.ReactElement {
  // 刷新页面后自动拿已保存地址探测一次 ComfyUI（不再要求用户每次重连）
  useComfyuiAutoConnect();
  const { isAuthenticated, logout } = useAuth();
  const isMobile = useIsMobile();
  const [route, setRoute] = useState<Route>(() => resolveInitialRoute());

  // 移动端导航抽屉状态(主页/创作/画布/素材/提示词 共享)
  const [mobileNavOpen, setMobileNavOpen] = useState(false);
  // 换肤弹窗状态
  const [appearanceOpen, setAppearanceOpen] = useState(false);
  // 语言设置弹窗(移动端抽屉触发)
  const [languageOpen, setLanguageOpen] = useState(false);
  const [servicesOpen, setServicesOpen] = useState(false);
  /** 首次使用指引（2026-11-10）：数据目录就绪后自动弹一次；主页底部可再次打开 */
  const [onboardingOpen, setOnboardingOpen] = useState(false);

  const { theme } = useTheme();
  const { t, i18n } = useTranslation();

  // 必须先有可用的数据根才能进主界面（本版本不用浏览器存储）
  const [rootReady, setRootReady] = useState<boolean | null>(null);
  /**
   * 启动判定（2026-11-22 收敛）：只有 unauthorized 才拦到首启门。
   * 网页读写本地文件只认浏览器目录授权，没有"服务离线"这种状态。
   */
  useEffect(() => {
    void dataRootState()
      .then((state) => setRootReady(state === 'ok'))
      .catch(() => setRootReady(false));
  }, []);

  // 首次使用指引：只在数据目录就绪且没看过时弹一次（看过标记写 localStorage）
  useEffect(() => {
    if (rootReady && !isOnboardingDone()) setOnboardingOpen(true);
  }, [rootReady]);

  // 把「前端要求的 MCP 工具清单」写给 MCP：旧版服务连上来时，Agent 工具自己就会提示更新
  useEffect(() => {
    if (!rootReady) return;
    // 数据根只认服务端配置（data-root.txt）：网页不再用 localStorage 里可能过期的路径覆盖它，
    // 否则换目录/测试后旧值会把整套项目悄悄切到另一个磁盘根（表现为项目列表消失、画布空白）。
    void publishMcpRequiredManifest();
  }, [rootReady]);

  useEffect(() => {
    if (!rootReady) return;
    void publishMcpRequiredManifest();
  }, [rootReady]);

  // CAS 引用对账巡检（2026-11-16）：【紧急停用】对账的扫描覆盖面未审计完成即上线，
  // 出现主体/历史媒体被误回收（引用已失效）。恢复前必须先修复 cas-reconcile 的
  // ref 身份覆盖与项目清单完整性两个漏洞，并经用户确认。
  useEffect(() => {
    if (!rootReady) return;
    void 0;
  }, [rootReady]);

  // 孤立媒体清理【2026-11-22 用户红线：已停用】
  // 原逻辑每天自动跑一次 purgeOrphanMedia，直接删「没有任何引用」的 CAS 文件与索引外残留。
  // 危险点：引用索引只要在某一刻不完整（目录未授权 / 项目未加载完 / 清单读取失败），
  // 就会被判成"无引用"而删掉真文件——这类不可逆删除一次都不能发生。
  // 现在不自动删任何 CAS 文件；需要清理时由用户在存储面板显式勾选（只报告，不静默删）。
  useEffect(() => {
    if (!rootReady) return;
    // 有意为空：不执行任何删除。保留 effect 位置，后续接"只读统计"时在这里实现。
    void 0;
  }, [rootReady]);

  // 引导缓存回收（2026-11-17）：导演台引导帧一帧几百 MB，删项目/删片段后必须回收。
  // 每天最多一次；任何项目读不到 → guide-purge 自己整轮跳过，不会误删。
  useEffect(() => {
    if (!rootReady) return;
    const KEY = 'zeroexo:guide-purge:lastRun';
    const DAY = 24 * 60 * 60 * 1000;
    const last = Number(window.localStorage.getItem(KEY) ?? 0);
    if (Number.isFinite(last) && Date.now() - last < DAY) return;
    void (async () => {
      try {
        const res = await purgeOrphanGuides();
        window.localStorage.setItem(KEY, String(Date.now()));
        if (res.removed > 0) console.info(`[guide-purge] 已回收 ${res.removed} 个无引用引导缓存`);
        if (res.skipped) console.info(`[guide-purge] 本轮跳过：${res.skipped}`);
      } catch {
        // 目录未授权 / 离线：下次再试
      }
    })();
  }, [rootReady]);

  // 数据目录授权可能在会话中失效（权限被撤销 / 句柄丢失）——
  // 定期 + 窗口聚焦时复查：失效就重新弹首启门（否则本地存储全部报
  // 「No available storage method found」，界面半死不活）
  useEffect(() => {
    if (!rootReady) return;
    const check = (): void => {
      void dataRootState()
        .then((state) => {
          setRootReady(state === 'ok');
        })
        .catch(() => { /* 探测异常不降级门禁：误判会把用户赶回选目录页 */ });
    };
    const timer = window.setInterval(check, 15000);
    window.addEventListener('focus', check);
    return () => {
      window.clearInterval(timer);
      window.removeEventListener('focus', check);
    };
  }, [rootReady]);

  // ===== 外部变更监听（MCP stdio 服务写同一数据目录，网页侧轮询对账）=====
  // 当前项目 id（entities 三件套的监听目标）；列表页/资产页为 null
  const activeProjectIdRef = useRef<string | null>(null);
  useEffect(() => {
    const pid = route.name === 'assets' ? null : route.canvasId ?? null;
    activeProjectIdRef.current = pid;
    setWatchTarget(pid);
    // 把「当前打开的项目」广播到数据根：MCP 的 get_current_project 读它，
    // Agent 才能先报出「你正在看的是 X」再由用户确认，而不是反问用户操作哪个项目。
    void publishCurrentProject(pid);
  }, [route]);

  // projects.json 外部变化时递增 → CanvasPage remount → useProjects().refresh() 重载项目列表
  const [listEpoch, setListEpoch] = useState(0);

  // ===== reload 守卫（防丢输入）：外部变更整页刷新前，输入中/失焦先延后 =====
  // 输入探针：焦点在 textarea/input/contentEditable 且敲了可见字符 → 记时间戳
  const lastTypingAtRef = useRef(0);
  useEffect(() => {
    const onKeydown = (e: KeyboardEvent): void => {
      const el = document.activeElement as HTMLElement | null;
      if (!el) return;
      const editable = el.tagName === 'TEXTAREA' || el.tagName === 'INPUT' || el.isContentEditable;
      if (editable && e.key.length === 1) lastTypingAtRef.current = Date.now();
    };
    window.addEventListener('keydown', onKeydown, true);
    return () => window.removeEventListener('keydown', onKeydown, true);
  }, []);
  const deferredReloadsRef = useRef(0);

  useEffect(() => {
    if (!rootReady) return;
    startExternalWatcher({
      target: activeProjectIdRef.current,
      onExternalChange: (paths) => {
        console.info('[watcher] 外部变更:', paths);
        if (paths.includes(PROJECTS_LIST_PATH)) {
          // 项目列表变化 → 重载列表（利用 useProjects 挂载即刷新的既有入口）
          setListEpoch((e) => e + 1);
        }
        if (paths.some((p) => p.endsWith('/storyboard.json') || p.endsWith('/workbench.json'))) {
          // 主体库/导演台容器没有现成的外部变更重读入口 → 整页刷新兜底；
          // script.json 不在此列：script-store 的 watchScript（2s 轮询）已把变更推给订阅组件
          const typingRecently = Date.now() - lastTypingAtRef.current < 2000;
          if (shouldDeferExternalReload({ hasFocus: document.hasFocus(), typingRecently })) {
            // 输入中/失焦：跳过本轮，等 watcher 下一轮 2.5s 对账自然重试；
            // 连续跳过超过 3 轮（约 10s）→ 强制刷新，外部更新不能永远看不到
            deferredReloadsRef.current += 1;
            if (shouldForceReloadAfterSkips(deferredReloadsRef.current)) {
              message.info('导演台有外部更新，已刷新');
              window.location.reload();
            } else {
              console.info('[watcher] 输入中/失焦，延后本轮外部变更刷新');
            }
            return;
          }
          deferredReloadsRef.current = 0;
          console.info('[watcher] storyboard/workbench 外部变更，无既有重读入口，整页刷新兜底');
          window.location.reload();
        }
      },
    });
    return () => stopExternalWatcher();
  }, [rootReady]);

  // 本地版无路由守卫：无登录态、无公开路由概念（数据就在用户自己选的目录里）

  // 路由 → URL hash 同步(支持刷新/分享链接/浏览器前进后退)
  // 初次恢复用 replaceState(避免污染历史),后续导航用 pushState(支持后退)
  const isInitialHashSync = useRef(true);
  useEffect(() => {
    const expected = serializeRoute(route);
    if (window.location.hash !== expected) {
      if (isInitialHashSync.current) {
        window.history.replaceState(null, '', expected);
      } else {
        window.history.pushState(null, '', expected);
      }
    }
    isInitialHashSync.current = false;
  }, [route]);

  // 监听浏览器前进/后退(hashchange),同步到 route
  useEffect(() => {
    const onHashChange = (): void => {
      const next = parseHash(window.location.hash);
      setRoute((prev) => (serializeRoute(prev) === serializeRoute(next) ? prev : next));
    };
    window.addEventListener('hashchange', onHashChange);
    window.addEventListener('popstate', onHashChange);
    return () => {
      window.removeEventListener('hashchange', onHashChange);
      window.removeEventListener('popstate', onHashChange);
    };
  }, []);

  // 顶栏唯一「服务」入口：由任意页面的顶栏广播打开
  useEffect(() => {
    const openServices = (): void => setServicesOpen(true);
    window.addEventListener(OPEN_SERVICE_CENTER_EVENT, openServices);
    return () => window.removeEventListener(OPEN_SERVICE_CENTER_EVENT, openServices);
  }, []);

  // 需要显示顶部栏 + 侧边栏的路由（画布列表与资产页套主布局；editor 为全屏独立画布页，自带 TopBar）
  const showHeaderAndSidebar = route.name !== 'editor' && !(route.name === 'canvas' && !!route.canvasId);

  // 当前活跃路由名（用于侧边栏高亮）
  const activeRoute = route.name === 'canvas' ? 'canvas' : route.name === 'assets' ? 'assets' : '';

  /** 侧边栏导航回调（签名沿用 AppSidebar/AppTopBar/MobileNavDrawer 契约，canvas/assets/openlib 可达） */
  const handleNavigate = (target: 'home' | 'canvas' | 'assets' | 'publicPrompts' | 'policies' | { name: 'auth'; mode: 'login' }): void => {
    if (target === 'canvas' || target === 'assets') {
      setRoute({ name: target } as Route);
      return;
    }
    // 主页/公共提示词/政策页/登录已移除：其余导航一律回首页（画布列表）
    setRoute({ name: 'canvas' });
  };

  // 抽屉导航项（本地版：首页=画布列表 + 我的资产 + 开源资产库）
  const navItems: NavRouteItem[] = [
    { key: 'canvas', label: t('nav.canvas') },
    { key: 'assets', label: t('nav.assets') },
  ];

  return (
    <AntdThemeProvider>
      {/* message 弹出位置下移到顶栏之下（top 默认 8px 会盖住顶栏按钮，2026-11-16 用户反馈） */}
      <AntdApp message={{ top: 64, maxCount: 3 }}>
        {/* 全局图标 hover 动画样式 */}
        <style>{`
          .zeroexo-icon-btn {
            transition: all 0.2s cubic-bezier(0.34, 1.56, 0.64, 1) !important;
          }
          .zeroexo-icon-btn:hover {
            transform: scale(1.1) !important;
          }
          .zeroexo-icon-btn:active {
            transform: scale(0.95) !important;
          }
          @keyframes zeroexo-pulse {
            0%, 100% { opacity: 1; }
            50% { opacity: 0.35; }
          }
          /* 移动端防溢出:确保 html/body 不会有滚动条,且任何 div 都不会顶到 viewport 外 */
          html, body, #root {
            margin: 0;
            padding: 0;
            width: 100%;
            max-width: 100vw;
            overflow: hidden;
            overscroll-behavior: none;
          }
          body {
            position: fixed;
            top: 0;
            left: 0;
            right: 0;
            bottom: 0;
            -webkit-overflow-scrolling: touch;
          }
          @media (max-width: 768px) {
            html, body, #root {
              max-height: 100dvh;
            }
          }
        `}</style>
        {rootReady ? (
          <>
            <AppLayout
          isMobile={isMobile}
          header={showHeaderAndSidebar && !isMobile ? (
            <AppTopBar
              onNavigate={handleNavigate}
              activeRoute={activeRoute}
              onRequestAppearance={() => setAppearanceOpen(true)}
            />
          ) : undefined}
          sidebar={showHeaderAndSidebar && !isMobile ? (
            <AppSidebar activeRoute={activeRoute} onNavigate={handleNavigate} />
          ) : undefined}
          mobileNavTrigger={isMobile && showHeaderAndSidebar ? (
            <MobileNavButton onClick={() => setMobileNavOpen(true)} title={t('nav.menu')} />
          ) : undefined}
          mobileNavDrawer={isMobile && showHeaderAndSidebar ? (
            <MobileNavDrawer
              theme={theme}
              open={mobileNavOpen}
              onClose={() => setMobileNavOpen(false)}
              navItems={navItems}
              activeKey={activeRoute}
              onNavigate={(key) => handleNavigate(key)}
              onOpenAppearance={() => setAppearanceOpen(true)}
              onOpenLanguage={() => setLanguageOpen(true)}
              isAuthenticated={isAuthenticated}
              onLogin={() => handleNavigate({ name: 'auth', mode: 'login' })}
              onLogout={async () => {
                await logout();
                handleNavigate({ name: 'auth', mode: 'login' });
              }}
            />
          ) : undefined}
        >
          <ErrorBoundary>
            {route.name === 'canvas' ? (
              route.canvasId ? (
                <EditorPage
                  key={route.canvasId}
                  canvasId={route.canvasId}
                  onBack={() => setRoute({ name: 'canvas' })}
                  onOpenProject={(id) => setRoute({ name: 'editor', canvasId: id })}
                />
              ) : (
                /* 首页 = 画布列表（原「新建画布页」顶替主页位置）；key=listEpoch：projects.json 外部变化时 remount 重载列表 */
                <CanvasPage
                  key={listEpoch}
                  onOpen={(id) => setRoute({ name: 'editor', canvasId: id })}
                />
              )
            ) : route.name === 'editor' ? (
              <EditorPage
                key={route.canvasId}
                canvasId={route.canvasId}
                onBack={() => setRoute({ name: 'canvas' })}
                onOpenProject={(id) => setRoute({ name: 'editor', canvasId: id })}
              />
            ) : (
              /* 我的资产（保留） */
              <AssetLibraryPage
                defaultGroup={route.defaultGroup}
                defaultChild={route.defaultChild}
                focusId={route.focusId}
                onNavigateHome={() => setRoute({ name: 'canvas' })}
              />
            )}
          </ErrorBoundary>
        </AppLayout>
          </>
        ) : (
          <RootGate open onActivated={() => setRootReady(true)} />
        )}

        {/* 运行期目录权限失效：只在 isAuthorized=false 时弹出，不拿长文案让用户自己找 */}
        <DataRootRecoverGate />

        {/* 换肤弹窗(全局唯一) */}
        {appearanceOpen ? (
          <AppearanceDialog
            theme={theme}
            currentMode={theme.mode}
            onClose={() => setAppearanceOpen(false)}
          />
        ) : null}

        {/* 语言设置弹窗(移动端抽屉触发) */}
        {languageOpen ? (
          <LanguageDialog
            theme={theme}
            currentLang={(i18n.language as any) || 'zh'}
            onClose={() => setLanguageOpen(false)}
          />
        ) : null}

        {/* 服务 / 使用指引：同一个页面（顶栏「服务」与主页「使用指引」都开它） */}
        <OnboardingGuide
          open={onboardingOpen || servicesOpen}
          onClose={() => {
            markOnboardingDone();
            setOnboardingOpen(false);
            setServicesOpen(false);
          }}
        />

        {/* 任务队列已移入资产抽屉的独立「任务」分组（2026-11-15 用户指令） */}
      </AntdApp>
    </AntdThemeProvider>
  );
}
