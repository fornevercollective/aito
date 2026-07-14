mod bash;
mod lua;

use std::path::PathBuf;

use clap::{Parser, Subcommand};
use serde::Serialize;

#[derive(Parser)]
#[command(name = "aito-walk", about = "tree-sitter walker for booth scripts")]
struct Cli {
    #[command(subcommand)]
    command: Commands,
}

#[derive(Subcommand)]
enum Commands {
    /// Walk a shell script (ffmpeg/ffplay/yt-dlp) — repel-compatible
    Bash { path: PathBuf },
    /// Walk a lua preset script for booth table keys
    Lua { path: PathBuf },
    /// Scan scripts/ directory (bash + lua)
    Scan { dir: PathBuf },
}

#[derive(Serialize)]
struct ScanReport {
    bash: Vec<bash::MediaCommand>,
    lua_presets: Vec<String>,
}

fn main() {
    let cli = Cli::parse();
    match cli.command {
        Commands::Bash { path } => match bash::walk_file(&path) {
            Ok(cmds) => {
                for c in cmds {
                    println!("L{} {}  {}", c.line, c.tool, c.text);
                }
            }
            Err(e) => {
                eprintln!("{e}");
                std::process::exit(1);
            }
        },
        Commands::Lua { path } => match lua::walk_presets(&path) {
            Ok(keys) => {
                for k in keys {
                    println!("preset: {k}");
                }
            }
            Err(e) => {
                eprintln!("{e}");
                std::process::exit(1);
            }
        },
        Commands::Scan { dir } => {
            let mut bash_cmds = Vec::new();
            let mut lua_presets = Vec::new();
            if let Ok(entries) = std::fs::read_dir(&dir) {
                for ent in entries.flatten() {
                    let p = ent.path();
                    if p.extension().and_then(|e| e.to_str()) == Some("sh") {
                        if let Ok(cmds) = bash::walk_file(&p) {
                            bash_cmds.extend(cmds);
                        }
                    }
                    if p.extension().and_then(|e| e.to_str()) == Some("lua") {
                        if let Ok(keys) = lua::walk_presets(&p) {
                            lua_presets.extend(keys);
                        }
                    }
                }
            }
            let report = ScanReport {
                bash: bash_cmds,
                lua_presets,
            };
            println!("{}", serde_json::to_string_pretty(&report).unwrap_or_default());
        }
    }
}