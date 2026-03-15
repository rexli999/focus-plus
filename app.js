(function () {
  "use strict";

  var STORAGE_KEY = "workflow-focus-state-v1";
  var APP_VERSION = "20260315-cleanup-1";
  var SHARED_STATE_API = "./api/state";
  var INITIAL_SERVER_RETRY_MS = 6000;
  var INITIAL_SERVER_RETRY_INTERVAL_MS = 250;
  var SERVER_RESYNC_INTERVAL_MS = 2000;
  var DEFAULT_DURATIONS = { focus: 25, shortBreak: 5, longBreak: 15 };
  var MODE_SEQUENCE = ["focus", "shortBreak", "focus", "shortBreak", "focus", "shortBreak", "focus", "longBreak"];
  var DEFAULT_SOUND_CONFIG = {
    sounds: {
      timerComplete: { file: "click_sound/timer_alarm.wav", volume: 1.15 },
      timerModeButton: { file: "click_sound/click_sound4.wav", volume: 0.55 },
      timerStartPause: { file: "click_sound/click_sound4.wav", volume: 0.65 },
      timerReset: { file: "click_sound/click_sound4.wav", volume: 0.48 },
      timerSkip: { file: "click_sound/click_sound4.wav", volume: 0.56 },
      checklistChecked: { file: "click_sound/cheerful_check_check1.wav", volume: 0.72 },
      checklistUnchecked: {
        file: "",
        volume: 0.85,
        synth: { type: "triangle", startFreq: 560, endFreq: 400, duration: 0.08, peakGain: 0.08 }
      },
      volumePreview: { alias: "timerComplete" }
    }
  };
  var soundConfig = normalizeSoundConfig(window.FOCUS_PLUS_SOUND_CONFIG);
  var DAY_NAMES = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
  var MIN_CALENDAR_MONTH = new Date(2026, 0, 1);
  var BACKUP_DB_NAME = "focusplus-backup-db";
  var BACKUP_DB_STORE = "app";
  var BACKUP_HANDLE_KEY = "backupDirHandle";
  var BACKUP_SUBDIR_NAME = "FocusPlus_Data";
  var BACKUP_CONFIG_FILE = "focusplus_config.json";
  var BACKUP_HISTORY_FILE = "focusplus_history.json";

  var els = {
    pages: document.querySelectorAll(".page"),
    tabBtns: document.querySelectorAll(".tab-btn"),
    appMenuButton: document.getElementById("app-menu-button"),
    appMenuPanel: document.getElementById("app-menu-panel"),
    menuTimerSettingsBtn: document.getElementById("menu-timer-settings-btn"),
    menuEditDailyBtn: document.getElementById("menu-edit-daily-btn"),
    menuEditWeeklyBtn: document.getElementById("menu-edit-weekly-btn"),
    menuFontSize: document.getElementById("menu-font-size"),
    menuSoundVolume: document.getElementById("menu-sound-volume"),
    settingAutoBackup: document.getElementById("setting-auto-backup"),
    backupControls: document.getElementById("backup-controls"),
    chooseBackupFolderBtn: document.getElementById("choose-backup-folder-btn"),
    backupStatus: document.getElementById("backup-status"),
    modeBtns: document.querySelectorAll(".mode-btn"),
    timerCard: document.querySelector(".timer-card"),
    timerDisplay: document.getElementById("timer-display"),
    startPauseBtn: document.getElementById("start-pause-btn"),
    resetBtn: document.getElementById("reset-btn"),
    skipBtn: document.getElementById("skip-btn"),
    cycleLabel: document.getElementById("cycle-label"),
    timerSettings: document.getElementById("timer-settings"),
    timerSettingsDoneBtn: document.getElementById("timer-settings-done-btn"),
    settingAutostart: document.getElementById("setting-autostart"),
    settingSound: document.getElementById("setting-sound"),
    settingNotification: document.getElementById("setting-notification"),
    notificationNote: document.getElementById("notification-note"),
    dailyChecklist: document.getElementById("daily-checklist"),
    weeklyChecklist: document.getElementById("weekly-checklist"),
    dailyEmpty: document.getElementById("daily-empty"),
    weeklyEmpty: document.getElementById("weekly-empty"),
    dailyPeriodLabel: document.getElementById("daily-period-label"),
    weeklyPeriodLabel: document.getElementById("weekly-period-label"),
    editorPanel: document.getElementById("template-editor-panel"),
    editorContainer: document.getElementById("editor-container"),
    editorList: document.getElementById("editor-list"),
    editorNewInput: document.getElementById("editor-new-input"),
    editorAddBtn: document.getElementById("editor-add-btn"),
    editorCancelBtn: document.getElementById("editor-cancel-btn"),
    editorSaveBtn: document.getElementById("editor-save-btn"),
    editorTitle: document.getElementById("template-editor-title"),
    editorSubtitle: document.getElementById("template-editor-subtitle"),
    checklistTpl: document.getElementById("checklist-item-template"),
    editorTpl: document.getElementById("editor-item-template"),
    calendarPrev: document.getElementById("calendar-prev"),
    calendarNext: document.getElementById("calendar-next"),
    calendarMonthLabel: document.getElementById("calendar-month-label"),
    calendarGrid: document.getElementById("calendar-grid")
  };

  var state = normalizeState(null);
  var view = {
    page: "focus",
    calendarMonth: clampCalendarMonth(new Date()),
    editorType: null,
    editorDraft: [],
    editorArchived: [],
    editorDirty: false
  };
  var timer = {
    running: false,
    startedAtMs: 0,
    durationMs: 0,
    remainingMs: 0,
    lastDayKey: todayKey(),
    lastWeekKey: currentWeekKey()
  };
  var backupRuntime = {
    dirHandle: null,
    ready: false,
    pendingTimer: 0,
    writeInFlight: false,
    dirtyWhileWriting: false
  };
  var audioRuntime = {
    volumePreviewTimer: 0,
    audioContext: null,
    decodedFiles: {},
    decodeStarted: {}
  };
  var stateSyncRuntime = {
    ready: false,
    writeInFlight: false,
    queuedVersion: 0,
    queuedPayload: "",
    awaitingServerSync: false,
    syncAttemptInFlight: false,
    lastSyncAttemptAt: 0
  };

  init();

  function init() {
    prepareConfiguredSoundFiles();
    loadInitialState().then(function (initialState) {
      bootstrapApp(initialState);
    }).catch(function (error) {
      console.warn("App initialization failed", error);
      bootstrapApp(createFreshState());
    });
  }

  function bootstrapApp(initialState) {
    state = initialState;
    stateSyncRuntime.ready = true;
    syncTimerSessionDay(true);
    bindEvents();
    syncSettingsUi();
    setMode(state.timer.mode, false, true);
    resetTimer(true);
    renderTimer();
    renderChecklists();
    renderEditor();
    renderCalendar();
    updateNotificationNote();
    setInterval(tickTimer, 250);
    setInterval(periodicRefresh, 1000);
    initializeBackupRuntime();
    registerSW();
  }

  function createFreshState() {
    var freshState = normalizeState(null);
    state = freshState;
    seedTemplatesIfEmpty();
    return freshState;
  }

  function loadInitialState() {
    var localRecord = loadStateFromLocalStorage();
    var retryWindowMs = INITIAL_SERVER_RETRY_MS;
    return loadStateFromServerWithRetry(retryWindowMs, INITIAL_SERVER_RETRY_INTERVAL_MS).then(function (serverRecord) {
      stateSyncRuntime.awaitingServerSync = false;
      if (serverRecord.exists) {
        writeStateToLocalStorage(serverRecord.state);
        return serverRecord.state;
      }
      if (localRecord.exists) {
        writeStateToServer(localRecord.state).catch(function (error) {
          console.warn("Local state migration failed", error);
        });
        return localRecord.state;
      }
      var freshState = createFreshState();
      writeStateToLocalStorage(freshState);
      writeStateToServer(freshState).catch(function (error) {
        console.warn("Initial shared state save failed", error);
      });
      return freshState;
    }).catch(function (error) {
      console.warn("Shared state load failed", error);
      stateSyncRuntime.awaitingServerSync = true;
      if (localRecord.exists) return localRecord.state;
      var freshState = createFreshState();
      writeStateToLocalStorage(freshState);
      return freshState;
    });
  }

  function loadStateFromServerWithRetry(maxWaitMs, intervalMs) {
    var startedAt = Date.now();
    var retryIntervalMs = Math.max(50, Number(intervalMs) || INITIAL_SERVER_RETRY_INTERVAL_MS);

    function attempt() {
      return loadStateFromServer().catch(function (error) {
        var elapsedMs = Date.now() - startedAt;
        if (elapsedMs >= maxWaitMs) {
          throw error;
        }
        return delay(Math.min(retryIntervalMs, maxWaitMs - elapsedMs)).then(attempt);
      });
    }

    return attempt();
  }

  function loadStateFromLocalStorage() {
    try {
      var raw = localStorage.getItem(STORAGE_KEY);
      var parsed = raw ? JSON.parse(raw) : null;
      return {
        exists: raw !== null && hasStoredStateShape(parsed),
        state: normalizeState(parsed)
      };
    } catch (e) {
      console.warn("State load failed", e);
      return {
        exists: false,
        state: normalizeState(null)
      };
    }
  }

  function loadStateFromServer() {
    return fetch(SHARED_STATE_API, { cache: "no-store" }).then(function (response) {
      if (!response.ok) throw new Error("Shared state request failed with status " + response.status + ".");
      return response.json();
    }).then(function (payload) {
      return {
        exists: !!(payload && payload.exists && hasStoredStateShape(payload.state)),
        state: normalizeState(payload && payload.state)
      };
    });
  }

  function delay(ms) {
    return new Promise(function (resolve) {
      setTimeout(resolve, Math.max(0, Number(ms) || 0));
    });
  }

  function hasStoredStateShape(input) {
    return !!(input && typeof input === "object" && (
      Object.prototype.hasOwnProperty.call(input, "settings")
      || Object.prototype.hasOwnProperty.call(input, "templates")
      || Object.prototype.hasOwnProperty.call(input, "completions")
      || Object.prototype.hasOwnProperty.call(input, "timer")
    ));
  }

  function normalizeState(input) {
    var s = input || {};
    return {
      settings: {
        autoStart: !!(s.settings && s.settings.autoStart),
        soundAlerts: s.settings && typeof s.settings.soundAlerts === "boolean" ? s.settings.soundAlerts : true,
        browserNotifications: !!(s.settings && s.settings.browserNotifications),
        fontSize: normalizeFontSize(s.settings && s.settings.fontSize),
        soundVolume: normalizeSoundVolume(s.settings && s.settings.soundVolume),
        autoBackup: !!(s.settings && s.settings.autoBackup),
        backupFolderSelected: !!(s.settings && s.settings.backupFolderSelected),
        backupLastSuccessAt: typeof (s.settings && s.settings.backupLastSuccessAt) === "number" ? s.settings.backupLastSuccessAt : null,
        backupLastError: typeof (s.settings && s.settings.backupLastError) === "string" ? s.settings.backupLastError : "",
        durations: {
          focus: pos(s.settings && s.settings.durations && s.settings.durations.focus, DEFAULT_DURATIONS.focus),
          shortBreak: pos(s.settings && s.settings.durations && s.settings.durations.shortBreak, DEFAULT_DURATIONS.shortBreak),
          longBreak: pos(s.settings && s.settings.durations && s.settings.durations.longBreak, DEFAULT_DURATIONS.longBreak)
        }
      },
      templates: {
        daily: normalizeTemplates(s.templates && s.templates.daily, "daily"),
        weekly: normalizeTemplates(s.templates && s.templates.weekly, "weekly")
      },
      completions: {
        daily: isObj(s.completions && s.completions.daily) ? s.completions.daily : {},
        weekly: isObj(s.completions && s.completions.weekly) ? s.completions.weekly : {}
      },
      timer: {
        mode: safeMode(s.timer && s.timer.mode),
        sequenceIndex: nonNegInt(s.timer && s.timer.sequenceIndex, 0),
        session: pos(s.timer && s.timer.session, 1),
        sessionDayKey: validKey(s.timer && s.timer.sessionDayKey) || todayKey()
      }
    };
  }

  function normalizeTemplates(list, type) {
    if (!Array.isArray(list)) return [];
    var fallbackStart = type === "daily" ? todayKey() : currentWeekKey();
    return list
      .filter(function (t) { return t && typeof t === "object"; })
      .map(function (t, i) {
        return {
          id: String(t.id || uid()),
          title: String(t.title || "").trim(),
          startKey: validKey(t.startKey) || fallbackStart,
          endKeyExclusive: validKey(t.endKeyExclusive) || null,
          createdAt: typeof t.createdAt === "number" ? t.createdAt : Date.now(),
          order: nonNegInt(t.order, i)
        };
      })
      .filter(function (t) { return t.title; })
      .sort(function (a, b) { return a.order - b.order; });
  }

  function persist(skipBackup) {
    try {
      writeStateToLocalStorage(state);
    } catch (e) {
      console.warn("State local cache save failed", e);
    }
    queueStateWrite();
    if (!skipBackup) {
      scheduleAutoBackup();
    }
  }

  function bindEvents() {
    els.tabBtns.forEach(function (btn) {
      btn.addEventListener("click", function () { switchPage(btn.dataset.page); });
    });
    els.appMenuButton.addEventListener("click", function (e) {
      e.stopPropagation();
      toggleAppMenu();
    });
    els.appMenuPanel.addEventListener("click", function (e) {
      e.stopPropagation();
    });
    els.menuTimerSettingsBtn.addEventListener("click", function () {
      switchPage("focus");
      setTimerSettingsPanelOpen(true);
      closeAppMenu();
      scrollIntoViewIfNeeded(els.timerSettings);
    });
    els.menuEditDailyBtn.addEventListener("click", function () {
      switchPage("focus");
      openEditor("daily");
      closeAppMenu();
    });
    els.menuEditWeeklyBtn.addEventListener("click", function () {
      switchPage("focus");
      openEditor("weekly");
      closeAppMenu();
    });
    els.menuFontSize.addEventListener("input", function () {
      state.settings.fontSize = sliderValueToFontSize(els.menuFontSize.value);
      applyFontSize();
      persist();
    });
    if (els.menuSoundVolume) {
      els.menuSoundVolume.addEventListener("input", function () {
        state.settings.soundVolume = normalizeSoundVolume(Number(els.menuSoundVolume.value) / 100);
        persist();
        scheduleSoundVolumePreview();
      });
    }
    els.settingAutoBackup.addEventListener("change", function () {
      state.settings.autoBackup = els.settingAutoBackup.checked;
      if (!state.settings.autoBackup) {
        state.settings.backupLastError = "";
      }
      syncBackupUi();
      persist();
      if (state.settings.autoBackup) {
        scheduleAutoBackup(true);
      }
    });
    els.chooseBackupFolderBtn.addEventListener("click", function () {
      chooseBackupFolder();
    });
    els.modeBtns.forEach(function (btn) {
      btn.addEventListener("click", function () {
        playTimerButtonClickSound("timerModeButton");
        setMode(btn.dataset.mode, true);
      });
    });
    els.startPauseBtn.addEventListener("click", function () {
      playTimerButtonClickSound("timerStartPause");
      toggleTimer();
    });
    els.resetBtn.addEventListener("click", function () {
      playTimerButtonClickSound("timerReset");
      resetTimer(true);
      renderTimer();
    });
    els.skipBtn.addEventListener("click", function () {
      playTimerButtonClickSound("timerSkip");
      skipTimer();
    });
    els.settingAutostart.addEventListener("change", function () {
      state.settings.autoStart = els.settingAutostart.checked; persist();
    });
    els.settingSound.addEventListener("change", function () {
      state.settings.soundAlerts = els.settingSound.checked; persist();
    });
    els.settingNotification.addEventListener("change", function () {
      setNotificationEnabled(els.settingNotification.checked);
    });
    els.timerSettingsDoneBtn.addEventListener("click", function () {
      setTimerSettingsPanelOpen(false);
    });
    els.editorAddBtn.addEventListener("click", addDraftTask);
    els.editorNewInput.addEventListener("keydown", function (e) {
      if (e.key === "Enter") { e.preventDefault(); addDraftTask(); }
    });
    els.editorCancelBtn.addEventListener("click", function () {
      closeEditor();
    });
    els.editorSaveBtn.addEventListener("click", saveEditor);
    els.editorList.addEventListener("click", onEditorClick);
    els.editorList.addEventListener("input", onEditorInput);
    els.calendarPrev.addEventListener("click", function () {
      view.calendarMonth = clampCalendarMonth(addMonths(view.calendarMonth, -1)); renderCalendar();
    });
    els.calendarNext.addEventListener("click", function () {
      view.calendarMonth = addMonths(view.calendarMonth, 1); renderCalendar();
    });
    document.addEventListener("visibilitychange", function () {
      if (!document.hidden) {
        periodicRefresh();
        renderCalendar();
        maybeRefreshSharedState(true);
      }
    });
    window.addEventListener("focus", function () {
      maybeRefreshSharedState(true);
    });
    document.addEventListener("click", function () { closeAppMenu(); });
    document.addEventListener("keydown", function (e) {
      if (e.key === "Escape") {
        closeAppMenu();
      }
    });
  }

  function switchPage(name) {
    view.page = name;
    els.tabBtns.forEach(function (b) { b.classList.toggle("is-active", b.dataset.page === name); });
    els.pages.forEach(function (p) { p.classList.toggle("is-active", p.id === "page-" + name); });
    if (name === "calendar") renderCalendar();
  }

  function toggleAppMenu() {
    var willOpen = !!els.appMenuPanel.hidden;
    els.appMenuPanel.hidden = !willOpen;
    els.appMenuButton.setAttribute("aria-expanded", String(willOpen));
  }

  function closeAppMenu() {
    if (els.appMenuPanel.hidden) return;
    els.appMenuPanel.hidden = true;
    els.appMenuButton.setAttribute("aria-expanded", "false");
  }

  function setTimerSettingsPanelOpen(open) {
    els.timerSettings.hidden = !open;
  }

  function scrollIntoViewIfNeeded(el) {
    if (!el) return;
    if (typeof el.scrollIntoView === "function") {
      el.scrollIntoView({ behavior: "smooth", block: "nearest" });
    }
  }

  function setMode(mode, resetAndStop, skipPersist) {
    state.timer.mode = safeMode(mode);
    state.timer.sequenceIndex = Math.max(0, MODE_SEQUENCE.indexOf(state.timer.mode));
    if (resetAndStop) resetTimer(true);
    els.modeBtns.forEach(function (b) { b.classList.toggle("is-active", b.dataset.mode === state.timer.mode); });
    applyTimerTheme();
    if (!skipPersist) persist();
    renderTimer();
  }

  function modeMs(mode) {
    return Math.round((state.settings.durations[mode] || DEFAULT_DURATIONS.focus) * 60000);
  }

  function resetTimer(stop) {
    if (stop) timer.running = false;
    timer.startedAtMs = 0;
    timer.durationMs = modeMs(state.timer.mode);
    timer.remainingMs = timer.durationMs;
  }

  function toggleTimer() {
    if (timer.running) {
      timer.remainingMs = currentRemainingMs();
      timer.running = false;
      timer.startedAtMs = 0;
      renderTimer();
      return;
    }
    timer.durationMs = Math.max(0, timer.remainingMs);
    timer.startedAtMs = Date.now();
    timer.running = true;
    renderTimer();
  }

  function currentRemainingMs() {
    if (!timer.running) return Math.max(0, timer.remainingMs);
    return Math.max(0, timer.durationMs - (Date.now() - timer.startedAtMs));
  }

  function tickTimer() {
    if (!timer.running) return;
    timer.remainingMs = currentRemainingMs();
    if (timer.remainingMs <= 0) {
      timer.running = false;
      timer.remainingMs = 0;
      onTimerCompleted();
    }
    renderTimer();
  }

  function onTimerCompleted(options) {
    var opts = isObj(options) ? options : {};
    var completedMode = state.timer.mode;
    if (completedMode === "focus") {
      syncTimerSessionDay(true);
      state.timer.session = pos(state.timer.session, 1) + 1;
      state.timer.sessionDayKey = todayKey();
    }
    if (!opts.silent) {
      notifyCompletion(completedMode);
    }
    var nextIndex = (nonNegInt(state.timer.sequenceIndex, 0) + 1) % MODE_SEQUENCE.length;
    state.timer.sequenceIndex = nextIndex;
    state.timer.mode = MODE_SEQUENCE[nextIndex];
    els.modeBtns.forEach(function (b) { b.classList.toggle("is-active", b.dataset.mode === state.timer.mode); });
    applyTimerTheme();
    resetTimer(false);
    persist();
    if (state.settings.autoStart) {
      timer.startedAtMs = Date.now();
      timer.durationMs = timer.remainingMs;
      timer.running = true;
    }
  }

  function skipTimer() {
    timer.running = false;
    timer.remainingMs = 0;
    onTimerCompleted({ silent: true });
    renderTimer();
  }

  function renderTimer() {
    els.timerDisplay.textContent = mmss(timer.remainingMs);
    els.startPauseBtn.textContent = timer.running ? "PAUSE" : "START";
    var modeLabel = state.timer.mode === "focus" ? "Focus" : (state.timer.mode === "shortBreak" ? "Short Break" : "Long Break");
    els.cycleLabel.textContent = modeLabel + " - Session " + pos(state.timer.session, 1);
    document.title = "Focus+ - " + mmss(timer.remainingMs) + " - " + modeLabel;
  }

  function syncSettingsUi() {
    els.settingAutostart.checked = state.settings.autoStart;
    els.settingSound.checked = state.settings.soundAlerts;
    els.settingNotification.checked = state.settings.browserNotifications;
    els.menuFontSize.value = String(fontSizeToSliderValue(state.settings.fontSize));
    if (els.menuSoundVolume) {
      els.menuSoundVolume.value = String(Math.round(normalizeSoundVolume(state.settings.soundVolume) * 100));
    }
    els.settingAutoBackup.checked = state.settings.autoBackup;
    applyFontSize();
    syncBackupUi();
  }

  function syncBackupUi() {
    var enabled = !!state.settings.autoBackup;
    els.backupControls.hidden = !enabled;
    if (!enabled) {
      els.backupStatus.textContent = "";
      return;
    }
    if (!window.showDirectoryPicker) {
      els.backupStatus.textContent = "Folder backup is not supported in this browser.";
      return;
    }
    var parts = [];
    parts.push(state.settings.backupFolderSelected ? "Folder selected." : "No folder selected.");
    if (state.settings.backupLastSuccessAt) {
      parts.push("Last backup: " + new Date(state.settings.backupLastSuccessAt).toLocaleString());
    }
    if (state.settings.backupLastError) {
      parts.push("Error: " + state.settings.backupLastError);
    }
    els.backupStatus.textContent = parts.join(" ");
  }

  function initializeBackupRuntime() {
    loadStoredBackupHandle().then(function (handle) {
      backupRuntime.dirHandle = handle || null;
      backupRuntime.ready = true;
      state.settings.backupFolderSelected = !!backupRuntime.dirHandle;
      syncBackupUi();
      persist(true);
      if (state.settings.autoBackup && backupRuntime.dirHandle) {
        scheduleAutoBackup(true);
      }
    }).catch(function (error) {
      backupRuntime.ready = true;
      state.settings.backupFolderSelected = false;
      state.settings.backupLastError = "Failed to load backup folder handle.";
      console.warn("Backup init failed", error);
      syncBackupUi();
      persist(true);
    });
  }

  function chooseBackupFolder() {
    if (!window.showDirectoryPicker) {
      state.settings.backupLastError = "Folder picker is not supported in this browser.";
      syncBackupUi();
      persist(true);
      return;
    }
    window.showDirectoryPicker({ mode: "readwrite" }).then(function (pickedHandle) {
      return ensureBackupSubdirectory(pickedHandle).then(function (backupDir) {
        return requestReadWritePermission(backupDir).then(function (granted) {
          if (!granted) {
            throw new Error("Permission denied.");
          }
          return storeBackupHandle(backupDir).then(function () {
            backupRuntime.dirHandle = backupDir;
            state.settings.backupFolderSelected = true;
            state.settings.backupLastError = "";
            syncBackupUi();
            persist(true);
            if (state.settings.autoBackup) {
              scheduleAutoBackup(true);
            }
          });
        });
      });
    }).catch(function (error) {
      if (error && error.name === "AbortError") {
        return;
      }
      state.settings.backupLastError = error && error.message ? error.message : "Failed to choose folder.";
      syncBackupUi();
      persist(true);
    });
  }

  function scheduleAutoBackup(forceSoon) {
    if (!state.settings.autoBackup || !backupRuntime.dirHandle) {
      return;
    }
    if (backupRuntime.writeInFlight) {
      backupRuntime.dirtyWhileWriting = true;
      return;
    }
    if (backupRuntime.pendingTimer) {
      clearTimeout(backupRuntime.pendingTimer);
      backupRuntime.pendingTimer = 0;
    }
    backupRuntime.pendingTimer = setTimeout(function () {
      backupRuntime.pendingTimer = 0;
      performAutoBackup();
    }, forceSoon ? 250 : 1200);
  }

  function performAutoBackup() {
    if (!state.settings.autoBackup || !backupRuntime.dirHandle || backupRuntime.writeInFlight) {
      return;
    }
    backupRuntime.writeInFlight = true;
    backupRuntime.dirtyWhileWriting = false;

    var snapshot = createBackupSnapshot();
    requestReadWritePermission(backupRuntime.dirHandle).then(function (granted) {
      if (!granted) {
        throw new Error("Backup folder permission denied.");
      }
      return Promise.all([
        writeJsonToHandle(backupRuntime.dirHandle, BACKUP_CONFIG_FILE, snapshot.config),
        writeJsonToHandle(backupRuntime.dirHandle, BACKUP_HISTORY_FILE, snapshot.history)
      ]);
    }).then(function () {
      state.settings.backupLastSuccessAt = Date.now();
      state.settings.backupLastError = "";
      syncBackupUi();
      persist(true);
    }).catch(function (error) {
      state.settings.backupLastError = error && error.message ? error.message : "Backup write failed.";
      syncBackupUi();
      persist(true);
      console.warn("Auto backup failed", error);
    }).finally(function () {
      backupRuntime.writeInFlight = false;
      if (backupRuntime.dirtyWhileWriting) {
        scheduleAutoBackup(true);
      }
    });
  }

  function createBackupSnapshot() {
    return {
      config: {
        app: "Focus+",
        version: 1,
        exportedAt: new Date().toISOString(),
        settings: {
          autoStart: state.settings.autoStart,
          soundAlerts: state.settings.soundAlerts,
          browserNotifications: state.settings.browserNotifications,
          fontSize: state.settings.fontSize,
          soundVolume: state.settings.soundVolume,
          autoBackup: state.settings.autoBackup,
          durations: state.settings.durations
        },
        templates: state.templates,
        timer: state.timer
      },
      history: {
        app: "Focus+",
        version: 1,
        exportedAt: new Date().toISOString(),
        completions: state.completions
      }
    };
  }

  function setNotificationEnabled(enabled) {
    if (!enabled) {
      state.settings.browserNotifications = false;
      persist();
      updateNotificationNote();
      return;
    }
    if (!("Notification" in window)) {
      els.settingNotification.checked = false;
      state.settings.browserNotifications = false;
      persist();
      updateNotificationNote("Notifications are not supported in this browser.");
      return;
    }
    if (Notification.permission === "granted") {
      state.settings.browserNotifications = true;
      persist();
      updateNotificationNote();
      return;
    }
    if (Notification.permission === "denied") {
      els.settingNotification.checked = false;
      state.settings.browserNotifications = false;
      persist();
      updateNotificationNote("Notifications are blocked in browser settings.");
      return;
    }
    Notification.requestPermission().then(function (perm) {
      state.settings.browserNotifications = perm === "granted";
      els.settingNotification.checked = state.settings.browserNotifications;
      persist();
      updateNotificationNote();
    }).catch(function () {
      els.settingNotification.checked = false;
      state.settings.browserNotifications = false;
      persist();
      updateNotificationNote("Notification permission request failed.");
    });
  }

  function updateNotificationNote(custom) {
    if (custom) { setNotificationNoteText(custom); return; }
    if (!("Notification" in window)) { setNotificationNoteText("Notifications are not supported."); return; }
    if (Notification.permission === "granted") { setNotificationNoteText(""); return; }
    if (Notification.permission === "denied") { setNotificationNoteText("Notifications blocked in browser settings."); return; }
    setNotificationNoteText("");
  }

  function notifyCompletion(mode) {
    if (state.settings.soundAlerts && !playConfiguredSound("timerComplete")) playBeep();
    if (state.settings.browserNotifications && "Notification" in window && Notification.permission === "granted") {
      try {
        new Notification("Timer complete", {
          body: mode === "focus" ? "Time for a break." : "Break is over. Back to focus."
        });
      } catch (e) {
        console.warn("Notification failed", e);
      }
    }
  }

  function playBeep() {
    try {
      var Ctx = window.AudioContext || window.webkitAudioContext;
      if (!Ctx) return;
      var volume = soundVolumeLevel();
      if (volume <= 0) return;
      var ctx = new Ctx();
      var osc = ctx.createOscillator();
      var gain = ctx.createGain();
      osc.type = "sine";
      osc.frequency.value = 880;
      gain.gain.value = 0.001;
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start();
      gain.gain.exponentialRampToValueAtTime(Math.max(0.0001, 0.12 * volume), ctx.currentTime + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + 0.28);
      osc.stop(ctx.currentTime + 0.3);
      osc.onended = function () { if (ctx.close) ctx.close().catch(function () {}); };
    } catch (e) {
      console.warn("Beep failed", e);
    }
  }

  function playTimerButtonClickSound(soundName) {
    if (!state.settings.soundAlerts) return;
    if (playConfiguredSound(soundName)) return;
    playSynthChirp({
      type: "triangle",
      startFreq: 980,
      endFreq: 700,
      duration: 0.06,
      peakGain: 0.14
    });
  }

  function playChecklistToggleSound(checked) {
    if (!state.settings.soundAlerts) return;
    if (checked) {
      if (playConfiguredSound("checklistChecked")) return;
      playSynthChirp({
        type: "triangle",
        startFreq: 720,
        endFreq: 1040,
        duration: 0.11,
        peakGain: 0.18
      });
      return;
    }
    if (playConfiguredSound("checklistUnchecked")) return;
    playSynthChirp({ type: "triangle", startFreq: 560, endFreq: 400, duration: 0.08, peakGain: 0.08 });
  }

  function prepareConfiguredSoundFiles() {
    collectConfiguredSoundFiles().forEach(function (src) {
      preloadSoundFile(src);
    });
  }

  function collectConfiguredSoundFiles() {
    var files = [];
    var seen = {};
    Object.keys(soundConfig.sounds).forEach(function (name) {
      var spec = resolveSoundSpec(name);
      var src = spec && spec.file ? spec.file : "";
      if (!src || seen[src]) return;
      seen[src] = true;
      files.push(src);
    });
    return files;
  }

  function preloadSoundFile(src) {
    try {
      if (!src || audioRuntime.decodeStarted[src] || typeof fetch !== "function") return;
      var ctx = getAudioContext();
      if (!ctx) return;
      audioRuntime.decodeStarted[src] = true;
      fetch(src, { cache: "force-cache" })
        .then(function (response) {
          if (!response.ok) throw new Error("Sound request failed.");
          return response.arrayBuffer();
        })
        .then(function (buffer) { return decodeAudioData(ctx, buffer); })
        .then(function (decoded) {
          audioRuntime.decodedFiles[src] = decoded;
        })
        .catch(function (error) {
          console.warn("Sound preload failed for " + src, error);
        });
    } catch (e) {
      console.warn("Sound preload setup failed for " + src, e);
    }
  }

  function playConfiguredSound(name) {
    var spec = resolveSoundSpec(name);
    if (!spec) return false;
    if (spec.file && playUiSoundFile(spec.file, spec.volume)) return true;
    if (spec.synth) {
      var synth = cloneSoundSpec(spec.synth);
      synth.peakGain = (Number(synth.peakGain) || 0.03) * normalizeSoundGain(spec.volume, 1);
      playSynthChirp(synth);
      return true;
    }
    return false;
  }

  function playUiSoundFile(src, soundGain) {
    try {
      if (typeof Audio === "undefined" || !src) return false;
      var volume = effectiveSoundGain(soundGain);
      if (volume <= 0) return true;

      var ctx = getAudioContext();
      if (ctx && audioRuntime.decodedFiles[src]) {
        if (ctx.state === "suspended" && typeof ctx.resume === "function") {
          ctx.resume().catch(function () {});
        }
        var source = ctx.createBufferSource();
        var gain = ctx.createGain();
        source.buffer = audioRuntime.decodedFiles[src];
        gain.gain.value = volume;
        source.connect(gain);
        gain.connect(ctx.destination);
        source.start(0);
        return true;
      }

      preloadSoundFile(src);
      var clip = new Audio(src);
      clip.volume = Math.max(0, Math.min(1, volume));
      var p = clip.play();
      if (p && typeof p.catch === "function") p.catch(function () {});
      return true;
    } catch (e) {
      console.warn("UI file sound failed", e);
      return false;
    }
  }

  function scheduleSoundVolumePreview() {
    if (audioRuntime.volumePreviewTimer) {
      clearTimeout(audioRuntime.volumePreviewTimer);
    }
    audioRuntime.volumePreviewTimer = setTimeout(function () {
      audioRuntime.volumePreviewTimer = 0;
      playSoundVolumePreview();
    }, 60);
  }

  function playSoundVolumePreview() {
    if (playConfiguredSound("volumePreview")) return;
    if (playConfiguredSound("timerComplete")) return;
    playSynthChirp({
      type: "triangle",
      startFreq: 760,
      endFreq: 1160,
      duration: 0.09,
      peakGain: 0.24
    });
  }

  function playSynthChirp(opts) {
    try {
      var Ctx = window.AudioContext || window.webkitAudioContext;
      if (!Ctx) return;
      var volume = soundVolumeLevel();
      if (volume <= 0) return;
      var ctx = new Ctx();
      var osc = ctx.createOscillator();
      var gain = ctx.createGain();
      var now = ctx.currentTime;
      var startFreq = Math.max(40, Number(opts && opts.startFreq) || 440);
      var endFreq = Math.max(40, Number(opts && opts.endFreq) || startFreq);
      var duration = Math.max(0.02, Number(opts && opts.duration) || 0.06);
      var peakGain = Math.max(0.001, Number(opts && opts.peakGain) || 0.03);

      osc.type = (opts && opts.type) || "sine";
      osc.frequency.setValueAtTime(startFreq, now);
      osc.frequency.exponentialRampToValueAtTime(endFreq, now + duration);

      gain.gain.setValueAtTime(0.0001, now);
      gain.gain.exponentialRampToValueAtTime(Math.max(0.0001, Math.min(0.85, peakGain * volume)), now + Math.min(0.012, duration * 0.35));
      gain.gain.exponentialRampToValueAtTime(0.0001, now + duration);

      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start(now);
      osc.stop(now + duration + 0.01);
      osc.onended = function () { if (ctx.close) ctx.close().catch(function () {}); };
    } catch (e) {
      console.warn("UI sound failed", e);
    }
  }

  function periodicRefresh() {
    var d = todayKey();
    var w = currentWeekKey();
    if (timer.lastDayKey !== d || timer.lastWeekKey !== w) {
      timer.lastDayKey = d;
      timer.lastWeekKey = w;
      syncTimerSessionDay(true);
      renderTimer();
      renderChecklists();
      renderCalendar();
    }
    maybeRefreshSharedState(false);
  }

  function maybeRefreshSharedState(force) {
    if (!stateSyncRuntime.ready || stateSyncRuntime.writeInFlight || stateSyncRuntime.syncAttemptInFlight) {
      return Promise.resolve(false);
    }
    if (!stateSyncRuntime.awaitingServerSync && !force) {
      return Promise.resolve(false);
    }
    var now = Date.now();
    if (!force && now - stateSyncRuntime.lastSyncAttemptAt < SERVER_RESYNC_INTERVAL_MS) {
      return Promise.resolve(false);
    }

    stateSyncRuntime.syncAttemptInFlight = true;
    stateSyncRuntime.lastSyncAttemptAt = now;

    return loadStateFromServer().then(function (serverRecord) {
      stateSyncRuntime.awaitingServerSync = false;
      if (serverRecord.exists) {
        applyStateFromServer(serverRecord.state);
        return true;
      }
      flushQueuedStateWrite();
      return true;
    }).catch(function (error) {
      stateSyncRuntime.awaitingServerSync = true;
      console.warn("Shared state refresh failed", error);
      return false;
    }).finally(function () {
      stateSyncRuntime.syncAttemptInFlight = false;
    });
  }

  function applyStateFromServer(nextState) {
    var normalizedServerState = normalizeState(nextState);
    normalizedServerState.settings.backupFolderSelected = !!backupRuntime.dirHandle;
    normalizedServerState.settings.backupLastSuccessAt = state.settings.backupLastSuccessAt;
    normalizedServerState.settings.backupLastError = state.settings.backupLastError;

    if (JSON.stringify(normalizedServerState) === JSON.stringify(state)) {
      try {
        writeStateToLocalStorage(normalizedServerState);
      } catch (e) {
        console.warn("State local cache save failed", e);
      }
      return;
    }

    state = normalizedServerState;
    syncTimerSessionDay(false);
    try {
      writeStateToLocalStorage(state);
    } catch (e) {
      console.warn("State local cache save failed", e);
    }
    syncSettingsUi();
    setMode(state.timer.mode, false, true);
    resetTimer(true);
    renderTimer();
    renderChecklists();
    renderEditor();
    renderCalendar();
    updateNotificationNote();
    syncBackupUi();
  }

  function syncTimerSessionDay(persistIfChanged) {
    var dayKey = todayKey();
    if (state.timer.sessionDayKey === dayKey) return false;
    state.timer.sessionDayKey = dayKey;
    state.timer.session = 1;
    if (persistIfChanged) persist();
    return true;
  }

  function renderChecklists() {
    var dKey = todayKey();
    var wKey = currentWeekKey();
    els.dailyPeriodLabel.textContent = formatDateLong(parseKey(dKey));
    var ws = parseKey(wKey);
    var we = addDays(ws, 6);
    els.weeklyPeriodLabel.textContent = formatDateShort(ws) + " - " + formatDateShort(we) + " (Mon-Sun)";
    renderChecklist("daily", dKey, els.dailyChecklist, els.dailyEmpty);
    renderChecklist("weekly", wKey, els.weeklyChecklist, els.weeklyEmpty);
  }

  function renderChecklist(type, key, listEl, emptyEl) {
    listEl.innerHTML = "";
    var tasks = activeTemplates(type, key);
    var doneMap = completionMap(type, key);
    if (!tasks.length) {
      emptyEl.hidden = false;
      return;
    }
    emptyEl.hidden = true;
    tasks.forEach(function (task) {
      var li = els.checklistTpl.content.firstElementChild.cloneNode(true);
      var cb = li.querySelector("input");
      var label = li.querySelector(".check-label");
      cb.checked = !!doneMap[task.id];
      label.textContent = task.title;
      li.classList.toggle("is-done", cb.checked);
      cb.addEventListener("change", function () {
        playChecklistToggleSound(cb.checked);
        setCompletion(type, key, task.id, cb.checked);
        li.classList.toggle("is-done", cb.checked);
        renderCalendar();
      });
      listEl.appendChild(li);
    });
  }

  function setCompletion(type, key, taskId, checked) {
    var bucket = state.completions[type];
    if (!isObj(bucket[key])) bucket[key] = {};
    if (checked) bucket[key][taskId] = true;
    else delete bucket[key][taskId];
    if (Object.keys(bucket[key]).length === 0) delete bucket[key];
    persist();
  }

  function openEditor(type) {
    var cutoff = type === "daily" ? todayKey() : currentWeekKey();
    view.editorType = type;
    view.editorDirty = false;
    if (els.editorPanel) els.editorPanel.hidden = false;
    view.editorArchived = state.templates[type].filter(function (t) {
      return !!t.endKeyExclusive && t.endKeyExclusive <= cutoff;
    });
    view.editorDraft = state.templates[type].filter(function (t) {
      return !t.endKeyExclusive || t.endKeyExclusive > cutoff;
    }).map(function (t) {
      return {
        id: t.id,
        title: t.title,
        startKey: t.startKey,
        endKeyExclusive: t.endKeyExclusive,
        createdAt: t.createdAt,
        _existing: true,
        _removed: false
      };
    });
    els.editorNewInput.value = "";
    renderEditor();
    scrollIntoViewIfNeeded(els.editorPanel);
  }

  function closeEditor() {
    view.editorType = null;
    view.editorDraft = [];
    view.editorArchived = [];
    view.editorDirty = false;
    if (els.editorPanel) els.editorPanel.hidden = true;
    renderEditor();
  }

  function renderEditor() {
    els.editorList.innerHTML = "";
    if (!view.editorType) {
      els.editorContainer.hidden = true;
      els.editorTitle.textContent = "Template Editor";
      els.editorSubtitle.textContent = "Open a template editor to make changes.";
      return;
    }
    els.editorContainer.hidden = false;
    els.editorTitle.textContent = view.editorType === "daily" ? "Daily Template Editor" : "Weekly Template Editor";
    els.editorSubtitle.textContent = "Changes apply after you click Save Changes.";
    view.editorDraft.forEach(function (item, idx) {
      if (item._removed) return;
      var row = els.editorTpl.content.firstElementChild.cloneNode(true);
      row.dataset.index = String(idx);
      var input = row.querySelector(".editor-item-input");
      input.value = item.title;
      els.editorList.appendChild(row);
    });
    els.editorSaveBtn.disabled = !view.editorDirty;
  }

  function addDraftTask() {
    if (!view.editorType) return;
    var text = els.editorNewInput.value.trim();
    if (!text) return;
    view.editorDraft.push({
      id: uid(),
      title: text,
      startKey: view.editorType === "daily" ? todayKey() : currentWeekKey(),
      endKeyExclusive: null,
      createdAt: Date.now(),
      _existing: false,
      _removed: false
    });
    els.editorNewInput.value = "";
    view.editorDirty = true;
    renderEditor();
  }

  function onEditorClick(e) {
    var btn = e.target.closest("button[data-action]");
    if (!btn) return;
    var row = e.target.closest(".editor-item");
    if (!row) return;
    var idx = Number(row.dataset.index);
    if (!Number.isInteger(idx)) return;
    var action = btn.dataset.action;
    if (action === "remove") {
      view.editorDraft[idx]._removed = true;
      view.editorDirty = true;
      renderEditor();
      return;
    }
    if (action === "up") moveVisibleDraft(idx, -1);
    if (action === "down") moveVisibleDraft(idx, 1);
  }

  function onEditorInput(e) {
    var input = e.target.closest(".editor-item-input");
    if (!input) return;
    var row = e.target.closest(".editor-item");
    if (!row) return;
    var idx = Number(row.dataset.index);
    if (!Number.isInteger(idx)) return;
    view.editorDraft[idx].title = input.value;
    view.editorDirty = true;
    els.editorSaveBtn.disabled = false;
  }

  function moveVisibleDraft(fromIdx, delta) {
    var visible = [];
    for (var i = 0; i < view.editorDraft.length; i += 1) if (!view.editorDraft[i]._removed) visible.push(i);
    var posi = visible.indexOf(fromIdx);
    var tPos = posi + delta;
    if (posi < 0 || tPos < 0 || tPos >= visible.length) return;
    var targetIdx = visible[tPos];
    var tmp = view.editorDraft[fromIdx];
    view.editorDraft[fromIdx] = view.editorDraft[targetIdx];
    view.editorDraft[targetIdx] = tmp;
    view.editorDirty = true;
    renderEditor();
  }

  function saveEditor() {
    if (!view.editorType) return;
    var type = view.editorType;
    var currentKey = type === "daily" ? todayKey() : currentWeekKey();
    var nextList = [];
    view.editorDraft.forEach(function (item, idx) {
      var title = String(item.title || "").trim();
      if (item._removed || !title) {
        if (item._existing) {
          nextList.push({
            id: item.id,
            title: title || "(removed)",
            startKey: item.startKey,
            endKeyExclusive: currentKey,
            createdAt: item.createdAt,
            order: idx
          });
        }
        return;
      }
      nextList.push({
        id: item.id,
        title: title,
        startKey: item._existing ? item.startKey : currentKey,
        endKeyExclusive: item.endKeyExclusive || null,
        createdAt: item.createdAt || Date.now(),
        order: idx
      });
    });
    state.templates[type] = nextList.concat(view.editorArchived);
    persist();
    openEditor(type);
    renderChecklists();
    renderCalendar();
  }

  function activeTemplates(type, key) {
    return state.templates[type]
      .filter(function (t) { return t.startKey <= key && (!t.endKeyExclusive || key < t.endKeyExclusive); })
      .sort(function (a, b) { return a.order - b.order; });
  }

  function completionMap(type, key) {
    return isObj(state.completions[type][key]) ? state.completions[type][key] : {};
  }

  function renderCalendar() {
    view.calendarMonth = clampCalendarMonth(view.calendarMonth);
    var monthStart = startOfMonth(view.calendarMonth);
    var gridStart = addDays(monthStart, -monthStart.getDay()); // sunday-first display
    els.calendarGrid.innerHTML = "";
    els.calendarMonthLabel.textContent = monthStart.toLocaleDateString(undefined, { month: "long", year: "numeric" });
    els.calendarPrev.disabled = monthStart.getFullYear() === MIN_CALENDAR_MONTH.getFullYear()
      && monthStart.getMonth() === MIN_CALENDAR_MONTH.getMonth();

    DAY_NAMES.forEach(function (d) {
      var head = document.createElement("div");
      head.className = "calendar-head";
      head.textContent = d;
      els.calendarGrid.appendChild(head);
    });

    for (var i = 0; i < 42; i += 1) {
      var date = addDays(gridStart, i);
      var dKey = dateKey(date);
      var dStatus = dailyStatus(dKey);
      var cell = document.createElement("div");
      cell.className = "calendar-cell";
      if (date.getMonth() !== monthStart.getMonth()) cell.classList.add("is-outside");
      if (dKey === todayKey()) cell.classList.add("is-today");
      if (dStatus) cell.classList.add("status-" + dStatus);

      var weekStatus = null;
      if (date.getDay() === 0) weekStatus = weeklyStatus(weekKeyFromSunday(date));
      cell.setAttribute("aria-label", cellLabel(date, dStatus, weekStatus));

      var num = document.createElement("div");
      num.className = "calendar-date";
      num.textContent = String(date.getDate());
      cell.appendChild(num);

      var tags = document.createElement("div");
      tags.className = "calendar-tags";
      var dayTag = document.createElement("span");
      dayTag.className = "day-tag";
      dayTag.textContent = dStatus ? statusShort(dStatus) : "No daily";
      tags.appendChild(dayTag);

      if (date.getDay() === 0) {
        if (weekStatus) {
          var marker = document.createElement("span");
          marker.className = "week-marker status-" + weekStatus;
          marker.title = "Weekly: " + statusLong(weekStatus);
          tags.appendChild(marker);
        } else {
          var noWeek = document.createElement("span");
          noWeek.className = "week-tag";
          noWeek.textContent = "No week";
          tags.appendChild(noWeek);
        }
      }

      cell.appendChild(tags);
      els.calendarGrid.appendChild(cell);
    }
  }

  function dailyStatus(dKey) {
    var tasks = activeTemplates("daily", dKey);
    if (!tasks.length) return null;
    var map = completionMap("daily", dKey);
    var done = 0;
    tasks.forEach(function (t) { if (map[t.id]) done += 1; });
    if (done === 0) return "none";
    if (done === tasks.length) return "full";
    return "partial";
  }

  function weeklyStatus(wKey) {
    var tasks = activeTemplates("weekly", wKey);
    if (!tasks.length) return null;
    var map = completionMap("weekly", wKey);
    var done = 0;
    tasks.forEach(function (t) { if (map[t.id]) done += 1; });
    if (done === 0) return "none";
    if (done === tasks.length) return "full";
    return "partial";
  }

  function statusShort(s) { return s === "full" ? "All" : (s === "partial" ? "Some" : "None"); }
  function statusLong(s) { return s === "full" ? "all complete" : (s === "partial" ? "partial complete" : "none complete"); }

  function cellLabel(date, dStatus, wStatus) {
    var parts = [formatDateLong(date), "Daily " + (dStatus ? statusLong(dStatus) : "no tasks")];
    if (date.getDay() === 0) parts.push("Weekly " + (wStatus ? statusLong(wStatus) : "no tasks"));
    return parts.join(". ");
  }

  function seedTemplatesIfEmpty() {
    if (!state.templates.daily.length) {
      state.templates.daily = [
        makeTemplate("daily", "Check email inbox", 0),
        makeTemplate("daily", "Plan top 3 priorities", 1),
        makeTemplate("daily", "End-of-day review", 2)
      ];
    }
    if (!state.templates.weekly.length) {
      state.templates.weekly = [
        makeTemplate("weekly", "Weekly planning", 0),
        makeTemplate("weekly", "Workspace cleanup", 1),
        makeTemplate("weekly", "Review blockers", 2)
      ];
    }
  }

  function applyTimerTheme() {
    if (!els.timerCard) return;
    els.timerCard.classList.remove("theme-focus", "theme-shortBreak", "theme-longBreak");
    els.timerCard.classList.add("theme-" + state.timer.mode);
  }

  function setNotificationNoteText(text) {
    els.notificationNote.textContent = text;
    els.notificationNote.hidden = !text;
  }

  function makeTemplate(type, title, order) {
    return {
      id: uid(),
      title: title,
      startKey: type === "daily" ? todayKey() : currentWeekKey(),
      endKeyExclusive: null,
      createdAt: Date.now(),
      order: nonNegInt(order, state.templates[type].length)
    };
  }

  function writeStateToLocalStorage(nextState) {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(nextState));
  }

  function queueStateWrite() {
    if (!stateSyncRuntime.ready) return;
    stateSyncRuntime.queuedPayload = buildSharedStatePayload(state);
    stateSyncRuntime.queuedVersion += 1;
    if (stateSyncRuntime.awaitingServerSync) return;
    if (stateSyncRuntime.writeInFlight) return;
    flushQueuedStateWrite();
  }

  function flushQueuedStateWrite() {
    if (!stateSyncRuntime.queuedPayload) return;
    var payload = stateSyncRuntime.queuedPayload;
    var version = stateSyncRuntime.queuedVersion;
    stateSyncRuntime.queuedPayload = "";
    stateSyncRuntime.writeInFlight = true;
    writeStateToServer(payload).catch(function (error) {
      console.warn("Shared state save failed", error);
    }).finally(function () {
      stateSyncRuntime.writeInFlight = false;
      if (stateSyncRuntime.queuedVersion > version && stateSyncRuntime.queuedPayload) {
        flushQueuedStateWrite();
      }
    });
  }

  function writeStateToServer(nextState) {
    var payload = typeof nextState === "string" ? nextState : buildSharedStatePayload(nextState);
    return fetch(SHARED_STATE_API, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      cache: "no-store",
      body: payload
    }).then(function (response) {
      if (!response.ok) throw new Error("Shared state save failed with status " + response.status + ".");
      return response.json();
    });
  }

  function buildSharedStatePayload(nextState) {
    var sharedState = normalizeState(nextState);
    delete sharedState.settings.backupFolderSelected;
    delete sharedState.settings.backupLastSuccessAt;
    delete sharedState.settings.backupLastError;
    return JSON.stringify(sharedState);
  }

  function registerSW() {
    if (!("serviceWorker" in navigator)) return;
    function doRegister() {
      navigator.serviceWorker.register("./sw.js?v=" + APP_VERSION, { updateViaCache: "none" }).catch(function (e) {
        console.warn("SW registration failed", e);
      });
    }
    if (document.readyState === "complete") {
      doRegister();
      return;
    }
    window.addEventListener("load", doRegister, { once: true });
  }

  function ensureBackupSubdirectory(parentHandle) {
    if (!parentHandle || typeof parentHandle.getDirectoryHandle !== "function") {
      return Promise.reject(new Error("Invalid folder handle."));
    }
    return Promise.resolve(parentHandle.getDirectoryHandle(BACKUP_SUBDIR_NAME, { create: true }));
  }

  function requestReadWritePermission(handle) {
    if (!handle || typeof handle.queryPermission !== "function") {
      return Promise.resolve(true);
    }
    return Promise.resolve(handle.queryPermission({ mode: "readwrite" })).then(function (perm) {
      if (perm === "granted") return true;
      if (typeof handle.requestPermission !== "function") return false;
      return Promise.resolve(handle.requestPermission({ mode: "readwrite" })).then(function (nextPerm) {
        return nextPerm === "granted";
      });
    });
  }

  function writeJsonToHandle(dirHandle, filename, payload) {
    return Promise.resolve(dirHandle.getFileHandle(filename, { create: true })).then(function (fileHandle) {
      return Promise.resolve(fileHandle.createWritable());
    }).then(function (writable) {
      var content = JSON.stringify(payload, null, 2);
      return Promise.resolve(writable.write(content))
        .then(function () { return writable.close(); })
        .catch(function (error) {
          try {
            if (writable && typeof writable.abort === "function") {
              return Promise.resolve(writable.abort()).then(function () { throw error; });
            }
          } catch (abortError) {
            console.warn("Backup abort failed", abortError);
          }
          throw error;
        });
    });
  }

  function loadStoredBackupHandle() {
    return idbGet(BACKUP_HANDLE_KEY);
  }

  function storeBackupHandle(handle) {
    return idbSet(BACKUP_HANDLE_KEY, handle);
  }

  function openBackupDb() {
    return new Promise(function (resolve, reject) {
      if (!("indexedDB" in window)) {
        reject(new Error("IndexedDB unavailable."));
        return;
      }
      var request = indexedDB.open(BACKUP_DB_NAME, 1);
      request.onupgradeneeded = function () {
        var db = request.result;
        if (!db.objectStoreNames.contains(BACKUP_DB_STORE)) {
          db.createObjectStore(BACKUP_DB_STORE);
        }
      };
      request.onsuccess = function () { resolve(request.result); };
      request.onerror = function () { reject(request.error || new Error("IndexedDB open failed.")); };
    });
  }

  function idbGet(key) {
    return openBackupDb().then(function (db) {
      return new Promise(function (resolve, reject) {
        var tx = db.transaction(BACKUP_DB_STORE, "readonly");
        var store = tx.objectStore(BACKUP_DB_STORE);
        var req = store.get(key);
        req.onsuccess = function () { resolve(req.result || null); };
        req.onerror = function () { reject(req.error || new Error("IndexedDB get failed.")); };
        tx.oncomplete = function () { db.close(); };
        tx.onabort = function () { db.close(); };
      });
    });
  }

  function idbSet(key, value) {
    return openBackupDb().then(function (db) {
      return new Promise(function (resolve, reject) {
        var tx = db.transaction(BACKUP_DB_STORE, "readwrite");
        var store = tx.objectStore(BACKUP_DB_STORE);
        var req = store.put(value, key);
        req.onsuccess = function () { resolve(); };
        req.onerror = function () { reject(req.error || new Error("IndexedDB save failed.")); };
        tx.oncomplete = function () { db.close(); };
        tx.onabort = function () { db.close(); };
      });
    });
  }

  function safeMode(mode) {
    return (mode === "focus" || mode === "shortBreak" || mode === "longBreak") ? mode : "focus";
  }

  function normalizeFontSize(value) {
    return (value === "small" || value === "medium" || value === "large") ? value : "small";
  }

  function normalizeSoundVolume(value) {
    var n = Number(value);
    if (!Number.isFinite(n)) return 1;
    if (n > 1) n = n / 100;
    return Math.min(1, Math.max(0, n));
  }

  function normalizeSoundConfig(input) {
    var source = isObj(input) ? input : {};
    var sounds = isObj(source.sounds) ? source.sounds : {};
    return {
      sounds: {
        timerComplete: normalizeSoundEntry(sounds.timerComplete, DEFAULT_SOUND_CONFIG.sounds.timerComplete),
        timerModeButton: normalizeSoundEntry(sounds.timerModeButton, DEFAULT_SOUND_CONFIG.sounds.timerModeButton),
        timerStartPause: normalizeSoundEntry(sounds.timerStartPause, DEFAULT_SOUND_CONFIG.sounds.timerStartPause),
        timerReset: normalizeSoundEntry(sounds.timerReset, DEFAULT_SOUND_CONFIG.sounds.timerReset),
        timerSkip: normalizeSoundEntry(sounds.timerSkip, DEFAULT_SOUND_CONFIG.sounds.timerSkip),
        checklistChecked: normalizeSoundEntry(sounds.checklistChecked, DEFAULT_SOUND_CONFIG.sounds.checklistChecked),
        checklistUnchecked: normalizeSoundEntry(sounds.checklistUnchecked, DEFAULT_SOUND_CONFIG.sounds.checklistUnchecked),
        volumePreview: normalizeSoundEntry(sounds.volumePreview, DEFAULT_SOUND_CONFIG.sounds.volumePreview)
      }
    };
  }

  function normalizeSoundEntry(input, fallback) {
    var source = isObj(input) ? input : {};
    var base = isObj(fallback) ? fallback : {};
    var entry = {
      file: pickSoundString(source, base, "file"),
      alias: pickSoundString(source, base, "alias"),
      volume: normalizeSoundGain(hasOwn(source, "volume") ? source.volume : base.volume, 1),
      synth: normalizeSynthConfig(hasOwn(source, "synth") ? source.synth : base.synth)
    };
    if (entry.alias) {
      entry.file = "";
      entry.synth = null;
    }
    return entry;
  }

  function normalizeSynthConfig(input) {
    if (!isObj(input)) return null;
    return {
      type: typeof input.type === "string" ? input.type : "sine",
      startFreq: Math.max(40, Number(input.startFreq) || 440),
      endFreq: Math.max(40, Number(input.endFreq) || Number(input.startFreq) || 440),
      duration: Math.max(0.02, Number(input.duration) || 0.06),
      peakGain: Math.max(0.001, Number(input.peakGain) || 0.03)
    };
  }

  function pickSoundString(source, fallback, key) {
    var hasValue = hasOwn(source, key);
    var value = hasValue ? source[key] : fallback[key];
    return typeof value === "string" ? value.trim() : "";
  }

  function resolveSoundSpec(name, seen) {
    var trail = Array.isArray(seen) ? seen : [];
    if (!name || trail.indexOf(name) >= 0) return null;
    var entry = soundConfig && soundConfig.sounds ? soundConfig.sounds[name] : null;
    if (!entry) return null;
    if (entry.alias) {
      return resolveSoundSpec(entry.alias, trail.concat(name));
    }
    return entry;
  }

  function effectiveSoundGain(soundGain) {
    var base = soundVolumeLevel();
    if (base <= 0) return 0;
    return Math.max(0, base * normalizeSoundGain(soundGain, 1));
  }

  function normalizeSoundGain(value, fallback) {
    var n = Number(value);
    if (!Number.isFinite(n)) n = Number(fallback);
    if (!Number.isFinite(n)) n = 1;
    return Math.min(4, Math.max(0, n));
  }

  function getAudioContext() {
    try {
      var Ctx = window.AudioContext || window.webkitAudioContext;
      if (!Ctx) return null;
      if (!audioRuntime.audioContext) {
        audioRuntime.audioContext = new Ctx();
      }
      return audioRuntime.audioContext;
    } catch (e) {
      console.warn("Audio context init failed", e);
      return null;
    }
  }

  function decodeAudioData(ctx, buffer) {
    return new Promise(function (resolve, reject) {
      if (!ctx || typeof ctx.decodeAudioData !== "function") {
        reject(new Error("Audio decoding unsupported."));
        return;
      }
      var result;
      try {
        result = ctx.decodeAudioData(buffer, resolve, reject);
      } catch (error) {
        reject(error);
        return;
      }
      if (result && typeof result.then === "function") {
        result.then(resolve, reject);
      }
    });
  }

  function cloneSoundSpec(input) {
    var copy = {};
    if (!isObj(input)) return copy;
    Object.keys(input).forEach(function (key) {
      copy[key] = input[key];
    });
    return copy;
  }

  function soundVolumeLevel() {
    var base = normalizeSoundVolume(state && state.settings ? state.settings.soundVolume : 1);
    if (base <= 0) return 0;
    return 0.15 + (base * 1.85);
  }

  function applyFontSize() {
    document.documentElement.setAttribute("data-font-size", normalizeFontSize(state.settings.fontSize));
  }

  function fontSizeToSliderValue(size) {
    if (size === "medium") return 1;
    if (size === "large") return 2;
    return 0;
  }

  function sliderValueToFontSize(value) {
    var n = Number(value);
    if (n >= 2) return "large";
    if (n >= 1) return "medium";
    return "small";
  }

  function pos(v, fallback) {
    var n = Number(v);
    return Number.isFinite(n) && n > 0 ? n : fallback;
  }

  function nonNegInt(v, fallback) {
    var n = Number(v);
    return Number.isInteger(n) && n >= 0 ? n : fallback;
  }

  function isObj(v) {
    return !!v && typeof v === "object" && !Array.isArray(v);
  }

  function hasOwn(obj, key) {
    return !!obj && Object.prototype.hasOwnProperty.call(obj, key);
  }

  function uid() {
    return "id-" + Math.random().toString(36).slice(2, 9) + "-" + Date.now().toString(36).slice(-4);
  }

  function mmss(ms) {
    var sec = Math.max(0, Math.ceil(ms / 1000));
    var m = Math.floor(sec / 60);
    var s = sec % 60;
    return String(m).padStart(2, "0") + ":" + String(s).padStart(2, "0");
  }

  function validKey(k) {
    return typeof k === "string" && /^\d{4}-\d{2}-\d{2}$/.test(k) ? k : null;
  }

  function dateKey(date) {
    return date.getFullYear() + "-" + z(date.getMonth() + 1) + "-" + z(date.getDate());
  }

  function todayKey() { return dateKey(new Date()); }

  function parseKey(key) {
    var p = String(key).split("-");
    return new Date(Number(p[0]), Number(p[1]) - 1, Number(p[2]));
  }

  function startOfMonth(date) { return new Date(date.getFullYear(), date.getMonth(), 1); }
  function addMonths(date, n) { return new Date(date.getFullYear(), date.getMonth() + n, 1); }
  function addDays(date, n) { return new Date(date.getFullYear(), date.getMonth(), date.getDate() + n); }
  function clampCalendarMonth(date) {
    var m = startOfMonth(date);
    return m < MIN_CALENDAR_MONTH ? new Date(MIN_CALENDAR_MONTH.getFullYear(), MIN_CALENDAR_MONTH.getMonth(), 1) : m;
  }

  function currentWeekKey() { return dateKey(startOfWeekMonday(new Date())); }

  function startOfWeekMonday(date) {
    var d = new Date(date.getFullYear(), date.getMonth(), date.getDate());
    var day = d.getDay();
    return addDays(d, day === 0 ? -6 : 1 - day);
  }

  function weekKeyFromSunday(sunday) {
    return dateKey(addDays(sunday, -6));
  }

  function z(n) { return String(n).padStart(2, "0"); }

  function formatDateLong(date) {
    return date.toLocaleDateString(undefined, { weekday: "short", year: "numeric", month: "short", day: "numeric" });
  }

  function formatDateShort(date) {
    return date.toLocaleDateString(undefined, { month: "short", day: "numeric" });
  }
})();
