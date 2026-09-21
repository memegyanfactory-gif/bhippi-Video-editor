use std::io::{Read, Seek, SeekFrom};
use std::path::{Component, Path, PathBuf};
use tauri::http::{header, Method, Request, Response, StatusCode};

const MAX_STREAM_CHUNK: u64 = 4 * 1024 * 1024; // 4 MB chunk size for streaming media
const MAX_SMALL_FILE_IN_MEMORY: u64 = 16 * 1024 * 1024; // 16 MB max for full GET in-memory

/// Creates a CORS-enabled response builder with standard headers.
fn cors_builder(status: StatusCode) -> tauri::http::response::Builder {
    Response::builder()
        .status(status)
        .header(header::ACCESS_CONTROL_ALLOW_ORIGIN, "*")
        .header(header::ACCESS_CONTROL_ALLOW_METHODS, "GET, HEAD, OPTIONS")
        .header(
            header::ACCESS_CONTROL_ALLOW_HEADERS,
            "Origin, Content-Type, Accept, Range, Authorization",
        )
        .header(
            header::ACCESS_CONTROL_EXPOSE_HEADERS,
            "Content-Range, Content-Length, Accept-Ranges",
        )
        .header(header::ACCEPT_RANGES, "bytes")
}

fn empty_response(status: StatusCode) -> Response<Vec<u8>> {
    cors_builder(status)
        .body(Vec::new())
        .unwrap_or_else(|_| Response::new(Vec::new()))
}

/// Safely extracts and decodes a filesystem PathBuf from the URI path.
pub fn parse_request_path(uri_path: &str) -> Option<PathBuf> {
    if uri_path.is_empty() {
        return None;
    }

    // Percent-decode first
    let decoded = percent_encoding::percent_decode_str(uri_path).decode_utf8_lossy();
    let mut cleaned = decoded.to_string();

    // Strip query parameters (?t=123) or hash fragments (#frag)
    if let Some(pos) = cleaned.find('?') {
        cleaned.truncate(pos);
    }
    if let Some(pos) = cleaned.find('#') {
        cleaned.truncate(pos);
    }

    let mut path_str = cleaned.as_str();

    // On Windows, URLs often arrive as "/C:/path" or "/C:\path" or "/D:/..."
    // Strip leading slash if followed by drive letter or UNC prefix
    if path_str.starts_with('/') {
        let after_slash = &path_str[1..];
        let bytes = after_slash.as_bytes();
        let is_drive = bytes.len() >= 2
            && (bytes[0].is_ascii_alphabetic())
            && (bytes[1] == b':' || bytes[1] == b'|');
        let is_unc = after_slash.starts_with("//") || after_slash.starts_with(r"\\");

        if is_drive || is_unc || cfg!(windows) {
            path_str = after_slash;
        }
    }

    if path_str.is_empty() {
        return None;
    }

    // Convert pipe separators (e.g. C|/path) to colons if encountered
    let normalized = if path_str.len() >= 2 && path_str.as_bytes()[1] == b'|' {
        let mut s = path_str.to_string();
        s.replace_range(1..2, ":");
        s
    } else {
        path_str.to_string()
    };

    let path = PathBuf::from(&normalized);

    // Prevent directory traversal attacks
    if path
        .components()
        .any(|comp| matches!(comp, Component::ParentDir))
    {
        return None;
    }

    Some(path)
}

/// Infers the content type based on the file extension.
pub fn mime_type_for(path: &Path) -> &'static str {
    let ext = path
        .extension()
        .and_then(|e| e.to_str())
        .unwrap_or("")
        .to_ascii_lowercase();

    match ext.as_str() {
        // Video
        "mp4" | "m4v" => "video/mp4",
        "mov" => "video/quicktime",
        "webm" => "video/webm",
        "mkv" => "video/x-matroska",
        "avi" => "video/x-msvideo",
        // Audio
        "mp3" => "audio/mpeg",
        "wav" => "audio/wav",
        "aac" => "audio/aac",
        "flac" => "audio/flac",
        "ogg" | "oga" => "audio/ogg",
        "m4a" => "audio/mp4",
        // Images
        "png" => "image/png",
        "jpg" | "jpeg" => "image/jpeg",
        "webp" => "image/webp",
        "gif" => "image/gif",
        "svg" => "image/svg+xml",
        "ico" => "image/x-icon",
        "bmp" => "image/bmp",
        // Text / Data
        "json" => "application/json",
        "js" | "mjs" => "text/javascript",
        "css" => "text/css",
        "html" | "htm" => "text/html",
        "txt" | "log" | "md" => "text/plain; charset=utf-8",
        "bin" => "application/octet-stream",
        _ => "application/octet-stream",
    }
}

