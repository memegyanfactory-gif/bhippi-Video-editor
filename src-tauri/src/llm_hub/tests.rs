use super::*;

fn fixture(name: &str) -> String {
    std::fs::read_to_string(Path::new(env!("CARGO_MANIFEST_DIR")).join("src").join("llm_hub").join("fixtures").join(name)).unwrap_or_else(|error| panic!("fixture {name}: {error}"))
}

fn fixture_json(name: &str) -> Value {
    serde_json::from_str(&fixture(name)).unwrap_or_else(|error| panic!("fixture {name}: {error}"))
}

fn scratch(name: &str) -> PathBuf {
    let dir = std::env::temp_dir().join(format!("bhippi-llm-hub-{name}-{}", ulid::Ulid::new()));
    std::fs::create_dir_all(&dir).unwrap();
    dir
}

// --- the request -----------------------------------------------------------------------------

#[test]
fn sort_names_map_to_hugging_faces() {
    assert_eq!(sort_param("downloads"), Some("downloads"));
    assert_eq!(sort_param("trending"), Some("trendingScore"));
    assert_eq!(sort_param("likes"), Some("likes"));
    assert_eq!(sort_param("updated"), Some("lastModified"));
    assert_eq!(sort_param("best-match"), None);
}

#[test]
fn the_search_url_has_every_part_and_no_more() {
    let url = search_url("qwen 3.5 coder", Some("trending"), Some("unsloth"), 30, None);
    assert!(url.starts_with("https://huggingface.co/api/models?filter=gguf&limit=30"), "{url}");
    assert!(url.contains("&search=qwen%203%2E5%20coder"), "{url}");
    assert!(url.contains("&author=unsloth") && url.contains("&sort=trendingScore&direction=-1"), "{url}");
    assert!(url.contains("&expand[]=gguf") && url.contains("&expand[]=cardData") && !url.contains("full=true"), "{url}");
    assert!(!url.contains("cursor"));
    // Best match: no sort at all; an empty search and author are left out; the limit is held to 100.
    let plain = search_url("  ", None, Some(" "), 5_000, Some("abc=="));
    assert!(plain.contains("limit=100") && !plain.contains("search=") && !plain.contains("author=") && !plain.contains("sort="), "{plain}");
    assert!(plain.ends_with("&cursor=abc%3D%3D"), "{plain}");
}

#[test]
fn the_next_page_comes_from_the_link_header() {
    let link = "<https://huggingface.co/api/models?search=qwen3.5&filter=gguf&sort=downloads&direction=-1&limit=3&full=true&cursor=eyIkb3IiOlt7ImQiOjF9XX0%3D>; rel=\"next\"";
    assert_eq!(next_cursor(link).as_deref(), Some("eyIkb3IiOlt7ImQiOjF9XX0="));
    // Several relations: the next one is picked.
    let both = format!("<https://huggingface.co/api/models?cursor=old>; rel=\"prev\", {link}");
    assert_eq!(next_cursor(&both).as_deref(), Some("eyIkb3IiOlt7ImQiOjF9XX0="));
    assert_eq!(next_cursor("<https://huggingface.co/api/models?limit=3>; rel=\"prev\""), None);
    assert_eq!(next_cursor("<https://huggingface.co/api/models?limit=3>; rel=\"next\""), None);
    assert_eq!(next_cursor(""), None);
    assert_eq!(next_link(link).unwrap().split('?').next(), Some("https://huggingface.co/api/models"));
}

// --- reading models --------------------------------------------------------------------------

#[test]
fn a_search_answer_becomes_models_with_their_maker() {
    let models = parse_models(&fixture_json("search.json"));
    assert_eq!(models.len(), 5, "{:?}", models.iter().map(|model| &model.repo).collect::<Vec<_>>());
    let qwen = models.iter().find(|model| model.repo == "unsloth/Qwen3.6-35B-A3B-GGUF").unwrap();
    assert_eq!((qwen.author.as_str(), qwen.name.as_str()), ("unsloth", "Qwen3.6-35B-A3B-GGUF"));
    assert_eq!(qwen.base_model.as_deref(), Some("Qwen/Qwen3.6-35B-A3B"));
    assert_eq!(qwen.maker, "Qwen");
    assert!(qwen.verified, "Qwen is an official maker");
    assert_eq!(qwen.license.as_deref(), Some("apache-2.0"));
    assert_eq!(qwen.architecture.as_deref(), Some("qwen35moe"));
    assert_eq!(qwen.context_max, Some(262_144));
    assert!((qwen.params_b.unwrap() - 34.66).abs() < 0.01, "{:?}", qwen.params_b);
    assert!(!qwen.gated);
    assert_eq!(qwen.pipeline_tag.as_deref(), Some("image-text-to-text"));
    assert!(qwen.downloads > 1_000_000 && qwen.likes > 1_000);
    assert!(qwen.updated_at.starts_with("2026-"));
    assert!(qwen.tags.iter().any(|tag| tag == "unsloth") && !qwen.tags.iter().any(|tag| tag.starts_with("base_model:") || tag.starts_with("license:") || tag == "gguf"), "{:?}", qwen.tags);
    assert_eq!(qwen.avatar_path, None, "logos are filled in later");
    let gemma = models.iter().find(|model| model.maker == "google").expect("a Gemma repo, made by google");
    assert!(gemma.verified);
}

