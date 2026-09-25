//! Turning a vendor's own failure text into a named fault and the next thing to do.
//!
//! Every backend fails in the same handful of ways and no two of them word it alike.
//! Matching the words they *do* share buys a specific answer for each; the alternative
//! is one generic "try reinstalling it", which is advice that has never once fixed an
//! expired login, a spent balance, or a full context window.
//!
//! The distinctions here are the ones that change what the user should do next:
//!
//! * **Context exceeded** — the prompt itself is too big. Retrying is guaranteed to fail
//!   again; the conversation has to shrink first. Nothing else on this list is fixed by
//!   compacting, and compacting fixes nothing else.
//! * **Rate limited, session window** — minutes away. Waiting works.
//! * **Rate limited, weekly window** — days away. Waiting does not work; the answer is
//!   another provider. Collapsing these two into one "rate limited" tells a user to wait
//!   out something that resets on Tuesday.
//! * **Quota exhausted** — money, not time. No amount of waiting helps.
//!
//! Classification is a pure function over text so every vendor phrasing can be pinned by
//! a test instead of discovered in production.

use crate::catalog::ProviderSpec;

/// A named failure, chosen for what the user has to do about it.
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum FaultKind {
    /// The prompt no longer fits the model's context window.
    ContextExceeded,
    /// Throttled inside a short rolling window; waiting clears it.
    RateLimitedSession,
    /// The plan's weekly allowance is spent; waiting does not clear it today.
    RateLimitedWeekly,
    /// Credit or billing, not time.
    QuotaExhausted,
    /// Signed out, or the credential expired.
    Unauthenticated,
    /// The launcher is not on disk.
    NotInstalled,
    /// The installed CLI is too old for the flags we send it.
    Outdated,
    /// The vendor took longer than the turn allows.
    Timeout,
    /// DNS, TLS, proxy, or a dropped connection.
    Network,
    /// The selected model is unavailable or its ID is invalid.
    ModelUnavailable,
    /// The vendor serves this plan only inside its own app and refuses anyone else.
    Restricted,
    /// The process died or exited non-zero for a reason it did not name.
    Crashed,
    /// Exit 0, nothing on stdout, and no explanation anywhere.
    EmptyAnswer,
    /// The user stopped it.
    Cancelled,
    /// Classified as nothing, which is itself worth saying honestly.
    Unknown,
}

impl FaultKind {
    /// The stable id the UI keys its fault card and animation on.
    #[must_use]
    pub const fn id(self) -> &'static str {
        match self {
            Self::ContextExceeded => "context_exceeded",
            Self::RateLimitedSession => "rate_limited_session",
            Self::RateLimitedWeekly => "rate_limited_weekly",
            Self::QuotaExhausted => "quota_exhausted",
            Self::Unauthenticated => "unauthenticated",
            Self::NotInstalled => "not_installed",
            Self::Outdated => "outdated",
            Self::Timeout => "timeout",
            Self::Network => "network",
            Self::ModelUnavailable => "model_unavailable",
            Self::Restricted => "restricted",
            Self::Crashed => "crashed",
            Self::EmptyAnswer => "empty_answer",
            Self::Cancelled => "cancelled",
            Self::Unknown => "unknown",
        }
    }

    /// Whether sending the same prompt again could plausibly succeed.
    ///
    /// A full context window is the one failure where retrying is *certain* to fail: the
    /// prompt is the problem, so it cannot be retried, only reduced.
    #[must_use]
    pub const fn retryable(self) -> bool {
        matches!(
            self,
            Self::RateLimitedSession | Self::Timeout | Self::Network | Self::Crashed
        )
    }
}

/// What the user can press to fix it.
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum Remedy {
    /// Condense the conversation and send again.
    Compact,
    /// Reinstall the CLI at its latest version.
    Update,
    /// Open the provider picker.
    SwitchProvider,
    /// Sign in at a terminal.
    SignIn,
    /// Send the same message again.
    Retry,
    /// Nothing a button can do.
    None,
}

