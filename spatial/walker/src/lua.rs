use std::path::Path;

use streaming_iterator::StreamingIterator;
use tree_sitter::{Node, Query, QueryCursor};

/// Find preset keys in `presets.foo = { ... }` or `presets["foo"]` assignments.
pub fn walk_presets(path: &Path) -> Result<Vec<String>, String> {
    let src = std::fs::read_to_string(path).map_err(|e| format!("read {}: {e}", path.display()))?;
    walk_presets_source(&src)
}

pub fn walk_presets_source(src: &str) -> Result<Vec<String>, String> {
    let mut parser = tree_sitter::Parser::new();
    parser
        .set_language(&tree_sitter_lua::LANGUAGE.into())
        .map_err(|e| format!("lua grammar: {e}"))?;

    let tree = parser
        .parse(src, None)
        .ok_or_else(|| "tree-sitter parse failed".to_string())?;

    let query_src = r#"
        (assignment_statement
          (variable_list
            (dot_index_expression
              table: (identifier) @tbl
              field: (identifier) @key))
          (expression_list) @rhs) @assign
    "#;

    let query = Query::new(&tree_sitter_lua::LANGUAGE.into(), query_src)
        .map_err(|e| format!("lua query: {e}"))?;

    let mut cursor = QueryCursor::new();
    let mut matches = cursor.matches(&query, tree.root_node(), src.as_bytes());
    let mut keys = Vec::new();

    while let Some(m) = matches.next() {
        let mut tbl = "";
        let mut key = "";
        for cap in m.captures {
            let name = query.capture_names()[cap.index as usize];
            let text = cap.node.utf8_text(src.as_bytes()).unwrap_or("").trim();
            match name {
                "tbl" => tbl = text,
                "key" => key = text,
                _ => {}
            }
        }
        if tbl == "presets" && !key.is_empty() {
            keys.push(key.to_string());
        }
    }

    if keys.is_empty() {
        keys.extend(heuristic_preset_keys(src));
    }

    keys.sort();
    keys.dedup();
    Ok(keys)
}

fn heuristic_preset_keys(src: &str) -> Vec<String> {
    let mut keys = Vec::new();
    for line in src.lines() {
        let t = line.trim();
        if let Some(rest) = t.strip_prefix("presets.") {
            if let Some(name) = rest.split('=').next() {
                let name = name.trim();
                if !name.is_empty() {
                    keys.push(name.to_string());
                }
            }
        }
    }
    keys
}

#[allow(dead_code)]
fn walk_table_keys(src: &str, node: Node) -> Vec<String> {
    let mut keys = Vec::new();
    if node.kind() == "field" {
        if let Some(key_node) = node.child(0) {
            if let Ok(k) = key_node.utf8_text(src.as_bytes()) {
                keys.push(k.trim_matches('"').trim().to_string());
            }
        }
    }
    for i in 0..node.child_count() {
        if let Some(child) = node.child(i) {
            keys.extend(walk_table_keys(src, child));
        }
    }
    keys
}