#[test]
fn base_model_comes_from_the_card_or_the_tags() {
    let by_tag = json!({ "id": "someone/Thing-GGUF", "tags": ["gguf", "base_model:quantized:acme/Thing-7B", "base_model:acme/Thing-7B"] });
    assert_eq!(parse_model(&by_tag).unwrap().base_model.as_deref(), Some("acme/Thing-7B"));
    let quantized_only = json!({ "id": "someone/Thing-GGUF", "tags": ["base_model:quantized:acme/Thing-7B"] });
    assert_eq!(parse_model(&quantized_only).unwrap().base_model.as_deref(), Some("acme/Thing-7B"));
    let card_list = json!({ "id": "someone/Thing-GGUF", "cardData": { "base_model": ["meta-llama/Llama-3.1-8B", "other/x"] } });
    let model = parse_model(&card_list).unwrap();
    assert_eq!((model.base_model.as_deref(), model.maker.as_str(), model.verified), (Some("meta-llama/Llama-3.1-8B"), "meta-llama", true));
    let card_text = json!({ "id": "bartowski/Thing-GGUF", "cardData": { "base_model": "mistralai/Mistral-7B-v0.3" } });
    assert_eq!(parse_model(&card_text).unwrap().maker, "mistralai");
    // No base model: the publisher is the maker, and is verified only when it is a known lab.
    let own = json!({ "id": "Qwen/Qwen3-8B-GGUF" });
    let own = parse_model(&own).unwrap();
    assert_eq!((own.maker.as_str(), own.verified, own.base_model), ("Qwen", true, None));
    let community = json!({ "id": "randomperson/Mix-GGUF" });
    assert!(!parse_model(&community).unwrap().verified);
    assert!(parse_model(&json!({ "name": "no id" })).is_none());
}

#[test]
fn gated_and_license_are_read_the_way_hugging_face_writes_them() {
    assert!(!parse_model(&json!({ "id": "a/b", "gated": false })).unwrap().gated);
    assert!(parse_model(&json!({ "id": "a/b", "gated": "manual" })).unwrap().gated);
    assert!(parse_model(&json!({ "id": "a/b", "gated": "auto" })).unwrap().gated);
    assert!(!parse_model(&json!({ "id": "a/b" })).unwrap().gated);
    let tagged = parse_model(&json!({ "id": "a/b", "tags": ["license:llama3.1"], "cardData": { "license": "other" } })).unwrap();
    assert_eq!(tagged.license.as_deref(), Some("llama3.1"));
    let carded = parse_model(&json!({ "id": "a/b", "cardData": { "license": "mit" } })).unwrap();
    assert_eq!(carded.license.as_deref(), Some("mit"));
}

#[test]
fn the_chat_template_tells_what_a_model_can_do() {
    let capable = json!({ "id": "a/b", "tags": ["gguf"], "gguf": { "chat_template": "{% if tools %}...{{ tool_call }}{% endif %}{% if enable_thinking %}<think>{% endif %}" } });
    let tags = parse_model(&capable).unwrap().tags;
    assert_eq!(tags, ["tool-use", "thinking"]);
    let plain = json!({ "id": "a/b", "tags": ["gguf", "chat"], "gguf": { "chat_template": "{{ messages }}" } });
    assert_eq!(parse_model(&plain).unwrap().tags, ["chat"]);
    assert!(parse_model(&json!({ "id": "a/b" })).unwrap().tags.is_empty());
}