/// Parses an HTTP Range header like `bytes=0-1024` or `bytes=1000-`.
pub fn parse_range_header(header_val: &str, total_len: u64) -> Option<(u64, u64)> {
    if total_len == 0 {
        return None;
    }
    let trimmed = header_val.trim();
    if !trimmed.starts_with("bytes=") {
        return None;
    }
    let spec = &trimmed["bytes=".len()..];
    // Take the first range if multiple are comma-separated
    let first = spec.split(',').next()?.trim();
    let (start_str, end_str) = first.split_once('-')?;

    if start_str.is_empty() {
        // Suffix range: -500 means last 500 bytes
        let suffix_len: u64 = end_str.parse().ok()?;
        let start = total_len.saturating_sub(suffix_len);
        let end = total_len.saturating_sub(1);
        Some((start, end))
    } else {
        let start: u64 = start_str.parse().ok()?;
        if start >= total_len {
            return None;
        }
        let end = if end_str.is_empty() {
            total_len.saturating_sub(1)
        } else {
            let parsed_end: u64 = end_str.parse().ok()?;
            parsed_end.min(total_len.saturating_sub(1))
        };
        if start > end {
            return None;
        }
        Some((start, end))
    }
}

/// Handles a single asset protocol HTTP request safely and without panicking.
pub fn handle_safe_asset_request(request: &Request<Vec<u8>>) -> Response<Vec<u8>> {
    if request.method() == Method::OPTIONS {
        return cors_builder(StatusCode::NO_CONTENT)
            .body(Vec::new())
            .unwrap_or_else(|_| Response::new(Vec::new()));
    }

    let uri_path = request.uri().path();
    let Some(file_path) = parse_request_path(uri_path) else {
        return empty_response(StatusCode::NOT_FOUND);
    };

    let Ok(metadata) = std::fs::metadata(&file_path) else {
        return empty_response(StatusCode::NOT_FOUND);
    };

    if !metadata.is_file() {
        return empty_response(StatusCode::NOT_FOUND);
    }

    let total_len = metadata.len();
    let mime = mime_type_for(&file_path);

    if request.method() == Method::HEAD {
        return cors_builder(StatusCode::OK)
            .header(header::CONTENT_TYPE, mime)
            .header(header::CONTENT_LENGTH, total_len.to_string())
            .body(Vec::new())
            .unwrap_or_else(|_| Response::new(Vec::new()));
    }

    // Check for Range header
    let range_header = request
        .headers()
        .get(header::RANGE)
        .and_then(|val| val.to_str().ok());

    if let Some(range_str) = range_header {
        if let Some((start, end)) = parse_range_header(range_str, total_len) {
            let requested_len = end.saturating_sub(start).saturating_add(1);
            let read_len = requested_len.min(MAX_STREAM_CHUNK);
            let actual_end = start + read_len.saturating_sub(1);

            let mut file = match std::fs::File::open(&file_path) {
                Ok(f) => f,
                Err(_) => return empty_response(StatusCode::NOT_FOUND),
            };

            if file.seek(SeekFrom::Start(start)).is_err() {
                return empty_response(StatusCode::INTERNAL_SERVER_ERROR);
            }

            let mut buffer = vec![0u8; read_len as usize];
            let bytes_read = match file.read(&mut buffer) {
                Ok(n) => n,
                Err(_) => return empty_response(StatusCode::INTERNAL_SERVER_ERROR),
            };
            buffer.truncate(bytes_read);

            let content_range = format!("bytes {start}-{actual_end}/{total_len}");
            return cors_builder(StatusCode::PARTIAL_CONTENT)
                .header(header::CONTENT_TYPE, mime)
                .header(header::CONTENT_RANGE, content_range)
                .header(header::CONTENT_LENGTH, bytes_read.to_string())
                .body(buffer)
                .unwrap_or_else(|_| Response::new(Vec::new()));
        } else {
            // Range not satisfiable
            return cors_builder(StatusCode::RANGE_NOT_SATISFIABLE)
                .header(header::CONTENT_RANGE, format!("bytes */{total_len}"))
                .body(Vec::new())
                .unwrap_or_else(|_| Response::new(Vec::new()));
        }
    }

    // Full GET request:
    // If the file is <= 16 MB, read whole file into memory.
    // If larger (e.g. 250 MB+ video requested without range header), send first 4 MB chunk
    // with 206 Partial Content so we never OOM or block the process!
    if total_len <= MAX_SMALL_FILE_IN_MEMORY {
        let data = match std::fs::read(&file_path) {
            Ok(bytes) => bytes,
            Err(_) => return empty_response(StatusCode::NOT_FOUND),
        };

        cors_builder(StatusCode::OK)
            .header(header::CONTENT_TYPE, mime)
            .header(header::CONTENT_LENGTH, data.len().to_string())
            .body(data)
            .unwrap_or_else(|_| Response::new(Vec::new()))
    } else {
        // Send initial chunk for large files
        let read_len = MAX_STREAM_CHUNK.min(total_len);
        let mut file = match std::fs::File::open(&file_path) {
            Ok(f) => f,
            Err(_) => return empty_response(StatusCode::NOT_FOUND),
        };

        let mut buffer = vec![0u8; read_len as usize];
        let bytes_read = match file.read(&mut buffer) {
            Ok(n) => n,
            Err(_) => return empty_response(StatusCode::INTERNAL_SERVER_ERROR),
        };
        buffer.truncate(bytes_read);

        let actual_end = bytes_read.saturating_sub(1);
        cors_builder(StatusCode::PARTIAL_CONTENT)
            .header(header::CONTENT_TYPE, mime)
            .header(
                header::CONTENT_RANGE,
                format!("bytes 0-{actual_end}/{total_len}"),
            )
            .header(header::CONTENT_LENGTH, bytes_read.to_string())
            .body(buffer)
            .unwrap_or_else(|_| Response::new(Vec::new()))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_normal_and_encoded_windows_paths() {
        let p1 = parse_request_path("/C:/Users/test/video.mp4");
        assert_eq!(p1, Some(PathBuf::from("C:/Users/test/video.mp4")));

        let p2 = parse_request_path("/C%3A/Users/test/video%20file.mp4?t=123");
        assert_eq!(p2, Some(PathBuf::from("C:/Users/test/video file.mp4")));

        let p3 = parse_request_path("D:/Helios/thumbnail.png#preview");
        assert_eq!(p3, Some(PathBuf::from("D:/Helios/thumbnail.png")));
    }

    #[test]
    fn rejects_traversal_paths() {
        assert_eq!(parse_request_path("/C:/secret/../etc/passwd"), None);
        assert_eq!(parse_request_path("..\\windows\\system32"), None);
    }

    #[test]
    fn parses_range_headers() {
        assert_eq!(parse_range_header("bytes=0-499", 1000), Some((0, 499)));
        assert_eq!(parse_range_header("bytes=500-", 1000), Some((500, 999)));
        assert_eq!(parse_range_header("bytes=-200", 1000), Some((800, 999)));
        assert_eq!(parse_range_header("bytes=1500-2000", 1000), None);
        assert_eq!(parse_range_header("invalid", 1000), None);
    }

    #[test]
    fn identifies_mime_types() {
        assert_eq!(mime_type_for(Path::new("clip.mp4")), "video/mp4");
        assert_eq!(mime_type_for(Path::new("audio.wav")), "audio/wav");
        assert_eq!(mime_type_for(Path::new("frame.png")), "image/png");
        assert_eq!(mime_type_for(Path::new("frame.jpg")), "image/jpeg");
        assert_eq!(mime_type_for(Path::new("data.json")), "application/json");
    }
}
