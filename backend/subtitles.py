import re

FONT = "Trebuchet MS"
STYLES = {
    "kinetic": {"scale": 0.085, "outline": 2, "shadow": 0, "align": 5, "marginV": 0, "wrap": 18},
    "title": {"scale": 0.11, "outline": 3, "shadow": 1, "align": 5, "marginV": 0, "wrap": 26},
    "lower-third": {"scale": 0.055, "outline": 2, "shadow": 1, "align": 1, "marginV": 70, "wrap": 40},
    "caption": {"scale": 0.05, "outline": 1, "shadow": 0, "align": 2, "marginV": 45, "wrap": 42},
}
PHASES = {
    "kinetic": (0.14, 0.62, 0.24),
    "title": (0.22, 0.50, 0.28),
    "lower-third": (0.25, 0.50, 0.25),
    "caption": (0.10, 0.80, 0.10),
}
FADE = 0.18
CENTER_EVENTS = ("kinetic", "title")


def bgr(color: str) -> str:
    red, green, blue = color[1:3], color[3:5], color[5:7]
    return f"&H00{blue}{green}{red}".upper()


def escape(value: str) -> str:
    for character in "\\{}":
        value = value.replace(character, " ")
    return value.replace("\n", "\\N").strip()


def wrap_lines(text: str, limit: int) -> list[str]:
    words = [word for word in re.split(r"\s+", text.strip()) if word]
    lines, current = [], ""
    for word in words:
        candidate = f"{current} {word}".strip()
        if current and len(candidate) > limit:
            lines.append(current)
            current = word
        else:
            current = candidate
    if current:
        lines.append(current)
    return lines


def event_timestamp(seconds: float) -> str:
    seconds = max(0.0, min(seconds, 35959.99))
    centiseconds = round(seconds * 100)
    hours, remainder = divmod(centiseconds, 360000)
    minutes, remainder = divmod(remainder, 6000)
    return f"{hours}:{minutes:02d}:{remainder // 100:02d}.{remainder % 100:02d}"


def graphic_events(graphic, width: int, height: int) -> list[str]:
    preset = graphic.preset
    settings = STYLES[preset]
    if preset == "caption":
        return [caption_event(graphic, settings)]
    if preset == "kinetic":
        return kinetic_events(graphic, settings, width, height)
    if preset == "title":
        return title_events(graphic, settings, width, height)
    return [lower_third_event(graphic, settings, width, height)]


def caption_event(graphic, settings: dict) -> str:
    start = graphic.start
    end = start + graphic.duration
    text = escape(graphic.text)
    if graphic.subtitle:
        text += f"\\N{escape(graphic.subtitle)}"
    return (
        f"Dialogue: 0,{event_timestamp(start)},{event_timestamp(end)},Helios-caption,,0,0,0,,"
        f"{{\\fad({int(FADE * 1000)},{int(FADE * 1000)})}}{text}"
    )


def title_events(graphic, settings: dict, width: int, height: int) -> list[str]:
    start = graphic.start
    duration = max(0.2, graphic.duration)
    pop = PHASES["title"][0]
    pop_duration = duration * pop
    lines = wrap_lines(escape(graphic.text), settings["wrap"])
    events = []
    base_transform = f"\\fscx60\\fscy60\\t(0,{int(pop_duration * 1000)},\\fscx100\\fscy100)"
    fade = f"\\fad({int(FADE * 1000)},{int(FADE * 1000)})"
    text = "\\N".join(lines)
    if graphic.subtitle:
        text += f"\\N{{\\fs{max(8, round(0.045 * height))}}}{escape(graphic.subtitle)}"
    events.append(
        f"Dialogue: 0,{event_timestamp(start)},{event_timestamp(start + duration)},Helios-title,,0,0,0,,"
        f"{{{fade}{base_transform}}}{text}"
    )
    return events


def kinetic_events(graphic, settings: dict, width: int, height: int) -> list[str]:
    start = graphic.start
    duration = max(0.2, graphic.duration)
    pop = PHASES["kinetic"][0]
    words = [word for word in re.split(r"\s+", escape(graphic.text)) if word]
    if not words:
        return []
    per_word = duration / len(words)
    events = []
    for index, word in enumerate(words):
        word_start = start + index * per_word
        word_end = start + duration if index == len(words) - 1 else word_start + per_word + pop * per_word
        pop_duration = min(0.25, duration * pop)
        fade = f"\\fad({int(FADE * 1000)},{int(FADE * 1000)})"
        transform = f"\\fscx55\\fscy55\\t(0,{int(pop_duration * 1000)},\\fscx100\\fscy100)"
        events.append(
            f"Dialogue: 0,{event_timestamp(word_start)},{event_timestamp(word_end)},Helios-kinetic,,0,0,0,,"
            f"{{{fade}{transform}}}{word}"
        )
    if graphic.subtitle:
        events.append(
            f"Dialogue: 1,{event_timestamp(start)},{event_timestamp(start + duration)},Helios-caption,,0,0,0,,"
            f"{{\\fad({int(FADE * 1000)},{int(FADE * 1000)})}}{escape(graphic.subtitle)}"
        )
    return events


def lower_third_event(graphic, settings: dict, width: int, height: int) -> str:
    start = graphic.start
    duration = max(0.2, graphic.duration)
    slide_duration = max(0.15, duration * PHASES["lower-third"][0])
    fade = f"\\fad({int(FADE * 1000)},{int(FADE * 1000)})"
    left = round(width * 0.06)
    baseline = height - settings["marginV"]
    move = f"\\move({width + 40},{baseline},{left},{baseline},0,{round(slide_duration * 1000)})"
    text = escape(graphic.text)
    if graphic.subtitle:
        text += f"\\N{{\\fs{max(8, round(0.035 * height))}}}{escape(graphic.subtitle)}"
    return (
        f"Dialogue: 0,{event_timestamp(start)},{event_timestamp(start + duration)},Helios-lower-third,,0,0,0,,"
        f"{{{fade}{move}}}{text}"
    )



def build_ass(project, width: int, height: int, fps: float) -> str:
    events = []
    for graphic in project.graphics:
        events.extend(graphic_events(graphic, width, height))
    header = (
        "[Script Info]\n"
        "ScriptType: v4.00+\n"
        f"PlayResX: {width}\n"
        f"PlayResY: {height}\n"
        "WrapStyle: 0\n"
        "ScaledBorderAndShadow: yes\n"
        "\n[V4+ Styles]\n"
        "Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding\n"
    )
    styles = []
    for preset, settings in STYLES.items():
        styles.append(
            f"Style: Helios-{preset},{FONT},{max(8, round(settings['scale'] * height))},"
            f"&H00FFFFFF,&H00FFFFFF,&HC8000000,&H96000000,0,0,0,0,100,100,0,0,1,"
            f"{settings['outline']},{settings['shadow']},{settings['align']},"
            f"60,60,{settings['marginV']}"
        )
    body = "\n".join(styles)
    events_header = (
        "\n\n[Events]\n"
        "Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text\n"
    )
    event_lines = "\n".join(events)
    return header + body + events_header + (event_lines + "\n" if event_lines else "")

