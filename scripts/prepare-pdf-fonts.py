"""Reproduce the vendored PDF fonts with fonttools==4.60.1 and the pinned Noto VF.

Usage: python scripts/prepare-pdf-fonts.py path/to/NotoSansSC-VF.ttf
Normal npm builds copy the resulting static fonts and do not require Python.
"""
from pathlib import Path
import hashlib
import sys
from fontTools.ttLib import TTFont
from fontTools.varLib.instancer import instantiateVariableFont

source = Path(sys.argv[1])
expected = "d68bafcb48a2707749396aa12bbbd833cb70401f3a9a689fd2902c7e0d295964"
if hashlib.sha256(source.read_bytes()).hexdigest() != expected:
    raise SystemExit("Noto source checksum mismatch")
output = Path(__file__).resolve().parents[1] / "src-tauri/builtin-tools/data/pdf-fonts"
output.mkdir(parents=True, exist_ok=True)
for weight, style in [(400, "Regular"), (700, "Bold")]:
    font = TTFont(source, recalcTimestamp=False)
    instantiateVariableFont(font, {"wght": weight}, inplace=True, optimize=True)
    # Distinct derivative family name; preserve the upstream copyright/license.
    for record in font["name"].names:
        names = {1: "Firefly Document", 2: style, 4: "Firefly Document " + style,
                 6: "FireflyDocument-" + style, 16: "Firefly Document", 17: style}
        if record.nameID in names:
            record.string = names[record.nameID].encode(record.getEncoding())
    path = output / ("cjk-" + style.lower() + ".ttf")
    font.save(path)
    print(path.name, path.stat().st_size, hashlib.sha256(path.read_bytes()).hexdigest(), flush=True)
