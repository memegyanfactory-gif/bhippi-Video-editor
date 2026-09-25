//! Line framing over a streaming HTTP body, shared by the SSE adapters.

use futures_util::stream::BoxStream;
use futures_util::StreamExt;

struct State {
    response: reqwest::Response,
    buffer: Vec<u8>,
    finished: bool,
}

/// Yields each complete line of `response` as it arrives (without the trailing newline).
///
/// Bytes are buffered until a newline so a multi-byte character split across two network
/// chunks is decoded whole rather than as two replacement characters.
pub fn lines(response: reqwest::Response) -> BoxStream<'static, Result<String, String>> {
    futures_util::stream::unfold(
        State {
            response,
            buffer: Vec::new(),
            finished: false,
        },
        |mut state| async move {
            loop {
                if let Some(at) = state.buffer.iter().position(|byte| *byte == b'\n') {
                    let line: Vec<u8> = state.buffer.drain(..=at).collect();
                    let text = String::from_utf8_lossy(&line).trim_end().to_owned();
                    return Some((Ok(text), state));
                }
                if state.finished {
                    if state.buffer.is_empty() {
                        return None;
                    }
                    let rest = std::mem::take(&mut state.buffer);
                    return Some((Ok(String::from_utf8_lossy(&rest).trim_end().to_owned()), state));
                }
                match state.response.chunk().await {
                    Ok(Some(bytes)) => state.buffer.extend_from_slice(&bytes),
                    Ok(None) => state.finished = true,
                    Err(error) => {
                        state.finished = true;
                        state.buffer.clear();
                        return Some((Err(error.to_string()), state));
                    }
                }
            }
        },
    )
    .boxed()
}
