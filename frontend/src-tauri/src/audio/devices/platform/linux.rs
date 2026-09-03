use anyhow::Result;
use cpal::traits::{DeviceTrait, HostTrait};
use log::info;

use crate::audio::devices::configuration::{AudioDevice, DeviceType};
use crate::audio::linux_system_audio;

/// Configure Linux audio devices: ALSA/PipeWire microphones + PipeWire sink monitors.
pub fn configure_linux_audio(host: &cpal::Host) -> Result<Vec<AudioDevice>> {
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
        info!("Adding {} PipeWire monitor device(s) as system audio", monitors.len());
        devices.extend(monitors);
    }

    Ok(devices)
}
