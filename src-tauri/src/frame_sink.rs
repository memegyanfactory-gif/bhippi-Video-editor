//! A loopback HTTP sink for export frames.
//!
//! The export pre-renders motion graphics and motion scenes in the webview and hands every frame
//! (a PNG) to disk. Sent as raw-body Tauri invokes (`mogrt_frame_write`), a long sequence could
//! stall mid-export with nothing reporting why, while the same render in a plain browser — which
//! PUTs its frames over HTTP — always finished. So frames travel the way the browser's do: a PUT
//! to 127.0.0.1, on a port only this app knows, carrying a token only this app's webview is told.
//! Writes land only in a frame folder `mogrt_frames_begin` made (the same check as
//! `mogrt_frame_write`), so the sink can never write anywhere else.
//!
//! `PUT /frame/<folder name>/<index>` with the PNG as the body and `x-helios-token`; the answer
//! is 204 once the file is on disk. The webview's preflight (`OPTIONS`) is answered for any
//! origin: without the token a request can do nothing.

use serde::Serialize;
use std::io;
use std::path::{Path, PathBuf};
use std::time::Duration;
use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio::net::{TcpListener, TcpStream};

/// Where to PUT frames, and the token that has to come with them.
#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FrameSink {
    pub url: String,
    pub token: String,
}

/// An 8K frame with alpha stays well under this; anything bigger is not a frame.
const MAX_FRAME: usize = 256 * 1024 * 1024;
const MAX_HEAD: usize = 16 * 1024;
/// A connection that sends nothing for this long is dropped, so a stuck client cannot pin a task.
const IDLE: Duration = Duration::from_secs(30);
const PNG: &[u8; 8] = b"\x89PNG\r\n\x1a\n";

/// Binds 127.0.0.1 on a free port and serves frames into `<work>/mogrt/<folder>/` until the app exits.
pub async fn start(work: PathBuf) -> io::Result<FrameSink> {
    let listener = TcpListener::bind(("127.0.0.1", 0)).await?;
    let port = listener.local_addr()?.port();
    let token = format!("{}{}", ulid::Ulid::new(), ulid::Ulid::new()).to_ascii_lowercase();
    let secret = token.clone();
    tokio::spawn(async move {
        loop {
            match listener.accept().await {
                Ok((stream, _)) => {
                    let (work, secret) = (work.clone(), secret.clone());
                    tokio::spawn(async move {
                        if let Err(error) = serve(stream, &work, &secret).await {
                            tracing::debug!("frame sink connection: {error}");
                        }
                    });
                }
                // Out of sockets for a moment: try again rather than end the sink.
                Err(_) => tokio::time::sleep(Duration::from_millis(50)).await,
            }
        }
    });
    Ok(FrameSink { url: format!("http://127.0.0.1:{port}"), token })
}

async fn read_some(stream: &mut TcpStream, buf: &mut [u8]) -> io::Result<usize> {
    tokio::time::timeout(IDLE, stream.read(buf)).await.map_err(|_| io::Error::new(io::ErrorKind::TimedOut, "idle client"))?
}

/// One request per connection: read it, answer it, close.
async fn serve(mut stream: TcpStream, work: &Path, token: &str) -> io::Result<()> {
    let mut data = Vec::with_capacity(8192);
    let mut chunk = vec![0u8; 64 * 1024];
    let head_end = loop {
        if let Some(at) = data.windows(4).position(|window| window == b"\r\n\r\n") {
            break at + 4;
        }
        if data.len() > MAX_HEAD {
            return answer(&mut stream, 431, "Request Header Fields Too Large").await;
        }
        let read = read_some(&mut stream, &mut chunk).await?;
        if read == 0 {
            return Ok(());
        }
        data.extend_from_slice(&chunk[..read]);
    };
    let head = String::from_utf8_lossy(&data[..head_end]).into_owned();
    let mut lines = head.split("\r\n");
    let mut request = lines.next().unwrap_or_default().split(' ');
    let (method, target) = (request.next().unwrap_or_default(), request.next().unwrap_or_default());
    let header = |name: &str| {
        head.split("\r\n").skip(1).find_map(|line| {
            let (key, value) = line.split_once(':')?;
            key.trim().eq_ignore_ascii_case(name).then(|| value.trim().to_owned())
        })
    };
    if method == "OPTIONS" {
        return answer(&mut stream, 204, "No Content").await;
    }
    let length = header("content-length").and_then(|value| value.parse::<usize>().ok());
    let mut body = data.split_off(head_end);
    // A refusal still reads the body first: closing a socket with unread data resets it, and the
    // client then sees a network failure instead of the answer.
    let refused = if method != "PUT" {
        Some((405, "Method Not Allowed"))
    } else if header("x-helios-token").as_deref() != Some(token) {
        Some((403, "Forbidden"))
    } else if length.is_none() {
        Some((411, "Length Required"))
    } else if length.is_some_and(|length| length > MAX_FRAME) {
        // Too big to read through: answer and close.
        return answer(&mut stream, 413, "Payload Too Large").await;
    } else {
        None
    };
    let file = frame_file(work, target);
    let length = length.unwrap_or(0).min(MAX_FRAME);
    let keep = refused.is_none() && file.is_some();
    if keep {
        body.reserve(length.saturating_sub(body.len()));
    }
    let mut received = body.len();
    while received < length {
        let read = read_some(&mut stream, &mut chunk).await?;
        if read == 0 {
            return Err(io::Error::new(io::ErrorKind::UnexpectedEof, "the frame was cut off"));
        }
        received += read;
        if keep {
            body.extend_from_slice(&chunk[..read]);
        }
    }
    if let Some((status, reason)) = refused {
        return answer(&mut stream, status, reason).await;
    }
    let Some(file) = file else {
        return answer(&mut stream, 404, "Not Found").await;
    };
    body.truncate(length);
    if !body.starts_with(PNG) {
        return answer(&mut stream, 415, "Unsupported Media Type").await;
    }
    match tokio::fs::write(&file, &body).await {
        Ok(()) => answer(&mut stream, 204, "No Content").await,
        Err(error) => {
            tracing::warn!("frame sink could not write {}: {error}", file.display());
            answer(&mut stream, 500, "Internal Server Error").await
        }
    }
}

