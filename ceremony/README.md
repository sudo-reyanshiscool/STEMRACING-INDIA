# STEM Racing India National Finals 2026 awards ceremony

A single offline HTML presentation. Fonts, logo, shapes, gradients and patterns are in `assets/`, copied unmodified from the brand pack.

## Run

```
python3 -m http.server 5180 -d ceremony
# open http://localhost:5180 in Chrome, then press F for full screen
```

Opening `index.html` directly from disk also works.

## Keys

| Key | Action |
| --- | --- |
| Right, Down, Space, PageDown, Enter | Next (reveals nominees one per press, skips a running animation) |
| Left, Up, PageUp, Backspace | Back |
| Home, End | First, last scene |
| F | Full screen |
| B | Blackout |
| E | Results desk |
| S | Presenter view (second window) |

## Results

The deck currently loads made up sample teams, schools and results so you can see the look. Open the results desk (E), choose Clear everything, then enter the real nominees, winners, schools, figures and citations. Data saves in the browser and can be exported and imported as JSON.
