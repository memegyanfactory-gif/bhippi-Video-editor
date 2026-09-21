//! Shapes and masks rasterised in Rust. FFmpeg has no vector drawing, and one exact image per
//! clip (looped by the graph) is far cheaper than any per-frame filter.
//!
//! Semantics the preview mirrors: a shape's stroke is centred on its outline (SVG's default),
//! joins are mitred, and the fill is painted under the stroke. A regular polygon is inscribed in
//! the shape's box with its first corner pointing straight up. Mask feathering is a Gaussian
//! whose sigma is `feather` pixels of a 1080-pixel-tall picture.

use crate::project::{Mask, MaskShape, ShapeKind};

/// Sub-samples per pixel along each axis (4×4 anti-aliasing).
const SUB: usize = 4;
/// Longest side of any raster, in pixels.
pub const MAX_SIDE: f64 = 8192.0;

pub struct Image {
    pub width: u32,
    pub height: u32,
    /// Straight (not premultiplied) RGBA.
    pub rgba: Vec<u8>,
}

/// The x-intervals a region covers on the horizontal line at `y`, sorted and disjoint.
type Spans = Vec<(f64, f64)>;

/// How many of each pixel's `SUB`×`SUB` samples fall inside the region.
fn coverage(width: usize, height: usize, spans: impl Fn(f64) -> Spans) -> Vec<u8> {
    let mut cover = vec![0u8; width * height];
    for row in 0..height {
        for sub in 0..SUB {
            let y = row as f64 + (sub as f64 + 0.5) / SUB as f64;
            for (x0, x1) in spans(y) {
                // Sample k sits at x = (k + 0.5) / SUB.
                let first = (x0 * SUB as f64 - 0.5).ceil().max(0.0) as usize;
                let last = ((x1 * SUB as f64 - 0.5).ceil().max(0.0) as usize).min(width * SUB);
                let mut k = first;
                while k < last {
                    let index = row * width + k / SUB;
                    if k % SUB == 0 && k + SUB <= last {
                        cover[index] += SUB as u8;
                        k += SUB;
                    } else {
                        cover[index] += 1;
                        k += 1;
                    }
                }
            }
        }
    }
    cover
}

fn rounded_rect(cx: f64, cy: f64, hw: f64, hh: f64, radius: f64) -> impl Fn(f64) -> Spans {
    move |y| {
        let dy = (y - cy).abs();
        if hw <= 0.0 || hh <= 0.0 || dy >= hh {
            return Vec::new();
        }
        let r = radius.min(hw).min(hh).max(0.0);
        let half = if dy <= hh - r {
            hw
        } else {
            let d = dy - (hh - r);
            hw - r + (r * r - d * d).max(0.0).sqrt()
        };
        vec![(cx - half, cx + half)]
    }
}

fn ellipse(cx: f64, cy: f64, a: f64, b: f64) -> impl Fn(f64) -> Spans {
    move |y| {
        let dy = (y - cy).abs();
        if a <= 0.0 || b <= 0.0 || dy >= b {
            return Vec::new();
        }
        let half = a * (1.0 - (dy / b).powi(2)).max(0.0).sqrt();
        vec![(cx - half, cx + half)]
    }
}

/// Any simple or self-intersecting polygon, filled even-odd.
fn polygon(points: Vec<(f64, f64)>) -> impl Fn(f64) -> Spans {
    move |y| {
        let mut crossings: Vec<f64> = Vec::new();
        for (index, p) in points.iter().enumerate() {
            let q = points[(index + 1) % points.len()];
            if (p.1 <= y) != (q.1 <= y) {
                crossings.push(p.0 + (y - p.1) * (q.0 - p.0) / (q.1 - p.1));
            }
        }
        crossings.sort_by(f64::total_cmp);
        crossings.chunks_exact(2).map(|pair| (pair[0], pair[1])).collect()
    }
}

/// Corners of a regular polygon inscribed in the box, the first pointing up.
fn regular(cx: f64, cy: f64, hw: f64, hh: f64, sides: u32) -> Vec<(f64, f64)> {
    let sides = sides.clamp(3, 64);
    (0..sides)
        .map(|k| {
            let angle = -std::f64::consts::FRAC_PI_2 + std::f64::consts::TAU * f64::from(k) / f64::from(sides);
            (cx + hw * angle.cos(), cy + hh * angle.sin())
        })
        .collect()
}

