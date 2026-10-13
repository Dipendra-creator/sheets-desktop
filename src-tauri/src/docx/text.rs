//! Plain text and Markdown ⇄ editor documents.

use serde_json::{json, Value};

/// Inline content for a line of plain text (tabs become tab nodes).
fn text_inline(line: &str) -> Vec<Value> {
    let mut out = Vec::new();
    for (i, part) in line.split('\t').enumerate() {
        if i > 0 {
            out.push(json!({ "type": "tab" }));
        }
        if !part.is_empty() {
            out.push(json!({ "type": "text", "text": part }));
        }
    }
    out
}

fn paragraph(content: Vec<Value>, attrs: Option<Value>) -> Value {
    let mut p = json!({ "type": "paragraph" });
    if let Some(a) = attrs {
        p["attrs"] = a;
    }
    if !content.is_empty() {
        p["content"] = Value::Array(content);
    }
    p
}

fn doc(content: Vec<Value>, num_added: Vec<Value>) -> Value {
    let content = if content.is_empty() { vec![paragraph(vec![], None)] } else { content };
    let mut d = json!({ "type": "doc", "content": content });
    if !num_added.is_empty() {
        d["attrs"] = json!({ "numAdded": num_added });
    }
    d
}

/// A plain text file: one paragraph per line.
pub fn from_plain_text(text: &str) -> Value {
    let text = text.strip_prefix('\u{FEFF}').unwrap_or(text);
    let mut blocks = Vec::new();
    for line in text.split('\n') {
        let line = line.strip_suffix('\r').unwrap_or(line);
        if line.contains('\u{000C}') {
            // Form feed: a page break
            for (i, part) in line.split('\u{000C}').enumerate() {
                let mut c = text_inline(part);
                if i > 0 {
                    c.insert(0, json!({ "type": "hard_break", "attrs": { "type": "page" } }));
                }
                blocks.push(paragraph(c, None));
            }
            continue;
        }
        blocks.push(paragraph(text_inline(line), None));
    }
    // A trailing newline doesn't make an extra empty paragraph
    if blocks.len() > 1 && text.ends_with('\n') {
        blocks.pop();
    }
    doc(blocks, vec![])
}

/// Bullet (9001) and numbered (9002) lists for documents made by Docs.
pub fn list_defs() -> Vec<Value> {
    let bullet_chars = ["\u{2022}", "\u{25E6}", "\u{25AA}"];
    let fmts = ["decimal", "lowerLetter", "lowerRoman"];
    let bullet_levels: Vec<Value> = (0..9)
        .map(|l| {
            json!({ "ilvl": l, "start": 1, "numFmt": "bullet", "lvlText": bullet_chars[l % 3], "lvlJc": "left",
                    "pPr": { "ind": { "left": format!("{}", 720 * (l + 1)), "hanging": "360" } } })
        })
        .collect();
    let number_levels: Vec<Value> = (0..9)
        .map(|l| {
            json!({ "ilvl": l, "start": 1, "numFmt": fmts[l % 3], "lvlText": format!("%{}.", l + 1), "lvlJc": "left",
                    "pPr": { "ind": { "left": format!("{}", 720 * (l + 1)), "hanging": "360" } } })
        })
        .collect();
    vec![
        json!({ "kind": "abstract", "id": "9001", "nsid": "5A1B2C01", "multi": "hybridMultilevel", "levels": bullet_levels }),
        json!({ "kind": "abstract", "id": "9002", "nsid": "5A1B2C02", "multi": "hybridMultilevel", "levels": number_levels }),
        json!({ "kind": "num", "id": "9001", "abstract": "9001" }),
        json!({ "kind": "num", "id": "9002", "abstract": "9002" }),
    ]
}

