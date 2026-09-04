#![deny(unsafe_op_in_unsafe_fn)]

use std::{ffi::c_void, ptr};

const CHANNELS: usize = 2;
const INPUT_CAPACITY: usize = 128;
const SHORT_TERM_BLOCKS: usize = 30;
const MAX_INTEGRATED_BLOCKS: usize = 600;
const ABSOLUTE_THRESHOLD_POWER: f64 = 1.172_465_304_582_298_1e-7;
const RELATIVE_THRESHOLD_POWER_RATIO: f64 = 0.1;

#[derive(Clone, Copy)]
struct BiquadCoefficients {
    b: [f64; 3],
    a: [f64; 3],
}

struct LufsMeter {
    block_size_samples: usize,
    hop_size_samples: usize,
    update_interval_samples: usize,
    high_shelf: BiquadCoefficients,
    high_pass: BiquadCoefficients,
    hs_x1: [f32; CHANNELS],
    hs_x2: [f32; CHANNELS],
    hs_y1: [f32; CHANNELS],
    hs_y2: [f32; CHANNELS],
    hp_x1: [f32; CHANNELS],
    hp_x2: [f32; CHANNELS],
    hp_y1: [f32; CHANNELS],
    hp_y2: [f32; CHANNELS],
    ring_index: usize,
    ring_squares: Vec<f32>,
    sum_squares: [f64; CHANNELS],
    samples_since_last_block: usize,
    samples_since_last_update: usize,
    samples_accumulated: usize,
    block_powers: [f64; MAX_INTEGRATED_BLOCKS],
    integrated_power_sum: f64,
    integrated_length: usize,
    integrated_index: usize,
    short_term_powers: [f64; SHORT_TERM_BLOCKS],
    short_term_power_sum: f64,
    short_term_gated_count: usize,
    short_term_length: usize,
    short_term_index: usize,
    block_count: u32,
    active_channels: usize,
    input_left: [f32; INPUT_CAPACITY],
    input_right: [f32; INPUT_CAPACITY],
}

impl LufsMeter {
    fn new(sample_rate: f64) -> Option<Self> {
        if !sample_rate.is_finite() || sample_rate <= 0.0 {
            return None;
        }

        let block_size_samples = ((0.4 * sample_rate).floor() as usize).max(INPUT_CAPACITY);
        let coefficients = create_k_weighting_coefficients(sample_rate);

        Some(Self {
            block_size_samples,
            hop_size_samples: (block_size_samples / 4).max(1),
            update_interval_samples: ((0.1 * sample_rate).floor() as usize).max(INPUT_CAPACITY),
            high_shelf: coefficients.0,
            high_pass: coefficients.1,
            hs_x1: [0.0; CHANNELS],
            hs_x2: [0.0; CHANNELS],
            hs_y1: [0.0; CHANNELS],
            hs_y2: [0.0; CHANNELS],
            hp_x1: [0.0; CHANNELS],
            hp_x2: [0.0; CHANNELS],
            hp_y1: [0.0; CHANNELS],
            hp_y2: [0.0; CHANNELS],
            ring_index: 0,
            ring_squares: vec![0.0; CHANNELS * block_size_samples],
            sum_squares: [0.0; CHANNELS],
            samples_since_last_block: 0,
            samples_since_last_update: 0,
            samples_accumulated: 0,
            block_powers: [0.0; MAX_INTEGRATED_BLOCKS],
            integrated_power_sum: 0.0,
            integrated_length: 0,
            integrated_index: 0,
            short_term_powers: [0.0; SHORT_TERM_BLOCKS],
            short_term_power_sum: 0.0,
            short_term_gated_count: 0,
            short_term_length: 0,
            short_term_index: 0,
            block_count: 0,
            active_channels: 0,
            input_left: [0.0; INPUT_CAPACITY],
            input_right: [0.0; INPUT_CAPACITY],
        })
    }

    fn process(&mut self, frame_count: usize, active_channels: usize) -> bool {
        let frame_count = frame_count.min(INPUT_CAPACITY);
        let active_channels = active_channels.clamp(1, CHANNELS);

        if self.active_channels != 0 && self.active_channels != active_channels {
            self.reset();
        }
        self.active_channels = active_channels;

        let mut should_emit = false;
        for frame in 0..frame_count {
            self.process_channel(0, self.input_left[frame]);
            if active_channels == 2 {
                self.process_channel(1, self.input_right[frame]);
            }

            self.ring_index += 1;
            if self.ring_index >= self.block_size_samples {
                self.ring_index = 0;
            }
            self.samples_since_last_block += 1;
            self.samples_since_last_update += 1;
            self.samples_accumulated = (self.samples_accumulated + 1).min(self.block_size_samples);

            if self.samples_since_last_block >= self.hop_size_samples
                && self.samples_accumulated >= self.block_size_samples
            {
                self.samples_since_last_block -= self.hop_size_samples;
                let block_power = self.current_block_power();
                if block_power > ABSOLUTE_THRESHOLD_POWER {
                    self.push_integrated(block_power);
                    self.block_count = self.block_count.saturating_add(1);
                }
                self.push_short_term(block_power);
            }

            if self.samples_since_last_update >= self.update_interval_samples {
                self.samples_since_last_update -= self.update_interval_samples;
                should_emit = true;
            }
        }

        should_emit
    }