#[test]
fn models_that_are_not_language_models_are_left_out() {
    let list = json!([
        { "id": "a/Chat-GGUF", "pipeline_tag": "text-generation", "gguf": { "architecture": "llama" } },
        { "id": "a/Image-GGUF", "pipeline_tag": "text-to-image", "gguf": { "architecture": "flux" } },
        { "id": "a/Embed-GGUF", "pipeline_tag": "feature-extraction" },
        { "id": "a/Quiet-GGUF", "gguf": { "architecture": "qwen_image" } },
        { "id": "a/Vision-GGUF", "pipeline_tag": "image-text-to-text" },
        { "id": "a/NoPipeline-GGUF" },
    ]);
    let names: Vec<String> = parse_models(&list).into_iter().map(|model| model.name).collect();
    assert_eq!(names, ["Chat-GGUF", "Vision-GGUF", "NoPipeline-GGUF"]);
}

#[test]
fn official_makers_are_matched_without_regard_to_case() {
    for maker in ["Qwen", "google", "openai", "meta-llama", "mistralai", "NVIDIA", "microsoft", "deepseek-ai", "zai-org", "ibm-granite", "LiquidAI", "allenai", "CohereLabs", "moonshotai", "MiniMaxAI"] {
        assert!(is_official(maker), "{maker}");
    }
    for other in ["unsloth", "bartowski", "lmstudio-community", "mradermacher", "ggml-org", "DavidAU"] {
        assert!(!is_official(other), "{other} publishes quantizations, it is not a model maker");
    }
}

// --- quantizations ---------------------------------------------------------------------------

#[test]
fn quantizations_are_named_from_the_file_name() {
    for (stem, quant) in [
        ("Qwen3.8-27B-UD-IQ3_XXS", "UD-IQ3_XXS"),
        ("Qwen3.8-27B-Q8_0", "Q8_0"),
        ("gemma-4-12b-it-Q4_K_M", "Q4_K_M"),
        ("gemma-4-31B-it-qat-UD-Q4_K_XL", "UD-Q4_K_XL"),
        ("gpt-oss-20b-F16", "F16"),
        ("Qwen3.6-35B-A3B-MXFP4_MOE", "MXFP4_MOE"),
        ("Qwen_Qwen3-8B-Q6_K_L", "Q6_K_L"),
        ("Llama-3.1-8B-Instruct-IQ4_XS", "IQ4_XS"),
        ("Mistral-7B-Instruct-v0.3.Q5_K_M", "Q5_K_M"),
        ("Mistral-7B-Instruct-v0.3.i1-IQ3_M", "IQ3_M"),
        ("model-bf16", "BF16"),
        ("Qwen3-4B-Instruct-2507-UD-Q2_K_XL", "UD-Q2_K_XL"),
    ] {
        assert_eq!(quant_token(stem).as_deref(), Some(quant), "{stem}");
    }
    // A model name that starts with Q is not a quantization.
    assert_eq!(quant_token("QwQ-32B"), None);
    assert_eq!(quant_token("Qwen3-Coder"), None);
}

#[test]
fn bits_per_weight_for_the_common_names() {
    assert_eq!(nominal_bits("Q4_K_M"), Some(4.85));
    assert_eq!(nominal_bits("UD-Q4_K_M"), Some(4.85));
    assert_eq!(nominal_bits("F16"), Some(16.0));
    assert_eq!(nominal_bits("IQ2_XXS"), Some(2.06));
    assert!((nominal_bits("UD-Q4_K_XL").unwrap() - 5.1).abs() < 1e-9, "the XL mixes sit above _M");
    assert_eq!(nominal_bits("Weird"), None);
}

