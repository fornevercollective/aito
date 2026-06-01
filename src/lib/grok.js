// Grok (xAI) integration for real-time AI photo editing commands
// Now supports tool calling for LUT creation, tether control, etc.
const GROK_API_URL = 'https://api.x.ai/v1/chat/completions';
export async function callGrokForEdits(apiKey, prompt, imageBase64, // data:image/jpeg;base64,...
currentAdjustments) {
    const systemPrompt = `You are an expert photo editor AI for the aito app.
Given a user prompt and the current image + adjustments, return ONLY a JSON object with suggested edits.

Format:
{
  "adjustments": { "exposure": 0.2, "contrast": 0.3, ... }, // deltas or absolute, keep reasonable
  "lutName": "string or null",
  "maskPrompt": "description for subject selection or null",
  "intensity": 0.8,
  "notes": "short explanation"
}

Be creative but tasteful. Support real-time cinematic looks, film emulation, etc.`;
    const messages = [
        { role: "system", content: systemPrompt },
        {
            role: "user",
            content: [
                { type: "text", text: `Current adjustments: ${JSON.stringify(currentAdjustments)}\n\nUser request: ${prompt}` },
                { type: "image_url", image_url: { url: imageBase64 } }
            ]
        }
    ];
    const response = await fetch(GROK_API_URL, {
        method: 'POST',
        headers: {
            'Authorization': `Bearer ${apiKey}`,
            'Content-Type': 'application/json'
        },
        body: JSON.stringify({
            model: "grok-2-vision", // or latest vision model
            messages,
            temperature: 0.3,
            max_tokens: 500,
            response_format: { type: "json_object" } // if supported
        })
    });
    if (!response.ok) {
        throw new Error(`Grok API error: ${response.status}`);
    }
    const data = await response.json();
    const content = data.choices?.[0]?.message?.content;
    try {
        return JSON.parse(content);
    }
    catch {
        // Fallback parsing if not perfect JSON
        return { notes: content };
    }
}
// Helper to capture current canvas as base64 (used for vision)
export function captureCurrentImageBase64() {
    const canvas = document.querySelector('canvas');
    if (!canvas)
        return '';
    return canvas.toDataURL('image/jpeg', 0.85);
}
// Tool definitions for Grok (can be sent in API calls for proper tool use)
export const AITO_GROK_TOOLS = [
    {
        type: "function",
        function: {
            name: "apply_lut_preset",
            description: "Apply a film/cinema/VSCO style LUT to the current image",
            parameters: {
                type: "object",
                properties: {
                    preset: { type: "string", enum: ["vsco-kodak-portra", "cinema-teal-orange", "film-kodak-2383"] },
                    intensity: { type: "number", minimum: 0, maximum: 1 }
                }
            }
        }
    },
    {
        type: "function",
        function: {
            name: "create_custom_lut",
            description: "Generate a new LUT look from a text description (VSCO, film, lens, cinema)",
            parameters: {
                type: "object",
                properties: {
                    description: { type: "string" },
                    baseFilm: { type: "string" }
                }
            }
        }
    },
    {
        type: "function",
        function: {
            name: "tether_capture",
            description: "Trigger a capture on the tethered local camera/device",
            parameters: { type: "object", properties: {} }
        }
    }
];
