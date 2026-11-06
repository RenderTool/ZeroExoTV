/**
 * focus-scroll-into-view - 定位聚焦滚动（纯功能行为，无任何动画）
 *
 * 替代已删除的鬼影飞入 + 脉冲高亮装饰动画（2026-11-04 约定删除）：
 * 资产创建 / 副本定位时，仅将目标卡片瞬间滚动到可视区中央。
 */

import { useEffect, useRef, memo } from 'react';

export const FocusScrollIntoView = memo(function FocusScrollIntoView({
  active,
  children,
}: {
  active: boolean;
  children: React.ReactNode;
}): React.ReactElement {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!active || !ref.current) return;
    // 不用 smooth scroll（会导致卡顿），瞬间定位
    ref.current.scrollIntoView({ block: 'center' });
  }, [active]);

  return (
    <div ref={ref} style={{ position: 'relative' }}>
      {children}
    </div>
  );
});
