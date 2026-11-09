/** 顶栏唯一「服务」入口事件：任意页面的顶栏都可请求打开服务中心。 */
export const OPEN_SERVICE_CENTER_EVENT = 'zeroexo:open-service-center';

export function openServiceCenter(): void {
  window.dispatchEvent(new CustomEvent(OPEN_SERVICE_CENTER_EVENT));
}
