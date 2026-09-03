// Cancel system-audio leak in the microphone before mixing.
// Without this, Google Meet playback is recorded twice: digitally from the
// PipeWire monitor and acoustically through the mic (heard as echo).

use log::{debug, info};

/// ~43 ms of room impulse after bulk delay. 512 taps (~11 ms) left too much reverb.
const FILTER_TAPS: usize = 2048;
const NLMS_MU: f32 = 0.2;
const NLMS_EPS: f32 = 1e-6;
const SYS_FLOOR: f32 = 0.004;
const DELAY_CORR_MIN: f32 = 0.18;
const MAX_DELAY_MS: u32 = 250;
const MIN_DELAY_MS: i32 = -40;
const RES_FLOOR: f32 = 0.01;
const RES_MIN_GAIN: f32 = 0.04;

pub struct AcousticEchoCanceller {
    sample_rate: u32,
    weights: Vec<f32>,
    reference: Vec<f32>,
    ref_index: usize,
    ref_power: f32,
    sys_history: Vec<f32>,
    sys_hist_pos: usize,
    sys_hist_filled: usize,
    delay_samples: i32,
    windows_processed: u32,
    res_gain: f32,
}

impl AcousticEchoCanceller {
    pub fn new(sample_rate: u32) -> Self {
        let max_delay = ((sample_rate as u64 * MAX_DELAY_MS as u64) / 1000) as usize;
        let history_len = (max_delay + FILTER_TAPS + 1).max(1);
        Self {
            sample_rate,
            weights: vec![0.0; FILTER_TAPS],
            reference: vec![0.0; FILTER_TAPS],
            ref_index: 0,
            ref_power: 0.0,
            sys_history: vec![0.0; history_len],
            sys_hist_pos: 0,
            sys_hist_filled: 0,
            delay_samples: 0,
            windows_processed: 0,
            res_gain: 1.0,
        }
    }

    pub fn process(&mut self, mic: &[f32], sys: &[f32]) -> Vec<f32> {
        let len = mic.len().max(sys.len());
        if len == 0 {
            return Vec::new();
        }

        if let Some(delay) = estimate_delay_samples(mic, sys, self.sample_rate) {
            self.update_delay(delay);
        }

        let sys_rms = rms(sys);
        let mic_rms = rms(mic);
        let system_present = sys_rms > SYS_FLOOR;
        // Freeze adaptation during double-talk so the user's voice is not cancelled.
        let near_end_talk = mic_rms > sys_rms * 1.4 + 0.01;
        let adapt = system_present && !near_end_talk;

        let mut cleaned = Vec::with_capacity(len);
        for i in 0..len {
            let mic_s = mic.get(i).copied().unwrap_or(0.0);
            let sys_now = sys.get(i).copied().unwrap_or(0.0);
            self.push_sys(sys_now);
            let sys_s = self.reference_sample(sys, i);

            let old = self.reference[self.ref_index];
            self.reference[self.ref_index] = sys_s;
            self.ref_power += sys_s * sys_s - old * old;
            if self.ref_power < 0.0 {
                self.ref_power = 0.0;
            }

            let echo_est = self.filter_output();
            let err = (mic_s - echo_est).clamp(-1.0, 1.0);
            cleaned.push(err);

            if adapt {
                self.nlms_update(err);
            }

            self.ref_index = (self.ref_index + 1) % FILTER_TAPS;
        }

        if system_present && !near_end_talk {
            let cleaned_rms = rms(&cleaned);
            let target = (RES_FLOOR / (cleaned_rms + RES_FLOOR)).clamp(RES_MIN_GAIN, 1.0);
            self.res_gain = 0.85 * self.res_gain + 0.15 * target;
            if self.res_gain < 0.95 {
                for sample in &mut cleaned {
                    *sample *= self.res_gain;
                }
            }
        } else {
            self.res_gain = 0.85 * self.res_gain + 0.15;
        }

        self.windows_processed = self.windows_processed.saturating_add(1);
        cleaned
    }

    fn update_delay(&mut self, delay: i32) {
        if delay == self.delay_samples {
            return;
        }
        let jumped = self.windows_processed == 0 || delay.abs_diff(self.delay_samples) > 240;
        if jumped {
            info!(
                "AEC aligned speaker echo: delay={} samples ({:.0} ms)",
                delay,
                delay as f32 / self.sample_rate as f32 * 1000.0
            );
            self.weights.fill(0.0);
            self.reference.fill(0.0);
            self.ref_power = 0.0;
        } else {
            debug!(
                "AEC delay updated: {} -> {} samples ({:.1} ms)",
                self.delay_samples,
                delay,
                delay as f32 / self.sample_rate as f32 * 1000.0
            );
        }
        self.delay_samples = delay;
    }