#[test]
fn a_file_tree_is_grouped_into_quantizations_with_split_sets_and_the_picture_reader() {
    let (quants, mmproj) = parse_tree(&fixture_json("tree-qwen38.json"), Some(27.32));
    let names: Vec<&str> = quants.iter().map(|quant| quant.quant.as_str()).collect();
    // The speculative-decoding head (MTP/) and the imatrix file are not models; sizes ascending.
    assert_eq!(names, ["UD-IQ3_XXS", "Q4_0", "UD-Q4_K_M", "Q8_0", "BF16"], "{names:?}");
    let split = quants.iter().find(|quant| quant.quant == "BF16").unwrap();
    assert_eq!(split.files.len(), 2, "a split set is one quantization with every part");
    assert_eq!(split.files[0].path, "BF16/Qwen3.8-27B-BF16-00001-of-00002.gguf");
    assert!(split.files[1].path.ends_with("00002-of-00002.gguf"));
    assert_eq!(split.bytes, 49_986_159_616 + 4_671_576_000);
    assert_eq!(split.files[0].sha256.as_deref().map(str::len), Some(64), "SHA-256 comes from lfs.oid");
    let q4 = quants.iter().find(|quant| quant.quant == "UD-Q4_K_M").unwrap();
    assert_eq!((q4.bytes, q4.files.len()), (16_464_440_224, 1));
    assert!((q4.bits.unwrap() - 4.8).abs() < 0.05, "measured from the size: {:?}", q4.bits);
    let projector = mmproj.expect("a picture reader");
    assert_eq!(projector.quant, "mmproj-F16", "F16 is preferred over BF16");
    assert_eq!(projector.bytes, 927_607_488);
    // Without the parameter count, bits come from the name.
    let (plain, _) = parse_tree(&fixture_json("tree-qwen38.json"), None);
    assert_eq!(plain.iter().find(|quant| quant.quant == "Q8_0").unwrap().bits, Some(8.5));
}

#[test]
fn split_sets_in_folders_are_found_too() {
    let (quants, mmproj) = parse_tree(&fixture_json("tree-gptoss.json"), Some(116.8));
    let names: Vec<&str> = quants.iter().map(|quant| quant.quant.as_str()).collect();
    assert_eq!(names, ["UD-Q4_K_XL", "Q8_0", "F16"], "{names:?}");
    assert!(quants.iter().filter(|quant| quant.quant != "F16").all(|quant| quant.files.len() == 2));
    assert_eq!(quants[0].files[0].path, "UD-Q4_K_XL/gpt-oss-120b-UD-Q4_K_XL-00001-of-00002.gguf");
    assert_eq!(quants[1].files[0].path, "Q8_0/gpt-oss-120b-Q8_0-00001-of-00002.gguf");
    assert!(mmproj.is_none());
}

#[test]
fn a_half_listed_split_set_is_dropped_and_duplicates_are_told_apart() {
    let tree = json!([
        { "type": "file", "path": "Big-Q4_K_M-00001-of-00003.gguf", "size": 100, "lfs": { "oid": "a", "size": 100 } },
        { "type": "file", "path": "Big-Q4_K_M-00003-of-00003.gguf", "size": 100, "lfs": { "oid": "c", "size": 100 } },
        { "type": "file", "path": "Big-Q8_0.gguf", "size": 300, "lfs": { "oid": "d", "size": 300 } },
        { "type": "file", "path": "Big-MTP-Q8_0.gguf", "size": 400, "lfs": { "oid": "e", "size": 400 } },
        { "type": "file", "path": "README.md", "size": 5 },
        { "type": "directory", "path": "extra.gguf" },
        { "type": "file", "path": "small.gguf", "size": 7 },
    ]);
    let (quants, mmproj) = parse_tree(&tree, None);
    let names: Vec<&str> = quants.iter().map(|quant| quant.quant.as_str()).collect();
    assert_eq!(names, ["small", "Q8_0", "Q8_0 (2)"], "{names:?}");
    assert_eq!(quants[0].files[0].sha256, None, "a file kept in git itself has no LFS hash");
    assert!(mmproj.is_none());
}

#[test]
fn the_readme_loses_its_front_matter_and_is_cut_politely() {
    let summary = readme_summary(&fixture("readme.md")).unwrap();
    assert!(!summary.starts_with("---") && !summary.contains("library_name:"), "{summary}");
    assert!(summary.starts_with("# Read our How to"), "{summary}");
    let long = format!("---\na: b\n---\n{}", "A paragraph of words.\n\n".repeat(400));
    let cut = readme_summary(&long).unwrap();
    assert!(cut.chars().count() <= README_CHARS + 5 && cut.ends_with('…') && !cut.contains("a: b"), "{}", cut.chars().count());
    assert_eq!(readme_summary("---\nx: y\n---\n\n"), None);
    assert_eq!(readme_summary("plain text").as_deref(), Some("plain text"));
}

// --- logos -----------------------------------------------------------------------------------