/// `/frame/<folder name>/<index>` → `<work>/mogrt/<folder name>/<index:05>.png`, for a folder that exists.
/// The name is the ASCII leaf `mogrt_frames_begin` made, so nothing can climb out of work/mogrt.
fn frame_file(work: &Path, target: &str) -> Option<PathBuf> {
    let mut parts = target.strip_prefix("/frame/")?.split('/');
    let (leaf, index) = (parts.next()?, parts.next()?);
    if parts.next().is_some() {
        return None;
    }
    let valid = !leaf.is_empty() && leaf.len() <= 96 && leaf.chars().all(|c| c.is_ascii_alphanumeric() || c == '-' || c == '_');
    let index: u64 = index.parse().ok()?;
    let dir = work.join("mogrt").join(leaf);
    (valid && dir.is_dir()).then(|| dir.join(format!("{index:05}.png")))
}

async fn answer(stream: &mut TcpStream, status: u16, reason: &str) -> io::Result<()> {
    // The webview's origin (tauri://localhost, http://tauri.localhost) differs from the sink's, and
    // 127.0.0.1 is a private address: the preflight has to allow both, the token does the guarding.
    let response = format!(
        "HTTP/1.1 {status} {reason}\r\nAccess-Control-Allow-Origin: *\r\nAccess-Control-Allow-Methods: PUT, OPTIONS\r\n\
         Access-Control-Allow-Headers: x-helios-token, content-type\r\nAccess-Control-Allow-Private-Network: true\r\n\
         Access-Control-Max-Age: 600\r\nContent-Length: 0\r\nConnection: close\r\n\r\n"
    );
    stream.write_all(response.as_bytes()).await?;
    stream.flush().await?;
    stream.shutdown().await
}

#[cfg(test)]
mod tests {
    use super::*;

    async fn send(sink: &FrameSink, request: Vec<u8>) -> String {
        let address = sink.url.trim_start_matches("http://");
        let mut stream = TcpStream::connect(address).await.expect("connect");
        stream.write_all(&request).await.expect("send");
        let mut reply = String::new();
        stream.read_to_string(&mut reply).await.expect("reply");
        reply
    }

    fn put(path: &str, token: &str, body: &[u8]) -> Vec<u8> {
        let mut request = format!("PUT {path} HTTP/1.1\r\nHost: x\r\nx-helios-token: {token}\r\nContent-Length: {}\r\n\r\n", body.len()).into_bytes();
        request.extend_from_slice(body);
        request
    }

    #[tokio::test]
    async fn frames_land_in_their_folder_and_nowhere_else() {
        let work = std::env::temp_dir().join(format!("helios-sink-{}", ulid::Ulid::new()));
        let folder = "clip_1-abc";
        std::fs::create_dir_all(work.join("mogrt").join(folder)).expect("folder");
        let sink = start(work.clone()).await.expect("sink");
        // A big frame arrives in pieces; it lands whole.
        let mut png = PNG.to_vec();
        png.resize(png.len() + 3 * 1024 * 1024, 7);
        let reply = send(&sink, put(&format!("/frame/{folder}/12"), &sink.token, &png)).await;
        assert!(reply.starts_with("HTTP/1.1 204"), "{reply}");
        assert_eq!(std::fs::read(work.join("mogrt").join(folder).join("00012.png")).expect("written"), png);
        // The preflight is answered for the webview's origin and the private address.
        let reply = send(&sink, b"OPTIONS /frame/x/1 HTTP/1.1\r\nHost: x\r\n\r\n".to_vec()).await;
        assert!(reply.starts_with("HTTP/1.1 204") && reply.contains("Access-Control-Allow-Private-Network: true"), "{reply}");
        // Without the token, outside the frame folders, or not a PNG: refused, and nothing written.
        assert!(send(&sink, put(&format!("/frame/{folder}/1"), "wrong", &png)).await.starts_with("HTTP/1.1 403"));
        assert!(send(&sink, put("/frame/../1", &sink.token, &png)).await.starts_with("HTTP/1.1 404"));
        assert!(send(&sink, put("/frame/..%2F..%2Fwindows/1", &sink.token, &png)).await.starts_with("HTTP/1.1 404"));
        assert!(send(&sink, put("/frame/missing-folder/1", &sink.token, &png)).await.starts_with("HTTP/1.1 404"));
        assert!(send(&sink, put(&format!("/frame/{folder}/2"), &sink.token, b"GIF89a....")).await.starts_with("HTTP/1.1 415"));
        assert!(!work.join("mogrt").join(folder).join("00001.png").exists());
        assert!(!work.join("mogrt").join(folder).join("00002.png").exists());
        let _ignored = std::fs::remove_dir_all(work);
    }
}