fn md_marks(text: &str) -> Vec<Value> {
    // **bold**, *italic*, `code`, [text](url)
    let mut out = Vec::new();
    let chars: Vec<char> = text.chars().collect();
    let mut i = 0;
    let mut buf = String::new();
    let mut bold = false;
    let mut italic = false;
    let push = |out: &mut Vec<Value>, buf: &mut String, bold: bool, italic: bool, extra: Option<Value>| {
        if buf.is_empty() {
            return;
        }
        let mut marks = Vec::new();
        if bold {
            marks.push(json!({ "type": "bold", "attrs": { "on": true } }));
        }
        if italic {
            marks.push(json!({ "type": "italic", "attrs": { "on": true } }));
        }
        if let Some(e) = extra {
            marks.push(e);
        }
        let mut node = json!({ "type": "text", "text": buf.clone() });
        if !marks.is_empty() {
            node["marks"] = Value::Array(marks);
        }
        out.push(node);
        buf.clear();
    };
    while i < chars.len() {
        let c = chars[i];
        if c == '\\' && i + 1 < chars.len() {
            buf.push(chars[i + 1]);
            i += 2;
            continue;
        }
        if c == '*' || c == '_' {
            let double = i + 1 < chars.len() && chars[i + 1] == c;
            push(&mut out, &mut buf, bold, italic, None);
            if double {
                bold = !bold;
                i += 2;
            } else {
                italic = !italic;
                i += 1;
            }
            continue;
        }
        if c == '`' {
            if let Some(end) = chars[i + 1..].iter().position(|x| *x == '`') {
                push(&mut out, &mut buf, bold, italic, None);
                buf = chars[i + 1..i + 1 + end].iter().collect();
                push(
                    &mut out,
                    &mut buf,
                    bold,
                    italic,
                    Some(json!({ "type": "font", "attrs": { "ascii": "Consolas", "hAnsi": "Consolas", "cs": "Consolas" } })),
                );
                i += end + 2;
                continue;
            }
        }
        if c == '[' {
            let rest: String = chars[i..].iter().collect();
            if let (Some(close), Some(_)) = (rest.find("]("), rest.find(')')) {
                let label = &rest[1..close];
                if let Some(url_end) = rest[close + 2..].find(')') {
                    let url = &rest[close + 2..close + 2 + url_end];
                    push(&mut out, &mut buf, bold, italic, None);
                    buf = label.to_string();
                    push(
                        &mut out,
                        &mut buf,
                        bold,
                        italic,
                        Some(json!({ "type": "link", "attrs": { "href": url } })),
                    );
                    i += rest[..close + 2 + url_end + 1].chars().count();
                    continue;
                }
            }
        }
        buf.push(c);
        i += 1;
    }
    push(&mut out, &mut buf, bold, italic, None);
    out
}

/// A Markdown file: headings, lists, emphasis, code and links.
pub fn from_markdown(text: &str) -> Value {
    let text = text.strip_prefix('\u{FEFF}').unwrap_or(text);
    let mut blocks = Vec::new();
    let mut used_lists = false;
    let mut in_code = false;
    let mut para: Vec<String> = Vec::new();
    let flush = |para: &mut Vec<String>, blocks: &mut Vec<Value>| {
        if !para.is_empty() {
            let joined = para.join(" ");
            blocks.push(paragraph(md_marks(joined.trim()), None));
            para.clear();
        }
    };
    for raw in text.lines() {
        let line = raw.trim_end();
        if line.trim_start().starts_with("```") {
            flush(&mut para, &mut blocks);
            in_code = !in_code;
            continue;
        }
        if in_code {
            let font = json!({ "type": "font", "attrs": { "ascii": "Consolas", "hAnsi": "Consolas", "cs": "Consolas" } });
            let content = if line.is_empty() { vec![] } else { vec![json!({ "type": "text", "text": line, "marks": [font] })] };
            blocks.push(paragraph(content, Some(json!({ "style": "NoSpacing" }))));
            continue;
        }
        if line.trim().is_empty() {
            flush(&mut para, &mut blocks);
            continue;
        }
        let trimmed = line.trim_start();
        let indent = (line.len() - trimmed.len()) / 2;
        if let Some(level) = (1..=6).find(|n| trimmed.starts_with(&format!("{} ", "#".repeat(*n)))) {
            flush(&mut para, &mut blocks);
            blocks.push(paragraph(md_marks(trimmed[level + 1..].trim()), Some(json!({ "style": format!("Heading{level}") }))));
            continue;
        }
        if trimmed == "---" || trimmed == "***" {
            flush(&mut para, &mut blocks);
            blocks.push(paragraph(vec![], Some(json!({ "pBdr": { "bottom": { "val": "single", "sz": "6", "space": "1", "color": "auto" } } }))));
            continue;
        }
        let bullet = ["- ", "* ", "+ "].iter().find(|b| trimmed.starts_with(*b)).map(|b| b.len());
        let ordered = trimmed.find(". ").filter(|i| *i > 0 && *i < 6 && trimmed[..*i].chars().all(|c| c.is_ascii_digit()));
        if bullet.is_some() || ordered.is_some() {
            flush(&mut para, &mut blocks);
            used_lists = true;
            let (num, rest) = match (bullet, ordered) {
                (Some(n), _) => (9001, &trimmed[n..]),
                (None, Some(i)) => (9002, &trimmed[i + 2..]),
                _ => unreachable!(),
            };
            blocks.push(paragraph(
                md_marks(rest.trim()),
                Some(json!({ "style": "ListParagraph", "numPr": { "numId": num, "ilvl": indent.min(8) } })),
            ));
            continue;
        }
        if let Some(q) = trimmed.strip_prefix("> ") {
            flush(&mut para, &mut blocks);
            blocks.push(paragraph(md_marks(q.trim()), Some(json!({ "style": "Quote" }))));
            continue;
        }
        para.push(trimmed.to_string());
    }
    flush(&mut para, &mut blocks);
    doc(blocks, if used_lists { list_defs() } else { vec![] })
}

