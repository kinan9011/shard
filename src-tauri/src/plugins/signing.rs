//! Signed indexes. The built-in repositories sign their `index.json`; the app checks `index.json.sig`
//! against the public key below before it reads a byte of the index.
//!
//! The format is the one the updater uses (`npx tauri signer generate` / `signer sign`): minisign, with the
//! key and the signature each wrapped once more in base64. See docs/signing.md.

use base64::{engine::general_purpose::STANDARD, Engine};
use minisign_verify::{PublicKey, Signature};

/// The public key of the built-in repositories, as `npx tauri signer generate` prints it in the `.pub` file.
/// Empty until docs/signing.md has been followed: nothing is checked then, so an unsigned index still works.
pub const INDEX_PUBLIC_KEY: &str = "dW50cnVzdGVkIGNvbW1lbnQ6IG1pbmlzaWduIHB1YmxpYyBrZXk6IDA4NDM1QzI3QzkyRDA0NkIKUldSckJDM0pKMXhEQ05zMm5Idy9aL2JISk5KbDNBTnFleG5MS01TSE5JblhFa3dmRDg3SjZTenAK";

fn text(wrapped: &str, what: &str) -> Result<String, String> {
    let bytes = STANDARD.decode(wrapped.trim()).map_err(|_| format!("The {what} is not base64"))?;
    String::from_utf8(bytes).map_err(|_| format!("The {what} is not text"))
}

/// Checks that `signature` (the content of `index.json.sig`) is the signature of exactly `body` by `public_key`.
pub fn verify(body: &[u8], signature: &str, public_key: &str) -> Result<(), String> {
    let key = PublicKey::decode(&text(public_key, "public key")?).map_err(|error| format!("The public key is not valid: {error}"))?;
    let signature = Signature::decode(&text(signature, "signature")?).map_err(|error| format!("The signature is not valid: {error}"))?;
    key.verify(body, &signature, false).map_err(|_| "The signature does not match the index".to_string())
}

#[cfg(test)]
pub(crate) mod fixtures {
    //! A throwaway key made for these tests with `tauri signer generate`, and an index signed with it.
    pub const BODY: &str = r#"{"schema":1,"name":"Fixture","plugins":[]}"#;
    pub const PUBLIC_KEY: &str = "dW50cnVzdGVkIGNvbW1lbnQ6IG1pbmlzaWduIHB1YmxpYyBrZXk6IDMwRTRBNTg5OTRFQURGRDQKUldUVTMrcVVpYVhrTUNWYWRGemd6SFZBZUROV2V0L2pmVzBiOXBhYlJTODZjeDFJZzZteWJZZjgK";
    pub const SIGNATURE: &str = "dW50cnVzdGVkIGNvbW1lbnQ6IHNpZ25hdHVyZSBmcm9tIHRhdXJpIHNlY3JldCBrZXkKUlVUVTMrcVVpYVhrTUZUc3l6MHFEWGhpYVpkdDF1alhJWGZNUWxzcm9JeVJVU2pXVktCWkVRME1nUlJidzFLTDE2eVlOSnRxZWFnTkwwV0tlaDVYV0E2eXVNSVl2MVgxQmdVPQp0cnVzdGVkIGNvbW1lbnQ6IHRpbWVzdGFtcDoxNzkzNjM4MzkzCWZpbGU6aW5kZXguanNvbgo1aXFWMVh4Q3NFYjNvNnd6OHVuWU5LbVNLSTlMbjlWZ1JiM0hNOXF6WThMa3JrVVRpTzVYTTl0Qm5OK093SGk0dkw5b0w2Q3Y0ZDJ2SEFtTERIdFBBZz09Cg==";
    /// The public key of another pair.
    pub const OTHER_PUBLIC_KEY: &str = "dW50cnVzdGVkIGNvbW1lbnQ6IG1pbmlzaWduIHB1YmxpYyBrZXk6IEFDN0FDMTc5NDhDMDVEQzkKUldUSlhjQkllY0Y2ckl6NnU4UklrNGNOcGphaDQ0dUNnb213dC9WWVZZUlZ5OVRCUVNrbXlEaXQK";
}

#[cfg(test)]
mod tests {
    use super::fixtures::*;
    use super::*;

    #[test]
    fn accepts_the_exact_body_it_signed() {
        verify(BODY.as_bytes(), SIGNATURE, PUBLIC_KEY).unwrap();
        // The .sig file ends with a newline when it is written by a tool.
        verify(BODY.as_bytes(), &format!("{SIGNATURE}\n"), PUBLIC_KEY).unwrap();
    }

    #[test]
    fn refuses_a_changed_body_another_key_and_garbage() {
        let tampered = BODY.replace("Fixture", "Evil");
        assert!(verify(tampered.as_bytes(), SIGNATURE, PUBLIC_KEY).unwrap_err().contains("does not match"));
        assert!(verify(BODY.as_bytes(), SIGNATURE, OTHER_PUBLIC_KEY).is_err());
        assert!(verify(BODY.as_bytes(), "not base64!", PUBLIC_KEY).unwrap_err().contains("signature"));
        assert!(verify(BODY.as_bytes(), SIGNATURE, "not base64!").unwrap_err().contains("public key"));
        assert!(verify(BODY.as_bytes(), "", PUBLIC_KEY).is_err());
    }
}
