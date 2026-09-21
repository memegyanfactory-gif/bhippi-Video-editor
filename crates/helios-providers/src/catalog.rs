//! The provider catalogue: every backend Helios knows, with how to find, install, and talk
//! to it. Data-driven so vendor commands change in exactly one place.
//!
//! CLI recipes are Bhippi's, which were each verified against the vendor's print mode on
//! Windows (see the comments on `prompt_via_stdin`).

use crate::model::ProviderKind;
use crate::transcript::Transcript;

/// How to install (and thereby update) one CLI provider. Explicit argv, never a shell string.
#[derive(Clone, Copy, Debug)]
pub struct InstallSpec {
    pub program: &'static str,
    pub args: &'static [&'static str],
}

impl InstallSpec {
    #[must_use]
    pub fn display(&self) -> String {
        format!("{} {}", self.program, self.args.join(" "))
    }
}

/// Which wire protocol a backend speaks.
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum Api {
    /// A vendor CLI spawned per turn.
    Cli,
    /// Ollama's native `/api/chat` NDJSON stream.
    Ollama,
    /// `POST {base}/chat/completions` with SSE.
    OpenAiCompat,
    /// Anthropic Messages API with SSE.
    Anthropic,
}

/// How one CLI agent loads an MCP server for a single headless turn. Each vendor has its own
/// mechanism, and each was checked against that CLI's `--help` and docs.
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum McpWiring {
    /// Claude Code: a JSON file passed with `--mcp-config` (the recipe already carries
    /// `--strict-mcp-config`), the server's tools allowed by name, and every built-in tool
    /// switched off with `--tools ""` so a chat turn cannot wander the disk.
    ClaudeConfigFile,
    /// Codex: `-c mcp_servers.<name>.*` overrides, with the server's tools pre-approved because
    /// `codex exec` has nobody to ask.
    CodexOverrides,
    /// Gemini CLI: `.gemini/settings.json` in the agent workspace with the server trusted. The
    /// file names per-turn values as `$VARS` so concurrent turns never share a token.
    GeminiWorkspaceSettings,
    /// OpenCode: a per-turn config file named by `OPENCODE_CONFIG`, merged over the user's own.
    OpenCodeConfigFile,
}

/// One known backend.
#[derive(Clone, Copy, Debug)]
pub struct ProviderSpec {
    /// Stable id used in settings, logs, and the UI.
    pub id: &'static str,
    pub label: &'static str,
    pub kind: ProviderKind,
    pub api: Api,
    /// CLI executable name (without platform suffix).
    pub binary: Option<&'static str>,
    /// Credential environment variable(s) for cloud APIs, first match wins.
    pub env_keys: &'static [&'static str],
    /// Cloud API base URL (`…/v1`), or the path prefix appended to a local server port.
    pub base_url: Option<&'static str>,
    /// Loopback port probed for local servers.
    pub port: Option<u16>,
    /// HTTP path probed for local servers.
    pub probe_path: Option<&'static str>,
    pub install: Option<InstallSpec>,
    pub homepage: Option<&'static str>,
    /// Prompt argv template. `{prompt}` puts the text in argv, `{prompt_file}` puts the path
    /// of a file holding it; a backend with `prompt_via_stdin` carries neither.
    pub prompt_args: Option<&'static [&'static str]>,
    /// Whether the prompt is written to the child's stdin instead of argv.
    ///
    /// An engineered turn is kilobytes of system prompt and project context. As one argv
    /// element it breaks on Windows twice over: the command line is capped at 32,767
    /// characters, and npm's launcher re-splits `$args`, so a prompt line starting with
    /// `--` arrives at the vendor as a flag. Stdin removes both hazards.
    pub prompt_via_stdin: bool,
    /// Argv fragment that pins a model, with `{model}` substituted.
    pub model_args: Option<&'static [&'static str]>,
    /// Argv that makes the CLI print the models it accepts.
    pub list_models_args: Option<&'static [&'static str]>,
    /// How this backend's stdout is read back into an answer.
    pub transcript: Transcript,
    /// How a CLI agent is handed an MCP server for one turn; `None` means it cannot be.
    pub mcp: Option<McpWiring>,
    /// Model names this backend is known to accept, used when it cannot be asked.
    pub models: &'static [&'static str],
}

impl ProviderSpec {
    /// Whether this recipe hands the prompt over as a file path (`{prompt_file}`).
    #[must_use]
    pub fn prompt_via_file(&self) -> bool {
        self.prompt_args
            .is_some_and(|args| args.contains(&PROMPT_FILE))
    }
}

/// The recipe placeholder that means "write the prompt out and pass its path here".
pub const PROMPT_FILE: &str = "{prompt_file}";

const NPM: &str = "npm";

