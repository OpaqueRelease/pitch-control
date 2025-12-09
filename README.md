## Interactive Football Pitch Control

An interactive football (soccer) **pitch control** visualization.  
Two teams of eleven players (blue vs red) are represented by draggable circles.  
The entire pitch is colored red or blue according to **which player is closest to each part of the pitch** – effectively a Voronoi-style control map.

### Features

- **22 draggable players**: 11 blue and 11 red, starting in mirrored 4‑4‑2 formations.
- **Pitch control coloring**: Every area of the pitch is tinted toward the team whose player is closest.
- **Responsive canvas**: Scales with the viewport while preserving pitch aspect ratio.
- **Nice visual styling**: Modern dark UI chrome with a realistic green pitch, mowing stripes, lines, and glow on players.

### Getting started

#### Option 1 – Just open the file

1. Open `index.html` in a modern browser (Chrome, Edge, Firefox, Safari).
2. Drag the blue and red circles around.
3. Watch how the colored regions of the pitch change as players move.

> Note: Some browsers are stricter with file:// URLs. If anything looks off, try Option 2.

#### Option 2 – Run a tiny static server (recommended)

From the project root:

```bash
cd /Users/timen/Desktop/pitch-control
npm install
npm run start
```

Then open the URL printed in the terminal (typically `http://localhost:3000` or `http://localhost:5000` depending on `serve`).

The `start` script uses `npx serve .` to host the current directory as a static site.

### How it works (high level)

- The pitch is drawn on a single `<canvas>`:
  - Green gradient background + mowing stripes.
  - Standard markings (halfway line, centre circle, penalty boxes, etc.).
- Players are stored in logical pitch coordinates (based loosely on 105 x 68 m).
- For the control map:
  - A regular grid across the pitch is sampled (not every physical pixel, for performance).
  - For each grid cell, the **nearest player** is found by Euclidean distance.
  - That cell is filled with a semi‑transparent blue or red color, producing team regions.
- Mouse and touch events let you drag players, which recomputes and redraws the control map on each move.

### Customisation ideas

- Tweak `GRID_STEP` in `main.js`:
  - Smaller values → smoother control map but more CPU work.
  - Larger values → blockier map but faster.
- Change formations or initial positions in `initPlayers()` in `main.js`.
- Add labels (player numbers or names) on top of the circles.
- Record and replay sequences of positions over time to simulate real matches.


