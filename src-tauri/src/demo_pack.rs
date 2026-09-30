//! The demo media pack: a few short clips, two stills and a music bed, made with FFmpeg on demand.
//!
//! capture_app_session films Bhippi from the user's own state, and with an empty library the bins,
//! monitors and timeline look dead. Every film agent faked footage by hand for this; the pack does
//! it once. Nothing is bundled: each piece is an FFmpeg source (gradients, noise, a cellular
//! pattern, a chord expression) graded into footage-like colour, a few hundred KB in all, written
//! under the app data folder only when asked, with the thumbnails, filmstrips and waveform peaks
//! the library makes for real media. It is never added to the user's library: the capture's
//! stand-in answers with it (src/lib/demoProject.ts builds the timeline that uses it).

use std::path::{Path, PathBuf};
use std::sync::Arc;

use serde::{Deserialize, Serialize};
use tauri::State;

use crate::library::{self, Asset};
use crate::tools::Tools;
use crate::AppState;

/// Raised whenever a recipe changes, so a pack made from the old recipes is made again.
pub const PACK_VERSION: u32 = 1;

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum Kind {
    Footage,
    Still,
    Music,
}

/// One piece of the pack: its stable id (the demo timeline refers to it), its file name, and the
/// FFmpeg inputs and filters that make it (the encoder settings are added by kind).
struct Recipe {
    id: &'static str,
    file: &'static str,
    kind: Kind,
    make: &'static [&'static str],
}

/// A chord bed at 96 bpm: A minor, F, C, G, a bar each (2.5 s), a soft pad with a bass under it,
/// a kick on the beat and a closed hat between. Eight bars, so the cuts can land on the bars.
const BED: &str = "aevalsrc=exprs='st(0,floor(mod(t,10)/2.5));\
st(1,if(eq(ld(0),0),220,if(eq(ld(0),1),174.61,if(eq(ld(0),2),261.63,196))));\
st(2,if(eq(ld(0),0),1.2,1.25));st(3,mod(t,2.5));st(4,mod(t,0.625));\
0.06*(sin(2*PI*ld(1)*t)+0.8*sin(2*PI*ld(1)*ld(2)*t)+0.7*sin(2*PI*ld(1)*1.5*t)+0.35*sin(2*PI*ld(1)*2.003*t))*(1-exp(-ld(3)*3))*(0.75+0.25*exp(-ld(3)*1.2))\
+0.16*sin(2*PI*ld(1)/4*t)*(1-exp(-ld(3)*20))\
+0.55*sin(2*PI*(48+70*exp(-ld(4)*28))*ld(4))*exp(-ld(4)*9)\
+0.03*(2*random(5)-1)*exp(-mod(t+0.3125,0.625)*45)':s=44100:d=20";