fn inline_text(nodes: &[Value], out: &mut String) {
    for n in nodes {
        match n["type"].as_str().unwrap_or("") {
            "text" => {
                let deleted = n.get("marks").and_then(|m| m.as_array()).map(|m| m.iter().any(|x| x["type"] == "del")).unwrap_or(false);
                if !deleted {
                    out.push_str(n["text"].as_str().unwrap_or(""));
                }
            }
            "tab" => out.push('\t'),
            "hard_break" => match n["attrs"]["type"].as_str() {
                Some("page") => out.push('\u{000C}'),
                _ => out.push_str("\r\n"),
            },
            "opaque_inline" => {
                if !n["attrs"]["hidden"].as_bool().unwrap_or(false) {
                    out.push_str(n["attrs"]["text"].as_str().unwrap_or(""));
                }
            }
            _ => {}
        }
    }
}

/// List labels as Word writes them in plain text ("1.", "a)", "•").
struct Labels<'a> {
    cx: MdContext<'a>,
    counters: std::collections::HashMap<i64, [i64; 9]>,
}

impl Labels<'_> {
    /// Moves the list counters on to a paragraph: (level, bullet, the
    /// counters at it, the level definitions) when it is in a list.
    fn next(&mut self, attrs: &Value) -> Option<(usize, bool, [i64; 9], Vec<Value>)> {
        let (num_id, level, bullet) = self.cx.list(attrs)?;
        let defs: Vec<Value> = (0..9).map(|l| self.cx.level(num_id, l).unwrap_or(Value::Null)).collect();
        let start = |l: usize| defs[l]["start"].as_i64().or_else(|| defs[l]["start"].as_str().and_then(|s| s.parse().ok())).unwrap_or(1);
        let c = self.counters.entry(num_id).or_insert([0; 9]);
        // A level starts again below a higher one
        for (l, v) in c.iter_mut().enumerate() {
            if l > level {
                *v = 0;
            }
        }
        c[level] = if c[level] == 0 { start(level) } else { c[level] + 1 };
        for (l, v) in c.iter_mut().enumerate().take(level) {
            if *v == 0 {
                *v = start(l);
            }
        }
        Some((level, bullet, *c, defs))
    }

    fn label(&mut self, attrs: &Value) -> Option<String> {
        let (level, bullet, counters, defs) = self.next(attrs)?;
        if bullet {
            return Some("\u{2022}".into());
        }
        let mut out = defs[level]["lvlText"].as_str().map(String::from).unwrap_or_else(|| format!("%{}.", level + 1));
        for (l, n) in counters.iter().enumerate() {
            let key = format!("%{}", l + 1);
            if out.contains(&key) {
                out = out.replace(&key, &format_number((*n).max(1), defs[l]["numFmt"].as_str().unwrap_or("decimal")));
            }
        }
        Some(out)
    }
}