#[test]
fn the_avatar_answer_has_an_address() {
    let value = fixture_json("avatar.json");
    let url = text_of(&value["avatarUrl"]).unwrap();
    assert!(is_hugging_face_host(&url), "{url}");
    assert_eq!(avatar_ext(None, &url), "jpg");
    assert_eq!(avatar_ext(Some("image/png"), &url), "png");
    assert_eq!(avatar_ext(Some("image/svg+xml"), "https://x/avatar"), "svg");
    assert_eq!(avatar_ext(None, "https://x/avatar"), "png");
    assert_eq!(avatar_ext(Some("image/webp"), "https://x/a.png?x=1"), "webp");
    assert!(!is_hugging_face_host("http://huggingface.co/a.png"));
    assert!(!is_hugging_face_host("https://evilhuggingface.co/a.png"));
    assert!(!is_hugging_face_host("https://huggingface.co.evil.example/a.png"));
    assert!(is_hugging_face_host("https://cdn-avatars.huggingface.co/v1/a.png"));
}

#[test]
fn a_cached_logo_is_found_by_name_whatever_its_extension() {
    let models = scratch("avatars");
    let dir = avatars_dir(&models);
    assert!(dir.ends_with(Path::new("library").join("avatars")));
    std::fs::create_dir_all(&dir).unwrap();
    assert_eq!(cached_avatar(&dir, "Qwen"), None);
    std::fs::write(dir.join("Qwen.jpg"), b"jpeg bytes").unwrap();
    std::fs::write(dir.join("unsloth.png.part"), b"half").unwrap();
    std::fs::write(dir.join("empty.png"), b"").unwrap();
    assert_eq!(cached_avatar(&dir, "Qwen"), Some(dir.join("Qwen.jpg")));
    assert_eq!(cached_avatar(&dir, "unsloth"), None, "a part-file is not a logo");
    assert_eq!(cached_avatar(&dir, "empty"), None);
    assert_eq!(cached_avatar(&dir, "Qwe"), None, "names match whole");
    assert_eq!(safe_name("a/b:c d"), "a_b_c_d");
    // A cached logo is returned without any request.
    let rt = tokio::runtime::Builder::new_current_thread().enable_all().build().unwrap();
    let path = rt.block_on(avatar_for(&models, "Qwen"));
    assert_eq!(path, Some(dir.join("Qwen.jpg").display().to_string()));
    let _ignored = std::fs::remove_dir_all(&models);
}

// --- GGUF header -----------------------------------------------------------------------------

fn gguf_string(out: &mut Vec<u8>, text: &str) {
    out.extend((text.len() as u64).to_le_bytes());
    out.extend(text.as_bytes());
}

fn gguf_sample(with_experts: bool, truncate_in_vocabulary: bool) -> Vec<u8> {
    let mut out = b"GGUF".to_vec();
    out.extend(3_u32.to_le_bytes());
    out.extend(0_u64.to_le_bytes());
    out.extend(if with_experts { 8_u64 } else { 6_u64 }.to_le_bytes());
    gguf_string(&mut out, "general.architecture");
    out.extend(8_u32.to_le_bytes());
    gguf_string(&mut out, "qwen35moe");
    gguf_string(&mut out, "general.name");
    out.extend(8_u32.to_le_bytes());
    gguf_string(&mut out, "Qwen3.6 35B A3B");
    gguf_string(&mut out, "qwen35moe.block_count");
    out.extend(4_u32.to_le_bytes());
    out.extend(40_u32.to_le_bytes());
    gguf_string(&mut out, "qwen35moe.context_length");
    out.extend(10_u32.to_le_bytes());
    out.extend(262_144_u64.to_le_bytes());
    gguf_string(&mut out, "qwen35moe.rope.dimension_sections");
    out.extend(9_u32.to_le_bytes());
    out.extend(4_u32.to_le_bytes());
    out.extend(3_u64.to_le_bytes());
    for value in [11_u32, 11, 10] {
        out.extend(value.to_le_bytes());
    }
    gguf_string(&mut out, "general.tags");
    out.extend(9_u32.to_le_bytes());
    out.extend(8_u32.to_le_bytes());
    out.extend(2_u64.to_le_bytes());
    gguf_string(&mut out, "text-generation");
    gguf_string(&mut out, "image-text-to-text");
    if with_experts {
        gguf_string(&mut out, "qwen35moe.expert_count");
        out.extend(4_u32.to_le_bytes());
        out.extend(256_u32.to_le_bytes());
        gguf_string(&mut out, "qwen35moe.expert_used_count");
        out.extend(4_u32.to_le_bytes());
        out.extend(8_u32.to_le_bytes());
    }
    gguf_string(&mut out, "tokenizer.ggml.tokens");
    out.extend(9_u32.to_le_bytes());
    out.extend(8_u32.to_le_bytes());
    out.extend(1_000_000_u64.to_le_bytes());
    if truncate_in_vocabulary {
        gguf_string(&mut out, "<unk>");
    }
    out
}

