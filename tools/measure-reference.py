"""Measure the Codex/ChatGPT power-slider screenshot.

Outputs, as facts rather than impressions:
  - the track's bounding box, height and corner radius estimate;
  - the knob's diameter and its centre;
  - the gradient's colour at several positions along the track.

Run: python tools/measure-reference.py <image.png>
"""
import sys
from PIL import Image

path = sys.argv[1]
image = Image.open(path).convert("RGB")
width, height = image.size
pixels = image.load()
print(f"image: {width}x{height}")


def saturation(pixel):
    high = max(pixel)
    low = min(pixel)
    return 0 if high == 0 else (high - low) / high


# --- 1. the track: rows whose saturated-pixel count spikes ------------------
rows = []
for y in range(height):
    count = sum(1 for x in range(width) if saturation(pixels[x, y]) > 0.45)
    rows.append(count)

peak = max(rows)
track_rows = [y for y, count in enumerate(rows) if count > peak * 0.6]
print(f"saturated rows: peak={peak}, track rows {track_rows[0]}..{track_rows[-1]} (height {track_rows[-1] - track_rows[0] + 1})")

# --- 2. the track: horizontal extent on its middle row ----------------------
mid_y = (track_rows[0] + track_rows[-1]) // 2
columns = [x for x in range(width) if saturation(pixels[x, mid_y]) > 0.35]
print(f"track middle row y={mid_y}: x {columns[0]}..{columns[-1]} (width {columns[-1] - columns[0] + 1})")

# --- 3. the knob: a bright, nearly desaturated disc -------------------------
def is_knob(pixel):
    return min(pixel) > 225 and saturation(pixel) < 0.06

knob_columns = [x for x in range(width) if is_knob(pixels[x, mid_y])]
if knob_columns:
    left, right = knob_columns[0], knob_columns[-1]
    cx = (left + right) // 2
    knob_rows = [y for y in range(height) if is_knob(pixels[cx, y])]
    print(f"knob: x {left}..{right} (diameter {right - left + 1}), y {knob_rows[0]}..{knob_rows[-1]} (diameter {knob_rows[-1] - knob_rows[0] + 1})")
    print(f"knob centre: ({cx}, {(knob_rows[0] + knob_rows[-1]) // 2})")
else:
    print("knob: not found on the middle row")

# --- 4. the gradient: sample along the track, avoiding the knob -------------
x0, x1 = columns[0], columns[-1]
if knob_columns:
    x1 = min(x1, knob_columns[0] - 6)
print("gradient samples (fraction -> RGB -> hex):")
for fraction in (0.0, 0.15, 0.3, 0.45, 0.6, 0.75, 0.9, 1.0):
    x = int(x0 + (x1 - x0) * fraction)
    pixel = pixels[x, mid_y]
    print(f"  x={x:4d} ({fraction:4.2f})  rgb{pixel}  #{pixel[0]:02x}{pixel[1]:02x}{pixel[2]:02x}")

# --- 5. the label above the bar --------------------------------------------
top_rows = range(0, max(0, track_rows[0] - 4))
label_pixels = []
for y in top_rows:
    for x in range(width):
        if saturation(pixels[x, y]) > 0.35:
            label_pixels.append((x, y, pixels[x, y]))
if label_pixels:
    ys = [p[1] for p in label_pixels]
    xs = [p[0] for p in label_pixels]
    print(f"coloured label pixels above the track: {len(label_pixels)}, y {min(ys)}..{max(ys)}, x {min(xs)}..{max(xs)}")
    distinct = sorted({p[2] for p in label_pixels})
    print(f"  label colours: {['#%02x%02x%02x' % c for c in distinct[:6]]}")
else:
    print("no coloured label pixels above the track")