const fn cli(
    id: &'static str,
    label: &'static str,
    binary: &'static str,
    install: Option<InstallSpec>,
    homepage: &'static str,
) -> ProviderSpec {
    ProviderSpec {
        id,
        label,
        kind: ProviderKind::Cli,
        api: Api::Cli,
        binary: Some(binary),
        env_keys: &[],
        base_url: None,
        port: None,
        probe_path: None,
        install,
        homepage: Some(homepage),
        prompt_args: None,
        prompt_via_stdin: false,
        model_args: None,
        list_models_args: None,
        transcript: Transcript::JsonLines,
        mcp: None,
        models: &[],
    }
}

const fn local(
    id: &'static str,
    label: &'static str,
    port: u16,
    probe_path: &'static str,
    api: Api,
    homepage: &'static str,
) -> ProviderSpec {
    ProviderSpec {
        id,
        label,
        kind: ProviderKind::LocalServer,
        api,
        binary: None,
        env_keys: &[],
        base_url: Some("/v1"),
        port: Some(port),
        probe_path: Some(probe_path),
        install: None,
        homepage: Some(homepage),
        prompt_args: None,
        prompt_via_stdin: false,
        model_args: None,
        list_models_args: None,
        transcript: Transcript::Plain,
        mcp: None,
        models: &[],
    }
}

const fn cloud(
    id: &'static str,
    label: &'static str,
    api: Api,
    base_url: &'static str,
    env_keys: &'static [&'static str],
    homepage: &'static str,
) -> ProviderSpec {
    ProviderSpec {
        id,
        label,
        kind: ProviderKind::CloudApi,
        api,
        binary: None,
        env_keys,
        base_url: Some(base_url),
        port: None,
        probe_path: None,
        install: None,
        homepage: Some(homepage),
        prompt_args: None,
        prompt_via_stdin: false,
        model_args: None,
        list_models_args: None,
        transcript: Transcript::Plain,
        mcp: None,
        models: &[],
    }
}

