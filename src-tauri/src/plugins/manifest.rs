//! `plugin.json` structs and validation. Mirrors `src/plugins/schema.ts`; this side is the install
//! gate, so it also checks what needs the package on disk (entry file) and the builtin id list.

use crate::paths::resolve_inside;
use serde::{Deserialize, Serialize};
use std::path::Path;

pub const PERMISSION_NAMES: &[&str] =
    &["clipboard:read", "clipboard:write", "files:open", "files:save", "network", "storage"];

/// Ids of the tools built into the app (`ALL_TOOLS` in `src/app/toolRegistry.ts`). A plugin may not
/// reuse one. `tests/plugins/schema.test.ts` fails when this list drifts from the registry.
pub const BUILTIN_TOOL_IDS: &[&str] = &[
    "json-viewer",
    "code-playground",
    "regex-generator",
    "json-typescript",
    "json-schema",
    "json-diff",
    "certificate-decoder",
    "html-preview",
    "code-formatter",
    "semver",
    "password-generator",
    "lorem-generator",
    "qr-generator",
    "bcrypt-generator",
    "random-string",
    "key-generator",
    "base64",
    "case-converter",
    "number-base",
    "url-encoder",
    "csv-json",
    "yaml-json",
    "escape-tools",
    "html-to-jsx",
    "svg-to-css",
    "php-tools",
    "compression",
    "curl-to-code",
    "ip-cidr",
    "har-viewer",
    "timestamp",
    "date-difference",
    "date-format",
    "image-converter",
    "qr-reader",
    "diff-merge",
    "text-compare",
    "jwt-decoder",
    "api-formatter",
    "string-inspector",
    "line-tools",
    "unit-converter",
    "chmod-calculator",
    "image-metadata",
    "video-metadata",
    "secret-redactor",
    "token-counter",
    "ai-text-cleaner",
    "xml-inspector",
    "checksum",
    "asn1-inspector",
    "stopwatch",
    "time-zone-converter",
    "mermaid-renderer",
];

#[derive(Serialize, Deserialize, Debug, Clone, Copy, PartialEq, Eq)]
pub enum Runtime {
    #[serde(rename = "web")]
    Web,
    #[serde(rename = "wasm")]
    Wasm,
    #[serde(rename = "web+wasm")]
    WebWasm,
}

#[derive(Serialize, Deserialize, Debug, Clone, PartialEq)]
pub struct Permission {
    #[serde(default)]
    pub name: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub hosts: Option<Vec<String>>,
    #[serde(default)]
    pub reason: String,
    #[serde(default)]
    pub optional: bool,
}

#[derive(Serialize, Deserialize, Debug, Clone, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Manifest {
    #[serde(default)]
    pub id: String,
    #[serde(default)]
    pub name: String,
    #[serde(default)]
    pub version: String,
    #[serde(default)]
    pub description: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub long_description: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub category: Option<String>,
    #[serde(default)]
    pub keywords: Vec<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub icon: Option<String>,
    #[serde(default)]
    pub entry: String,
    pub runtime: Runtime,
    #[serde(default)]
    pub permissions: Vec<Permission>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub min_app_version: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub license: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub source: Option<String>,
    #[serde(default)]
    pub screenshots: Vec<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub changelog: Option<String>,
}

/// `^[a-z0-9][a-z0-9-]{1,63}$`
pub(crate) fn valid_id(id: &str) -> bool {
    let bytes = id.as_bytes();
    (2..=64).contains(&bytes.len())
        && (bytes[0].is_ascii_lowercase() || bytes[0].is_ascii_digit())
        && bytes[1..].iter().all(|b| b.is_ascii_lowercase() || b.is_ascii_digit() || *b == b'-')
}

/// Strict semver (build metadata allowed): `semver::Version` rejects a leading `v` and partial versions.
pub(crate) fn valid_version(version: &str) -> bool {
    semver::Version::parse(version).is_ok()
}

