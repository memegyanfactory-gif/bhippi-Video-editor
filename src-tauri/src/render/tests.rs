//! Plan-level tests: what the graph and the command line say, without running FFmpeg.

use super::{keyframe_expr, keyframe_value, plan, ExportOptions, Output, Rate, RenderPlan};
use crate::library::{Asset, AssetKind};
use crate::project::fixtures::{clip, comp, project};
use crate::project::{Clip, ClipSource, Comp, Easing, Effects, ItemKind, Keyframe, Marker, Mask, MaskShape, Preset, Project, ProjectItem, ShapeKind, SfxKind, Transform, Transition, TransitionKind};
use std::collections::HashMap;

/// An asset the renderer can plan against: `validate_media` insists the file is really there.
fn asset(id: &str, kind: AssetKind, duration: f64) -> Asset {
    // A stable name: the plan only needs the file to exist, and temp should not fill up.
    let path = std::env::temp_dir().join(format!("helios-plan-stand-in.{}", if kind == AssetKind::Image { "png" } else { "mp4" }));
    std::fs::write(&path, b"not really media").expect("write the stand-in file");
    Asset {
        id: id.to_owned(),
        name: "clip.mp4".to_owned(),
        path: path.display().to_string(),
        kind,
        duration,
        width: 1920,
        height: 1080,
        fps: Some(30.0),
        has_audio: kind != AssetKind::Image,
        video_codec: Some("h264".to_owned()),
        audio_codec: Some("aac".to_owned()),
        size: 16,
        imported_at: chrono::Utc::now(),
        thumbnail: None,
        filmstrip: None,
        waveform: None,
        peaks: None,
        proxy: None,
        preview: "native".to_owned(),
        missing: false,
    }
}

fn library(assets: Vec<Asset>) -> HashMap<String, Asset> {
    assets.into_iter().map(|asset| (asset.id.clone(), asset)).collect()
}

fn options(comp_id: &str) -> ExportOptions {
    ExportOptions { output: "out.mp4".to_owned(), comp_id: comp_id.to_owned(), resolution: None, fps: None, quality: "standard".to_owned(), in_to_out: false }
}

fn build(project: &Project, assets: &HashMap<String, Asset>, options: &ExportOptions, output: Output, start: f64) -> Result<RenderPlan, String> {
    plan(project, assets, options, |kind| format!("sfx/{}.wav", kind.as_str()), true, output, start)
}

/// The filter graph, wherever the plan put it.
fn graph(plan: &RenderPlan) -> String {
    let position = plan.args.iter().position(|arg| arg == "-filter_complex" || arg == "-/filter_complex").expect("a graph");
    let value = &plan.args[position + 1];
    if plan.args[position] == "-filter_complex" {
        value.clone()
    } else {
        let contents = &plan.files.iter().find(|(name, _)| name == value).expect("the graph file").1;
        String::from_utf8_lossy(contents).into_owned()
    }
}

fn media(id: &str) -> ClipSource {
    ClipSource::Media { asset_id: id.to_owned() }
}

#[test]
fn every_media_clip_seeks_its_own_window_instead_of_decoding_from_zero() {
    let assets = library(vec![asset("m", AssetKind::Video, 2400.0)]);
    let mut late = clip("b", "v1", 2.0, 2.0, media("m"));
    late.in_point = 1800.0;
    let project = project(vec![comp("c", vec![clip("a", "v1", 0.0, 2.0, media("m")), late])]);
    let plan = build(&project, &assets, &options("c"), Output::Video, 0.0).expect("plan");
    let arguments = plan.args.join(" ");
    assert_eq!(plan.args.iter().filter(|arg| *arg == "-ss").count(), 2, "one seek per clip: {arguments}");
    assert!(arguments.contains("-ss 1800 -t 2"), "the late clip seeks to its own in point: {arguments}");
    assert_eq!((plan.width, plan.height, plan.duration), (1920, 1080, 4.0));
    assert!(arguments.contains("-c:v libx264 -preset medium -crf 20"));
    assert!(arguments.ends_with("-t 4 out.mp4"));
}

