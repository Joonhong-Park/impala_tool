"""
서버 배포 패키저
서버 실행에 필요한 파일을 zip으로 압축하여 현재 디렉터리에 저장

실행:
    python pack_server.py
    → impala_tool_server_YYYYMMDD_HHMMSS.zip 생성
"""

import zipfile
from datetime import datetime
from pathlib import Path

BASE = Path(__file__).parent

SERVER_FILES = [
    "main.py",
    "requirements.txt",
    "config.yaml",
    "routers",
    "services",
    "templates",
    "static",
]


def main() -> None:
    zip_name = f"impala_tool_server_{datetime.now().strftime('%Y%m%d_%H%M%S')}.zip"
    zip_path = BASE / zip_name

    print(f"[impala_tool 서버 패키저]")
    print(f"출력: {zip_path}\n")

    added = 0
    with zipfile.ZipFile(zip_path, "w", zipfile.ZIP_DEFLATED) as zf:
        for name in SERVER_FILES:
            src = BASE / name
            if not src.exists():
                print(f"  [건너뜀] {name}  (파일 없음)")
                continue

            if src.is_file():
                zf.write(src, name)
                print(f"  {name}")
                added += 1
            else:
                for f in sorted(src.rglob("*")):
                    if f.is_file() and "__pycache__" not in f.parts:
                        arcname = str(f.relative_to(BASE))
                        zf.write(f, arcname)
                        print(f"  {arcname}")
                        added += 1

    print(f"\n완료: {added}개 파일 → {zip_name}")


if __name__ == "__main__":
    main()