    fn push_sys(&mut self, sample: f32) {
        let len = self.sys_history.len();
        self.sys_history[self.sys_hist_pos] = sample;
        self.sys_hist_pos = (self.sys_hist_pos + 1) % len;
        if self.sys_hist_filled < len {
            self.sys_hist_filled += 1;
        }
    }

    fn reference_sample(&self, sys: &[f32], index: usize) -> f32 {
        if self.delay_samples < 0 {
            return sys
                .get(index + (-self.delay_samples) as usize)
                .copied()
                .unwrap_or(0.0);
        }
        let delay = self.delay_samples as usize;
        if delay >= self.sys_hist_filled {
            return 0.0;
        }
        let len = self.sys_history.len();
        let idx = (self.sys_hist_pos + len - 1 - delay) % len;
        self.sys_history[idx]
    }

    fn filter_output(&self) -> f32 {
        let mut y = 0.0;
        let mut idx = self.ref_index;
        for weight in &self.weights {
            y += weight * self.reference[idx];
            idx = if idx == 0 { FILTER_TAPS - 1 } else { idx - 1 };
        }
        y
    }

    fn nlms_update(&mut self, error: f32) {
        let power = self.ref_power + NLMS_EPS;
        let step = NLMS_MU * error / power;
        let mut idx = self.ref_index;
        for weight in &mut self.weights {
            *weight += step * self.reference[idx];
            idx = if idx == 0 { FILTER_TAPS - 1 } else { idx - 1 };
        }
    }
}

fn rms(samples: &[f32]) -> f32 {
    if samples.is_empty() {
        return 0.0;
    }
    (samples.iter().map(|&x| x * x).sum::<f32>() / samples.len() as f32).sqrt()
}

fn estimate_delay_samples(mic: &[f32], sys: &[f32], sample_rate: u32) -> Option<i32> {
    const DECIM: usize = 8;
    if mic.len() < 1024 || sys.len() < 1024 {
        return None;
    }

    let mic_d: Vec<f32> = mic.iter().copied().step_by(DECIM).collect();
    let sys_d: Vec<f32> = sys.iter().copied().step_by(DECIM).collect();
    let max_lag = ((sample_rate as usize * MAX_DELAY_MS as usize) / 1000) / DECIM;
    let min_lag = ((sample_rate as i32 * MIN_DELAY_MS) / 1000) / DECIM as i32;

    let mut best_lag = 0i32;
    let mut best_corr = 0.0f32;

    for lag in min_lag..=max_lag as i32 {
        let mut corr = 0.0;
        let mut p_mic = 0.0;
        let mut p_sys = 0.0;
        let n = mic_d.len().min(sys_d.len());
        let start = lag.max(0) as usize;
        let end = if lag < 0 {
            n.saturating_sub((-lag) as usize)
        } else {
            n
        };
        if end <= start + 48 {
            continue;
        }

        for i in (start..end).step_by(2) {
            let m = mic_d[i];
            let s_index = i as i32 - lag;
            if s_index < 0 || s_index as usize >= sys_d.len() {
                continue;
            }
            let s = sys_d[s_index as usize];
            corr += m * s;
            p_mic += m * m;
            p_sys += s * s;
        }

        let denom = (p_mic * p_sys).sqrt() + 1e-8;
        let c = corr / denom;
        if c > best_corr {
            best_corr = c;
            best_lag = lag;
        }
    }

    if best_corr >= DELAY_CORR_MIN {
        Some(best_lag * DECIM as i32)
    } else {
        None
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn cancels_delayed_system_leak() {
        let sample_rate = 48000;
        let mut aec = AcousticEchoCanceller::new(sample_rate);
        let n = sample_rate as usize;
        let sys: Vec<f32> = (0..n)
            .map(|i| ((i as f32) * 0.017).sin() * 0.35)
            .collect();
        let delay = 960;
        let mut mic = vec![0.0; n];
        for i in delay..n {
            mic[i] = 0.5 * sys[i - delay];
        }

        let window = 4800;
        let mut cleaned = Vec::new();
        for start in (0..n).step_by(window) {
            let end = (start + window).min(n);
            cleaned.extend(aec.process(&mic[start..end], &sys[start..end]));
        }

        let tail = n - n / 4;
        let before: f32 = mic[tail..].iter().map(|x| x * x).sum();
        let after: f32 = cleaned[tail..].iter().map(|x| x * x).sum();
        assert!(
            after < before * 0.35,
            "echo energy not reduced enough: before={before}, after={after}"
        );
    }
}