impl Remedy {
    #[must_use]
    pub const fn id(self) -> &'static str {
        match self {
            Self::Compact => "compact",
            Self::Update => "update",
            Self::SwitchProvider => "switch_provider",
            Self::SignIn => "sign_in",
            Self::Retry => "retry",
            Self::None => "none",
        }
    }
}

/// A failure, explained, with the one action that resolves it.
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct Advice {
    pub kind: FaultKind,
    /// A short headline naming the failure, not the symptom.
    pub title: String,
    /// One sentence saying what happened, in the user's terms.
    pub summary: String,
    /// The next concrete action.
    pub fix: String,
    pub remedy: Remedy,
    /// The button's words, when there is a button.
    pub action_label: Option<String>,
    /// When the vendor named a reset time, its own words for it.
    pub resets_at: Option<String>,
}

/// Words each failure is recognised by, in the order they must be tested.
///
/// Order is load-bearing. "usage limit" appears in both a session throttle and a weekly
/// one, so the weekly needles are tested first; a plain 429 with no window named falls
/// through to the session case, which is the safer default because it only advises
/// waiting. Likewise a context overflow is checked before anything else, because a
/// vendor commonly reports it *with* a 400 that would otherwise read as generic.
const WEEKLY: &[&str] = &[
    "weekly limit",
    "weekly usage",
    "week limit",
    "limit will reset next week",
    "resets next week",
    "opus weekly",
    "weekly quota",
    "7-day limit",
];

const CONTEXT: &[&str] = &[
    "context window",
    "context length",
    "context_length_exceeded",
    "maximum context",
    "exceeds the maximum",
    "prompt is too long",
    "prompt too long",
    "too many tokens",
    "token limit exceeded",
    "input length and `max_tokens`",
    "reduce the length",
    "request_too_large",
    "conversation is too long",
];

const QUOTA: &[&str] = &[
    "402",
    "payment required",
    "balance",
    "out of credit",
    "insufficient credit",
    "insufficient_quota",
    "billing",
    "add credit",
    "credit balance is too low",
];

const AUTH: &[&str] = &[
    "401",
    "403",
    "unauthor",
    "authenticat",
    "not logged in",
    "not signed in",
    "invalid api key",
    "api key",
    "credential",
    "please sign in",
    "please log in",
    "oauth",
    "token expired",
    // Antigravity signs in fine but refuses a Google account it has not verified.
    "not eligible",
    "verify your account",
];

const RATE: &[&str] = &[
    "429",
    "rate limit",
    "rate-limit",
    "rate_limit",
    "usage limit",
    "too many requests",
    "overloaded",
    "capacity",
    "try again in",
    "slow down",
];

const OUTDATED: &[&str] = &[
    "unknown option",
    "unrecognized option",
    "unrecognised option",
    "unexpected argument",
    "invalid choice",
    "no such option",
    "unknown flag",
    "unknown argument",
    "requires an update",
    "please update",
    "version is no longer supported",
    "unsupported version",
];

const MISSING: &[&str] = &[
    "not found",
    "no such file",
    "is not recognized",
    "launcher missing",
    "command not found",
    "enoent",
    "cannot find the path",
];

const NETWORK: &[&str] = &[
    "econnrefused",
    "econnreset",
    "enotfound",
    "etimedout",
    "dns",
    "getaddrinfo",
    "certificate",
    "tls",
    "ssl",
    "proxy",
    "socket hang up",
    "network is unreachable",
    "connection refused",
    "connection reset",
    "fetch failed",
    "server error",
    "unexpected server error",
    "bad gateway",
    "502 bad gateway",
    "503 service unavailable",
    "504 gateway timeout",
];

/// Vendors that gate a free plan to their own client and refuse everyone else.
const RESTRICTED: &[&str] = &[
    "only be used from within",
    "must be used from within",
    "only be used inside",
    "only works from within",
    "can only be used with",
    "not permitted outside",
    "only available to official clients",
];