#[test]
fn tracks_are_composited_bottom_to_top_and_hidden_ones_are_left_out() {
    let assets = library(vec![asset("m", AssetKind::Video, 10.0)]);
    let mut project = project(vec![comp(
        "c",
        vec![
            clip("low", "v1", 0.0, 2.0, ClipSource::Item { item_id: "red".into() }),
            clip("high", "v2", 0.0, 2.0, media("m")),
        ],
    )]);
    project.items.push(ProjectItem { id: "red".into(), kind: ItemKind::ColorMatte, name: "Red".into(), color: "#FF0000".into(), width: 1920, height: 1080, duration: 5.0, folder_id: None });
    let plan = build(&project, &assets, &options("c"), Output::Video, 0.0).expect("plan");
    let text = graph(&plan);
    let matte = text.find("color=c=0xFF0000").expect("the matte");
    let overlays: Vec<usize> = text.match_indices("overlay=format=gbrp").map(|(at, _)| at).collect();
    assert_eq!(overlays.len(), 2, "one overlay per track: {text}");
    assert!(matte < overlays[0], "V1 is built before it is overlaid");

    project.comps[0].tracks[1].hidden = true;
    let hidden = build(&project, &assets, &options("c"), Output::Video, 0.0).expect("plan");
    assert_eq!(graph(&hidden).matches("overlay=format=gbrp").count(), 1, "the hidden track is skipped");
    assert!(!graph(&hidden).contains("-i "), "and its media is never opened");
}

#[test]
fn an_untouched_clip_adds_no_colour_or_transform_filters() {
    let assets = library(vec![asset("m", AssetKind::Video, 10.0)]);
    let project = project(vec![comp("c", vec![clip("a", "v1", 0.0, 2.0, media("m"))])]);
    let plain = graph(&build(&project, &assets, &options("c"), Output::Video, 0.0).expect("plan"));
    for filter in ["lutrgb", "colorchannelmixer", "gblur", "rotate=", "crop=", ",pad=", "hflip", "sendcmd"] {
        assert!(!plain.contains(filter), "{filter} should not appear: {plain}");
    }

    let mut busy = project;
    let clip = &mut busy.comps[0].clips[0];
    clip.effects = Effects { brightness: 10.0, contrast: -5.0, saturation: 0.0, blur: 4.0, hue: 30.0, invert: 50.0, flip_h: true, flip_v: false };
    clip.transform = Transform { rotation: 12.0, scale: 80.0, opacity: 50.0, crop_left: 10.0, ..Transform::default() };
    let text = graph(&build(&busy, &assets, &options("c"), Output::Video, 0.0).expect("plan"));
    let order: Vec<&str> = ["hflip", "crop=w=iw", "scale=", "lutrgb", "colorchannelmixer=rr", "gblur", "colorchannelmixer=aa", "rotate=", ",pad="].to_vec();
    let mut last = 0;
    for filter in order {
        let at = text.find(filter).unwrap_or_else(|| panic!("{filter} missing from {text}"));
        assert!(at >= last, "{filter} is out of order in {text}");
        last = at;
    }
    assert_eq!(text.matches("lutrgb").count(), 2, "brightness/contrast and invert");
    assert!(text.contains("colorchannelmixer=aa=0.5"));
}

#[test]
fn in_to_out_exports_just_that_range_and_a_still_takes_one_frame_with_no_sound() {
    let assets = library(vec![asset("m", AssetKind::Video, 10.0)]);
    let mut project = project(vec![comp("c", vec![clip("a", "v1", 0.0, 6.0, media("m"))])]);
    project.comps[0].in_point = Some(2.0);
    project.comps[0].out_point = Some(3.5);
    let ranged = build(&project, &assets, &ExportOptions { in_to_out: true, ..options("c") }, Output::Video, 0.0).expect("plan");
    assert!((ranged.duration - 1.5).abs() < 1e-9);
    assert!(ranged.args.join(" ").contains("-ss 2 -t 1.5"), "{:?}", ranged.args);
    let mut empty = ExportOptions { in_to_out: true, ..options("c") };
    project.comps[0].out_point = Some(2.0);
    assert!(build(&project, &assets, &empty, Output::Video, 0.0).expect_err("empty range").contains("In→Out"));

    empty.in_to_out = false;
    let still = build(&project, &assets, &empty, Output::Still, 1.0).expect("still");
    let arguments = still.args.join(" ");
    assert!(arguments.contains("-frames:v 1 -update 1") && arguments.ends_with("out.mp4"));
    assert!(!arguments.contains("[aout]"), "a still has no audio output: {arguments}");
    let text = graph(&still);
    let produced: Vec<&str> = text.match_indices("[s").map(|(at, _)| &text[at + 1..at + text[at..].find(']').expect("a label")]).collect();
    for label in &produced {
        let uses = text.matches(&format!("[{label}]")).count();
        assert!(uses >= 2, "{label} is produced but never used: {text}");
    }
}