    fn process_channel(&mut self, channel: usize, input: f32) {
        let input = f64::from(input);
        let high_shelf = self.high_shelf;
        let after_high_shelf = high_shelf.b[0] * input
            + high_shelf.b[1] * f64::from(self.hs_x1[channel])
            + high_shelf.b[2] * f64::from(self.hs_x2[channel])
            - high_shelf.a[1] * f64::from(self.hs_y1[channel])
            - high_shelf.a[2] * f64::from(self.hs_y2[channel]);

        self.hs_x2[channel] = self.hs_x1[channel];
        self.hs_x1[channel] = input as f32;
        self.hs_y2[channel] = self.hs_y1[channel];
        self.hs_y1[channel] = after_high_shelf as f32;

        let high_pass = self.high_pass;
        let filtered = high_pass.b[0] * after_high_shelf
            + high_pass.b[1] * f64::from(self.hp_x1[channel])
            + high_pass.b[2] * f64::from(self.hp_x2[channel])
            - high_pass.a[1] * f64::from(self.hp_y1[channel])
            - high_pass.a[2] * f64::from(self.hp_y2[channel]);

        self.hp_x2[channel] = self.hp_x1[channel];
        self.hp_x1[channel] = after_high_shelf as f32;
        self.hp_y2[channel] = self.hp_y1[channel];
        self.hp_y1[channel] = filtered as f32;

        let square = filtered * filtered;
        let ring_offset = channel * self.block_size_samples + self.ring_index;
        let previous = f64::from(self.ring_squares[ring_offset]);
        self.sum_squares[channel] += square - previous;
        self.ring_squares[ring_offset] = square as f32;
    }

    fn current_block_power(&self) -> f64 {
        self.sum_squares[..self.active_channels].iter().sum::<f64>()
            / self.block_size_samples as f64
    }

    fn push_integrated(&mut self, power: f64) {
        if self.integrated_length == MAX_INTEGRATED_BLOCKS {
            self.integrated_power_sum -= self.block_powers[self.integrated_index];
        }
        self.block_powers[self.integrated_index] = power;
        self.integrated_power_sum += power;
        self.integrated_index = (self.integrated_index + 1) % MAX_INTEGRATED_BLOCKS;
        self.integrated_length = (self.integrated_length + 1).min(MAX_INTEGRATED_BLOCKS);
    }

    fn push_short_term(&mut self, power: f64) {
        if self.short_term_length == SHORT_TERM_BLOCKS {
            let previous = self.short_term_powers[self.short_term_index];
            if previous > ABSOLUTE_THRESHOLD_POWER {
                self.short_term_power_sum -= previous;
                self.short_term_gated_count -= 1;
            }
        }
        self.short_term_powers[self.short_term_index] = power;
        if power > ABSOLUTE_THRESHOLD_POWER {
            self.short_term_power_sum += power;
            self.short_term_gated_count += 1;
        }
        self.short_term_index = (self.short_term_index + 1) % SHORT_TERM_BLOCKS;
        self.short_term_length = (self.short_term_length + 1).min(SHORT_TERM_BLOCKS);
    }

    fn momentary(&self) -> f64 {
        if self.short_term_length == 0 {
            return f64::NEG_INFINITY;
        }
        let latest = (self.short_term_index + SHORT_TERM_BLOCKS - 1) % SHORT_TERM_BLOCKS;
        power_to_lufs(self.short_term_powers[latest])
    }

    fn short_term(&self) -> f64 {
        if self.short_term_gated_count == 0 {
            return f64::NEG_INFINITY;
        }
        power_to_lufs(self.short_term_power_sum / self.short_term_gated_count as f64)
    }

    fn integrated(&self) -> f64 {
        if self.integrated_length == 0 {
            return f64::NEG_INFINITY;
        }

        let relative_threshold = self.integrated_power_sum / self.integrated_length as f64
            * RELATIVE_THRESHOLD_POWER_RATIO;
        let mut relative_power_sum = 0.0;
        let mut relative_count = 0;
        for &power in &self.block_powers[..self.integrated_length] {
            if power > relative_threshold {
                relative_power_sum += power;
                relative_count += 1;
            }
        }

        if relative_count == 0 {
            f64::NEG_INFINITY
        } else {
            power_to_lufs(relative_power_sum / f64::from(relative_count))
        }
    }