/// Every string value filed under `key` in a JSON-ish body, in the order they appear.
///
/// Scanned rather than parsed, because the body this runs on is routinely truncated before it
/// gets here — no closing brace, so `serde_json` would reject the whole thing and hand back
/// nothing. A cut-off body is exactly when the readable sentence matters most, so a partial
/// value is taken as far as it goes.
fn string_values(text: &str, key: &str) -> Vec<String> {
    let needle = format!("\"{key}\"");
    let mut out = Vec::new();
    let mut search_from = 0;
    while let Some(offset) = text[search_from..].find(needle.as_str()) {
        let after = search_from + offset + needle.len();
        search_from = after;

        let mut seen_colon = false;
        let mut started = false;
        let mut escaped = false;
        let mut value = String::new();
        for character in text[after..].chars() {
            if !seen_colon {
                if character.is_whitespace() {
                    continue;
                }
                if character == ':' {
                    seen_colon = true;
                    continue;
                }
                break; // "key" was not a key here.
            }
            if !started {
                if character.is_whitespace() {
                    continue;
                }
                if character == '"' {
                    started = true;
                    continue;
                }
                break; // The value is a number, object or null — nothing to read out.
            }
            if escaped {
                value.push(match character {
                    'n' => '\n',
                    't' => '\t',
                    'r' => '\r',
                    other => other,
                });
                escaped = false;
            } else if character == '\\' {
                escaped = true;
            } else if character == '"' {
                break;
            } else {
                value.push(character);
            }
        }
        if started && !value.trim().is_empty() {
            out.push(value.trim().to_owned());
        }
    }
    out
}

/// The sentence a vendor meant for a person, lifted out of the envelope it arrived in.
///
/// Providers almost never fail in prose. What comes back is a JSON body with one readable
/// sentence buried among transport fields, and printed whole it is unreadable — worse, the
/// explanation is usually the part that gets cut off when the body is truncated to fit a card.
/// The longest human-facing value is the message; everything around it is machinery.
#[must_use]
pub fn human_message(reason: &str) -> String {
    let mut best = String::new();
    for key in ["message", "error_description", "detail", "error", "reason"] {
        for found in string_values(reason, key) {
            if found.len() > best.len() {
                best = found;
            }
        }
    }
    if best.trim().is_empty() {
        reason.trim().to_owned()
    } else {
        best
    }
}

/// Names the failure a vendor's text describes.
#[must_use]
pub fn classify(reason: &str) -> FaultKind {
    let said = reason.to_ascii_lowercase();
    let says = |needles: &[&str]| needles.iter().any(|needle| said.contains(needle));

    if says(CONTEXT) {
        return FaultKind::ContextExceeded;
    }
    // Before the money and auth needles: a plan gated to the vendor's own app often says
    // "free tier" in the same breath, and reading that as an empty wallet would send the user
    // to a billing page that cannot fix it.
    if says(RESTRICTED) {
        return FaultKind::Restricted;
    }
    if says(WEEKLY) {
        return FaultKind::RateLimitedWeekly;
    }
    if says(QUOTA) {
        return FaultKind::QuotaExhausted;
    }
    if says(&[
        "model_not_found",
        "unknown model",
        "invalid model",
        "model is not supported",
        "model does not exist",
        "model is not available",
        "issue with the selected model",
        "not supported when using codex",
        "unsupported model",
        "model_not_available",
    ]) || (said.contains("model") && said.contains("do not have access"))
    {
        return FaultKind::ModelUnavailable;
    }
    if says(AUTH) {
        return FaultKind::Unauthenticated;
    }
    if says(RATE) {
        return FaultKind::RateLimitedSession;
    }
    if says(OUTDATED) {
        return FaultKind::Outdated;
    }
    if says(MISSING) {
        return FaultKind::NotInstalled;
    }
    if says(NETWORK) {
        return FaultKind::Network;
    }
    if said.contains("timed out") || said.contains("timeout") {
        return FaultKind::Timeout;
    }
    if said.contains("answered with nothing") {
        return FaultKind::EmptyAnswer;
    }
    if said.contains("cancel") || said.contains("stopped by you") {
        return FaultKind::Cancelled;
    }
    if said.contains("exited with") || said.contains("signal") || said.contains("panic") {
        return FaultKind::Crashed;
    }
    FaultKind::Unknown
}