const RECIPES: &[Recipe] = &[
    // A dusk sky: indigo into amber, drifting as a slow pan would.
    Recipe {
        id: "demo-dusk",
        file: "Dusk sky.mp4",
        kind: Kind::Footage,
        make: &[
            "-f", "lavfi", "-i",
            "gradients=s=1440x810:r=30:d=6:c0=0x14183a:c1=0x3b2a5c:c2=0xd9774a:c3=0xf3c78e:nb_colors=4:x0=0:y0=0:x1=0:y1=810:speed=0.004:type=linear",
            "-vf", "crop=1280:720:x='80*t/6':y='45-45*t/6',noise=alls=7:allf=t,vignette=PI/5,format=yuv420p",
        ],
    },
    // A horizon: a pale sky over a darker sea with moving streaks of light.
    Recipe {
        id: "demo-coast",
        file: "Coastline.mp4",
        kind: Kind::Footage,
        make: &[
            "-f", "lavfi", "-i", "gradients=s=1280x400:r=30:d=6:c0=0xe3cdb0:c1=0x7fa2ad:c2=0x2a4a5c:nb_colors=3:x0=640:y0=400:x1=600:y1=0:speed=0.0004:type=linear",
            "-f", "lavfi", "-i", "gradients=s=1280x320:r=30:d=6:c0=0x8aa2a4:c1=0x1d3d4d:c2=0x081a24:nb_colors=3:x0=640:y0=0:x1=640:y1=320:speed=0.0001:type=linear",
            "-f", "lavfi", "-i", "color=c=0x808080:s=1920x320:d=6:r=30",
            "-filter_complex",
            "[2]noise=alls=70:allf=u,gblur=sigma=22:sigmaV=1.5,eq=contrast=2.5,scroll=h=0.0012,crop=1280:320,format=gbrp[streak];\
[1]format=gbrp[base];[base][streak]blend=all_mode=softlight[sea];[0]format=gbrp[sky];\
[sky][sea]vstack,gblur=sigma=1,noise=alls=6:allf=t,vignette=PI/4,format=yuv420p",
        ],
    },
    // Night lights out of focus: a cellular pattern blurred into warm bokeh that comes and goes.
    Recipe {
        id: "demo-city",
        file: "City lights.mp4",
        kind: Kind::Footage,
        make: &[
            "-f", "lavfi", "-i",
            "life=s=64x36:r=30:ratio=0.12:mold=24:life_color=white:death_color=black:mold_color=0x404040:random_seed=7,scale=1280:720:flags=bicubic,gblur=sigma=12,tmix=frames=10",
            "-t", "6",
            "-vf", "eq=brightness=0.02:contrast=1.8,curves=r='0/0.04 0.3/0.6 1/1':g='0/0.03 0.3/0.36 1/0.9':b='0/0.1 0.3/0.22 1/0.7',noise=alls=4:allf=t,vignette=PI/4,format=yuv420p",
        ],
    },
    // A studio backdrop under a key light, with room tone: footage with sound, so the timeline
    // shows a linked audio clip with its waveform.
    Recipe {
        id: "demo-studio",
        file: "Studio room.mp4",
        kind: Kind::Footage,
        make: &[
            "-f", "lavfi", "-i", "gradients=s=1280x720:r=30:d=6:c0=0xe9ddd0:c1=0x7b6a5e:c2=0x221c1c:nb_colors=3:x0=420:y0=300:x1=1280:y1=720:speed=0.003:type=radial",
            "-f", "lavfi", "-i", "anoisesrc=d=6:c=pink:r=44100:a=0.05",
            "-vf", "noise=alls=6:allf=t,vignette=PI/4,format=yuv420p",
            "-af", "lowpass=f=900,volume=0.6",
        ],
    },
    // A cool misty still.
    Recipe {
        id: "demo-mist",
        file: "Mist still.jpg",
        kind: Kind::Still,
        make: &[
            "-f", "lavfi", "-i", "gradients=s=1920x1080:c0=0xc9d3c5:c1=0x5b7c7a:c2=0x1f2a30:nb_colors=3:x0=1700:y0=120:x1=300:y1=1080:type=radial",
            "-vf", "noise=alls=5,vignette=PI/5",
        ],
    },
    // A logo-like mark on transparency: a soft ring round a glowing dot.
    Recipe {
        id: "demo-mark",
        file: "Brand mark.png",
        kind: Kind::Still,
        make: &[
            "-f", "lavfi", "-i", "color=c=black:s=512x512:d=1,format=rgba",
            "-vf", "geq=r='240-60*Y/H':g='170-70*Y/H':b='110+40*Y/H':a='255*clip(max(1-abs(hypot(X-256\\,Y-256)-168)/22\\,1-hypot(X-256\\,Y-256)/64)\\,0\\,1)'",
        ],
    },
    Recipe {
        id: "demo-bed",
        file: "Evening bed.m4a",
        kind: Kind::Music,
        make: &[
            "-f", "lavfi", "-i", BED,
            "-af", "aecho=0.8:0.6:180|310:0.25|0.18,lowpass=f=7000,afade=t=in:d=1.2,afade=t=out:st=17.5:d=2.5,pan=stereo|c0=c0|c1=c0,volume=1.8",
        ],
    },
];

/// The whole FFmpeg command for a recipe: its sources and filters, then the encoder for its kind.
/// Without libx264 the footage falls back to MPEG-4, which the library then proxies like any
/// other file the webview cannot play.
fn recipe_args(recipe: &Recipe, out: &Path, x264: bool) -> Vec<String> {
    let mut args: Vec<String> = ["-hide_banner", "-loglevel", "error", "-y"].iter().map(|arg| (*arg).to_owned()).collect();
    args.extend(recipe.make.iter().map(|arg| (*arg).to_owned()));
    let tail: &[&str] = match recipe.kind {
        Kind::Footage if x264 => &["-c:v", "libx264", "-preset", "veryfast", "-crf", "28", "-c:a", "aac", "-b:a", "96k", "-shortest", "-movflags", "+faststart"],
        Kind::Footage => &["-c:v", "mpeg4", "-q:v", "5", "-c:a", "aac", "-b:a", "96k", "-shortest", "-movflags", "+faststart"],
        Kind::Still => &["-frames:v", "1", "-q:v", "3"],
        Kind::Music => &["-c:a", "aac", "-b:a", "128k"],
    };
    args.extend(tail.iter().map(|arg| (*arg).to_owned()));
    args.push(out.display().to_string());
    args
}

