//! A local HTTP server for the repository and install tests. It serves a route table, so a test can change
//! what a path returns between two requests. Every request ends the connection after one reply.

use super::repos::Repos;
use std::collections::HashMap;
use std::io::{Read, Write};
use std::net::TcpListener;
use std::sync::{Arc, Mutex};

type Routes = Arc<Mutex<HashMap<String, (u16, Vec<u8>)>>>;

pub struct Mock {
    pub port: u16,
    routes: Routes,
}

impl Mock {
    pub fn start() -> Mock {
        let listener = TcpListener::bind("127.0.0.1:0").unwrap();
        let port = listener.local_addr().unwrap().port();
        let routes: Routes = Arc::default();
        let table = routes.clone();
        std::thread::spawn(move || {
            // Ends with the test process.
            for stream in listener.incoming() {
                let Ok(mut stream) = stream else { return };
                let (mut buf, mut seen) = ([0u8; 4096], Vec::new());
                while !seen.windows(4).any(|w| w == b"\r\n\r\n") {
                    match stream.read(&mut buf) {
                        Ok(0) | Err(_) => break,
                        Ok(n) => seen.extend_from_slice(&buf[..n]),
                    }
                }
                let head = String::from_utf8_lossy(&seen);
                let path = head.split_whitespace().nth(1).unwrap_or("").to_string();
                let (status, body) = table.lock().unwrap().get(&path).cloned().unwrap_or((404, Vec::new()));
                let header = format!("HTTP/1.1 {status} X\r\nContent-Length: {}\r\nConnection: close\r\n\r\n", body.len());
                let _ = stream.write_all(header.as_bytes()).and_then(|()| stream.write_all(&body));
            }
        });
        Mock { port, routes }
    }

    pub fn set(&self, path: &str, status: u16, body: impl Into<Vec<u8>>) {
        self.routes.lock().unwrap().insert(path.to_string(), (status, body.into()));
    }

    /// `http://127.0.0.1:<port><path>`
    pub fn url(&self, path: &str) -> String {
        format!("http://127.0.0.1:{}{path}", self.port)
    }

    /// A repository store in a temp dir whose "GitHub" is this server (`/raw/...` and `/gh/...`).
    pub fn repos(&self) -> (tempfile::TempDir, Repos) {
        let dir = tempfile::tempdir().unwrap();
        let repos = Repos::with_bases(dir.path().to_path_buf(), self.url("/raw"), self.url("/gh"));
        (dir, repos)
    }
}