#[test]
fn only_audible_tracks_reach_the_mix() {
    let assets = library(vec![asset("m", AssetKind::Video, 10.0)]);
    let mut project = project(vec![comp(
        "c",
        vec![
            clip("v", "v1", 0.0, 2.0, media("m")),
            clip("one", "a1", 0.0, 2.0, media("m")),
            clip("two", "a2", 0.0, 2.0, ClipSource::Sfx { kind: SfxKind::Whoosh }),
        ],
    )]);
    let both = build(&project, &assets, &options("c"), Output::Video, 0.0).expect("plan");
    assert!(graph(&both).contains("amix=inputs=2"), "{}", graph(&both));
    assert!(both.args.join(" ").contains("sfx/whoosh.wav"));
    assert!(graph(&both).contains("alimiter"));

    project.comps[0].tracks[3].muted = true;
    let muted = build(&project, &assets, &options("c"), Output::Video, 0.0).expect("plan");
    assert!(!graph(&muted).contains("amix="), "one voice needs no mixer: {}", graph(&muted));
    assert!(!muted.args.join(" ").contains("whoosh"), "a muted track is never opened");

    project.comps[0].tracks[3].muted = false;
    project.comps[0].tracks[3].solo = true;
    let soloed = build(&project, &assets, &options("c"), Output::Video, 0.0).expect("plan");
    let arguments = soloed.args.join(" ");
    assert!(arguments.contains("whoosh") && !graph(&soloed).contains("amix="), "solo leaves only A2: {arguments}");
}

#[test]
fn the_picture_extras_reach_the_graph_as_files() {
    let assets = library(vec![asset("m", AssetKind::Video, 10.0)]);
    let mut shape = clip(
        "s",
        "v2",
        0.0,
        2.0,
        ClipSource::Shape { shape: ShapeKind::Ellipse, sides: 5, fill: Some("#FF00FF".into()), stroke: None, stroke_width: 0.0, width: 400.0, height: 400.0, corner_radius: 0.0 },
    );
    shape.mask = Some(Mask { shape: MaskShape::Rectangle, x: 0.0, y: 0.0, width: 0.5, height: 1.0, points: Vec::new(), feather: 8.0, inverted: false });
    shape.keyframes.opacity = vec![Keyframe { time: 0.0, value: 0.0, easing: Easing::Linear }, Keyframe { time: 2.0, value: 100.0, easing: Easing::Linear }];
    let title = clip("t", "v2", 2.0, 2.0, ClipSource::Text { text: "Hi".into(), subtitle: String::new(), preset: Preset::Title, color: "#FFFFFF".into(), style: None, vertical: false });
    let project = project(vec![comp("c", vec![clip("a", "v1", 0.0, 4.0, media("m")), shape, title])]);
    let plan = build(&project, &assets, &options("c"), Output::Video, 0.0).expect("plan");
    let names: Vec<&str> = plan.files.iter().map(|(name, _)| name.as_str()).collect();
    assert!(names.iter().any(|name| name.ends_with(".pam")), "the shape raster: {names:?}");
    assert!(names.iter().any(|name| name.ends_with(".pgm")), "the mask matte: {names:?}");
    assert!(names.iter().any(|name| name.ends_with(".ass")), "the text script: {names:?}");
    assert!(names.iter().any(|name| name.ends_with(".txt")), "the opacity commands: {names:?}");
    let text = graph(&plan);
    assert!(text.contains("alphamerge") && text.contains("blend=all_mode=multiply"), "the mask multiplies into alpha: {text}");
    assert!(text.contains("sendcmd=f=") && text.contains("colorchannelmixer@o"), "keyframed opacity is driven per frame: {text}");
    assert!(text.contains("ass=filename=") && text.contains(":alpha=1"));
}

