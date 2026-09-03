// PipeWire sink-monitor capture for Linux system audio (Chrome, Google Meet, etc.)
//
// ALSA playback devices (HDMI/dmix) cannot record what apps are playing.
// PipeWire exposes a monitor on each sink; pw-cat records that monitor.

use std::collections::HashMap;
use std::path::PathBuf;
use std::process::Stdio;
use std::sync::Arc;

use anyhow::{anyhow, Context, Result};
use log::{info, warn};
use serde_json::Value;
use tokio::io::AsyncReadExt;
use tokio::process::Command as TokioCommand;
use tokio::sync::mpsc;

use super::devices::{AudioDevice, DeviceType as AudioDeviceType};
use super::pipeline::AudioCapture;
use super::recording_state::{DeviceType, RecordingState};

const SAMPLE_RATE: u32 = 48000;
const CHANNELS: u16 = 2;
const MONITOR_PREFIX: &str = "Monitor of ";

#[derive(Clone, Debug)]
pub struct PipeWireSink {
    pub name: String,
    pub description: String,
    pub display_name: String,
    pub is_default: bool,
}

/// List PipeWire playback sinks as system-audio devices (their monitors).
pub fn list_monitor_devices() -> Vec<AudioDevice> {
    match list_sinks() {
        Ok(sinks) => {
            if sinks.is_empty() {
                warn!("No PipeWire sinks found for system audio capture");
            } else {
                info!("Found {} PipeWire sink monitor(s) for system audio", sinks.len());
            }
            sinks
                .into_iter()
                .map(|sink| AudioDevice::new(sink.display_name, AudioDeviceType::Output))
                .collect()
        }
        Err(e) => {
            warn!("Failed to list PipeWire sinks: {}", e);
            Vec::new()
        }
    }
}

/// Default system audio = monitor of the current PipeWire default sink.
pub fn default_monitor_device() -> Result<AudioDevice> {
    let sinks = list_sinks()?;
    let sink = sinks
        .iter()
        .find(|sink| sink.is_default)
        .or_else(|| sinks.first())
        .ok_or_else(|| anyhow!("No PipeWire sink available for system audio"))?;

    info!(
        "Default PipeWire system audio: '{}' (node {})",
        sink.display_name, sink.name
    );
    Ok(AudioDevice::new(sink.display_name.clone(), AudioDeviceType::Output))
}

/// Spawn pw-cat against the sink monitor and feed samples into the recording pipeline.
pub fn spawn_monitor_capture(
    device: Arc<AudioDevice>,
    state: Arc<RecordingState>,
    recording_sender: Option<mpsc::UnboundedSender<super::recording_state::AudioChunk>>,
) -> Result<tokio::task::JoinHandle<()>> {
    let sink = resolve_sink(&device.name)?;
    let pw_cat = find_pw_cat()?;

    info!(
        "Starting PipeWire monitor capture: '{}' -> node '{}' via {}",
        device.name,
        sink.name,
        pw_cat.display()
    );

    let capture = AudioCapture::new(
        device.clone(),
        state,
        SAMPLE_RATE,
        CHANNELS,
        DeviceType::System,
        recording_sender,
    );

    let node_name = sink.name.clone();
    let device_name = device.name.clone();

    Ok(tokio::spawn(async move {
        if let Err(e) = run_pw_cat_capture(pw_cat, node_name, capture).await {
            warn!("PipeWire monitor capture ended for '{}': {}", device_name, e);
        } else {
            info!("PipeWire monitor capture stopped for '{}'", device_name);
        }
    }))
}

fn list_sinks() -> Result<Vec<PipeWireSink>> {
    let pw_dump = which::which("pw-dump").context("pw-dump not found (install pipewire)")?;
    let output = std::process::Command::new(pw_dump)
        .output()
        .context("failed to run pw-dump")?;

    if !output.status.success() {
        return Err(anyhow!(
            "pw-dump failed: {}",
            String::from_utf8_lossy(&output.stderr)
        ));
    }

    let objects: Vec<Value> =
        serde_json::from_slice(&output.stdout).context("failed to parse pw-dump JSON")?;

    let default_sink_name = find_default_sink_name(&objects);
    let mut sinks = Vec::new();

    for object in &objects {
        let Some(props) = object
            .get("info")
            .and_then(|info| info.get("props"))
        else {
            continue;
        };
        if props.get("media.class").and_then(Value::as_str) != Some("Audio/Sink") {
            continue;
        }

        let name = props
            .get("node.name")
            .and_then(Value::as_str)
            .unwrap_or("")
            .to_string();
        if name.is_empty() {
            continue;
        }

        let description = props
            .get("node.description")
            .and_then(Value::as_str)
            .filter(|value| !value.is_empty())
            .unwrap_or(name.as_str())
            .to_string();

        let is_default = default_sink_name
            .as_ref()
            .map(|default_name| default_name == &name)
            .unwrap_or(false);

        sinks.push(PipeWireSink {
            name,
            description,
            display_name: String::new(),
            is_default,
        });
    }

    assign_display_names(&mut sinks);

    if !sinks.iter().any(|sink| sink.is_default) {
        if let Some(first) = sinks.first_mut() {
            first.is_default = true;
        }
    }

    Ok(sinks)
}

fn find_default_sink_name(objects: &[Value]) -> Option<String> {
    for object in objects {
        let Some(metadata) = object
            .get("info")
            .and_then(|info| info.get("metadata"))
            .and_then(Value::as_array)
        else {
            continue;
        };
        for item in metadata {
            if item.get("key").and_then(Value::as_str) != Some("default.audio.sink") {
                continue;
            }
            if let Some(name) = item.get("value").and_then(parse_default_sink_name) {
                return Some(name);
            }
        }
    }
    None
}

