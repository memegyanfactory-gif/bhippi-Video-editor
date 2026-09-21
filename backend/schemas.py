from typing import Annotated, Literal

from pydantic import BaseModel, ConfigDict, Field, model_validator

Time = Annotated[float, Field(ge=0, le=86400, allow_inf_nan=False)]
Volume = Annotated[float, Field(ge=0, le=4, allow_inf_nan=False)]
Identifier = Annotated[str, Field(pattern=r"^[a-f0-9]{32}$")]
Preset = Literal["kinetic", "title", "lower-third", "caption"]
Aspect = Literal["16:9", "9:16", "1:1"]
SoundKind = Literal["whoosh", "impact", "chime"]
WhisperModel = Literal["base", "small", "medium"]


class StrictModel(BaseModel):
    model_config = ConfigDict(extra="forbid", populate_by_name=True)


class Asset(StrictModel):
    id: Identifier
    name: str
    kind: Literal["video", "audio"]
    duration: Time
    width: int
    height: int
    url: str
    thumbnail: str | None = None
    hasAudio: bool


class Clip(StrictModel):
    id: str = Field(max_length=128)
    assetId: Identifier
    in_: Time = Field(alias="in")
    out: Time
    volume: Volume = 1

    @model_validator(mode="after")
    def ordered(self):
        if self.out <= self.in_:
            raise ValueError("Clip out must exceed in")
        return self


class Graphic(StrictModel):
    id: str = Field(max_length=128)
    text: str = Field(max_length=500)
    subtitle: str = Field(default="", max_length=500)
    start: Time
    duration: float = Field(gt=0, le=86400, allow_inf_nan=False)
    preset: Preset
    color: str = Field(pattern=r"^#[0-9a-fA-F]{6}$")


class Sound(StrictModel):
    id: str = Field(max_length=128)
    kind: SoundKind
    start: Time
    volume: Volume = 1


class Word(StrictModel):
    start: Time
    end: Time
    word: str = Field(max_length=1000)


class Segment(StrictModel):
    start: Time
    end: Time
    text: str = Field(max_length=10000)
    words: list[Word] | None = Field(default=None, max_length=5000)

    @model_validator(mode="after")
    def ordered(self):
        if self.end < self.start:
            raise ValueError("Segment end precedes start")
        return self


class Transcript(StrictModel):
    assetId: Identifier
    language: str = Field(max_length=32)
    segments: list[Segment] = Field(max_length=20000)


class Project(StrictModel):
    version: Literal[1] = 1
    name: str = Field(default="Untitled story", max_length=256)
    aspect: Aspect = "16:9"
    clips: list[Clip] = Field(default_factory=list, max_length=200)
    graphics: list[Graphic] = Field(default_factory=list, max_length=200)
    sounds: list[Sound] = Field(default_factory=list, max_length=200)
    transcripts: list[Transcript] = Field(default_factory=list, max_length=200)


class ChatAction(StrictModel):
    type: Literal["add_graphic", "split", "set_aspect", "add_sfx"]
    text: str | None = Field(default=None, max_length=500)
    preset: Preset | None = None
    color: str | None = Field(default=None, pattern=r"^#[0-9a-fA-F]{6}$")
    time: Time | None = None
    duration: float | None = Field(default=None, gt=0, le=86400, allow_inf_nan=False)
    aspect: Aspect | None = None
    kind: SoundKind | None = None

    @model_validator(mode="after")
    def required_fields(self):
        required = {"add_graphic": ("text", "preset", "time", "duration", "color"), "split": ("time",), "set_aspect": ("aspect",), "add_sfx": ("kind", "time")}
        allowed = {"type", *required[self.type]}
        if any(getattr(self, key) is None for key in required[self.type]):
            raise ValueError("Action is missing required fields")
        if any(value is not None and key not in allowed for key, value in self.model_dump().items()):
            raise ValueError("Action contains unrelated fields")
        return self


class ChatReply(StrictModel):
    reply: str = Field(max_length=8000)
    actions: list[ChatAction] = Field(default_factory=list, max_length=20)
    source: str


class TranscribeRequest(StrictModel):
    assetId: Identifier
    language: Literal["auto", "hi", "en"] = "auto"
    model: WhisperModel = "base"


class ModelRequest(StrictModel):
    model: WhisperModel


class AnalyzeRequest(StrictModel):
    assetId: Identifier
    model: str = Field(min_length=1, max_length=128)


class HistoryItem(StrictModel):
    role: Literal["user", "assistant"]
    content: str = Field(max_length=8000)


class ChatRequest(StrictModel):
    message: str = Field(min_length=1, max_length=8000)
    model: str = Field(default="", max_length=128)
    project: Project = Field(default_factory=Project)
    history: list[HistoryItem] = Field(default_factory=list, max_length=40)


class HooksRequest(StrictModel):
    assetId: Identifier
    segments: list[Segment] = Field(max_length=20000)


class ExportRequest(StrictModel):
    project: Project


class MemoryRequest(StrictModel):
    text: str = Field(min_length=1, max_length=2000)