/// A list number in a Word number format.
fn format_number(n: i64, fmt: &str) -> String {
    let letters = |n: i64, upper: bool| {
        let n = n.max(1) - 1;
        let c = (b'a' + (n % 26) as u8) as char;
        let s = c.to_string().repeat((n / 26 + 1) as usize);
        if upper {
            s.to_uppercase()
        } else {
            s
        }
    };
    let roman = |mut n: i64, upper: bool| {
        let table = [(1000, "m"), (900, "cm"), (500, "d"), (400, "cd"), (100, "c"), (90, "xc"), (50, "l"), (40, "xl"), (10, "x"), (9, "ix"), (5, "v"), (4, "iv"), (1, "i")];
        let mut s = String::new();
        for (v, r) in table {
            while n >= v {
                s.push_str(r);
                n -= v;
            }
        }
        if upper {
            s.to_uppercase()
        } else {
            s
        }
    };
    match fmt {
        "lowerLetter" => letters(n, false),
        "upperLetter" => letters(n, true),
        "lowerRoman" => roman(n, false),
        "upperRoman" => roman(n, true),
        "decimalZero" if n < 10 => format!("0{n}"),
        _ => n.to_string(),
    }
}

fn blocks_text(blocks: &[Value], labels: &mut Labels, out: &mut Vec<String>) {
    for b in blocks {
        match b["type"].as_str().unwrap_or("") {
            "paragraph" => {
                let mut line = String::new();
                if let Some(label) = labels.label(b.get("attrs").unwrap_or(&Value::Null)) {
                    line.push_str(&label);
                    line.push('\t');
                }
                inline_text(b.get("content").and_then(|c| c.as_array()).map(|v| v.as_slice()).unwrap_or(&[]), &mut line);
                out.push(line);
            }
            "table" => {
                for row in b.get("content").and_then(|c| c.as_array()).into_iter().flatten() {
                    let mut cells = Vec::new();
                    for cell in row.get("content").and_then(|c| c.as_array()).into_iter().flatten() {
                        let mut lines = Vec::new();
                        blocks_text(cell.get("content").and_then(|c| c.as_array()).map(|v| v.as_slice()).unwrap_or(&[]), labels, &mut lines);
                        cells.push(lines.join(" "));
                    }
                    out.push(cells.join("\t"));
                }
            }
            "opaque_block" => out.push(b["attrs"]["text"].as_str().unwrap_or("").to_string()),
            _ => {}
        }
    }
}

/// The document as plain text (Windows line ends), with list numbers and bullets.
pub fn to_plain_text(doc: &Value, styles: &Value, numbering: &Value) -> String {
    let list = styles["styles"].as_array().map(|v| v.as_slice()).unwrap_or(&[]);
    let mut labels = Labels { cx: MdContext { styles: list, numbering }, counters: Default::default() };
    let mut lines = Vec::new();
    blocks_text(doc.get("content").and_then(|c| c.as_array()).map(|v| v.as_slice()).unwrap_or(&[]), &mut labels, &mut lines);
    let mut s = lines.join("\r\n");
    s.push_str("\r\n");
    s
}

/// How paragraphs are numbered: `(heading level, list kind)` per paragraph
/// style, from the document's styles and numbering.
struct MdContext<'a> {
    styles: &'a [Value],
    numbering: &'a Value,
}

