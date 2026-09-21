//! The one error a provider raises. Every failure names the backend a human would
//! recognise, says what happened, and — when we know it — what to do next.

use thiserror::Error;

#[derive(Clone, Debug, Error, PartialEq, Eq)]
#[error("{provider}: {reason}")]
pub struct ProviderError {
    /// The catalogue label (e.g. "Claude Code"), never a generated id.
    pub provider: String,
    pub reason: String,
    pub retryable: bool,
    pub hint: Option<String>,
}

impl ProviderError {
    #[must_use]
    pub fn new(provider: impl Into<String>, reason: impl Into<String>) -> Self {
        Self {
            provider: provider.into(),
            reason: reason.into(),
            retryable: true,
            hint: None,
        }
    }

    #[must_use]
    pub fn with_hint(mut self, hint: impl Into<String>) -> Self {
        self.hint = Some(hint.into());
        self
    }
}

pub type Result<T> = std::result::Result<T, ProviderError>;

#[cfg(test)]
mod tests {
    use super::ProviderError;

    #[test]
    fn the_message_names_the_provider_a_human_would_recognise() {
        let error = ProviderError::new("Claude Code", "the CLI answered with nothing");
        assert_eq!(
            error.to_string(),
            "Claude Code: the CLI answered with nothing"
        );
    }
}