#[test]
fn the_gguf_header_says_how_the_model_is_built() {
    let shape = parse_gguf_header(&gguf_sample(true, true)).expect("reads the header");
    assert_eq!(shape, GgufShape { architecture: "qwen35moe".into(), layers: 40, context: Some(262_144), experts: 256, experts_used: 8 });
    let dense = parse_gguf_header(&gguf_sample(false, true)).unwrap();
    assert_eq!((dense.experts, dense.experts_used, dense.layers), (0, 0, 40));
    assert_eq!(parse_gguf_header(b"not a gguf file at all"), None);
    assert_eq!(parse_gguf_header(b"GGUF"), None);
    let mut wrong_version = gguf_sample(true, true);
    wrong_version[4] = 9;
    assert_eq!(parse_gguf_header(&wrong_version), None);
    // Cut off before the settings are all read: nothing is guessed.
    assert_eq!(parse_gguf_header(&gguf_sample(true, true)[..60]), None);
}

// --- ids, names and the library entry --------------------------------------------------------

#[test]
fn ids_are_sanitised_and_stable() {
    assert_eq!(entry_id("unsloth/Qwen3.6-35B-A3B-GGUF", "UD-Q4_K_M"), "hf:unsloth/Qwen3.6-35B-A3B-GGUF:UD-Q4_K_M");
    assert_eq!(entry_id("bartowski/Llama 3.1 8B (new)", "Q8_0 (2)"), "hf:bartowski/Llama-3.1-8B-new:Q8_0-2");
    assert_eq!(entry_id("a/b", "mmproj-F16"), "hf:a/b:mmproj-F16");
    assert_eq!(entry_id("a/b", "Q4_K_M"), entry_id("a/b", "Q4_K_M"));
    assert_eq!(sanitize("--a//b::c--"), "a-b-c");
    assert_eq!(entry_folder("hf:unsloth/Qwen3.6-35B-A3B-GGUF:UD-Q4_K_M"), "llm/hf_unsloth_Qwen3.6-35B-A3B-GGUF_UD-Q4_K_M");
    assert_eq!(resolve_url("a/b", "UD-Q4_K_XL/model name+1.gguf"), "https://huggingface.co/a/b/resolve/main/UD-Q4_K_XL/model%20name%2B1.gguf");
}

#[test]
fn the_names_of_experts_models_say_how_many_parameters_work() {
    assert_eq!(active_params_in("Qwen3.6-35B-A3B-GGUF"), Some(3.0));
    assert_eq!(active_params_in("Mellum2.1-12B-A2.5B-Thinking-GGUF"), Some(2.5));
    assert_eq!(active_params_in("gemma-4-26B-A4B-it-GGUF"), Some(4.0));
    assert_eq!(active_params_in("Qwen3-8B-GGUF"), None);
    assert_eq!(active_params_in("Llama-3-Alpaca-GGUF"), None);
    assert!(looks_moe(Some("qwen35moe"), "x") && looks_moe(Some("gpt-oss"), "x") && looks_moe(None, "Foo-30B-A3B"));
    assert!(!looks_moe(Some("llama"), "Llama-3.1-8B") && !looks_moe(None, "Llama-3.1-8B"));
}

fn detail_from_fixtures() -> HubDetail {
    let mut model = parse_model(&fixture_json("model-qwen36.json")).unwrap();
    model.avatar_path = Some("D:/models/library/avatars/unsloth.png".into());
    let (quants, mmproj) = parse_tree(&fixture_json("tree-qwen38.json"), model.params_b);
    HubDetail { model, quants, summary: None, mmproj, helpers: Vec::new() }
}