/// The vendor's own reset time, when it named one, kept verbatim.
///
/// Vendors phrase it a dozen ways ("resets at 4pm", "try again in 12 minutes") and every
/// one of them is more useful to the user than our paraphrase would be, so the phrase is
/// lifted whole rather than parsed into a timestamp we would then have to render.
#[must_use]
pub fn reset_phrase(reason: &str) -> Option<String> {
    let lower = reason.to_ascii_lowercase();
    // Each vendor phrasing, and the words it is normalised to so the advice reads as a
    // sentence ("it resets at …") whatever the vendor wrote.
    for (marker, lead) in [
        ("resets at", "resets at"),
        ("reset at", "resets at"),
        ("reset on", "resets on"),
        ("try again at", "resets at"),
        ("try again in", "resets in"),
        ("try again after", "resets after"),
        ("retry after", "resets after"),
    ] {
        let Some(at) = lower.find(marker) else {
            continue;
        };
        // The time itself, cut at the end of the sentence or the vendor's JSON quoting.
        let rest: String = reason
            .get(at + marker.len()..)?
            .chars()
            .take_while(|character| !matches!(character, '\n' | '"' | '}'))
            .take(80)
            .collect();
        let rest = rest.trim().trim_end_matches(['.', ' ']);
        if !rest.is_empty() {
            return Some(format!("{lead} {rest}"));
        }
    }
    None
}

/// Explains a failure and names the one action that fixes it.
#[must_use]
pub fn advise(spec: &ProviderSpec, reason: &str) -> Advice {
    let kind = classify(reason);
    advise_as(spec, kind, reason)
}