/// What `pack.json` keeps: the recipes' version and the finished entries.
#[derive(Deserialize, Serialize)]
struct Pack {
    version: u32,
    assets: Vec<Asset>,
}

/// A pack made before by the same recipes, when every file and derived file is still there.
fn reusable(dir: &Path) -> Option<Vec<Asset>> {
    let text = std::fs::read_to_string(dir.join("pack.json")).ok()?;
    let pack: Pack = serde_json::from_str(&text).ok()?;
    let whole = pack.version == PACK_VERSION
        && !pack.assets.is_empty()
        && pack.assets.iter().all(|asset| library::derived_ok(&Some(asset.path.clone())) && !library::needs_derive(asset));
    whole.then_some(pack.assets)
}

/// Makes the pack in `dir` (or reuses the one already there) and answers with its entries, ready
/// for the library listing. A piece this FFmpeg cannot make (an old build without `gradients`) is
/// left out rather than failing the rest.
pub async fn make(tools: &Tools, dir: &Path, report: impl Fn(f64, &str) + Send) -> Result<Vec<Asset>, String> {
    if let Some(known) = reusable(dir) {
        return Ok(known);
    }
    let ffmpeg = tools.ffmpeg()?;
    let thumbnails = dir.join("thumbnails");
    let proxies = dir.join("proxies");
    for folder in [dir, &thumbnails, &proxies] {
        std::fs::create_dir_all(folder).map_err(|error| format!("cannot create {}: {error}", folder.display()))?;
    }
    let mut assets = Vec::new();
    let mut failures = Vec::new();
    for (index, recipe) in RECIPES.iter().enumerate() {
        report(index as f64 / RECIPES.len() as f64, recipe.file);
        let out = dir.join(recipe.file);
        let args = recipe_args(recipe, &out, tools.status.x264);
        let args: Vec<&str> = args.iter().map(String::as_str).collect();
        if let Err(error) = crate::tools::run(ffmpeg, &args, None).await {
            failures.push(format!("{}: {error}", recipe.file));
            continue;
        }
        match library::import(tools, &out).await {
            Ok(mut asset) => {
                // Stable ids: the demo timeline refers to them, and the derived files keep their names.
                asset.id = recipe.id.to_owned();
                assets.push(library::derive(tools, &asset, &thumbnails, &proxies, |_, _| {}).await);
            }
            Err(error) => failures.push(format!("{}: {error}", recipe.file)),
        }
    }
    if assets.is_empty() {
        return Err(format!("FFmpeg could not make the demo media ({})", failures.join("; ")));
    }
    if !failures.is_empty() {
        tracing::warn!(?failures, "demo pack made without some pieces");
    }
    let pack = Pack { version: PACK_VERSION, assets };
    std::fs::write(dir.join("pack.json"), serde_json::to_string_pretty(&pack).unwrap_or_default()).map_err(|error| format!("cannot write the demo pack: {error}"))?;
    Ok(pack.assets)
}

/// Where the pack lives: its own folder under the app data folder, which the capture's file
/// server already serves, and apart from the user's thumbnails and proxies.
pub fn pack_dir(root: &Path) -> PathBuf {
    root.join("demo-pack")
}

/// Makes the demo media pack (or returns the one already made). See the module notes.
#[tauri::command]
pub async fn demo_pack_make(state: State<'_, Arc<AppState>>) -> Result<Vec<Asset>, String> {
    let tools = state.tools();
    let dir = pack_dir(&state.paths.root);
    if let Some(known) = reusable(&dir) {
        return Ok(known);
    }
    let job = state.jobs.start("demo", "Making the demo media", false);
    match make(&tools, &dir, |fraction, what| job.progress(fraction, what)).await {
        Ok(assets) => {
            job.done(format!("{} demo file(s)", assets.len()), None);
            Ok(assets)
        }
        Err(error) => {
            job.fail(error.clone());
            Err(error)
        }
    }
}

#[cfg(test)]
mod tests {
    use super::{make, pack_dir, recipe_args, reusable, Kind, Recipe, RECIPES};
    use crate::library::{self, AssetKind};

