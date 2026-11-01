use crate::ToolError;
use std::fmt::Write;
fn invalid(message: &str) -> ToolError {
    ToolError::new("invalid_unicode", message)
}
pub fn encode(text: &str) -> String {
    let mut out = String::new();
    for unit in text.encode_utf16() {
        let _ = write!(out, "\\u{unit:04X}");
    }
    out
}
pub fn points(text: &str) -> String {
    let mut out = String::new();
    for ch in text.chars() {
        if !out.is_empty() {
            out.push(' ');
        }
        let _ = write!(out, "U+{:04X}", ch as u32);
    }
    out
}
pub fn from_points(text: &str) -> Result<String, ToolError> {
    text.split(|ch: char| ch.is_whitespace() || matches!(ch, ',' | ';' | '，' | '；'))
        .filter(|part| !part.is_empty())
        .map(|part| {
            let hex = part
                .strip_prefix("U+")
                .or_else(|| part.strip_prefix("u+"))
                .ok_or_else(|| invalid("请输入以 U+ 开头的码点，如 U+4F60 U+597D。"))?;
            if hex.is_empty() || hex.len() > 6 || !hex.bytes().all(|b| b.is_ascii_hexdigit()) {
                return Err(invalid("Unicode 码点格式无效。"));
            }
            char::from_u32(u32::from_str_radix(hex, 16).unwrap())
                .ok_or_else(|| invalid("码点超出 Unicode 范围，或属于不能独立使用的代理区。"))
        })
        .collect()
}
pub fn decode(text: &str) -> Result<String, ToolError> {
    let trimmed = text.trim();
    if trimmed.starts_with('"') && trimmed.ends_with('"') {
        return serde_json::from_str::<String>(trimmed)
            .map_err(|_| invalid("JSON 字符串或 Unicode 转义无效，请检查引号和代理对。"));
    }
    let mut chars = text.chars().peekable();
    let mut out = String::new();
    while let Some(ch) = chars.next() {
        if ch != '\\' || chars.peek() != Some(&'u') {
            out.push(ch);
            continue;
        }
        chars.next();
        let code = if chars.peek() == Some(&'{') {
            chars.next();
            let mut hex = String::new();
            let mut closed = false;
            for ch in chars.by_ref() {
                if ch == '}' {
                    closed = true;
                    break;
                }
                if !ch.is_ascii_hexdigit() || hex.len() >= 6 {
                    return Err(invalid("\\u{...} 须包含 1 到 6 位十六进制数字。"));
                }
                hex.push(ch);
            }
            if !closed || hex.is_empty() {
                return Err(invalid("\\u{...} 缺少数字或右大括号。"));
            }
            u32::from_str_radix(&hex, 16).unwrap()
        } else {
            fn unit(chars: &mut impl Iterator<Item = char>) -> Result<u16, ToolError> {
                let hex = chars.take(4).collect::<String>();
                if hex.len() != 4 || !hex.bytes().all(|b| b.is_ascii_hexdigit()) {
                    return Err(invalid("\\uXXXX 须包含 4 位十六进制数字。"));
                }
                Ok(u16::from_str_radix(&hex, 16).unwrap())
            }
            let first = unit(&mut chars)?;
            if (0xD800..=0xDBFF).contains(&first) {
                if chars.next() != Some('\\') || chars.next() != Some('u') {
                    return Err(invalid("高代理位后需要低代理位，如 \\uD83D\\uDE00。"));
                }
                let second = unit(&mut chars)?;
                if !(0xDC00..=0xDFFF).contains(&second) {
                    return Err(invalid("低代理位无效。"));
                }
                0x10000 + (((first as u32 - 0xD800) << 10) | (second as u32 - 0xDC00))
            } else {
                first as u32
            }
        };
        out.push(
            char::from_u32(code)
                .ok_or_else(|| invalid("Unicode 码点超出范围，或包含未配对的代理位。"))?,
        );
    }
    Ok(out)
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn round_trips() {
        let text = "你好😀\n";
        assert_eq!(decode(&encode(text)).unwrap(), text);
        assert_eq!(from_points(&points(text)).unwrap(), text);
        assert_eq!(decode("Hi \\u{1F600} \\u4F60").unwrap(), "Hi 😀 你");
        assert_eq!(decode(r#""\u4F60\u597D\n""#).unwrap(), "你好\n");
    }
    #[test]
    fn rejects_invalid() {
        for text in [
            r"\uD800",
            r"\uDC00",
            r"\uD800\u0041",
            r"\u{110000}",
            r"\u{XYZ}",
            r"\u12",
        ] {
            assert!(decode(text).is_err(), "{text}");
        }
        assert!(from_points("U+D800").is_err());
    }
}
