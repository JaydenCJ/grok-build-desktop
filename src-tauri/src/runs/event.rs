use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum GrokEvent {
    Thought {
        data: String,
    },
    Text {
        data: String,
    },
    End {
        #[serde(rename = "stopReason")]
        stop_reason: String,
        #[serde(rename = "sessionId")]
        session_id: String,
        #[serde(rename = "requestId")]
        request_id: String,
    },
    #[serde(other)]
    Unknown,
}