fn parse_default_sink_name(value: &Value) -> Option<String> {
    match value {
        Value::String(raw) => {
            if let Ok(parsed) = serde_json::from_str::<Value>(raw) {
                parse_default_sink_name(&parsed)
            } else if !raw.is_empty() {
                Some(raw.clone())
            } else {
                None
            }
        }
        Value::Object(map) => map
            .get("name")
            .and_then(Value::as_str)
            .map(|name| name.to_string()),
        _ => None,
    }
}

fn assign_display_names(sinks: &mut [PipeWireSink]) {
    let mut description_counts: HashMap<String, usize> = HashMap::new();
    for sink in sinks.iter() {
        *description_counts
            .entry(sink.description.clone())
            .or_insert(0) += 1;
    }

    for sink in sinks.iter_mut() {
        sink.display_name = if description_counts
            .get(&sink.description)
            .copied()
            .unwrap_or(1)
            > 1
        {
            format!("{}{} ({})", MONITOR_PREFIX, sink.description, sink.name)
        } else {
            format!("{}{}", MONITOR_PREFIX, sink.description)
        };
    }
}

fn resolve_sink(device_name: &str) -> Result<PipeWireSink> {
    let sinks = list_sinks()?;
    if let Some(sink) = sinks.iter().find(|sink| sink.display_name == device_name) {
        return Ok(sink.clone());
    }

    let stripped = device_name
        .strip_prefix(MONITOR_PREFIX)
        .unwrap_or(device_name)
        .trim();
    let stripped = stripped.strip_suffix(".monitor").unwrap_or(stripped);

    if let Some(sink) = sinks.iter().find(|sink| {
        sink.description == stripped || sink.name == stripped || sink.name == device_name
    }) {
        return Ok(sink.clone());
    }

    sinks
        .into_iter()
        .find(|sink| sink.is_default)
        .ok_or_else(|| anyhow!("PipeWire sink not found for '{}'", device_name))
}

fn find_pw_cat() -> Result<PathBuf> {
    which::which("pw-cat")
        .or_else(|_| which::which("pw-record"))
        .context("pw-cat not found (install pipewire)")
}

async fn run_pw_cat_capture(
    pw_cat: PathBuf,
    node_name: String,
    capture: AudioCapture,
) -> Result<()> {
    let mut child = TokioCommand::new(&pw_cat)
        .args([
            "--record",
            "--raw",
            "--format",
            "f32",
            "--rate",
            "48000",
            "--channels",
            "2",
            "--latency",
            "20ms",
            "--target",
            &node_name,
            "--properties",
            "stream.capture.sink=true",
            "-",
        ])
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .kill_on_drop(true)
        .spawn()
        .with_context(|| format!("failed to start {}", pw_cat.display()))?;

    if let Some(mut stderr) = child.stderr.take() {
        tokio::spawn(async move {
            let mut buf = String::new();
            if stderr.read_to_string(&mut buf).await.is_ok() && !buf.trim().is_empty() {
                warn!("pw-cat stderr: {}", buf.trim());
            }
        });
    }

    let mut stdout = child
        .stdout
        .take()
        .ok_or_else(|| anyhow!("pw-cat stdout was not captured"))?;

    let mut leftover = Vec::new();
    let mut read_buf = vec![0u8; 8192];

    loop {
        let n = stdout.read(&mut read_buf).await?;
        if n == 0 {
            break;
        }

        leftover.extend_from_slice(&read_buf[..n]);
        let complete = leftover.len() / 4 * 4;
        if complete == 0 {
            continue;
        }

        let mut samples = Vec::with_capacity(complete / 4);
        for chunk in leftover[..complete].chunks_exact(4) {
            samples.push(f32::from_le_bytes([chunk[0], chunk[1], chunk[2], chunk[3]]));
        }
        leftover.drain(..complete);
        capture.process_audio_data(&samples);
    }

    let status = child.wait().await?;
    if !status.success() {
        return Err(anyhow!("pw-cat exited with {}", status));
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parse_default_sink_from_object() {
        let value = serde_json::json!({"name": "alsa_output.pci-0000_00_1f.3.analog-stereo"});
        assert_eq!(
            parse_default_sink_name(&value).as_deref(),
            Some("alsa_output.pci-0000_00_1f.3.analog-stereo")
        );
    }

    #[test]
    fn parse_default_sink_from_json_string() {
        let value = Value::String(
            "{\"name\":\"alsa_output.pci-0000_00_1f.3.analog-stereo\"}".to_string(),
        );
        assert_eq!(
            parse_default_sink_name(&value).as_deref(),
            Some("alsa_output.pci-0000_00_1f.3.analog-stereo")
        );
    }

    #[test]
    fn assign_unique_and_duplicate_display_names() {
        let mut sinks = vec![
            PipeWireSink {
                name: "sink_a".to_string(),
                description: "Built-in Audio".to_string(),
                display_name: String::new(),
                is_default: true,
            },
            PipeWireSink {
                name: "sink_b".to_string(),
                description: "USB Headset".to_string(),
                display_name: String::new(),
                is_default: false,
            },
            PipeWireSink {
                name: "sink_c".to_string(),
                description: "USB Headset".to_string(),
                display_name: String::new(),
                is_default: false,
            },
        ];
        assign_display_names(&mut sinks);
        assert_eq!(sinks[0].display_name, "Monitor of Built-in Audio");
        assert_eq!(sinks[1].display_name, "Monitor of USB Headset (sink_b)");
        assert_eq!(sinks[2].display_name, "Monitor of USB Headset (sink_c)");
    }
}