/// The full catalogue, ordered for the Settings page: agents, locals, clouds.
pub const CATALOG: &[ProviderSpec] = &[
    ProviderSpec {
        // `stream-json` + `--include-partial-messages` makes the first words land in about a
        // second instead of after the whole turn; `--verbose` is required for stream-json
        // under `--print`. `--strict-mcp-config` with no `--mcp-config` loads no MCP servers,
        // which is dead time on every turn. `dontAsk` denies any tool that would need
        // permission instead of hanging on a prompt nobody can answer.
        prompt_args: Some(&[
            "-p",
            "--output-format",
            "stream-json",
            "--verbose",
            "--include-partial-messages",
            "--strict-mcp-config",
            "--permission-mode",
            "dontAsk",
        ]),
        prompt_via_stdin: true,
        model_args: Some(&["--model", "{model}"]),
        models: &["opus", "sonnet", "haiku", "fable"],
        mcp: Some(McpWiring::ClaudeConfigFile),
        ..cli(
            "claude",
            "Claude Code",
            "claude",
            Some(InstallSpec {
                program: NPM,
                args: &["install", "-g", "@anthropic-ai/claude-code"],
            }),
            "https://claude.com/claude-code",
        )
    },
    ProviderSpec {
        prompt_args: Some(&[
            "exec",
            "--skip-git-repo-check",
            "--json",
            "--color",
            "never",
            "--sandbox",
            "workspace-write",
            "--ephemeral",
        ]),
        prompt_via_stdin: true,
        model_args: Some(&["-m", "{model}"]),
        list_models_args: Some(&["debug", "models"]),
        mcp: Some(McpWiring::CodexOverrides),
        ..cli(
            "codex",
            "Codex CLI",
            "codex",
            Some(InstallSpec {
                program: NPM,
                args: &["install", "-g", "@openai/codex"],
            }),
            "https://developers.openai.com/codex/cli",
        )
    },
    ProviderSpec {
        // Headless whenever stdin is not a TTY: the piped prompt is the turn.
        prompt_args: Some(&["--output-format", "stream-json"]),
        prompt_via_stdin: true,
        model_args: Some(&["--model", "{model}"]),
        mcp: Some(McpWiring::GeminiWorkspaceSettings),
        ..cli(
            "gemini",
            "Gemini CLI",
            "gemini",
            Some(InstallSpec {
                program: NPM,
                args: &["install", "-g", "@google/gemini-cli"],
            }),
            "https://github.com/google-gemini/gemini-cli",
        )
    },
    ProviderSpec {
        // `opencode run` with no positional message reads the message from stdin.
        prompt_args: Some(&["run", "--format", "json", "--pure"]),
        prompt_via_stdin: true,
        model_args: Some(&["-m", "{model}"]),
        list_models_args: Some(&["models"]),
        mcp: Some(McpWiring::OpenCodeConfigFile),
        ..cli(
            "opencode",
            "OpenCode",
            "opencode",
            Some(InstallSpec {
                program: NPM,
                args: &["install", "-g", "opencode-ai"],
            }),
            "https://opencode.ai",
        )
    },
    ProviderSpec {
        // Grok has no stdin print mode, so the turn travels as a prompt file.
        prompt_args: Some(&[
            "--prompt-file",
            PROMPT_FILE,
            "--output-format",
            "streaming-json",
            "--permission-mode",
            "dontAsk",
            "--no-leader",
            "--verbatim",
            "--disallowed-tools",
            "Agent",
        ]),
        model_args: Some(&["--model", "{model}"]),
        list_models_args: Some(&["models"]),
        ..cli(
            "grok",
            "Grok CLI",
            "grok",
            Some(InstallSpec {
                program: NPM,
                args: &["install", "-g", "@xai-official/grok"],
            }),
            "https://x.ai",
        )
    },
    ProviderSpec {
        // `--input-format stream-json` reads one NDJSON user event from stdin.
        prompt_args: Some(&[
            "--input-format",
            "stream-json",
            "--output-format",
            "stream-json",
            "--print-timeout",
            "20m",
        ]),
        prompt_via_stdin: true,
        model_args: Some(&["--model", "{model}"]),
        list_models_args: Some(&["models"]),
        ..cli(
            "antigravity",
            "Antigravity CLI",
            "agy",
            Some(InstallSpec {
                program: "agy",
                args: &["update"],
            }),
            "https://antigravity.google",
        )
    },
    local(
        "ollama",
        "Ollama",
        11434,
        "/api/tags",
        Api::Ollama,
        "https://ollama.com",
    ),
    local(
        "lmstudio",
        "LM Studio",
        1234,
        "/v1/models",
        Api::OpenAiCompat,
        "https://lmstudio.ai",
    ),
    local(
        "llamacpp",
        "llama.cpp server",
        8080,
        "/v1/models",
        Api::OpenAiCompat,
        "https://github.com/ggml-org/llama.cpp",
    ),
    local(
        "vllm",
        "vLLM",
        8000,
        "/v1/models",
        Api::OpenAiCompat,
        "https://docs.vllm.ai",
    ),
    local(
        "jan",
        "Jan",
        1337,
        "/v1/models",
        Api::OpenAiCompat,
        "https://jan.ai",
    ),
    cloud(
        "anthropic",
        "Anthropic API",
        Api::Anthropic,
        "https://api.anthropic.com/v1",
        &["ANTHROPIC_API_KEY"],
        "https://console.anthropic.com/settings/keys",
    ),
    cloud(
        "openai",
        "OpenAI API",
        Api::OpenAiCompat,
        "https://api.openai.com/v1",
        &["OPENAI_API_KEY"],
        "https://platform.openai.com/api-keys",
    ),
    cloud(
        "google",
        "Google Gemini API",
        Api::OpenAiCompat,
        "https://generativelanguage.googleapis.com/v1beta/openai",
        &["GEMINI_API_KEY", "GOOGLE_API_KEY"],
        "https://aistudio.google.com/apikey",
    ),
    cloud(
        "xai",
        "xAI API",
        Api::OpenAiCompat,
        "https://api.x.ai/v1",
        &["XAI_API_KEY"],
        "https://console.x.ai",
    ),
    cloud(
        "groq",
        "Groq API",
        Api::OpenAiCompat,
        "https://api.groq.com/openai/v1",
        &["GROQ_API_KEY"],
        "https://console.groq.com/keys",
    ),
    cloud(
        "openrouter",
        "OpenRouter",
        Api::OpenAiCompat,
        "https://openrouter.ai/api/v1",
        &["OPENROUTER_API_KEY"],
        "https://openrouter.ai/keys",
    ),
    cloud(
        "deepseek",
        "DeepSeek API",
        Api::OpenAiCompat,
        "https://api.deepseek.com/v1",
        &["DEEPSEEK_API_KEY"],
        "https://platform.deepseek.com/api_keys",
    ),
    cloud(
        "mistral",
        "Mistral API",
        Api::OpenAiCompat,
        "https://api.mistral.ai/v1",
        &["MISTRAL_API_KEY"],
        "https://console.mistral.ai/api-keys",
    ),
    cloud(
        "moonshot",
        "Moonshot (Kimi) API",
        Api::OpenAiCompat,
        "https://api.moonshot.ai/v1",
        &["MOONSHOT_API_KEY"],
        "https://platform.moonshot.ai",
    ),
];