/// `[*.]host[:port]` with no scheme, path or whitespace.
pub(crate) fn valid_host(host: &str) -> bool {
    let (name, port) = match host.rsplit_once(':') {
        Some((name, port)) => (name, Some(port)),
        None => (host, None),
    };
    if port.is_some_and(|p| p.is_empty() || !p.bytes().all(|b| b.is_ascii_digit()) || p.parse::<u16>().is_err()) {
        return false;
    }
    let name = name.strip_prefix("*.").unwrap_or(name);
    !name.is_empty()
        && name.split('.').all(|label| {
            !label.is_empty()
                && !label.starts_with('-')
                && !label.ends_with('-')
                && label.bytes().all(|b| b.is_ascii_alphanumeric() || b == b'-')
        })
}

impl Manifest {
    /// Checks every rule and returns all violations, so the install dialog can show them at once.
    /// `root` is the unpacked package folder.
    pub fn validate(&self, root: &Path) -> Result<(), Vec<String>> {
        let mut errors = self.field_errors();
        match resolve_inside(root, &self.entry) {
            Ok(path) if path.is_file() => {}
            Ok(_) => errors.push(format!("entry: \"{}\" does not exist in the package", self.entry)),
            Err(_) => errors.push(format!("entry: \"{}\" must be a file inside the package", self.entry)),
        }
        if errors.is_empty() {
            Ok(())
        } else {
            Err(errors)
        }
    }

    /// The rules that need no package on disk (everything but the entry file). A repository can check
    /// a release's `plugin.json` with these before anything is downloaded.
    pub(crate) fn field_errors(&self) -> Vec<String> {
        let mut errors = Vec::new();
        if !valid_id(&self.id) {
            errors.push(format!("id: \"{}\" must match ^[a-z0-9][a-z0-9-]{{1,63}}$", self.id));
        } else if BUILTIN_TOOL_IDS.contains(&self.id.as_str()) {
            errors.push(format!("id: \"{}\" is already used by a built-in tool", self.id));
        }
        if self.name.is_empty() {
            errors.push("name: must not be empty".into());
        }
        if self.description.is_empty() {
            errors.push("description: must not be empty".into());
        }
        if !valid_version(&self.version) {
            errors.push(format!("version: \"{}\" is not a valid semver version", self.version));
        }
        if let Some(min) = &self.min_app_version {
            if !valid_version(min) {
                errors.push(format!("minAppVersion: \"{min}\" is not a valid semver version"));
            }
        }
        if let Some(source) = &self.source {
            if !(source.starts_with("https://") || source.starts_with("http://")) {
                errors.push(format!("source: \"{source}\" must be an http(s) URL"));
            }
        }
        for (field, value) in [("category", &self.category), ("icon", &self.icon), ("license", &self.license), ("changelog", &self.changelog)] {
            if value.as_deref() == Some("") {
                errors.push(format!("{field}: must not be empty"));
            }
        }
        errors.extend(permission_errors("permissions", &self.permissions));
        errors
    }
}

/// Problems in a `permissions` list, each prefixed with `<prefix>[i]` (the manifest and the repository
/// index use the same shape).
pub(crate) fn permission_errors(prefix: &str, permissions: &[Permission]) -> Vec<String> {
    let mut errors = Vec::new();
    for (i, permission) in permissions.iter().enumerate() {
        if !PERMISSION_NAMES.contains(&permission.name.as_str()) {
            errors.push(format!(
                "{prefix}[{i}].name: \"{}\" is not a known permission (use one of {})",
                permission.name,
                PERMISSION_NAMES.join(", ")
            ));
        }
        if permission.reason.is_empty() {
            errors.push(format!("{prefix}[{i}].reason: must not be empty"));
        }
        if permission.name == "network" {
            match permission.hosts.as_deref() {
                None | Some([]) => errors.push(format!("{prefix}[{i}].hosts: network needs at least one host")),
                Some(hosts) => {
                    for host in hosts.iter().filter(|h| !valid_host(h)) {
                        errors.push(format!("{prefix}[{i}].hosts: \"{host}\" must look like host[:port] or *.host[:port]"));
                    }
                }
            }
        } else if permission.hosts.is_some() {
            errors.push(format!("{prefix}[{i}].hosts: only the network permission takes hosts"));
        }
    }
    errors
}

