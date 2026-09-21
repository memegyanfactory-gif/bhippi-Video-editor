//! TypeSafe judgments: one narrow question, one typed answer.
//!
//! TypeSafe's System One models answer a defined question about some state and return the answer
//! with its probabilities, rather than prose to parse. Helios uses it where code needs a piece of
//! common sense it cannot compute — which caption style suits a video, which tool a request means.
//!
//! The key stays on this side: the request is made from Rust with the key from the OS credential
//! store (or `TYPESAFE_API_KEY`), so it never reaches the webview.

use serde::{Deserialize, Serialize};
use std::collections::HashMap;

const ENDPOINT: &str = "https://api.typesafe.ai/v1/systemone";
const MODEL: &str = "jev-latest";
/// The id the key is filed under, beside the chat providers' keys.
pub const PROVIDER_ID: &str = "typesafe";

/// One option a choice may take: the name code will match on, and what it means.
#[derive(Clone, Debug, Deserialize)]
pub struct Option_ {
    pub id: String,
    pub description: String,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Choice {
    /// The option with the most probability.
    pub id: String,
    /// How concentrated the distribution is, 0..1 — not a promise that the answer is right.
    pub confidence: f64,
    pub probabilities: HashMap<String, f64>,
}

pub fn key() -> Option<String> {
    crate::settings::get_api_key(PROVIDER_ID).or_else(|| std::env::var("TYPESAFE_API_KEY").ok())
}

/// Whether a judgment can be asked for at all.
pub fn ready() -> bool {
    key().is_some_and(|value| !value.trim().is_empty())
}

/// Asks one choice question about `state` and returns the answer.
///
/// `instructions` poses the question; `options` are the answers it may give. A catch-all option
/// belongs in the list whenever the set might not cover the input — without one the model is
/// forced to pick something that does not fit.
pub async fn choose(state: &str, instructions: &str, options: &[Option_]) -> Result<Choice, String> {
    let Some(key) = key() else {
        return Err("No TypeSafe key. Add one in Settings › AI Providers, or set TYPESAFE_API_KEY.".to_owned());
    };
    if options.len() < 2 {
        return Err("a choice needs at least two options".to_owned());
    }
    let criteria: HashMap<&str, &str> = options
        .iter()
        .map(|option| (option.id.as_str(), option.description.as_str()))
        .collect();
    let body = serde_json::json!({
        "state": state,
        "model": MODEL,
        "questions": {
            "pick": { "type": "choice", "instructions": instructions, "criteria": criteria },
        },
    });

    let response = reqwest::Client::new()
        .post(ENDPOINT)
        .bearer_auth(key)
        .json(&body)
        .send()
        .await
        .map_err(|error| format!("TypeSafe could not be reached: {error}"))?;
    let status = response.status();
    let text = response
        .text()
        .await
        .map_err(|error| format!("TypeSafe sent no answer: {error}"))?;
    if !status.is_success() {
        return Err(format!("TypeSafe refused the question ({status}): {}", text.chars().take(240).collect::<String>()));
    }
    parse(&text)
}

fn parse(body: &str) -> Result<Choice, String> {
    let value: serde_json::Value =
        serde_json::from_str(body).map_err(|error| format!("TypeSafe sent something unreadable: {error}"))?;
    let answer = value
        .pointer("/answers/pick")
        .ok_or_else(|| "TypeSafe answered without the question we asked".to_owned())?;
    let id = answer
        .get("choice")
        .and_then(serde_json::Value::as_str)
        .ok_or_else(|| "TypeSafe's answer had no choice in it".to_owned())?
        .to_owned();
    let confidence = answer.get("confidence").and_then(serde_json::Value::as_f64).unwrap_or(0.0);
    let probabilities = answer
        .get("probabilities")
        .and_then(serde_json::Value::as_object)
        .map(|map| {
            map.iter()
                .filter_map(|(name, weight)| weight.as_f64().map(|value| (name.clone(), value)))
                .collect()
        })
        .unwrap_or_default();
    Ok(Choice { id, confidence, probabilities })
}

#[cfg(test)]
mod tests {
    use super::parse;


    #[test]
    fn an_answer_is_read_back_with_its_distribution() {
        let body = r#"{
            "model": "jev-latest",
            "answers": { "pick": { "type": "choice", "choice": "hormozi", "confidence": 0.82,
                "probabilities": { "hormozi": 0.82, "karaoke": 0.12, "other": 0.06 } } },
            "usage": { "input_tokens": 300, "output_tokens": 12 }
        }"#;
        let choice = parse(body).expect("parsed");
        assert_eq!(choice.id, "hormozi");
        assert!((choice.confidence - 0.82).abs() < 1e-9);
        assert_eq!(choice.probabilities.len(), 3);

        // A reply about some other question is an error, not a silent wrong answer.
        assert!(parse(r#"{"answers":{"other":{"choice":"x"}}}"#).is_err());
        assert!(parse("not json").is_err());
        // Missing probabilities are tolerated; a missing choice is not.
        let bare = parse(r#"{"answers":{"pick":{"choice":"a"}}}"#).expect("bare");
        assert_eq!(bare.id, "a");
        assert!(bare.probabilities.is_empty());
    }
}