#[test]
fn an_added_model_is_a_catalog_shaped_entry_the_library_can_read() {
    let detail = detail_from_fixtures();
    let quant = detail.quants.iter().find(|quant| quant.quant == "UD-Q4_K_M").unwrap();
    let shape = GgufShape { architecture: "qwen35moe".into(), layers: 40, context: Some(262_144), experts: 256, experts_used: 8 };
    let json = build_entry(&detail, quant, Some(&shape));
    // The library's own reader accepts it as it is.
    let entry: model_library::LibraryEntry = serde_json::from_value(json.clone()).expect("a LibraryEntry");
    assert_eq!(entry.id, "hf:unsloth/Qwen3.6-35B-A3B-GGUF:UD-Q4_K_M");
    assert_eq!((entry.kind.as_str(), entry.runtime.as_str(), entry.source.as_deref()), ("llm", "llama-cpp", Some("huggingface")));
    assert_eq!(entry.maker, "Qwen");
    let publisher = entry.publisher.as_ref().unwrap();
    assert_eq!((publisher.name.as_str(), publisher.repo.as_str()), ("unsloth", "unsloth/Qwen3.6-35B-A3B-GGUF"));
    assert_eq!(publisher.avatar_path.as_deref(), Some("D:/models/library/avatars/unsloth.png"));
    assert_eq!(entry.thumbnail.as_ref().and_then(|thumb| thumb.src.as_deref()), Some("library-thumbs/_llm.svg"));
    assert!(entry.tasks.contains(&"chat".to_owned()) && entry.tasks.contains(&"vision".to_owned()));
    assert!(!entry.license.requires_acceptance && entry.license.name == "Apache License 2.0", "{:?}", entry.license);
    assert_eq!(entry.variants.len(), 1);
    let variant = &entry.variants[0];
    assert_eq!(variant.id, "UD-Q4_K_M");
    assert_eq!(variant.default, Some(true));
    // The model file, then its picture reader, with url, dest, size and SHA-256.
    assert_eq!(variant.files.len(), 2);
    assert_eq!(variant.files[0].url, "https://huggingface.co/unsloth/Qwen3.6-35B-A3B-GGUF/resolve/main/Qwen3.8-27B-UD-Q4_K_M.gguf");
    assert_eq!(variant.files[0].dest, "llm/hf_unsloth_Qwen3.6-35B-A3B-GGUF_UD-Q4_K_M/Qwen3.8-27B-UD-Q4_K_M.gguf");
    assert_eq!(variant.files[0].bytes, 16_464_440_224);
    assert_eq!(variant.files[0].sha256.as_deref().map(str::len), Some(64));
    assert!(variant.files[1].dest.ends_with("/mmproj-F16.gguf") && variant.files[1].bytes == 927_607_488);
    // An experts model: a low minimum of video memory; a comfortable one that holds everything.
    assert!(variant.min_vram_gb >= 2.5 && variant.min_vram_gb < 6.0, "{}", variant.min_vram_gb);
    assert!(variant.rec_vram_gb > 17.0 && variant.min_ram_gb > 15.0, "{variant:?}");
    let llm = variant.llm.as_ref().expect("a shape from the GGUF header");
    assert_eq!((llm.layers, llm.context_max, llm.moe, llm.quant.as_str()), (40, 262_144, true, "UD-Q4_K_M"));
    assert_eq!(llm.active_params_b, 3.0, "the name says A3B");
    assert!(entry.name.ends_with("\u{b7} UD-Q4_K_M") && entry.name.starts_with("Qwen3.6-35B-A3B "), "{}", entry.name);
    // And without a header there is no shape, but still a card.
    let plain: model_library::LibraryEntry = serde_json::from_value(build_entry(&detail, quant, None)).unwrap();
    assert!(plain.variants[0].llm.is_none());
}

#[test]
fn unknown_or_restrictive_licenses_ask_for_acceptance() {
    assert!(!license_of(Some("mit")).needs_acceptance && !license_of(Some("Apache-2.0")).needs_acceptance);
    let llama = license_of(Some("llama3.1"));
    assert!(llama.needs_acceptance && llama.name.contains("llama3.1"));
    assert!(license_of(None).needs_acceptance);
    let mut detail = detail_from_fixtures();
    detail.model.license = Some("gemma".into());
    let json = build_entry(&detail, &detail.quants[0].clone(), None);
    assert_eq!(json["license"]["requiresAcceptance"], true);
    detail.model.license = Some("apache-2.0".into());
    detail.model.gated = true;
    assert_eq!(build_entry(&detail, &detail.quants[0].clone(), None)["license"]["requiresAcceptance"], false, "a gated repo is the sign-in flow's job, not a licence step");
}

