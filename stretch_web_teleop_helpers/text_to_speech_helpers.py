# Standard imports
from abc import ABC, abstractmethod
from enum import Enum
from io import BytesIO
from typing import List, Optional

# Third-party imports
import pyttsx3
import simpleaudio
import sounddevice  # suppress ALSA warnings # noqa: F401
from gtts import gTTS
from pydub import AudioSegment
from pydub.utils import ratio_to_db
from rclpy.impl.rcutils_logger import RcutilsLogger


class TextToSpeechEngineType(Enum):
    """
    The TextToSpeechEngineType class enumerates the possible text-to-speech
    engines.
    """

    PYTTSX3 = 1
    GTTS = 2


class TextToSpeechEngine(ABC):
    """
    Abstract base class for a text-to-speech engine that supports:
      - Setting the voice ID.
      - Setting the speed to default or slow.
      - Asynchronously speaking text.
      - Interrupting speech.
    """

    def __init__(self, logger: RcutilsLogger):
        """
        Initialize the text-to-speech engine.

        Parameters
        ----------
        logger : Logger
            The logger to use for logging messages.
        """
        self._logger = logger
        self._voice_ids: List[str] = []
        self._voice_id = ""
        self._is_slow = False

        # Whether or not this engine can speak asynchronously or not.
        self._can_say_async = False

    @property
    def voice_ids(self) -> List[str]:
        """
        Get the list of voice IDs available for the text-to-speech engine.
        """
        return self._voice_ids

    @property
    def voice_id(self) -> str:
        """
        Get the current voice ID for the text-to-speech engine.
        """
        return self._voice_id

    @voice_id.setter
    def voice_id(self, voice_id: str) -> None:
        """
        Set the current voice ID for the text-to-speech engine.
        """
        if voice_id in self._voice_ids:
            self._voice_id = voice_id
        else:
            self._logger.error(f"Invalid voice ID: {voice_id}")

    @property
    def is_slow(self) -> bool:
        """
        Get whether the text-to-speech engine is set to speak slowly.
        """
        return self._is_slow

    @is_slow.setter
    def is_slow(self, is_slow: bool):
        """
        Set whether the text-to-speech engine is set to speak slowly.
        """
        self._is_slow = is_slow

    @abstractmethod
    def say_async(self, text: str):
        """
        Speak the given text asynchronously.
        """
        raise NotImplementedError

    @abstractmethod
    def is_speaking(self) -> bool:
        """
        Return whether the text-to-speech engine is currently speaking.
        """
        raise NotImplementedError

    @abstractmethod
    def say(self, text: str):
        """
        Speak the given text synchronously.
        """
        raise NotImplementedError

    @abstractmethod
    def stop(self):
        """
        Stop speaking the current text.
        """
        raise NotImplementedError