    fn reset(&mut self) {
        self.hs_x1.fill(0.0);
        self.hs_x2.fill(0.0);
        self.hs_y1.fill(0.0);
        self.hs_y2.fill(0.0);
        self.hp_x1.fill(0.0);
        self.hp_x2.fill(0.0);
        self.hp_y1.fill(0.0);
        self.hp_y2.fill(0.0);
        self.ring_squares.fill(0.0);
        self.sum_squares.fill(0.0);
        self.ring_index = 0;
        self.samples_since_last_block = 0;
        self.samples_since_last_update = 0;
        self.samples_accumulated = 0;
        self.block_powers.fill(0.0);
        self.integrated_power_sum = 0.0;
        self.integrated_length = 0;
        self.integrated_index = 0;
        self.short_term_powers.fill(0.0);
        self.short_term_power_sum = 0.0;
        self.short_term_gated_count = 0;
        self.short_term_length = 0;
        self.short_term_index = 0;
        self.block_count = 0;
    }
}

fn create_k_weighting_coefficients(sample_rate: f64) -> (BiquadCoefficients, BiquadCoefficients) {
    let shelf_frequency = 1681.974450955533;
    let shelf_gain_db = 3.999843853973347;
    let shelf_q = 0.7071752369554196;
    let shelf_k = libm::tan(std::f64::consts::PI * shelf_frequency / sample_rate);
    let shelf_gain = libm::pow(10.0, shelf_gain_db / 20.0);
    let shelf_bandwidth_gain = libm::pow(shelf_gain, 0.4996667741545416);
    let shelf_a0 = 1.0 + shelf_k / shelf_q + shelf_k * shelf_k;

    let high_shelf = BiquadCoefficients {
        b: [
            (shelf_gain + shelf_bandwidth_gain * shelf_k / shelf_q + shelf_k * shelf_k) / shelf_a0,
            2.0 * (shelf_k * shelf_k - shelf_gain) / shelf_a0,
            (shelf_gain - shelf_bandwidth_gain * shelf_k / shelf_q + shelf_k * shelf_k) / shelf_a0,
        ],
        a: [
            1.0,
            2.0 * (shelf_k * shelf_k - 1.0) / shelf_a0,
            (1.0 - shelf_k / shelf_q + shelf_k * shelf_k) / shelf_a0,
        ],
    };

    let high_pass_frequency = 38.13547087602444;
    let high_pass_q = 0.5003270373238773;
    let high_pass_k = libm::tan(std::f64::consts::PI * high_pass_frequency / sample_rate);
    let high_pass_a0 = 1.0 + high_pass_k / high_pass_q + high_pass_k * high_pass_k;
    let high_pass = BiquadCoefficients {
        b: [1.0, -2.0, 1.0],
        a: [
            1.0,
            2.0 * (high_pass_k * high_pass_k - 1.0) / high_pass_a0,
            (1.0 - high_pass_k / high_pass_q + high_pass_k * high_pass_k) / high_pass_a0,
        ],
    };

    (high_shelf, high_pass)
}

fn power_to_lufs(power: f64) -> f64 {
    if power <= 0.0 {
        f64::NEG_INFINITY
    } else {
        -0.691 + 10.0 * libm::log10(power)
    }
}

#[unsafe(no_mangle)]
pub extern "C" fn lufs_create(sample_rate: f64) -> *mut c_void {
    LufsMeter::new(sample_rate)
        .map(|meter| Box::into_raw(Box::new(meter)).cast())
        .unwrap_or(ptr::null_mut())
}

#[unsafe(no_mangle)]
/// # Safety
/// `handle` must be null or a live pointer returned by `lufs_create`, and may be destroyed once.
pub unsafe extern "C" fn lufs_destroy(handle: *mut c_void) {
    if !handle.is_null() {
        drop(unsafe { Box::from_raw(handle.cast::<LufsMeter>()) });
    }
}

#[unsafe(no_mangle)]
pub const extern "C" fn lufs_input_capacity() -> u32 {
    INPUT_CAPACITY as u32
}

#[unsafe(no_mangle)]
/// # Safety
/// `handle` must be a live pointer returned by `lufs_create`.
pub unsafe extern "C" fn lufs_input_left_ptr(handle: *mut c_void) -> *mut f32 {
    unsafe { handle.cast::<LufsMeter>().as_mut() }
        .map(|meter| meter.input_left.as_mut_ptr())
        .unwrap_or(ptr::null_mut())
}

