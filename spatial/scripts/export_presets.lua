#!/usr/bin/env lua
-- Emit presets as JSON for Swift / WKWebView bridge.

local function escape(s)
  return '"' .. tostring(s):gsub('\\', '\\\\'):gsub('"', '\\"') .. '"'
end

local script_dir = arg[0]:match("(.*/)")
dofile(script_dir .. "presets.lua")

local keys = list_presets()
local lines = { "{", '  "presets": {' }

for i, k in ipairs(keys) do
  local p = get_preset(k)
  lines[#lines + 1] = string.format("    %s: {", escape(k))
  lines[#lines + 1] = string.format('      "label": %s', escape(p.label or k))
  for _, field in ipairs({ "depth", "size", "dispersion", "spin", "hue", "glow", "mask", "stride" }) do
    local v = p[field]
    if v ~= nil then
      lines[#lines + 1] = string.format('      "%s": %s', field, tostring(v))
    end
  end
  lines[#lines + 1] = "    }" .. (i < #keys and "," or "")
end

lines[#lines + 1] = "  }"
lines[#lines + 1] = "}"
print(table.concat(lines, "\n"))