/// A convex polygon grown (positive) or shrunk (negative) by `distance`, with mitred corners;
/// `None` when shrinking swallows it.
fn offset_convex(points: &[(f64, f64)], distance: f64) -> Option<Vec<(f64, f64)>> {
    let n = points.len();
    if n < 3 {
        return None;
    }
    let centre = points.iter().fold((0.0, 0.0), |acc, p| (acc.0 + p.0 / n as f64, acc.1 + p.1 / n as f64));
    let mut lines = Vec::with_capacity(n);
    for index in 0..n {
        let (p, q) = (points[index], points[(index + 1) % n]);
        let length = (q.0 - p.0).hypot(q.1 - p.1);
        if length < 1e-9 {
            continue;
        }
        let d = ((q.0 - p.0) / length, (q.1 - p.1) / length);
        let mut normal = (d.1, -d.0);
        let mid = ((p.0 + q.0) / 2.0 - centre.0, (p.1 + q.1) / 2.0 - centre.1);
        let inradius = normal.0 * mid.0 + normal.1 * mid.1;
        if inradius < 0.0 {
            normal = (-normal.0, -normal.1);
        }
        if distance < 0.0 && inradius.abs() <= -distance {
            return None;
        }
        lines.push(((p.0 + normal.0 * distance, p.1 + normal.1 * distance), d));
    }
    let count = lines.len();
    if count < 3 {
        return None;
    }
    Some(
        (0..count)
            .map(|index| {
                let (p1, d1) = lines[(index + count - 1) % count];
                let (p2, d2) = lines[index];
                let cross = d1.0 * d2.1 - d1.1 * d2.0;
                if cross.abs() < 1e-9 {
                    p2
                } else {
                    let t = ((p2.0 - p1.0) * d2.1 - (p2.1 - p1.1) * d2.0) / cross;
                    (p1.0 + d1.0 * t, p1.1 + d1.1 * t)
                }
            })
            .collect(),
    )
}

fn rgb(color: &str) -> [f64; 3] {
    let channel = |range: std::ops::Range<usize>| color.get(range).and_then(|hex| u8::from_str_radix(hex, 16).ok()).map_or(255.0, f64::from);
    [channel(1..3), channel(3..5), channel(5..7)]
}

/// A drawn shape of `width`×`height` pixels, centred in an image padded to hold its stroke.
#[allow(clippy::too_many_arguments)]
pub fn shape(kind: ShapeKind, sides: u32, fill: Option<&str>, stroke: Option<&str>, stroke_width: f64, width: f64, height: f64, radius: f64) -> Option<Image> {
    let stroke = stroke.filter(|_| stroke_width > 0.0);
    let half_stroke = if stroke.is_some() { stroke_width / 2.0 } else { 0.0 };
    if fill.is_none() && stroke.is_none() {
        return None;
    }
    let pad = half_stroke + 1.0;
    let w = (width.max(0.0) + 2.0 * pad).ceil().min(MAX_SIDE) as usize;
    let h = (height.max(0.0) + 2.0 * pad).ceil().min(MAX_SIDE) as usize;
    let (cx, cy, hw, hh) = (w as f64 / 2.0, h as f64 / 2.0, width.max(0.0) / 2.0, height.max(0.0) / 2.0);
    let region = |grow: f64| -> Vec<u8> {
        match kind {
            ShapeKind::Rectangle => {
                let r = if radius > 0.0 { (radius + grow).max(0.0) } else { 0.0 };
                coverage(w, h, rounded_rect(cx, cy, hw + grow, hh + grow, r))
            }
            ShapeKind::Ellipse => coverage(w, h, ellipse(cx, cy, hw + grow, hh + grow)),
            ShapeKind::Polygon => {
                let corners = regular(cx, cy, hw, hh, sides);
                let grown = if grow == 0.0 { Some(corners) } else { offset_convex(&corners, grow) };
                grown.map_or_else(|| vec![0; w * h], |points| coverage(w, h, polygon(points)))
            }
        }
    };
    let fill_cover = fill.map(|_| region(0.0));
    let stroke_cover = stroke.map(|_| {
        let (outer, inner) = (region(half_stroke), region(-half_stroke));
        outer.iter().zip(inner).map(|(o, i)| o.saturating_sub(i)).collect::<Vec<u8>>()
    });
    let full = (SUB * SUB) as f64;
    let (fill_rgb, stroke_rgb) = (fill.map(rgb).unwrap_or_default(), stroke.map(rgb).unwrap_or_default());
    let mut rgba = vec![0u8; w * h * 4];
    for index in 0..w * h {
        let cf = fill_cover.as_ref().map_or(0.0, |cover| f64::from(cover[index]) / full);
        let cs = stroke_cover.as_ref().map_or(0.0, |cover| f64::from(cover[index]) / full);
        let alpha = cs + cf * (1.0 - cs);
        if alpha <= 0.0 {
            continue;
        }
        let pixel = &mut rgba[index * 4..index * 4 + 4];
        for channel in 0..3 {
            pixel[channel] = ((stroke_rgb[channel] * cs + fill_rgb[channel] * cf * (1.0 - cs)) / alpha).round().clamp(0.0, 255.0) as u8;
        }
        pixel[3] = (alpha * 255.0).round() as u8;
    }
    Some(Image { width: w as u32, height: h as u32, rgba })
}