#[unsafe(no_mangle)]
/// # Safety
/// `handle` must be a live pointer returned by `lufs_create`.
pub unsafe extern "C" fn lufs_input_right_ptr(handle: *mut c_void) -> *mut f32 {
    unsafe { handle.cast::<LufsMeter>().as_mut() }
        .map(|meter| meter.input_right.as_mut_ptr())
        .unwrap_or(ptr::null_mut())
}

#[unsafe(no_mangle)]
/// # Safety
/// `handle` must be a live pointer returned by `lufs_create`; input buffers must contain
/// `frame_count` initialized samples, up to `lufs_input_capacity()`.
pub unsafe extern "C" fn lufs_process(
    handle: *mut c_void,
    frame_count: u32,
    active_channels: u32,
) -> u32 {
    unsafe { handle.cast::<LufsMeter>().as_mut() }
        .is_some_and(|meter| meter.process(frame_count as usize, active_channels as usize))
        .into()
}

#[unsafe(no_mangle)]
/// # Safety
/// `handle` must be a live pointer returned by `lufs_create`.
pub unsafe extern "C" fn lufs_momentary(handle: *const c_void) -> f64 {
    unsafe { handle.cast::<LufsMeter>().as_ref() }
        .map(LufsMeter::momentary)
        .unwrap_or(f64::NEG_INFINITY)
}

#[unsafe(no_mangle)]
/// # Safety
/// `handle` must be a live pointer returned by `lufs_create`.
pub unsafe extern "C" fn lufs_short_term(handle: *const c_void) -> f64 {
    unsafe { handle.cast::<LufsMeter>().as_ref() }
        .map(LufsMeter::short_term)
        .unwrap_or(f64::NEG_INFINITY)
}

#[unsafe(no_mangle)]
/// # Safety
/// `handle` must be a live pointer returned by `lufs_create`.
pub unsafe extern "C" fn lufs_integrated(handle: *const c_void) -> f64 {
    unsafe { handle.cast::<LufsMeter>().as_ref() }
        .map(LufsMeter::integrated)
        .unwrap_or(f64::NEG_INFINITY)
}

#[unsafe(no_mangle)]
/// # Safety
/// `handle` must be a live pointer returned by `lufs_create`.
pub unsafe extern "C" fn lufs_block_count(handle: *const c_void) -> u32 {
    unsafe { handle.cast::<LufsMeter>().as_ref() }
        .map(|meter| meter.block_count)
        .unwrap_or(0)
}

#[unsafe(no_mangle)]
/// # Safety
/// `handle` must be a live pointer returned by `lufs_create`.
pub unsafe extern "C" fn lufs_reset(handle: *mut c_void) {
    if let Some(meter) = unsafe { handle.cast::<LufsMeter>().as_mut() } {
        meter.reset();
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn rejects_invalid_sample_rates() {
        assert!(LufsMeter::new(0.0).is_none());
        assert!(LufsMeter::new(f64::NAN).is_none());
    }

    #[test]
    fn silence_stays_below_the_absolute_gate() {
        let mut meter = LufsMeter::new(48_000.0).expect("valid meter");
        for _ in 0..1_500 {
            meter.process(INPUT_CAPACITY, 2);
        }
        assert_eq!(meter.block_count, 0);
        assert_eq!(meter.integrated(), f64::NEG_INFINITY);
    }

    #[test]
    fn stereo_sine_produces_a_stable_measurement() {
        let sample_rate = 48_000.0;
        let mut meter = LufsMeter::new(sample_rate).expect("valid meter");
        let amplitude = libm::pow(10.0, -18.0 / 20.0) as f32;

        for frame_start in (0..(sample_rate as usize * 5)).step_by(INPUT_CAPACITY) {
            for offset in 0..INPUT_CAPACITY {
                let frame = frame_start + offset;
                let sample =
                    libm::sin(2.0 * std::f64::consts::PI * 1_000.0 * frame as f64 / sample_rate)
                        as f32
                        * amplitude;
                meter.input_left[offset] = sample;
                meter.input_right[offset] = sample;
            }
            meter.process(INPUT_CAPACITY, 2);
        }

        assert!(meter.block_count >= 10);
        assert!(meter.integrated().is_finite());
        assert!((meter.integrated() - -17.993).abs() < 0.05);
    }

    #[test]
    fn reset_clears_accumulated_measurements() {
        let mut meter = LufsMeter::new(8_000.0).expect("valid meter");
        meter.input_left.fill(0.1);
        meter.input_right.fill(0.1);
        for _ in 0..40 {
            meter.process(INPUT_CAPACITY, 2);
        }
        assert!(meter.block_count > 0);

        meter.reset();

        assert_eq!(meter.block_count, 0);
        assert_eq!(meter.momentary(), f64::NEG_INFINITY);
        assert_eq!(meter.integrated(), f64::NEG_INFINITY);
    }
}
