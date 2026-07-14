use std::path::Path;

use serde::Serialize;
use tree_sitter::Node;

#[derive(Debug, Clone, Serialize)]
pub struct MediaCommand {
    pub tool: String,
    pub line: usize,
    pub text: String,
}

pub fn walk_file(path: &Path) -> Result<Vec<MediaCommand>, String> {
    let src = std::fs::read_to_string(path).map_err(|e| format!("read {}: {e}", path.display()))?;
    walk_source(&src)
}

pub fn walk_source(src: &str) -> Result<Vec<MediaCommand>, String> {
    let mut parser = tree_sitter::Parser::new();
    parser
        .set_language(&tree_sitter_bash::LANGUAGE.into())
        .map_err(|e| format!("bash grammar: {e}"))?;

    let tree = parser
        .parse(src, None)
        .ok_or_else(|| "tree-sitter parse failed".to_string())?;

    let mut out = Vec::new();
    collect_commands(src, tree.root_node(), &mut out);
    Ok(out)
}

fn collect_commands(src: &str, node: Node, out: &mut Vec<MediaCommand>) {
    if node.kind() == "command" {
        if let Some(cmd) = command_from_node(src, node) {
            out.push(cmd);
        }
    }
    for i in 0..node.child_count() {
        if let Some(child) = node.child(i) {
            collect_commands(src, child, out);
        }
    }
}

fn command_from_node(src: &str, node: Node) -> Option<MediaCommand> {
    let name = node
        .child_by_field_name("name")
        .or_else(|| node.named_child(0))?;
    let tool = name.utf8_text(src.as_bytes()).ok()?.trim().to_string();
    if tool != "ffmpeg" && tool != "ffplay" && tool != "ffprobe" && tool != "yt-dlp" {
        return None;
    }
    let text = node.utf8_text(src.as_bytes()).ok()?.trim().to_string();
    let line = node.start_position().row + 1;
    Some(MediaCommand { tool, line, text })
}