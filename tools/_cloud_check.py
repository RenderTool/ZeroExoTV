import json
import urllib.request

data = json.load(urllib.request.urlopen("http://127.0.0.1:8188/zeroexo/v1/capabilities", timeout=10))
print([k["kind"] for k in data["kinds"]])
