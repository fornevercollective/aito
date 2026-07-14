# aito_all → monorepo map

Local umbrella folder `~/dev/aito_all/` collects three apps. They are unified here for GitHub.

| Local checkout | Monorepo path |
|----------------|---------------|
| `aito_all/aito` | **this repo root** (editor + site) |
| `aito_all/aito-mac` | `spatial/` |
| `aito_all/aito-living-canvas` | `apps/living-canvas/` + `versions/living-canvas/` |

## Launch everything from one clone

```bash
git clone https://github.com/fornevercollective/aito.git
cd aito
npm install

./Launch.command              # editor :5173
./Launch-Spatial.command      # spatial booth :8768
# living canvas research:
cd apps/living-canvas && npm install && npm run dev
```

## Ports

| Port | App |
|------|-----|
| 5173 | Editor |
| 8768 | Spatial Live booth |
| 8765 | Inference WS (editor) |
| 8766 / 8767 | ZipDepth / JAX (optional spatial) |