impl MdContext<'_> {
    fn style(&self, id: &str) -> Option<&Value> {
        self.styles.iter().find(|s| s["id"] == id)
    }

    /// Heading level of a paragraph style (Title counts as level 1).
    fn heading_level(&self, style: &str) -> Option<usize> {
        let mut id = style.to_string();
        for _ in 0..10 {
            let s = self.style(&id)?;
            let name = s["name"].as_str().unwrap_or("").to_lowercase();
            if name == "title" {
                return Some(1);
            }
            if let Some(n) = name.strip_prefix("heading ").and_then(|n| n.trim().parse::<usize>().ok()) {
                return Some(n.clamp(1, 6));
            }
            if let Some(l) = s["pPr"]["outlineLvl"].as_i64().filter(|l| *l < 9) {
                return Some((l as usize + 1).min(6));
            }
            id = s["basedOn"].as_str()?.to_string();
        }
        None
    }

    /// A list level's definition (lvlText, numFmt, start).
    fn level(&self, num_id: i64, level: usize) -> Option<Value> {
        let n = &self.numbering["nums"][num_id.to_string()];
        let abs = n["abstract"].as_str().map(String::from).or_else(|| n["abstract"].as_i64().map(|v| v.to_string()))?;
        let int = |v: &Value| v.as_i64().or_else(|| v.as_str().and_then(|s| s.parse().ok()));
        self.numbering["abstracts"][abs.as_str()]["levels"].as_array()?.iter().find(|l| int(&l["ilvl"]) == Some(level as i64)).cloned()
    }

    /// The paragraph's list: (list id, level, bullet?) when it is numbered.
    fn list(&self, attrs: &Value) -> Option<(i64, usize, bool)> {
        let mut num = attrs.get("numPr").cloned().filter(|n| n.is_object());
        if num.is_none() {
            let mut id = attrs.get("style").and_then(|s| s.as_str()).map(String::from);
            for _ in 0..10 {
                let Some(cur) = id.clone() else { break };
                let Some(s) = self.style(&cur) else { break };
                if let Some(n) = s["pPr"].get("numPr").filter(|n| n.is_object()) {
                    num = Some(n.clone());
                    break;
                }
                id = s["basedOn"].as_str().map(String::from);
            }
        }
        let num = num?;
        // Ids and levels come as numbers or as strings
        let int = |v: Option<&Value>| v.and_then(|v| v.as_i64().or_else(|| v.as_str().and_then(|s| s.trim().parse().ok())));
        let num_id = int(num.get("numId"))?;
        if num_id == 0 {
            return None;
        }
        let level = int(num.get("ilvl")).unwrap_or(0).clamp(0, 8) as usize;
        let n = &self.numbering["nums"][num_id.to_string()];
        let abs = n["abstract"].as_str().map(String::from).or_else(|| n["abstract"].as_i64().map(|v| v.to_string()));
        let fmt = abs
            .and_then(|a| {
                self.numbering["abstracts"][a.as_str()]["levels"]
                    .as_array()
                    .and_then(|ls| ls.iter().find(|l| l["ilvl"].as_i64().or_else(|| l["ilvl"].as_str().and_then(|s| s.parse().ok())) == Some(level as i64)).cloned())
            })
            .and_then(|l| l["numFmt"].as_str().map(String::from))
            .unwrap_or_else(|| "bullet".into());
        Some((num_id, level, fmt == "bullet" || fmt == "none"))
    }
}

fn md_escape(text: &str) -> String {
    let mut out = String::with_capacity(text.len());
    for c in text.chars() {
        if matches!(c, '\\' | '*' | '_' | '`' | '[' | ']') {
            out.push('\\');
        }
        out.push(c);
    }
    out
}

fn md_inline(nodes: &[Value]) -> String {
    let mut out = String::new();
    let has = |n: &Value, kind: &str| {
        n.get("marks").and_then(|m| m.as_array()).map(|m| m.iter().any(|x| x["type"] == kind && x["attrs"]["on"] != false)).unwrap_or(false)
    };
    for n in nodes {
        match n["type"].as_str().unwrap_or("") {
            "text" => {
                if has(n, "del") {
                    continue;
                }
                let raw = n["text"].as_str().unwrap_or("");
                let mut s = md_escape(raw.trim());
                if s.is_empty() {
                    out.push_str(raw);
                    continue;
                }
                if has(n, "italic") {
                    s = format!("*{s}*");
                }
                if has(n, "bold") {
                    s = format!("**{s}**");
                }
                let href = n.get("marks").and_then(|m| m.as_array()).and_then(|m| {
                    m.iter().find(|x| x["type"] == "link").and_then(|l| l["attrs"]["href"].as_str().map(String::from))
                });
                if let Some(h) = href {
                    s = format!("[{s}]({h})");
                }
                // Keep the spaces outside the markers
                let lead = &raw[..raw.len() - raw.trim_start().len()];
                let trail = &raw[raw.trim_end().len()..];
                out.push_str(lead);
                out.push_str(&s);
                out.push_str(trail);
            }
            "tab" => out.push('\t'),
            "hard_break" => out.push_str("  \n"),
            "opaque_inline" => {
                if !n["attrs"]["hidden"].as_bool().unwrap_or(false) {
                    out.push_str(&md_escape(n["attrs"]["text"].as_str().unwrap_or("")));
                }
            }
            "image" => {
                let alt = n["attrs"]["alt"].as_str().unwrap_or("");
                if !alt.is_empty() {
                    out.push_str(&format!("[{}]", md_escape(alt)));
                }
            }
            _ => {}
        }
    }
    out
}

