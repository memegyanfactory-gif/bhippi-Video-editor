//! The one trait every LLM backend implements.

use crate::error::Result;
use crate::model::{CompletionRequest, DeltaStream};
use async_trait::async_trait;

#[async_trait]
pub trait Provider: Send + Sync {
    /// Stable catalogue id used in logs and settings rows.
    fn id(&self) -> &str;

    /// Streams a completion. Implementations honour `req.timeout`; dropping the stream
    /// cancels the turn (and kills any child process).
    async fn complete(&self, req: CompletionRequest) -> Result<DeltaStream>;
}
