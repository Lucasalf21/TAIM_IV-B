# IV-3 — Box-plot series (prototype)

## How to run

The data is loaded with `d3.csv`, so the page must be opened through a local server (not by double-clicking the file).

```bash
# from the repository root
python -m http.server
```

Then open `http://localhost:8000/IV-3/index.html`.

## Changing the episode

In `index.html`, change this line in the script (E01 to E20):

```js
var chosenEpisode = "E10";
```