class PyTTSx3(TextToSpeechEngine):
    """
    Text-to-speech engine using pyttsx3. A big benefit of pyttsx3 compared
    to other enginers is that it runs offline. However, its Linux voices tend
    to be less natural than other engines.
    """

    def __init__(self, logger: RcutilsLogger):
        """
        Initialize the text-to-speech engine.

        Parameters
        ----------
        logger : Logger
            The logger to use for logging messages.
        """
        super().__init__(logger)
        self._engine = pyttsx3.init()

        # Initialize the voices
        voices = self._engine.getProperty("voices")
        # Variants documentation: https://espeak.sourceforge.net/languages.html
        variants = [
            "m1",
            "m2",
            "m3",
            "m4",
            "m5",
            "m6",
            "m7",
            "f1",
            "f2",
            "f3",
            "f4",
            "croak",
            "whisper",
        ]
        for voice in voices:
            self._voice_ids.append(voice.id)
            for variant in variants:
                self._voice_ids.append(voice.id + "+" + variant)
        self.voice_id = "default"

        # Initialize the speeds
        self.slow_speed = 100  # wpm
        self.default_speed = 150  # wpm

    @TextToSpeechEngine.voice_id.setter  # type: ignore
    def voice_id(self, voice_id: str) -> None:
        """
        Set the current voice ID for the text-to-speech engine.
        """
        self._voice_id = voice_id
        self._engine.setProperty("voice", voice_id)

    @TextToSpeechEngine.is_slow.setter  # type: ignore
    def is_slow(self, is_slow: bool):
        """
        Set whether the text-to-speech engine is set to speak slowly.
        """
        self._is_slow = is_slow
        if is_slow:
            self._engine.setProperty("rate", self.slow_speed)
        else:
            self._engine.setProperty("rate", self.default_speed)

    def say_async(self, text: str):
        """
        Speak the given text asynchronously.
        """
        self._logger.warn(
            "Asynchronous speaking is not supported for PyTTSx3 on Linux."
        )

    def is_speaking(self) -> bool:
        """
        Return whether the text-to-speech engine is currently speaking.
        """
        # Because asynchronous speaking is not supported in pyttsxy on Linux,
        # if this function is called, it is assumed that the engine is not speaking.
        # This works as long as `is_speaking` and `say` will be called from
        # the same thread.
        return False

    def say(self, text: str):
        """
        Speak the given text synchronously.
        """
        self._engine.say(text)
        self._engine.runAndWait()

    def stop(self):
        """
        Stop speaking the current text.
        """
        # Although interruptions are nominally supported in pyttsx3
        # (https://pyttsx3.readthedocs.io/en/latest/engine.html#examples),
        # in practice, the Linux implementation spins of an ffmpeg process
        # which can't be interrupted in its current implementation:
        # https://github.com/nateshmbhat/pyttsx3/blob/5d3755b060a980f48fcaf81df018dd06cbd17a8f/pyttsx3/drivers/espeak.py#L175 # noqa: E501
        self._logger.warn(
            "Asynchronous stopping is not supported for PyTTSx3 on Linux."
        )


class GTTS(TextToSpeechEngine):
    """
    Text-to-speech engine using gTTS.
    """

    def __init__(self, logger: RcutilsLogger):
        """
        Initialize the text-to-speech engine.

        Parameters
        ----------
        logger : Logger
            The logger to use for logging messages.
        """
        super().__init__(logger)
        self._can_say_async = True

        # Initialize the voices.
        # https://gtts.readthedocs.io/en/latest/module.html#gtts.lang.tts_langs
        self._voice_ids = [
            "com",  # Default
            "us",  # United States
            "com.au",  # Australia
            "co.uk",  # United Kingdom
            "ca",  # Canada
            "co.in",  # India
            "ie",  # Ireland
            "co.za",  # South Africa
            "com.ng",  # Nigeria
        ]
        self.voice_id = "com"
        self._playback: Optional[simpleaudio.PlayObject] = None

    def __synthesize_and_play_text(self, text: str) -> simpleaudio.PlayObject:
        """
        Get the playback object for the given text.

        Parameters
        ----------
        text : str
            The text to speak.

        Returns
        -------
        simpleaudio.PlayObject
            The playback object.
        """
        tts = gTTS(text=text, lang="en", tld=self.voice_id, slow=self.is_slow)
        fp = BytesIO()
        tts.write_to_fp(fp)
        fp.seek(0)
        audio = AudioSegment.from_file(fp, format="mp3")
        # TODO: Increasing the volume to 400% should not be hardcoded; instead,
        # it should be part of the TTS message (like is_slow and the voice_id).
        audio = audio.apply_gain(ratio_to_db(4.0))
        self._playback = simpleaudio.play_buffer(
            audio.raw_data, audio.channels, audio.sample_width, audio.frame_rate
        )

    def say_async(self, text: str):
        """
        Speak the given text asynchronously.
        """
        self.__synthesize_and_play_text(text)

    def is_speaking(self) -> bool:
        """
        Return whether the text-to-speech engine is currently speaking.
        """
        if self._playback is None:
            return False
        if not self._playback.is_playing():
            self._playback = None
            return False
        return True

    def say(self, text: str):
        """
        Speak the given text synchronously.
        """
        self.__synthesize_and_play_text(text)
        self._playback.wait_done()
        self._playback = None

    def stop(self):
        """
        Stop speaking the current text.
        """
        if self._playback is not None:
            self._playback.stop()
            self._playback = None
