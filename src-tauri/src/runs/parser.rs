use super::event::GrokEvent;

pub fn parse_line(line: &str) -> Result<GrokEvent, serde_json::Error> {
    serde_json::from_str::<GrokEvent>(line)
}