fn md_blocks(labels: &mut Labels, blocks: &[Value], out: &mut Vec<String>) {
    for b in blocks {
        let content = b.get("content").and_then(|c| c.as_array()).map(|v| v.as_slice()).unwrap_or(&[]);
        match b["type"].as_str().unwrap_or("") {
            "paragraph" => {
                let attrs = b.get("attrs").cloned().unwrap_or(Value::Null);
                let text = md_inline(content);
                let style = attrs.get("style").and_then(|s| s.as_str()).unwrap_or("Normal");
                if let Some(level) = labels.cx.heading_level(style) {
                    if !text.trim().is_empty() {
                        out.push(format!("{} {}", "#".repeat(level), text.trim()));
                        out.push(String::new());
                    }
                    continue;
                }
                // List items keep Word's numbers (Markdown starts a list at its first number)
                if let Some((level, bullet, counters, _)) = labels.next(&attrs) {
                    let marker = if bullet { "-".to_string() } else { format!("{}.", counters[level]) };
                    out.push(format!("{}{} {}", "   ".repeat(level), marker, text.trim()));
                    continue;
                }
                if out.last().map(|l| l.starts_with('-') || l.starts_with(' ') || l.chars().next().map(|c| c.is_ascii_digit()).unwrap_or(false)).unwrap_or(false) {
                    out.push(String::new());
                }
                if style == "Quote" || style == "IntenseQuote" {
                    out.push(format!("> {}", text.trim()));
                } else {
                    out.push(text.trim_end().to_string());
                }
                out.push(String::new());
            }
            "table" => {
                let mut rows: Vec<Vec<String>> = Vec::new();
                for row in content {
                    let mut cells = Vec::new();
                    for cell in row.get("content").and_then(|c| c.as_array()).into_iter().flatten() {
                        let mut lines = Vec::new();
                        for p in cell.get("content").and_then(|c| c.as_array()).into_iter().flatten() {
                            let t = md_inline(p.get("content").and_then(|c| c.as_array()).map(|v| v.as_slice()).unwrap_or(&[]));
                            if !t.trim().is_empty() {
                                lines.push(t.trim().replace('|', "\\|"));
                            }
                        }
                        cells.push(lines.join("<br>"));
                    }
                    rows.push(cells);
                }
                let width = rows.iter().map(|r| r.len()).max().unwrap_or(0);
                if width == 0 {
                    continue;
                }
                for (i, r) in rows.iter().enumerate() {
                    let mut r = r.clone();
                    r.resize(width, String::new());
                    out.push(format!("| {} |", r.join(" | ")));
                    if i == 0 {
                        out.push(format!("|{}|", vec![" --- "; width].join("|")));
                    }
                }
                out.push(String::new());
            }
            "opaque_block" => {
                let text = b["attrs"]["text"].as_str().unwrap_or("");
                if !text.is_empty() {
                    out.push(md_escape(text));
                    out.push(String::new());
                }
            }
            _ => {}
        }
    }
}