/// The id of Helios' offline command parser, which is built in rather than catalogued.
pub const BUILTIN_ID: &str = "helios";

/// Looks up one spec by id.
#[must_use]
pub fn spec(id: &str) -> Option<&'static ProviderSpec> {
    CATALOG.iter().find(|entry| entry.id == id)
}

#[cfg(test)]
mod tests {
    use super::{spec, Api, BUILTIN_ID, CATALOG, PROMPT_FILE};
    use crate::model::ProviderKind;
    use crate::transcript::Transcript;

    #[test]
    fn ids_are_unique_and_known_providers_present() {
        let mut ids: Vec<_> = CATALOG.iter().map(|entry| entry.id).collect();
        let count = ids.len();
        ids.sort_unstable();
        ids.dedup();
        assert_eq!(ids.len(), count, "duplicate catalog ids");
        for wanted in [
            "claude", "codex", "gemini", "ollama", "lmstudio", "anthropic", "openai", "google",
        ] {
            assert!(spec(wanted).is_some(), "{wanted} missing from catalog");
        }
        assert!(spec(BUILTIN_ID).is_none(), "the builtin is built, not catalogued");
    }

    #[test]
    fn every_kind_carries_what_it_needs_to_be_reached() {
        for entry in CATALOG {
            match entry.kind {
                ProviderKind::Cli => {
                    assert_eq!(entry.api, Api::Cli, "{}", entry.id);
                    assert!(entry.binary.is_some(), "{} has no binary", entry.id);
                    assert!(entry.prompt_args.is_some(), "{} has no recipe", entry.id);
                }
                ProviderKind::LocalServer => {
                    assert!(entry.port.is_some() && entry.probe_path.is_some(), "{}", entry.id);
                }
                ProviderKind::CloudApi => {
                    assert!(!entry.env_keys.is_empty(), "{} names no key", entry.id);
                    assert!(
                        entry.base_url.is_some_and(|url| url.starts_with("https://")),
                        "{} must use https",
                        entry.id
                    );
                }
                ProviderKind::Builtin => panic!("builtin rows are not catalogued"),
            }
        }
    }

    /// A prompt reaches a vendor by exactly one route: argv, stdin, or a prompt file. Two
    /// would send the turn twice; none would send it nowhere.
    #[test]
    fn a_prompt_travels_by_exactly_one_of_the_three_routes() {
        for entry in CATALOG {
            let Some(args) = entry.prompt_args else {
                assert!(!entry.prompt_via_stdin, "{} claims stdin without a recipe", entry.id);
                continue;
            };
            let routes = usize::from(args.contains(&"{prompt}"))
                + usize::from(entry.prompt_via_stdin)
                + usize::from(entry.prompt_via_file());
            assert_eq!(routes, 1, "{} sends its prompt by {routes} routes", entry.id);
        }
    }

    #[test]
    fn claude_takes_its_prompt_on_stdin_and_nowhere_in_argv() {
        let claude = spec("claude").expect("claude");
        assert!(claude.prompt_via_stdin);
        let args = claude.prompt_args.expect("recipe");
        assert_eq!(args.first(), Some(&"-p"));
        assert!(!args.iter().any(|arg| arg.contains("{prompt}")), "{args:?}");
        assert!(args.contains(&"--verbose"), "stream-json requires it");
        assert!(args.contains(&"--include-partial-messages"));
    }

    #[test]
    fn grok_takes_its_prompt_as_a_file() {
        let grok = spec("grok").expect("grok");
        assert!(grok.prompt_via_file());
        let args = grok.prompt_args.expect("recipe");
        assert!(args
            .windows(2)
            .any(|pair| pair == ["--prompt-file", PROMPT_FILE]));
    }

    #[test]
    fn codex_runs_outside_a_trusted_directory() {
        let args = spec("codex").and_then(|codex| codex.prompt_args).expect("recipe");
        assert!(args.contains(&"--skip-git-repo-check"));
    }

    /// A JSON Lines backend must both ask its CLI for JSON and read JSON back.
    #[test]
    fn json_line_backends_ask_their_cli_for_json() {
        for entry in CATALOG {
            let Some(args) = entry.prompt_args else {
                continue;
            };
            let asks_for_json = args.iter().any(|arg| arg.contains("json"));
            assert_eq!(
                asks_for_json,
                entry.transcript == Transcript::JsonLines,
                "{} asks for json={asks_for_json} but reads {:?}",
                entry.id,
                entry.transcript
            );
        }
    }

    #[test]
    fn every_listable_backend_can_pin_what_it_lists() {
        for entry in CATALOG {
            if entry.list_models_args.is_some() || !entry.models.is_empty() {
                assert!(entry.model_args.is_some(), "{} offers models it cannot pin", entry.id);
            }
        }
    }
}