/// A grayscale matte (255 = keep) for `mask` over a `width`×`height` picture.
pub fn mask(mask: &Mask, width: u32, height: u32) -> Vec<u8> {
    let (w, h) = (width.max(1) as usize, height.max(1) as usize);
    let (fw, fh) = (w as f64, h as f64);
    let (x0, x1) = (mask.x.min(mask.x + mask.width) * fw, mask.x.max(mask.x + mask.width) * fw);
    let (y0, y1) = (mask.y.min(mask.y + mask.height) * fh, mask.y.max(mask.y + mask.height) * fh);
    let (cx, cy, hw, hh) = ((x0 + x1) / 2.0, (y0 + y1) / 2.0, (x1 - x0) / 2.0, (y1 - y0) / 2.0);
    let cover = match mask.shape {
        MaskShape::Rectangle => coverage(w, h, rounded_rect(cx, cy, hw, hh, 0.0)),
        MaskShape::Ellipse => coverage(w, h, ellipse(cx, cy, hw, hh)),
        MaskShape::Polygon if mask.points.len() >= 3 => coverage(w, h, polygon(mask.points.iter().map(|p| (p[0] * fw, p[1] * fh)).collect())),
        MaskShape::Polygon => vec![0; w * h],
    };
    let full = (SUB * SUB) as f32;
    let mut values: Vec<f32> = cover.iter().map(|c| f32::from(*c) * 255.0 / full).collect();
    let sigma = mask.feather.max(0.0) * fh / 1080.0;
    if sigma >= 0.3 {
        // Three box passes approximate a Gaussian in time independent of its size.
        let radius = (((4.0 * sigma * sigma + 1.0).sqrt() - 1.0) / 2.0).round().max(1.0) as usize;
        for _ in 0..3 {
            box_blur(&mut values, w, h, radius);
        }
    }
    values
        .into_iter()
        .map(|value| {
            let value = value.round().clamp(0.0, 255.0) as u8;
            if mask.inverted { 255 - value } else { value }
        })
        .collect()
}

/// A separable box blur with clamped edges.
fn box_blur(values: &mut [f32], w: usize, h: usize, radius: usize) {
    let window = (2 * radius + 1) as f32;
    let mut line = Vec::new();
    for pass in 0..2 {
        let (outer, inner) = if pass == 0 { (h, w) } else { (w, h) };
        for o in 0..outer {
            let at = |i: usize| if pass == 0 { o * w + i } else { i * w + o };
            line.clear();
            line.extend((0..inner).map(|i| values[at(i)]));
            let sample = |i: isize| line[i.clamp(0, inner as isize - 1) as usize];
            let mut sum: f32 = (-(radius as isize)..=radius as isize).map(sample).sum();
            for i in 0..inner {
                values[at(i)] = sum / window;
                sum += sample(i as isize + radius as isize + 1) - sample(i as isize - radius as isize);
            }
        }
    }
}

