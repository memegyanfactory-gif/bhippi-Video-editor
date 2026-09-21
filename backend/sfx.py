import math
import random
import struct
import wave
from pathlib import Path

RATE = 48000
DURATIONS = {"whoosh": 1.0, "impact": 1.4, "chime": 1.6}


def synth_sfx(path: Path, kind: str, volume: float = 1.0) -> float:
    if kind not in DURATIONS or not math.isfinite(volume) or not 0 <= volume <= 4:
        raise ValueError("Invalid sound effect")
    duration = DURATIONS[kind]
    frames = round(RATE * duration)
    randomizer = random.Random(7301)
    data = bytearray()
    filtered_noise = 0.0
    phase = 0.0
    for index in range(frames):
        time = index / RATE
        position = time / duration
        attack = min(1.0, time / 0.008)
        release = min(1.0, (duration - time) / 0.025)
        noise = randomizer.uniform(-1, 1)
        filtered_noise = 0.7 * filtered_noise + 0.3 * noise
        if kind == "whoosh":
            phase += 2 * math.pi * (220 + 1600 * position) / RATE
            sample = (0.85 * filtered_noise + 0.15 * math.sin(phase)) * math.sin(math.pi * position) ** 1.5
        elif kind == "impact":
            phase += 2 * math.pi * (45 + 100 * math.exp(-12 * time)) / RATE
            sample = (0.7 * math.sin(phase) + 0.3 * noise) * math.exp(-6 * time)
        else:
            sample = (0.6 * math.sin(2 * math.pi * 880 * time) + 0.3 * math.sin(2 * math.pi * 1320 * time) + 0.1 * math.sin(2 * math.pi * 1760 * time)) * math.exp(-3 * time)
        sample *= attack * release * volume * 0.75
        data.extend(struct.pack("<h", round(max(-1, min(1, sample)) * 32767)))
    with wave.open(str(path), "wb") as writer:
        writer.setnchannels(1)
        writer.setsampwidth(2)
        writer.setframerate(RATE)
        writer.writeframes(data)
    return duration