#[test]
fn a_transition_renders_both_clips_over_its_window() {
    let assets = library(vec![asset("m", AssetKind::Video, 30.0)]);
    let mut comp = comp("c", vec![clip("a", "v1", 0.0, 4.0, media("m")), clip("b", "v1", 4.0, 4.0, media("m"))]);
    comp.clips[1].in_point = 10.0;
    comp.transitions.push(Transition { id: "x".into(), track_id: "v1".into(), kind: TransitionKind::CrossDissolve, from_clip: Some("a".into()), to_clip: Some("b".into()), duration: 1.0, alignment: crate::project::Alignment::Center });
    let project = project(vec![comp]);
    let plan = build(&project, &assets, &options("c"), Output::Video, 0.0).expect("plan");
    let text = graph(&plan);
    assert!(text.contains("xfade=transition=fade:duration=1"), "{text}");
    // Outgoing plain part, transition, incoming plain part, all concatenated once.
    assert!(text.contains("concat=n=3:v=1:a=0"), "{text}");
    let arguments = plan.args.join(" ");
    assert!(arguments.contains("-ss 3.5"), "the outgoing clip is extended past its cut: {arguments}");
    assert!(arguments.contains("-ss 9.5"), "the incoming clip starts before its own start: {arguments}");
}

#[test]
fn an_adjustment_clip_colours_the_tracks_below_it_only_while_it_is_there() {
    let assets = library(vec![asset("m", AssetKind::Video, 10.0)]);
    let mut adjust = clip("adj", "v2", 1.0, 1.0, ClipSource::Item { item_id: "layer".into() });
    adjust.effects.saturation = 0.0;
    let mut project = project(vec![comp("c", vec![clip("a", "v1", 0.0, 3.0, media("m")), adjust])]);
    project.items.push(ProjectItem { id: "layer".into(), kind: ItemKind::AdjustmentLayer, name: "Adjust".into(), color: "#FFFFFF".into(), width: 1920, height: 1080, duration: 5.0, folder_id: None });
    let text = graph(&build(&project, &assets, &options("c"), Output::Video, 0.0).expect("plan"));
    assert!(text.contains("colorchannelmixer=rr=0.213"), "the saturation matrix: {text}");
    assert!(text.contains("enable='between(n,30,59)'"), "only over its own frames: {text}");
    assert_eq!(text.matches("overlay=format=gbrp").count(), 1, "an opaque adjustment needs no second layer: {text}");

    project.comps[0].clips[1].transform.opacity = 40.0;
    let blended = graph(&build(&project, &assets, &options("c"), Output::Video, 0.0).expect("plan"));
    assert!(blended.contains("split") && blended.contains("colorchannelmixer=aa=0.4"), "a partial adjustment blends over the original: {blended}");
}

#[test]
fn options_are_checked_before_anything_is_built() {
    let assets = library(vec![asset("m", AssetKind::Video, 10.0)]);
    let project = project(vec![comp("c", vec![clip("a", "v1", 0.0, 2.0, media("m"))])]);
    let bad_resolution = ExportOptions { resolution: Some(999), ..options("c") };
    assert!(build(&project, &assets, &bad_resolution, Output::Video, 0.0).expect_err("resolution").contains("999p"));
    let bad_fps = ExportOptions { fps: Some(240.0), ..options("c") };
    assert!(build(&project, &assets, &bad_fps, Output::Video, 0.0).expect_err("fps").contains("between 1 and 120"));
    let bad_quality = ExportOptions { quality: "ultra".to_owned(), ..options("c") };
    assert!(build(&project, &assets, &bad_quality, Output::Video, 0.0).expect_err("quality").contains("ultra"));
    assert!(build(&project, &assets, &options("nope"), Output::Video, 0.0).expect_err("comp").contains("not in the project"));
    let nothing = crate::project::fixtures::project(vec![Comp { clips: Vec::new(), ..comp("c", Vec::new()) }]);
    assert!(build(&nothing, &assets, &options("c"), Output::Video, 0.0).expect_err("empty").contains("empty"));

    let scaled = ExportOptions { resolution: Some(720), fps: Some(29.97), ..options("c") };
    let plan = build(&project, &assets, &scaled, Output::Video, 0.0).expect("plan");
    assert_eq!((plan.width, plan.height), (1280, 720));
    assert!(graph(&plan).contains("r=30000/1001"), "NTSC rates stay exact: {}", graph(&plan));
}

#[test]
fn nested_comps_render_at_their_own_size_and_cannot_recurse_forever() {
    let assets = library(vec![asset("m", AssetKind::Video, 10.0)]);
    let child = Comp { width: 640, height: 360, ..comp("child", vec![clip("inner", "v1", 0.0, 3.0, media("m"))]) };
    let parent = comp("parent", vec![clip("nest", "v1", 0.0, 2.0, ClipSource::Comp { comp_id: "child".into() })]);
    let project = project(vec![parent, child]);
    let text = graph(&build(&project, &assets, &options("parent"), Output::Video, 0.0).expect("plan"));
    assert!(text.contains("s=640x360"), "the child keeps its own frame: {text}");
    assert!(text.contains("color=c=black@0:s=640x360"), "and a transparent canvas");
}