#[test]
fn draft_files_are_helpers_not_quants() {
    let tree = json!([
        { "type": "file", "path": "M-Q4_K_M.gguf", "size": 100, "lfs": { "oid": "a", "size": 100 } },
        { "type": "file", "path": "M-MTP-draft.gguf", "size": 41, "lfs": { "oid": "b", "size": 41 } },
        { "type": "file", "path": "M-eagle3-Q8_0.gguf", "size": 8, "lfs": { "oid": "c", "size": 8 } },
        { "type": "file", "path": "M-dflash.gguf", "size": 9, "lfs": { "oid": "d", "size": 9 } },
        { "type": "file", "path": "Draftsman-Q8_0.gguf", "size": 300, "lfs": { "oid": "e", "size": 300 } },
    ]);
    let (quants, _) = parse_tree(&tree, None);
    let names: Vec<&str> = quants.iter().map(|quant| quant.quant.as_str()).collect();
    assert_eq!(names, ["Q4_K_M", "Q8_0"], "{names:?}");
    let helpers = parse_helpers(&tree);
    let kinds: Vec<(&str, u64)> = helpers.iter().map(|helper| (helper.kind.as_str(), helper.bytes)).collect();
    assert_eq!(kinds, [("eagle3", 8), ("draft", 9), ("mtp", 41)]);
}

#[test]
fn old_entries_lose_the_forced_acceptance_of_a_gated_repo() {
    let mut entry = json!({ "source": "huggingface", "license": { "name": "Apache License 2.0", "requiresAcceptance": true } });
    assert!(normalize_acceptance(&mut entry));
    assert_eq!(entry["license"]["requiresAcceptance"], false);
    let mut other = json!({ "source": "huggingface", "license": { "name": "gemma (read its terms)", "requiresAcceptance": true } });
    assert!(!normalize_acceptance(&mut other));
    assert_eq!(other["license"]["requiresAcceptance"], true);
}

#[test]
fn memory_needs_follow_the_size_and_whether_it_is_an_experts_model() {
    let (min_vram, rec_vram, min_ram) = memory_needs(20.0, 0.0, false);
    assert_eq!((min_vram, rec_vram, min_ram), (0.0, 22.0, 25.0));
    let (moe_min, moe_rec, moe_ram) = memory_needs(20.0, 1.0, true);
    assert_eq!(moe_min, 4.0);
    assert_eq!(moe_rec, 23.0);
    assert_eq!(moe_ram, 25.0);
    assert!(memory_needs(1.0, 0.0, true).0 >= 2.5);
}

// --- hub-models.json -------------------------------------------------------------------------

#[test]
fn entries_are_added_replaced_and_removed_by_id() {
    let dir = scratch("file");
    let file = dir.join("library").join("hub-models.json");
    let detail = detail_from_fixtures();
    let a = build_entry(&detail, &detail.quants[0], None);
    let b = build_entry(&detail, &detail.quants[1], None);
    let id_a = a["id"].as_str().unwrap().to_owned();
    let id_b = b["id"].as_str().unwrap().to_owned();
    upsert_entry(&file, a.clone()).unwrap();
    upsert_entry(&file, b).unwrap();
    assert_eq!(read_entries(&file).len(), 2);
    // The same id again replaces; it never duplicates.
    let mut changed = a;
    changed["summary"] = json!("changed");
    upsert_entry(&file, changed).unwrap();
    let entries = read_entries(&file);
    assert_eq!(entries.len(), 2);
    assert_eq!(entries[0]["summary"], "changed");
    assert!(remove_entry(&file, &id_a).unwrap());
    assert!(!remove_entry(&file, &id_a).unwrap());
    let left = read_entries(&file);
    assert_eq!(left.len(), 1);
    assert_eq!(left[0]["id"].as_str(), Some(id_b.as_str()));
    // The library reads what was written.
    let text = std::fs::read_to_string(&file).unwrap();
    let parsed: Vec<model_library::LibraryEntry> = serde_json::from_str(&text).unwrap();
    assert_eq!(parsed.len(), 1);
    let _ignored = std::fs::remove_dir_all(&dir);
}

#[test]
fn repository_names_are_checked_before_they_reach_a_url() {
    assert!(valid_repo("unsloth/Qwen3.6-35B-A3B-GGUF"));
    assert!(valid_repo("a/b.c_d-e"));
    for bad in ["", "noslash", "a/b/c", "../etc/passwd", "a/ b", "a/b?x=1", "/b", "a/"] {
        assert!(!valid_repo(bad), "{bad}");
    }
}

#[test]
fn a_gated_repo_is_added_only_once_access_is_granted() {
    assert!(gated_refusal("a/b", "granted").is_none());
    assert!(gated_refusal("a/b", "needs-terms").unwrap().contains("accept its terms"));
    assert!(gated_refusal("a/b", "needs-sign-in").unwrap().contains("sign-in"));
    assert!(gated_refusal("a/b", "unknown").unwrap().contains("could not tell"));
}
