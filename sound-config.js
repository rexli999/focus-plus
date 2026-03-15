window.FOCUS_PLUS_SOUND_CONFIG = {
  sounds: {
    // Louder values like 1.2 or 1.5 are allowed.
    timerComplete: {
      file: "click_sound/timer_alarm.wav",
      volume: 1.15
    },

    timerModeButton: {
      file: "click_sound/click_sound4.wav",
      volume: 0.55
    },

    timerStartPause: {
      file: "click_sound/click_sound4.wav",
      volume: 0.65
    },

    timerReset: {
      file: "click_sound/click_sound4.wav",
      volume: 0.48
    },

    timerSkip: {
      file: "click_sound/click_sound4.wav",
      volume: 0.56
    },

    checklistChecked: {
      file: "click_sound/cheerful_check_check1.wav",
      volume: 0.72
    },

    // Leave "file" empty to use the synth fallback instead.
    checklistUnchecked: {
      file: "",
      volume: 0.85,
      synth: {
        type: "triangle",
        startFreq: 560,
        endFreq: 400,
        duration: 0.08,
        peakGain: 0.08
      }
    },

    // Point this at another sound name if you want the slider preview to use a different sound.
    volumePreview: {
      alias: "timerComplete"
    }
  }
};
