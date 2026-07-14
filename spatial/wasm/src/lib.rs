/// MIDI-normalized input 0..1, time in seconds.
#[no_mangle]
pub extern "C" fn booth_dispersion(t: f32, cc: f32) -> f32 {
    let pulse = (t * 2.1).sin() * 0.5 + 0.5;
    cc * 0.35 + pulse * cc * 0.15
}

#[no_mangle]
pub extern "C" fn booth_depth_lift(t: f32, cc: f32) -> f32 {
    let wobble = (t * 0.7).sin() * 0.08;
    0.2 + cc * 2.8 + wobble
}

#[no_mangle]
pub extern "C" fn booth_spin(t: f32, cc: f32) -> f32 {
    let sign = if (t as i32) % 2 == 0 { 1.0 } else { -1.0 };
    cc * 2.0 * sign
}