/// The document as Markdown (headings, lists, emphasis, links, tables).
pub fn to_markdown(doc: &Value, styles: &Value, numbering: &Value) -> String {
    let list = styles["styles"].as_array().map(|v| v.as_slice()).unwrap_or(&[]);
    let mut labels = Labels { cx: MdContext { styles: list, numbering }, counters: Default::default() };
    let mut lines = Vec::new();
    md_blocks(&mut labels, doc.get("content").and_then(|c| c.as_array()).map(|v| v.as_slice()).unwrap_or(&[]), &mut lines);
    while lines.last().map(|l| l.is_empty()).unwrap_or(false) {
        lines.pop();
    }
    let mut s = lines.join("\n");
    s.push('\n');
    s
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn plain_text_lists() {
        let doc = json!({ "type": "doc", "content": [
            { "type": "paragraph", "attrs": { "numPr": { "numId": "7", "ilvl": "0" } }, "content": [{ "type": "text", "text": "One" }] },
            { "type": "paragraph", "attrs": { "numPr": { "numId": "7", "ilvl": "1" } }, "content": [{ "type": "text", "text": "Sub" }] },
            { "type": "paragraph", "attrs": { "numPr": { "numId": "7", "ilvl": "0" } }, "content": [{ "type": "text", "text": "Two" }] },
            { "type": "paragraph", "attrs": { "numPr": { "numId": "8", "ilvl": "0" } }, "content": [{ "type": "text", "text": "Dot" }] }
        ] });
        let numbering = json!({
            "abstracts": {
                "1": { "levels": [
                    { "ilvl": 0, "start": 1, "numFmt": "decimal", "lvlText": "%1." },
                    { "ilvl": 1, "start": 1, "numFmt": "lowerLetter", "lvlText": "%1.%2)" }
                ] },
                "2": { "levels": [{ "ilvl": 0, "start": 1, "numFmt": "bullet", "lvlText": "\u{2022}" }] }
            },
            "nums": { "7": { "abstract": "1" }, "8": { "abstract": "2" } }
        });
        let text = to_plain_text(&doc, &json!({ "styles": [] }), &numbering);
        assert_eq!(text, "1.\tOne\r\n1.a)\tSub\r\n2.\tTwo\r\n\u{2022}\tDot\r\n");
    }

    #[test]
    fn text_round_trip() {
        let d = from_plain_text("Hello\tworld\r\n\r\nSecond line\n");
        assert_eq!(d["content"].as_array().unwrap().len(), 3);
        assert_eq!(d["content"][0]["content"][1]["type"], "tab");
        assert_eq!(to_plain_text(&d, &json!({}), &json!({})), "Hello\tworld\r\n\r\nSecond line\r\n");
    }

    #[test]
    fn markdown_basics() {
        let d = from_markdown("# Title\n\nSome **bold** and *italic* [link](https://example.com).\n\n- one\n  - two\n1. first\n");
        let blocks = d["content"].as_array().unwrap();
        assert_eq!(blocks[0]["attrs"]["style"], "Heading1");
        let p = blocks[1]["content"].as_array().unwrap();
        assert!(p.iter().any(|n| n["text"] == "bold" && n["marks"][0]["type"] == "bold"));
        assert!(p.iter().any(|n| n["text"] == "link" && n["marks"][0]["attrs"]["href"] == "https://example.com"));
        assert_eq!(blocks[3]["attrs"]["numPr"]["ilvl"], 1);
        assert_eq!(blocks[4]["attrs"]["numPr"]["numId"], 9002);
        assert!(d["attrs"]["numAdded"].as_array().unwrap().len() == 4);
    }

    #[test]
    fn markdown_export() {
        let d = from_markdown("# Title\n\nSome **bold** text.\n\n- one\n  - two\n1. first\n2. second\n");
        let numbering = json!({
            "nums": { "9001": { "abstract": "9001" }, "9002": { "abstract": "9002" } },
            "abstracts": {
                "9001": { "levels": [{ "ilvl": 0, "numFmt": "bullet" }, { "ilvl": 1, "numFmt": "bullet" }] },
                "9002": { "levels": [{ "ilvl": 0, "numFmt": "decimal" }] }
            }
        });
        let styles = json!({ "styles": crate::docx::styles::catalog_json() });
        let md = to_markdown(&d, &styles, &numbering);
        assert_eq!(md, "# Title\n\nSome **bold** text.\n\n- one\n   - two\n1. first\n2. second\n");
    }
}
