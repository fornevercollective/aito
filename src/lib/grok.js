// Grok (xAI) integration — upgraded to agentic photo editor
// Supports planning + real tool calling for multi-step, high-quality edits.
const GROK_API_URL = 'https://api.x.ai/v1/chat/completions';
import { getAllPresetSlugs } from './lutPresets.js';
// Master-level system prompt for aito
const MASTER_EDITOR_PROMPT = `You are a world-class cinematic colorist and retoucher working inside the aito photo editor.

Your job is to interpret the user's creative intent and translate it into precise, high-quality edits using the tools available in aito.

Available tools:
- set_adjustments: exposure, contrast, saturation, temperature, tint, clarity, sharpen, vignette, lutIntensity (values roughly -1 to +1 or 0-1)
- apply_lut: preset slug from the imagine catalog (e.g. "kodak-portra-400", "dark-academia", "teal-orange-blockbuster", "bleach-bypass-lut", ...). Full list: src/data/imagine-presets.json (source /Users/qbit/dev/imagine/style_presets)
- create_mask: natural language description for SAM (e.g. "the person", "the sky", "background")
- set_mask_scope: "subject", "background", or "all"
- add_bake_note: short label for the edit history

Rules:
- Think like a top Hollywood colorist and commercial retoucher.
- Prefer subtle, tasteful, filmic results over heavy-handed changes.
- When the request is complex, return a "plan" (sequence of actions) instead of one giant adjustment.
- You can see the current image. Use it to make smart decisions about masking and color.
- Always return valid JSON.

Response format (choose one):
1. Simple edit:
{
  "adjustments": { ... },
  "lutName": "..." or null,
  "maskPrompt": "..." or null,
  "reasoning": "short explanation"
}

2. Multi-step plan (preferred for interesting requests):
{
  "plan": [
    { "tool": "create_mask", "args": { "description": "the subject" } },
    { "tool": "set_mask_scope", "args": { "scope": "subject" } },
    { "tool": "apply_lut", "args": { "preset": "kodak-portra-400", "intensity": 0.85 } },
    { "tool": "set_adjustments", "args": { "exposure": 0.15, "clarity": 0.4 } }
  ],
  "reasoning": "Why this sequence makes sense for the request"
}`;
export async function callGrokForEdits(apiKey, prompt, imageBase64, currentAdjustments, referenceImages = [], // additional reference board images
conversationHistory = []) {
    const contentParts = [
        {
            type: "text",
            text: `Current adjustments: ${JSON.stringify(currentAdjustments, null, 2)}\n\nUser request: ${prompt}`
        },
        { type: "image_url", image_url: { url: imageBase64 } }
    ];
    // Add reference images (Krea-style reference boards)
    referenceImages.forEach((refUrl, i) => {
        contentParts.push({
            type: "text",
            text: `Reference ${i + 1}:`
        });
        contentParts.push({
            type: "image_url",
            image_url: { url: refUrl }
        });
    });
    const messages = [
        { role: "system", content: MASTER_EDITOR_PROMPT },
        ...conversationHistory,
        {
            role: "user",
            content: contentParts
        }
    ];
    const response = await fetch(GROK_API_URL, {
        method: 'POST',
        headers: {
            'Authorization': `Bearer ${apiKey}`,
            'Content-Type': 'application/json'
        },
        body: JSON.stringify({
            model: "grok-2-vision-latest", // use latest available
            messages,
            temperature: 0.4,
            max_tokens: 1200,
            tools: AITO_GROK_TOOLS,
            tool_choice: "auto"
        })
    });
    if (!response.ok) {
        throw new Error(`Grok API error: ${response.status}`);
    }
    const data = await response.json();
    const message = data.choices?.[0]?.message;
    // Handle tool calls if Grok decided to use them
    if (message?.tool_calls?.length > 0) {
        return {
            plan: message.tool_calls.map((tc) => ({
                tool: tc.function.name,
                args: JSON.parse(tc.function.arguments || '{}')
            })),
            reasoning: "Grok used tools directly"
        };
    }
    const content = message?.content;
    try {
        const parsed = JSON.parse(content);
        return parsed;
    }
    catch {
        return { notes: content };
    }
}
// New: Ask Grok to create a plan first (higher quality for complex requests)
export async function askGrokForPlan(apiKey, prompt, imageBase64, currentAdjustments, referenceImages = []) {
    const planPrompt = `The user wants: "${prompt}"

First, analyze the image and current state. Then output a clear, professional plan as a sequence of tool actions.

Return ONLY this JSON:
{
  "plan": [ array of tool actions ],
  "reasoning": "why this plan achieves the creative goal",
  "estimatedImpact": "what the final image will feel like"
}`;
    const contentParts = [
        { type: "text", text: `Current adjustments: ${JSON.stringify(currentAdjustments)}\n\n${planPrompt}` },
        { type: "image_url", image_url: { url: imageBase64 } }
    ];
    referenceImages.forEach((refUrl, i) => {
        contentParts.push({ type: "text", text: `Reference ${i + 1}:` });
        contentParts.push({ type: "image_url", image_url: { url: refUrl } });
    });
    const messages = [
        { role: "system", content: MASTER_EDITOR_PROMPT },
        {
            role: "user",
            content: contentParts
        }
    ];
    const res = await fetch(GROK_API_URL, {
        method: 'POST',
        headers: {
            'Authorization': `Bearer ${apiKey}`,
            'Content-Type': 'application/json'
        },
        body: JSON.stringify({
            model: "grok-2-vision-latest",
            messages,
            temperature: 0.35,
            max_tokens: 900,
            response_format: { type: "json_object" }
        })
    });
    if (!res.ok)
        throw new Error(`Grok plan error: ${res.status}`);
    const data = await res.json();
    const content = data.choices?.[0]?.message?.content;
    try {
        return JSON.parse(content);
    }
    catch {
        return null;
    }
}
// Helper to capture current canvas as base64 (used for vision)
export function captureCurrentImageBase64() {
    const canvas = document.querySelector('canvas');
    if (!canvas)
        return '';
    return canvas.toDataURL('image/jpeg', 0.88);
}
// Execute a plan returned by Grok (this will be called from the app)
export function executeGrokPlan(plan, dispatchers) {
    plan.forEach((step, index) => {
        setTimeout(() => {
            switch (step.tool) {
                case 'set_adjustments':
                    Object.entries(step.args.adjustments || {}).forEach(([key, val]) => {
                        if (typeof val === 'number')
                            dispatchers.setAdjustment(key, val);
                    });
                    break;
                case 'apply_lut':
                    dispatchers.applyLut(step.args.preset, step.args.intensity);
                    break;
                case 'create_mask':
                    dispatchers.createMaskFromPrompt(step.args.description);
                    break;
                case 'set_mask_scope':
                    dispatchers.setMaskScope(step.args.scope);
                    break;
                case 'capture_tether':
                    dispatchers.captureTether?.();
                    break;
            }
        }, index * 180); // slight stagger so user can see the sequence
    });
}
// Powerful tool definitions for real agentic editing in aito
export const AITO_GROK_TOOLS = [
    {
        type: "function",
        function: {
            name: "set_adjustments",
            description: "Apply precise photo adjustments. Use for exposure, contrast, color, clarity, etc.",
            parameters: {
                type: "object",
                properties: {
                    adjustments: {
                        type: "object",
                        description: "Key-value pairs of adjustments to apply",
                        additionalProperties: { type: "number" }
                    }
                }
            }
        }
    },
    {
        type: "function",
        function: {
            name: "apply_lut",
            description: "Apply a high-quality film, cinema or VSCO LUT preset",
            parameters: {
                type: "object",
                properties: {
                    preset: {
                        type: "string",
                        description: "Canonical slug from the imagine style catalog at /Users/qbit/dev/imagine/style_presets. See src/data/imagine-presets.json.",
                        enum: (typeof getAllPresetSlugs === 'function' ? getAllPresetSlugs() : ["kodak-portra-400", "teal-orange-blockbuster", "bleach-bypass-lut", "dark-academia", "fuji-superia-400"])
                    },
                    intensity: { type: "number", minimum: 0, maximum: 1 }
                }
            }
        }
    },
    {
        type: "function",
        function: {
            name: "create_mask",
            description: "Create or refine a mask using natural language (subject, background, specific object, etc.)",
            parameters: {
                type: "object",
                properties: {
                    description: { type: "string" }
                }
            }
        }
    },
    {
        type: "function",
        function: {
            name: "set_mask_scope",
            description: "Control whether edits apply to subject, background, or everything",
            parameters: {
                type: "object",
                properties: {
                    scope: { type: "string", enum: ["subject", "background", "all"] }
                }
            }
        }
    },
    {
        type: "function",
        function: {
            name: "capture_tether",
            description: "Trigger a capture from the currently tethered camera",
            parameters: { type: "object", properties: {} }
        }
    }
];