    /// The library kind a recipe's file must probe as.
    fn kind_of(recipe: &Recipe) -> AssetKind {
        match recipe.kind {
            Kind::Footage => AssetKind::Video,
            Kind::Still => AssetKind::Image,
            Kind::Music => AssetKind::Audio,
        }
    }

    #[test]
    fn recipes_have_unique_ids_and_files_the_library_takes() {
        let mut ids: Vec<&str> = RECIPES.iter().map(|recipe| recipe.id).collect();
        ids.sort_unstable();
        ids.dedup();
        assert_eq!(ids.len(), RECIPES.len());
        for recipe in RECIPES {
            let ext = recipe.file.rsplit('.').next().unwrap_or_default().to_ascii_lowercase();
            assert!(library::supported_extensions().contains(&ext.as_str()), "{} is not importable", recipe.file);
            assert!(recipe.id.starts_with("demo-"), "{}", recipe.id);
        }
        for kind in [Kind::Footage, Kind::Still, Kind::Music] {
            assert!(RECIPES.iter().any(|recipe| recipe.kind == kind), "no {kind:?} in the pack");
        }
    }

    #[test]
    fn footage_falls_back_to_mpeg4_without_x264() {
        let dusk = &RECIPES[0];
        let out = std::path::Path::new("dusk.mp4");
        let with = recipe_args(dusk, out, true);
        let without = recipe_args(dusk, out, false);
        assert!(with.iter().any(|arg| arg == "libx264"));
        assert!(without.iter().any(|arg| arg == "mpeg4") && !without.iter().any(|arg| arg == "libx264"));
        assert_eq!(with.last().map(String::as_str), Some("dusk.mp4"));
        assert_eq!(pack_dir(std::path::Path::new("root")), std::path::Path::new("root").join("demo-pack"));
    }

    /// The whole pack against the real FFmpeg: every piece made, probed as its kind, derived like
    /// imported media (thumbnails, peaks), small, and reused on the second call.
    #[tokio::test]
    async fn the_pack_is_made_small_with_everything_the_library_shows() {
        let tools = crate::tools::resolve(None).await;
        if tools.ffmpeg().is_err() {
            eprintln!("FFmpeg not installed; skipping");
            return;
        }
        let dir = std::env::temp_dir().join(format!("bhippi-demo-{}", crate::store::new_id()));
        let assets = make(&tools, &dir, |_, _| {}).await.expect("pack");
        assert_eq!(assets.len(), RECIPES.len(), "{:?}", assets.iter().map(|asset| &asset.name).collect::<Vec<_>>());
        let mut bytes = 0;
        for (asset, recipe) in assets.iter().zip(RECIPES) {
            assert_eq!(asset.id, recipe.id);
            assert_eq!(asset.kind, kind_of(recipe), "{}", asset.name);
            assert!(!library::needs_derive(asset), "{} is not fully derived", asset.name);
            bytes += asset.size;
            match asset.kind {
                AssetKind::Video => {
                    assert!((5.5..6.5).contains(&asset.duration), "{} lasts {}", asset.name, asset.duration);
                    assert_eq!((asset.width, asset.height), (1280, 720));
                    assert!(library::derived_ok(&asset.filmstrip));
                }
                AssetKind::Image => assert!(library::derived_ok(&asset.thumbnail)),
                AssetKind::Audio => {
                    assert!((19.5..20.5).contains(&asset.duration));
                    let peaks = std::fs::read(asset.peaks.as_ref().expect("peaks")).expect("peaks file");
                    // Two bytes a bucket, a hundred buckets a second, and a bed that is really there.
                    assert!(peaks.len() >= 2 * 100 * 19);
                    let loudest = peaks.chunks_exact(2).map(|pair| pair[0]).max().unwrap_or(0);
                    assert!(loudest > 60, "the bed peaks at {loudest}/255");
                }
            }
        }
        // The one clip with sound carries it, and the pack stays a few hundred KB (under 2 MB).
        assert!(assets.iter().any(|asset| asset.kind == AssetKind::Video && asset.has_audio));
        assert!(bytes < 2_000_000, "the pack is {bytes} bytes");
        assert_eq!(reusable(&dir).map(|known| known.len()), Some(assets.len()));
        let again = make(&tools, &dir, |_, _| panic!("a finished pack is reused, not made again")).await.expect("again");
        assert_eq!(again, assets);
        let _ignored = std::fs::remove_dir_all(dir);
    }
}
