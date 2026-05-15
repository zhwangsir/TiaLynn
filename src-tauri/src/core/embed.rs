//! OpenAI-compatible embedding 客户端 + 简单 cosine 相似度。
//!
//! 不依赖 sqlite-vec（轻量优先）：把 embedding 存为 BLOB（f32 little-endian 序列），
//! 召回时全表读出来做内积。对几千-几万条记忆完全够用。

use crate::error::{AppError, AppResult};
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize)]
struct EmbedRequest<'a> {
    input: &'a str,
    model: &'a str,
}

#[derive(Debug, Clone, Deserialize)]
struct EmbedResponse {
    data: Vec<EmbedItem>,
}

#[derive(Debug, Clone, Deserialize)]
struct EmbedItem {
    embedding: Vec<f32>,
}

pub async fn embed(
    endpoint: &str,
    model: &str,
    api_key: Option<&str>,
    text: &str,
) -> AppResult<Vec<f32>> {
    if endpoint.trim().is_empty() {
        return Err(AppError::Other("embedding endpoint not configured".into()));
    }
    let url = format!("{}/embeddings", endpoint.trim_end_matches('/'));
    let client = reqwest::Client::builder()
        .connect_timeout(std::time::Duration::from_secs(3))
        .timeout(std::time::Duration::from_secs(30))
        .build()?;
    let mut req = client.post(&url).json(&EmbedRequest { input: text, model });
    if let Some(k) = api_key {
        if !k.is_empty() {
            req = req.bearer_auth(k);
        }
    }
    let resp = req.send().await?.error_for_status()?;
    let parsed: EmbedResponse = resp.json().await?;
    parsed
        .data
        .into_iter()
        .next()
        .map(|i| i.embedding)
        .ok_or_else(|| AppError::Other("empty embeddings response".into()))
}

pub fn cosine(a: &[f32], b: &[f32]) -> f32 {
    if a.len() != b.len() || a.is_empty() {
        return 0.0;
    }
    let mut dot = 0.0f32;
    let mut na = 0.0f32;
    let mut nb = 0.0f32;
    for i in 0..a.len() {
        dot += a[i] * b[i];
        na += a[i] * a[i];
        nb += b[i] * b[i];
    }
    let denom = (na.sqrt() * nb.sqrt()).max(1e-9);
    dot / denom
}

pub fn vec_to_blob(v: &[f32]) -> Vec<u8> {
    let mut out = Vec::with_capacity(v.len() * 4);
    for &x in v {
        out.extend_from_slice(&x.to_le_bytes());
    }
    out
}

pub fn blob_to_vec(b: &[u8]) -> Vec<f32> {
    if b.len() % 4 != 0 {
        return Vec::new();
    }
    let mut out = Vec::with_capacity(b.len() / 4);
    let mut i = 0;
    while i + 4 <= b.len() {
        let arr = [b[i], b[i + 1], b[i + 2], b[i + 3]];
        out.push(f32::from_le_bytes(arr));
        i += 4;
    }
    out
}