/// Explains an already-named failure. Split out so a caller that knows the fault (an
/// absent launcher, a cancelled turn) does not have to phrase text for `classify` to
/// read back.
#[must_use]
pub fn advise_as(spec: &ProviderSpec, kind: FaultKind, reason: &str) -> Advice {
    let label = spec.label;
    let binary = spec.binary.unwrap_or(spec.id);
    let resets_at = reset_phrase(reason);
    let elsewhere = "Pick another provider in the composer to keep going now.";

    let (title, summary, fix, remedy, action_label) = match kind {
        FaultKind::ContextExceeded => (
            "Context window full".to_owned(),
            format!("This conversation is now longer than {label} can read in one turn."),
            "Compact the conversation to condense earlier turns, or start a new one. \
             Sending the same message again will fail the same way."
                .to_owned(),
            Remedy::Compact,
            Some("Compact conversation".to_owned()),
        ),
        FaultKind::RateLimitedWeekly => (
            "Weekly limit reached".to_owned(),
            format!("{label} has spent this week's allowance on your plan."),
            match &resets_at {
                Some(phrase) => format!(
                    "This one does not clear in a few minutes — it {phrase}. {elsewhere}"
                ),
                None => format!(
                    "This one does not clear in a few minutes; it resets when your \
                     billing week does. {elsewhere}"
                ),
            },
            Remedy::SwitchProvider,
            Some("Switch provider".to_owned()),
        ),
        FaultKind::RateLimitedSession => (
            "Rate limited".to_owned(),
            format!("{label} is throttling requests right now."),
            match &resets_at {
                Some(phrase) => format!("Wait — it {phrase}. {elsewhere}"),
                None => format!("Wait a few minutes and send it again. {elsewhere}"),
            },
            Remedy::Retry,
            Some("Try again".to_owned()),
        ),
        FaultKind::QuotaExhausted => (
            "Out of credit".to_owned(),
            format!("The account behind {label} has no balance left."),
            format!("Waiting will not help — top the account up with the vendor. {elsewhere}"),
            Remedy::SwitchProvider,
            Some("Switch provider".to_owned()),
        ),
        FaultKind::Unauthenticated => (
            "Signed out".to_owned(),
            format!("{label} is not signed in, or its credential expired."),
            if spec.id == "antigravity" {
                "Run `agy` in a terminal and sign in with a Google account Antigravity accepts (verify it if asked), then send the message again."
                    .to_owned()
            } else {
                format!("Run `{binary} login` in a terminal, then send the message again.")
            },
            Remedy::SignIn,
            None,
        ),
        FaultKind::NotInstalled => {
            (
                "Not installed".to_owned(),
                format!("Bhippi cannot find the {label} launcher on this machine."),
                if spec.id == "antigravity" {
                    "Install it from Settings › AI providers. Antigravity CLI uses Google's installer, not npm."
                    .to_owned()
                } else {
                    format!("Install it from Settings › AI providers, or run `npm i -g {binary}` yourself.")
                },
                Remedy::Update,
                Some("Install now".to_owned()),
            )
        }
        FaultKind::Outdated => (
            "CLI out of date".to_owned(),
            format!("This build of {label} does not understand the options Bhippi sends."),
            "Update it to the latest version — this is a one-click fix.".to_owned(),
            Remedy::Update,
            Some("Update now".to_owned()),
        ),
        FaultKind::ModelUnavailable => (
            "Model unavailable".to_owned(),
            format!("{label} rejected the selected model."),
            "Choose a model from this provider's current list, or use its default. Refresh providers in Settings › AI providers if access has changed.".to_owned(),
            Remedy::SwitchProvider,
            Some("Choose model".to_owned()),
        ),
        FaultKind::Timeout => (
            "Timed out".to_owned(),
            format!("{label} stopped producing output before it finished."),
            format!("Send it again, or try a shorter prompt. {elsewhere}"),
            Remedy::Retry,
            Some("Try again".to_owned()),
        ),
        FaultKind::Network => (
            "Network unreachable".to_owned(),
            format!("{label} could not reach its service."),
            "Check the connection, VPN, or proxy, then send it again.".to_owned(),
            Remedy::Retry,
            Some("Try again".to_owned()),
        ),
        FaultKind::EmptyAnswer => (
            "No answer returned".to_owned(),
            format!("{label} exited cleanly without producing anything."),
            format!(
                "That usually means a signed-out or throttled account. \
                 Run `{binary}` once in a terminal to see what it says."
            ),
            Remedy::Retry,
            Some("Try again".to_owned()),
        ),
        FaultKind::Cancelled => (
            "Stopped".to_owned(),
            "You stopped this turn.".to_owned(),
            "Send it again whenever you are ready.".to_owned(),
            Remedy::Retry,
            Some("Try again".to_owned()),
        ),
        FaultKind::Restricted if spec.id == "opencode" => (
            "OpenCode rejected this request".to_owned(),
            format!("OpenCode returned: {}", human_message(reason).chars().take(200).collect::<String>()),
            "Bhippi uses the installed official OpenCode CLI. This response can also occur during an upstream client or service issue; it does not prove your account cannot work here. Try a new request once. If it persists, check OpenCode directly and your model access. An API key alone does not guarantee free-tier access.".to_owned(),
            Remedy::Retry,
            Some("Try again".to_owned()),
        ),
        FaultKind::Restricted => (
            format!("{label} will not answer Bhippi"),
            format!(
                "{label} allows this plan only inside its own app, so it refuses the request. \
                 It said: {}",
                human_message(reason).chars().take(200).collect::<String>()
            ),
            format!(
                "Retrying will not change it — this is the vendor's rule, not a fault. Add your \
                 own {label} API key in Settings › AI providers, which is not restricted this \
                 way, or pick another provider in the composer."
            ),
            Remedy::SwitchProvider,
            Some("Switch provider".to_owned()),
        ),
        FaultKind::Crashed | FaultKind::Unknown => (
            format!("{label} failed"),
            // The readable sentence, not the JSON it travelled in: a truncated envelope cuts off
            // exactly the part that says what went wrong.
            format!("{label} could not complete this turn. {}", human_message(reason).chars().take(300).collect::<String>()),
            format!(
                "Run `{binary}` once in a terminal to see what it says; if it works there, \
                 update it from Settings › AI providers."
            ),
            Remedy::Retry,
            Some("Try again".to_owned()),
        ),
    };

    Advice {
        kind,
        title,
        summary,
        fix,
        remedy,
        action_label,
        resets_at,
    }
}

