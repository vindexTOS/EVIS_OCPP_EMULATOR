# EVIS OCPP Emulator — UI

React, Vite and Mantine. What the emulator does and how to use it is in the
[main README](../README.md).

```bash
yarn install
yarn dev       # http://localhost:5173
yarn lint
yarn build
```

The UI expects the backend on `http://localhost:3000`. To point it elsewhere:

```bash
VITE_API_URL=http://my-host:3000/api VITE_WS_URL=http://my-host:3000 yarn dev
```

## Where things are

| Path | What it is |
| --- | --- |
| `src/station/` | The station page: the charger scene, the bays, the cables, the garage dock |
| `src/station/tabs/` | History, OCPP log, Configuration, Advanced and Settings of a charger |
| `src/pages/` | The Garage and History pages |
| `src/components/` | Forms, the car drawing, the plug icons, the charts |
| `src/dnd/` | Drag and drop on pointer events |
| `src/lib/` | API client, types, the live link to the backend, formatting |
| `src/styles/` | Design tokens (`tokens.css`) and the styles built on them |

## Notes

- The lists of chargers, cars and cards are fetched once; after that the backend
  pushes every change over Socket.IO (`src/lib/live.tsx`).
- Colours, including the chart series, are defined once in
  `src/styles/tokens.css` for the dark and the light theme.
- The cables are an SVG overlay drawn from measured positions
  (`src/station/Scene.tsx`), so they follow the layout at any width.