#[test]
fn keyframes_hold_ease_and_read_the_same_as_their_expression() {
    let keys = vec![
        Keyframe { time: 0.0, value: 0.0, easing: Easing::Linear },
        Keyframe { time: 1.0, value: 100.0, easing: Easing::Hold },
        Keyframe { time: 2.0, value: 50.0, easing: Easing::Ease },
        Keyframe { time: 3.0, value: 0.0, easing: Easing::Linear },
    ];
    assert_eq!(keyframe_value(&keys, -1.0), Some(0.0), "values hold before the first key");
    assert_eq!(keyframe_value(&keys, 0.5), Some(50.0));
    assert_eq!(keyframe_value(&keys, 1.5), Some(100.0), "a hold keeps its value until the next key");
    assert_eq!(keyframe_value(&keys, 2.5), Some(25.0), "smoothstep is symmetric at the midpoint");
    assert_eq!(keyframe_value(&keys, 9.0), Some(0.0), "and hold after the last");
    let expr = keyframe_expr(&keys, "t").expect("an expression");
    assert!(expr.starts_with('0') && expr.contains("gte(t,2)") && expr.contains("clip((t-2)/1,0,1)"), "{expr}");
    assert!(keyframe_expr(&[], "t").is_none());
}

#[test]
fn frame_rates_become_exact_rationals() {
    assert_eq!(Rate::from_fps(30.0).text(), "30");
    assert_eq!(Rate::from_fps(29.97).text(), "30000/1001");
    assert_eq!(Rate::from_fps(23.976).text(), "24000/1001");
    assert_eq!(Rate::from_fps(29.97).tb(), "1001/30000");
    assert!((Rate::from_fps(12.5).fps() - 12.5).abs() < 1e-9);
}

#[test]
fn a_long_edit_puts_its_graph_in_a_file_and_keeps_one_overlay_per_track() {
    let assets = library(vec![asset("m", AssetKind::Video, 600.0)]);
    let clips: Vec<Clip> = (0..120)
        .map(|index| {
            let mut piece = clip(&format!("c{index}"), "v1", f64::from(index) * 0.5, 0.5, media("m"));
            piece.in_point = f64::from(index) * 4.0;
            piece
        })
        .collect();
    let project = project(vec![comp("c", clips)]);
    let plan = build(&project, &assets, &options("c"), Output::Video, 0.0).expect("plan");
    assert!(plan.args.contains(&"-/filter_complex".to_owned()), "{:?}", plan.args);
    let text = graph(&plan);
    assert_eq!(text.matches("overlay=").count(), 1, "one overlay for the whole track");
    assert_eq!(text.matches("concat=n=120").count(), 1);
    assert_eq!(plan.args.iter().filter(|arg| *arg == "-ss").count(), 120);
}

#[test]
fn every_export_is_stamped_with_helios_provenance_and_marker_chapters() {
    let assets = library(vec![asset("m", AssetKind::Video, 10.0)]);
    let mut named = comp("c", vec![clip("a", "v1", 0.0, 2.0, media("m"))]);
    named.name = "Goa reel".to_owned();
    named.markers = vec![
        Marker { id: "m1".to_owned(), time: 0.5, name: "Hook".to_owned(), color: "#fff".to_owned() },
        Marker { id: "m2".to_owned(), time: 1.5, name: "".to_owned(), color: "#fff".to_owned() },
    ];
    let project = project(vec![named]);
    let plan = build(&project, &assets, &options("c"), Output::Video, 0.0).expect("plan");
    let title = plan.args.iter().position(|arg| arg == "title=Goa reel").expect("title metadata");
    assert_eq!(plan.args[title - 1], "-metadata");
    let comment = plan.args.iter().find(|arg| arg.starts_with("comment=")).expect("comment metadata");
    assert!(comment.contains("Made with Helios"), "{comment}");
    assert!(comment.contains("Hook@0.5s"), "named chapter: {comment}");
    assert!(comment.contains("Marker@1.5s"), "unnamed chapters still listed: {comment}");
    assert!(plan.args.iter().any(|arg| arg.starts_with("encoder=Helios")), "{:?}", plan.args);
}