/// A binary PAM FFmpeg reads with alpha.
pub fn pam(image: &Image) -> Vec<u8> {
    let mut out = format!("P7\nWIDTH {}\nHEIGHT {}\nDEPTH 4\nMAXVAL 255\nTUPLTYPE RGB_ALPHA\nENDHDR\n", image.width, image.height).into_bytes();
    out.extend_from_slice(&image.rgba);
    out
}

/// A binary 8-bit PGM.
pub fn pgm(width: u32, height: u32, gray: &[u8]) -> Vec<u8> {
    let mut out = format!("P5\n{width} {height}\n255\n").into_bytes();
    out.extend_from_slice(gray);
    out
}

#[cfg(test)]
mod tests {
    use super::{mask, shape};
    use crate::project::{Mask, MaskShape, ShapeKind};

    fn alpha(image: &super::Image, x: u32, y: u32) -> u8 {
        image.rgba[((y * image.width + x) * 4 + 3) as usize]
    }

    #[test]
    fn a_filled_rectangle_covers_its_box_with_soft_edges_only_at_the_border() {
        let image = shape(ShapeKind::Rectangle, 4, Some("#FF0000"), None, 0.0, 10.0, 6.0, 0.0).expect("shape");
        assert_eq!((image.width, image.height), (12, 8));
        assert_eq!(alpha(&image, 6, 4), 255);
        assert_eq!(alpha(&image, 0, 0), 0);
        assert_eq!(&image.rgba[(4 * 12 + 6) * 4..(4 * 12 + 6) * 4 + 3], &[255, 0, 0]);
    }

    #[test]
    fn a_stroke_is_centred_on_the_outline_and_painted_over_the_fill() {
        let image = shape(ShapeKind::Ellipse, 4, Some("#0000FF"), Some("#FFFFFF"), 4.0, 40.0, 40.0, 0.0).expect("shape");
        let centre = image.width / 2;
        assert_eq!(alpha(&image, centre, centre), 255);
        let edge = ((centre - 20) * image.width + centre) as usize * 4;
        assert_eq!(&image.rgba[edge..edge + 3], &[255, 255, 255], "the outline itself is stroke-coloured");
        let inside = ((centre - 10) * image.width + centre) as usize * 4;
        assert_eq!(&image.rgba[inside..inside + 3], &[0, 0, 255]);
    }

    #[test]
    fn a_polygon_points_up_and_nothing_to_draw_is_none() {
        let image = shape(ShapeKind::Polygon, 3, Some("#FFFFFF"), None, 0.0, 100.0, 100.0, 0.0).expect("triangle");
        let top_row_alpha: u32 = (0..image.width).map(|x| u32::from(alpha(&image, x, 3))).sum();
        let low_row_alpha: u32 = (0..image.width).map(|x| u32::from(alpha(&image, x, 70))).sum();
        assert!(top_row_alpha > 0 && top_row_alpha < low_row_alpha, "narrow at the top, wide lower down");
        assert!(shape(ShapeKind::Rectangle, 4, None, None, 0.0, 10.0, 10.0, 0.0).is_none());
    }

    #[test]
    fn masks_cover_their_fraction_invert_and_feather() {
        let base = Mask { shape: MaskShape::Rectangle, x: 0.5, y: 0.0, width: 0.5, height: 1.0, points: Vec::new(), feather: 0.0, inverted: false };
        let matte = mask(&base, 100, 50);
        assert_eq!((matte[25 * 100 + 10], matte[25 * 100 + 90]), (0, 255));
        let inverted = mask(&Mask { inverted: true, ..base.clone() }, 100, 50);
        assert_eq!((inverted[25 * 100 + 10], inverted[25 * 100 + 90]), (255, 0));
        let soft = mask(&Mask { feather: 200.0, ..base }, 100, 50);
        assert!(soft[25 * 100 + 48] > 20 && soft[25 * 100 + 52] < 235, "the edge is soft");
        let pen = Mask { shape: MaskShape::Polygon, x: 0.0, y: 0.0, width: 1.0, height: 1.0, points: vec![[0.0, 0.0], [1.0, 0.0], [0.0, 1.0]], feather: 0.0, inverted: false };
        let triangle = mask(&pen, 100, 100);
        assert_eq!((triangle[10 * 100 + 10], triangle[90 * 100 + 90]), (255, 0));
    }
}
