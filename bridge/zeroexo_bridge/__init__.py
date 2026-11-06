"""zeroexo_bridge —— Plan#83 Phase 0 spike 版 ComfyUI 自定义节点。

职责（只做两件，绝不解析导演台内部结构）：
1) 同源托管 zeroexo-comfyui 前端静态目录（免 CORS、免新端口）
2) /zeroexo/proxy 转发云端生成 API（浏览器直连被 CORS 拒时的唯一不新增进程的解）

安装（Phase 0 手动）：把本目录复制进 ComfyUI\\custom_nodes\\，重启 ComfyUI，
然后打开 http://127.0.0.1:8188/zeroexo/spikes/

前端目录由环境变量 ZEROEXO_WEB 指定，默认取包内 web/。
"""

from . import http_routes

NODE_CLASS_MAPPINGS = {}
NODE_DISPLAY_NAME_MAPPINGS = {}
WEB_DIRECTORY = "./web"

__all__ = ["NODE_CLASS_MAPPINGS", "NODE_DISPLAY_NAME_MAPPINGS", "WEB_DIRECTORY"]