/// The one-line hint carried on [`crate::ProviderError`].
#[must_use]
pub fn hint_for(spec: &ProviderSpec, reason: &str) -> String {
    advise(spec, reason).fix
}

#[cfg(test)]
mod tests {
    use super::{advise, classify, hint_for, human_message, reset_phrase, FaultKind, Remedy};

    fn claude() -> &'static crate::catalog::ProviderSpec {
        crate::spec("claude").unwrap_or_else(|| panic!("the catalogue must know Claude Code"))
    }

    fn opencode() -> &'static crate::catalog::ProviderSpec {
        crate::spec("opencode").unwrap_or_else(|| panic!("the catalogue must know OpenCode"))
    }

    /// The body that reached a user's screen as unreadable JSON, verbatim and truncated exactly
    /// as it arrived — the truncation is the point, because it is what defeats a JSON parser.
    const OPENCODE_FREE_TIER: &str = r#"{"data":{"isRetryable":false,"message":"Error from provider (Console): OpenCode's free tier can only be used from within OpenCode","metadata":{"url":"https://opencode.ai/zen/v1/res"#;

    #[test]
    fn a_vendors_sentence_is_read_out_of_the_json_it_arrived_in() {
        let said = human_message(OPENCODE_FREE_TIER);
        assert_eq!(
            said,
            "Error from provider (Console): OpenCode's free tier can only be used from within OpenCode"
        );
        // None of the envelope survives into what the user reads.
        assert!(!said.contains("isRetryable"), "{said}");
        assert!(!said.contains("metadata"), "{said}");
        assert!(!said.contains('{'), "{said}");
    }

    #[test]
    fn a_truncated_body_still_gives_up_its_message() {
        // Cut off mid-sentence, with no closing quote or brace: serde_json would return nothing
        // at all here, which is how the useful half went missing.
        let cut = r#"{"error":{"code":500,"message":"the upstream model dropped the conn"#;
        assert_eq!(human_message(cut), "the upstream model dropped the conn");
    }

    #[test]
    fn plain_prose_and_empty_bodies_are_left_exactly_as_they_are() {
        assert_eq!(human_message("Error: not logged in"), "Error: not logged in");
        assert_eq!(human_message("  spaced  "), "spaced");
        // A body with nothing human in it is better shown raw than blanked.
        assert_eq!(human_message(r#"{"ok":false}"#), r#"{"ok":false}"#);
    }

    /// The failure from the screenshot: a free plan the vendor gates to its own client. It is
    /// not a crash, retrying cannot fix it, and telling the user to reinstall is nonsense.
    #[test]
    fn opencode_rejection_allows_manual_retry_without_promising_access() {
        assert_eq!(classify(OPENCODE_FREE_TIER), FaultKind::Restricted);
        let advice = advise(opencode(), OPENCODE_FREE_TIER);
        assert_eq!(advice.remedy, Remedy::Retry);
        assert!(!FaultKind::Restricted.retryable());

        // The card says what the vendor said, without the envelope around it.
        assert!(advice.summary.contains("free tier can only be used from within"), "{}", advice.summary);
        assert!(!advice.summary.contains("isRetryable"), "{}", advice.summary);
        // And it does not send the user off to reinstall or top up something that is neither.
        assert!(!advice.fix.contains("top the account up"), "{}", advice.fix);
        assert!(advice.fix.contains("API key"), "{}", advice.fix);
    }

    /// A generic failure must still read as a sentence rather than a wall of JSON.
    #[test]
    fn an_unclassified_failure_shows_prose_not_an_envelope() {
        let body = r#"{"data":{"isRetryable":true,"message":"Console is having a moment","trace":"abc"}}"#;
        let advice = advise(claude(), body);
        assert_eq!(advice.kind, FaultKind::Unknown);
        assert!(advice.summary.contains("Console is having a moment"), "{}", advice.summary);
        assert!(!advice.summary.contains("trace"), "{}", advice.summary);
    }

    /// Real failure text, verbatim from each vendor, must land on the right fault.
    #[test]
    fn invalid_models_offer_selection_instead_of_reinstall_or_retry() {
        for reason in [
            "The model GPT-6 Astra is not supported when using Codex with a ChatGPT account",
            "model_not_found",
            "Unknown model: invalid",
            "You do not have access to model x",
        ] {
            let advice = advise(claude(), reason);
            assert_eq!(advice.kind, FaultKind::ModelUnavailable, "{reason}");
            assert_eq!(advice.remedy, Remedy::SwitchProvider);
            assert!(!advice.kind.retryable());
        }
        let advice = advise(claude(), "exited with code 1: vendor transport broke");
        assert!(advice.summary.contains("vendor transport broke"));
    }

    #[test]
    fn every_vendor_phrasing_lands_on_the_fault_it_describes() {
        let cases: &[(&str, FaultKind)] = &[
            (
                "API Error: 400 prompt is too long: 213000 tokens > 200000 maximum",
                FaultKind::ContextExceeded,
            ),
            (
                "This model's maximum context length is 128000 tokens",
                FaultKind::ContextExceeded,
            ),
            ("context_length_exceeded", FaultKind::ContextExceeded),
            (
                "Claude usage limit reached. Your limit will reset at 4pm.",
                FaultKind::RateLimitedSession,
            ),
            (
                "You have reached your weekly limit for Opus. Resets next week.",
                FaultKind::RateLimitedWeekly,
            ),
            ("429 Too Many Requests", FaultKind::RateLimitedSession),
            (
                "API error (status 402 Payment Required): Grok Build usage balance exhausted",
                FaultKind::QuotaExhausted,
            ),
            ("Error: not logged in", FaultKind::Unauthenticated),
            ("401 Unauthorized", FaultKind::Unauthenticated),
            (
                "error: unexpected argument '--include-partial-messages' found",
                FaultKind::Outdated,
            ),
            (
                "'claude' is not recognized as an internal or external command",
                FaultKind::NotInstalled,
            ),
            ("FetchError: getaddrinfo ENOTFOUND", FaultKind::Network),
            ("timed out after 180s", FaultKind::Timeout),
            ("the CLI answered with nothing", FaultKind::EmptyAnswer),
            ("exited with exit code: 3", FaultKind::Crashed),
        ];
        for (text, expected) in cases {
            assert_eq!(classify(text), *expected, "misread {text:?}");
        }
    }

    /// The distinction the user complained about: a weekly limit must not be advice to
    /// "wait a few minutes", because it resets in days.
    #[test]
    fn a_weekly_limit_is_never_advice_to_wait_a_few_minutes() {
        let weekly = advise(claude(), "You have hit your weekly limit for this model.");
        assert_eq!(weekly.kind, FaultKind::RateLimitedWeekly);
        // The copy may *mention* minutes in order to deny them; what it must never do is
        // tell the user to wait one out, because this resets on a billing week boundary.
        assert!(!weekly.fix.contains("Wait"), "{}", weekly.fix);
        assert!(weekly.fix.contains("does not clear"), "{}", weekly.fix);
        assert_eq!(weekly.remedy, Remedy::SwitchProvider);

        let session = advise(claude(), "429 rate limit exceeded");
        assert_eq!(session.remedy, Remedy::Retry);
        assert!(session.fix.contains("Wait"), "{}", session.fix);
    }

    /// A full context window is the one failure a retry cannot fix, so it must never be
    /// offered as retryable and must offer compaction instead.
    #[test]
    fn a_full_context_offers_compaction_and_refuses_to_be_retried() {
        let advice = advise(
            claude(),
            "prompt is too long: 213000 tokens > 200000 maximum",
        );
        assert_eq!(advice.kind, FaultKind::ContextExceeded);
        assert_eq!(advice.remedy, Remedy::Compact);
        assert!(!FaultKind::ContextExceeded.retryable());
        assert!(advice.title.contains("Context"), "{}", advice.title);
    }

    /// The vendor's own reset wording is more useful than any paraphrase of it.
    #[test]
    fn a_named_reset_time_is_carried_through_verbatim() {
        let advice = advise(
            claude(),
            "Claude usage limit reached. Your limit will reset at 4pm (America/Los_Angeles).",
        );
        let Some(phrase) = advice.resets_at else {
            panic!("a named reset time must be carried");
        };
        assert!(phrase.contains("4pm"), "{phrase}");
        assert!(advice.fix.contains("4pm"), "{}", advice.fix);

        assert_eq!(reset_phrase("nothing here"), None);

        // Codex reports an absolute time inside a JSON message.
        let codex = r#"{"message":"You've hit your usage limit. Visit https://chatgpt.com/codex/settings/usage to purchase more credits or try again at Sep 19th, 2026 5:47 PM."}"#;
        assert_eq!(reset_phrase(codex).as_deref(), Some("resets at Sep 19th, 2026 5:47 PM"));
        assert_eq!(reset_phrase("Too many requests, try again in 12 minutes.").as_deref(), Some("resets in 12 minutes"));
    }

    #[test]
    fn an_account_antigravity_will_not_serve_is_a_sign_in_problem() {
        let said = "Eligibility check failed: Your current account is not eligible for Antigravity. Verify your account to continue.";
        assert_eq!(classify(said), FaultKind::Unauthenticated);
    }

    /// Regression pin for the old behaviour: three different fixable failures used to
    /// share one "reinstall it" hint that fixed none of them.
    #[test]
    fn the_three_fixable_failures_get_three_different_answers() {
        let signed_out = hint_for(claude(), "Error: not logged in");
        let throttled = hint_for(claude(), "429 Too Many Requests");
        let broke = hint_for(claude(), "402 payment required, balance exhausted");
        assert!(signed_out.contains("claude login"), "{signed_out}");
        assert!(throttled.contains("Wait"), "{throttled}");
        assert!(broke.contains("top the account up"), "{broke}");
        assert_ne!(signed_out, throttled);
        assert_ne!(throttled, broke);
        for hint in [&signed_out, &throttled, &broke] {
            assert!(!hint.contains("reinstall"), "{hint}");
        }
    }

    /// Every fault must name an action; a card with no next step is the bug this file
    /// exists to remove.
    #[test]
    fn every_fault_names_a_next_step() {
        for kind in [
            FaultKind::ContextExceeded,
            FaultKind::RateLimitedSession,
            FaultKind::RateLimitedWeekly,
            FaultKind::QuotaExhausted,
            FaultKind::Unauthenticated,
            FaultKind::NotInstalled,
            FaultKind::Outdated,
            FaultKind::Timeout,
            FaultKind::Network,
            FaultKind::ModelUnavailable,
            FaultKind::Restricted,
            FaultKind::Crashed,
            FaultKind::EmptyAnswer,
            FaultKind::Cancelled,
            FaultKind::Unknown,
        ] {
            let advice = super::advise_as(claude(), kind, "");
            assert!(!advice.title.is_empty(), "{kind:?} has no title");
            assert!(!advice.summary.is_empty(), "{kind:?} has no summary");
            assert!(!advice.fix.is_empty(), "{kind:?} has no fix");
            assert!(!kind.id().is_empty());
        }
    }
}
