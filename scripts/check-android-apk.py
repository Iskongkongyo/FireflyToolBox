"""Check 16 KiB ELF LOAD and RELRO alignment in the APK's 64-bit libraries."""
import argparse
import struct
import sys
import zipfile


def check_library(stream):
    header = stream.read(64)
    if len(header) != 64 or header[:6] != b"\x7fELF\x02\x01":
        raise ValueError("expected a little-endian ELF64 library")
    offset, = struct.unpack_from("<Q", header, 32)
    size, count = struct.unpack_from("<HH", header, 54)
    if size < 56 or not count or offset + size * count > 1024 * 1024:
        raise ValueError("invalid ELF program headers")
    loads = []
    for index in range(count):
        stream.seek(offset + index * size)
        program = stream.read(56)
        if len(program) != 56:
            raise ValueError("truncated ELF program header")
        kind, _, file_offset, address, _, _, memory_size, alignment = struct.unpack("<IIQQQQQQ", program)
        if kind == 1:  # PT_LOAD
            if alignment < 16384 or (address - file_offset) % 16384:
                raise ValueError(f"LOAD segment is not 16 KiB aligned (alignment={alignment})")
            loads.append(alignment)
        elif kind == 0x6474E552 and (address + memory_size) % 16384:  # PT_GNU_RELRO
            raise ValueError("RELRO segment does not end on a 16 KiB boundary")
    if not loads:
        raise ValueError("no LOAD segments")
    return loads


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("apk")
    args = parser.parse_args()
    with zipfile.ZipFile(args.apk) as archive:
        libraries = [name for name in archive.namelist() if name.startswith(("lib/arm64-v8a/", "lib/x86_64/")) and name.endswith(".so")]
        if not libraries:
            raise ValueError("APK has no 64-bit native libraries to check")
        for name in libraries:
            with archive.open(name) as stream:
                loads = check_library(stream)
            print(f"PASS: {name}: LOAD {loads}; RELRO aligned")


if __name__ == "__main__":
    try:
        main()
    except (ValueError, OSError, zipfile.BadZipFile) as error:
        print(f"FAIL: {error}", file=sys.stderr)
        sys.exit(1)
