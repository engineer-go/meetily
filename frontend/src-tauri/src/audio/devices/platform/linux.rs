use std::sync::Mutex;
use std::time::{Duration, Instant};

use anyhow::Result;
use cpal::traits::{DeviceTrait, HostTrait};
use log::debug;

use crate::audio::devices::configuration::{AudioDevice, DeviceType};
use crate::audio::linux_system_audio;

const DEVICE_CACHE_TTL: Duration = Duration::from_secs(5);
static DEVICE_CACHE: Mutex<Option<(Instant, Vec<AudioDevice>)>> = Mutex::new(None);

/// Configure Linux audio devices: ALSA/PipeWire microphones + PipeWire sink monitors.
pub fn configure_linux_audio(host: &cpal::Host) -> Result<Vec<AudioDevice>> {
    {
        let cache = DEVICE_CACHE.lock().unwrap_or_else(|e| e.into_inner());
        if let Some((fetched_at, devices)) = cache.as_ref() {
            if fetched_at.elapsed() < DEVICE_CACHE_TTL {
                return Ok(devices.clone());
            }
        }
    }

    let mut devices = Vec::new();

    for device in host.input_devices()? {
        if let Ok(name) = device.name() {
            devices.push(AudioDevice::new(name, DeviceType::Input));
        }
    }

    let monitors = linux_system_audio::list_monitor_devices();
    if monitors.is_empty() {
        // Fallback: ALSA/Pulse sources whose name already includes "monitor"
        if let Ok(alsa_host) = cpal::host_from_id(cpal::HostId::Alsa) {
            for device in alsa_host.input_devices()? {
                if let Ok(name) = device.name() {
                    if name.to_lowercase().contains("monitor") {
                        devices.push(AudioDevice::new(
                            format!("{} (System Audio)", name),
                            DeviceType::Output,
                        ));
                    }
                }
            }
        }
    } else {
        debug!(
            "Using {} PipeWire monitor device(s) as system audio",
            monitors.len()
        );
        devices.extend(monitors);
    }

    if let Ok(mut cache) = DEVICE_CACHE.lock() {
        *cache = Some((Instant::now(), devices.clone()));
    }

    Ok(devices)
}
