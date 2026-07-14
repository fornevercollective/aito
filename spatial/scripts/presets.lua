-- Booth VFX presets — loaded by AitoMac LuaBridge (lua CLI or embedded).
-- tree-sitter walker: aito-walk lua scripts/presets.lua

presets = {}

presets.neon = {
  label = "Neon pulse",
  depth = 1.4,
  size = 0.018,
  dispersion = 0.14,
  spin = 0.45,
  hue = 0.12,
  glow = 1.35,
  mask = 0.3,
  stride = 2,
}

presets.ghost = {
  label = "Ghost scan",
  depth = 0.85,
  size = 0.008,
  dispersion = 0.22,
  spin = 0.08,
  hue = 0.55,
  glow = 0.55,
  mask = 0.5,
  stride = 3,
}

presets.ruben = {
  label = "RubenFro MIDI",
  depth = 1.6,
  size = 0.015,
  dispersion = 0.28,
  spin = 0.9,
  hue = 0.02,
  glow = 1.6,
  mask = 0.25,
  stride = 2,
}

presets.portrait = {
  label = "CAP4D portrait",
  depth = 1.25,
  size = 0.01,
  dispersion = 0.04,
  spin = 0.15,
  hue = 0.0,
  glow = 0.75,
  mask = 0.35,
  stride = 3,
}

function list_presets()
  local keys = {}
  for k, _ in pairs(presets) do
    keys[#keys + 1] = k
  end
  table.sort(keys)
  return keys
end

function get_preset(name)
  return presets[name]
end