//! The reply format for commands that return bytes: `[u32 LE length][JSON metadata][body bytes]`.
//! The frontend splits it again in `decodeFrame` (src/plugins/api.ts).

pub fn encode_frame(meta: &serde_json::Value, body: &[u8]) -> Vec<u8> {
    let meta = serde_json::to_vec(meta).unwrap_or_default();
    let mut out = Vec::with_capacity(4 + meta.len() + body.len());
    out.extend_from_slice(&(meta.len() as u32).to_le_bytes());
    out.extend_from_slice(&meta);
    out.extend_from_slice(body);
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn frame_is_length_meta_body() {
        let frame = encode_frame(&serde_json::json!({"a": 1}), b"xyz");
        assert_eq!(&frame[..4], &7u32.to_le_bytes());
        assert_eq!(&frame[4..11], br#"{"a":1}"#);
        assert_eq!(&frame[11..], b"xyz");
    }
}
