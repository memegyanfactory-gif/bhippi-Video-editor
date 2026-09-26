//! Reads a job from stdin and speaks it, the same way the app's worker does:
//! `cargo run -p bhippi-kokoro --example speak < job.json`
fn main() {
    let mut input = String::new();
    if std::io::Read::read_to_string(&mut std::io::stdin(), &mut input).is_err() {
        std::process::exit(2);
    }
    let job: bhippi_kokoro::Job = match serde_json::from_str(&input) {
        Ok(job) => job,
        Err(error) => {
            eprintln!("unreadable job: {error}");
            std::process::exit(2);
        }
    };
    if let Err(error) = bhippi_kokoro::speak(&job) {
        eprintln!("{error}");
        std::process::exit(1);
    }
}