/// Reads and validates `<root>/plugin.json`.
pub fn read(root: &Path) -> Result<Manifest, Vec<String>> {
    let text = std::fs::read_to_string(root.join("plugin.json"))
        .map_err(|error| vec![format!("plugin.json: cannot be read ({error})")])?;
    let manifest: Manifest =
        serde_json::from_str(&text).map_err(|error| vec![format!("plugin.json: {error}")])?;
    manifest.validate(root)?;
    Ok(manifest)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::path::PathBuf;

    fn fixture(name: &str) -> PathBuf {
        Path::new(env!("CARGO_MANIFEST_DIR")).join("tests/fixtures/plugins").join(name)
    }

    fn errors(name: &str) -> String {
        read(&fixture(name)).expect_err("fixture should be rejected").join("\n")
    }

    #[test]
    fn accepts_minimal_and_full_manifests() {
        let minimal = read(&fixture("good-minimal")).unwrap();
        assert_eq!(minimal.id, "hello-tool");
        assert_eq!(minimal.runtime, Runtime::Web);
        assert!(minimal.permissions.is_empty());
        let full = read(&fixture("good-full")).unwrap();
        assert_eq!(full.runtime, Runtime::WebWasm);
        assert_eq!(full.permissions.len(), 3);
        assert!(full.permissions[2].optional);
    }

    #[test]
    fn rejects_bad_id_version_and_builtin_id() {
        assert!(errors("bad-id").contains("id: \"Bad_ID\""));
        assert!(errors("bad-version").contains("version: \"v1.0\""));
        assert!(errors("builtin-id").contains("already used by a built-in tool"));
    }

    #[test]
    fn rejects_entry_that_is_missing_or_escapes() {
        assert!(errors("missing-entry").contains("does not exist in the package"));
        assert!(errors("entry-escape").contains("must be a file inside the package"));
    }

    #[test]
    fn rejects_bad_permissions() {
        assert!(errors("unknown-permission").contains("\"camera\" is not a known permission"));
        assert!(errors("network-no-hosts").contains("network needs at least one host"));
        assert!(errors("network-bad-host").contains("\"https://example.com/x\" must look like"));
    }

    #[test]
    fn reports_every_problem_at_once() {
        let all = errors("many-errors");
        assert!(all.contains("id:") && all.contains("version:") && all.contains("entry:"));
    }

    #[test]
    fn missing_required_fields_are_reported_with_the_rest() {
        let all = errors("missing-fields");
        for field in ["id:", "name:", "version:", "description:", "entry:"] {
            assert!(all.contains(field), "{field} missing from {all}");
        }
    }

    #[test]
    fn accepts_build_metadata_and_rejects_non_http_source() {
        assert!(valid_version("1.0.0+build.5"));
        assert!(errors("bad-source").contains("source: \"javascript:alert(1)\" must be an http(s) URL"));
    }

    #[test]
    fn reports_malformed_json_readably() {
        assert!(errors("malformed-json").starts_with("plugin.json: "));
        assert!(read(&fixture("does-not-exist")).unwrap_err()[0].contains("cannot be read"));
    }

    #[test]
    fn id_and_host_shapes() {
        assert!(valid_id("a1") && valid_id("kafka-inspector") && valid_id(&"a".repeat(64)));
        assert!(!valid_id("a") && !valid_id("-ab") && !valid_id("Ab") && !valid_id(&"a".repeat(65)));
        assert!(valid_host("localhost:9092") && valid_host("*.example.com") && valid_host("api.example.com"));
        assert!(!valid_host("a.com:99999") && valid_host("a.com:65535"));
        assert!(!valid_host("") && !valid_host("example.com:") && !valid_host("http://a.com") && !valid_host("a.com/x"));
    }
}
