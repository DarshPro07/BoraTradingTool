import json
from graphify.detect import detect
from pathlib import Path
result = detect(Path('E:/BoraTradingTool'))
print(json.dumps(result, ensure_ascii=False))
